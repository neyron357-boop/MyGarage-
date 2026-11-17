import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { addNote } from './notes';
import { addItem } from './estimate';
import { approveAll, leaveOnDebt } from './flow';
import { addPayment, quickInvoice } from './money';
import { checkIn, loadOrderBundle, loadRowBundles } from './orders';
import { phaseOf } from './flow';
import { jobAmount, jobTotal } from '../features/board/JobRow';
import { orderFlags } from '../features/orders/flags';
import { ensureSeed } from './seed';

/*
 * The reads made lighter (v0.37) give what the full reads gave.
 */

async function job(n: number, vehicleId?: string) {
  return checkIn({ vehicleId, plate: { emirate: 'DXB', code: 'K', number: String(30000 + n) }, make: 'Toyota', model: 'Camry', name: `Customer ${n}`, phone: `050 000 ${String(1000 + n)}`, docLanguage: 'en', complaint: 'Noise', arrivedNow: true });
}

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('jobs read as a list row shows them (v0.37)', () => {
  it('hold what the row is made of as the whole job does — its step, its sums, its flags — in the order asked', async () => {
    const jobs = [];
    for (let n = 0; n < 4; n++) {
      const o = await job(n);
      for (let k = 0; k < 3; k++) await addItem(o.id, { kind: k % 2 ? 'part' : 'labor', block: 'A', titleEn: `Line ${n}.${k}`, unitPriceFils: 1000 * (k + 1) });
      if (n > 0) await approveAll(o.id);
      if (n > 1) {
        await quickInvoice(o.id);
        await addPayment(o.id, { kind: 'payment', amountFils: 500, method: 'cash' });
      }
      if (n === 3) await leaveOnDebt(o.id, { amountFils: 100, dueDate: '2026-12-31', signature: new Blob(['s'], { type: 'image/png' }) });
      await addNote(o.id, { text: `Note ${n}` });
      jobs.push(o.id);
    }
    const asked = [jobs[2], 'gone', jobs[0], jobs[3], jobs[1]];
    const rows = await loadRowBundles((await db.orders.bulkGet(asked)).map((o) => o ?? ({ id: 'gone', customerId: 'none', vehicleId: 'none' } as never)));
    const whole = await Promise.all(asked.map((id) => loadOrderBundle(id)));
    expect(rows.map((b) => b?.order.id)).toEqual(asked.map((id) => (id === 'gone' ? undefined : id)));
    const row = (b: (typeof rows)[number]) =>
      b && JSON.parse(JSON.stringify({ order: b.order, customer: b.customer, vehicle: b.vehicle, items: b.items, versions: b.versions, payments: b.payments, invoices: b.invoices, debts: b.debts, incidents: b.incidents, phase: phaseOf(b), amount: jobAmount(b), total: jobTotal(b), flags: orderFlags(b, '2026-11-17T10:00:00.000Z') }));
    expect(rows.map(row)).toEqual(whole.map(row));
    // What a row does not show is not read.
    expect(rows.every((b) => !b || (!b.events.length && !b.notes.length && !b.media.length))).toBe(true);
  });
});

describe('«Сегодня» reading only the lines it needs (v0.37)', () => {
  it('gives the same tasks as reading every line of every job closed in the last year and more', async () => {
    const { addDays, nowIso } = await import('../domain/dates');
    const { loadPast, tasksFor } = await import('./today');
    const { todayTasks } = await import('../domain/today');
    const now = nowIso();
    // Closed: an oil service half a year ago (the reminder), a repair five days ago ("how is the car?"), an oil
    // service too long ago, an older oil service of a car whose last job was a repair.
    const plan: [days: number, oil: boolean][] = [
      [200, true],
      [5, false],
      [700, true],
      [300, true],
      [190, false],
    ];
    const ids: string[] = [];
    let car = '';
    for (const [n, [days, oil]] of plan.entries()) {
      // The last two are one car's two jobs.
      const o = await job(n, n === 4 ? car : undefined);
      car = o.vehicleId;
      await addItem(o.id, { kind: 'labor', block: 'A', titleEn: oil ? 'Oil change' : 'Brake repair', unitPriceFils: 10000 });
      await approveAll(o.id);
      const at = addDays(now, -days);
      await db.orders.update(o.id, { stage: 'closed', closedAt: at, outcome: 'completed', updatedAt: at });
      ids.push(o.id);
    }
    const lean = tasksFor([], await loadPast(now), now);
    // As before v0.37: every line of every job closed in the last 420 days.
    const closed = (await db.orders.where('stage').equals('closed').toArray()).filter((o) => (o.closedAt ?? o.updatedAt) >= addDays(now, -420));
    const items = await db.items.where('orderId').anyOf(closed.map((o) => o.id)).toArray();
    const customers = await db.customers.bulkGet(closed.map((o) => o.customerId));
    const vehicles = await db.vehicles.bulkGet(closed.map((o) => o.vehicleId));
    const full = todayTasks({
      open: [],
      past: closed.map((o) => ({ order: o, items: items.filter((i) => i.orderId === o.id), hasPhone: !!customers.find((c) => c?.id === o.customerId)?.phone })),
      vehicles: new Map(vehicles.filter((v) => !!v).map((v) => [v!.id, v!])),
      warnHours: 2,
      alertHours: 24,
      now,
    });
    expect(lean).toEqual(full);
    expect(lean.map((t) => t.kind).sort()).toEqual(['followUp', 'service']);
  });
});

describe('the debts read only off the jobs that may owe (v0.37)', () => {
  it('are the jobs every job gone would show owing — paid, on credit, an old one closed owing, closed without payment, history', async () => {
    const { loadDebtJobs } = await import('./debts');
    const { orderDue, isCustomerDebt } = await import('../domain/debts');
    const made: string[] = [];
    for (let n = 0; n < 6; n++) {
      const o = await job(10 + n);
      await addItem(o.id, { kind: 'labor', block: 'A', titleEn: `Work ${n}`, unitPriceFils: 20000 });
      await approveAll(o.id);
      if (n !== 5) await quickInvoice(o.id);
      made.push(o.id);
    }
    const [paid, credit, oldOwing, waived, history, noInvoice] = made;
    await addPayment(paid, { kind: 'payment', amountFils: 21000, method: 'cash' });
    await db.orders.update(paid, { stage: 'closed', closedAt: nowIsoLater() });
    await leaveOnDebt(credit, { amountFils: 21000, dueDate: '2026-12-31', signature: new Blob(['s'], { type: 'image/png' }) });
    await addPayment(oldOwing, { kind: 'payment', amountFils: 5000, method: 'card' });
    await db.orders.update(oldOwing, { stage: 'closed', closedAt: nowIsoLater() });
    await db.orders.update(waived, { stage: 'closed', waived: { at: nowIsoLater() } as never });
    await db.orders.update(history, { stage: 'closed', imported: { history: true } as never });
    await db.orders.update(noInvoice, { stage: 'delivered' });
    // As before v0.37: every job gone, read whole.
    const all = (await db.orders.where('stage').anyOf('delivered', 'closed').toArray()).filter((o) => !o.imported?.history && !o.waived);
    const want: string[] = [];
    for (const o of all) {
      const due = orderDue(o, await db.items.where('orderId').equals(o.id).toArray(), await db.invoices.where('orderId').equals(o.id).toArray(), await db.payments.where('orderId').equals(o.id).toArray());
      if (isCustomerDebt(o, due)) want.push(`${o.id}:${due}`);
    }
    const got = (await loadDebtJobs()).map((d) => `${d.order.id}:${d.dueFils}`);
    expect(got.sort()).toEqual(want.sort());
    expect(got.map((g) => g.split(':')[0]).sort()).toEqual([credit, oldOwing, noInvoice].sort());
  });
});

function nowIsoLater() {
  return new Date(Date.now() + 1000).toISOString();
}
