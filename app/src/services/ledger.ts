import { db, uid } from '../db/db';
import { dubaiDate, nowIso } from '../domain/dates';
import { buildLedger, type LedgerResult } from '../domain/ledger';
import type { Expense, Income, IncomeCategory, PayMethod } from '../domain/types';
import { AppError } from './errors';
import { getSettings, saveSettings } from './settings';

/** The whole money book (both purses, running balances) from what the app has recorded. */
export async function loadLedger(): Promise<LedgerResult & { cashStartFils: number; cardStartFils: number; cashStartLocked: boolean }> {
  const [settings, payments, incomes, expenses, movements, closings, orders] = await Promise.all([
    getSettings(),
    db.payments.toArray(),
    db.incomes.toArray(),
    db.expenses.toArray(),
    db.cashMovements.toArray(),
    db.cashClosings.toArray(),
    db.orders.toArray(),
  ]);
  // Once a day was closed, the cash box counts from what was counted: the opening cash is the one that
  // closing started from (changing "Cash Start" later would no longer match the cash in the box).
  const first = [...closings].sort((a, b) => a.closedAt.localeCompare(b.closedAt))[0];
  const cashStartFils = first ? first.openingFils : settings.cashStartFils ?? 0;
  const cardStartFils = settings.cardStartFils ?? 0;
  return { ...buildLedger({ cashStartFils, cardStartFils, payments, incomes, expenses, movements, closings, orders }), cashStartFils, cardStartFils, cashStartLocked: !!first };
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
  category: IncomeCategory;
  amountFils: number;
  method: PayMethod;
  note?: string;
}

/** Money received without a job invoice: an item sold, a small job on the spot, other. */
export async function addIncome(input: IncomeInput): Promise<Income> {
  if (!(input.amountFils > 0)) throw new AppError('err.amountRequired');
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
  await db.transaction('rw', db.incomes, db.cashMovements, async () => {
    await db.incomes.add(income);
    if (income.method === 'cash') {
      await db.cashMovements.add({ id: uid(), at: now, direction: 'in', amountFils: income.amountFils, reason: 'income', incomeId: income.id, orderId: income.orderId, note: income.note });
    }
  });
  return income;
}

/** Change what an entry was for (job, car, customer, note, category); the money itself stays. */
export async function updateIncome(id: string, patch: Partial<Pick<Income, 'category' | 'note'>> & Links): Promise<void> {
  const links = 'orderId' in patch || 'vehicleId' in patch || 'customerId' in patch ? await resolveLinks(patch) : {};
  await db.incomes.update(id, { ...patch, ...links, note: patch.note?.trim() || undefined });
}

export async function updateExpense(id: string, patch: Partial<Pick<Expense, 'categoryId' | 'note' | 'vendor'>> & Links): Promise<void> {
  const links = 'orderId' in patch || 'vehicleId' in patch || 'customerId' in patch ? await resolveLinks(patch) : {};
  const clean: Partial<Expense> = { ...patch, ...links };
  if ('note' in patch) clean.note = patch.note?.trim() || undefined;
  if ('vendor' in patch) clean.vendor = patch.vendor?.trim() || undefined;
  await db.expenses.update(id, clean);
}

/**
 * Cancel an entry made by mistake. Nothing is deleted: the entry is marked cancelled and leaves the
 * book; if it was cash, the cash book gets the opposite movement, so the cash in the box still adds up.
 */
export async function voidIncome(id: string): Promise<void> {
  await db.transaction('rw', db.incomes, db.cashMovements, async () => {
    const i = await db.incomes.get(id);
    if (!i || i.voidedAt) return;
    const now = nowIso();
    await db.incomes.update(id, { voidedAt: now });
    if (i.method === 'cash') {
      await db.cashMovements.add({ id: uid(), at: now, direction: 'out', amountFils: i.amountFils, reason: 'adjustment', incomeId: id, note: i.note });
    }
  });
}

export async function voidExpense(id: string): Promise<void> {
  await db.transaction('rw', db.expenses, db.cashMovements, async () => {
    const e = await db.expenses.get(id);
    if (!e || e.voidedAt) return;
    const now = nowIso();
    await db.expenses.update(id, { voidedAt: now });
    if (e.method === 'cash') {
      await db.cashMovements.add({ id: uid(), at: now, direction: 'in', amountFils: e.amountFils, reason: 'adjustment', expenseId: id, note: e.vendor ?? e.note });
    }
  });
}

/** Income and expenses of one job, car or customer (cancelled ones left out). */
export async function moneyOf(link: { orderId?: string; vehicleId?: string; customerId?: string }): Promise<{ incomes: Income[]; expenses: Expense[] }> {
  const key = link.orderId ? 'orderId' : link.vehicleId ? 'vehicleId' : 'customerId';
  const value = link.orderId ?? link.vehicleId ?? link.customerId;
  if (!value) return { incomes: [], expenses: [] };
  const [incomes, expenses] = await Promise.all([db.incomes.where(key).equals(value).toArray(), db.expenses.where(key).equals(value).toArray()]);
  return { incomes: incomes.filter((i) => !i.voidedAt), expenses: expenses.filter((e) => !e.voidedAt) };
}
