import { db } from '../db/db';
import type { LedgerEntry, LedgerSource } from '../domain/ledger';
import type { Media, MediaOwner } from '../domain/types';
import { AppError } from './errors';
import { addMedia, deleteMedia } from './media';

/*
 * Proofs of money spent: photos of a receipt, a supplier's invoice or a transfer, kept with the
 * book entry. They are media of their own — the entry itself (immutable once written) never
 * changes: proofs can be added to any money out at any time, and a wrong one taken off.
 */

const OWNER: Partial<Record<LedgerSource, MediaOwner>> = { expense: 'expense', movement: 'movement', payment: 'payment' };

type EntryRef = Pick<LedgerEntry, 'id' | 'source' | 'kind'>;

/** Every money out of the book takes proofs: expenses, cash movements, refunds to a customer. */
export const takesProofs = (e: Pick<LedgerEntry, 'source' | 'kind'>): boolean => e.kind === 'out' && !!OWNER[e.source];

/** The receipt taken with the expense and the proofs added later. */
const isProof = (m: Media) => m.kind === 'photo' && (m.slot === 'proof' || m.slot === 'receipt');
/** The receipt first, then the proofs in the order they were added. */
const byOrder = (a: Media, b: Media) => Number(b.slot === 'receipt') - Number(a.slot === 'receipt') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export async function addProofs(entry: EntryRef, files: Blob[]): Promise<Media[]> {
  const ownerType = OWNER[entry.source];
  if (!ownerType || entry.kind !== 'out') throw new AppError('err.notFound');
  const added: Media[] = [];
  for (const file of files) added.push(await addMedia({ ownerType, ownerId: entry.id, slot: 'proof', file }));
  return added;
}

export async function proofsOf(entryId: string): Promise<Media[]> {
  return (await db.media.where('ownerId').equals(entryId).toArray()).filter(isProof).sort(byOrder);
}

/** For lists of entries: the entries that have photos, each with its first one. */
export async function proofIndex(entryIds: string[]): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  if (!entryIds.length) return index;
  const list = (await db.media.where('ownerId').anyOf(entryIds).toArray()).filter(isProof).sort(byOrder);
  for (const m of list) if (!index.has(m.ownerId)) index.set(m.ownerId, m.id);
  return index;
}

/** A proof added by mistake. The receipt taken with the expense stays (the expense points to it). */
export async function removeProof(mediaId: string): Promise<void> {
  const m = await db.media.get(mediaId);
  if (!m || m.slot !== 'proof') throw new AppError('err.notFound');
  await deleteMedia(mediaId);
}
