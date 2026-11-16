import { db, uid } from '../db/db';
import { dubaiDate, nowIso, onDubaiDay } from '../domain/dates';
import { isCustomerDebt, orderDue } from '../domain/debts';
import { amountDue } from '../domain/invoice';
import { summarize } from '../domain/items';
import type { LedgerSource } from '../domain/ledger';
import type { CashClosing, CashMovement, CreditPayment, Expense, ExpenseMethod, Income, Media, PayMethod, Payment } from '../domain/types';
import { closingFor, closingOfPayment, recountClosing } from './cashDays';
import { AppError } from './errors';
import { settleIfPaid } from './money';
import { logEvent } from './orders';

/*
 * Every operation of the money book can be deleted, and its date, sum, way and note changed (v0.23 — the user's call:
 * «все операции, какими бы они ни были, можно удалять, менять дату и т. д.»). Before, money never changed: a mistake
 * was cancelled, and a cash one reversed in the cash box — the pairs that left («Расход −180», «Корректировка +180»)
 * are deleted here as one: a movement of an operation takes the operation with it, whole.
 *
 * A deletion takes the operation whole — its cash movements, its photos and what hangs on it: a debt payment's job
 * payments, an expense's payments of its credit and its salary payment; a contractor's line forgets it was paid.
 * "Undo" puts back what it took — each record only where what it hangs on is still there — and the few fields it
 * changed on records that stay, only where they are still as it left them; then everything that follows from them
 * is worked out again from what is there now (the day closings' figures, the jobs' debts), never written back.
 *
 * Jobs follow their payments: one that owes again has its signed debt open again; one paid in full now is settled as
 * after any payment; one closed without payment lets go of what is unpaid now. A day closing counted the cash: a
 * movement belongs to the closing made after its operation's moment (services/cashDays.ts); one that goes, changes or
 * moves leaves the count as it was and moves that day's difference — the book and the cash box always agree.
 * The screens never write these tables themselves: only through here (and the services that add money).
 */

export interface EntryRef {
  source: LedgerSource;
  id: string;
}

const KEPT = ['payments', 'incomes', 'expenses', 'creditPayments', 'cashMovements', 'cashClosings', 'salaryPayments', 'items', 'media', 'mediaBlobs'] as const;
type Kept = (typeof KEPT)[number];
type Rec = { id: string };
type Fields = Record<string, unknown>;

/** Fields a deletion changed on a record that stays: put back only where they are still as it left them. */
interface Change {
  table: Kept;
  id: string;
  before: Fields;
  after: Fields;
  /** Made by deleting this closing (its next closing's start). */
  of?: string;
}

/** A deletion as it was — for "Undo". */
export interface RemovedEntry {
  /** The records it took away, as they were. */
  gone: Partial<Record<Kept, Rec[]>>;
  changed: Change[];
  /** When each closing was made: a movement whose closing went since goes where that closing's movements went. */
  closedAt: Record<string, string>;
  /** The closings there were right after it (a closing it deleted comes back only into that same row). */
  closingsLeft: string[];
  /** The closing each deleted closing came after (none — the first): it comes back only after that one. */
  after: Record<string, string | undefined>;
  /** The closings whose figures it changed and the jobs whose payments went: worked out again after "Undo". */
  closings: string[];
  orders: string[];
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** What one change touches: what it took away and changed, the closings to count again, the jobs paid. */
class Touch {
  readonly gone = new Map<Kept, Map<string, Rec>>();
  readonly changed: Change[] = [];
  readonly closings = new Set<string>();
  readonly orders = new Set<string>();
  readonly after: Record<string, string | undefined> = {};

  async drop(t: Kept, rec: Rec) {
    let m = this.gone.get(t);
    if (!m) this.gone.set(t, (m = new Map()));
    if (m.has(rec.id)) return;
    m.set(rec.id, rec);
    await db.table(t).delete(rec.id);
  }

  async change(t: Kept, rec: Rec, patch: Fields, of?: string) {
    const was = rec as unknown as Fields;
    this.changed.push({ table: t, id: rec.id, before: Object.fromEntries(Object.keys(patch).map((k) => [k, was[k]])), after: patch, of });
    await db.table(t).update(rec.id, patch);
  }

  /** A closing whose figures follow (the one that holds a movement, or counted a job's card payment). */
  async dayOf(closingId: string | undefined) {
    if (closingId) this.closings.add(closingId);
  }

  async removed(): Promise<RemovedEntry> {
    const gone: RemovedEntry['gone'] = {};
    for (const [t, m] of this.gone) gone[t] = [...m.values()];
    const left = await db.cashClosings.toArray();
    const closedAt = Object.fromEntries(left.map((c) => [c.id, c.closedAt]));
    for (const c of (gone.cashClosings ?? []) as CashClosing[]) closedAt[c.id] = c.closedAt;
    return { gone, changed: this.changed, closedAt, closingsLeft: left.map((c) => c.id), after: this.after, closings: [...this.closings], orders: [...this.orders] };
  }
}

type LinkKey = 'paymentId' | 'incomeId' | 'expenseId' | 'creditPaymentId';
/** The cash movements an operation made: its own and, if it was cancelled, its reversal. */
const movementsOf = (key: LinkKey, id: string) => db.cashMovements.filter((m) => m[key] === id).toArray();
const linked = (m: CashMovement) => !!(m.paymentId || m.incomeId || m.expenseId || m.creditPaymentId);

async function takeMediaOf(t: Touch, ownerId: string) {
  for (const m of await db.media.where('ownerId').equals(ownerId).toArray()) {
    // A signed paper never hangs on money; were one there, it stays, as the database keeps it.
    if (m.locked) continue;
    const blob = await db.mediaBlobs.get(m.id);
    await t.drop('media', m);
    if (blob) await t.drop('mediaBlobs', blob);
  }
}

async function takeMovements(t: Touch, list: CashMovement[]) {
  for (const m of list) {
    await t.dayOf(m.closingId);
    await t.drop('cashMovements', m);
    await takeMediaOf(t, m.id);
  }
}

async function takePayment(t: Touch, p: Payment) {
  t.orders.add(p.orderId);
  // A card payment was in the card total of the day that counted it.
  await t.dayOf(await closingOfPayment(p));
  await t.drop('payments', p);
  await takeMediaOf(t, p.id);
  await takeMovements(t, await movementsOf('paymentId', p.id));
}

async function takeIncome(t: Touch, i: Income) {
  await t.drop('incomes', i);
  await takeMediaOf(t, i.id);
  await takeMovements(t, await movementsOf('incomeId', i.id));
  // A debt payment: the job payments it was spread into (and their refunds, had it been cancelled) go with it.
  for (const p of await db.payments.where('incomeId').equals(i.id).toArray()) await takePayment(t, p);
}

async function takeCredit(t: Touch, c: CreditPayment) {
  await t.drop('creditPayments', c);
  await takeMediaOf(t, c.id);
  await takeMovements(t, await movementsOf('creditPaymentId', c.id));
}

async function takeExpense(t: Touch, e: Expense) {
  await t.drop('expenses', e);
  await takeMediaOf(t, e.id);
  await takeMovements(t, await movementsOf('expenseId', e.id));
  // On credit: what was paid towards it goes too (it paid off this debt and nothing else).
  for (const c of await db.creditPayments.where('expenseId').equals(e.id).toArray()) await takeCredit(t, c);
  for (const s of await db.salaryPayments.filter((s) => s.expenseId === e.id).toArray()) await t.drop('salaryPayments', s);
  // A contractor paid from the job: its line is not paid any more («Платим» again).
  for (const it of await db.items.filter((i) => i.outsource?.expenseId === e.id).toArray()) {
    const outsource = { ...it.outsource! };
    delete outsource.expenseId;
    await t.change('items', it, { outsource });
  }
}

/** A closing deleted: its movements go to the next closing (that one counted them), or back to the open cash box. */
async function takeClosing(t: Touch, c: CashClosing) {
  const all = (await db.cashClosings.toArray()).sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  const next = all.find((x) => x.closedAt > c.closedAt);
  t.after[c.id] = all.filter((x) => x.closedAt < c.closedAt).at(-1)?.id;
  await t.drop('cashClosings', c);
  for (const m of await db.cashMovements.where('closingId').equals(c.id).toArray()) await t.change('cashMovements', m, { closingId: next?.id });
  if (next) {
    // It starts where the deleted one started; its figures (and card totals, a longer time now) follow.
    await t.change('cashClosings', next, { openingFils: c.openingFils }, c.id);
    await t.dayOf(next.id);
  }
}

async function takeRef(t: Touch, ref: EntryRef): Promise<void> {
  const gone = () => new AppError('err.notFound');
  switch (ref.source) {
    case 'expense': {
      const e = await db.expenses.get(ref.id);
      if (!e) throw gone();
      return takeExpense(t, e);
    }
    case 'income': {
      const i = await db.incomes.get(ref.id);
      if (!i) throw gone();
      return takeIncome(t, i);
    }
    case 'payment': {
      const p = await db.payments.get(ref.id);
      if (!p) throw gone();
      // A part of a debt payment: the money came in once — the income goes, with all its parts.
      const i = p.incomeId ? await db.incomes.get(p.incomeId) : undefined;
      return i ? takeIncome(t, i) : takePayment(t, p);
    }
    case 'credit': {
      const c = await db.creditPayments.get(ref.id);
      if (!c) throw gone();
      return takeCredit(t, c);
    }
    case 'closing': {
      const c = await db.cashClosings.get(ref.id);
      if (!c) throw gone();
      return takeClosing(t, c);
    }
    case 'movement': {
      const m = await db.cashMovements.get(ref.id);
      if (!m) throw gone();
      // A movement of an operation (a cancelled one's reversal too) takes the operation, whole.
      if (m.paymentId && (await db.payments.get(m.paymentId))) return takeRef(t, { source: 'payment', id: m.paymentId });
      if (m.incomeId && (await db.incomes.get(m.incomeId))) return takeRef(t, { source: 'income', id: m.incomeId });
      if (m.expenseId && (await db.expenses.get(m.expenseId))) return takeRef(t, { source: 'expense', id: m.expenseId });
      if (m.creditPaymentId && (await db.creditPayments.get(m.creditPaymentId))) return takeRef(t, { source: 'credit', id: m.creditPaymentId });
      return takeMovements(t, [m]);
    }
  }
}

/**
 * Jobs whose payments changed: one closed without payment lets go of what is unpaid now; one gone that owes again is
 * a debt again — its signed debt open again, and a closed one back to «Выдана» (the board's «Долг», «Сегодня», «Оплата»
 * on the job). (One paid in full now is settled after the transaction — `settleIfPaid`: closed again.)
 */
async function resettle(orderIds: Iterable<string>) {
  for (const id of orderIds) {
    const order = await db.orders.get(id);
    if (!order) continue;
    const [items, invoices, payments, debts] = await Promise.all([
      db.items.where('orderId').equals(id).toArray(),
      db.invoices.where('orderId').equals(id).toArray(),
      db.payments.where('orderId').equals(id).toArray(),
      db.debts.where('orderId').equals(id).toArray(),
    ]);
    if (order.waived) {
      const unpaid = Math.max(0, amountDue(summarize(items).approvedGross, invoices, payments));
      if (unpaid !== order.waived.fils) await db.orders.update(id, { waived: { ...order.waived, fils: unpaid } });
      continue;
    }
    if (!isCustomerDebt(order, orderDue(order, items, invoices, payments))) continue;
    if (order.stage === 'closed') {
      const now = nowIso();
      await db.orders.update(id, { stage: 'delivered', stageChangedAt: now, updatedAt: now });
      await logEvent(id, 'stage', { from: 'closed', to: 'delivered', reason: 'payment' });
    }
    if (debts.some((d) => d.status === 'open')) continue;
    const paid = debts.filter((d) => d.status === 'paid').sort((a, b) => b.signedAt.localeCompare(a.signedAt))[0];
    if (paid) await db.debts.update(paid.id, { status: 'open' });
  }
}

/** After money changed: the closings' figures, the jobs' debts — from what is there now. */
async function followUp(closings: Iterable<string>, orders: Iterable<string>) {
  for (const id of closings) await recountClosing(id);
  await resettle(orders);
}

/** Delete an operation of the money book — whatever it is, with everything that hangs on it. Returns it for "Undo". */
export async function removeEntry(ref: EntryRef): Promise<RemovedEntry> {
  const t = new Touch();
  let removed: RemovedEntry | undefined;
  await db.transaction('rw', db.tables, async () => {
    await takeRef(t, ref);
    await followUp(t.closings, t.orders);
    removed = await t.removed();
  });
  // A refund gone may leave a job paid in full: settled as after any payment.
  for (const id of t.orders) await settleIfPaid(id);
  return removed!;
}

/** What a record hangs on — "Undo" puts it back only where that is still there (or comes back with it). */
function parentOf(table: Kept, rec: Rec): [Kept, string][] {
  const r = rec as unknown as Record<string, string | undefined>;
  switch (table) {
    case 'payments':
      return r.incomeId ? [['incomes', r.incomeId]] : [];
    case 'creditPayments':
    case 'salaryPayments':
      return r.expenseId ? [['expenses', r.expenseId]] : [];
    case 'cashMovements':
      if (r.paymentId) return [['payments', r.paymentId]];
      if (r.incomeId) return [['incomes', r.incomeId]];
      if (r.expenseId) return [['expenses', r.expenseId]];
      if (r.creditPaymentId) return [['creditPayments', r.creditPaymentId]];
      return [];
    case 'mediaBlobs':
      return [['media', rec.id]];
    default:
      return [];
  }
}
const OWNERS: Kept[] = ['payments', 'incomes', 'expenses', 'creditPayments', 'cashMovements'];

/**
 * "Undo": what the deletion took comes back — each record only where what it hangs on is still there; the fields it
 * changed come back only where they are still as it left them; the closings' figures and the jobs' debts are worked out
 * again from what is there now (a closing deleted since: its movements went to the next one — so do these).
 */
export async function restoreEntry(r: RemovedEntry): Promise<void> {
  const orders = new Set(r.orders);
  const closings = new Set(r.closings);
  await db.transaction('rw', db.tables, async () => {
    const back = new Map<Kept, Map<string, Rec>>(KEPT.map((k) => [k, new Map((r.gone[k] ?? []).map((x) => [x.id, x]))]));
    const there = async (t: Kept, id: string) => back.get(t)!.has(id) || !!(await db.table(t).get(id));
    const unchanged = async (c: Change) => {
      const rec = (await db.table(c.table).get(c.id)) as Fields | undefined;
      return !!rec && Object.keys(c.after).every((f) => same(rec[f], c.after[f]));
    };
    // A closing deleted comes back only into the row of closings it left — each starts where the one before ended:
    // after the same closing as before, still ending where it starts; none made after it since; its next one still
    // starting where it was left (else the book and the cash box part).
    const skip = new Set<Change>();
    const cashStart = (await db.settings.get('main'))?.cashStartFils ?? 0;
    for (const c of [...back.get('cashClosings')!.values()] as CashClosing[]) {
      const all = await db.cashClosings.toArray();
      const later = all.filter((x) => x.closedAt > c.closedAt);
      const before = all.filter((x) => x.closedAt < c.closedAt).sort((a, b) => a.closedAt.localeCompare(b.closedAt)).at(-1);
      const starts = r.changed.filter((x) => x.of === c.id);
      let ok = later.every((x) => r.closingsLeft.includes(x.id)) && before?.id === r.after?.[c.id] && (before ? before.actualFils : cashStart) === c.openingFils;
      for (const x of starts) if (!(await unchanged(x))) ok = false;
      if (ok) continue;
      back.get('cashClosings')!.delete(c.id);
      for (const x of r.changed) if (x.of === c.id || (x.table === 'cashMovements' && x.before.closingId === c.id)) skip.add(x);
    }
    // A payment of a credit only while its debt still takes it: on credit, and no more paid than it is.
    const paidOf = new Map<string, number>();
    for (const c of ([...back.get('creditPayments')!.values()] as CreditPayment[]).sort((a, b) => a.paidAt.localeCompare(b.paidAt))) {
      const e = (back.get('expenses')!.get(c.expenseId) as Expense | undefined) ?? (await db.expenses.get(c.expenseId));
      if (!paidOf.has(c.expenseId)) paidOf.set(c.expenseId, (await db.creditPayments.where('expenseId').equals(c.expenseId).toArray()).filter((x) => !x.voidedAt && !back.get('creditPayments')!.has(x.id)).reduce((s, x) => s + x.amountFils, 0));
      const sum = paidOf.get(c.expenseId)! + (c.voidedAt ? 0 : c.amountFils);
      if (!e || e.voidedAt || e.method !== 'credit' || sum > e.amountFils) back.get('creditPayments')!.delete(c.id);
      else paidOf.set(c.expenseId, sum);
    }
    // Children whose parent is gone for good stay gone (a payment of a debt payment deleted since, …) — until none drop.
    for (let dropped = true; dropped; ) {
      dropped = false;
      for (const k of KEPT) {
        for (const [id, rec] of back.get(k)!) {
          let keep = true;
          for (const [pt, pid] of parentOf(k, rec)) if (!(await there(pt, pid))) keep = false;
          if (k === 'payments' && !(await db.orders.get((rec as Payment).orderId))) keep = false;
          if (k === 'media') {
            const owner = (rec as Media).ownerId;
            let found = false;
            for (const o of OWNERS) if (back.get(o)!.has(owner) || (await db.table(o).get(owner))) found = true;
            keep = found;
          }
          if (!keep) {
            back.get(k)!.delete(id);
            dropped = true;
          }
        }
      }
    }
    // A movement's closing deleted since: its movements went to the next closing (or the open cash box) — so does it.
    const counts = [...(await db.cashClosings.toArray()), ...(back.get('cashClosings')!.values() as Iterable<CashClosing>)];
    const madeSince = counts.filter((c) => !r.closingsLeft.includes(c.id) && !back.get('cashClosings')!.has(c.id)).sort((a, b) => a.closedAt.localeCompare(b.closedAt))[0];
    for (const m of [...back.get('cashMovements')!.values()] as CashMovement[]) {
      // Open when it went: a closing made since took all the open cash box — so it takes this one (as if it had stayed).
      if (!m.closingId) {
        if (madeSince) back.get('cashMovements')!.set(m.id, { ...m, closingId: madeSince.id } as Rec);
        continue;
      }
      if (await there('cashClosings', m.closingId)) continue;
      const at = r.closedAt[m.closingId] ?? '';
      const next = counts.filter((c) => c.closedAt > at).sort((a, b) => a.closedAt.localeCompare(b.closedAt))[0];
      back.get('cashMovements')!.set(m.id, { ...m, closingId: next?.id } as Rec);
    }
    for (const k of KEPT) {
      const list = [...back.get(k)!.values()];
      if (list.length) await db.table(k).bulkPut(list);
    }
    for (const c of r.changed) if (!skip.has(c) && (await unchanged(c))) await db.table(c.table).update(c.id, c.before);
    for (const m of back.get('cashMovements')!.values() as Iterable<CashMovement>) if (m.closingId) closings.add(m.closingId);
    for (const c of r.changed) if (c.table === 'cashClosings') closings.add(c.id);
    for (const c of back.get('cashClosings')!.keys()) closings.add(c);
    for (const p of back.get('payments')!.values() as Iterable<Payment>) {
      orders.add(p.orderId);
      const day = await closingOfPayment(p);
      if (day) closings.add(day);
    }
    await followUp(closings, orders);
  });
  for (const id of orders) await settleIfPaid(id);
}

export interface EntryPatch {
  /** YYYY-MM-DD (Dubai). */
  date?: string;
  amountFils?: number;
  /** How it was paid; "credit" only for an expense — nothing paid yet, the garage owes it. */
  method?: ExpenseMethod;
  /** The note (a job payment's: its reference). */
  note?: string;
}

const clean = (s?: string) => s?.trim() || undefined;

/**
 * The cash movement of an operation as the operation now is: paid in cash — one movement of its sum; any other way —
 * none. A new one is made only for an operation that has just become cash (one paid in cash before the cash box kept
 * it has none, and gets none). A new one — or one whose operation moved to another day — belongs to the closing made
 * after the operation's moment; any movement of a closed day that changes or goes moves that day's figures. `at`
 * places it in the cash box only for a job's payment (the others stand on their own date).
 */
async function syncCash(
  t: Touch,
  key: LinkKey,
  id: string,
  want: Omit<CashMovement, 'id'> | null,
  opts: { becameCash: boolean; day: string; typedAt: string; dayMoved: boolean; placeByAt?: boolean },
) {
  const had = await movementsOf(key, id);
  if (!want) {
    for (const m of had) {
      await t.dayOf(m.closingId);
      await db.cashMovements.delete(m.id);
    }
    return;
  }
  const m = had[0];
  if (!m) {
    if (!opts.becameCash) return;
    const closingId = await closingFor(opts.day, opts.typedAt);
    await db.cashMovements.add({ ...want, id: uid(), closingId });
    await t.dayOf(closingId);
    return;
  }
  const next: Partial<CashMovement> = { amountFils: want.amountFils, direction: want.direction, note: want.note };
  if (opts.placeByAt) next.at = want.at;
  if (opts.dayMoved) {
    const closingId = await closingFor(opts.day, opts.typedAt);
    if (closingId !== m.closingId) next.closingId = closingId;
    await t.dayOf(closingId);
  }
  await t.dayOf(m.closingId);
  await db.cashMovements.update(m.id, next);
}

const nameOf = (c?: { type: string; companyName?: string; name: string }) => (c ? (c.type === 'company' && c.companyName ? c.companyName : c.name) : '');

/**
 * A job payment moved to another day: the same time of day on it (today — not later than now) — and, moved to today,
 * typed now (counted by the next count); moved to an earlier day — counted by that day's count (services/cashDays.ts).
 */
function movedPayment(p: Pick<Payment, 'receivedAt' | 'typedAt'>, day: string): Pick<Payment, 'receivedAt' | 'typedAt'> {
  if (day === dubaiDate(p.receivedAt)) return { receivedAt: p.receivedAt, typedAt: p.typedAt };
  const now = nowIso();
  if (day >= dubaiDate(now)) {
    const at = onDubaiDay(p.receivedAt, day);
    return { receivedAt: at < now ? at : now, typedAt: now };
  }
  return { receivedAt: onDubaiDay(p.receivedAt, day), typedAt: p.typedAt ?? p.receivedAt };
}

/**
 * Change an operation: its date, sum, way of payment, note — whatever it is (a job's payment, money in or out, a payment
 * of a credit, a movement of the cash box). Its cash movement follows; a job paid or owing again settles as it does
 * after a payment. A debt payment keeps its sum (its jobs were paid from it: delete it and take it again), and a
 * cancelled operation is only deleted.
 */
export async function updateEntry(ref: EntryRef, patch: EntryPatch): Promise<void> {
  if (patch.amountFils !== undefined && !(patch.amountFils > 0)) throw new AppError('err.amountRequired');
  if (patch.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) throw new AppError('err.notFound');
  if (patch.date !== undefined && patch.date > dubaiDate()) throw new AppError('err.futureDate');
  const t = new Touch();
  await db.transaction('rw', db.tables, async () => {
    const gone = () => new AppError('err.notFound');
    switch (ref.source) {
      case 'expense': {
        const e = await db.expenses.get(ref.id);
        if (!e || e.voidedAt) throw gone();
        const method = patch.method ?? e.method;
        const amountFils = patch.amountFils ?? e.amountFils;
        const date = patch.date ?? e.date;
        if (method !== e.method || amountFils !== e.amountFils) {
          const paid = (await db.creditPayments.where('expenseId').equals(e.id).toArray()).filter((c) => !c.voidedAt);
          if (e.method === 'credit' && method !== 'credit' && paid.length) throw new AppError('err.creditPaid');
          if (method === 'credit' && paid.reduce((s, c) => s + c.amountFils, 0) > amountFils) throw new AppError('err.belowPaid');
        }
        const note = patch.note !== undefined ? clean(patch.note) : e.note;
        // The seller's VAT was a part of the sum: a new sum carries its share.
        const vatFils = amountFils === e.amountFils || !e.vatFils ? e.vatFils : Math.round((e.vatFils * amountFils) / e.amountFils);
        await db.expenses.update(e.id, { date, amountFils, vatFils, method, note });
        await syncCash(t, 'expenseId', e.id, method === 'cash' ? { at: e.createdAt, direction: 'out', amountFils, reason: 'expense', expenseId: e.id, note: e.vendor ?? note } : null, {
          becameCash: e.method !== 'cash',
          day: date,
          typedAt: e.createdAt,
          dayMoved: date !== e.date,
        });
        for (const s of await db.salaryPayments.filter((s) => s.expenseId === e.id).toArray()) {
          await db.salaryPayments.update(s.id, method === 'credit' ? { amountFils } : { amountFils, method });
        }
        // A contractor paid by it: the line's cost is what was paid.
        if (amountFils !== e.amountFils) {
          for (const it of await db.items.filter((i) => i.outsource?.expenseId === e.id).toArray()) {
            await db.items.update(it.id, { costPriceFils: Math.round(amountFils / (it.qty || 1)) });
          }
        }
        break;
      }
      case 'income': {
        const i = await db.incomes.get(ref.id);
        if (!i || i.voidedAt || patch.method === 'credit') throw gone();
        const debt = i.category === 'debt';
        const amountFils = patch.amountFils ?? i.amountFils;
        if (debt && amountFils !== i.amountFils) throw new AppError('err.debtPaymentAmount');
        const method = (patch.method as PayMethod | undefined) ?? i.method;
        const date = patch.date ?? i.date;
        const note = patch.note !== undefined ? clean(patch.note) : i.note;
        await db.incomes.update(i.id, { date, amountFils, method, note });
        const who = debt && i.customerId ? nameOf(await db.customers.get(i.customerId)) : '';
        const reason = debt ? 'debt_payment' : 'income';
        await syncCash(
          t,
          'incomeId',
          i.id,
          method === 'cash' ? { at: i.createdAt, direction: 'in', amountFils, reason, incomeId: i.id, orderId: i.orderId, note: debt ? [who, note].filter(Boolean).join(' · ') || undefined : note } : null,
          { becameCash: i.method !== 'cash', day: date, typedAt: i.createdAt, dayMoved: date !== i.date },
        );
        // Its jobs were paid on its day and by its way (a card one — in the card total of the day that counted it).
        for (const p of debt ? await db.payments.where('incomeId').equals(i.id).toArray() : []) {
          const moved = date === i.date ? { receivedAt: p.receivedAt, typedAt: p.typedAt } : movedPayment(p, date);
          await t.dayOf(await closingOfPayment(p));
          await t.dayOf(await closingOfPayment(moved));
          await db.payments.update(p.id, { method, ...moved });
        }
        break;
      }
      case 'payment': {
        const p = await db.payments.get(ref.id);
        // A part of a debt payment changes with its income.
        if (!p || p.incomeId || patch.method === 'credit') throw gone();
        const method = (patch.method as PayMethod | undefined) ?? p.method;
        const amountFils = patch.amountFils ?? p.amountFils;
        const moved = patch.date ? movedPayment(p, patch.date) : { receivedAt: p.receivedAt, typedAt: p.typedAt };
        const receivedAt = moved.receivedAt;
        const reference = patch.note !== undefined ? clean(patch.note) : p.reference;
        await db.payments.update(p.id, { method, amountFils, ...moved, reference });
        const reason = p.kind === 'refund' ? 'refund' : p.kind === 'prepayment' ? 'prepayment' : 'order_payment';
        await syncCash(t, 'paymentId', p.id, method === 'cash' ? { at: receivedAt, direction: p.kind === 'refund' ? 'out' : 'in', amountFils, reason, orderId: p.orderId, paymentId: p.id } : null, {
          becameCash: p.method !== 'cash',
          day: dubaiDate(receivedAt),
          typedAt: moved.typedAt ?? receivedAt,
          dayMoved: receivedAt !== p.receivedAt,
          placeByAt: true,
        });
        await t.dayOf(await closingOfPayment(p));
        await t.dayOf(await closingOfPayment(moved));
        t.orders.add(p.orderId);
        break;
      }
      case 'credit': {
        const c = await db.creditPayments.get(ref.id);
        const e = c ? await db.expenses.get(c.expenseId) : undefined;
        if (!c || !e || c.voidedAt || patch.method === 'credit') throw gone();
        const amountFils = patch.amountFils ?? c.amountFils;
        if (amountFils !== c.amountFils) {
          const others = (await db.creditPayments.where('expenseId').equals(e.id).toArray()).filter((x) => !x.voidedAt && x.id !== c.id).reduce((s, x) => s + x.amountFils, 0);
          if (others + amountFils > e.amountFils) throw new AppError('err.creditOver');
        }
        const method = (patch.method as PayMethod | undefined) ?? c.method;
        const date = patch.date ?? c.date;
        const note = patch.note !== undefined ? clean(patch.note) : c.note;
        await db.creditPayments.update(c.id, { method, amountFils, date, note });
        await syncCash(
          t,
          'creditPaymentId',
          c.id,
          method === 'cash' ? { at: c.paidAt, direction: 'out', amountFils, reason: 'credit_payment', creditPaymentId: c.id, orderId: e.orderId, note: [e.vendor, note ?? e.note].filter(Boolean).join(' · ') || undefined } : null,
          { becameCash: c.method !== 'cash', day: date, typedAt: c.paidAt, dayMoved: date !== c.date },
        );
        break;
      }
      case 'movement': {
        const m = await db.cashMovements.get(ref.id);
        // A movement of an operation changes with it; a cash one stays cash.
        if (!m || linked(m) || (patch.method && patch.method !== 'cash')) throw gone();
        const amountFils = patch.amountFils ?? m.amountFils;
        const note = patch.note !== undefined ? clean(patch.note) : m.note;
        if (!note && (m.reason === 'other' || m.reason === 'adjustment' || m.reason === 'collection')) throw new AppError('err.reasonRequired');
        // Moved: the same time of day (today — not later than now); counted by that day's count.
        const now = nowIso();
        const moved = patch.date && patch.date !== dubaiDate(m.at) ? onDubaiDay(m.at, patch.date) : m.at;
        const at = moved > now ? now : moved;
        const next: Partial<CashMovement> = { amountFils, at, note };
        if (at !== m.at) {
          const closingId = await closingFor(dubaiDate(at), m.at);
          if (closingId !== m.closingId) next.closingId = closingId;
          await t.dayOf(closingId);
        }
        await t.dayOf(m.closingId);
        await db.cashMovements.update(m.id, next);
        break;
      }
      default:
        throw gone();
    }
    await followUp(t.closings, t.orders);
  });
  // Paid in full now: the job settles as after any payment (its debt paid; a car already gone — closed).
  for (const id of t.orders) await settleIfPaid(id);
}
