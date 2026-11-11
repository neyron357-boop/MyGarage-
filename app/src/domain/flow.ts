import { activeInvoice } from './invoice';
import { isAwaitingClient, itemAmounts } from './items';
import type { Invoice, Order, OrderItem, Stage } from './types';

/**
 * Where a job stands for the manager — the one thing to do with it now. It is read from the job's
 * facts (lines, answers, invoice, money), not typed in: the app moves the job along by itself.
 *
 * booked — an appointment · look — the car is here, the mechanic looks · price — lines the customer
 * has not heard yet · wait — sent, waiting for the answer · work — agreed, being done · pay — invoice
 * out, money due · out — nothing due, hand the car over · debt — gone with money due.
 */
export type Phase = 'booked' | 'look' | 'price' | 'wait' | 'work' | 'pay' | 'out' | 'debt' | 'closed' | 'cancelled';

export interface FlowFacts {
  order: Pick<Order, 'stage' | 'outcome'>;
  items: OrderItem[];
  invoices: Invoice[];
  /** Money still due (invoice or agreed total minus payments). */
  dueFils: number;
}

const billable = (i: OrderItem) => i.kind !== 'discount';

/** Lines that still count: not declined and not cancelled. */
export function liveLines(items: OrderItem[]): OrderItem[] {
  return items.filter((i) => i.approvalState === 'draft' || i.approvalState === 'pending' || i.approvalState === 'approved');
}

export function jobPhase(f: FlowFacts): Phase {
  const { stage } = f.order;
  if (stage === 'cancelled') return 'cancelled';
  if (stage === 'closed') return 'closed';
  if (stage === 'booked') return 'booked';
  if (stage === 'delivered') return f.dueFils > 0 ? 'debt' : 'out';
  if (activeInvoice(f.invoices)) return f.dueFils > 0 ? 'pay' : 'out';
  if (f.items.some(isAwaitingClient)) return 'wait';
  if (f.items.some((i) => i.approvalState === 'draft' && billable(i))) return 'price';
  if (f.items.some((i) => i.approvalState === 'approved' && billable(i))) return 'work';
  // The customer refused the repair: nothing left to do but hand the car back.
  if (f.order.outcome === 'repair_declined') return 'out';
  return 'look';
}

/** Nothing to charge for: no line that still counts has an amount. */
export function nothingToBill(items: OrderItem[]): boolean {
  return !liveLines(items).some((i) => itemAmounts(i).gross !== 0);
}

const WALK: Stage[] = ['intake', 'diagnostics', 'awaiting_approval', 'awaiting_parts', 'in_progress'];

/**
 * The stage a job should stand on for its phase (null — leave it). Jobs only move forward by
 * themselves: agreed work waits for its parts, then is "in progress".
 */
export function flowStage(stage: Stage, phase: Phase, partsOk: boolean): Stage | null {
  const at = WALK.indexOf(stage);
  if (at < 0) return null;
  const ahead = (s: Stage) => (at < WALK.indexOf(s) ? s : null);
  switch (phase) {
    case 'look':
    case 'price':
      return ahead('diagnostics');
    case 'wait':
      return ahead('awaiting_approval');
    case 'work': {
      // Once the work has started it stays "in progress": a part still on its way does not pull it back.
      if (stage === 'in_progress') return null;
      const want: Stage = partsOk ? 'in_progress' : 'awaiting_parts';
      return want === stage ? null : want;
    }
    default:
      return null;
  }
}

/** The next stage to try on the way from `stage` to `want` when the direct move is not allowed. */
export function stepToward(stage: Stage, want: Stage): Stage | null {
  const at = WALK.indexOf(stage);
  const to = WALK.indexOf(want);
  return at >= 0 && to > at + 1 ? WALK[at + 1] : null;
}

/** When anything last happened on a job (its stage, a line, a payment, a photo, the journal): the board puts the freshest first. */
export function lastChange(j: {
  order: { createdAt: string; updatedAt?: string; stageChangedAt?: string };
  events?: { at: string }[];
  items?: { createdAt: string; doneAt?: string; orderedAt?: string; receivedAt?: string }[];
  payments?: { receivedAt: string }[];
  media?: { createdAt: string }[];
}): string {
  let last = j.order.createdAt;
  const see = (at?: string) => {
    if (at && at > last) last = at;
  };
  see(j.order.updatedAt);
  see(j.order.stageChangedAt);
  j.events?.forEach((e) => see(e.at));
  j.items?.forEach((i) => [i.createdAt, i.doneAt, i.orderedAt, i.receivedAt].forEach(see));
  j.payments?.forEach((p) => see(p.receivedAt));
  j.media?.forEach((m) => see(m.createdAt));
  return last;
}
