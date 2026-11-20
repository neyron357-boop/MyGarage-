import { db } from '../db/db';
import { tidyOf } from '../domain/supplierTidy';
import type { Supplier } from '../domain/types';

/*
 * The supplier base put in order in one go (v0.60; rules — domain/supplierTidy.ts): names in English (the Arabic kept),
 * what each sells and its makes guessed from its name where nothing was known — marked as guessed. «Отменить» puts back
 * what it changed, field by field, where nothing changed it since.
 */

type Fields = Pick<Supplier, 'name' | 'nameAr' | 'parts' | 'makes' | 'condition' | 'guessed'>;

export interface TidyResult {
  named: number;
  parts: number;
  makes: number;
  undo: () => Promise<void>;
}

export async function tidySuppliers(): Promise<TidyResult> {
  const all = await db.suppliers.filter((s) => !s.archivedAt).toArray();
  const changes: {
    id: string;
    before: Partial<Fields>;
    after: Partial<Fields>;
  }[] = [];
  let named = 0;
  let parts = 0;
  let makes = 0;
  for (const s of all) {
    const after = tidyOf(s);
    if (!after) continue;
    const before: Partial<Fields> = {};
    for (const k of Object.keys(after) as (keyof Fields)[]) (before as Record<string, unknown>)[k] = s[k];
    changes.push({ id: s.id, before, after });
    if (after.name) named++;
    if (after.parts) parts++;
    if (after.makes) makes++;
  }
  if (changes.length) {
    await db.transaction('rw', db.suppliers, async () => {
      for (const c of changes) await db.suppliers.update(c.id, c.after);
    });
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return {
    named,
    parts,
    makes,
    undo: async () => {
      await db.transaction('rw', db.suppliers, async () => {
        for (const c of changes) {
          const now = await db.suppliers.get(c.id);
          if (!now) continue;
          const back: Partial<Fields> = {};
          for (const k of Object.keys(c.after) as (keyof Fields)[]) if (same(now[k], c.after[k])) (back as Record<string, unknown>)[k] = c.before[k];
          if (Object.keys(back).length) await db.suppliers.update(c.id, back);
        }
      });
    },
  };
}

/** A field the manager set by hand is no longer a guess (v0.60): `guessed` without it. */
export function stillGuessed(was: Pick<Supplier, 'guessed' | 'parts' | 'makes' | 'condition'>, input: Partial<Supplier>): Supplier['guessed'] | undefined {
  if (!was.guessed?.length) return undefined;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const left = was.guessed.filter((k) => !(k in input) || same(input[k], was[k]));
  return left.length === was.guessed.length ? undefined : left;
}
