import { db, nextNumber, uid } from '../db/db';
import { cashTotals, nonCashTotals } from '../domain/cash';
import { dubaiDate, monthKey, nowIso } from '../domain/dates';
import { activeInvoice, chooseInvoiceType, formatDocNumber, invoiceLines, invoiceTotals } from '../domain/invoice';
import type { CashClosing, CashMovement, CashReason, Debt, Expense, Invoice, InvoiceType, PayMethod, Payment, SalaryPayment } from '../domain/types';
import { AppError } from './errors';
import { recordDecisions, sendVersion, setDone } from './estimate';
import { addMedia } from './media';
import { bundleAmountDue, loadOrderBundle, logEvent, tryStage } from './orders';
import { setProcurement } from './parts';

const year = () => Number(dubaiDate().slice(0, 4));

export interface PaymentInput {
  kind: Payment['kind'];
  method: PayMethod;
  amountFils: number;
  reference?: string;
}

export async function addPayment(orderId: string, input: PaymentInput): Promise<Payment> {
  const order = await db.orders.get(orderId);
  if (!order) throw new AppError('err.notFound');
  if (!(input.amountFils > 0)) throw new AppError('err.amountRequired');
  const now = nowIso();
  const payment = await db.transaction('rw', [db.payments, db.counters, db.cashMovements, db.events], async () => {
    const n = await nextNumber(`receipt-${year()}`);
    const p: Payment = {
      id: uid(),
      orderId,
      customerId: order.customerId,
      kind: input.kind,
      method: input.method,
      amountFils: input.amountFils,
      reference: input.reference?.trim() || undefined,
      receiptNumber: formatDocNumber('RC', year(), n),
      receivedAt: now,
    };
    await db.payments.add(p);
    if (p.method === 'cash') {
      await db.cashMovements.add({
        id: uid(),
        at: now,
        direction: p.kind === 'refund' ? 'out' : 'in',
        amountFils: p.amountFils,
        reason: p.kind === 'refund' ? 'refund' : p.kind === 'prepayment' ? 'prepayment' : 'order_payment',
        orderId,
        paymentId: p.id,
      });
    }
    await logEvent(orderId, 'payment', { kind: p.kind, method: p.method, amount: p.amountFils, receipt: p.receiptNumber });
    return p;
  });
  await settleIfPaid(orderId);
  return payment;
}

/** After a payment: close the order and its debt when nothing is due any more. */
async function settleIfPaid(orderId: string) {
  const b = await loadOrderBundle(orderId);
  if (!b) return;
  if (bundleAmountDue(b) > 0) return;
  for (const d of b.debts) if (d.status === 'open') await db.debts.update(d.id, { status: 'paid' });
  if (b.order.stage === 'delivered') await tryStage(orderId, 'closed');
}

/**
 * Quick invoice: the work and parts typed on the invoice screen are agreed with the customer in person
 * (a version and decisions are still recorded), marked done — bought parts as received — and the
 * invoice is issued. The job moves to "ready": it waits only for payment and pickup.
 */
export async function quickInvoice(orderId: string): Promise<Invoice> {
  const drafts = (await db.items.where('orderId').equals(orderId).toArray()).filter((i) => i.approvalState === 'draft');
  if (drafts.length) {
    const v = await sendVersion(orderId, { via: 'in_person' });
    await recordDecisions(
      v.id,
      drafts.map((i) => ({ itemId: i.id, decision: 'approve' as const })),
      'in_person',
    );
  }
  const approved = (await db.items.where('orderId').equals(orderId).toArray()).filter((i) => i.approvalState === 'approved');
  for (const i of approved) {
    if (i.kind === 'part' && !i.customerSupplied && !i.receivedAt && ['needed', 'ordered'].includes(i.procurementStatus ?? 'needed')) {
      await setProcurement(i.id, { status: 'received' });
    }
    if (!i.done) await setDone(i.id, true);
  }
  const inv = await issueInvoice(orderId);
  await tryStage(orderId, 'ready');
  return inv;
}

export async function issueInvoice(orderId: string, type?: Exclude<InvoiceType, 'credit_note'>): Promise<Invoice> {
  const b = await loadOrderBundle(orderId);
  if (!b) throw new AppError('err.notFound');
  if (activeInvoice(b.invoices)) throw new AppError('err.invoiceExists');
  const lines = invoiceLines(b.items, 'en');
  if (lines.length === 0) throw new AppError('err.nothingToInvoice');
  const s = b.settings;
  const c = b.customer;
  const invType = type ?? chooseInvoiceType(c);
  return db.transaction('rw', [db.invoices, db.counters, db.events], async () => {
    const n = await nextNumber(`invoice-${year()}`);
    const inv: Invoice = {
      id: uid(),
      number: formatDocNumber('INV', year(), n),
      type: invType,
      orderId,
      issuedAt: nowIso(),
      seller: { name: s.name, address: s.address, trn: s.trn, phone: s.phone, email: s.email },
      buyer: {
        name: c.type === 'company' && c.companyName ? c.companyName : c.name,
        address: c.address,
        trn: c.trn,
        phone: c.phone,
        email: c.email,
      },
      lines,
      ...invoiceTotals(lines),
      currency: 'AED',
      status: 'issued',
    };
    await db.invoices.add(inv);
    await logEvent(orderId, 'invoice', { number: inv.number, total: inv.totalFils });
    return inv;
  });
}

/** Issued invoices never change: a credit note cancels one, then a corrected invoice can be issued. */
export async function issueCreditNote(invoiceId: string, reason: string): Promise<Invoice> {
  const orig = await db.invoices.get(invoiceId);
  if (!orig || orig.type === 'credit_note') throw new AppError('err.notFound');
  if (orig.status !== 'issued') throw new AppError('err.alreadyCredited');
  if (!reason.trim()) throw new AppError('err.reasonRequired');
  return db.transaction('rw', [db.invoices, db.counters, db.events], async () => {
    const n = await nextNumber(`credit-${year()}`);
    const cn: Invoice = {
      ...orig,
      id: uid(),
      number: formatDocNumber('CN', year(), n),
      type: 'credit_note',
      originalInvoiceId: orig.id,
      issuedAt: nowIso(),
      reason: reason.trim(),
      status: 'issued',
    };
    await db.invoices.add(cn);
    await db.invoices.update(orig.id, { status: 'credited' });
    await logEvent(orig.orderId, 'credit_note', { number: cn.number, original: orig.number, reason });
    return cn;
  });
}

export async function createDebt(orderId: string, amountFils: number, dueDate: string, signature: Blob): Promise<Debt> {
  const order = await db.orders.get(orderId);
  if (!order) throw new AppError('err.notFound');
  if (!(amountFils > 0) || !dueDate) throw new AppError('err.amountRequired');
  const id = uid();
  const sig = await addMedia({ ownerType: 'debt', ownerId: id, slot: 'signature', file: signature, kind: 'signature', compress: false, locked: true });
  const debt: Debt = { id, orderId, customerId: order.customerId, amountFils, dueDate, signatureMediaId: sig.id, signedAt: nowIso(), status: 'open' };
  await db.transaction('rw', db.debts, db.events, async () => {
    await db.debts.add(debt);
    await logEvent(orderId, 'debt', { amount: amountFils, dueDate });
  });
  return debt;
}

// ---------- Cash ----------

export async function addCashMovement(input: { direction: 'in' | 'out'; amountFils: number; reason: CashReason; note?: string }): Promise<void> {
  if (!(input.amountFils > 0)) throw new AppError('err.amountRequired');
  if ((input.reason === 'other' || input.reason === 'adjustment' || input.reason === 'collection') && !input.note?.trim()) {
    throw new AppError('err.reasonRequired');
  }
  await db.cashMovements.add({ id: uid(), at: nowIso(), ...input, note: input.note?.trim() || undefined });
}

export async function cashState() {
  const [open, closings] = await Promise.all([
    db.cashMovements.filter((m) => !m.closingId).sortBy('at'),
    db.cashClosings.orderBy('date').toArray(),
  ]);
  const last = closings[closings.length - 1];
  const opening = last?.actualFils ?? 0;
  const t = cashTotals(open);
  return { opening, movements: open, inFils: t.inFils, outFils: t.outFils, expected: opening + t.inFils - t.outFils, lastClosing: last };
}

export async function closeCashDay(actualFils: number, comment?: string): Promise<CashClosing> {
  const st = await cashState();
  const diff = actualFils - st.expected;
  if (diff !== 0 && !comment?.trim()) throw new AppError('err.diffCommentRequired');
  const today = dubaiDate();
  const since = st.lastClosing?.closedAt ?? '';
  const payments = await db.payments.filter((p) => p.receivedAt > since).toArray();
  const nonCash = nonCashTotals(payments);
  const closing: CashClosing = {
    id: uid(),
    date: today,
    openingFils: st.opening,
    cashInFils: st.inFils,
    cashOutFils: st.outFils,
    expectedFils: st.expected,
    actualFils,
    diffFils: diff,
    comment: comment?.trim() || undefined,
    cardTotalFils: nonCash.card,
    transferTotalFils: nonCash.transfer,
    closedAt: nowIso(),
  };
  await db.transaction('rw', db.cashClosings, db.cashMovements, async () => {
    await db.cashClosings.add(closing);
    for (const m of st.movements) await db.cashMovements.update(m.id, { closingId: closing.id });
  });
  return closing;
}

// ---------- Expenses ----------

export interface ExpenseInput {
  date: string;
  categoryId: string;
  amountFils: number;
  vatFils: number;
  vendor?: string;
  method: PayMethod;
  orderId?: string;
  note?: string;
  overLimitComment?: string;
  receipt?: Blob;
}

export async function categoryMonthSpent(categoryId: string, month: string = monthKey()): Promise<number> {
  const list = await db.expenses.where('categoryId').equals(categoryId).filter((e) => e.date.startsWith(month)).toArray();
  return list.reduce((s, e) => s + e.amountFils, 0);
}

export async function addExpense(input: ExpenseInput): Promise<Expense> {
  if (!(input.amountFils > 0)) throw new AppError('err.amountRequired');
  const cat = await db.expenseCategories.get(input.categoryId);
  if (!cat) throw new AppError('err.categoryRequired');
  const spent = await categoryMonthSpent(cat.id, input.date.slice(0, 7));
  if (cat.monthlyLimitFils > 0 && spent + input.amountFils > cat.monthlyLimitFils && !input.overLimitComment?.trim()) {
    throw new AppError('err.overLimitComment');
  }
  const id = uid();
  let receiptMediaId: string | undefined;
  if (input.receipt) receiptMediaId = (await addMedia({ ownerType: 'expense', ownerId: id, slot: 'receipt', file: input.receipt })).id;
  const e: Expense = {
    id,
    date: input.date,
    categoryId: input.categoryId,
    amountFils: input.amountFils,
    vatFils: input.vatFils,
    vendor: input.vendor?.trim() || undefined,
    method: input.method,
    receiptMediaId,
    orderId: input.orderId,
    note: input.note?.trim() || undefined,
    overLimitComment: input.overLimitComment?.trim() || undefined,
    createdAt: nowIso(),
  };
  await db.transaction('rw', db.expenses, db.cashMovements, async () => {
    await db.expenses.add(e);
    if (e.method === 'cash') {
      await db.cashMovements.add({ id: uid(), at: e.createdAt, direction: 'out', amountFils: e.amountFils, reason: 'expense', expenseId: e.id, note: e.vendor ?? e.note });
    }
  });
  return e;
}

// ---------- Salaries ----------

export async function paySalary(input: { employeeId: string; month: string; kind: SalaryPayment['kind']; amountFils: number; method: PayMethod }): Promise<void> {
  if (!(input.amountFils > 0)) throw new AppError('err.amountRequired');
  const [emp, cat] = await Promise.all([db.employees.get(input.employeeId), db.expenseCategories.where('code').equals('salaries').first()]);
  if (!emp || !cat) throw new AppError('err.notFound');
  const expense = await addExpense({
    date: dubaiDate(),
    categoryId: cat.id,
    amountFils: input.amountFils,
    vatFils: 0,
    vendor: emp.name,
    method: input.method,
    note: `${input.kind} ${input.month}`,
  });
  await db.salaryPayments.add({ id: uid(), ...input, paidAt: nowIso(), expenseId: expense.id });
}

export type { CashMovement };
