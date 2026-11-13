import { roundFils } from './money';
import { fromGross, fromNet, priceFromEntered, type Amounts, type LinePrice } from './vat';
import type { DecisionKind, ItemDecision, Lang, OrderItem } from './types';

export function itemTitle(item: Pick<OrderItem, 'titleRu' | 'titleEn'>, lang: Lang): string {
  return (lang === 'ru' ? item.titleRu || item.titleEn : item.titleEn || item.titleRu) || '';
}

/**
 * Line amounts. Customer-supplied parts cost the customer nothing; discounts are negative. A price
 * typed with VAT ("VAT in the price") keeps its gross to the fils and its VAT is taken out of it;
 * otherwise VAT is added to the net.
 */
export function itemAmounts(item: OrderItem): Amounts {
  if (item.customerSupplied) return fromNet(0, item.vatRateBp);
  const signed = (x: number) => (item.kind === 'discount' ? -Math.abs(x) : x);
  if (item.unitGrossFils !== undefined && item.vatRateBp > 0) {
    return fromGross(signed(roundFils(item.qty * item.unitGrossFils)), item.vatRateBp);
  }
  return fromNet(signed(roundFils(item.qty * item.unitPriceFils)), item.vatRateBp);
}

/** Net line amount. */
export function itemNet(item: OrderItem): number {
  return itemAmounts(item).net;
}

/** Price range (gross) for block B items; for others min = max = actual. */
export function itemRangeGross(item: OrderItem): { min: number; max: number } {
  const actual = itemAmounts(item).gross;
  if (item.block !== 'B' || item.bNeeded === true || item.approvalState === 'approved') return { min: actual, max: actual };
  const min = item.priceMinFils !== undefined ? fromNet(item.priceMinFils, item.vatRateBp).gross : actual;
  const max = item.priceMaxFils !== undefined ? fromNet(item.priceMaxFils, item.vatRateBp).gross : actual;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

/** Block B item where the customer already chose "call me"/"do if needed" and we wait for disassembly. */
export function isAwaitingDisassembly(item: OrderItem): boolean {
  return item.approvalState === 'pending' && item.block === 'B' && !!item.bChoice && item.bNeeded === undefined;
}

/** Item sent to the customer and still without an answer. */
export function isAwaitingClient(item: OrderItem): boolean {
  return item.approvalState === 'pending' && !isAwaitingDisassembly(item);
}

/** Only approved work may be marked as done. */
export function canMarkDone(item: OrderItem): boolean {
  return item.approvalState === 'approved';
}

/**
 * A line whose price can be changed on its sheet: one the customer has seen — waiting for the answer or
 * agreed (a draft is edited whole) — with a price of its own: not a discount, not the customer's own part,
 * not a block B range still open.
 */
export function canReprice(item: OrderItem): boolean {
  if (item.kind === 'discount' || item.customerSupplied) return false;
  if (item.approvalState === 'approved') return true;
  return isAwaitingClient(item) && item.block !== 'B';
}

/** The price to store for a new price per unit with VAT, as the job shows it (kept to the fils: "VAT in the price"). */
export function unitGrossPrice(item: Pick<OrderItem, 'vatRateBp'>, unitGrossFils: number): LinePrice {
  return priceFromEntered(unitGrossFils, item.vatRateBp, item.vatRateBp > 0 ? 'incl' : 'none');
}

export function isActive(item: OrderItem): boolean {
  return item.approvalState !== 'declined' && item.approvalState !== 'cancelled';
}

export interface EstimateSummary {
  fixedGross: number; // certain: block A + everything approved
  minGross: number;
  maxGross: number; // fixed + open block B maximums
  recommendedGross: number; // open block C
  approvedGross: number;
  pendingGross: number; // waiting for the customer
  declinedGross: number;
}

export function summarize(items: OrderItem[]): EstimateSummary {
  const s: EstimateSummary = {
    fixedGross: 0,
    minGross: 0,
    maxGross: 0,
    recommendedGross: 0,
    approvedGross: 0,
    pendingGross: 0,
    declinedGross: 0,
  };
  let bMin = 0;
  let bMax = 0;
  for (const i of items) {
    const g = itemAmounts(i).gross;
    if (i.approvalState === 'cancelled') continue;
    if (i.approvalState === 'declined') {
      s.declinedGross += g;
      continue;
    }
    if (i.approvalState === 'approved') {
      s.approvedGross += g;
      s.fixedGross += g;
      continue;
    }
    if (i.block === 'A') s.fixedGross += g;
    else if (i.block === 'B') {
      const r = itemRangeGross(i);
      bMin += r.min;
      bMax += r.max;
    } else s.recommendedGross += g;
    if (isAwaitingClient(i)) s.pendingGross += i.block === 'B' ? itemRangeGross(i).max : g;
  }
  s.minGross = s.fixedGross + bMin;
  s.maxGross = s.fixedGross + bMax;
  return s;
}

/** Remaining "no-call" limit (gross fils) after items approved by limit. */
export function noCallLimitRemaining(limitFils: number, items: OrderItem[], decisions: ItemDecision[]): number {
  const byId = new Map(items.map((i) => [i.id, i]));
  let used = 0;
  for (const d of decisions) {
    if (d.via !== 'limit' || d.decision !== 'approve') continue;
    const item = byId.get(d.itemId);
    if (item) used += itemAmounts(item).gross;
  }
  return Math.max(0, limitFils - used);
}

/** Patch to apply to an item when the customer decides. */
export function decisionPatch(item: OrderItem, decision: DecisionKind): Partial<OrderItem> {
  switch (decision) {
    case 'approve':
      return { approvalState: 'approved' };
    case 'decline':
      return { approvalState: 'declined' };
    case 'call_me':
    case 'do_if_needed':
      if (item.block !== 'B') throw new Error('B-choice is only valid for block B items');
      return { bChoice: decision };
  }
}

export type BOutcome =
  | { kind: 'not_needed'; patch: Partial<OrderItem> }
  | { kind: 'auto_approved'; patch: Partial<OrderItem> }
  | { kind: 'needs_approval'; patch: Partial<OrderItem> };

/**
 * After disassembly the manager says whether a block B item is needed and at what net line price.
 * "do_if_needed" within the agreed maximum is approved automatically; otherwise it goes back to
 * draft and must be sent as a supplement.
 */
export function resolveBlockB(item: OrderItem, needed: boolean, actualNetFils: number): BOutcome {
  if (item.block !== 'B') throw new Error('Only block B items can be resolved');
  if (!needed) return { kind: 'not_needed', patch: { bNeeded: false, approvalState: 'cancelled' } };
  const qty = item.qty > 0 ? item.qty : 1;
  const unitPriceFils = roundFils(actualNetFils / qty);
  const max = item.priceMaxFils ?? Number.POSITIVE_INFINITY;
  // The actual price is a net one: a VAT-inclusive price typed earlier no longer applies.
  if (item.bChoice === 'do_if_needed' && actualNetFils <= max) {
    return { kind: 'auto_approved', patch: { bNeeded: true, unitPriceFils, unitGrossFils: undefined, approvalState: 'approved' } };
  }
  return { kind: 'needs_approval', patch: { bNeeded: true, unitPriceFils, unitGrossFils: undefined, bChoice: undefined, approvalState: 'draft' } };
}
