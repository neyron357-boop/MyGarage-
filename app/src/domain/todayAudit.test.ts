import { describe, expect, it } from 'vitest';
import { todayTasks, type PastJob, type OpenJob } from './today';
import { customerMessage } from '../services/today';

const NOW = '2026-11-27T08:00:00.000Z';
const past = (closedAt: string, items: PastJob['items'], extra: Partial<PastJob['order']> = {}): PastJob => ({
  order: { id: 'o1', vehicleId: 'v1', customerId: 'c1', closedAt, outcome: 'completed', ...extra },
  items,
  hasPhone: true,
});
const base = { vehicles: new Map(), warnHours: 2, alertHours: 24, now: NOW };

describe('«Сегодня» — audit 27/11', () => {
  it('the lines declined on the car’s last visit: offered a month later, once, not while the car is here', () => {
    const declined = [{ kind: 'part' as const, approvalState: 'declined' as const, titleEn: 'FRONT BRAKE DISCS' }, { kind: 'labor' as const, approvalState: 'approved' as const, titleEn: 'BRAKE PADS' }];
    const t = todayTasks({ ...base, open: [], past: [past('2026-10-20T08:00:00.000Z', declined)] });
    expect(t.filter((x) => x.kind === 'declined')).toMatchObject([{ orderId: 'o1', count: 1 }]);
    // Too early, offered already, nothing declined — none.
    expect(todayTasks({ ...base, open: [], past: [past('2026-11-10T08:00:00.000Z', declined)] }).some((x) => x.kind === 'declined')).toBe(false);
    expect(todayTasks({ ...base, open: [], past: [past('2026-10-20T08:00:00.000Z', declined, { declinedOfferedAt: NOW })] }).some((x) => x.kind === 'declined')).toBe(false);
    expect(todayTasks({ ...base, open: [], past: [past('2026-10-20T08:00:00.000Z', declined.slice(1))] }).some((x) => x.kind === 'declined')).toBe(false);
  });

  it('a booking tomorrow: the customer reminded the day before, from 17:00 Dubai', () => {
    const job = (bookedFor: string, extra: Partial<OpenJob> = {}): OpenJob => ({ order: { id: 'b1', vehicleId: 'v2', customerId: 'c2', stageChangedAt: NOW, bookedFor }, phase: 'booked', items: [], debts: [], hasPhone: true, ...extra });
    const t = todayTasks({ ...base, past: [], open: [job('2026-11-28T06:00:00.000Z')] });
    expect(t.find((x) => x.kind === 'bookedTomorrow')).toMatchObject({ orderId: 'b1', at: '2026-11-27T13:00:00.000Z' });
    expect(todayTasks({ ...base, past: [], open: [job('2026-11-29T06:00:00.000Z')] }).some((x) => x.kind === 'bookedTomorrow')).toBe(false);
    expect(todayTasks({ ...base, past: [], open: [job('2026-11-28T06:00:00.000Z', { hasPhone: false })] }).some((x) => x.kind === 'bookedTomorrow')).toBe(false);
  });

  it('the messages: the review link to every customer with «how is the car»; the declined lines by name; the booking’s time', () => {
    expect(customerMessage({ kind: 'followUp', at: NOW }, 'en', 'https://maps.app.goo.gl/x', [])).toEqual({ tpl: 'reviewRequest', vars: { link: 'https://maps.app.goo.gl/x' } });
    expect(customerMessage({ kind: 'followUp', at: NOW }, 'en', '', []).tpl).toBe('followUp');
    expect(customerMessage({ kind: 'declined', at: NOW }, 'en', '', [{ kind: 'part', approvalState: 'declined', titleEn: 'Front brake discs' }, { kind: 'part', approvalState: 'approved', titleEn: 'Pads' }]).vars.lines).toBe('FRONT BRAKE DISCS');
    expect(customerMessage({ kind: 'bookedTomorrow', at: NOW }, 'en', '', [], '2026-11-28T06:00:00.000Z')).toEqual({ tpl: 'bookedTomorrow', vars: { time: '10:00' } });
  });

  it('the oil service by the mileage: sooner than half a year when the car runs fast; its km in the message', () => {
    const oil = [{ kind: 'part' as const, approvalState: 'approved' as const, titleEn: 'ENGINE OIL 5W30' }];
    const km = { dueAt: '2026-11-20T08:00:00.000Z', perDay: 250, atKm: 130_500, nowKm: 142_000 };
    const t = todayTasks({ ...base, open: [], past: [{ ...past('2026-10-01T08:00:00.000Z', oil), km }] });
    expect(t.find((x) => x.kind === 'service')).toMatchObject({ at: km.dueAt, kmNow: 142_000, kmAt: 130_500 });
    // Not yet due by the mileage — and half a year is far: nothing.
    expect(todayTasks({ ...base, open: [], past: [{ ...past('2026-10-01T08:00:00.000Z', oil), km: { ...km, dueAt: '2026-12-20T08:00:00.000Z' } }] }).some((x) => x.kind === 'service')).toBe(false);
    // Never in the first month, whatever the mileage says.
    expect(todayTasks({ ...base, open: [], past: [{ ...past('2026-11-10T08:00:00.000Z', oil), km }] }).some((x) => x.kind === 'service')).toBe(false);
    // The half-year rule still stands without a pace.
    expect(todayTasks({ ...base, open: [], past: [past('2026-05-01T08:00:00.000Z', oil)] }).find((x) => x.kind === 'service')?.kmNow).toBeUndefined();
    expect(customerMessage({ kind: 'service', at: NOW, kmNow: 142_000, kmAt: 130_500 }, 'en', '', [])).toEqual({ tpl: 'serviceDueKm', vars: { km: '11 500', lastKm: '130 500' } });
    expect(customerMessage({ kind: 'service', at: NOW }, 'en', '', []).tpl).toBe('serviceDue');
  });

  it('the Mulkiya runs out: the customer told two weeks before, once for that day; not while the car is here', () => {
    const car = (regExpires: string, regRemindedFor?: string) => ({ vehicles: new Map([['v1', { id: 'v1', regExpires, regRemindedFor }]]) });
    const job = [past('2026-08-01T08:00:00.000Z', [])];
    expect(todayTasks({ ...base, ...car('2026-12-05'), open: [], past: job }).find((x) => x.kind === 'mulkiya')).toMatchObject({ vehicleId: 'v1', expires: '2026-12-05', late: false, at: '2026-11-21T05:00:00.000Z' });
    // Too far ahead, told already for that day, past by more than a month — none; a day just past — late.
    expect(todayTasks({ ...base, ...car('2027-01-20'), open: [], past: job }).some((x) => x.kind === 'mulkiya')).toBe(false);
    expect(todayTasks({ ...base, ...car('2026-12-05', '2026-12-05'), open: [], past: job }).some((x) => x.kind === 'mulkiya')).toBe(false);
    expect(todayTasks({ ...base, ...car('2026-10-01'), open: [], past: job }).some((x) => x.kind === 'mulkiya')).toBe(false);
    expect(todayTasks({ ...base, ...car('2026-11-20'), open: [], past: job }).find((x) => x.kind === 'mulkiya')?.late).toBe(true);
    expect(customerMessage({ kind: 'mulkiya', at: NOW, expires: '2026-12-05' }, 'en', '', [])).toEqual({ tpl: 'mulkiyaDue', vars: { date: '05/12/2026' } });
  });
});
