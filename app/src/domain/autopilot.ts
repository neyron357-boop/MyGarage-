import { liveLines } from './flow';
import { itemAmounts } from './items';
import type { OrderItem, PartAsk } from './types';

/*
 * A request's autopilot (v0.98, the manager: «от меня потребуется все это зарегистрировать и найти эти запчасти, цены, создать
 * смету и отправить на согласование. Все это я делал вручную, мне нужно, чтобы и мониторил, и все это за меня автоматически
 * делал»): a job made of a request in WhatsApp (services/waRequest.ts) goes on by itself as far as it may — what is left for
 * the manager is one tap a step, with what it does in sight (nothing goes to WhatsApp by itself — v0.84.4):
 *   ask    — its parts have no price and nobody was asked: «Спросить цены · 3» (the suppliers ranked for the job);
 *   wait   — asked, prices still coming;
 *   left   — the parts are priced (by the suppliers' answers, the sale price by the garage's markup), a line still has no price
 *            (a work the history knows no price of): it is named;
 *   quote  — every line priced: «Смета готова · 1 250 AED → Отправить».
 * Pure: the job's lines and its requests to suppliers → the step.
 */

export type AutopilotStep = 'ask' | 'wait' | 'left' | 'quote' | 'none';

type Line = Pick<OrderItem, 'id' | 'kind' | 'approvalState' | 'customerSupplied' | 'offers' | 'costPriceFils' | 'unitPriceFils' | 'unitGrossFils' | 'qty' | 'vatRateBp' | 'unconfirmed' | 'lineOff'> & Partial<OrderItem>;

/** The parts a supplier is to price: bought by the garage, still drafts, no price of a supplier on them yet. */
export function partsToPrice<T extends Line>(items: T[]): T[] {
  return items.filter((i) => i.kind === 'part' && !i.customerSupplied && i.approvalState === 'draft' && !i.unconfirmed && i.costPriceFils === undefined && !(i.offers ?? []).some((o) => !o.na && (o.costFils ?? 0) > 0));
}

export function autopilotStep(items: Line[], asks: Pick<PartAsk, 'items' | 'at'>[] = []): AutopilotStep {
  const live = liveLines(items as OrderItem[]).filter((i) => i.kind !== 'discount');
  if (!live.length) return 'none';
  const drafts = live.filter((i) => i.approvalState === 'draft');
  // Sent to the customer already (or agreed): the autopilot's part is done.
  if (!drafts.length) return 'none';
  const toPrice = partsToPrice(drafts as OrderItem[]);
  const asked = new Set(asks.flatMap((a) => a.items));
  if (toPrice.some((i) => !asked.has(i.id))) return 'ask';
  if (toPrice.length) return 'wait';
  const unpriced = drafts.filter((i) => !i.customerSupplied && !(itemAmounts(i as OrderItem).gross > 0));
  return unpriced.length ? 'left' : 'quote';
}
