import { dubaiDate, nowIso, onDubaiDay } from './dates';
import type { Invoice, Order, Payment } from './types';

/*
 * A job typed in after the fact (v0.53, the user: «возможность добавлять работы и инвойс задним числом — например,
 * забыли добавить работу, которая была месяц назад»): the job has the day it was (`arrivedAt`, `createdAt` on that day,
 * `Order.backdated`); its invoice is issued on the day it was (offered at «Готово»), its payment is offered on the
 * invoice's day, and each step it goes through is stamped with the last of its own moments — so the month's report, the
 * VAT, the archive and the car's history put it where it belongs, not on the day it was typed.
 */

/** The day of a job: the day the car came (for a job typed in later — the day it was). */
export function jobDay(order: Pick<Order, 'arrivedAt' | 'createdAt'>): string {
  return dubaiDate(order.arrivedAt ?? order.createdAt);
}

/** A moment on a day: now, or — on an earlier day — that day at the time it is typed. */
export function atDay(day: string | undefined, now: string = nowIso()): string {
  return day && day !== dubaiDate(now) ? onDubaiDay(now, day) : now;
}

/** The latest day a job can be moved to: not after today, nor after its first invoice or payment. */
export function lastJobDay(invoices: Pick<Invoice, 'issuedAt'>[], payments: Pick<Payment, 'receivedAt'>[], today: string = dubaiDate()): string {
  let last = today;
  for (const d of [...invoices.map((i) => dubaiDate(i.issuedAt)), ...payments.map((p) => dubaiDate(p.receivedAt))]) if (d < last) last = d;
  return last;
}

/**
 * When a step of a job is stamped (ready, delivered, closed): now — for a job typed in later, the last of its own
 * moments (the car's day, its invoices, its payments), never after now.
 */
export function jobMoment(
  j: { order: Pick<Order, 'backdated' | 'arrivedAt' | 'createdAt'>; invoices: Pick<Invoice, 'issuedAt'>[]; payments: Pick<Payment, 'receivedAt'>[] },
  now: string = nowIso(),
): string {
  if (!j.order.backdated) return now;
  let last = j.order.arrivedAt ?? j.order.createdAt;
  for (const i of j.invoices) if (i.issuedAt > last) last = i.issuedAt;
  for (const p of j.payments) if (p.receivedAt > last) last = p.receivedAt;
  return last < now ? last : now;
}

/** The invoice's day offered at «Готово»: the job's own day for a job typed in later, else today. */
export function invoiceDayFor(order: Pick<Order, 'backdated' | 'arrivedAt' | 'createdAt'>, today: string = dubaiDate()): string {
  return order.backdated ? jobDay(order) : today;
}

/** The payment's day offered: for a job typed in later — the day of its invoice (else of the job), else today. */
export function paymentDayFor(order: Pick<Order, 'backdated' | 'arrivedAt' | 'createdAt'>, invoice: Pick<Invoice, 'issuedAt'> | undefined, today: string = dubaiDate()): string {
  if (!order.backdated) return today;
  return invoice ? dubaiDate(invoice.issuedAt) : jobDay(order);
}
