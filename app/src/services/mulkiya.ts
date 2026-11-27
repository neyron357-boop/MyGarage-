import { db } from '../db/db';
import { dubaiDate } from '../domain/dates';
import { mulkiyaExpiry } from '../domain/mulkiya';
import { paperRows } from '../domain/receiptText';
import { mulkiyaOf } from './cover';
import { mediaBlob } from './media';

/*
 * The Mulkiya's expiry on the car (audit 27/11): read off the card's front on the phone (never the AI — the card carries
 * the owner's name and nationality), each photo once; or set by hand in the Mulkiya's view, and then never read over.
 * «Сегодня» reminds the customer two weeks before it (domain/today.ts, kind `mulkiya`).
 */

/** The front read for its expiry — once a photo; a day set by hand is never read over. Returns the day written, if any. */
export async function readMulkiyaExpiry(vehicleId: string): Promise<string | undefined> {
  const v = await db.vehicles.get(vehicleId);
  if (!v || v.regFrom === 'hand') return undefined;
  const { mulkiya: front } = await mulkiyaOf(vehicleId);
  if (!front || v.regReadOf === front) return undefined;
  const blob = await mediaBlob(front);
  if (!blob) return undefined;
  const { readDocument } = await import('./vinReader');
  const page = await readDocument(blob, { prep: 'grey', max: 2000 });
  const text = paperRows(page.words, page.skew)
    .map((r) => r.text)
    .join('\n');
  const found = mulkiyaExpiry(text, dubaiDate());
  // Read again since: the hand may have set it meanwhile.
  const now = await db.vehicles.get(vehicleId);
  if (!now || now.regFrom === 'hand') return undefined;
  await db.vehicles.update(vehicleId, { regReadOf: front, ...(found ? { regExpires: found.date, regFrom: 'read' as const } : {}) });
  return found?.date;
}

/** Set by hand (or taken away): the manager's word stands — no reading puts another day over it. */
export async function setMulkiyaExpiry(vehicleId: string, day: string | undefined): Promise<void> {
  await db.vehicles.update(vehicleId, day ? { regExpires: day, regFrom: 'hand' } : { regExpires: undefined, regFrom: 'hand' });
}
