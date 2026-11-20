import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { owedIndex, owedToOf, type OwedTo } from '../domain/debts';
import { findOwed, recentOwed, sameLender, type OwedPick } from '../domain/lenders';
import { normalizePhone } from '../domain/phone';
import type { Expense, Lender } from '../domain/types';
import { AppError } from './errors';

/*
 * Whom the garage owes for an expense on credit (v0.61): a person who paid for it (the list `lenders`), a supplier of
 * the base, or the seller as written (domain/lenders.ts). The expense keeps it: `lenderId` for a person; a supplier or
 * a seller is the expense's own seller (`supplierId`, `vendor`) — the one who gave the goods on credit.
 */

/** The name and phone as kept: the name without extra spaces (one is needed), the phone in E.164 ('' — none). */
function clean(input: { name: string; phone?: string }): { name: string; phone: string } {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (!name) throw new AppError('err.lenderEmpty');
  let phone = '';
  if (input.phone?.trim()) {
    const p = normalizePhone(input.phone);
    if (!p) throw new AppError('err.phoneInvalid');
    phone = p;
  }
  return { name, phone };
}

/**
 * The person for a pick of one — never the same man twice: one of the list is him; a new one typed is the one with this
 * phone or (without one) this name, else a new record. Runs inside the caller's transaction when there is one.
 */
async function lenderFor(p: Extract<OwedPick, { kind: 'lender' | 'new' }>): Promise<Lender> {
  if (p.kind === 'lender') {
    const had = await db.lenders.get(p.id);
    if (!had) throw new AppError('err.notFound');
    return had;
  }
  const { name, phone } = clean(p);
  const same = sameLender(await db.lenders.toArray(), { name, phone });
  if (same) {
    // Known by his name only so far: the phone typed now is his.
    if (phone && !same.phone) await db.lenders.update(same.id, { phone, updatedAt: nowIso() });
    return same;
  }
  const l: Lender = { id: uid(), name, phone, createdAt: nowIso() };
  await db.lenders.add(l);
  return l;
}

/**
 * What an expense keeps for whom it is owed to: a person — his `lenderId`; a supplier — the expense's seller is it
 * (`supplierId`; its name as the seller when none was written); a seller by its name — that name, no supplier.
 */
export async function owedFields(pick: OwedPick, seller: Pick<Expense, 'vendor' | 'supplierId'>): Promise<Pick<Expense, 'lenderId' | 'supplierId' | 'vendor'>> {
  if (pick.kind === 'lender' || pick.kind === 'new') return { lenderId: (await lenderFor(pick)).id, supplierId: seller.supplierId, vendor: seller.vendor };
  if (pick.kind === 'supplier') return { lenderId: undefined, supplierId: pick.id, vendor: seller.vendor?.trim() || pick.name };
  return { lenderId: undefined, supplierId: undefined, vendor: pick.name.trim() };
}

/**
 * Whom an expense on credit is owed to now (`to`; none — nobody: an old one typed with no seller), and its seller (who
 * is owed when no person is picked) — the sheet offers it first.
 */
export async function owedOf(expenseId: string): Promise<{ to?: OwedTo; seller?: OwedTo } | undefined> {
  const e = await db.expenses.get(expenseId);
  if (!e) return undefined;
  const [lender, supplier] = await Promise.all([e.lenderId ? db.lenders.get(e.lenderId) : undefined, e.supplierId ? db.suppliers.get(e.supplierId) : undefined]);
  const idx = owedIndex(supplier ? [supplier] : [], lender ? [lender] : []);
  return { to: owedToOf(e, idx), seller: owedToOf({ vendor: e.vendor, supplierId: e.supplierId }, idx) };
}

/** Another one owed for an expense on credit (picked in its sheet): only this expense changes — a part of a split, only it. */
export async function setOwedTo(expenseId: string, pick: OwedPick): Promise<void> {
  await db.transaction('rw', db.expenses, db.lenders, async () => {
    const e = await db.expenses.get(expenseId);
    if (!e || e.voidedAt) throw new AppError('err.notFound');
    const patch = await owedFields(pick, e);
    await db.expenses.update(expenseId, { lenderId: patch.lenderId, supplierId: patch.supplierId || undefined, vendor: patch.vendor || undefined });
  });
}

/** The chips under «Кому должны»: whom the garage owed lately, the latest first, one each. */
export async function owedChoices(limit = 8): Promise<OwedPick[]> {
  const [credits, lenders] = await Promise.all([db.expenses.filter((e) => e.method === 'credit' && !e.voidedAt).toArray(), db.lenders.toArray()]);
  const ids = [...new Set(credits.map((e) => e.supplierId).filter((id): id is string => !!id))];
  const suppliers = (await db.suppliers.bulkGet(ids)).filter((s) => !!s);
  return recentOwed(credits, owedIndex(suppliers, lenders), lenders, limit);
}

/** Whom typing finds: the people, then the suppliers of the base. */
export async function searchOwed(q: string, limit = 8): Promise<OwedPick[]> {
  if (!q.trim()) return [];
  const [lenders, suppliers] = await Promise.all([db.lenders.toArray(), db.suppliers.toArray()]);
  return findOwed(q, lenders, suppliers, limit);
}

/** A person's name or phone changed: «Мы должны», the book and the money sheet name him so from now on. */
export async function updateLender(id: string, input: { name: string; phone: string }): Promise<void> {
  await db.transaction('rw', db.lenders, async () => {
    const l = await db.lenders.get(id);
    if (!l) throw new AppError('err.notFound');
    const { name, phone } = clean(input);
    if (phone && (await db.lenders.where('phone').equals(phone).toArray()).some((x) => x.id !== id)) throw new AppError('err.lenderTaken');
    await db.lenders.update(id, { name, phone, updatedAt: nowIso() });
  });
}
