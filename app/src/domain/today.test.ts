import { describe, expect, it } from 'vitest';
import { dubaiAt, shiftDay, whenParts } from './dates';
import { jobProfit } from './profit';
import { parseCsv, sameSupplier, suppliersFromRows } from './supplierSheet';
import { todayTasks, wasOilService, type OpenJob, type PastJob } from './today';
import type { Invoice, OrderItem } from './types';

const NOW = '2026-11-12T08:00:00.000Z'; // 12:00 in Dubai
const item = (p: Partial<OrderItem>): OrderItem => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  orderId: 'o1',
  kind: 'part',
  block: 'A',
  qty: 1,
  unit: 'pcs',
  unitPriceFils: 10000,
  vatRateBp: 500,
  approvalState: 'approved',
  done: false,
  createdAt: '2026-11-11T08:00:00.000Z',
  ...p,
});
const job = (p: Partial<OpenJob> & { promisedReadyAt?: string; stageChangedAt?: string } = {}): OpenJob => ({
  order: { id: 'o1', vehicleId: 'v1', customerId: 'c1', promisedReadyAt: p.promisedReadyAt, stageChangedAt: p.stageChangedAt ?? NOW },
  phase: p.phase ?? 'work',
  items: p.items ?? [],
  debts: p.debts ?? [],
  waitingSince: p.waitingSince,
});
const run = (open: OpenJob[], past: PastJob[] = [], vehicles = new Map()) => todayTasks({ open, past, vehicles, warnHours: 2, alertHours: 24, now: NOW });

describe('dates for promises', () => {
  it('says today, tomorrow, a weekday or the date — in Dubai time', () => {
    expect(dubaiAt('2026-11-12', 18)).toBe('2026-11-12T14:00:00.000Z');
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01');
    expect(whenParts(dubaiAt('2026-11-12', 18), 'ru', NOW)).toEqual({ day: '', time: '18:00', today: true });
    expect(whenParts(dubaiAt('2026-11-13', 9, 30), 'ru', NOW).day).toBe('завтра');
    expect(whenParts(dubaiAt('2026-11-11', 18), 'en', NOW).day).toBe('yesterday');
    expect(whenParts(dubaiAt('2026-11-16', 18), 'en', NOW).day).toBe('Mon');
    expect(whenParts(dubaiAt('2026-11-30', 18), 'ru', NOW)).toEqual({ day: '30/11', time: '18:00', today: false });
  });
});

describe('Today list', () => {
  it('a car promised for today: on the list, red once the time has passed; not once it is ready', () => {
    expect(run([job({ promisedReadyAt: dubaiAt('2026-11-12', 18) })])).toMatchObject([{ kind: 'promised', late: false }]);
    expect(run([job({ promisedReadyAt: dubaiAt('2026-11-12', 10) })])).toMatchObject([{ kind: 'promised', late: true }]);
    expect(run([job({ promisedReadyAt: dubaiAt('2026-11-13', 10) })])).toEqual([]);
    expect(run([job({ phase: 'out', promisedReadyAt: dubaiAt('2026-11-12', 10) })])).toEqual([]);
  });

  it('a customer who has not answered for hours, a price not sent', () => {
    expect(run([job({ phase: 'wait', waitingSince: '2026-11-12T07:00:00.000Z' })])).toEqual([]);
    expect(run([job({ phase: 'wait', waitingSince: '2026-11-12T05:00:00.000Z' })])).toMatchObject([{ kind: 'answer', late: false }]);
    expect(run([job({ phase: 'wait', waitingSince: '2026-11-10T05:00:00.000Z' })])).toMatchObject([{ kind: 'answer', late: true }]);
    expect(run([job({ phase: 'price', stageChangedAt: '2026-11-12T03:00:00.000Z' })])).toMatchObject([{ kind: 'price' }]);
  });

  it('parts: agreed and not ordered, ordered and due, a return deadline close', () => {
    const toOrder = item({ procurementStatus: 'needed' });
    const own = item({ customerSupplied: true });
    expect(run([job({ items: [toOrder, own] })])).toMatchObject([{ kind: 'order', count: 1 }]);
    // Ordered yesterday with no day said: due today.
    const ordered = item({ procurementStatus: 'ordered', orderedAt: '2026-11-11T06:00:00.000Z', supplierId: 's1' });
    expect(run([job({ items: [ordered] })])).toMatchObject([{ kind: 'pickup', count: 1, supplierId: 's1', late: false }]);
    expect(run([job({ items: [{ ...ordered, expectedAt: '2026-11-14' }] })])).toEqual([]);
    // Bought, the seller takes it back until the day after tomorrow: shows; fitted — not any more.
    const back = item({ procurementStatus: 'received', returnBy: '2026-11-14' });
    expect(run([job({ items: [back] })])).toMatchObject([{ kind: 'returnBy', late: false }]);
    expect(run([job({ items: [{ ...back, returnBy: '2026-11-20' }] })])).toEqual([]);
    expect(run([job({ items: [{ ...back, done: true }] })])).toEqual([]);
    expect(run([job({ items: [{ ...back, noReturn: true }] })])).toEqual([]);
    // Declined by the customer but already bought: exactly the one to take back.
    expect(run([job({ items: [{ ...back, approvalState: 'declined', returnBy: '2026-11-11' }] })])).toMatchObject([{ kind: 'returnBy', late: true }]);
  });

  it('work outside due back, a car not collected, an overdue debt', () => {
    const paint = item({ kind: 'labor', outsource: { state: 'out', dueAt: '2026-11-12', supplierId: 'p1' } });
    expect(run([job({ items: [paint] })])).toMatchObject([{ kind: 'outsource', supplierId: 'p1', late: false }]);
    expect(run([job({ items: [{ ...paint, outsource: { state: 'back' } }] })])).toEqual([]);
    expect(run([job({ phase: 'out', stageChangedAt: '2026-11-10T08:00:00.000Z' })])).toMatchObject([{ kind: 'collect' }]);
    expect(run([job({ phase: 'debt', debts: [{ id: 'd', status: 'open', dueDate: '2026-11-10', amountFils: 30000 }] })])).toMatchObject([{ kind: 'debt', late: true, amountFils: 30000 }]);
  });

  it('customers to write to: how is the car, time for an oil service', () => {
    const past = (closedAt: string, p: Partial<PastJob['order']> = {}, oil = false): PastJob => ({
      order: { id: 'p' + closedAt, vehicleId: 'v9', customerId: 'c9', closedAt, outcome: 'completed', ...p },
      items: [{ kind: 'labor', approvalState: 'approved', titleEn: oil ? 'Engine oil change' : 'Brake pads', titleRu: undefined }],
      hasPhone: true,
    });
    expect(run([], [past('2026-11-08T08:00:00.000Z')])).toMatchObject([{ kind: 'followUp' }]);
    expect(run([], [past('2026-11-11T08:00:00.000Z')])).toEqual([]);
    expect(run([], [past('2026-11-08T08:00:00.000Z', { followedUpAt: '2026-11-11T08:00:00.000Z' })])).toEqual([]);
    expect(run([], [past('2026-11-08T08:00:00.000Z', { imported: { history: true } as never })])).toEqual([]);
    // Oil change seven months ago, nothing since: time for the next one — unless reminded, or the car is here.
    const oil = past('2026-04-01T08:00:00.000Z', {}, true);
    expect(run([], [oil])).toMatchObject([{ kind: 'service', vehicleId: 'v9' }]);
    expect(run([], [oil], new Map([['v9', { id: 'v9', serviceRemindedAt: '2026-11-01T00:00:00.000Z' }]]))).toEqual([]);
    expect(run([{ ...job(), order: { ...job().order, vehicleId: 'v9' } }], [oil]).filter((t) => t.kind === 'service')).toEqual([]);
    // A later visit without oil: that is the last job, no reminder.
    expect(run([], [oil, past('2026-06-01T08:00:00.000Z')])).toEqual([]);
    expect(wasOilService([{ kind: 'labor', approvalState: 'approved', titleRu: 'Замена масла', titleEn: undefined }])).toBe(true);
  });

  it('late ones first, the customers to write to last', () => {
    const list = run(
      [job({ promisedReadyAt: dubaiAt('2026-11-12', 18) }), { ...job({ phase: 'wait', waitingSince: '2026-11-10T05:00:00.000Z' }), order: { ...job().order, id: 'o2' } }],
      [{ order: { id: 'p', vehicleId: 'v9', customerId: 'c9', closedAt: '2026-11-08T08:00:00.000Z', outcome: 'completed' }, items: [], hasPhone: true }],
    );
    expect(list.map((t) => t.kind)).toEqual(['answer', 'promised', 'followUp']);
  });
});

describe('profit of a job', () => {
  const inv = (subtotal: number, total: number): Invoice => ({ id: 'i', number: 'INV-1', type: 'simplified_tax_invoice', orderId: 'o1', issuedAt: NOW, seller: { name: '' }, buyer: { name: '' }, lines: [], subtotalFils: subtotal, vatFils: total - subtotal, totalFils: total, currency: 'AED', status: 'issued' });
  it('revenue without VAT minus parts, work outside and expenses', () => {
    const items = [
      item({ kind: 'labor', unitPriceFils: 20000 }),
      item({ kind: 'part', unitPriceFils: 10000, qty: 2, costPriceFils: 6000 }),
      item({ kind: 'labor', unitPriceFils: 30000, costPriceFils: 15000, outsource: { state: 'back', expenseId: 'e1' } }),
      item({ kind: 'part', customerSupplied: true, costPriceFils: 9999 }),
    ];
    const p = jobProfit({ order: {}, items, invoices: [], expenses: [{ id: 'e1', amountFils: 15000, vatFils: 0 }, { id: 'e2', amountFils: 2100, vatFils: 100 }] });
    expect(p).toEqual({ revenue: 70000, parts: 12000, outside: 15000, expenses: 2000, profit: 41000, known: true });
    // With the invoice its net total counts; what was let go comes off.
    const q = jobProfit({ order: { waived: { at: NOW, fils: 10500 } }, items, invoices: [inv(70000, 73500)], expenses: [] });
    expect(q.revenue).toBe(60000);
    expect(jobProfit({ order: {}, items: [item({ kind: 'labor' })], invoices: [], expenses: [] }).known).toBe(false);
  });
});

describe('supplier list from a sheet', () => {
  it('finds the columns by their names, in Russian or English', () => {
    const rows = parseCsv('﻿Название;Телефон;Марки;Новые/Б/у;Что продают;Карта;Район\n"Al Wasl Parts";050 123 4567;Toyota, lexus;новые и б/у;"Фары; стекло";https://maps.app.goo.gl/x;Al Quoz\nGulf Paint;04 555 1111;;;покраска;;Qusais');
    expect(suppliersFromRows(rows)).toEqual([
      { name: 'Al Wasl Parts', phone: '+971501234567', makes: ['Toyota', 'Lexus'], condition: 'both', parts: 'Фары; стекло', service: undefined, locationUrl: 'https://maps.app.goo.gl/x', address: 'Al Quoz', notes: undefined },
      { name: 'Gulf Paint', phone: '+97145551111', makes: undefined, condition: undefined, parts: 'покраска', service: undefined, locationUrl: undefined, address: 'Qusais', notes: undefined },
    ]);
  });

  it('keeps unknown columns as notes; without a header — name and phone', () => {
    const rows = [
      ['Shop name', 'Mobile', 'Type', 'Rating'],
      ['Sharjah Used Spares', '0559998877', 'Used, workshop', '5'],
    ];
    expect(suppliersFromRows(rows)[0]).toMatchObject({ name: 'Sharjah Used Spares', phone: '+971559998877', condition: 'used', service: true, notes: 'Rating: 5' });
    expect(suppliersFromRows([['Ali Spares', '0501112233']])[0]).toMatchObject({ name: 'Ali Spares', phone: '+971501112233' });
    expect(sameSupplier({ name: 'A', phone: '+971501112233' }, { name: 'B', phone: '+971 50 111 2233' })).toBe(true);
    expect(sameSupplier({ name: 'Ali Spares ' }, { name: 'ali spares' })).toBe(true);
  });
});
