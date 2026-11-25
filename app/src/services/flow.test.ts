import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { addItem, sendVersion } from './estimate';
import { answerLines, approveAll, archiveJob, carArrived, closeUnpaid, dropLine, leaveOnDebt, lineDone, partsToFind, phaseOf, refuseAll, noteLineQty, removeLines, reopenJob, restoreFromBin, restoreLines, setBoardStatus, setLineQty, syncStage, takeBack } from './flow';
import { binOf } from '../domain/bin';
import { addPayment, createDebt, quickInvoice } from './money';
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
    // The car is here: it stands on diagnostics at once (not from the first look at the job).
    expect(await state(o.id)).toEqual({ phase: 'look', stage: 'diagnostics' });
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

  it('the stage moves with what is done, never with a look: check-in, a booked car that comes', async () => {
    const o = await job();
    expect(o.stage).toBe('diagnostics');
    expect((await db.events.where('orderId').equals(o.id).toArray()).map((e) => [e.type, e.payload?.stage])).toEqual([['created', 'diagnostics']]);
    // What the job screen did on every opening: nothing to move, nothing written.
    await syncStage(o.id);
    expect(await db.events.where('orderId').equals(o.id).count()).toBe(1);
    expect((await db.orders.get(o.id))!.stageChangedAt).toBe(o.stageChangedAt);

    const booked = await checkIn({ plate: { emirate: 'DXB', code: 'B', number: '24680' }, make: 'Kia', model: 'Rio', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: false, bookedFor: new Date().toISOString() });
    expect(booked.stage).toBe('booked');
    await carArrived(booked.id);
    expect(await state(booked.id)).toEqual({ phase: 'look', stage: 'diagnostics' });
    expect((await db.orders.get(booked.id))!.arrivedAt).toBeTruthy();
  });

  it('on credit: the customer signs, the car leaves with the debt; the payment that clears it closes the job', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Diagnostics', unitPriceFils: 20000 });
    await approveAll(o.id);
    const inv = await quickInvoice(o.id);
    await expect(leaveOnDebt(o.id)).rejects.toMatchObject({ code: 'sign.required' });
    await leaveOnDebt(o.id, { amountFils: inv.totalFils, dueDate: '2026-12-01', signature: new Blob(['sig'], { type: 'image/png' }) });
    let b = (await loadOrderBundle(o.id))!;
    expect({ phase: phaseOf(b), stage: b.order.stage, debts: b.debts.map((d) => d.status) }).toEqual({ phase: 'debt', stage: 'delivered', debts: ['open'] });
    // Signed once: a second go does not sign again.
    await expect(leaveOnDebt(o.id)).rejects.toMatchObject({ code: 'stageErr.notAllowed' });
    await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: inv.totalFils });
    b = (await loadOrderBundle(o.id))!;
    expect({ stage: b.order.stage, debts: b.debts.map((d) => d.status) }).toEqual({ stage: 'closed', debts: ['paid'] });
  });

  it('a part fitted (marked done) lets the job waiting for its parts go on', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Pads replacement', unitPriceFils: 12000 });
    const part = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Brake pads', unitPriceFils: 18000 });
    await approveAll(o.id);
    expect(await state(o.id)).toEqual({ phase: 'work', stage: 'awaiting_parts' });
    await lineDone(part.id, true);
    expect(await state(o.id)).toEqual({ phase: 'work', stage: 'in_progress' });
  });

  it('a waiting line taken off: with the rest agreed, the work goes on', async () => {
    const o = await job();
    const a = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    const b = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'A/C service', unitPriceFils: 15000 });
    await sendVersion(o.id, { via: 'whatsapp' });
    await syncStage(o.id);
    await answerLines([a.id], 'approve');
    expect(await state(o.id)).toEqual({ phase: 'wait', stage: 'awaiting_approval' });
    await takeBack([b.id], { cancel: true });
    expect(await state(o.id)).toEqual({ phase: 'work', stage: 'in_progress' });
    expect((await db.items.get(b.id))!.approvalState).toBe('cancelled');
    // Taken back to change it (a draft again): the stage does not go back by itself.
    const c = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Wheel alignment', unitPriceFils: 8000 });
    await sendVersion(o.id, { via: 'whatsapp' });
    await takeBack([c.id]);
    expect((await db.items.get(c.id))!.approvalState).toBe('draft');
    expect((await state(o.id)).stage).toBe('in_progress');
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
    // Undone: out of the bin again.
    expect((await db.orders.get(o.id))!.removedLines).toBeUndefined();
  });

  it('keeps what was taken off in the job’s bin, and brings it back (v0.68)', async () => {
    const o = await job();
    const agreed = await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000, qty: 2 });
    await approveAll(o.id);
    const draft = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Filter', unitPriceFils: 3000, partNumber: '90915-YZZD4' });
    await removeLines([agreed.id, draft.id]);
    const bin = () => db.orders.get(o.id).then(async (order) => binOf(order!, await db.items.where('orderId').equals(o.id).toArray()));
    expect((await bin()).map((l) => [l.item.titleEn, l.how])).toEqual([['FILTER', 'deleted'], ['OIL CHANGE', 'cancelled']]);

    expect(await restoreFromBin(o.id, [draft.id, agreed.id])).toBe(2);
    // The deleted one is itself again (its number); the cancelled one stays cancelled, a new draft like it beside it.
    expect((await db.items.get(draft.id))!).toMatchObject({ approvalState: 'draft', partNumber: '90915-YZZD4' });
    expect((await db.items.get(agreed.id))!).toMatchObject({ approvalState: 'cancelled' });
    const copy = (await db.items.where('orderId').equals(o.id).toArray()).find((i) => i.titleEn === 'OIL CHANGE' && i.id !== agreed.id)!;
    expect(copy).toMatchObject({ approvalState: 'draft', qty: 2, unitPriceFils: 10000, done: false });
    expect(await bin()).toEqual([]);
    expect(await restoreFromBin(o.id, [agreed.id])).toBe(0);
    // After the invoice nothing comes back.
    await removeLines([copy.id]);
    await approveAll(o.id);
    await quickInvoice(o.id);
    await expect(restoreFromBin(o.id, [copy.id])).rejects.toThrow();
  });

  it('puts jobs in a tab of the board; the car that comes is no more a request; reopened — by its step (v0.70)', async () => {
    const a = await job();
    const b = await job();
    expect(await setBoardStatus([a.id, b.id], 'request')).toBe(2);
    expect(await setBoardStatus([a.id], 'request')).toBe(0);
    expect((await db.orders.get(b.id))!.boardTab).toBe('request');
    await carArrived(b.id).catch(() => undefined);
    expect((await db.orders.get(b.id))!.boardTab).toBeUndefined();
    await setBoardStatus([a.id], 'wait');
    await addItem(a.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    await sendVersion(a.id, { via: 'whatsapp' });
    await refuseAll(a.id);
    await reopenJob(a.id);
    expect((await db.orders.get(a.id))!.boardTab).toBeUndefined();
  });

  it('brings refused lines back — the job closed by the refusal reopened first (v0.70)', async () => {
    const o = await job();
    const a = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'AC compressor', unitPriceFils: 68250 });
    await sendVersion(o.id, { via: 'whatsapp' });
    await refuseAll(o.id);
    expect((await db.orders.get(o.id))!.stage).toBe('closed');
    const bin = await db.orders.get(o.id).then(async (order) => binOf(order!, await db.items.where('orderId').equals(o.id).toArray()));
    expect(bin.map((l) => l.how)).toEqual(['declined']);
    expect(await restoreFromBin(o.id, [a.id])).toBe(1);
    expect((await db.orders.get(o.id))!.stage).not.toBe('closed');
    const items = await db.items.where('orderId').equals(o.id).toArray();
    expect(items.find((i) => i.id === a.id)).toMatchObject({ approvalState: 'declined' });
    expect(items.find((i) => i.id !== a.id)).toMatchObject({ approvalState: 'draft', titleEn: 'AC COMPRESSOR', unitPriceFils: 68250 });
  });

  it('puts a line’s quantity right in any state before the invoice; its price said for both stops the asking (v0.70)', async () => {
    const o = await job();
    // Lines from before v0.85, when the name's count was only asked about: one each.
    const old = async (input: Parameters<typeof addItem>[1]) => {
      const it = await addItem(o.id, input);
      await db.items.update(it.id, { qty: 1 });
      return it;
    };
    const told = await old({ kind: 'part', block: 'A', titleEn: 'Mirror LH+RH', unitPriceFils: 8000, vatRateBp: 0 });
    const agreed = await old({ kind: 'part', block: 'A', titleEn: 'Tie rod end L/R', unitPriceFils: 6000, vatRateBp: 0 });
    await approveAll(o.id);
    const waiting = await old({ kind: 'part', block: 'A', titleEn: 'Wiper blade pair', unitPriceFils: 2000, vatRateBp: 0 });
    await sendVersion(o.id, { via: 'whatsapp' });
    const draft = await old({ kind: 'part', block: 'A', titleEn: 'Steering boot left & right', unitPriceFils: 5000, vatRateBp: 0 });
    await setLineQty(draft.id, 2);
    await setLineQty(waiting.id, 2);
    await setLineQty(agreed.id, 2);
    const now = async (id: string) => (await db.items.get(id))!;
    expect([(await now(draft.id)).qty, (await now(draft.id)).approvalState]).toEqual([2, 'draft']);
    // The one waiting is a draft again with its quantity; the agreed one stays agreed, at the new sum, in a new version.
    expect([(await now(waiting.id)).qty, (await now(waiting.id)).approvalState]).toEqual([2, 'draft']);
    expect([(await now(agreed.id)).qty, (await now(agreed.id)).approvalState]).toEqual([2, 'approved']);
    expect((await db.versions.where('orderId').equals(o.id).toArray()).some((v) => v.kind === 'price_change')).toBe(true);
    await noteLineQty(told.id, 2);
    expect((await now(told.id)).qtyNoted).toBe(2);
    await quickInvoice(o.id);
    await expect(setLineQty(told.id, 2)).rejects.toThrow();
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

  it('closes without payment and without a debt: invoiced, in the workshop, or gone with a signed debt', async () => {
    // Invoiced, part paid: the rest is let go, the invoice and payment stay.
    const inv = await job();
    await addItem(inv.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    await approveAll(inv.id);
    const doc = await quickInvoice(inv.id);
    await addPayment(inv.id, { kind: 'payment', method: 'cash', amountFils: 5000 });
    await expect(changeStage(inv.id, 'closed')).rejects.toThrow();
    await closeUnpaid(inv.id);
    let b = (await loadOrderBundle(inv.id))!;
    expect(b.order).toMatchObject({ stage: 'closed', outcome: 'completed', waived: { fils: doc.totalFils - 5000 } });
    expect(b.order.deliveredAt).toBeTruthy();
    expect(bundleAmountDue(b)).toBe(0);
    expect(phaseOf(b)).toBe('closed');
    expect(b.invoices[0].status).toBe('issued');
    expect(b.events.find((e) => e.type === 'closed_unpaid')?.payload).toEqual({ fils: 5500 });
    // Reopened: what it owes counts again.
    await reopenJob(inv.id);
    b = (await loadOrderBundle(inv.id))!;
    expect(b.order.waived).toBeUndefined();
    expect(bundleAmountDue(b)).toBe(5500);
    expect(phaseOf(b)).toBe('pay');

    // Agreed work, no invoice (warranty, for free): closed as it is.
    const free = await job();
    await addItem(free.id, { kind: 'labor', block: 'A', titleEn: 'Rework', unitPriceFils: 20000 });
    await approveAll(free.id);
    await closeUnpaid(free.id);
    b = (await loadOrderBundle(free.id))!;
    expect(b.order.stage).toBe('closed');
    expect(b.invoices).toHaveLength(0);
    expect(b.order.waived!.fils).toBe(21000);

    // Gone with a signed debt: the debt is written off.
    const owed = await job();
    await addItem(owed.id, { kind: 'labor', block: 'A', titleEn: 'Brakes', unitPriceFils: 10000 });
    await approveAll(owed.id);
    await quickInvoice(owed.id);
    await createDebt(owed.id, 10500, '2030-01-01', new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: 'image/png' }));
    await closeUnpaid(owed.id);
    b = (await loadOrderBundle(owed.id))!;
    expect(b.order.stage).toBe('closed');
    expect(b.debts[0].status).toBe('written_off');
    expect(bundleAmountDue(b)).toBe(0);

    // Nothing due (a look, nothing agreed), or already closed: not this way.
    const look = await job();
    await expect(closeUnpaid(look.id)).rejects.toThrow();
    await expect(closeUnpaid(free.id)).rejects.toThrow();
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
