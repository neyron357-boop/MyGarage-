import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { canReprice, itemAmounts } from '../domain/items';
import { setDiscount } from './discount';
import { addItem, sendVersion } from './estimate';
import { approveAll, repriceLine } from './flow';
import { quickInvoice } from './money';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

async function job() {
  return checkIn({ plate: { emirate: 'DXB', code: 'P', number: String(Math.floor(Math.random() * 90000) + 10000) }, make: 'Nissan', model: 'Patrol', name: '', phone: '', docLanguage: 'en', complaint: 'Brake noise', arrivedNow: true });
}

const gross = async (id: string) => itemAmounts((await db.items.get(id))!).gross;
const versionsOf = (orderId: string) => db.versions.where('orderId').equals(orderId).sortBy('number');

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('a new price for a line the customer has seen', () => {
  it('agreed: a price-change version agreed in person; the quote and the answer before stay; drafts stay out', async () => {
    const o = await job();
    // 114.29 + 5 % VAT = 120.00
    const pads = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Front brake pads replacement', unitPriceFils: 11429 });
    await approveAll(o.id);
    const [v1] = await versionsOf(o.id);
    const fluid = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Brake fluid', unitPriceFils: 3000 });
    expect(await gross(pads.id)).toBe(12000);

    expect(await repriceLine(pads.id, 10000)).toBe('agreed');
    const it = (await db.items.get(pads.id))!;
    expect(it).toMatchObject({ approvalState: 'approved', unitGrossFils: 10000 });
    expect(itemAmounts(it)).toMatchObject({ gross: 10000, net: 9524, vat: 476 });

    const [first, second] = await versionsOf(o.id);
    expect(first).toEqual(v1);
    expect(second).toMatchObject({ number: 2, kind: 'price_change', status: 'answered', sentVia: 'in_person' });
    expect(second.items.map((s) => [s.itemId, s.gross])).toEqual([[pads.id, 10000]]);
    expect(it.lastVersionId).toBe(second.id);
    const answers = await db.decisions.where('itemId').equals(pads.id).toArray();
    expect(answers.map((d) => [d.versionId, d.decision, d.via]).sort()).toEqual(
      [
        [v1.id, 'approve', 'in_person'],
        [second.id, 'approve', 'in_person'],
      ].sort(),
    );
    // A line added since and not told yet is not swept into the price change.
    expect((await db.items.get(fluid.id))?.approvalState).toBe('draft');
    const ev = (await db.events.where('orderId').equals(o.id).toArray()).find((e) => e.type === 'price_changed');
    expect(ev?.payload).toMatchObject({ title: 'FRONT BRAKE PADS REPLACEMENT', from: 12000, to: 10000 });

    // The invoice takes the new price.
    const inv = await quickInvoice(o.id);
    expect(inv.totalFils).toBe(10000 + 3150);
  });

  it('waiting for the answer: a draft at the new price to send again; what went out stays', async () => {
    const o = await job();
    const pads = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Front brake pads replacement', unitPriceFils: 11429 });
    const v = await sendVersion(o.id, { via: 'whatsapp' });
    expect(canReprice((await db.items.get(pads.id))!)).toBe(true);

    expect(await repriceLine(pads.id, 9500)).toBe('draft');
    const it = (await db.items.get(pads.id))!;
    expect(it).toMatchObject({ approvalState: 'draft', unitGrossFils: 9500 });
    expect(it.lastVersionId).toBeUndefined();
    const sent = (await db.versions.get(v.id))!;
    expect(sent.status).toBe('withdrawn');
    expect(sent.items[0].gross).toBe(12000);
    expect(await db.decisions.where('itemId').equals(pads.id).count()).toBe(0);
  });

  it('several of a part: the price is per unit, the line is the units together', async () => {
    const o = await job();
    const plugs = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Spark plug', qty: 4, unitPriceFils: 3000 });
    await approveAll(o.id);
    expect(await repriceLine(plugs.id, 2850)).toBe('agreed');
    expect(await gross(plugs.id)).toBe(11400);
  });

  it('the same price changes nothing; no price, a draft, a discount, the customer’s part — not here', async () => {
    const o = await job();
    const pads = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Front brake pads replacement', unitPriceFils: 11429 });
    const own = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Pads (customer)', customerSupplied: true });
    await approveAll(o.id);
    expect(await repriceLine(pads.id, 12000)).toBeNull();
    expect(await db.versions.where('orderId').equals(o.id).count()).toBe(1);
    await expect(repriceLine(pads.id, 0)).rejects.toThrow('err.amountRequired');
    await expect(repriceLine(own.id, 5000)).rejects.toThrow('err.itemSent');
    const draft = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Bleed brakes', unitPriceFils: 5000 });
    await expect(repriceLine(draft.id, 6000)).rejects.toThrow('err.itemSent');
    const [off] = await setDiscount(o.id, { grossFils: 1000 });
    await expect(repriceLine(off, 500)).rejects.toThrow('err.itemSent');
  });

  it('a percentage discount follows the new price; an amount off cannot outgrow the lines', async () => {
    const o = await job();
    const pads = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Front brake pads replacement', unitPriceFils: 11429 });
    await approveAll(o.id);
    const [pct] = await setDiscount(o.id, { pctBp: 1000 });
    expect(await gross(pct)).toBe(-1200);
    await repriceLine(pads.id, 10000);
    const discount = (await db.items.where('orderId').equals(o.id).toArray()).filter((i) => i.kind === 'discount');
    expect(discount.reduce((s, i) => s + itemAmounts(i).gross, 0)).toBe(-1000);

    await setDiscount(o.id, { grossFils: 9000 });
    await expect(repriceLine(pads.id, 8000)).rejects.toThrow('err.discountTooBig');
    expect(await gross(pads.id)).toBe(10000);
  });

  it('once the invoice is out the price is not changed here', async () => {
    const o = await job();
    const pads = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Front brake pads replacement', unitPriceFils: 11429 });
    await approveAll(o.id);
    await quickInvoice(o.id);
    await expect(repriceLine(pads.id, 10000)).rejects.toThrow('err.invoiceExists');
  });
});
