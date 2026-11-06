import { hoursBetween, nowIso } from '../../domain/dates';
import { isAwaitingClient } from '../../domain/items';
import { partsReady } from '../../domain/stages';
import { bundleAmountDue, storageDaysOver, type OrderBundle } from '../../services/orders';
import type { FlagInfo } from '../../ui/components';

export function orderFlags(b: OrderBundle, now = nowIso()): { flags: FlagInfo; waitingHours?: number } {
  const waiting = b.items.filter(isAwaitingClient);
  let since: string | undefined;
  for (const i of waiting) {
    const v = b.versions.find((x) => x.id === i.lastVersionId);
    if (v && (!since || v.sentAt < since)) since = v.sentAt;
  }
  const flags: FlagInfo = {
    waitingClientSince: since,
    waitingParts: !partsReady(b.items) && !['delivered', 'closed', 'cancelled'].includes(b.order.stage),
    debt: ['delivered', 'closed'].includes(b.order.stage) && bundleAmountDue(b) > 0,
    incident: b.incidents.some((i) => i.status === 'open'),
    warranty: !!b.order.warrantyOfOrderId,
    storageDays: storageDaysOver(b, now) || undefined,
  };
  return { flags, waitingHours: since ? hoursBetween(since, now) : undefined };
}
