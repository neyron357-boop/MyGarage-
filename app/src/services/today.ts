import { db } from '../db/db';
import { addDays, dubaiTime, formatDate, hoursBetween, nowIso } from '../domain/dates';
import { isAwaitingClient, itemTitle } from '../domain/items';
import { declinedLines, DECLINED_DAYS, DECLINED_UNTIL, FOLLOW_UP_DAYS, SERVICE_DAYS, SERVICE_UNTIL, todayTasks, type OpenJob, type PastJob, type Task } from '../domain/today';
import type { Customer, Lang, Order, Reminder, Vehicle } from '../domain/types';
import { formatKm } from '../domain/odometer';
import { serviceForecast, SERVICE_MIN_DAYS, type KmPoint, type ServiceForecast } from '../domain/serviceDue';
import type { SimpleTemplate } from './messages';
import { mileageOfJob } from './mileage';
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
  return { order: b.order, phase: phaseOf(b), items: b.items, debts: b.debts, waitingSince: since, hasPhone: !!(b.customer?.phone || b.customer?.whatsapp) };
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
  // The next service by the mileage (audit 27/11, domain/serviceDue.ts): each car's pace from the mileage of its visits.
  const points = new Map<string, KmPoint[]>();
  for (const o of closed) {
    const km = mileageOfJob(o);
    if (km !== undefined) points.set(o.vehicleId, [...(points.get(o.vehicleId) ?? []), { at: o.arrivedAt || o.createdAt, km }]);
  }
  const kmOf = new Map<string, ServiceForecast>();
  for (const o of last.values()) {
    const km = mileageOfJob(o);
    const f = km === undefined ? undefined : serviceForecast(points.get(o.vehicleId) ?? [], { at: o.closedAt!, km }, now);
    if (f) kmOf.set(o.id, f);
  }
  const wanted = [...last.values()].filter((o) => {
    const days = hoursBetween(o.closedAt!, now) / 24;
    // …and (audit 27/11) a month after, for the lines declined on it; and the service due sooner by the mileage.
    const byKm = kmOf.get(o.id);
    return (days >= SERVICE_DAYS - 1 && days <= SERVICE_UNTIL + 1) || (days >= DECLINED_DAYS - 1 && days <= DECLINED_UNTIL + 1) || (!!byKm && byKm.dueAt <= now && days >= SERVICE_MIN_DAYS - 1);
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
    past: recent.map((o) => ({ order: o, items: byOrder.get(o.id) ?? [], hasPhone: phone.get(o.customerId) ?? false, ...(kmOf.has(o.id) ? { km: kmOf.get(o.id) } : {}) })),
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

/**
 * The customer's message of a «Сегодня» thing: "how is the car?" — with the Google review link when the garage has one,
 * to every customer alike (audit 27/11: asking only the happy ones is «review gating», which Google's rules forbid);
 * "time for a service"; the lines declined last time, by name; tomorrow's booking, its time.
 */
export function customerMessage(task: Pick<Task, 'kind' | 'at' | 'kmNow' | 'kmAt' | 'expires'>, lang: Lang, mapsUrl: string | undefined, items: PastJob['items'], bookedFor?: string): { tpl: SimpleTemplate; vars: Record<string, string> } {
  switch (task.kind) {
    case 'service':
      // By the mileage (audit 27/11): about how far the car has gone since its last service here.
      return task.kmNow && task.kmAt ? { tpl: 'serviceDueKm', vars: { km: formatKm(Math.max(0, task.kmNow - task.kmAt)), lastKm: formatKm(task.kmAt) } } : { tpl: 'serviceDue', vars: {} };
    case 'declined':
      return { tpl: 'declinedOffer', vars: { lines: declinedLines(items).map((i) => itemTitle(i, lang)).filter(Boolean).join(', ') } };
    case 'bookedTomorrow':
      return { tpl: 'bookedTomorrow', vars: { time: dubaiTime(bookedFor ?? task.at) } };
    case 'mulkiya':
      return { tpl: 'mulkiyaDue', vars: { date: formatDate(task.expires) } };
    default:
      return mapsUrl?.trim() ? { tpl: 'reviewRequest', vars: { link: mapsUrl.trim() } } : { tpl: 'followUp', vars: {} };
  }
}

/** "How is the car?" asked (or not needed): the job leaves the Today list. */
export async function markFollowedUp(orderId: string): Promise<void> {
  // A closed job: only this mark changes (its stage, documents and money stay).
  await db.orders.update(orderId, { followedUpAt: nowIso() });
}

/** The declined lines offered again (or not needed, audit 27/11): the job leaves the Today list. */
export async function markDeclinedOffered(orderId: string): Promise<void> {
  await db.orders.update(orderId, { declinedOfferedAt: nowIso() });
}

/** The customer reminded of tomorrow's booking (or not needed, audit 27/11). */
export async function markBookingReminded(orderId: string): Promise<void> {
  await db.orders.update(orderId, { bookingRemindedAt: nowIso() });
}

/** The Mulkiya's expiry told (or not needed, audit 27/11): not again for that day — a new expiry is told again. */
export async function markMulkiyaReminded(vehicleId: string, expires: string | undefined): Promise<void> {
  if (expires) await db.vehicles.update(vehicleId, { regRemindedFor: expires });
}

/** "Time for a service" sent (or not needed): the car leaves the list until its next job. */
export async function markServiceReminded(vehicleId: string): Promise<void> {
  await db.vehicles.update(vehicleId, { serviceRemindedAt: nowIso() });
}

export { FOLLOW_UP_DAYS };
