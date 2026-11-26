import { db } from '../db/db';
import { liveLines } from '../domain/flow';
import { activeInvoice } from '../domain/invoice';
import { byPosition, lineName } from '../domain/items';
import { labourWords } from '../domain/labourName';
import { labourGuess, type LabourJob } from '../domain/labourPrice';
import { isLabourCharge } from '../domain/linePrices';
import type { OrderItem } from '../domain/types';
import { getSettings } from './settings';

/*
 * The labour charge kept by the app (v0.90, the owner's note #70: «всегда внизу должна быть оплата труда — закрепить внизу…
 * чтоб я сам каждый раз не добавлял… в каждом инвойсе есть, если я принудительно это сам не убираю»; «сам заполнял названия
 * и выставлял цены автоматически»): last of the job's lines, priced by the garage's history (domain/labourPrice.ts) while
 * nobody typed its price; named by the parts as before (domain/labourName.ts). Added by itself with a job's first part —
 * `ensureLabourLine` (services/estimate.ts); taken off by hand — not again on that job (`Order.labourOff`).
 */

/** A labour charge: work done here, named by the labour words («LABOUR CHARGES», «LABOR CHARGE: …», «ОПЛАТА ТРУДА»). */
export const isCharge = (i: OrderItem): boolean => i.kind === 'labor' && !i.outsource && isLabourCharge(i.titleEn || i.titleRu || '');

/** The price on it is the history's (or none yet): it may follow the parts. */
const byHistory = (i: OrderItem) => !i.unitPriceFils || (!!i.labourGuess && i.unitPriceFils === i.labourGuess.fils && i.unitGrossFils === i.labourGuess.gross);

/** The parts' names, in the lines' order. */
const partsOf = (items: OrderItem[]) =>
  liveLines(items)
    .filter((i) => i.kind === 'part')
    .sort(byPosition)
    .map((i) => lineName((i.titleEn || i.titleRu || '').trim()))
    .filter(Boolean);

let history: { key: string; at: number; jobs: LabourJob[]; words?: string } | undefined;

/** The garage's earlier jobs with a labour charge and parts (read again when the lines or jobs changed, else a minute). */
async function labourHistory(): Promise<LabourJob[]> {
  const key = `${db.name}|${await db.items.count()}|${await db.orders.count()}`;
  if (history && history.key === key && Date.now() - history.at < 60_000) return history.jobs;
  const [items, orders, vehicles] = await Promise.all([db.items.toArray(), db.orders.toArray(), db.vehicles.toArray()]);
  const cars = new Map(vehicles.map((v) => [v.id, v]));
  const byJob = new Map<string, OrderItem[]>();
  for (const i of items) byJob.set(i.orderId, [...(byJob.get(i.orderId) ?? []), i]);
  const jobs: LabourJob[] = [];
  const said = new Map<string, number>();
  for (const i of items) if (isCharge(i)) said.set(labourWords(i.titleEn || i.titleRu || ''), (said.get(labourWords(i.titleEn || i.titleRu || '')) ?? 0) + 1);
  for (const o of orders) {
    if (o.stage === 'cancelled') continue;
    const lines = byJob.get(o.id) ?? [];
    const charges = lines.filter((i) => isCharge(i) && i.unitPriceFils > 0 && i.approvalState !== 'declined' && i.approvalState !== 'cancelled');
    const parts = partsOf(lines);
    if (!charges.length || !parts.length) continue;
    const net = charges.reduce((s, i) => s + i.unitPriceFils * (i.qty || 1), 0);
    const typedGross = charges.every((i) => i.unitGrossFils !== undefined);
    const v = cars.get(o.vehicleId);
    jobs.push({
      orderId: o.id,
      vehicleId: o.vehicleId,
      customerId: o.customerId,
      make: v?.make,
      model: v?.model,
      at: o.arrivedAt ?? o.createdAt,
      parts,
      net,
      ...(typedGross ? { gross: charges.reduce((s, i) => s + (i.unitGrossFils ?? 0) * (i.qty || 1), 0) } : {}),
    });
  }
  history = { key, at: Date.now(), jobs, words: [...said].sort((a, b) => b[1] - a[1])[0]?.[0] };
  return jobs;
}

/** The labour words the garage writes most («LABOUR CHARGES», «LABOR CHARGE»…) — the app's own line is called so. */
export async function usualLabourWords(): Promise<string> {
  await labourHistory();
  return history?.words || 'LABOUR CHARGES';
}

/**
 * Work of the job's own that is not the labour charge (a repair, a service — «FRONT BRAKE PADS REPLACEMENT», «OIL CHANGE»):
 * it carries the labour — the app adds none beside it (that would charge the work twice).
 */
const ownWork = (items: OrderItem[]) => items.some((i) => i.kind === 'labor' && !i.outsource && !isCharge(i) && ['draft', 'pending', 'approved'].includes(i.approvalState));

/** The job wants a labour charge the app adds: open, no invoice, parts and no work of its own, not taken off by hand. */
export async function wantsLabour(orderId: string): Promise<boolean> {
  const [order, items, invoices] = await Promise.all([db.orders.get(orderId), db.items.where('orderId').equals(orderId).toArray(), db.invoices.where('orderId').equals(orderId).toArray()]);
  if (!order || order.labourOff || order.imported || order.stage === 'closed' || order.stage === 'cancelled' || activeInvoice(invoices)) return false;
  return partsOf(items).length > 0 && !items.some(isCharge) && !ownWork(items);
}

/**
 * The job's labour charge last of its lines (the owner: «закрепить внизу») — after a line is added by hand (a document
 * carried over keeps the paper's order). Not after the invoice.
 */
export async function placeLabourLast(orderId: string): Promise<void> {
  const [items, invoices] = await Promise.all([db.items.where('orderId').equals(orderId).toArray(), db.invoices.where('orderId').equals(orderId).toArray()]);
  if (activeInvoice(invoices) || !items.some(isCharge)) return;
  const sorted = [...items].sort(byPosition);
  const want = [...sorted.filter((i) => !isCharge(i)), ...sorted.filter(isCharge)];
  if (!want.some((i, k) => sorted[k].id !== i.id || i.position !== k)) return;
  await db.transaction('rw', db.items, async () => {
    for (let k = 0; k < want.length; k++) if (want[k].position !== k) await db.items.update(want[k].id, { position: k });
  });
}

/**
 * The job's labour charge at its price: the history's while nobody typed one (one labour charge, a draft, one of it); the
 * app's own, untouched, goes when the parts it was for have all gone, or work of the job's own came (that carries the
 * labour). Not on a closed job or after the invoice.
 */
export async function settleLabour(orderId: string): Promise<void> {
  const [order, items, invoices] = await Promise.all([db.orders.get(orderId), db.items.where('orderId').equals(orderId).toArray(), db.invoices.where('orderId').equals(orderId).toArray()]);
  if (!order || order.stage === 'closed' || order.stage === 'cancelled' || activeInvoice(invoices)) return;
  const charges = items.filter(isCharge);
  if (!charges.length) return;
  const parts = partsOf(items);

  // Its own line, nobody's work in it, the parts gone or the job's own work come: off again (as it came).
  const lone = charges.length === 1 ? charges[0] : undefined;
  if (lone?.autoLabour && (!parts.length || ownWork(items)) && lone.approvalState === 'draft' && !lone.ownName && byHistory(lone) && !lone.mediaIds?.length) {
    await db.items.delete(lone.id);
    return;
  }

  // Its price from the history, while it is the history's.
  if (!lone || lone.approvalState !== 'draft' || (lone.qty || 1) !== 1 || lone.lineOff || !byHistory(lone) || !parts.length) return;
  const settings = await getSettings();
  const rate = lone.vatRateBp ?? settings.vatRateBp;
  const vehicle = await db.vehicles.get(order.vehicleId);
  const guess = labourGuess(parts, await labourHistory(), { orderId, vehicleId: order.vehicleId, customerId: order.customerId, make: vehicle?.make, model: vehicle?.model }, rate, settings.pricesIncludeVat);
  if (!guess || (guess.fils === lone.unitPriceFils && guess.gross === lone.unitGrossFils)) return;
  await db.items.update(lone.id, { unitPriceFils: guess.fils, unitGrossFils: guess.gross, labourGuess: guess });
}
