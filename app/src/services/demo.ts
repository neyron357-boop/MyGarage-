import { db } from '../db/db';
import { addDays, nowIso } from '../domain/dates';
import { createCustomer, createVehicle } from './customers';
import { addItem, recordDecisions, sendVersion } from './estimate';
import { createOrder } from './orders';

/** Sample data to try the app. Only offered while there are no orders. */
export async function loadDemoData(): Promise<void> {
  const ahmed = await createCustomer({ name: 'Ahmed Al Mansoori', phone: '050 123 4567', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual', source: 'google_maps' });
  const ivan = await createCustomer({ name: 'Иван Петров', phone: '055 987 6543', preferredChannel: 'telegram', docLanguage: 'ru', type: 'individual', source: 'referral' });
  const fleet = await createCustomer({ name: 'Omar Khalid', phone: '052 555 1212', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'company', companyName: 'Desert Logistics LLC', trn: '100123456700003', address: 'Al Quoz, Dubai', source: 'other' });
  const camry = await createVehicle(ahmed.id, { plate: { emirate: 'DXB', code: 'A', number: '12345' }, make: 'Toyota', model: 'Camry', year: 2018 });
  const patrol = await createVehicle(ivan.id, { plate: { emirate: 'SHJ', code: '3', number: '45678' }, make: 'Nissan', model: 'Patrol', year: 2016 });
  const hilux = await createVehicle(fleet.id, { plate: { emirate: 'AUH', code: '12', number: '9876' }, make: 'Toyota', model: 'Hilux', year: 2020 });

  // 1. Waiting for the customer's answer
  const o1 = await createOrder({ customerId: ahmed.id, vehicleId: camry.id, complaint: 'Squeaking brakes, A/C weak', arrivedNow: true });
  await addItem(o1.id, { kind: 'labor', block: 'A', titleRu: 'Замена передних тормозных колодок', titleEn: 'Front brake pads replacement', unitPriceFils: 12000 });
  await addItem(o1.id, { kind: 'part', block: 'A', titleRu: 'Колодки передние', titleEn: 'Front brake pads', unitPriceFils: 18000, costPriceFils: 13000 });
  await addItem(o1.id, { kind: 'part', block: 'B', titleRu: 'Передние тормозные диски', titleEn: 'Front brake discs', unitPriceFils: 40000, priceMinFils: 30000, priceMaxFils: 50000 });
  await addItem(o1.id, { kind: 'labor', block: 'C', titleRu: 'Обслуживание кондиционера', titleEn: 'A/C service', unitPriceFils: 15000, urgency: 'yellow' });
  await db.orders.update(o1.id, { stage: 'diagnostics' });
  await sendVersion(o1.id, { via: 'whatsapp' });

  // 2. In progress
  const o2 = await createOrder({ customerId: ivan.id, vehicleId: patrol.id, complaint: 'ТО 60 000 км', arrivedNow: true });
  await addItem(o2.id, { kind: 'labor', block: 'A', titleRu: 'Замена масла и масляного фильтра', titleEn: 'Oil and oil filter change', unitPriceFils: 8000 });
  await addItem(o2.id, { kind: 'part', block: 'A', titleRu: 'Моторное масло 5W-30', titleEn: 'Engine oil 5W-30', unitPriceFils: 12000, costPriceFils: 8500, procurementStatus: 'received' });
  await db.orders.update(o2.id, { stage: 'diagnostics' });
  const v2 = await sendVersion(o2.id, { via: 'in_person' });
  await recordDecisions(v2.id, v2.items.map((i) => ({ itemId: i.itemId, decision: 'approve' as const })), 'in_person');
  await db.orders.update(o2.id, { stage: 'in_progress', stageChangedAt: nowIso() });

  // 3. Booked for later today
  await createOrder({ customerId: fleet.id, vehicleId: hilux.id, complaint: 'Check engine light', arrivedNow: false, bookedFor: addDays(nowIso(), 0.1) });
}
