import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { addItem, sendVersion } from './estimate';
import { answerLines, approveAll, archiveJob, dropLine, partsToFind, phaseOf, refuseAll, removeLines, reopenJob, restoreLines, syncStage } from './flow';
import { addPayment, quickInvoice } from './money';
import { bundleAmountDue, changeStage, checkIn, loadOrderBundle } from './orders';
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

  it('takes several lines off at once: drafts deleted (and back on Undo), told ones cancelled', async () => {
    const o = await job();
    const agreed = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    await approveAll(o.id);
    const waiting = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Brake pads', unitPriceFils: 20000 });
    await sendVersion(o.id, { via: 'whatsapp' });
    const draft = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Filter', unitPriceFils: 3000 });
    const keep = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Wash', unitPriceFils: 2000 });

    const removed = await removeLines([agreed.id, waiting.id, draft.id]);
    expect(removed.map((i) => i.id)).toEqual([draft.id]);
    expect(await db.items.get(draft.id)).toBeUndefined();
    expect((await db.items.get(agreed.id))!.approvalState).toBe('cancelled');
    expect((await db.items.get(waiting.id))!.approvalState).toBe('cancelled');
    expect((await db.items.get(keep.id))!.approvalState).toBe('draft');

    await restoreLines(removed);
    expect((await db.items.get(draft.id))!.approvalState).toBe('draft');
  });

  it('reopens a closed job: invoiced — back to "ready", refused — back in the workshop, history — a job of the app', async () => {
    const paid = await job();
    await addItem(paid.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    await approveAll(paid.id);
    const inv = await quickInvoice(paid.id);
    await addPayment(paid.id, { kind: 'payment', method: 'cash', amountFils: inv.totalFils });
    await changeStage(paid.id, 'closed');
    await reopenJob(paid.id);
    expect(await state(paid.id)).toEqual({ phase: 'out', stage: 'ready' });
    const b = (await loadOrderBundle(paid.id))!;
    expect(b.order.closedAt).toBeUndefined();
    expect(b.invoices).toHaveLength(1);
    expect(b.events.some((e) => e.type === 'reopened')).toBe(true);
    // And it can be handed over again.
    await changeStage(paid.id, 'closed');
    expect((await state(paid.id)).phase).toBe('closed');

    const refused = await job();
    await addItem(refused.id, { kind: 'labor', block: 'A', titleEn: 'Gearbox repair', unitPriceFils: 300000 });
    await sendVersion(refused.id, { via: 'phone' });
    expect(await refuseAll(refused.id)).toBe('closed');
    await reopenJob(refused.id);
    const r = (await loadOrderBundle(refused.id))!;
    expect(r.order.outcome).toBe('in_progress');
    expect(phaseOf(r)).toBe('look');


    // History from Eaglecart: done, never owed here — reopened, it goes on as a job of the app.
    const old = await job();
    const part = await addItem(old.id, { kind: 'part', block: 'A', titleEn: 'Gear used original', unitPriceFils: 300000 });
    await db.items.update(part.id, { approvalState: 'approved', done: true, procurementStatus: undefined });
    await db.orders.update(old.id, { stage: 'closed', imported: { system: 'eaglecart', jobId: '1', jobNo: '259', status: 'Pending', totalFils: 315000, history: true, importedAt: new Date().toISOString() } });
    expect(bundleAmountDue((await loadOrderBundle(old.id))!)).toBe(0);
    await reopenJob(old.id);
    const h = (await loadOrderBundle(old.id))!;
    expect(h.order.imported!.history).toBe(false);
    expect(h.items[0].procurementStatus).toBe('installed');
    expect(phaseOf(h)).toBe('work');
    // "Done" invoices it as any job (no quote was ever sent from Eaglecart, the stage stays early).
    expect((await quickInvoice(old.id)).totalFils).toBe(315000);
    expect(bundleAmountDue(h)).toBe(315000);
  });

  it('archives a job off the board and back, without touching it; reopening brings it back too', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    const before = await state(o.id);
    await archiveJob(o.id, true);
    const b = (await loadOrderBundle(o.id))!;
    expect(b.order.archivedAt).toBeTruthy();
    expect(await state(o.id)).toEqual(before);
    expect(b.events.some((e) => e.type === 'archived')).toBe(true);
    await archiveJob(o.id, false);
    expect((await db.orders.get(o.id))!.archivedAt).toBeUndefined();

    await archiveJob(o.id, true);
    await refuseAll(o.id);
    await reopenJob(o.id);
    expect((await db.orders.get(o.id))!.archivedAt).toBeUndefined();
  });
});
