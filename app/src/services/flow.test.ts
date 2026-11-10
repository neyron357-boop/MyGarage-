import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { addItem, sendVersion } from './estimate';
import { answerLines, approveAll, dropLine, partsRequest, partsToFind, phaseOf, refuseAll, syncStage } from './flow';
import { addPayment, quickInvoice } from './money';
import { changeStage, checkIn, loadOrderBundle } from './orders';
import { setProcurement } from './parts';
import { ensureSeed } from './seed';

async function job() {
  return checkIn({ plate: { emirate: 'DXB', code: 'T', number: String(Math.floor(Math.random() * 90000) + 10000) }, make: 'Mitsubishi', model: 'Lancer', name: '', phone: '', docLanguage: 'en', complaint: 'Brake noise', arrivedNow: true });
}
const state = async (id: string) => {
  const b = (await loadOrderBundle(id))!;
  return { phase: phaseOf(b), stage: b.order.stage };
};

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('lazy flow', () => {
  it('check-in, findings, "agreed", parts, done, paid, gone: the job moves by itself', async () => {
    const o = await job();
    expect(await state(o.id)).toEqual({ phase: 'look', stage: 'intake' });
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Front brake pads replacement', unitPriceFils: 12000 });
    const part = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Brake pads', unitPriceFils: 18000 });
    await syncStage(o.id);
    expect(await state(o.id)).toEqual({ phase: 'price', stage: 'diagnostics' });
    expect(partsToFind((await loadOrderBundle(o.id))!.items).map((p) => p.id)).toEqual([part.id]);

    await approveAll(o.id); // told in person
    expect(await state(o.id)).toEqual({ phase: 'work', stage: 'awaiting_parts' });
    await setProcurement(part.id, { status: 'received' });
    await syncStage(o.id);
    expect(await state(o.id)).toEqual({ phase: 'work', stage: 'in_progress' });

    const inv = await quickInvoice(o.id);
    expect(await state(o.id)).toEqual({ phase: 'pay', stage: 'ready' });
    await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: inv.totalFils });
    expect(await state(o.id)).toEqual({ phase: 'out', stage: 'ready' });
    await changeStage(o.id, 'closed');
    expect((await state(o.id)).phase).toBe('closed');
  });

  it('sent by WhatsApp: waiting, then one line agreed and one refused', async () => {
    const o = await job();
    const a = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    const b = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'A/C service', unitPriceFils: 15000 });
    await sendVersion(o.id, { via: 'whatsapp' });
    await syncStage(o.id);
    expect(await state(o.id)).toEqual({ phase: 'wait', stage: 'awaiting_approval' });
    await answerLines([a.id], 'approve');
    expect((await state(o.id)).phase).toBe('wait'); // one still waits
    await answerLines([b.id], 'decline');
    expect(await state(o.id)).toEqual({ phase: 'work', stage: 'in_progress' });
    expect((await db.items.get(b.id))!.approvalState).toBe('declined');
    expect((await db.decisions.where('orderId').equals(o.id).toArray()).map((d) => d.via)).toEqual(['messenger', 'messenger']);
  });

  it('something else found during the work goes to the customer first', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    await approveAll(o.id);
    expect(await state(o.id)).toEqual({ phase: 'work', stage: 'in_progress' });
    const extra = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Brake fluid', unitPriceFils: 8000 });
    expect(await state(o.id)).toEqual({ phase: 'price', stage: 'in_progress' });
    await approveAll(o.id);
    expect((await db.items.get(extra.id))!.approvalState).toBe('approved');
    // The customer changes their mind about it: the line leaves the job.
    await dropLine(extra.id);
    expect((await db.items.get(extra.id))!.approvalState).toBe('cancelled');
    const inv = await quickInvoice(o.id);
    expect(inv.totalFils).toBe(10500);
  });

  it('"refused": nothing to charge for — the job is closed at once, without an invoice', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Engine overhaul', unitPriceFils: 500000 });
    await sendVersion(o.id, { via: 'phone' });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Gasket set', unitPriceFils: 90000 }); // not told yet
    expect(await refuseAll(o.id)).toBe('closed');
    const b = (await loadOrderBundle(o.id))!;
    expect(b.order).toMatchObject({ stage: 'closed', outcome: 'repair_declined' });
    expect(b.invoices).toHaveLength(0);
    expect(b.items.map((i) => i.approvalState)).toEqual(['declined']);
  });

  it('"refused" the rest: what was agreed before is still to be invoiced', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'fee', block: 'A', titleEn: 'Diagnostics', unitPriceFils: 5000 });
    await approveAll(o.id);
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Gearbox repair', unitPriceFils: 300000 });
    expect(await refuseAll(o.id)).toBe('open');
    expect((await state(o.id)).phase).toBe('work');
    expect((await quickInvoice(o.id)).totalFils).toBe(5250);
  });

  it('asks a supplier for the parts in English, with the car', () => {
    const part = { kind: 'part', titleEn: 'Brake pads front', titleRu: 'Колодки', qty: 2, partNumber: '04465-33471' } as never;
    expect(partsRequest({ make: 'Toyota', model: 'Camry', year: 2018, vin: 'JT123' }, [part])).toBe('Hi! Price and availability, please:\n• Brake pads front (04465-33471) × 2\n\nToyota Camry 2018\nVIN: JT123');
  });
});
