import { db } from '../db/db';
import { labourRenames } from '../domain/labourName';

/**
 * The job's labour charges named by its parts again (v0.80, domain/labourName.ts): after a line is added, changed,
 * taken off or brought back. Only drafts change; a name typed by hand stays.
 */
export async function syncLabourNames(orderId: string): Promise<void> {
  const items = await db.items.where('orderId').equals(orderId).toArray();
  for (const r of labourRenames(items)) await db.items.update(r.id, r.patch);
}
