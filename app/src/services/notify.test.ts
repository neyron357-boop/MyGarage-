import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { addDays, nowIso } from '../domain/dates';
import { notifyOf } from '../domain/notify';
import { addItem, sendVersion } from './estimate';
import { makePlan, saveNotify, setJobQuiet } from './notify';
import { checkIn } from './orders';
import { addReminder, doneReminder, jobReminders, openReminders, removeReminder, restoreReminder, snoozeReminder, updateReminder } from './reminders';
import { ensureSeed } from './seed';
import { getSettings } from './settings';
import { tasksFor } from './today';

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

const job = async (make: string, model: string, number: string, parts: string[]) => {
  const o = await checkIn({ plate: { emirate: 'DXB', code: 'R', number }, make, model, name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
  for (const p of parts) await addItem(o.id, { kind: 'part', block: 'A', titleEn: p, qty: 1, unitPriceFils: 0 });
  return o;
};
/** A job whose price went to the customer, not answered yet. */
const told = async (make: string, model: string, number: string, parts: string[]) => {
  const o = await job(make, model, number, parts);
  const v = await sendVersion(o.id, { via: 'whatsapp' });
  return { o, v };
};
const group = (p: Awaited<ReturnType<typeof makePlan>>, key: string) => p.groups.find((g) => g.key === key);

describe('the notifications’ plan from the garage’s data', () => {
  it('v0.81: a job with a list of parts and no price told is not said; a price sent and not answered — «Клиент не ответил», the car by its name and plate, two hours after it went, every two hours; its job opens', async () => {
    const { o, v } = await told('Renault', 'Kwid', '67445', ['CLUTCH FULL SET', 'CLUTCH CYLINDER']);
    const price = await job('Honda', 'Civic', '38203', ['BRAKE PADS', 'BRAKE DISC']);
    const now = nowIso();
    const p = await makePlan(now, 'ru');
    expect(p.groups.map((x) => x.key)).toEqual(['answer']);
    expect(p.groups.flatMap((x) => x.members.map((m) => m.url))).not.toContain(`#/orders/${price.id}`);
    const g = group(p, 'answer')!;
    // v0.82: bright — its sign first; the line — the car, its plate (code and number) and whose it is.
    // v0.97: a line of the plan of the day — not a notification of its own.
    expect([g.title, g.many, g.every, g.url, g.plan]).toEqual(['📞 Клиент не ответил', '📞 Клиент не ответил · {n}', 0, '#/?today=1', true]);
    expect(g.members.map((m) => [m.id, m.label, m.url])).toEqual([[`answer:${o.id}`, 'Renault Kwid · R 67445', `#/orders/${o.id}`]]);
    expect(g.members[0].start).toBe(new Date(Date.parse(v.sentAt) + 2 * 3600_000).toISOString());
    expect(g.members[0].since).toBe(v.sentAt);
    expect([p.tz, p.from, p.to, p.units, p.digest, p.away]).toEqual(['Asia/Dubai', 480, 1260, { m: 'мин', h: 'ч', d: 'д' }, { at: 540, title: '📋 План дня', again: 900, againTitle: '📋 Ещё ждут' }, '🌙 Пока вас не было']);
    // In English on a device set so.
    expect(group(await makePlan(now, 'en'), 'answer')!.title).toBe('📞 No answer from the customer');
  });

  it('the manager’s own settings are kept with the garage’s and the plan follows: half an hour, every 15 minutes; a kind off; all off', async () => {
    await told('Renault', 'Kwid', '67445', ['CLUTCH FULL SET']);
    await saveNotify({ from: 7 * 60, rules: { answer: { on: true, after: 30, every: 15, when: 'now' } } as never });
    const s = notifyOf((await getSettings()).notify);
    expect([s.from, s.to, s.rules.answer, s.rules.order.every]).toEqual([420, 1260, { on: true, after: 30, every: 15, when: 'now' }, 0]);
    const p = await makePlan();
    expect([p.from, group(p, 'answer')!.every]).toEqual([420, 15]);
    await saveNotify({ rules: { answer: { on: false, after: 30, every: 15 } } as never });
    expect(group(await makePlan(), 'answer')).toBeUndefined();
    await saveNotify({ on: false });
    expect((await makePlan()).groups).toEqual([]);
  });

  it('a job kept quiet is not said; a reminder set on it still is; heard again — said again', async () => {
    const { o } = await told('Renault', 'Kwid', '67445', ['CLUTCH FULL SET']);
    await setJobQuiet(o.id, true);
    const r = await addReminder({ text: 'Позвонить клиенту', at: addDays(nowIso(), 1), orderId: o.id });
    const p = await makePlan(nowIso(), 'ru');
    expect(group(p, 'answer')).toBeUndefined();
    const g = group(p, `reminder:${r.id}`)!;
    // v0.82: a reminder's words are its title; the car is its line.
    expect([g.solo, g.title, g.members[0].label, g.members[0].url, g.members[0].start]).toEqual([true, '🔔 Позвонить клиенту', 'Renault Kwid · R 67445', `#/orders/${o.id}`, r.at]);
    await setJobQuiet(o.id, false);
    expect(group(await makePlan(), 'answer')!.members).toHaveLength(1);
    expect((await db.orders.get(o.id))!.notifyOff).toBeUndefined();
  });
});

describe('reminders', () => {
  it('set, changed, put off, done and brought back; one of a job is its job’s', async () => {
    const o = await job('Honda', 'Civic', '38203', []);
    const at = addDays(nowIso(), -0.01);
    const a = await addReminder({ text: '  Оплатить   аренду ', at });
    const b = await addReminder({ text: 'Позвонить', at: addDays(nowIso(), 2), orderId: o.id });
    expect(a.text).toBe('Оплатить аренду');
    expect((await openReminders()).map((r) => r.id)).toEqual([a.id, b.id]);
    expect((await jobReminders(o.id)).map((r) => r.id)).toEqual([b.id]);
    await expect(addReminder({ text: '   ', at })).rejects.toThrow();
    // «Сегодня» lists the one due (late: its time is gone), not the one two days on.
    const due = tasksFor([], undefined, nowIso(), await openReminders()).filter((t) => t.kind === 'reminder');
    expect(due.map((t) => [t.reminderId, t.text, t.late])).toEqual([[a.id, 'Оплатить аренду', true]]);
    // Put off till tomorrow: gone from today's.
    const before = await snoozeReminder(a.id, addDays(nowIso(), 1));
    expect(tasksFor([], undefined, nowIso(), await openReminders()).filter((t) => t.kind === 'reminder')).toHaveLength(0);
    await restoreReminder(before);
    // Done: off the list; «Отменить» brings it back as it was.
    const was = await doneReminder(a.id);
    expect((await openReminders()).map((r) => r.id)).toEqual([b.id]);
    await restoreReminder(was);
    expect((await openReminders()).map((r) => r.id)).toEqual([a.id, b.id]);
    // Its words and time changed; deleted — and back.
    await updateReminder(b.id, { text: 'Позвонить Ахмеду', at: b.at, repeat: 'week' });
    expect(await db.reminders.get(b.id)).toMatchObject({ text: 'Позвонить Ахмеду', repeat: 'week', orderId: o.id });
    const gone = await removeReminder(b.id);
    expect(await db.reminders.get(b.id)).toBeUndefined();
    await restoreReminder(gone!);
    expect((await db.reminders.get(b.id))!.text).toBe('Позвонить Ахмеду');
  });

  it('one that repeats is not done for good: it moves on to its next time', async () => {
    const at = addDays(nowIso(), -0.01);
    const r = await addReminder({ text: 'Закрыть кассу', at, repeat: 'day' });
    await doneReminder(r.id);
    const next = (await db.reminders.get(r.id))!;
    expect(next.doneAt).toBeUndefined();
    expect(next.at).toBe(addDays(at, 1));
    expect((await openReminders()).map((x) => x.id)).toEqual([r.id]);
  });
});
