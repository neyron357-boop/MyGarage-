import { db } from '../db/db';
import { labourRenames } from '../domain/labourName';
import { settleLabour } from './labourLine';

/**
 * The job's labour charges named by its parts again (v0.80, domain/labourName.ts): after a line is added, changed,
 * taken off or brought back. Only drafts change; a name typed by hand stays. First (v0.90, #70) the labour charge last of
 * the lines and priced by the garage's history while nobody typed its price (services/labourLine.ts).
 */
export async function syncLabourNames(orderId: string): Promise<void> {
  await settleLabour(orderId);
  const items = await db.items.where('orderId').equals(orderId).toArray();
  for (const r of labourRenames(items)) await db.items.update(r.id, r.patch);
}
