import { owedToOf, type OwedIndex, type OwedTo } from './debts';
import { nameKey, phoneQueryDigits } from './drivers';
import { sellerKey } from './suppliers';
import type { Expense, Lender, Supplier } from './types';

/*
 * Whom an expense on credit is owed to (v0.61, the user: «когда делается расход в долг, важно указать, кому; заказали
 * запчасть, а заплатил не мы, а кто-то другой в долг — это нужно чётко обозначить»): a person who paid for the garage
 * (`lenders`), a supplier of the base, or the seller as written. What is offered to pick and in what order, what typing
 * finds, and which person is the same one — so that one man is one card in «Мы должны». Pure: the lists come from
 * services/lenders.ts.
 */

/** One picked as the one owed: a person (one of the list, or new), a supplier of the base, or the seller by its name. */
export type OwedPick =
  | { kind: 'lender'; id: string; name: string; phone?: string }
  | { kind: 'supplier'; id: string; name: string; phone?: string }
  | { kind: 'seller'; name: string; id?: undefined; phone?: undefined }
  | { kind: 'new'; name: string; phone?: string; id?: undefined };

/** The same key as `OwedTo.key` for the same one (a new person — by the name typed). */
export function pickKey(p: OwedPick): string {
  if (p.kind === 'lender') return `l:${p.id}`;
  if (p.kind === 'supplier') return `s:${p.id}`;
  if (p.kind === 'seller') return `v:${sellerKey(p.name)}`;
  return `n:${nameKey(p.name)}`;
}

/** The one an expense is owed to now, as a pick. */
export function pickOf(to: OwedTo): OwedPick {
  if (to.lender) return { kind: 'lender', id: to.lender.id, name: to.lender.name, phone: to.lender.phone || undefined };
  if (to.supplier) return { kind: 'supplier', id: to.supplier.id, name: to.supplier.name, phone: to.supplier.phone || undefined };
  return { kind: 'seller', name: to.name };
}

/** A person, not a shop: the avatar is a person's, «Мы должны» lets his name and phone be changed. */
export const isPerson = (p: OwedPick): boolean => p.kind === 'lender' || p.kind === 'new';

/**
 * Whom the garage owed lately, the latest first — one each (a person paid three times is offered once): from its
 * expenses on credit (`owedToOf`), and the people added and not owed yet. The chips under «Кому должны».
 */
export function recentOwed(
  credits: Pick<Expense, 'vendor' | 'supplierId' | 'lenderId' | 'createdAt' | 'method' | 'voidedAt'>[],
  idx: OwedIndex,
  lenders: Pick<Lender, 'id' | 'name' | 'phone' | 'createdAt'>[],
  limit = 8,
): OwedPick[] {
  const last = new Map<string, { pick: OwedPick; at: string }>();
  const note = (pick: OwedPick, at: string) => {
    const k = pickKey(pick);
    if ((last.get(k)?.at ?? '') < at) last.set(k, { pick, at });
  };
  for (const e of credits) {
    if (e.method !== 'credit' || e.voidedAt) continue;
    const to = owedToOf(e, idx);
    if (to) note(pickOf(to), e.createdAt);
  }
  for (const l of lenders) if (!last.has(`l:${l.id}`)) note({ kind: 'lender', id: l.id, name: l.name, phone: l.phone || undefined }, l.createdAt);
  return [...last.values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map((x) => x.pick);
}

/** Does a name or phone fit what is typed: a part of the name (2+ letters) or of the phone (3+ digits, as it is said). */
function fits(name: string, phone: string | undefined, q: string): boolean {
  const n = nameKey(q);
  const digits = /^[\d\s+()-]+$/.test(q.trim()) ? phoneQueryDigits(q) : '';
  if (digits.length >= 3) return !!phone && phone.replace(/\D/g, '').includes(digits);
  return n.length >= 2 && nameKey(name).includes(n);
}

/**
 * Whom typing finds (the sheet behind «Найти»): the people first, then the suppliers of the base; a name that starts
 * so before one that only has it.
 */
export function findOwed(
  q: string,
  lenders: Pick<Lender, 'id' | 'name' | 'phone'>[],
  suppliers: Pick<Supplier, 'id' | 'name' | 'phone' | 'archivedAt'>[],
  limit = 8,
): OwedPick[] {
  if (!q.trim()) return [];
  const n = nameKey(q);
  const starts = (name: string) => (nameKey(name).startsWith(n) ? 0 : 1);
  const people = lenders.filter((l) => fits(l.name, l.phone, q)).sort((a, b) => starts(a.name) - starts(b.name) || a.name.localeCompare(b.name));
  const shops = suppliers.filter((s) => !s.archivedAt && fits(s.name, s.phone, q)).sort((a, b) => starts(a.name) - starts(b.name) || a.name.localeCompare(b.name));
  return [
    ...people.map((l): OwedPick => ({ kind: 'lender', id: l.id, name: l.name, phone: l.phone || undefined })),
    ...shops.map((s): OwedPick => ({ kind: 'supplier', id: s.id, name: s.name, phone: s.phone || undefined })),
  ].slice(0, limit);
}

/**
 * The person already in the list for what was typed — one man is never saved twice: the one with this phone; without a
 * phone, the one with this name (case, spaces and dots aside).
 */
export function sameLender<T extends Pick<Lender, 'id' | 'name' | 'phone'>>(lenders: T[], input: { name: string; phone: string }, exceptId?: string): T | undefined {
  const others = lenders.filter((l) => l.id !== exceptId);
  if (input.phone) {
    const byPhone = others.find((l) => l.phone === input.phone);
    if (byPhone) return byPhone;
  }
  const n = nameKey(input.name);
  return n ? others.find((l) => nameKey(l.name) === n && (!input.phone || !l.phone)) : undefined;
}
