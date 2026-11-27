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
});
