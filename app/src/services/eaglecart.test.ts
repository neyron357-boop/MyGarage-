import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { summarize } from '../domain/items';
import { createCustomer, createVehicle } from './customers';
import { classifyEcItem, importEaglecart, parseEaglecartFile, parseEcPhone, parseEcPlate, previewEaglecartImport, removeEaglecartImport, type EaglecartExport } from './eaglecart';
import { bundleAmountDue, loadOrderBundle } from './orders';
import { ensureSeed } from './seed';

/** A small made-up export in the shape the Eaglecart admin produces. */
function sample(): EaglecartExport {
  return {
    format: 'eaglecart-export',
    v: 1,
    exportedAt: '2026-11-08T12:00:00.000Z',
    customers: [
      { id: '1', type: 'Personal', group: 'Retail Customer', name: 'JOHN  TEST', phone: '+971971501112233' },
      { id: '2', type: 'Personal', group: 'Corporate', name: 'ACME TRADING LLC', phone: '+971502223344', trn: '100 200 300 400 003' },
      { id: '3', type: 'Personal', group: 'Cash Customer', name: 'NO PHONE', phone: '' },
    ],
    vehicles: [
      { id: '10', customerId: '1', make: 'Toyota', model: 'Corolla', year: '2009', plate: 'CC 78728', zone: 'Dubai' },
      { id: '11', customerId: '1', make: 'Toyota', model: 'Corolla', year: '2009', vin: 'jtd123', plate: 'CC-78728', zone: 'Dubai' },
      { id: '12', customerId: '2', make: 'Nissan', model: 'Urvan', plate: 'A-11111', zone: 'Abu Dhabi' },
      { id: '13', customerId: '3', make: 'Kia', model: 'Rio', plate: '00000', zone: 'Dubai' },
      { id: '14', customerId: '2', make: 'Fuso', model: 'Canter', plate: '5 / 87920', zone: 'Abu Dhabi' },
    ],
    jobs: [
      { id: '100', no: '1', status: 'Delivered', at: '2026-07-19T11:50:00+04:00', customerId: '1', vehicleId: '10', items: [['LABOUR CHARGES', 1, 157.5, 150, 1, 0]], order: { no: '#1014', pay: 'Paid', method: 'Cash', at: '2026-07-19T11:52:00+04:00', total: 157.5 } },
      { id: '101', no: '2', status: 'Pending', at: '2026-08-02T10:00:00+04:00', customerId: '1', vehicleId: '11', items: [['COOLANT', 2, 52.5, 50, 1, 0], ['AC SERVICE INCLUDING AC FREON GAS', 1, 210, 200, 1, 0]] },
      { id: '102', no: '3', status: 'In Progress', at: '2026-09-01T09:00:00+04:00', customerId: '2', vehicleId: '12', discount: 10, items: [['FRONT BRAKE PAD', 1, 315, 300, 1, 0], ['LABOR CHARGE', 1, 105, 100, 1, 0]] },
      { id: '103', no: '4', status: 'Quotation', at: null, customerId: '2', vehicleId: '14', items: [['RADIATOR', 1, 420, 400, 1, 0]] },
      { id: '104', no: '5', status: 'Pending', at: '2026-11-08T09:00:00+04:00', customerId: '3', vehicleId: '13', items: [['ALTERNATOR USED', 1, 346.5, 330, 1, 0]] },
      { id: '105', no: '6', status: 'Pending', at: '2026-11-08T10:00:00+04:00', customerId: '3', vehicleId: '13', items: [] },
    ],
  };
}

const opts = { activeSince: '2026-11-06T00:00:00.000Z', now: '2026-11-08T12:00:00.000Z' };

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('Eaglecart fields', () => {
  it('reads plates in the formats used there', () => {
    expect(parseEcPlate('CC 78728', 'Dubai')).toEqual({ emirate: 'DXB', code: 'CC', number: '78728' });
    expect(parseEcPlate('A - 60942', 'Dubai')).toEqual({ emirate: 'DXB', code: 'A', number: '60942' });
    expect(parseEcPlate('AA--12345', 'Dubai').code).toBe('AA');
    expect(parseEcPlate('35439 O', 'Dubai')).toEqual({ emirate: 'DXB', code: 'O', number: '35439' });
    expect(parseEcPlate('5 / 87920', 'Abu Dhabi')).toEqual({ emirate: 'AUH', code: '5', number: '87920' });
    expect(parseEcPlate('12-34567', 'Abu Dhabi').emirate).toBe('AUH');
    // Abu Dhabi codes are numbers: a letter code with the default zone is a Dubai car.
    expect(parseEcPlate('A-11111', 'Abu Dhabi').emirate).toBe('DXB');
    expect(parseEcPlate('00000', 'Dubai').number).toBe('');
    expect(parseEcPlate('A 12345', 'Ajman').emirate).toBe('AJM');
  });

  it('fixes phones with the country code typed twice', () => {
    expect(parseEcPhone('+971971501112233')).toBe('+971501112233');
    expect(parseEcPhone('+9710501112233')).toBe('+971501112233');
    expect(parseEcPhone('+97143334455')).toBe('+97143334455');
    expect(parseEcPhone('')).toBe('');
  });

  it('tells work from parts by the name', () => {
    for (const w of ['LABOUR CHARGES', 'LABOR CHARGE', 'CAR WASH', 'DISC SKIMMING', 'ALIGNMENT', 'CHANGE OIL & FILTER (10K KILOMETERS)', 'AC SERVICE INCLUDING AC FREON GAS', 'TIRE PUNCTURE REPAIRED', 'RECOVERY'])
      expect(classifyEcItem(w)).toBe('labor');
    for (const p of ['COOLANT', 'AC PIPE', 'BATTERY (12 MONTHS WARRANTY)', 'FRONT BRAKE PAD', 'ALTERNATOR USED', 'GEAR OIL'])
      expect(classifyEcItem(p)).toBe('part');
  });

  it('rejects a file that is not an Eaglecart export', () => {
    expect(() => parseEaglecartFile('{"format":"mygarage-backup"}')).toThrow();
    expect(() => parseEaglecartFile('not json')).toThrow();
    expect(parseEaglecartFile(JSON.stringify(sample())).jobs).toHaveLength(6);
  });
});

describe('Eaglecart import', () => {
  it('brings over customers, cars and jobs; history is never owed; twice is the same as once', async () => {
    const stats = await importEaglecart(sample(), opts);
    expect(stats).toMatchObject({ customers: 3, vehicles: 4, jobs: 5, history: 3, quotations: 1, active: 1, skippedEmpty: 1 });

    // The same car entered twice in Eaglecart is one car, with the VIN of the second record.
    const corolla = (await db.vehicles.where('plateSearch').equals('CC78728').toArray())[0];
    expect(corolla.vin).toBe('JTD123');
    expect(await db.orders.where('vehicleId').equals(corolla.id).count()).toBe(2);

    const company = await db.customers.get('ec-c-2');
    expect(company).toMatchObject({ type: 'company', companyName: 'ACME TRADING LLC', trn: '100200300400003', phone: '+971502223344' });
    expect((await db.customers.get('ec-c-1'))!.name).toBe('JOHN TEST');

    // Delivered and old open jobs are closed history: lines done, total as in Eaglecart, nothing owed.
    const paid = (await loadOrderBundle('ec-o-100'))!;
    expect(paid.order).toMatchObject({ number: 1, stage: 'closed', outcome: 'completed' });
    expect(paid.order.imported).toMatchObject({ orderNo: '#1014', paidFils: 15750, totalFils: 15750, history: true });
    expect(paid.invoices).toHaveLength(0);
    expect(paid.payments).toHaveLength(0);
    expect(bundleAmountDue(paid)).toBe(0);
    const pending = (await loadOrderBundle('ec-o-101'))!;
    expect(pending.order.stage).toBe('closed');
    expect(summarize(pending.items).approvedGross).toBe(31500); // 2 × 52.50 + 210
    expect(pending.items.find((i) => i.titleEn === 'COOLANT')).toMatchObject({ kind: 'part', qty: 2, unitPriceFils: 5000, done: true });
    expect(pending.items.find((i) => i.titleEn?.startsWith('AC SERVICE'))!.kind).toBe('labor');

    // Discount comes over as a discount line (the total matches Eaglecart's).
    const disc = (await loadOrderBundle('ec-o-102'))!;
    expect(summarize(disc.items).approvedGross).toBe(41000);
    expect(disc.order.imported!.totalFils).toBe(41000);
    expect(disc.vehicle.plate.emirate).toBe('DXB');

    // A quotation is not work done; without a date it takes the date of the job before it.
    const quote = (await loadOrderBundle('ec-o-103'))!;
    expect(quote.order).toMatchObject({ stage: 'cancelled', outcome: 'repair_declined' });
    expect(quote.items.every((i) => i.approvalState === 'declined' && !i.done)).toBe(true);
    expect(quote.order.createdAt).toBe(new Date('2026-09-01T09:00:00+04:00').toISOString());

    // A recent job that was not delivered continues here as an open job with draft lines.
    const active = (await loadOrderBundle('ec-o-104'))!;
    expect(active.order).toMatchObject({ stage: 'diagnostics', outcome: 'in_progress' });
    expect(active.order.imported!.history).toBe(false);
    expect(active.items[0].approvalState).toBe('draft');
    expect(bundleAmountDue(active)).toBe(0); // draft lines are not owed until invoiced
    expect(active.vehicle.plate.number).toBe('');
    expect(await db.orders.get('ec-o-105')).toBeUndefined(); // empty job

    // New jobs continue Eaglecart's numbering.
    expect((await db.counters.get('order'))?.value).toBe(6);

    const counts = async () => ({ c: await db.customers.count(), v: await db.vehicles.count(), o: await db.orders.count(), i: await db.items.count(), own: await db.ownerships.count() });
    const before = await counts();
    const again = await importEaglecart(sample(), opts);
    expect(again).toMatchObject({ customers: 0, vehicles: 0, jobs: 0, alreadyImported: 5 });
    expect(await counts()).toEqual(before);
  });

  it('connects to customers and cars already in MyGarage instead of duplicating them', async () => {
    const c = await createCustomer({ name: 'John', phone: '050 111 2233', preferredChannel: 'whatsapp', docLanguage: 'ru', type: 'individual' });
    const v = await createVehicle(c.id, { plate: { emirate: 'DXB', code: 'CC', number: '78728' }, make: 'Toyota', model: 'Corolla' });
    const stats = await previewEaglecartImport(sample(), opts);
    expect(stats).toMatchObject({ customers: 2, customersMatched: 1, vehicles: 3, vehiclesMatched: 1 });
    await importEaglecart(sample(), opts);
    expect(await db.customers.get('ec-c-1')).toBeUndefined();
    expect((await db.orders.get('ec-o-100'))!).toMatchObject({ customerId: c.id, vehicleId: v.id });
    expect((await db.customers.get(c.id))!.name).toBe('John'); // existing data is not overwritten
  });

  it('can be taken back, keeping what was already worked on in MyGarage', async () => {
    const c = await createCustomer({ name: 'Own', phone: '050 999 8877', preferredChannel: 'whatsapp', docLanguage: 'ru', type: 'individual' });
    await importEaglecart(sample(), opts);
    expect(await removeEaglecartImport()).toBe(5);
    expect(await db.orders.filter((o) => !!o.imported).count()).toBe(0);
    expect(await db.customers.filter((x) => x.id.startsWith('ec-')).count()).toBe(0);
    expect(await db.vehicles.filter((x) => x.id.startsWith('ec-')).count()).toBe(0);
    expect(await db.items.filter((x) => x.id.startsWith('ec-')).count()).toBe(0);
    expect(await db.customers.get(c.id)).toBeDefined();
  });
});
