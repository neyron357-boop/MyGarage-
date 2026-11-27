import { addDays, dubaiDate, hoursBetween, nowIso, shiftDay } from './dates';
import type { Phase } from './flow';
import type { Debt, Order, OrderItem, Reminder, Vehicle } from './types';

/**
 * The day's to-do list across all the cars: what needs the manager now, read from the jobs' facts —
 * a car promised for today, a customer who has not answered, parts to order or to collect, a part to
 * return before the seller's deadline, work outside due back, a car ready and not collected, an overdue
 * debt, and the customers to write to (how is the car, time for a service). Nothing is typed in — but the manager's
 * own reminders (v0.74): what he set for himself is due here on its day. v0.74 too: a car booked for today.
 */
export type TaskKind = 'promised' | 'answer' | 'order' | 'pickup' | 'returnBy' | 'outsource' | 'collect' | 'debt' | 'followUp' | 'service' | 'booked' | 'reminder' | 'declined' | 'bookedTomorrow';
/** The kinds that are a message to the customer (a tap opens it, ready; × — not needed). */
export const CUSTOMER_KINDS: TaskKind[] = ['followUp', 'service', 'declined', 'bookedTomorrow'];

export interface Task {
  kind: TaskKind;
  /** Unique within the list. */
  key: string;
  orderId?: string;
  vehicleId: string;
  customerId: string;
  /** The moment it is about — when it is due, or since when it waits; the list goes by it. */
  at: string;
  /** Past its time: shown in red, first. */
  late: boolean;
  /** How many lines (parts to order or to collect). */
  count?: number;
  /** The line it is about (a part to return, work outside). */
  itemId?: string;
  supplierId?: string;
  amountFils?: number;
  /** A reminder: its record and its words. */
  reminderId?: string;
  text?: string;
}

export interface OpenJob {
  order: Pick<Order, 'id' | 'vehicleId' | 'customerId' | 'promisedReadyAt' | 'stageChangedAt' | 'bookedFor'> & Partial<Pick<Order, 'bookingRemindedAt'>>;
  phase: Phase;
  /** The customer can be written to (a booking reminded the evening before). */
  hasPhone?: boolean;
  items: OrderItem[];
  debts: Pick<Debt, 'id' | 'status' | 'dueDate' | 'amountFils'>[];
  /** When the lines waiting for the customer's answer were sent (the oldest). */
  waitingSince?: string;
}

export interface PastJob {
  order: Pick<Order, 'id' | 'vehicleId' | 'customerId' | 'closedAt' | 'outcome' | 'followedUpAt' | 'imported'> & Partial<Pick<Order, 'declinedOfferedAt'>>;
  items: Pick<OrderItem, 'titleEn' | 'titleRu' | 'kind' | 'approvalState'>[];
  /** The customer can be written to. */
  hasPhone: boolean;
}

export interface TodayInput {
  open: OpenJob[];
  /** Closed jobs (the app's and the history carried over). */
  past: PastJob[];
  vehicles: Map<string, Pick<Vehicle, 'id' | 'serviceRemindedAt'>>;
  warnHours: number;
  alertHours: number;
  /** The manager's own reminders (v0.74), not done yet. */
  reminders?: Pick<Reminder, 'id' | 'text' | 'at' | 'orderId' | 'doneAt'>[];
  now?: string;
}

/** Ask "how is the car?" this many days after it left, and not after the second week. */
export const FOLLOW_UP_DAYS = 3;
const FOLLOW_UP_UNTIL = 14;
/** An oil service is due again after about half a year (not reminded after more than a year). */
export const SERVICE_DAYS = 180;
export const SERVICE_UNTIL = 400;
/** Audit 27/11: what the customer declined on the car's last visit — offered again this many days after (not after `DECLINED_UNTIL`). */
export const DECLINED_DAYS = 30;
export const DECLINED_UNTIL = 60;
/** The customer reminded of a booking the day before, from this hour (Dubai). */
const BOOKED_EVE_UTC = 'T13:00:00.000Z';
/** A part's return deadline shows this many days ahead. */
const RETURN_AHEAD = 2;

const OIL = /\boil\b|масл/i;
/** A job that was an oil service (the reminder for the next one). */
export function wasOilService(items: PastJob['items']): boolean {
  return items.some((i) => i.kind !== 'discount' && i.approvalState === 'approved' && OIL.test(`${i.titleEn ?? ''} ${i.titleRu ?? ''}`));
}

/** The lines the customer said no to (a discount is not work): what can be offered again. */
export function declinedLines<T extends Pick<OrderItem, 'kind' | 'approvalState'>>(items: T[]): T[] {
  return items.filter((i) => i.kind !== 'discount' && i.kind !== 'fee' && i.approvalState === 'declined');
}

const working: Phase[] = ['look', 'price', 'wait', 'work'];
const bought = (i: OrderItem) => i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit' || i.procurementStatus === 'received';

export function todayTasks(input: TodayInput): Task[] {
  const now = input.now ?? nowIso();
  const today = dubaiDate(now);
  const tasks: Task[] = [];
  const openVehicles = new Set<string>();
  for (const j of input.open) {
    const o = j.order;
    openVehicles.add(o.vehicleId);
    const base = { orderId: o.id, vehicleId: o.vehicleId, customerId: o.customerId };
    const since = (at: string) => hoursBetween(at, now);
    // A booking tomorrow (audit 27/11): the customer reminded the day before — a message ready, from 17:00 Dubai.
    if (j.phase === 'booked' && o.bookedFor && j.hasPhone && !o.bookingRemindedAt && dubaiDate(o.bookedFor) === shiftDay(today, 1))
      tasks.push({ ...base, kind: 'bookedTomorrow', key: `bookedTomorrow:${o.id}`, at: `${today}${BOOKED_EVE_UTC}`, late: false });
    // A car booked for today (v0.74): due at its time; its time gone and the car not here — late.
    if (j.phase === 'booked' && o.bookedFor && dubaiDate(o.bookedFor) <= today) tasks.push({ ...base, kind: 'booked', key: `booked:${o.id}`, at: o.bookedFor, late: o.bookedFor < now });
    if (o.promisedReadyAt && working.includes(j.phase) && dubaiDate(o.promisedReadyAt) <= today)
      tasks.push({ ...base, kind: 'promised', key: `promised:${o.id}`, at: o.promisedReadyAt, late: o.promisedReadyAt < now });
    if (j.phase === 'wait' && j.waitingSince && since(j.waitingSince) >= input.warnHours)
      tasks.push({ ...base, kind: 'answer', key: `answer:${o.id}`, at: j.waitingSince, late: since(j.waitingSince) >= input.alertHours });
    // A price not told yet is no task of its own (v0.81, the user's brief: «убрать автоматические уведомления «Нужно
    // отправить цену»… напоминание — только по явному действию для конкретного заказа»): the job says it itself (its quote
    // «not sent»), a reminder is set on the job by hand.
    // Parts the customer agreed to and nobody ordered yet.
    const toOrder = j.items.filter((i) => i.kind === 'part' && !i.customerSupplied && i.approvalState === 'approved' && !i.done && (i.procurementStatus ?? 'needed') === 'needed');
    if (toOrder.length) {
      const at = toOrder.map((i) => i.createdAt).sort()[0];
      tasks.push({ ...base, kind: 'order', key: `order:${o.id}`, at, late: since(at) >= input.alertHours, count: toOrder.length });
    }
    // Ordered parts due today (or a day after they were ordered, when no day was said).
    const toCollect = j.items.filter((i) => i.kind === 'part' && !i.customerSupplied && i.approvalState !== 'declined' && !i.done && (i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit'));
    const due = toCollect.map((i) => ({ i, day: i.expectedAt?.slice(0, 10) ?? dubaiDate(addDays(i.orderedAt ?? i.createdAt, 1)) })).filter((x) => x.day <= today);
    if (due.length) {
      const day = due.map((x) => x.day).sort()[0];
      const suppliers = new Set(due.map((x) => x.i.supplierId ?? ''));
      tasks.push({ ...base, kind: 'pickup', key: `pickup:${o.id}`, at: `${day}T00:00:00.000Z`, late: day < today, count: due.length, supplierId: suppliers.size === 1 ? due[0].i.supplierId : undefined });
    }
    // A bought part not fitted yet, the seller's return deadline close: return it or decide.
    for (const i of j.items) {
      if (i.kind !== 'part' || !i.returnBy || i.noReturn || i.done || !bought(i)) continue;
      if (i.returnBy > shiftDay(today, RETURN_AHEAD)) continue;
      tasks.push({ ...base, kind: 'returnBy', key: `return:${i.id}`, at: `${i.returnBy}T00:00:00.000Z`, late: i.returnBy < today, itemId: i.id, supplierId: i.supplierId });
    }
    // Work outside due back.
    for (const i of j.items) {
      const out = i.outsource;
      if (!out || out.state !== 'out' || i.approvalState === 'declined' || i.approvalState === 'cancelled') continue;
      const day = out.dueAt ?? (out.sentAt ? dubaiDate(addDays(out.sentAt, 1)) : today);
      if (day > today) continue;
      tasks.push({ ...base, kind: 'outsource', key: `outsource:${i.id}`, at: `${day}T00:00:00.000Z`, late: day < today, itemId: i.id, supplierId: out.supplierId });
    }
    // Ready and not collected for a day.
    if ((j.phase === 'out' || j.phase === 'pay') && since(o.stageChangedAt) >= input.alertHours)
      tasks.push({ ...base, kind: 'collect', key: `collect:${o.id}`, at: o.stageChangedAt, late: since(o.stageChangedAt) >= input.alertHours * 3 });
    for (const d of j.debts)
      if (d.status === 'open' && d.dueDate <= today)
        tasks.push({ ...base, kind: 'debt', key: `debt:${d.id}`, at: `${d.dueDate}T00:00:00.000Z`, late: d.dueDate < today, amountFils: d.amountFils });
  }

  // What the manager set for himself (v0.74): from its day on, until it is done; its time gone — late.
  for (const r of input.reminders ?? []) {
    if (r.doneAt || dubaiDate(r.at) > today) continue;
    tasks.push({ kind: 'reminder', key: `reminder:${r.id}`, orderId: r.orderId, vehicleId: '', customerId: '', at: r.at, late: r.at <= now, reminderId: r.id, text: r.text });
  }

  // "How is the car?" a few days after it left (the app's own jobs, repaired, with a phone to write to).
  const daysAgo = (iso: string) => hoursBetween(iso, now) / 24;
  for (const p of input.past) {
    const o = p.order;
    if (!o.closedAt || o.imported || o.followedUpAt || o.outcome !== 'completed' || !p.hasPhone) continue;
    const d = daysAgo(o.closedAt);
    if (d < FOLLOW_UP_DAYS || d > FOLLOW_UP_UNTIL) continue;
    tasks.push({ kind: 'followUp', key: `followUp:${o.id}`, orderId: o.id, vehicleId: o.vehicleId, customerId: o.customerId, at: addDays(o.closedAt, FOLLOW_UP_DAYS), late: false });
  }

  // Time for the next oil service: the car's last job was one, about half a year ago, and it is not here now.
  const last = new Map<string, PastJob>();
  for (const p of input.past) {
    const prev = last.get(p.order.vehicleId);
    if (p.order.closedAt && (!prev || (prev.order.closedAt ?? '') < p.order.closedAt)) last.set(p.order.vehicleId, p);
  }
  for (const [vehicleId, p] of last) {
    const o = p.order;
    if (!o.closedAt || openVehicles.has(vehicleId) || !p.hasPhone || !wasOilService(p.items)) continue;
    const d = daysAgo(o.closedAt);
    if (d < SERVICE_DAYS || d > SERVICE_UNTIL) continue;
    const reminded = input.vehicles.get(vehicleId)?.serviceRemindedAt;
    if (reminded && reminded > o.closedAt) continue;
    tasks.push({ kind: 'service', key: `service:${vehicleId}`, orderId: o.id, vehicleId, customerId: o.customerId, at: addDays(o.closedAt, SERVICE_DAYS), late: false });
  }

  // Audit 27/11: the lines declined on the car's last visit, offered again a month later (the car not here, not offered yet).
  for (const [vehicleId, p] of last) {
    const o = p.order;
    if (!o.closedAt || o.imported || o.declinedOfferedAt || openVehicles.has(vehicleId) || !p.hasPhone) continue;
    const d = daysAgo(o.closedAt);
    if (d < DECLINED_DAYS || d > DECLINED_UNTIL) continue;
    const n = declinedLines(p.items).length;
    if (n) tasks.push({ kind: 'declined', key: `declined:${o.id}`, orderId: o.id, vehicleId, customerId: o.customerId, at: addDays(o.closedAt, DECLINED_DAYS), late: false, count: n });
  }

  // Late first, then by time; the customers to write to after the cars on the ground.
  const rank = (t: Task) => (t.late ? 0 : CUSTOMER_KINDS.includes(t.kind) ? 2 : 1);
  return tasks.sort((a, b) => rank(a) - rank(b) || a.at.localeCompare(b.at));
}
