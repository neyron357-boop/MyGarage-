import { db } from '../db/db';
import { addDays, hoursBetween, nowIso } from '../domain/dates';
import { isAwaitingClient } from '../domain/items';
import { FOLLOW_UP_DAYS, SERVICE_DAYS, SERVICE_UNTIL, todayTasks, type OpenJob, type PastJob, type Task } from '../domain/today';
import type { Customer, Order, Reminder, Vehicle } from '../domain/types';
import { phaseOf } from './flow';
import type { OrderBundle } from './orders';

/** What the Today list needs from a job on the board. */
export function openJobOf(b: OrderBundle): OpenJob {
  const waiting = b.items.filter(isAwaitingClient);
  let since: string | undefined;
  for (const i of waiting) {
    const v = b.versions.find((x) => x.id === i.lastVersionId);
    if (v && (!since || v.sentAt < since)) since = v.sentAt;
  }
  return { order: b.order, phase: phaseOf(b), items: b.items, debts: b.debts, waitingSince: since };
}

/**
 * The jobs that already left, for the customers to write to: those closed in the last weeks ("how is
 * the car?") and each car's last job (time for the next service). History from Eaglecart counts for
 * the service, not for "how is the car".
 */
export async function loadPast(now = nowIso()): Promise<{ past: PastJob[]; vehicles: Map<string, Vehicle>; customers: Map<string, Customer> }> {
  const closed = await db.orders.where('stage').equals('closed').toArray();
  const since = addDays(now, -420);
  const recent = closed.filter((o) => (o.closedAt ?? o.updatedAt) >= since);
  // The lines tell one thing only — whether a car's last job was an oil service, half a year to a year ago (the
  // reminder, `todayTasks`): only those jobs' lines are read (v0.37; "how is the car?" needs none), a day either side
  // of that time.
  const last = new Map<string, Order>();
  for (const o of recent) {
    const prev = last.get(o.vehicleId);
    if (o.closedAt && (!prev || (prev.closedAt ?? '') < o.closedAt)) last.set(o.vehicleId, o);
  }
  const wanted = [...last.values()].filter((o) => {
    const days = hoursBetween(o.closedAt!, now) / 24;
    return days >= SERVICE_DAYS - 1 && days <= SERVICE_UNTIL + 1;
  });
  const [items, customers, vehicles] = await Promise.all([
    wanted.length ? db.items.where('orderId').anyOf(wanted.map((o) => o.id)).toArray() : [],
    db.customers.bulkGet([...new Set(recent.map((o) => o.customerId))]),
    db.vehicles.bulkGet([...new Set(recent.map((o) => o.vehicleId))]),
  ]);
  const byOrder = new Map<string, PastJob['items']>();
  for (const i of items) byOrder.set(i.orderId, [...(byOrder.get(i.orderId) ?? []), i]);
  const phone = new Map(customers.filter((c): c is Customer => !!c).map((c) => [c.id, !!(c.phone || c.whatsapp)]));
  return {
    past: recent.map((o) => ({ order: o, items: byOrder.get(o.id) ?? [], hasPhone: phone.get(o.customerId) ?? false })),
    vehicles: new Map(vehicles.filter((v): v is Vehicle => !!v).map((v) => [v.id, v])),
    customers: new Map(customers.filter((c): c is Customer => !!c).map((c) => [c.id, c])),
  };
}

/**
 * «Сегодня» of the jobs on the board, the jobs that left, and (v0.74) the manager's own reminders. `warnHours` — given
 * by the notifications' plan (services/notify.ts): 0, a thing is listed as soon as it is so (how long to wait before
 * saying it is the notification's own rule).
 */
export function tasksFor(bundles: OrderBundle[], past: Awaited<ReturnType<typeof loadPast>> | undefined, now = nowIso(), reminders: Reminder[] = [], warnHours?: number): Task[] {
  const s = bundles[0]?.settings;
  return todayTasks({
    open: bundles.filter((b) => !b.order.archivedAt).map(openJobOf),
    past: past?.past ?? [],
    vehicles: past?.vehicles ?? new Map(),
    warnHours: warnHours ?? s?.boardWarnHours ?? 2,
    alertHours: s?.boardAlertHours ?? 24,
    reminders,
    now,
  });
}

/** "How is the car?" asked (or not needed): the job leaves the Today list. */
export async function markFollowedUp(orderId: string): Promise<void> {
  // A closed job: only this mark changes (its stage, documents and money stay).
  await db.orders.update(orderId, { followedUpAt: nowIso() });
}

/** "Time for a service" sent (or not needed): the car leaves the list until its next job. */
export async function markServiceReminded(vehicleId: string): Promise<void> {
  await db.vehicles.update(vehicleId, { serviceRemindedAt: nowIso() });
}

export { FOLLOW_UP_DAYS };
