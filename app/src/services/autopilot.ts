import { db } from '../db/db';
import { autopilotStep, partsToPrice, type AutopilotStep } from '../domain/autopilot';
import { liveLines } from '../domain/flow';
import { itemAmounts } from '../domain/items';
import type { OrderItem } from '../domain/types';
import { waAutoOf } from '../domain/waAuto';
import { waDigits } from '../domain/whatsapp';
import { AppError } from './errors';
import { getSettings } from './settings';
import { suppliersForJob } from './supplierRank';
import { askSuppliers } from './waAsk';

/*
 * A request's autopilot on its job (v0.98, domain/autopilot.ts): where it stands and its one next step — the suppliers to ask
 * (the best ranked for this car and these parts, as «Поставщики» lists them), the answers coming, the quote ready.
 */

export interface AutopilotView {
  step: AutopilotStep;
  /** The parts to ask the price of (not asked yet). */
  parts: OrderItem[];
  /** Whom to ask: the first of the ranked suppliers with a WhatsApp number. */
  suppliers: { id: string; name: string }[];
  /** Asked about this job, and of them answered. */
  asked: number;
  answered: number;
  /** Lines still without a price (the parts priced). */
  left: OrderItem[];
  totalFils: number;
}

/** How many suppliers the autopilot asks (no more than the garage's own limit). */
export const AUTO_ASK = 3;

/** The job's autopilot — only a job made of a request (`fromChat`). */
export async function autopilotOf(orderId: string): Promise<AutopilotView | undefined> {
  const order = await db.orders.get(orderId);
  if (!order?.fromChat) return undefined;
  const items = await db.items.where('orderId').equals(orderId).toArray();
  const asks = order.asks ?? [];
  const step = autopilotStep(items, asks);
  const asked = new Set(asks.flatMap((a) => a.items));
  const parts = partsToPrice(items).filter((i) => !asked.has(i.id));
  let suppliers: AutopilotView['suppliers'] = [];
  if (step === 'ask') {
    const max = Math.min(AUTO_ASK, waAutoOf((await getSettings()).waAuto).ask.max);
    const ranked = await suppliersForJob(orderId, 'en');
    suppliers = (ranked?.parts ?? [])
      .filter((r) => !!waDigits(r.supplier.phone) || !!r.chat)
      .slice(0, max)
      .map((r) => ({ id: r.supplier.id, name: r.supplier.name }));
  }
  const live = liveLines(items).filter((i) => i.kind !== 'discount');
  return {
    step,
    parts,
    suppliers,
    asked: asks.length,
    answered: asks.filter((a) => (a.replies ?? []).some((r) => r.lines > 0)).length,
    left: live.filter((i) => i.approvalState === 'draft' && !i.customerSupplied && !(itemAmounts(i).gross > 0)),
    totalFils: live.reduce((n, i) => n + (itemAmounts(i).gross || 0), 0),
  };
}

/** «Спросить цены»: the request to the ranked suppliers — through «Проверить и отправить», as every message (v0.84.4). */
export async function askForPrices(orderId: string): Promise<{ asked: number; noNumber: string[] }> {
  const v = await autopilotOf(orderId);
  if (!v || v.step !== 'ask' || !v.parts.length) throw new AppError('autopilot.nothingToAsk');
  if (!v.suppliers.length) throw new AppError('autopilot.noSuppliers');
  return askSuppliers(
    orderId,
    v.suppliers.map((s) => ({ supplierId: s.id })),
    { items: v.parts, sheets: [], usedFiles: [] },
  );
}
