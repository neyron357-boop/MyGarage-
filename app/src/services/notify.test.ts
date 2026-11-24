import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { addDays, nowIso } from '../domain/dates';
import { notifyOf } from '../domain/notify';
import { addItem } from './estimate';
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
const group = (p: Awaited<ReturnType<typeof makePlan>>, key: string) => p.groups.find((g) => g.key === key);

describe('the notifications’ plan from the garage’s data', () => {
  it('a job with a list of parts and no price told: «Назвать цену» — the car by its name and plate, an hour after its newest line, every hour; its job opens', async () => {
    const o = await job('Renault', 'Kwid', '67445', ['CLUTCH FULL SET', 'CLUTCH CYLINDER']);
    await job('Honda', 'Civic', '38203', []);
    const now = nowIso();
    const p = await makePlan(now, 'ru');
    const g = group(p, 'price')!;
    expect([g.title, g.many, g.every, g.url]).toEqual(['Назвать цену', 'Назвать цену · {n}', 60, '#/?today=1']);
    expect(g.members.map((m) => [m.id, m.label, m.url])).toEqual([[`price:${o.id}`, 'Renault Kwid · 67445', `#/orders/${o.id}`]]);
    const newest = (await db.items.where('orderId').equals(o.id).toArray()).map((i) => i.createdAt).sort().pop()!;
    expect(g.members[0].start).toBe(new Date(Date.parse(newest) + 3600_000).toISOString());
    expect(g.members[0].since).toBe(newest);
    expect([p.tz, p.from, p.to, p.units, p.digest]).toEqual(['Asia/Dubai', 480, 1260, { m: 'мин', h: 'ч', d: 'д' }, { at: 540, title: 'Сегодня' }]);
    // In English on a device set so.
    expect(group(await makePlan(now, 'en'), 'price')!.title).toBe('Tell the price');
  });

  it('the manager’s own settings are kept with the garage’s and the plan follows: half an hour, every 15 minutes; a kind off; all off', async () => {
    await job('Renault', 'Kwid', '67445', ['CLUTCH FULL SET']);
    await saveNotify({ from: 7 * 60, rules: { price: { on: true, after: 30, every: 15 } } as never });
    const s = notifyOf((await getSettings()).notify);
    expect([s.from, s.to, s.rules.price, s.rules.answer.every]).toEqual([420, 1260, { on: true, after: 30, every: 15 }, 120]);
    const p = await makePlan();
    expect([p.from, group(p, 'price')!.every]).toEqual([420, 15]);
    await saveNotify({ rules: { price: { on: false, after: 30, every: 15 } } as never });
    expect(group(await makePlan(), 'price')).toBeUndefined();
    await saveNotify({ on: false });
    expect((await makePlan()).groups).toEqual([]);
  });

  it('a job kept quiet is not said; a reminder set on it still is; heard again — said again', async () => {
    const o = await job('Renault', 'Kwid', '67445', ['CLUTCH FULL SET']);
    await setJobQuiet(o.id, true);
    const r = await addReminder({ text: 'Позвонить клиенту', at: addDays(nowIso(), 1), orderId: o.id });
    const p = await makePlan(nowIso(), 'ru');
    expect(group(p, 'price')).toBeUndefined();
    const g = group(p, `reminder:${r.id}`)!;
    expect([g.solo, g.title, g.members[0].label, g.members[0].url, g.members[0].start]).toEqual([true, 'Напоминание', 'Позвонить клиенту · Renault Kwid · 67445', `#/orders/${o.id}`, r.at]);
    await setJobQuiet(o.id, false);
    expect(group(await makePlan(), 'price')!.members).toHaveLength(1);
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
