import { db } from '../db/db';
import { addDays, dubaiDate, nowIso, runAt } from '../domain/dates';
import { FUNCTION_CHECKS, QC_CHECKS, REQUIRED_SLOTS } from '../domain/inspection';
import type { CheckState, Lang, Order } from '../domain/types';
import { createCustomer, createVehicle } from './customers';
import { demoPhoto, demoSignature } from './demoPhotos';
import { addItem, addTemplate, recordDecisions, sendVersion, setDone } from './estimate';
import { addInspectionPhoto, getOrCreateInspection, signInspection, updateInspection } from './inspections';
import { addExpense, addPayment, createDebt, issueInvoice } from './money';
import { assignMechanic, changeStage, completeQc, createOrder } from './orders';
import { saveSupplier, setProcurement } from './parts';

const hoursAgo = (h: number) => addDays(nowIso(), -h / 24);
const at = <T,>(hAgo: number, fn: () => Promise<T>) => runAt(hoursAgo(hAgo), fn);

const ALL_OK = Object.fromEntries(FUNCTION_CHECKS.map((c) => [c, 'ok' as CheckState]));
const QC_ALL = Object.fromEntries(QC_CHECKS.map((c) => [c, true]));

/** Sign an intake act with a full set of (drawn) photos. */
async function intake(orderId: string, color: string, signer: string, mileageKm: number, extra: { complaint?: string; fuel?: 0 | 25 | 50 | 75 | 100 } = {}) {
  const insp = await getOrCreateInspection(orderId, 'intake');
  for (const s of REQUIRED_SLOTS) await addInspectionPhoto(insp.id, s, await demoPhoto(s, color));
  await addInspectionPhoto(insp.id, 'dashboard', await demoPhoto('dashboard', color));
  await updateInspection(insp.id, {
    mileageKm,
    fuelLevel: extra.fuel ?? 50,
    noDamage: true,
    obdNoCodes: true,
    keysCount: 2,
    spareWheel: true,
    jack: true,
    functionChecks: ALL_OK,
    ...(extra.complaint ? { complaint: extra.complaint } : {}),
  });
  return signInspection(insp.id, signer, await demoSignature(signer.length));
}

/** Sign a handover act. Without photos the angles are marked as skipped (customer in a hurry). */
async function handover(orderId: string, color: string | null, signer: string, mileageKm: number, lang: Lang) {
  const insp = await getOrCreateInspection(orderId, 'handover');
  if (color) for (const s of REQUIRED_SLOTS) await addInspectionPhoto(insp.id, s, await demoPhoto(s, color));
  const reason = lang === 'ru' ? 'Клиент торопится' : 'Customer in a hurry';
  await updateInspection(insp.id, {
    mileageKm,
    fuelLevel: 50,
    skippedPhotos: color ? {} : Object.fromEntries(REQUIRED_SLOTS.map((s) => [s, reason])),
  });
  return signInspection(insp.id, signer, await demoSignature(signer.length + 2));
}

async function approveAll(orderId: string, via: 'whatsapp' | 'in_person' | 'phone' = 'in_person') {
  const v = await sendVersion(orderId, { via });
  await recordDecisions(
    v.id,
    v.items.map((i) => ({ itemId: i.itemId, decision: i.block === 'B' ? ('do_if_needed' as const) : ('approve' as const) })),
    via === 'whatsapp' ? 'messenger' : via,
  );
  return v;
}

async function doneAll(orderId: string) {
  const items = await db.items.where('orderId').equals(orderId).toArray();
  for (const i of items) if (i.approvalState === 'approved' && !i.done) await setDone(i.id, true);
}

async function receiveParts(orderId: string, supplierId: string, paidCash = false) {
  const parts = (await db.items.where('orderId').equals(orderId).toArray()).filter((i) => i.kind === 'part' && i.approvalState === 'approved' && !i.customerSupplied);
  for (const p of parts) {
    const cost = Math.round(p.unitPriceFils * 0.72);
    await setProcurement(p.id, { status: 'received', supplierId, costPriceFils: cost, purchaseVatFils: Math.round(cost * p.qty * 0.05), paidCash });
  }
}

/**
 * Sample garage to try the app: jobs at every stage (booked, diagnostics, waiting for the customer,
 * waiting for parts, in progress, ready, a debt and a closed job), suppliers, payments and expenses.
 * Photos and signatures are drawn stand-ins marked "DEMO". Only offered while there are no jobs.
 */
export async function loadDemoData(): Promise<void> {
  const yesterday = dubaiDate(addDays(nowIso(), -1));
  const mech = (await db.employees.toArray()).filter((e) => e.active);
  const m1 = mech[0]?.id;
  const m2 = mech[1]?.id ?? m1;

  const [ahmed, ivan, fleet, anna, rahul, fatima] = await at(24 * 30, async () => [
    await createCustomer({ name: 'Ahmed Al Mansoori', phone: '050 123 4567', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual', source: 'google_maps' }),
    await createCustomer({ name: 'Иван Петров', phone: '055 987 6543', preferredChannel: 'telegram', telegram: '@ivan_petrov', docLanguage: 'ru', type: 'individual', source: 'referral', notes: 'Постоянный клиент, просит звонить до 18:00' }),
    await createCustomer({ name: 'Omar Khalid', phone: '052 555 1212', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'company', companyName: 'Desert Logistics LLC', trn: '100123456700003', address: 'Al Quoz Industrial 3, Dubai', source: 'other' }),
    await createCustomer({ name: 'Анна Смирнова', phone: '058 444 2020', preferredChannel: 'whatsapp', docLanguage: 'ru', type: 'individual', source: 'social' }),
    await createCustomer({ name: 'Rahul Mehta', phone: '056 321 7788', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual', source: 'signage' }),
    await createCustomer({ name: 'Fatima Hassan', phone: '054 909 1100', preferredChannel: 'call', docLanguage: 'en', type: 'individual', source: 'repeat' }),
  ]);
  const [camry, patrol, hilux, sportage, accord, rx] = await at(24 * 30, async () => [
    await createVehicle(ahmed.id, { plate: { emirate: 'DXB', code: 'A', number: '12345' }, make: 'Toyota', model: 'Camry', year: 2018, color: 'White', vin: 'JTNB11HK6J3012345' }),
    await createVehicle(ivan.id, { plate: { emirate: 'SHJ', code: '3', number: '45678' }, make: 'Nissan', model: 'Patrol', year: 2016, color: 'Silver' }),
    await createVehicle(fleet.id, { plate: { emirate: 'AUH', code: '12', number: '9876' }, make: 'Toyota', model: 'Hilux', year: 2020, color: 'White' }),
    await createVehicle(anna.id, { plate: { emirate: 'DXB', code: 'K', number: '30451' }, make: 'Kia', model: 'Sportage', year: 2019, color: 'Red' }),
    await createVehicle(rahul.id, { plate: { emirate: 'DXB', code: 'R', number: '7720' }, make: 'Honda', model: 'Accord', year: 2017, color: 'Blue' }),
    await createVehicle(fatima.id, { plate: { emirate: 'AJM', code: 'B', number: '55120' }, make: 'Lexus', model: 'RX 350', year: 2021, color: 'Black' }),
  ]);

  const parts = await at(24 * 20, () =>
    saveSupplier({ name: 'Al Quoz Auto Parts', phone: '+97143334455', locationUrl: 'https://maps.google.com/?q=Al+Quoz+Industrial+Area+3', notes: 'Toyota/Nissan оригинал, доставка в тот же день' }),
  );
  const spares = await at(24 * 20, () => saveSupplier({ name: 'Sharjah Spares Market', phone: '+97165556677', notes: 'Дешевле, но проверять номера' }));

  // 1. Closed five days ago: oil service, paid in cash, handed over with photos.
  const closed: Order = await at(24 * 5, () => createOrder({ customerId: ahmed.id, vehicleId: camry.id, complaint: 'Service 60,000 km', arrivedNow: true }));
  await at(24 * 5 - 0.2, () => intake(closed.id, '#f4f5f7', ahmed.name, 59870));
  await at(24 * 5 - 0.6, async () => {
    await assignMechanic(closed.id, m1);
    const tpl = await db.jobTemplates.where('code').equals('oil_service').first();
    if (tpl) await addTemplate(closed.id, tpl.id);
    await approveAll(closed.id, 'in_person');
    await changeStage(closed.id, 'awaiting_parts');
    await receiveParts(closed.id, parts.id, true);
    await changeStage(closed.id, 'in_progress');
  });
  await at(24 * 5 - 3, async () => {
    await doneAll(closed.id);
    await changeStage(closed.id, 'quality_check');
    await completeQc(closed.id, QC_ALL);
    await issueInvoice(closed.id);
    const due = await amountDue(closed.id);
    if (due > 0) await addPayment(closed.id, { kind: 'payment', method: 'cash', amountFils: due });
  });
  await at(24 * 5 - 4, () => handover(closed.id, '#f4f5f7', ahmed.name, 59884, 'en'));

  // 2. Handed over three days ago on credit; the debt was due yesterday.
  const debt = await at(24 * 3, () => createOrder({ customerId: fleet.id, vehicleId: hilux.id, complaint: 'A/C not cooling', arrivedNow: true }));
  await at(24 * 3 - 0.2, () => intake(debt.id, '#f4f5f7', fleet.name, 141200, { fuel: 25 }));
  await at(24 * 3 - 1, async () => {
    await assignMechanic(debt.id, m2);
    const tpl = await db.jobTemplates.where('code').equals('ac_service').first();
    if (tpl) await addTemplate(debt.id, tpl.id);
    await approveAll(debt.id, 'phone');
    await changeStage(debt.id, 'awaiting_parts');
    await receiveParts(debt.id, spares.id);
    await changeStage(debt.id, 'in_progress');
    await doneAll(debt.id);
    await changeStage(debt.id, 'quality_check');
    await completeQc(debt.id, QC_ALL);
    await issueInvoice(debt.id, 'tax_invoice');
    await createDebt(debt.id, await amountDue(debt.id), yesterday, await demoSignature(3));
  });
  await at(24 * 3 - 2, () => handover(debt.id, null, fleet.name, 141236, 'en'));

  // 3. Ready since this morning; the customer has not been told yet.
  const ready = await at(30, () => createOrder({ customerId: fatima.id, vehicleId: rx.id, complaint: 'Car does not start in the morning', arrivedNow: true }));
  await at(29.8, () => intake(ready.id, '#22252b', fatima.name, 38450, { fuel: 75 }));
  await at(28, async () => {
    await assignMechanic(ready.id, m2);
    const tpl = await db.jobTemplates.where('code').equals('battery').first();
    if (tpl) await addTemplate(ready.id, tpl.id);
    await approveAll(ready.id, 'phone');
    await changeStage(ready.id, 'awaiting_parts');
    await receiveParts(ready.id, parts.id);
    await changeStage(ready.id, 'in_progress');
  });
  await at(4, async () => {
    await doneAll(ready.id);
    await changeStage(ready.id, 'quality_check');
    await completeQc(ready.id, QC_ALL);
  });

  // 4. In progress: service, one job of three done.
  const work = await at(26, () => createOrder({ customerId: ivan.id, vehicleId: patrol.id, complaint: 'ТО 60 000 км, проверить подвеску', arrivedNow: true }));
  await at(25.8, () => intake(work.id, '#c3c8d0', ivan.name, 149870));
  await at(24, async () => {
    await assignMechanic(work.id, m1);
    const tpl = await db.jobTemplates.where('code').equals('oil_service').first();
    if (tpl) await addTemplate(work.id, tpl.id);
    await addItem(work.id, { kind: 'labor', block: 'A', titleRu: 'Диагностика подвески', titleEn: 'Suspension check', unitPriceFils: 10000 });
    await approveAll(work.id, 'in_person');
    await changeStage(work.id, 'awaiting_parts');
    await receiveParts(work.id, parts.id);
    await changeStage(work.id, 'in_progress');
  });
  await at(2, async () => {
    const first = (await db.items.where('orderId').equals(work.id).toArray()).find((i) => i.kind === 'labor' && i.approvalState === 'approved');
    if (first) await setDone(first.id, true);
  });

  // 5. Waiting for parts: timing belt ordered, to be picked up today.
  const waitParts = await at(28, () => createOrder({ customerId: anna.id, vehicleId: sportage.id, complaint: 'Пора менять ремень ГРМ, 90 000 км', arrivedNow: true }));
  await at(27.8, () => intake(waitParts.id, '#c0392b', anna.name, 90120));
  await at(26, async () => {
    await assignMechanic(waitParts.id, m1);
    const tpl = await db.jobTemplates.where('code').equals('timing_belt').first();
    if (tpl) await addTemplate(waitParts.id, tpl.id);
    await approveAll(waitParts.id, 'whatsapp');
    await changeStage(waitParts.id, 'awaiting_parts');
    for (const p of (await db.items.where('orderId').equals(waitParts.id).toArray()).filter((i) => i.kind === 'part')) {
      await setProcurement(p.id, { status: 'ordered', supplierId: parts.id, costPriceFils: Math.round(p.unitPriceFils * 0.7), expectedAt: dubaiDate() });
    }
  });

  // 6. Estimate sent on WhatsApp three hours ago, no answer yet.
  const waiting = await at(5, () => createOrder({ customerId: ahmed.id, vehicleId: camry.id, complaint: 'Squeaking brakes, A/C weak', arrivedNow: true }));
  await at(4.8, () => intake(waiting.id, '#f4f5f7', ahmed.name, 61240));
  await at(3.2, async () => {
    await assignMechanic(waiting.id, m2);
    await addItem(waiting.id, { kind: 'labor', block: 'A', titleRu: 'Замена передних тормозных колодок', titleEn: 'Front brake pads replacement', unitPriceFils: 12000 });
    await addItem(waiting.id, { kind: 'part', block: 'A', titleRu: 'Колодки передние (комплект)', titleEn: 'Front brake pads (set)', unit: 'set', unitPriceFils: 18000, costPriceFils: 13000 });
    await addItem(waiting.id, { kind: 'part', block: 'B', titleRu: 'Передние тормозные диски', titleEn: 'Front brake discs', unitPriceFils: 40000, priceMinFils: 30000, priceMaxFils: 50000, ifNotDoneEn: 'Pads wear out twice as fast on worn discs' });
    await addItem(waiting.id, { kind: 'labor', block: 'C', titleRu: 'Обслуживание кондиционера', titleEn: 'A/C service', unitPriceFils: 15000, urgency: 'yellow', ifNotDoneEn: 'Weak cooling in summer' });
  });
  await at(3, () => sendVersion(waiting.id, { via: 'whatsapp' }));

  // 7. Diagnostics: estimate drafted from a template, not sent yet.
  const diag = await at(1.6, () => createOrder({ customerId: rahul.id, vehicleId: accord.id, complaint: 'Noise from the front when braking', arrivedNow: true }));
  await at(1.4, () => intake(diag.id, '#2f5fb3', rahul.name, 104300, { fuel: 25 }));
  await at(0.5, async () => {
    const tpl = await db.jobTemplates.where('code').equals('brake_pads_front').first();
    if (tpl) await addTemplate(diag.id, tpl.id);
  });

  // 8. Booked for later today.
  await createOrder({ customerId: fleet.id, vehicleId: hilux.id, complaint: 'Check Engine light on', arrivedNow: false, bookedFor: addDays(nowIso(), 0.06) });

  // Expenses this month.
  const cats = await db.expenseCategories.toArray();
  const cat = (code: string) => cats.find((c) => c.code === code)?.id;
  const today = dubaiDate();
  const day = (d: number) => `${today.slice(0, 8)}${String(Math.max(1, Math.min(Number(today.slice(8)), d))).padStart(2, '0')}`;
  if (cat('consumables')) await addExpense({ date: day(2), categoryId: cat('consumables')!, amountFils: 8500, vatFils: 405, vendor: 'ADNOC', method: 'card', note: 'Ветошь, очиститель, перчатки' });
  if (cat('tools')) await addExpense({ date: day(5), categoryId: cat('tools')!, amountFils: 12000, vatFils: 571, vendor: 'Ace Hardware', method: 'card', note: 'Съёмник подшипников' });
}

async function amountDue(orderId: string): Promise<number> {
  const { loadOrderBundle, bundleAmountDue } = await import('./orders');
  const b = await loadOrderBundle(orderId);
  return b ? bundleAmountDue(b) : 0;
}
