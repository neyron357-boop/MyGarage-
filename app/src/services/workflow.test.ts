import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, ImmutableError, setDb, uid } from '../db/db';
import { REQUIRED_SLOTS } from '../domain/inspection';
import { createCustomer, createVehicle, search } from './customers';
import { AppError } from './errors';
import { addItem, approveByLimit, limitRemaining, recordDecisions, resolveB, sendVersion, setDone, updateItem } from './estimate';
import { addInspectionPhoto, completeInspection, getOrCreateInspection, signInspection, updateInspection } from './inspections';
import { addCashMovement, addExpense, addPayment, cashState, closeCashDay, createDebt, issueCreditNote, issueInvoice, quickInvoice } from './money';
import { bundleAmountDue, changeStage, checkIn, completeQc, createOrder, declineRepair, loadOrderBundle } from './orders';
import { setProcurement } from './parts';
import { ensureSeed } from './seed';
import { versionMessage } from './messages';

const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3, Math.random() * 255])], { type: 'image/png' });

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

async function newOrder() {
  const c = await createCustomer({ name: 'Ahmed Ali', phone: '050 123 4567', preferredChannel: 'whatsapp', docLanguage: 'ru', type: 'individual' });
  const v = await createVehicle(c.id, { plate: { emirate: 'DXB', code: 'A', number: `${Math.floor(Math.random() * 90000) + 10000}` }, make: 'Toyota', model: 'Camry' });
  const o = await createOrder({ customerId: c.id, vehicleId: v.id, complaint: 'Скрип тормозов', arrivedNow: true });
  return { c, v, o };
}

async function signIntake(orderId: string, limitFils = 20000) {
  const insp = await getOrCreateInspection(orderId, 'intake');
  for (const s of REQUIRED_SLOTS) await addInspectionPhoto(insp.id, s, png());
  await updateInspection(insp.id, {
    mileageKm: 120000,
    fuelLevel: 50,
    noDamage: true,
    obdNoCodes: true,
    conditions: { ...insp.conditions!, noCallLimitFils: limitFils },
  });
  return signInspection(insp.id, 'Ahmed Ali', png());
}

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('search', () => {
  it('finds customers by plate, phone and name', async () => {
    const { v } = await newOrder();
    expect((await search(v.plate.number.slice(0, 3)))[0]?.vehicle?.id).toBe(v.id);
    expect((await search('050 123'))[0]?.customer.name).toBe('Ahmed Ali');
    expect((await search('ahmed')).length).toBeGreaterThan(0);
    await expectAppError(createVehicle((await db.customers.toArray())[0].id, { plate: v.plate, make: 'X', model: 'Y' }), 'err.plateExists');
  });
});

describe('intake act', () => {
  it('a retake replaces the photo in its slot; extra photos add up; a camera thumbnail is kept', async () => {
    const { o } = await newOrder();
    const insp = await getOrCreateInspection(o.id, 'intake');
    const first = await addInspectionPhoto(insp.id, 'front', png());
    const thumb = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const second = await addInspectionPhoto(insp.id, 'front', png(), { thumb, replace: true });
    const front = await db.media.where('ownerId').equals(insp.id).filter((m) => m.slot === 'front').toArray();
    expect(front.map((m) => m.id)).toEqual([second.id]);
    expect(await db.mediaBlobs.get(first.id)).toBeUndefined();
    expect((await db.mediaBlobs.get(second.id))?.thumb?.size).toBe(3);
    await addInspectionPhoto(insp.id, 'extra', png());
    await addInspectionPhoto(insp.id, 'extra', png());
    expect(await db.media.where('ownerId').equals(insp.id).filter((m) => m.slot === 'extra').count()).toBe(2);
  });

  it('a failed retake keeps the old photo', async () => {
    const { o } = await newOrder();
    const insp = await getOrCreateInspection(o.id, 'intake');
    const first = await addInspectionPhoto(insp.id, 'rear', png());
    await completeInspection(insp.id);
    await signInspection(insp.id, 'Ahmed Ali', png()).catch(() => undefined); // incomplete: not signed
    await db.inspections.update(insp.id, { locked: true });
    await expectAppError(addInspectionPhoto(insp.id, 'rear', png(), { replace: true }), 'err.signedLocked');
    expect((await db.media.where('ownerId').equals(insp.id).filter((m) => m.slot === 'rear').toArray()).map((m) => m.id)).toEqual([first.id]);
  });

  it('can be saved empty without a signature, and is frozen once signed', async () => {
    const { o } = await newOrder();
    const insp = await getOrCreateInspection(o.id, 'intake');
    // Fast check-in: nothing is required; the job moves on and the act stays editable.
    const saved = await completeInspection(insp.id);
    expect(saved.completedAt).toBeTruthy();
    expect(saved.locked).toBe(false);
    expect((await db.orders.get(o.id))!.stage).toBe('diagnostics');
    await updateInspection(insp.id, { mileageKm: 98000 });
    const signed = await signIntake(o.id);
    expect(signed.locked).toBe(true);
    expect((await db.orders.get(o.id))!.stage).toBe('diagnostics');
    await expectAppError(updateInspection(signed.id, { mileageKm: 1 }), 'err.signedLocked');
    // Even direct database writes are refused.
    await expect(db.inspections.update(signed.id, { mileageKm: 1 })).rejects.toBeInstanceOf(ImmutableError);
    const photo = await db.media.where('ownerId').equals(signed.id).first();
    expect(photo?.locked).toBe(true);
    await expect(db.media.delete(photo!.id)).rejects.toBeInstanceOf(ImmutableError);
  });
});

describe('fast path', () => {
  it('checks in a car with no customer details, then invoice, payment and close', async () => {
    const o = await checkIn({ plate: { emirate: 'SHJ', code: '1', number: '77777' }, make: 'Nissan', model: 'Patrol', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    let b = (await loadOrderBundle(o.id))!;
    expect(b.customer.name).toBe('');
    expect(b.customer.phone).toBe('');
    expect(b.order.stage).toBe('intake');
    // Same plate again: the existing car and customer are reused, the missing phone is filled in.
    const again = await checkIn({ vehicleId: b.vehicle.id, plate: b.vehicle.plate, make: '', model: '', name: 'Omar', phone: '055 111 2222', docLanguage: 'en', complaint: '', arrivedNow: false, bookedFor: new Date().toISOString() });
    expect(again.vehicleId).toBe(b.vehicle.id);
    expect((await db.customers.get(b.customer.id))!.phone).toBe('+971551112222');
    await addItem(o.id, { kind: 'labor', block: 'A', titleRu: 'Замена масла', unitPriceFils: 10000 });
    await addItem(o.id, { kind: 'part', block: 'A', titleRu: 'Фильтр', qty: 2, unitPriceFils: 2500, costPriceFils: 1500 });
    const inv = await quickInvoice(o.id);
    expect(inv.totalFils).toBe(15750); // (100 + 2 × 25) AED + 5 % VAT
    b = (await loadOrderBundle(o.id))!;
    expect(b.order.stage).toBe('ready');
    expect(b.items.every((i) => i.approvalState === 'approved' && i.done)).toBe(true);
    await expectAppError(changeStage(o.id, 'closed'), 'stageErr.unpaid');
    await addPayment(o.id, { kind: 'payment', method: 'card', amountFils: 15750 });
    await changeStage(o.id, 'closed');
    b = (await loadOrderBundle(o.id))!;
    expect(b.order.stage).toBe('closed');
    expect(b.order.deliveredAt).toBeTruthy();
    expect(b.order.outcome).toBe('completed');
  });
});

describe('estimate and approvals', () => {
  it('runs the full happy path from check-in to closed job', async () => {
    const { o } = await newOrder();
    await signIntake(o.id);
    const pads = await addItem(o.id, { kind: 'part', block: 'A', titleRu: 'Колодки', titleEn: 'Pads', unitPriceFils: 18000, costPriceFils: 12000 });
    const labor = await addItem(o.id, { kind: 'labor', block: 'A', titleRu: 'Замена колодок', unitPriceFils: 12000 });
    const discs = await addItem(o.id, { kind: 'part', block: 'B', titleRu: 'Диски', unitPriceFils: 40000, priceMinFils: 30000, priceMaxFils: 50000 });
    const ac = await addItem(o.id, { kind: 'labor', block: 'C', titleRu: 'Кондиционер', unitPriceFils: 15000, urgency: 'yellow' });

    const v1 = await sendVersion(o.id, { via: 'whatsapp' });
    expect(v1.number).toBe(1);
    expect(v1.fixedGross).toBe(31500);
    expect(v1.maxGross).toBe(31500 + 52500);
    expect((await db.orders.get(o.id))!.stage).toBe('awaiting_approval');
    expect(versionMessage({ customer: (await db.customers.get(o.customerId))!, vehicle: (await db.vehicles.get(o.vehicleId))!, order: o, garageName: 'G' }, v1)).toContain('от 315,00 AED до 840,00 AED');

    // Sent items are frozen; work cannot be marked done before approval.
    await expectAppError(updateItem(pads.id, { unitPriceFils: 1 }), 'err.itemSent');
    await expectAppError(setDone(labor.id, true), 'err.notApproved');

    await recordDecisions(v1.id, [
      { itemId: pads.id, decision: 'approve' },
      { itemId: labor.id, decision: 'approve' },
      { itemId: discs.id, decision: 'do_if_needed' },
      { itemId: ac.id, decision: 'decline' },
    ], 'messenger');
    expect((await db.versions.get(v1.id))!.status).toBe('answered');

    // Parts must be received before work starts.
    await expectAppError(changeStage(o.id, 'in_progress'), 'stageErr.partsMissing');
    await setProcurement(pads.id, { status: 'received', costPriceFils: 12000, purchaseVatFils: 600, paidCash: true });
    await changeStage(o.id, 'in_progress');

    // After disassembly the discs are needed within the pre-approved range.
    expect(await resolveB(discs.id, true, 45000)).toBe('auto_approved');
    await setProcurement(discs.id, { status: 'received' });

    // A new problem within the no-call limit (200 AED).
    await addItem(o.id, { kind: 'part', block: 'A', titleRu: 'Пыльник', unitPriceFils: 8000, urgency: 'red' });
    expect((await limitRemaining(o.id)).remaining).toBe(20000);
    const v2 = await approveByLimit(o.id, 'Порван пыльник');
    expect(v2.number).toBe(2);
    expect((await limitRemaining(o.id)).remaining).toBe(20000 - 8400);

    // A bigger problem needs the customer.
    const pump = await addItem(o.id, { kind: 'part', block: 'A', titleRu: 'Помпа', unitPriceFils: 50000 });
    await expectAppError(approveByLimit(o.id), 'err.overLimit');
    const v3 = await sendVersion(o.id, { via: 'whatsapp', reason: 'Течь помпы' });
    await expectAppError(changeStage(o.id, 'quality_check'), 'stageErr.awaitingClient');
    await recordDecisions(v3.id, [{ itemId: pump.id, decision: 'decline' }], 'phone');

    const b = (await loadOrderBundle(o.id))!;
    for (const i of b.items.filter((x) => x.approvalState === 'approved')) await setDone(i.id, true);
    await changeStage(o.id, 'quality_check');
    await completeQc(o.id, {});
    expect((await db.orders.get(o.id))!.stage).toBe('ready');

    // Handover cannot be signed before payment.
    const h = await getOrCreateInspection(o.id, 'handover');
    for (const s of REQUIRED_SLOTS) await addInspectionPhoto(h.id, s, png());
    await updateInspection(h.id, { mileageKm: 120005, fuelLevel: 50 });
    await expectAppError(signInspection(h.id, 'Ahmed', png()), 'stageErr.unpaid');

    await addPayment(o.id, { kind: 'prepayment', method: 'cash', amountFils: 10000 });
    const inv = await issueInvoice(o.id);
    expect(inv.type).toBe('simplified_tax_invoice');
    expect(inv.number).toMatch(/^INV-\d{4}-00001$/);
    // pads 180 + labor 120 + discs 450 + boot 80 = 830 net, VAT 41.50
    expect(inv.subtotalFils).toBe(83000);
    expect(inv.vatFils).toBe(4150);
    expect(inv.totalFils).toBe(87150);
    await expectAppError(issueInvoice(o.id), 'err.invoiceExists');
    await expect(db.invoices.update(inv.id, { totalFils: 1 })).rejects.toBeInstanceOf(ImmutableError);

    const due = bundleAmountDue((await loadOrderBundle(o.id))!);
    expect(due).toBe(87150 - 10000);
    await addPayment(o.id, { kind: 'payment', method: 'card', amountFils: due });
    await signInspection(h.id, 'Ahmed', png());
    expect((await db.orders.get(o.id))!.stage).toBe('closed');

    // Correcting an invoice: credit note + new number.
    const cn = await issueCreditNote(inv.id, 'Ошибка в имени');
    expect(cn.number).toMatch(/^CN-\d{4}-00001$/);
    expect((await db.invoices.get(inv.id))!.status).toBe('credited');
    const inv2 = await issueInvoice(o.id);
    expect(inv2.number).toMatch(/00002$/);
  });

  it('declined repair cancels open items (no diagnostics fee since the fast check-in)', async () => {
    const { o } = await newOrder();
    await signIntake(o.id);
    await addItem(o.id, { kind: 'labor', block: 'A', titleRu: 'Ремонт', unitPriceFils: 100000 });
    await sendVersion(o.id, { via: 'whatsapp' });
    await declineRepair(o.id);
    const b = (await loadOrderBundle(o.id))!;
    expect(b.order.stage).toBe('ready');
    expect(b.order.outcome).toBe('repair_declined');
    expect(bundleAmountDue(b)).toBe(0);
    expect(b.items.every((i) => i.approvalState !== 'pending')).toBe(true);
  });

  it('can release a car on credit with a signed debt note', async () => {
    const { o } = await newOrder();
    await signIntake(o.id);
    const it1 = await addItem(o.id, { kind: 'labor', block: 'A', titleRu: 'Работа', unitPriceFils: 10000 });
    const v = await sendVersion(o.id, { via: 'in_person' });
    await recordDecisions(v.id, [{ itemId: it1.id, decision: 'approve' }], 'in_person');
    await changeStage(o.id, 'in_progress');
    await setDone(it1.id, true);
    await changeStage(o.id, 'quality_check');
    await completeQc(o.id, {});
    const h = await getOrCreateInspection(o.id, 'handover');
    for (const s of REQUIRED_SLOTS) await updateInspection(h.id, { skippedPhotos: { ...(await db.inspections.get(h.id))!.skippedPhotos, [s]: 'dark' } });
    await updateInspection(h.id, { mileageKm: 1, fuelLevel: 25 });
    await createDebt(o.id, 10500, '2030-01-01', png());
    await signInspection(h.id, 'Ahmed', png());
    expect((await db.orders.get(o.id))!.stage).toBe('delivered');
    await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: 10500 });
    expect((await db.orders.get(o.id))!.stage).toBe('closed');
    expect((await db.debts.where('orderId').equals(o.id).first())!.status).toBe('paid');
  });
});

describe('cash and expenses', () => {
  it('closes the day and requires a comment for a difference', async () => {
    const { o } = await newOrder();
    await addPayment(o.id, { kind: 'prepayment', method: 'cash', amountFils: 50000 });
    const cat = (await db.expenseCategories.where('code').equals('consumables').first())!;
    await addExpense({ date: '2026-11-06', categoryId: cat.id, amountFils: 10500, vatFils: 500, method: 'cash' });
    await addCashMovement({ direction: 'out', amountFils: 20000, reason: 'collection', note: 'owner' });
    const st = await cashState();
    expect(st.expected).toBe(50000 - 10500 - 20000);
    await expectAppError(closeCashDay(st.expected - 100), 'err.diffCommentRequired');
    const c = await closeCashDay(st.expected - 100, 'shortage');
    expect(c.diffFils).toBe(-100);
    expect((await cashState()).opening).toBe(st.expected - 100);
    expect((await cashState()).movements).toHaveLength(0);
    await expect(db.cashClosings.update(c.id, { actualFils: 0 })).rejects.toBeInstanceOf(ImmutableError);
  });

  it('asks for a comment when the monthly limit is exceeded', async () => {
    const cat = (await db.expenseCategories.where('code').equals('marketing').first())!; // 500 AED
    await addExpense({ date: '2026-11-06', categoryId: cat.id, amountFils: 40000, vatFils: 0, method: 'card' });
    await expectAppError(addExpense({ date: '2026-11-07', categoryId: cat.id, amountFils: 20000, vatFils: 0, method: 'card' }), 'err.overLimitComment');
    await addExpense({ date: '2026-11-07', categoryId: cat.id, amountFils: 20000, vatFils: 0, method: 'card', overLimitComment: 'promo' });
  });
});

describe('concurrency', () => {
  it('opening the check-in twice at the same time creates one act', async () => {
    const { o } = await newOrder();
    const [a, b] = await Promise.all([getOrCreateInspection(o.id, 'intake'), getOrCreateInspection(o.id, 'intake')]);
    expect(a.id).toBe(b.id);
    expect(await db.inspections.where('orderId').equals(o.id).count()).toBe(1);
  });
});
