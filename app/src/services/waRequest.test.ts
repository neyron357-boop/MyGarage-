import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { byPosition } from '../domain/items';
import { optionItems } from '../domain/quoteOptions';
import { requestPlan } from '../domain/waRequest';
import { ensureSeed } from './seed';
import { makeRequestJob } from './waRequest';

/* v0.90, #69: a customer's request in WhatsApp — a job of «Заявки» with its lines, the labour charge and two options. */

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

const plan = (number = '12345') =>
  requestPlan({
    isRequest: true,
    car: { make: 'Nissan', model: 'Altima', year: 2015, plate: { emirate: 'DXB', code: 'V', number } },
    items: [{ name: 'Engine mount', kind: 'part', both: true }],
    owner: 'Sam Lee',
    confidence: 0.9,
  })!;
const chat = { id: '971500000001@c.us', name: 'Someone', phone: '971500000001' };

describe('a job made of a WhatsApp request', () => {
  it('in «Заявки», the car booked, original and copy as two lines and two options, the labour charge in both', async () => {
    const made = (await makeRequestJob(plan(), chat, true, 'I want to change the engine mount', 'false_x_AAA'))!;
    const order = (await db.orders.get(made.orderId))!;
    expect([order.stage, order.boardTab, order.fromChat?.msg, order.complaint]).toEqual(['booked', 'request', 'false_x_AAA', 'I want to change the engine mount']);
    const vehicle = (await db.vehicles.get(order.vehicleId))!;
    expect([vehicle.make, vehicle.model, vehicle.year, vehicle.plate.number]).toEqual(['Nissan', 'Altima', 2015, '12345']);
    // Forwarded: the car's owner is whom the messages name — not the one who passed them on.
    const customer = (await db.customers.get(order.customerId))!;
    expect([customer.name, customer.phone]).toEqual(['Sam Lee', '']);
    const items = (await db.items.where('orderId').equals(order.id).toArray()).sort(byPosition);
    expect(items.map((i) => i.titleEn)).toEqual(['ENGINE MOUNT ORIGINAL', 'ENGINE MOUNT AFTERMARKET', 'LABOUR CHARGES: ENGINE MOUNT']);
    const [a, b] = order.quoteOptions!;
    expect([a.name, b.name]).toEqual(['Original', 'Aftermarket']);
    expect(optionItems(items, a).map((i) => i.titleEn)).toEqual(['ENGINE MOUNT ORIGINAL', items[2].titleEn]);
    expect(optionItems(items, b).map((i) => i.titleEn)).toEqual(['ENGINE MOUNT AFTERMARKET', items[2].titleEn]);
    // The same messages looked at again — not a second job.
    expect(await makeRequestJob(plan(), chat, true, '', 'false_x_AAA')).toBeUndefined();
  });

  it('the chat’s own request: its person is the customer (by number); no plate — no job', async () => {
    const made = (await makeRequestJob(plan('54321'), chat, false, 'brakes', 'false_x_BBB'))!;
    const customer = (await db.customers.get((await db.orders.get(made.orderId))!.customerId))!;
    expect([customer.name, customer.phone]).toEqual(['Someone', '+971500000001']);
    expect(await makeRequestJob({ ...plan(), plate: undefined }, chat, false, '', 'false_x_CCC')).toBeUndefined();
  });
});
