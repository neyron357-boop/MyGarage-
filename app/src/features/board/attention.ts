import { dubaiDate, hoursBetween, nowIso } from '../../domain/dates';
import { isAwaitingClient } from '../../domain/items';
import { bundleAmountDue, storageDaysOver, type OrderBundle } from '../../services/orders';

export type AttentionKind =
  | 'waitingClient'
  | 'estimateExpired'
  | 'notifyReady'
  | 'storage'
  | 'pickupParts'
  | 'noShow'
  | 'intakeUnfinished'
  | 'debtOverdue';

export interface AttentionItem {
  kind: AttentionKind;
  orderId: string;
  severity: 1 | 2 | 3; // 3 = most urgent
  params: Record<string, string | number>;
  bundle: OrderBundle;
}

/** What the manager should act on right now, most urgent first. */
export function attentionItems(bundles: OrderBundle[], now = nowIso()): AttentionItem[] {
  const out: AttentionItem[] = [];
  const today = dubaiDate(now);
  for (const b of bundles) {
    const { order, settings } = b;
    const push = (kind: AttentionKind, severity: 1 | 2 | 3, params: Record<string, string | number> = {}) =>
      out.push({ kind, orderId: order.id, severity, params, bundle: b });

    const waiting = b.items.filter(isAwaitingClient);
    if (waiting.length) {
      const versions = b.versions.filter((v) => waiting.some((i) => i.lastVersionId === v.id));
      const expired = versions.some((v) => v.validUntil < now);
      const since = versions.map((v) => v.sentAt).sort()[0];
      if (expired) push('estimateExpired', 2);
      else if (since) {
        const h = hoursBetween(since, now);
        if (h >= settings.boardWarnHours) push('waitingClient', h >= settings.boardAlertHours ? 3 : 2, { hours: Math.floor(h) });
      }
    }
    if (order.stage === 'ready') {
      const told = b.messages.some((m) => m.template === 'carReady' && (!order.readyAt || m.createdAt >= order.readyAt));
      if (!told) push('notifyReady', 2);
      const days = storageDaysOver(b, now);
      if (days > 0) push('storage', 3, { days });
    }
    const pickup = b.items.filter(
      (i) => i.kind === 'part' && i.approvalState === 'approved' && (i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit') && (!i.expectedAt || i.expectedAt <= today),
    );
    if (pickup.length && !['delivered', 'closed', 'cancelled'].includes(order.stage)) push('pickupParts', 1, { n: pickup.length });
    if (order.stage === 'booked' && order.bookedFor && order.bookedFor < now && dubaiDate(order.bookedFor) === today) {
      push('noShow', 1, { time: order.bookedFor });
    }
    if (order.stage === 'intake' && hoursBetween(order.stageChangedAt, now) >= 1) push('intakeUnfinished', 1);
    if (order.stage === 'delivered') {
      const debt = b.debts.find((d) => d.status === 'open');
      if (debt && debt.dueDate < today && bundleAmountDue(b) > 0) push('debtOverdue', 3, { date: debt.dueDate });
    }
  }
  return out.sort((a, c) => c.severity - a.severity);
}
