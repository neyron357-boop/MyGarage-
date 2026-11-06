import { isAwaitingClient, isAwaitingDisassembly } from '../../domain/items';
import { checkTransition, partsReady } from '../../domain/stages';
import { bundleAmountDue, stageContext, type OrderBundle } from '../../services/orders';

export type StepAction =
  | 'intake'
  | 'estimate'
  | 'recordAnswer'
  | 'resend'
  | 'toParts'
  | 'stageAwaitingParts'
  | 'stageInProgress'
  | 'toWork'
  | 'problem'
  | 'stageQc'
  | 'qc'
  | 'handover'
  | 'notifyReady'
  | 'payment'
  | 'claim'
  | 'noShow'
  | 'declineRepair';

export interface NextStep {
  /** i18n key under `next.` */
  title: string;
  params?: Record<string, string | number>;
  /** Why the job cannot move on yet (i18n key under `next.` or `stageErr.`). */
  blocker?: string;
  blockerParams?: Record<string, string | number>;
  primary?: { label: string; action: StepAction };
  secondary?: { label: string; action: StepAction }[];
  tone: 'cobalt' | 'orange' | 'green' | 'gray' | 'red';
}

/** The single most useful thing to do with a job right now. */
export function nextStep(b: OrderBundle): NextStep {
  const { order, items } = b;
  const ctx = stageContext(b);
  const awaiting = items.filter(isAwaitingClient);
  const bOpen = items.filter(isAwaitingDisassembly);
  const approved = items.filter((i) => i.approvalState === 'approved');
  const drafts = items.filter((i) => i.approvalState === 'draft');
  const missingParts = approved.filter(
    (i) => i.kind === 'part' && !i.customerSupplied && !['received', 'installed', 'cancelled', 'returned'].includes(i.procurementStatus ?? 'needed'),
  );
  const told = b.messages.some((m) => m.template === 'carReady' && (!order.readyAt || m.createdAt >= order.readyAt));

  switch (order.stage) {
    case 'booked':
      return { title: 'next.booked', tone: 'cobalt', primary: { label: 'order.startIntake', action: 'intake' }, secondary: [{ label: 'next.noShow', action: 'noShow' }] };
    case 'intake':
      return { title: 'next.intake', tone: 'cobalt', primary: { label: b.intake ? 'order.continueIntake' : 'order.startIntake', action: 'intake' } };
    case 'diagnostics':
      if (items.length === 0) return { title: 'next.diagEmpty', tone: 'cobalt', primary: { label: 'order.makeEstimate', action: 'estimate' } };
      return {
        title: 'next.diagSend',
        params: { n: drafts.length },
        tone: 'cobalt',
        primary: { label: 'next.openEstimate', action: 'estimate' },
        secondary: [{ label: 'order.declineRepair', action: 'declineRepair' }],
      };
    case 'awaiting_approval': {
      if (awaiting.length)
        return {
          title: 'next.waitAnswer',
          params: { n: awaiting.length },
          tone: 'orange',
          primary: { label: 'decision.record', action: 'recordAnswer' },
          secondary: [
            { label: 'next.resend', action: 'resend' },
            { label: 'order.declineRepair', action: 'declineRepair' },
          ],
        };
      if (approved.length === 0)
        return { title: 'next.allDeclined', tone: 'red', primary: { label: 'order.declineRepair', action: 'declineRepair' }, secondary: [{ label: 'next.openEstimate', action: 'estimate' }] };
      if (!partsReady(items))
        return {
          title: 'next.orderParts',
          params: { n: missingParts.length },
          tone: 'orange',
          primary: { label: 'order.waitParts', action: 'stageAwaitingParts' },
          secondary: [{ label: 'next.openParts', action: 'toParts' }],
        };
      return { title: 'next.startWork', tone: 'cobalt', primary: { label: 'order.startWork', action: 'stageInProgress' } };
    }
    case 'awaiting_parts':
      if (!partsReady(items))
        return { title: 'next.receiveParts', params: { n: missingParts.length }, tone: 'orange', primary: { label: 'next.openParts', action: 'toParts' } };
      return { title: 'next.partsHere', tone: 'cobalt', primary: { label: 'order.startWork', action: 'stageInProgress' } };
    case 'in_progress': {
      const done = approved.filter((i) => i.done).length;
      if (awaiting.length)
        return {
          title: 'next.waitSupplement',
          params: { n: awaiting.length },
          tone: 'orange',
          primary: { label: 'decision.record', action: 'recordAnswer' },
          secondary: [{ label: 'next.resend', action: 'resend' }],
        };
      if (bOpen.length)
        return { title: 'next.resolveB', params: { n: bOpen.length }, tone: 'cobalt', primary: { label: 'next.openWork', action: 'toWork' }, secondary: [{ label: 'order.foundProblem', action: 'problem' }] };
      const check = checkTransition('in_progress', 'quality_check', ctx);
      if (!check.ok)
        return {
          title: 'next.doWork',
          params: { done, total: approved.length },
          tone: 'cobalt',
          primary: { label: 'next.openWork', action: 'toWork' },
          secondary: [{ label: 'order.foundProblem', action: 'problem' }],
        };
      return { title: 'next.workFinished', tone: 'green', primary: { label: 'order.workDone', action: 'stageQc' }, secondary: [{ label: 'order.foundProblem', action: 'problem' }] };
    }
    case 'quality_check':
      return { title: 'next.qc', tone: 'cobalt', primary: { label: 'qc.title', action: 'qc' } };
    case 'ready':
      return {
        title: told ? 'next.handover' : 'next.readyNotify',
        tone: 'green',
        primary: told ? { label: 'order.handover', action: 'handover' } : { label: 'order.notifyReady', action: 'notifyReady' },
        secondary: told ? [{ label: 'order.notifyReady', action: 'notifyReady' }] : [{ label: 'order.handover', action: 'handover' }],
      };
    case 'delivered': {
      const due = bundleAmountDue(b);
      return { title: 'next.collectDebt', params: { amount: due }, tone: 'red', primary: { label: 'payment.accept', action: 'payment' } };
    }
    case 'closed':
      return { title: 'next.closed', tone: 'gray', secondary: [{ label: 'claim.open', action: 'claim' }] };
    case 'cancelled':
      return { title: 'next.cancelled', tone: 'gray' };
  }
}
