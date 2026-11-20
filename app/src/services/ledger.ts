import { db, uid } from '../db/db';
import { dubaiDate, nowIso } from '../domain/dates';
import { owedIndex } from '../domain/debts';
import { buildLedger, type LedgerResult } from '../domain/ledger';
import type { Expense, Income, PayMethod } from '../domain/types';
import { placeInDay } from './cashDays';
import { addDebtPayment } from './debts';
import { AppError } from './errors';
import { getSettings, saveSettings } from './settings';

/** The whole money book (both purses, running balances) from what the app has recorded. */
export async function loadLedger(): Promise<LedgerResult & { cashStartFils: number; cardStartFils: number; cashStartLocked: boolean }> {
  const [settings, payments, incomes, expenses, movements, closings, orders, creditPayments] = await Promise.all([
    getSettings(),
    db.payments.toArray(),
    db.incomes.toArray(),
    db.expenses.toArray(),
    db.cashMovements.toArray(),
    db.cashClosings.toArray(),
    db.orders.toArray(),
    db.creditPayments.toArray(),
  ]);
  // Once a day was closed, the cash box counts from what was counted: the opening cash is the one that
  // closing started from (changing "Cash Start" later would no longer match the cash in the box).
  const first = [...closings].sort((a, b) => a.closedAt.localeCompare(b.closedAt))[0];
  const cashStartFils = first ? first.openingFils : settings.cashStartFils ?? 0;
  const cardStartFils = settings.cardStartFils ?? 0;
  // Whom the credits are owed to (v0.61): the people, and the suppliers the credits were bought from — only those (the
  // base has a thousand and more); a seller written by its name is named as written.
  const credits = expenses.filter((e) => e.method === 'credit');
  const supplierIds = [...new Set(credits.map((e) => e.supplierId).filter((id): id is string => !!id))];
  const [lenders, suppliers] = await Promise.all([credits.length ? db.lenders.toArray() : [], db.suppliers.bulkGet(supplierIds)]);
  const owed = owedIndex(suppliers.filter((s) => !!s), lenders);
  return { ...buildLedger({ cashStartFils, cardStartFils, payments, incomes, expenses, movements, closings, creditPayments, orders, owed }), cashStartFils, cardStartFils, cashStartLocked: !!first };
}

/** "Cash Start" and "Card Start": what was in the cash box and on the card when the book began. */
export async function setOpeningBalances(cashStartFils: number, cardStartFils: number): Promise<void> {
  if (cashStartFils < 0 || cardStartFils < 0) throw new AppError('err.amountRequired');
  await saveSettings({ cashStartFils, cardStartFils });
}

export interface Links {
  orderId?: string;
  vehicleId?: string;
  customerId?: string;
}

/** A job fills in its car and customer; a car without a customer fills in its owner. */
async function resolveLinks(l: Links): Promise<Links> {
  const out: Links = { ...l };
  if (l.orderId) {
    const o = await db.orders.get(l.orderId);
    if (!o) throw new AppError('err.notFound');
    out.vehicleId ??= o.vehicleId;
    out.customerId ??= o.customerId;
  }
  if (out.vehicleId && !out.customerId) out.customerId = (await db.vehicles.get(out.vehicleId))?.customerId;
  return { orderId: out.orderId || undefined, vehicleId: out.vehicleId || undefined, customerId: out.customerId || undefined };
}

export interface IncomeInput extends Links {
  date?: string;
  /** The code of an income category (`IncomeCategory.code`), or 'debt'. */
  category: string;
  amountFils: number;
  method: PayMethod;
  note?: string;
}

/**
 * Money received without a job invoice: an item sold, a small job on the spot, other. A customer's debt paid
 * ("debt") is spread over their jobs — `addDebtPayment`.
 */
export async function addIncome(input: IncomeInput): Promise<Income> {
  if (!(input.amountFils > 0)) throw new AppError('err.amountRequired');
  if (input.category === 'debt') return (await addDebtPayment({ amountFils: input.amountFils, method: input.method, customerId: input.customerId, orderId: input.orderId, date: input.date, note: input.note })).income;
  const links = await resolveLinks(input);
  const now = nowIso();
  const income: Income = {
    id: uid(),
    date: input.date ?? dubaiDate(),
    category: input.category,
    amountFils: input.amountFils,
    method: input.method,
    ...links,
    note: input.note?.trim() || undefined,
    createdAt: now,
  };
  const movementId = uid();
  await db.transaction('rw', db.incomes, db.cashMovements, async () => {
    await db.incomes.add(income);
    if (income.method === 'cash') {
      await db.cashMovements.add({ id: movementId, at: now, direction: 'in', amountFils: income.amountFils, reason: 'income', incomeId: income.id, orderId: income.orderId, note: income.note });
    }
  });
  // Taken on a day already counted: into that day's closing (the count had this money already).
  if (income.method === 'cash' && income.date !== dubaiDate(now)) await placeInDay(income.date, now, movementId);
  return income;
}

/**
 * Change what an entry was for (job, car, customer, note, category); the money itself stays. A debt payment
 * keeps its customer and stays a debt payment (its jobs' payments were made from it): only its note changes.
 */
export async function updateIncome(id: string, patch: Partial<Pick<Income, 'category' | 'note'>> & Links): Promise<void> {
  const income = await db.incomes.get(id);
  if (!income) throw new AppError('err.notFound');
  if (income.category === 'debt' || patch.category === 'debt') {
    if ('note' in patch) await db.incomes.update(id, { note: patch.note?.trim() || undefined });
    return;
  }
  const links = 'orderId' in patch || 'vehicleId' in patch || 'customerId' in patch ? await resolveLinks(patch) : {};
  const clean: Partial<Income> = { ...patch, ...links };
  if ('note' in patch) clean.note = patch.note?.trim() || undefined;
  await db.incomes.update(id, clean);
}

export async function updateExpense(id: string, patch: Partial<Pick<Expense, 'categoryId' | 'note' | 'vendor'>> & Links): Promise<void> {
  const links = 'orderId' in patch || 'vehicleId' in patch || 'customerId' in patch ? await resolveLinks(patch) : {};
  const clean: Partial<Expense> = { ...patch, ...links };
  if ('note' in patch) clean.note = patch.note?.trim() || undefined;
  if ('vendor' in patch) clean.vendor = patch.vendor?.trim() || undefined;
  await db.expenses.update(id, clean);
}

/** Income and expenses of one job, car or customer (cancelled ones left out). */
export async function moneyOf(link: { orderId?: string; vehicleId?: string; customerId?: string }): Promise<{ incomes: Income[]; expenses: Expense[] }> {
  const key = link.orderId ? 'orderId' : link.vehicleId ? 'vehicleId' : 'customerId';
  const value = link.orderId ?? link.vehicleId ?? link.customerId;
  if (!value) return { incomes: [], expenses: [] };
  const [incomes, expenses] = await Promise.all([db.incomes.where(key).equals(value).toArray(), db.expenses.where(key).equals(value).toArray()]);
  return { incomes: incomes.filter((i) => !i.voidedAt), expenses: expenses.filter((e) => !e.voidedAt) };
}
