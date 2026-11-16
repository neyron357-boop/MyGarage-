import { db, nextNumber, uid } from '../db/db';
import { dubaiDate, nowIso } from '../domain/dates';
import { allocate, creditLeft, groupDebts, isCustomerDebt, orderDue, type DebtJob, type DebtShare, type Debtor } from '../domain/debts';
import { activeInvoice, formatDocNumber } from '../domain/invoice';
import type { CreditPayment, Customer, Expense, Income, OrderItem, PayMethod, Payment, Vehicle } from '../domain/types';
import { AppError } from './errors';
import { placeInDay } from './cashDays';
import { settleIfPaid } from './money';
import { logEvent } from './orders';

/*
 * Who owes whom (v0.20).
 *
 * Customers: every job whose car has left with money still due — one list behind the board's "Debts" and
 * "Money → Debts", counted as the job itself counts it (domain/debts.ts). A debt is paid on the job (its payment
 * sheet) or at once for the customer: "Debt payment" — one income, so one movement of money, spread over the
 * customer's jobs as their payments.
 *
 * The garage: an expense taken on credit — counted once, as an expense; what is paid towards it moves money when
 * it is paid, by the way it is paid.
 */

function groupBy<T extends { orderId: string }>(list: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const had = m.get(x.orderId);
    if (had) had.push(x);
    else m.set(x.orderId, [x]);
  }
  return m;
}

/** The jobs gone with money due (of one customer, when asked). */
export async function loadDebtJobs(customerId?: string): Promise<DebtJob[]> {
  const gone = customerId
    ? (await db.orders.where('customerId').equals(customerId).toArray()).filter((o) => o.stage === 'delivered' || o.stage === 'closed')
    : await db.orders.where('stage').anyOf('delivered', 'closed').toArray();
  // Nothing is owed on history carried over or on a job closed without payment: not looked into.
  const orders = gone.filter((o) => !o.imported?.history && !o.waived);
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const [invoices, payments, debts] = await Promise.all([
    db.invoices.where('orderId').anyOf(ids).toArray().then(groupBy),
    db.payments.where('orderId').anyOf(ids).toArray().then(groupBy),
    db.debts.where('orderId').anyOf(ids).toArray().then(groupBy),
  ]);
  // The lines are needed only where no invoice counts (the agreed lines are what is owed then).
  const bare = ids.filter((id) => !activeInvoice(invoices.get(id) ?? []));
  const items = bare.length ? groupBy<OrderItem>(await db.items.where('orderId').anyOf(bare).toArray()) : new Map<string, OrderItem[]>();
  const found = orders.flatMap((order) => {
    const inv = invoices.get(order.id) ?? [];
    const dueFils = orderDue(order, items.get(order.id) ?? [], inv, payments.get(order.id) ?? []);
    if (!isCustomerDebt(order, dueFils)) return [];
    const signed = (debts.get(order.id) ?? []).filter((d) => d.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    return [{ order, dueFils, since: activeInvoice(inv)?.issuedAt ?? order.deliveredAt ?? order.closedAt ?? order.createdAt, dueDate: signed?.dueDate }];
  });
  if (!found.length) return [];
  const [customers, vehicles] = await Promise.all([
    db.customers.bulkGet([...new Set(found.map((f) => f.order.customerId))]),
    db.vehicles.bulkGet([...new Set(found.map((f) => f.order.vehicleId))]),
  ]);
  const customerBy = new Map(customers.filter((c): c is Customer => !!c).map((c) => [c.id, c]));
  const vehicleBy = new Map(vehicles.filter((v): v is Vehicle => !!v).map((v) => [v.id, v]));
  return found.flatMap((f) => {
    const customer = customerBy.get(f.order.customerId);
    const vehicle = vehicleBy.get(f.order.vehicleId);
    return customer && vehicle ? [{ ...f, customer, vehicle }] : [];
  });
}

/** The debts as one card per customer, whoever owes most first. */
export async function loadDebtors(): Promise<Debtor[]> {
  return groupDebts(await loadDebtJobs());
}

export interface DebtPaymentInput {
  amountFils: number;
  method: PayMethod;
  /** Whose debt it is; none — money in with no debt to it. */
  customerId?: string;
  /** The job to pay off first (then the oldest). */
  orderId?: string;
  date?: string;
  note?: string;
}

const receiptYear = () => Number(dubaiDate().slice(0, 4));

/**
 * Money received towards a customer's debts: any sum, a part of a debt too. One income — one movement of money
 * (cash: the cash box grows by the whole sum) — spread over the customer's jobs, the oldest first or the job picked
 * first; each job gets a payment of its own that carries the income's id (a receipt, the journal, the job closed
 * when nothing is due any more). What is not owed by anyone — no customer picked, or more than they owe — stays
 * in the income as money in with no debt to it.
 */
export async function addDebtPayment(input: DebtPaymentInput): Promise<{ income: Income; parts: DebtShare[]; restFils: number }> {
  if (!(input.amountFils > 0)) throw new AppError('err.amountRequired');
  const customer = input.customerId ? await db.customers.get(input.customerId) : undefined;
  if (input.customerId && !customer) throw new AppError('err.notFound');
  const debts = customer ? await loadDebtJobs(customer.id) : [];
  const { parts, restFils } = allocate(
    input.amountFils,
    debts.map((d) => ({ orderId: d.order.id, dueFils: d.dueFils, since: d.since })),
    input.orderId,
  );
  const now = nowIso();
  const date = input.date ?? dubaiDate();
  // Typed for an earlier day: the jobs' payments stand on that day too (noon in Dubai).
  const receivedAt = date === dubaiDate() ? now : `${date}T08:00:00.000Z`;
  const who = customer ? (customer.type === 'company' && customer.companyName ? customer.companyName : customer.name) : '';
  const income: Income = {
    id: uid(),
    date,
    category: 'debt',
    amountFils: input.amountFils,
    method: input.method,
    customerId: customer?.id,
    note: input.note?.trim() || undefined,
    createdAt: now,
  };
  const movementId = uid();
  await db.transaction('rw', [db.incomes, db.cashMovements, db.payments, db.counters, db.events], async () => {
    await db.incomes.add(income);
    if (income.method === 'cash') {
      await db.cashMovements.add({ id: movementId, at: now, direction: 'in', amountFils: income.amountFils, reason: 'debt_payment', incomeId: income.id, note: [who, income.note].filter(Boolean).join(' · ') || undefined });
    }
    for (const part of parts) {
      const n = await nextNumber(`receipt-${receiptYear()}`);
      const p: Payment = {
        id: uid(),
        orderId: part.orderId,
        customerId: customer!.id,
        kind: 'payment',
        method: income.method,
        amountFils: part.amountFils,
        receiptNumber: formatDocNumber('RC', receiptYear(), n),
        receivedAt,
        typedAt: now,
        incomeId: income.id,
      };
      await db.payments.add(p);
      await logEvent(part.orderId, 'payment', { kind: p.kind, method: p.method, amount: p.amountFils, receipt: p.receiptNumber, debt: true });
    }
  });
  // Taken on a day already counted: the cash into that day's closing; its jobs' card payments in that day's card total.
  if (date !== dubaiDate(now)) await placeInDay(date, now, income.method === 'cash' ? movementId : undefined);
  for (const part of parts) await settleIfPaid(part.orderId);
  return { income, parts, restFils };
}

/** The jobs a "debt payment" went to, with what each got (a cancelled one — nothing). */
export async function debtPaymentParts(incomeId: string): Promise<DebtShare[]> {
  const by = new Map<string, number>();
  for (const p of await db.payments.where('incomeId').equals(incomeId).toArray()) by.set(p.orderId, (by.get(p.orderId) ?? 0) + (p.kind === 'refund' ? -p.amountFils : p.amountFils));
  return [...by.entries()].filter(([, amountFils]) => amountFils > 0).map(([orderId, amountFils]) => ({ orderId, amountFils }));
}

/* ---------------- The garage's own debts: expenses taken on credit ---------------- */

export interface CompanyDebt {
  expense: Expense;
  /** What was paid towards it (cancelled payments left out), oldest first. */
  paid: CreditPayment[];
  leftFils: number;
}

/** What was paid towards expenses on credit, by expense (cancelled payments left out). */
async function creditPaid(expenseIds: string[]): Promise<Map<string, CreditPayment[]>> {
  const by = new Map<string, CreditPayment[]>();
  if (!expenseIds.length) return by;
  const list = await db.creditPayments.where('expenseId').anyOf(expenseIds).sortBy('paidAt');
  for (const p of list) {
    if (p.voidedAt) continue;
    const had = by.get(p.expenseId);
    if (had) had.push(p);
    else by.set(p.expenseId, [p]);
  }
  return by;
}

/** One expense on credit with what is still owed on it (undefined — not on credit, cancelled or gone). */
export async function companyDebtOf(expenseId: string): Promise<CompanyDebt | undefined> {
  const expense = await db.expenses.get(expenseId);
  if (!expense || expense.voidedAt || expense.method !== 'credit') return undefined;
  const paid = (await creditPaid([expenseId])).get(expenseId) ?? [];
  return { expense, paid, leftFils: creditLeft(expense, paid) };
}

/** Every expense on credit (paid off ones too), the one owing most first. */
export async function loadCredits(): Promise<CompanyDebt[]> {
  const expenses = await db.expenses.filter((e) => e.method === 'credit' && !e.voidedAt).toArray();
  const paid = await creditPaid(expenses.map((e) => e.id));
  return expenses
    .map((expense) => ({ expense, paid: paid.get(expense.id) ?? [], leftFils: creditLeft(expense, paid.get(expense.id) ?? []) }))
    .sort((a, b) => b.leftFils - a.leftFils || a.expense.date.localeCompare(b.expense.date));
}

/** What the garage still owes: the expenses on credit not paid off yet. */
export async function loadCompanyDebts(): Promise<CompanyDebt[]> {
  return (await loadCredits()).filter((d) => d.leftFils > 0);
}

/**
 * Pay towards an expense on credit — all of it or a part. The money moves now and by the way it is paid (cash:
 * out of the cash box); the expense itself is not counted again.
 */
export async function payCredit(expenseId: string, input: { amountFils: number; method: PayMethod; date?: string; note?: string }): Promise<CreditPayment> {
  if (!(input.amountFils > 0)) throw new AppError('err.amountRequired');
  const now = nowIso();
  const movementId = uid();
  const paid = await db.transaction('rw', db.expenses, db.creditPayments, db.cashMovements, async () => {
    const debt = await companyDebtOf(expenseId);
    if (!debt) throw new AppError('err.notFound');
    if (input.amountFils > debt.leftFils) throw new AppError('err.creditOver');
    const p: CreditPayment = { id: uid(), expenseId, method: input.method, amountFils: input.amountFils, date: input.date ?? dubaiDate(), paidAt: now, note: input.note?.trim() || undefined };
    await db.creditPayments.add(p);
    if (p.method === 'cash') {
      const e = debt.expense;
      await db.cashMovements.add({ id: movementId, at: now, direction: 'out', amountFils: p.amountFils, reason: 'credit_payment', creditPaymentId: p.id, orderId: e.orderId, note: [e.vendor, p.note ?? e.note].filter(Boolean).join(' · ') || undefined });
    }
    return p;
  });
  // Paid on a day already counted (v0.23: the day is picked): into that day's closing — the count had it gone already.
  if (paid.method === 'cash' && paid.date !== dubaiDate(now)) await placeInDay(paid.date, now, movementId);
  return paid;
}

export type { DebtJob, Debtor };
