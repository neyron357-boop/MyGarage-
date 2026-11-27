import { describe, expect, it } from 'vitest';
import { dubaiAt } from './dates';
import { buildPlan, clock, DEFAULT_NOTIFY, minutesOf, nextTime, NOTIFY_KINDS, NOTIFY_V, notifyOf, planInstants, quickTimes, type NotifySettings, type PlanWords } from './notify';
import { todayTasks, type OpenJob, type Task, type TodayInput } from './today';
import type { OrderItem } from './types';

// 2026-11-24 is a Tuesday; Dubai is UTC+4.
const D = '2026-11-24';
const at = (h: number, m = 0, day = D) => dubaiAt(day, h, m);
const line = (over: Partial<OrderItem>): OrderItem => ({ id: 'i' + Math.random(), orderId: 'a', kind: 'part', approvalState: 'draft', qty: 1, createdAt: at(9), ...over }) as OrderItem;
const job = (id: string, over: Partial<OpenJob> = {}, order: Partial<OpenJob['order']> = {}): OpenJob => ({
  order: { id, vehicleId: 'v-' + id, customerId: 'c-' + id, stageChangedAt: at(8), ...order },
  phase: 'look',
  items: [],
  debts: [],
  ...over,
});
const words: PlanWords = {
  title: (k) => `T:${k}`,
  label: (t) => t.text ?? `car ${t.orderId}`,
  url: (t) => (t.orderId ? `#/orders/${t.orderId}` : '#/?today=1'),
  listUrl: '#/?today=1',
  digest: 'Сегодня',
  again: 'Ещё',
  units: { m: 'мин', h: 'ч', d: 'д' },
};
const tasksOf = (input: Omit<TodayInput, 'warnHours' | 'alertHours' | 'past' | 'vehicles'> & Partial<TodayInput>) => (now: string): Task[] =>
  todayTasks({ past: [], vehicles: new Map(), warnHours: 0, alertHours: 24, ...input, now });
const plan = (now: string, input: Parameters<typeof tasksOf>[0], settings: NotifySettings = DEFAULT_NOTIFY) => buildPlan({ settings, now, tasksAt: tasksOf(input), words });
const group = (p: ReturnType<typeof plan>, key: string) => p.groups.find((g) => g.key === key);

describe('the settings of notifications', () => {
  it('nothing stored — the defaults (v0.97): the states in the plan of the day, what has its time — once, the news on; no «price not told» kind (v0.81)', () => {
    const s = notifyOf(undefined);
    expect([s.on, clock(s.from), clock(s.to), s.days.length, s.digest]).toEqual([true, '08:00', '21:00', 7, { on: true, at: 540, again: 900 }]);
    expect(NOTIFY_KINDS[0]).toBe('answer');
    expect(s.rules.answer).toEqual({ on: true, after: 120, every: 0, when: 'plan' });
    expect(s.rules.promised).toEqual({ on: true, after: -30, every: 0, when: 'now' });
    expect(Object.keys(s.rules)).toEqual(NOTIFY_KINDS);
    expect(NOTIFY_KINDS).not.toContain('price');
    // «99 % не замечаю»: nothing said again and again; only a booking, a time promised, a reminder — on their own.
    expect(NOTIFY_KINDS.filter((k) => s.rules[k].when === 'now')).toEqual(['promised', 'booked', 'reminder']);
    expect(NOTIFY_KINDS.every((k) => s.rules[k].every === 0)).toBe(true);
    expect(s.news).toEqual({ answer: true, prices: true, payment: true, request: true });
  });

  it('v0.82: settings kept under the old defaults take the new kinds’ rules once — their hours, days and summary stay', () => {
    const old = notifyOf({ from: 600, digest: { on: false, at: 600, again: null }, rules: { followUp: { on: true, after: 0, every: 0 }, answer: { on: false, after: 30, every: 15 } } as never });
    expect([old.from, old.digest, old.rules.followUp.on, old.rules.answer, old.v]).toEqual([600, { on: false, at: 600, again: 900 }, true, { on: true, after: 120, every: 0, when: 'plan' }, NOTIFY_V]);
    // Kept under the new ones: theirs stand.
    const kept = notifyOf({ ...old, rules: { ...old.rules, followUp: { on: false, after: 0, every: 0 } }, digest: { ...old.digest, again: null } });
    expect([kept.rules.followUp.on, kept.digest.again]).toEqual([false, null]);
  });

  it('what is stored stands over the defaults, field by field; nonsense is not taken — a «price» rule kept by an older app neither (v0.81)', () => {
    const s = notifyOf({ v: NOTIFY_V, from: 600, days: [5, 5, 9, 1], digest: { on: false, at: 9999, again: null }, rules: { answer: { on: true, after: 30, every: 15 }, order: { on: false }, price: { on: true, after: 60, every: 60 } } as never });
    expect([s.from, s.to, s.days, s.digest]).toEqual([600, 1260, [1, 5], { on: false, at: 1439, again: null }]);
    // Said «now» or not said at all: as kept; the kind's own when otherwise.
    expect(s.rules.answer).toEqual({ on: true, after: 30, every: 15, when: 'plan' });
    expect(s.rules.order).toEqual({ on: false, after: 60, every: 0, when: 'plan' });
    expect(notifyOf({ v: NOTIFY_V, rules: { answer: { on: true, after: 30, every: 15, when: 'now' }, reminder: { on: true, after: 0, every: 0, when: 'plan' } } as never }).rules).toMatchObject({ answer: { when: 'now' }, reminder: { when: 'now' } });
    expect('price' in s.rules).toBe(false);
    expect(notifyOf({ days: [] }).days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([minutesOf('08:30'), minutesOf('24:00'), minutesOf('x'), clock(1260)]).toEqual([510, undefined, undefined, '21:00']);
  });
});

describe('the plan left on the server', () => {
  it('v0.81: a job whose lines have no price told is not in the plan; a customer who has not answered — two hours after the price went, then every two hours, «how long» from then', () => {
    const price = job('p', { phase: 'price', items: [line({ createdAt: at(9, 0) }), line({ createdAt: at(9, 40) })] });
    const open = [price, job('a', { phase: 'wait', waitingSince: at(9, 40) })];
    const p = plan(at(9, 50), { open });
    expect(p.groups.map((g) => g.key)).toEqual(['answer']);
    const g = group(p, 'answer')!;
    // v0.97: in the plan of the day — never a notification of its own.
    expect([g.title, g.many, g.every, g.url, g.solo, g.plan]).toEqual(['T:answer', 'T:answer · {n}', 0, '#/?today=1', undefined, true]);
    expect(g.members).toEqual([{ id: 'answer:a', label: 'car a', url: '#/orders/a', start: at(11, 40), since: at(9, 40) }]);
    expect([p.tz, p.from, p.to, p.digest]).toEqual(['Asia/Dubai', 480, 1260, { at: 540, title: 'Сегодня', again: 900, againTitle: 'Ещё' }]);
    // Said on its own when the manager wants it so.
    const now = notifyOf({ v: NOTIFY_V, rules: { answer: { on: true, after: 120, every: 180, when: 'now' } } as never });
    const own = group(plan(at(9, 50), { open }, now), 'answer')!;
    expect([own.every, own.plan]).toEqual([180, undefined]);
    // Made again an hour and a day later: the same start (the server does not take it for a new one).
    expect(group(plan(at(11, 5), { open }), 'answer')!.members[0].start).toBe(at(11, 40));
    expect(group(plan(at(13, 0, '2026-11-25'), { open }), 'answer')!.members[0].start).toBe(at(11, 40));
    // The price job alone, all the week ahead: nothing to say.
    expect(plan(at(9, 50), { open: [price] }).groups).toEqual([]);
  });

  it('a time promised for tomorrow comes by itself: half an hour before it; a part to collect on Thursday — that morning', () => {
    const open = [
      job('a', { phase: 'work' }, { promisedReadyAt: at(15, 0, '2026-11-25') }),
      job('b', { phase: 'work', items: [line({ approvalState: 'approved', procurementStatus: 'ordered', expectedAt: '2026-11-26', orderedAt: at(9) })] }),
    ];
    const p = plan(at(10), { open });
    expect(group(p, 'promised')!.members).toEqual([{ id: 'promised:a', label: 'car a', url: '#/orders/a', start: at(14, 30, '2026-11-25') }]);
    expect(group(p, 'pickup')!.members[0].start).toBe(at(8, 0, '2026-11-26'));
    // On Thursday itself, made at noon: the same morning — said that morning once, not again at noon.
    expect(group(plan(at(12, 0, '2026-11-26'), { open }), 'pickup')!.members[0].start).toBe(at(8, 0, '2026-11-26'));
    // Still not collected on Friday: Friday's morning — said again.
    expect(group(plan(at(7, 0, '2026-11-27'), { open }), 'pickup')!.members[0].start).toBe(at(8, 0, '2026-11-27'));
  });

  it('a car ready and not collected «for a day»: its own time, and not said before «Сегодня» lists it', () => {
    const open = [job('a', { phase: 'out' }, { stageChangedAt: at(16, 0, '2026-11-23') })];
    const off = notifyOf({ v: NOTIFY_V, rules: { collect: { on: false } } as never });
    expect(group(plan(at(10), { open }, off), 'collect')).toBeUndefined();
    const on = notifyOf({ v: NOTIFY_V, rules: { collect: { on: true } } as never });
    const planOn = (now: string, input: Parameters<typeof tasksOf>[0]) => buildPlan({ settings: on, now, tasksAt: tasksOf(input), words });
    const m = group(planOn(at(10), { open }), 'collect')!.members[0];
    expect([m.start, m.notBefore, m.since]).toEqual([at(16, 0, '2026-11-23'), at(16, 0), at(16, 0, '2026-11-23')]);
    // Made after its day is up: listed now — the same start, nothing to wait for.
    const later = group(planOn(at(17), { open }), 'collect')!.members[0];
    expect([later.start, later.notBefore]).toEqual([at(16, 0, '2026-11-23'), undefined]);
  });

  it('a booking: half an hour before; a reminder is its own notification with its own words — at its time, tomorrow’s too', () => {
    const reminders = [
      { id: 'r1', text: 'Позвонить Ахмеду', at: at(11, 30) },
      { id: 'r2', text: 'Оплатить аренду', at: at(9, 0, '2026-11-25') },
      { id: 'r3', text: 'сделано', at: at(9), doneAt: at(9, 5) },
    ];
    const p = plan(at(10), { open: [job('a', { phase: 'booked' }, { bookedFor: at(14) })], reminders });
    expect(group(p, 'booked')!.members[0].start).toBe(at(13, 30));
    expect(p.groups.filter((g) => g.solo).map((g) => [g.key, g.title, g.every, g.members[0].label, g.members[0].start, g.members[0].url])).toEqual([
      // v0.97: once, at its time — not every hour until done.
      ['reminder:r1', 'T:reminder', 0, 'Позвонить Ахмеду', at(11, 30), '#/?today=1'],
      ['reminder:r2', 'T:reminder', 0, 'Оплатить аренду', at(9, 0, '2026-11-25'), '#/?today=1'],
    ]);
  });

  it('a kind switched off is not in the plan; all off — nothing; the summary off — none; the manager’s own delay and repeat', () => {
    const open = [job('a', { phase: 'work', items: [line({ approvalState: 'approved', createdAt: at(9) })] }), job('b', { phase: 'wait', waitingSince: at(9) })];
    const both = plan(at(10), { open });
    expect(both.groups.map((g) => g.key)).toEqual(['answer', 'order']);
    const mine = notifyOf({ v: NOTIFY_V, digest: { on: false, at: 540, again: null }, rules: { answer: { on: true, after: 15, every: 30, when: 'now' }, order: { on: false, after: 60, every: 120 } } as never });
    const p = plan(at(10), { open }, mine);
    // With no plan of the day, a kind «in the plan» is said nowhere but «Сегодня».
    expect(plan(at(10), { open }, notifyOf({ v: NOTIFY_V, digest: { on: false, at: 540, again: null } })).groups).toEqual([]);
    expect(p.groups.map((g) => g.key)).toEqual(['answer']);
    expect([p.groups[0].every, p.groups[0].members[0].start, p.digest]).toEqual([30, at(9, 15), undefined]);
    expect(plan(at(10), { open }, notifyOf({ on: false })).groups).toEqual([]);
  });

  it('the groups go in one order (as the summary lists them), the members by their time', () => {
    const open = [
      job('b', { phase: 'wait', waitingSince: at(9, 30) }),
      job('a', { phase: 'wait', waitingSince: at(9) }),
      job('c', { phase: 'work', items: [line({ approvalState: 'approved', createdAt: at(7) })] }),
    ];
    const p = plan(at(10), { open, reminders: [{ id: 'r', text: 'x', at: at(12) }] });
    // «order» starts first (07:00 + an hour), yet goes after «answer»: the kinds keep the summary's order.
    expect(p.groups.map((g) => g.key)).toEqual(['answer', 'order', 'reminder:r']);
    expect(group(p, 'answer')!.members.map((m) => m.id)).toEqual(['answer:a', 'answer:b']);
  });

  it('the moments looked at: now, each hour of the coming day, each morning of the week', () => {
    const t = planInstants(at(10, 20), 480);
    expect(t[0]).toBe(at(10, 20));
    expect(t[1]).toBe(at(11));
    expect(t).toContain(at(0, 0, '2026-11-25'));
    expect(t).toContain(at(8, 0, '2026-12-01'));
    expect(t.length).toBeLessThan(40);
    expect([...t].sort()).toEqual(t);
  });
});

describe('reminders', () => {
  it('one that repeats moves on when done: the same time the next day, week, month — past the days missed', () => {
    expect(nextTime({ at: at(9) }, at(10))).toBeUndefined();
    expect(nextTime({ at: at(9), repeat: 'day' }, at(10))).toBe(at(9, 0, '2026-11-25'));
    expect(nextTime({ at: at(9), repeat: 'day' }, at(10, 0, '2026-11-27'))).toBe(at(9, 0, '2026-11-28'));
    expect(nextTime({ at: at(9), repeat: 'week' }, at(10))).toBe(at(9, 0, '2026-12-01'));
    expect(nextTime({ at: at(9), repeat: 'month' }, at(10))).toBe(at(9, 0, '2026-12-24'));
    // The 31st: a short month's last day.
    expect(nextTime({ at: at(9, 0, '2027-01-31'), repeat: 'month' }, at(10, 0, '2027-01-31'))).toBe(at(9, 0, '2027-02-28'));
    // Set for later: it is its own next time.
    expect(nextTime({ at: at(18), repeat: 'day' }, at(10))).toBe(at(18));
  });

  it('the times offered for a new one: in an hour, this evening while it is day, tomorrow morning, in a week', () => {
    expect(quickTimes(at(10, 2))).toEqual([
      { key: 'hour', at: at(11, 5) },
      { key: 'evening', at: at(18) },
      { key: 'tomorrow', at: at(9, 0, '2026-11-25') },
      { key: 'week', at: at(9, 0, '2026-12-01') },
    ]);
    expect(quickTimes(at(17)).map((x) => x.key)).toEqual(['hour', 'tomorrow', 'week']);
  });
});

describe('«Сегодня» (v0.74)', () => {
  it('a car booked for today is listed at its time — late once the time is gone; a reminder from its day until done', () => {
    const input = { open: [job('a', { phase: 'booked' }, { bookedFor: at(14) }), job('b', { phase: 'booked' }, { bookedFor: at(14, 0, '2026-11-25') })], reminders: [{ id: 'r', text: 'Позвонить', at: at(12), orderId: 'a' }] };
    const morning = tasksOf(input)(at(10));
    expect(morning.map((t) => [t.kind, t.key, t.late])).toEqual([
      ['reminder', 'reminder:r', false],
      ['booked', 'booked:a', false],
    ]);
    expect(morning[0]).toMatchObject({ text: 'Позвонить', reminderId: 'r', orderId: 'a' });
    expect(tasksOf(input)(at(15)).map((t) => [t.kind, t.late])).toEqual([
      ['reminder', true],
      ['booked', true],
    ]);
  });

  it('v0.81: lines waiting for their price are not listed — just written or days old; the customer’s answer waits from the moment the price went', () => {
    const old = { stageChangedAt: at(8, 0, '2026-11-20') };
    const tasks = (open: OpenJob[], now: string) => todayTasks({ open, past: [], vehicles: new Map(), warnHours: 2, alertHours: 24, now });
    const price = [job('a', { phase: 'price', items: [line({ createdAt: at(9, 30) })] }, old)];
    expect(tasks(price, at(10))).toEqual([]);
    expect(tasks(price, at(11, 30))).toEqual([]);
    // Older data — no line later than the step: nothing either, however long ago the step was.
    expect(tasks([job('b', { phase: 'price', items: [line({ createdAt: at(7, 0, '2026-11-19') })] }, old)], at(10))).toEqual([]);
    // Told, and not answered: listed from two hours after it went.
    const wait = [job('c', { phase: 'wait', waitingSince: at(9, 30) }, old)];
    expect(tasks(wait, at(10))).toEqual([]);
    expect(tasks(wait, at(11, 30)).map((t) => [t.kind, t.at, t.late])).toEqual([['answer', at(9, 30), false]]);
  });
});
