import { db, uid } from '../db/db';
import { dubaiDate, nowIso } from '../domain/dates';
import { BOOK_FILE, buildSupplierBook, readSupplierBook, withIds, type BookSupplier } from '../domain/supplierBook';
import { sameSupplier } from '../domain/supplierSheet';
import type { Supplier } from '../domain/types';

/*
 * The supplier base in and out of the garage's own workbook (UAE_Contacts.xlsx, domain/supplierBook.ts).
 */

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** The fields a workbook row fills in; what is empty there keeps what the app has. */
const FIELDS = ['name', 'phone', 'makes', 'condition', 'parts', 'locationUrl', 'address', 'notes'] as const;

function changesOf(have: Supplier, row: BookSupplier): Partial<Supplier> {
  const patch: Partial<Supplier> = {};
  for (const k of FIELDS) {
    const v = row[k];
    if (v === undefined || (Array.isArray(v) && !v.length)) continue;
    if (JSON.stringify(v) !== JSON.stringify(have[k])) (patch as Record<string, unknown>)[k] = v;
  }
  if (row.service && !have.service) patch.service = true;
  if (JSON.stringify(row.book) !== JSON.stringify(have.book)) patch.book = row.book;
  return patch;
}

export interface BookImport {
  added: number;
  updated: number;
  /** Already as in the workbook (or removed in the app — those stay removed). */
  same: number;
}

/**
 * The suppliers of a supplier base workbook: each found by its ID there (or, the first time, by its phone or name)
 * is brought up to the workbook, the others are added; the workbook is kept for the next export. Null when the
 * file is not such a workbook.
 */
export async function importSupplierBook(bytes: Uint8Array, name = BOOK_FILE): Promise<BookImport | null> {
  const rows = await readSupplierBook(bytes);
  if (!rows?.length) return null;
  return db.transaction('rw', db.suppliers, db.books, async () => {
    const all = await db.suppliers.toArray();
    const now = nowIso();
    const r: BookImport = { added: 0, updated: 0, same: 0 };
    for (const row of rows) {
      const have = all.find((s) => s.book?.id && s.book.id === row.book.id) ?? all.find((s) => !s.book?.id && sameSupplier(s, row));
      if (have?.archivedAt) {
        r.same++;
        continue;
      }
      if (!have) {
        const fields = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as BookSupplier;
        const s: Supplier = { ...fields, id: uid(), createdAt: now };
        await db.suppliers.add(s);
        all.push(s);
        r.added++;
        continue;
      }
      const patch = changesOf(have, row);
      if (!Object.keys(patch).length) {
        r.same++;
        continue;
      }
      await db.suppliers.update(have.id, patch);
      Object.assign(have, patch);
      r.updated++;
    }
    await db.books.put({ id: 'suppliers', name, savedAt: now, data: toBase64(bytes) });
    return r;
  });
}

/**
 * The supplier base as the garage's workbook: every supplier not removed, with what the app holds now and every
 * other column as it came; with the workbook last brought in, its other sheets go back out as they were.
 */
export async function exportSupplierBook(): Promise<File> {
  const all = await db.suppliers.toArray();
  const list = withIds(
    all.filter((s) => !s.archivedAt),
    all,
  );
  const stored = await db.books.get('suppliers');
  const bytes = await buildSupplierBook(list, stored ? fromBase64(stored.data) : null, dubaiDate());
  return new File([bytes.slice()], BOOK_FILE, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
