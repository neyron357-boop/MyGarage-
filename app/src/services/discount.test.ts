import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { roundTotals } from '../domain/discount';
import { activeInvoice } from '../domain/invoice';
import { itemAmounts } from '../domain/items';
import { setDiscount, syncDiscount } from './discount';
import { addItem, removeItem } from './estimate';
import { addPayment, discountIssuedInvoice, quickInvoice } from './money';
import { bundleAmountDue, checkIn, loadOrderBundle } from './orders';
import { ensureSeed } from './seed';

async function job() {
  return checkIn({ plate: { emirate: 'DXB', code: 'T', number: `${Math.floor(Math.random() * 90000) + 10000}` }, make: 'Mitsubishi', model: 'Lancer', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
}

/** 150 AED labour + 2 × 30 AED parts, VAT on top: 220.50 AED. */
async function lines(orderId: string) {
  await addItem(orderId, { kind: 'labor', block: 'A', titleEn: 'Brake adjustment', unitPriceFils: 15000 });
  await addItem(orderId, { kind: 'part', block: 'A', titleEn: 'Wiper blade', qty: 2, unitPriceFils: 3000 });
}

const total = async (orderId: string) => (await db.items.where('orderId').equals(orderId).toArray()).filter((i) => ['draft', 'approved'].includes(i.approvalState)).reduce((s, i) => s + itemAmounts(i).gross, 0);

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('discounts', () => {
  it('an amount off: the customer pays that much less, VAT goes down with it', async () => {
    const o = await job();
    await lines(o.id);
    expect(await total(o.id)).toBe(22050);
    await setDiscount(o.id, { grossFils: 2050 });
    expect(await total(o.id)).toBe(20000);
    const inv = await quickInvoice(o.id);
    expect(inv.totalFils).toBe(20000);
    expect(inv.vatFils).toBe(1050 - 98); // 20.50 off with VAT inside: 0.98 of it is VAT
    expect(inv.lines.find((l) => l.kind === 'discount')).toMatchObject({ description: 'Discount', gross: -2050, vat: -98 });
  });

  it('a percentage follows the lines until the invoice', async () => {
    const o = await job();
    await lines(o.id);
    await setDiscount(o.id, { pctBp: 1000 });
    expect(await total(o.id)).toBe(22050 - 2205);
    const extra = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Wheel alignment', unitPriceFils: 10000 });
    await syncDiscount(o.id);
    expect(await total(o.id)).toBe(32550 - 3255);
    await removeItem(extra.id);
    const inv = await quickInvoice(o.id); // counted again before it is issued
    expect(inv.totalFils).toBe(22050 - 2205);
    expect(inv.lines.find((l) => l.kind === 'discount')?.description).toBe('Discount 10%');
  });

  it('lines without VAT take their share of the discount without VAT', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Service', unitPriceFils: 10000 }); // 105.00
    await addItem(o.id, { kind: 'fee', block: 'A', titleEn: 'RTA test fee', unitPriceFils: 10000, vatRateBp: 0 }); // 100.00
    await setDiscount(o.id, { grossFils: 2050 });
    const discounts = (await db.items.where('orderId').equals(o.id).toArray()).filter((i) => i.kind === 'discount');
    expect(discounts.map((d) => [d.vatRateBp, itemAmounts(d).gross]).sort()).toEqual([[0, -1000], [500, -1050]]);
    const inv = await quickInvoice(o.id);
    expect(inv.totalFils).toBe(20500 - 2050);
    expect(inv.vatFils).toBe(500 - 50);
  });

  it('removed before the invoice, the lines are as they were', async () => {
    const o = await job();
    await lines(o.id);
    await setDiscount(o.id, { grossFils: 50 });
    await setDiscount(o.id, null);
    expect(await total(o.id)).toBe(22050);
    expect((await db.items.where('orderId').equals(o.id).toArray()).some((i) => i.kind === 'discount')).toBe(false);
    await expect(setDiscount(o.id, { grossFils: 99999 })).rejects.toBeTruthy(); // more than the lines
  });

  it('after the invoice: a credit note and a new invoice with the discount; payments count', async () => {
    const o = await job();
    await lines(o.id);
    const first = await quickInvoice(o.id);
    expect(first.totalFils).toBe(22050);
    await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: 10000 });
    const { credit, invoice } = await discountIssuedInvoice(o.id, { grossFils: 2050 });
    expect(credit.type).toBe('credit_note');
    expect(credit.originalInvoiceId).toBe(first.id);
    expect((await db.invoices.get(first.id))!.status).toBe('credited');
    expect(invoice.totalFils).toBe(20000);
    expect(invoice.type).toBe(first.type);
    const b = (await loadOrderBundle(o.id))!;
    expect(activeInvoice(b.invoices)!.id).toBe(invoice.id);
    expect(bundleAmountDue(b)).toBe(20000 - 10000);
    // Changed again: the discount is replaced, not added on top.
    const again = await discountIssuedInvoice(o.id, { pctBp: 1000 });
    expect(again.invoice.totalFils).toBe(22050 - 2205);
    // Not below what was paid.
    await expect(discountIssuedInvoice(o.id, { grossFils: 15000 })).rejects.toMatchObject({ code: 'err.discountOverPaid' });
    // Taken off again: the full price.
    const none = await discountIssuedInvoice(o.id, null);
    expect(none.invoice.totalFils).toBe(22050);
  });

  it('round totals for one-tap discounts', () => {
    expect(roundTotals(33001)).toEqual([33000, 30000]);
    expect(roundTotals(10500)).toEqual([10000]);
    expect(roundTotals(5)).toEqual([]);
  });
});
