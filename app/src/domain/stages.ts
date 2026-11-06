import type { Order, OrderItem, Stage } from './types';
import { isAwaitingClient } from './items';

export const STAGES: Stage[] = [
  'booked',
  'intake',
  'diagnostics',
  'awaiting_approval',
  'awaiting_parts',
  'in_progress',
  'quality_check',
  'ready',
  'delivered',
  'closed',
];

/** Stages that appear as columns on the board. */
export const BOARD_STAGES: Stage[] = [
  'booked',
  'intake',
  'diagnostics',
  'awaiting_approval',
  'awaiting_parts',
  'in_progress',
  'quality_check',
  'ready',
  'delivered',
];

export interface StageContext {
  order: Order;
  items: OrderItem[];
  intakeSigned: boolean;
  sentVersions: number;
  handoverSigned: boolean;
  amountDueFils: number;
  debtSigned: boolean;
  qcComplete: boolean;
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

const FORWARD: Record<Stage, Stage[]> = {
  booked: ['intake', 'cancelled'],
  intake: ['diagnostics'],
  diagnostics: ['awaiting_approval'],
  awaiting_approval: ['awaiting_parts', 'in_progress', 'ready'],
  awaiting_parts: ['in_progress'],
  in_progress: ['awaiting_parts', 'quality_check'],
  quality_check: ['ready'],
  ready: ['delivered'],
  delivered: ['closed'],
  closed: [],
  cancelled: [],
};

export function stageIndex(s: Stage): number {
  return STAGES.indexOf(s);
}

/** Going back is allowed (with a reason) between diagnostics and ready. */
export function isBackward(from: Stage, to: Stage): boolean {
  const fi = stageIndex(from);
  const ti = stageIndex(to);
  return (
    fi > ti &&
    ti >= stageIndex('diagnostics') &&
    fi <= stageIndex('ready') &&
    from !== 'cancelled' &&
    to !== 'cancelled'
  );
}

function approvedParts(items: OrderItem[]): OrderItem[] {
  return items.filter((i) => i.kind === 'part' && i.approvalState === 'approved' && !i.customerSupplied);
}

export function partsReady(items: OrderItem[]): boolean {
  return approvedParts(items).every((i) =>
    ['received', 'installed', 'cancelled', 'returned'].includes(i.procurementStatus ?? 'needed'),
  );
}

export function checkTransition(from: Stage, to: Stage, ctx: StageContext): TransitionCheck {
  if (from === to) return { ok: false, reason: 'stageErr.same' };
  if (isBackward(from, to)) return { ok: true };
  if (!FORWARD[from].includes(to)) return { ok: false, reason: 'stageErr.notAllowed' };
  const approved = ctx.items.filter((i) => i.approvalState === 'approved');
  switch (to) {
    case 'cancelled':
      return { ok: true };
    case 'intake':
      return { ok: true };
    case 'diagnostics':
      return ctx.intakeSigned ? { ok: true } : { ok: false, reason: 'stageErr.intakeNotSigned' };
    case 'awaiting_approval':
      return ctx.sentVersions > 0 ? { ok: true } : { ok: false, reason: 'stageErr.noVersionSent' };
    case 'awaiting_parts':
      return approved.length > 0 ? { ok: true } : { ok: false, reason: 'stageErr.nothingApproved' };
    case 'in_progress':
      if (approved.length === 0) return { ok: false, reason: 'stageErr.nothingApproved' };
      return partsReady(ctx.items) ? { ok: true } : { ok: false, reason: 'stageErr.partsMissing' };
    case 'quality_check':
      if (ctx.items.some(isAwaitingClient)) return { ok: false, reason: 'stageErr.awaitingClient' };
      return approved.every((i) => i.done) ? { ok: true } : { ok: false, reason: 'stageErr.workNotDone' };
    case 'ready':
      if (from === 'awaiting_approval') {
        return ctx.order.outcome === 'repair_declined' ? { ok: true } : { ok: false, reason: 'stageErr.notAllowed' };
      }
      return ctx.qcComplete ? { ok: true } : { ok: false, reason: 'stageErr.qcIncomplete' };
    case 'delivered':
      if (!ctx.handoverSigned) return { ok: false, reason: 'stageErr.handoverNotSigned' };
      return ctx.amountDueFils <= 0 || ctx.debtSigned ? { ok: true } : { ok: false, reason: 'stageErr.unpaid' };
    case 'closed':
      return ctx.amountDueFils <= 0 ? { ok: true } : { ok: false, reason: 'stageErr.unpaid' };
    default:
      return { ok: false, reason: 'stageErr.notAllowed' };
  }
}
