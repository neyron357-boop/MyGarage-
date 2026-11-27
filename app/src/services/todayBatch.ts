import type { Task, TaskKind } from '../domain/today';
import type { Lang } from '../domain/types';
import { waDigits } from '../domain/whatsapp';
import { logMessage } from './messages';
import { markBookingReminded, markDeclinedOffered, markFollowedUp, markServiceReminded } from './today';
import { queueWa, type OutItem } from './waOutbox';

/*
 * The morning's customer messages in one go (audit 27/11: «клиентам пишется по одному через SendDialog»): «Сегодня» →
 * «Написать всем · N» — every customer's thing of the day (how is the car, time for a service, declined last time,
 * tomorrow's booking) as its ready message, all of them in «Проверить и отправить» together: seen, words put right, one
 * taken off — nothing goes by itself (v0.84.4). What really went leaves «Сегодня» and is in the customer's messages
 * (`keepSentToday` in `sendAsked`); what was taken off stays.
 */

/** What a customer's message is about — kept on its item, never sent to the server. */
export interface TodaySend {
  kind: TaskKind;
  orderId?: string;
  vehicleId: string;
  customerId: string;
  template: string;
  lang: Lang;
}

export interface TodayMessage {
  task: Task;
  phone: string;
  text: string;
  template: string;
  lang: Lang;
  /** Whom it is to, as the review shows it. */
  title: string;
}

/** Sent, or not needed: the customer's thing leaves «Сегодня». */
export function markCustomerDone(task: Pick<Task, 'kind' | 'orderId' | 'vehicleId'>): Promise<void> {
  if (task.kind === 'service') return markServiceReminded(task.vehicleId);
  if (!task.orderId) return Promise.resolve();
  if (task.kind === 'declined') return markDeclinedOffered(task.orderId);
  if (task.kind === 'bookedTomorrow') return markBookingReminded(task.orderId);
  return markFollowedUp(task.orderId);
}

/** The messages as items for «Проверить и отправить» — one a day for each thing (the key: the thing and the day). */
export function todayItems(list: TodayMessage[], day: string): OutItem[] {
  return list
    .filter((m) => waDigits(m.phone) && m.text.trim())
    .map((m) => ({
      key: `today:${m.task.key}:${day}`,
      phone: waDigits(m.phone),
      title: m.title,
      parts: [{ text: m.text }],
      today: { kind: m.task.kind, orderId: m.task.orderId, vehicleId: m.task.vehicleId, customerId: m.task.customerId, template: m.template, lang: m.lang },
    }));
}

/** All of them to «Проверить и отправить» (it opens by itself). */
export async function writeAllToday(list: TodayMessage[], day: string): Promise<number> {
  const items = todayItems(list, day);
  await queueWa(items);
  return items.length;
}

/** What really went: the thing leaves «Сегодня», the message is in the customer's messages (its words as sent). */
export async function keepSentToday(items: OutItem[]): Promise<void> {
  for (const it of items) {
    if (!it.today) continue;
    await markCustomerDone(it.today);
    const text = it.parts.map((p) => p.text ?? p.caption ?? '').filter(Boolean).join('\n');
    await logMessage({ orderId: it.today.orderId, customerId: it.today.customerId, channel: 'whatsapp', template: it.today.template, language: it.today.lang, text });
  }
}
