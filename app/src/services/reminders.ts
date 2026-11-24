import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { nextTime } from '../domain/notify';
import type { Reminder } from '../domain/types';
import { AppError } from './errors';

/*
 * The manager's own reminders (v0.74, the user: «добавить также напоминалки»): words and a time, maybe a job. They show
 * in «Сегодня» from their day (domain/today.ts) and come to the phone at their time (domain/notify.ts) until done.
 * Screens write them only through here.
 */

export interface ReminderInput {
  text: string;
  at: string;
  orderId?: string;
  repeat?: Reminder['repeat'];
}

function checked(input: ReminderInput): ReminderInput {
  const text = input.text.trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!text) throw new AppError('err.titleRequired');
  if (!Number.isFinite(Date.parse(input.at))) throw new AppError('err.notFound');
  return { text, at: new Date(input.at).toISOString(), orderId: input.orderId || undefined, repeat: input.repeat || undefined };
}

export async function addReminder(input: ReminderInput): Promise<Reminder> {
  const r: Reminder = { id: uid(), ...checked(input), createdAt: nowIso() };
  await db.reminders.add(r);
  return r;
}

/** Its words, its time, how it repeats; a new time makes one done already due again. */
export async function updateReminder(id: string, input: ReminderInput): Promise<void> {
  const cur = await db.reminders.get(id);
  if (!cur) throw new AppError('err.notFound');
  const next = checked({ ...input, orderId: input.orderId ?? cur.orderId });
  await db.reminders.put({ ...cur, ...next, doneAt: next.at !== cur.at ? undefined : cur.doneAt, updatedAt: nowIso() });
}

/**
 * Done: it leaves «Сегодня» and the phone is told no more. One that repeats moves on to its next time instead (the
 * same time the next day, week or month — past the days missed). Returns what it was, for «Отменить».
 */
export async function doneReminder(id: string, now = nowIso()): Promise<Reminder> {
  const cur = await db.reminders.get(id);
  if (!cur) throw new AppError('err.notFound');
  const next = nextTime(cur, now);
  await db.reminders.put(next ? { ...cur, at: next, updatedAt: now } : { ...cur, doneAt: now, updatedAt: now });
  return cur;
}

/** Later: the same reminder at another time (in an hour, tomorrow morning). */
export async function snoozeReminder(id: string, at: string): Promise<Reminder> {
  const cur = await db.reminders.get(id);
  if (!cur) throw new AppError('err.notFound');
  await db.reminders.put({ ...cur, at: new Date(at).toISOString(), doneAt: undefined, updatedAt: nowIso() });
  return cur;
}

export async function removeReminder(id: string): Promise<Reminder | undefined> {
  const cur = await db.reminders.get(id);
  if (cur) await db.reminders.delete(id);
  return cur;
}

/** «Отменить»: the reminder as it was before it was done, moved or deleted. */
export async function restoreReminder(was: Reminder): Promise<void> {
  await db.reminders.put(was);
}

/** Those still to come or due (not done), the soonest first. */
export async function openReminders(): Promise<Reminder[]> {
  return (await db.reminders.orderBy('at').toArray()).filter((r) => !r.doneAt);
}

/** A job's own, the soonest first (its «Напомнить» shows how many wait). */
export async function jobReminders(orderId: string): Promise<Reminder[]> {
  return (await db.reminders.where('orderId').equals(orderId).sortBy('at')).filter((r) => !r.doneAt);
}
