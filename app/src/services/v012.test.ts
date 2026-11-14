import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { activeInvoice, canAmendInvoice } from '../domain/invoice';
import { byPosition, itemTitle, lineName } from '../domain/items';
import { createCustomer, suggestCustomers } from './customers';
import { addItem, updateItem } from './estimate';
import { amendInvoice, approveAll, phaseOf, reorderLines, reviseLine } from './flow';
import { addPayment, quickInvoice } from './money';
import { checkIn, loadOrderBundle, setJobCustomer } from './orders';
import { ensureSeed } from './seed';

async function job(name = '', phone = '') {
  return checkIn({ plate: { emirate: 'DXB', code: 'K', number: String(Math.floor(Math.random() * 90000) + 10000) }, make: 'Mitsubishi', model: 'Pajero', name, phone, docLanguage: 'en', complaint: '', arrivedNow: true });
}

const titles = async (orderId: string) => (await loadOrderBundle(orderId))!.items.map((i) => itemTitle(i, 'en'));

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('names of work and parts in capitals', () => {
  it('shows every name in capitals, typed before or now; a discount keeps its words', () => {
    expect(itemTitle({ titleEn: 'Oil change', kind: 'labor' }, 'en')).toBe('OIL CHANGE');
    expect(itemTitle({ titleRu: 'Замена масла', kind: 'part' }, 'ru')).toBe('ЗАМЕНА МАСЛА');
    expect(itemTitle({ titleEn: 'Discount 10%', kind: 'discount' }, 'en')).toBe('Discount 10%');
    expect(lineName('Brake pads (set)')).toBe('BRAKE PADS (SET)');
  });

  it('stores the names typed in capitals, on the invoice too', async () => {
    const o = await job();
    const a = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: ' oil change ', unitPriceFils: 10000 });
    expect((await db.items.get(a.id))!.titleEn).toBe('OIL CHANGE');
    await updateItem(a.id, { titleRu: 'замена масла' });
    expect((await db.items.get(a.id))!.titleRu).toBe('ЗАМЕНА МАСЛА');
    const inv = await quickInvoice(o.id);
    expect(inv.lines[0].description).toBe('OIL CHANGE');
  });
});

describe('lines moved by hand', () => {
  it('keeps the order moved to on the job, the quote and the invoice; a line added later goes to the end', async () => {
    const o = await job();
    const a = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'A work', unitPriceFils: 1000 });
    const b = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'B part', unitPriceFils: 2000 });
    const c = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'C work', unitPriceFils: 3000 });
    expect(await titles(o.id)).toEqual(['A WORK', 'B PART', 'C WORK']);

    await reorderLines(o.id, [c.id, a.id, b.id]);
    expect(await titles(o.id)).toEqual(['C WORK', 'A WORK', 'B PART']);

    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'D part', unitPriceFils: 500 });
    expect(await titles(o.id)).toEqual(['C WORK', 'A WORK', 'B PART', 'D PART']);

    await approveAll(o.id);
    const v = (await db.versions.where('orderId').equals(o.id).toArray())[0];
    expect(v.items.map((i) => i.title)).toEqual(['C WORK', 'A WORK', 'B PART', 'D PART']);
    const inv = await quickInvoice(o.id);
    expect(inv.lines.map((l) => l.description)).toEqual(['C WORK', 'A WORK', 'B PART', 'D PART']);
    // The invoice lists them as they were: moved again only after it is changed.
    await expect(reorderLines(o.id, [a.id, c.id])).rejects.toThrow('err.invoiceExists');
  });

  it('keeps refused lines in their places among the others', async () => {
    const o = await job();
    const a = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'A', unitPriceFils: 1000 });
    const x = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'X', unitPriceFils: 1000 });
    const b = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'B', unitPriceFils: 1000 });
    await db.items.update(x.id, { approvalState: 'declined' });
    await reorderLines(o.id, [b.id, a.id]);
    expect(await titles(o.id)).toEqual(['B', 'X', 'A']);
    expect([{ position: 1, createdAt: '2' }, { createdAt: '1' }, { position: 0, createdAt: '3' }].sort(byPosition).map((i) => i.createdAt)).toEqual(['3', '2', '1']);
  });
});

describe('changing the lines after the invoice', () => {
  it('cancels the invoice by a credit note, lets lines be changed and added, and "Done" issues the new one; payments count', async () => {
    const o = await job();
    const oil = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    const first = await quickInvoice(o.id);
    await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: 5000 });
    let b = (await loadOrderBundle(o.id))!;
    expect(phaseOf(b)).toBe('pay');
    expect(canAmendInvoice(b.order.stage, b.invoices, b.debts)).toBe(true);

    await amendInvoice(o.id);
    b = (await loadOrderBundle(o.id))!;
    expect(activeInvoice(b.invoices)).toBeUndefined();
    expect(b.invoices.find((i) => i.id === first.id)!.status).toBe('credited');
    expect(b.invoices.some((i) => i.type === 'credit_note' && i.originalInvoiceId === first.id)).toBe(true);
    expect(b.order.stage).toBe('in_progress');
    expect(phaseOf(b)).toBe('work');

    // A forgotten part, and the agreed work renamed.
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Oil filter', unitPriceFils: 2000 });
    await reviseLine(oil.id);
    expect((await db.items.get(oil.id))!.approvalState).toBe('draft');
    await updateItem(oil.id, { titleEn: 'Engine oil change' });
    await approveAll(o.id);
    const second = await quickInvoice(o.id);
    expect(second.number).not.toBe(first.number);
    expect(second.lines.map((l) => l.description)).toEqual(['ENGINE OIL CHANGE', 'OIL FILTER']);
    b = (await loadOrderBundle(o.id))!;
    expect(b.order.stage).toBe('ready');
    expect(activeInvoice(b.invoices)!.id).toBe(second.id);
    // 100 + 20 + VAT = 126.00, 50.00 paid.
    expect(second.totalFils).toBe(12600);
  });

  it('is not offered once the car has left, nor with a debt signed', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    await quickInvoice(o.id);
    const b = (await loadOrderBundle(o.id))!;
    expect(canAmendInvoice('delivered', b.invoices, [])).toBe(false);
    expect(canAmendInvoice('ready', b.invoices, [{ status: 'open' }])).toBe(false);
    expect(canAmendInvoice('ready', [], [])).toBe(false);
  });
});

describe('a customer already in the base, picked on the job', () => {
  it('moves the job and its car to them and deletes the empty customer made at check-in', async () => {
    const known = await createCustomer({ name: 'Nakash Ahmed', phone: '0501234567', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
    const o = await job();
    const empty = o.customerId;
    expect((await suggestCustomers('', 'nakash', 3, empty)).map((c) => c.id)).toEqual([known.id]);

    await setJobCustomer(o.id, known.id);
    const b = (await loadOrderBundle(o.id))!;
    expect(b.customer.id).toBe(known.id);
    expect(b.vehicle.customerId).toBe(known.id);
    expect(await db.customers.get(empty)).toBeUndefined();
    expect(await db.ownerships.where('customerId').equals(empty).count()).toBe(0);
    expect(await db.ownerships.where('vehicleId').equals(b.vehicle.id).filter((x) => !x.to).first()).toMatchObject({ customerId: known.id });
  });

  it('keeps a customer that has a name (or other jobs), and finds companies by their name', async () => {
    const company = await createCustomer({ name: 'Omar', companyName: 'Jaggie Trading', phone: '', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'company' });
    const o = await job('Ali', '');
    expect((await suggestCustomers('', 'jagg')).map((c) => c.id)).toEqual([company.id]);
    await setJobCustomer(o.id, company.id);
    expect(await db.customers.get(o.customerId)).toBeDefined();
  });
});
