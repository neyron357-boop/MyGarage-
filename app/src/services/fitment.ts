import { db } from '../db/db';
import { nowIso } from '../domain/dates';
import { carFacts, FIT_ORDER, fitmentsOf, partCategory, readBeltMarking, RULES, type CarFacts, type Fitment, type FitStatus, type Marking, type PartCategory } from '../domain/fitment';
import { garageUses } from '../domain/partsMemory';
import { sameNumber } from '../domain/partNumbers';
import type { OrderItem, Vehicle } from '../domain/types';
import { priorParts } from './ai';
import { AppError } from './errors';
import { mediaBlob } from './media';

/*
 * A part line's fitment to its car (v0.65; the rules — domain/fitment.ts): each number the search found, judged afresh
 * from what is kept with it and what is known now (the car's card, the marking of the part on the car, the garage's own
 * jobs) — so a number shown green before on «seen in two catalogues» is judged again, not believed. The marking of the
 * part on the car: typed, or read off the line's own photo (a belt's «7PK2164»). Ordering a part whose number is not
 * verified: the manager's reason is kept with it — the number stays as it is judged.
 */

export interface LineFitment {
  part: string;
  category: PartCategory;
  car: CarFacts;
  /** Every number found, judged — in the order found. */
  rows: { number: string; fit: Fitment }[];
  /** The line's own number: judged when it is one the search found; a number typed or bought — not judged (none found). */
  current?: { number: string; fit?: Fitment };
  marking?: Marking;
  /** The line's kind of part has a marking to compare (belts). */
  marked: boolean;
}

/** The line's car (none — no job or no car). */
async function vehicleOf(item: OrderItem): Promise<Vehicle | undefined> {
  const order = await db.orders.get(item.orderId);
  return order ? db.vehicles.get(order.vehicleId) : undefined;
}

/** A line's fitment, judged now. */
export async function loadFitment(itemId: string): Promise<LineFitment | undefined> {
  const item = await db.items.get(itemId);
  if (!item || item.kind !== 'part') return undefined;
  return fitmentOfLine(item, await vehicleOf(item));
}

export async function fitmentOfLine(item: OrderItem, vehicle: Vehicle | undefined): Promise<LineFitment> {
  const part = item.aiFind?.part || item.titleEn || item.titleRu || '';
  const car = carFacts(vehicle);
  const carKey = { make: vehicle?.make ?? '', model: vehicle?.model ?? '', year: vehicle?.year, engine: vehicle?.engine };
  const prior = (await priorParts().catch(() => [])).filter((p) => p.id !== item.id);
  const garage = garageUses(prior, carKey, vehicle?.id, part);
  const marking = item.fitment?.marking;
  const rows = item.aiFind ? fitmentsOf({ part, car, search: item.aiFind.search, numbers: item.aiFind.numbers, marking, garage }) : [];
  const no = item.partNumber?.trim();
  const found = no ? rows.find((r) => sameNumber(r.number, no)) : undefined;
  const category = partCategory(part);
  return { part, category, car, rows, current: no ? { number: no, fit: found?.fit } : undefined, marking, marked: RULES[category].spec === 'belt' };
}

/** The marking of the part on the car, as the manager typed it (empty — none). Typed, it is the manager's word: sure. */
export async function setMarking(itemId: string, text: string): Promise<void> {
  const item = await db.items.get(itemId);
  if (!item) throw new AppError('err.notFound');
  const t = text.trim().toUpperCase().slice(0, 40);
  const fitment = { ...item.fitment, marking: t ? { text: t, from: 'typed' as const, confidence: 1, at: nowIso() } : undefined };
  await db.items.update(itemId, { fitment });
}

/** A marking off a photo — how the reading went: one clean reading is said; several, or letters put right, are less sure. */
export function markingOfText(raw: string, mediaId: string, at = nowIso()): Marking | undefined {
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const reads = [...new Set([raw, ...lines].flatMap((l) => readBeltMarking(l).readings.map((r) => r.text)))];
  if (!reads.length) return undefined;
  const clean = lines.some((l) => readBeltMarking(l).spec?.text === reads[0]);
  // A camera's reading is never the manager's word: at best «likely», to be taken by a tap (then typed — sure).
  const confidence = reads.length === 1 ? (clean ? 0.75 : 0.5) : 0.4;
  return { text: reads[0], from: 'photo', confidence, ...(reads.length > 1 ? { alternatives: reads.slice(1, 4) } : {}), mediaId, raw: raw.slice(0, 200), at };
}

/**
 * The line's own photos read for a marking (a belt's), each photo once; the first reading that says a size is kept — not
 * over a marking typed. The photo stays as it was; nothing is read when the line is not a belt.
 */
export async function readMarking(itemId: string, read: (blob: Blob) => Promise<string>): Promise<Marking | undefined> {
  const item = await db.items.get(itemId);
  if (!item || item.kind !== 'part' || RULES[partCategory(item.titleEn || item.titleRu || '')].spec !== 'belt') return undefined;
  if (item.fitment?.marking?.from === 'typed') return undefined;
  const done = new Set(item.fitment?.read ?? []);
  let found: Marking | undefined;
  for (const id of item.mediaIds ?? []) {
    if (done.has(id)) continue;
    done.add(id);
    try {
      const blob = await mediaBlob(id);
      const text = blob ? await read(blob) : '';
      found = markingOfText(text, id);
    } catch {
      // a photo that would not read: the next one
    }
    if (found) break;
  }
  const now = await db.items.get(itemId);
  if (!now) return undefined;
  await db.items.update(itemId, { fitment: { ...now.fitment, read: [...done].slice(-20), ...(found && now.fitment?.marking?.from !== 'typed' ? { marking: found } : {}) } });
  return found;
}

/** A part about to be ordered with a number found by the search and not verified for its car. */
export interface OrderRisk {
  itemId: string;
  name: string;
  number: string;
  status: FitStatus;
  fit: Fitment;
}

/**
 * The parts among these that would be ordered with a number not verified (the search's number — typed or bought numbers
 * are the manager's own). Judged now, with what is known now (v0.65: «перед покупкой — повторная проверка»). A risk the
 * manager already took for the same number, no worse now, is not asked again.
 */
export async function orderRisks(itemIds: string[], typed: Record<string, string> = {}): Promise<OrderRisk[]> {
  const out: OrderRisk[] = [];
  for (const id of itemIds) {
    const kept = await db.items.get(id);
    // A number typed in the sheet and not saved yet: the one about to be ordered.
    const item = kept && id in typed ? { ...kept, partNumber: typed[id].trim() || undefined } : kept;
    if (!item || item.kind !== 'part' || item.customerSupplied) continue;
    const f = await fitmentOfLine(item, await vehicleOf(item));
    const fit = f.current?.fit;
    if (!f.current || !fit || fit.status === 'verified') continue;
    const ack = item.fitment?.ack;
    if (ack && sameNumber(ack.number, f.current.number) && FIT_ORDER[fit.status] <= FIT_ORDER[ack.status]) continue;
    out.push({ itemId: id, name: item.titleEn || item.titleRu || '', number: f.current.number, status: fit.status, fit });
  }
  return out;
}

/** The manager orders them all the same: the reason kept with each part (its number's status does not change). */
export async function ackOrderRisks(risks: OrderRisk[], reason: string): Promise<void> {
  const why = reason.trim();
  if (!why) throw new AppError('fit.reasonNeeded');
  await db.transaction('rw', db.items, async () => {
    for (const r of risks) {
      const item = await db.items.get(r.itemId);
      if (!item) continue;
      await db.items.update(r.itemId, { fitment: { ...item.fitment, ack: { number: r.number, status: r.status, reason: why.slice(0, 300), at: nowIso() } } });
    }
  });
}
