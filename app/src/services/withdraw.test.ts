import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { addItem, previewVersion, recordDecisions, sendVersion, updateItem, withdrawItems } from './estimate';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

async function job() {
  return checkIn({ plate: { emirate: 'DXB', code: 'W', number: `${Math.floor(Math.random() * 90000) + 10000}` }, make: 'Kia', model: 'Rio', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
}

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('items waiting for the customer', () => {
  it('a message only shown freezes nothing: the items stay drafts', async () => {
    const o = await job();
    const a = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Brake pads', unitPriceFils: 12000 });
    const v = await previewVersion(o.id, { via: 'whatsapp' });
    expect(v.number).toBe(1);
    expect(await db.versions.where('orderId').equals(o.id).count()).toBe(0);
    expect((await db.items.get(a.id))!.approvalState).toBe('draft');
  });

  it('taken back to draft they can be changed; removed they leave the estimate; the version is withdrawn', async () => {
    const o = await job();
    const a = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Brake pads', unitPriceFils: 12000 });
    const b = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Pads', unitPriceFils: 9000 });
    const v1 = await sendVersion(o.id, { via: 'whatsapp' });
    expect((await db.items.get(a.id))!.approvalState).toBe('pending');
    await expect(updateItem(a.id, { unitPriceFils: 15000 })).rejects.toBeTruthy();

    expect(await withdrawItems([a.id])).toBe(1);
    expect((await db.items.get(a.id))!.approvalState).toBe('draft');
    await updateItem(a.id, { unitPriceFils: 15000 });
    expect((await db.versions.get(v1.id))!.status).toBe('sent'); // b still waits

    await withdrawItems([b.id], { cancel: true });
    expect((await db.items.get(b.id))!.approvalState).toBe('cancelled');
    expect((await db.versions.get(v1.id))!.status).toBe('withdrawn');
    // The sent version stays as it was sent (history).
    expect((await db.versions.get(v1.id))!.items.map((s) => s.itemId).sort()).toEqual([a.id, b.id].sort());
    // The next version is v2, not v1 again.
    const v2 = await sendVersion(o.id, { via: 'whatsapp' });
    expect(v2.number).toBe(2);
  });

  it('a version answered in part is "answered" once the rest is taken back', async () => {
    const o = await job();
    const a = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    const b = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Wipers', unitPriceFils: 3000 });
    const v1 = await sendVersion(o.id, { via: 'telegram' });
    await recordDecisions(v1.id, [{ itemId: a.id, decision: 'approve' }], 'in_person');
    await withdrawItems([b.id]);
    expect((await db.versions.get(v1.id))!.status).toBe('answered');
  });

  it('a block B item taken back is a clean draft: the earlier choice is asked again', async () => {
    const o = await job();
    const b = await addItem(o.id, { kind: 'part', block: 'B', titleEn: 'Boot', unitPriceFils: 5000, priceMinFils: 4000, priceMaxFils: 8000 });
    const v1 = await sendVersion(o.id, { via: 'whatsapp' });
    await recordDecisions(v1.id, [{ itemId: b.id, decision: 'do_if_needed' }], 'messenger');
    expect((await db.items.get(b.id))!.bChoice).toBe('do_if_needed');
    await withdrawItems([b.id]);
    const back = (await db.items.get(b.id))!;
    expect(back.approvalState).toBe('draft');
    expect(back.bChoice).toBeUndefined();
  });

  it('an untaxed line keeps its zero rate through sending and the invoice', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Service', unitPriceFils: 10000 });
    await addItem(o.id, { kind: 'fee', block: 'A', titleEn: 'RTA test fee', unitPriceFils: 5000, vatRateBp: 0 });
    const v1 = await sendVersion(o.id, { via: 'in_person' });
    expect(v1.items.find((s) => s.title === 'RTA TEST FEE')).toMatchObject({ net: 5000, vat: 0, gross: 5000 });
    expect(v1.fixedGross).toBe(10500 + 5000);
  });
});
