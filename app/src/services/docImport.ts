import { db } from '../db/db';
import { parseGarageDoc, type GarageDoc } from '../domain/docImport';
import { activeInvoice } from '../domain/invoice';
import { itemAmounts, itemTitle } from '../domain/items';
import type { TextItem } from '../domain/obdReport';
import { normalizePhone } from '../domain/phone';
import { plateSearchKey } from '../domain/plates';
import type { Customer, OrderItem } from '../domain/types';
import { priceFromEntered } from '../domain/vat';
import { findCustomerByPhone, updateCustomer, updateVehicle } from './customers';
import { AppError } from './errors';
import { addItem, setDone } from './estimate';
import { approveAll, syncStage } from './flow';
import { checkIn, logEvent } from './orders';
import { getSettings } from './settings';

/*
 * A job from the garage's invoice or quotation (a PDF from Eaglecart or from this app), in one go: the car
 * by its plate (the one in the base, or a new one with its make, model and colour), its customer (by
 * phone, TRN or name — or a new one), the job it is in now or a new one, and the lines with the prices as
 * printed. A quotation's lines wait to be told to the customer; an invoice's are agreed and done, its parts
 * here — "Done" then issues this app's invoice. A line already on the job is not added twice.
 */

export interface DocImport {
  orderId: string;
  kind: GarageDoc['kind'];
  number?: string;
  /** Lines added to the job. */
  added: number;
  /** Lines the job already had. */
  skipped: number;
  /** A new job (not the one the car was in). */
  newJob: boolean;
}

const OPEN = (stage: string) => !['delivered', 'closed', 'cancelled'].includes(stage);

export async function importGarageDoc(items: TextItem[]): Promise<DocImport> {
  const doc = parseGarageDoc(items);
  if (!doc || !doc.lines.length) throw new AppError('docImport.badFile');
  const plate = doc.vehicle.plate;
  if (!plate?.number) throw new AppError('docImport.noPlate');
  const settings = await getSettings();

  // The car: the one in the base with this plate (its emirate first), else a new one.
  const cars = (await db.vehicles.where('plateSearch').equals(plateSearchKey(plate)).toArray()).filter((v) => !v.archivedAt);
  const car = cars.find((v) => v.plate.emirate === plate.emirate) ?? cars[0];
  const phone = doc.customer.phone && normalizePhone(doc.customer.phone) ? doc.customer.phone : '';
  const company = !!doc.customer.trn || /\b(L\.?L\.?C|LLC|FZE|FZCO|FZ-LLC|DMCC|TRADING|CONTRACTING|GROUP|COMPANY|CO\.)\b/i.test(doc.customer.name);

  // The job: the one the car is in now (not invoiced yet), else a new one.
  let orderId: string | undefined;
  if (car) {
    const orders = (await db.orders.where('vehicleId').equals(car.id).toArray()).filter((o) => OPEN(o.stage)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const o of orders) {
      if (!activeInvoice(await db.invoices.where('orderId').equals(o.id).toArray())) {
        orderId = o.id;
        break;
      }
    }
  }
  const newJob = !orderId;
  if (!orderId) {
    const customer = car ? undefined : await findCustomer(doc, phone);
    const order = await checkIn({
      vehicleId: car?.id,
      customerId: customer?.id,
      plate: { emirate: plate.emirate, code: plate.code, number: plate.number },
      make: doc.vehicle.make,
      model: doc.vehicle.model,
      name: customer ? '' : doc.customer.name,
      phone: customer ? '' : phone,
      docLanguage: customer?.docLanguage ?? 'en',
      complaint: '',
      arrivedNow: true,
    });
    orderId = order.id;
  }
  const order = (await db.orders.get(orderId))!;

  // What the card is missing comes from the document (never over what is there).
  const [customer, vehicle] = await Promise.all([db.customers.get(order.customerId), db.vehicles.get(order.vehicleId)]);
  if (customer) {
    const fill: Partial<Customer> = {};
    if (!customer.name && doc.customer.name) fill.name = doc.customer.name;
    if (!customer.phone && phone) fill.phone = phone;
    if (!customer.email && doc.customer.email) fill.email = doc.customer.email;
    if (!customer.trn && doc.customer.trn) fill.trn = doc.customer.trn;
    if (company && customer.type !== 'company' && (!customer.name || customer.name === doc.customer.name)) {
      fill.type = 'company';
      fill.companyName = customer.companyName || doc.customer.name;
    }
    if (Object.keys(fill).length) await updateCustomer(customer.id, fill);
  }
  if (vehicle) {
    const fill: Partial<typeof vehicle> = {};
    if (!vehicle.make && doc.vehicle.make) fill.make = doc.vehicle.make;
    if (!vehicle.model && doc.vehicle.model) fill.model = doc.vehicle.model;
    if (!vehicle.color && doc.vehicle.color) fill.color = doc.vehicle.color;
    if (!vehicle.vin && doc.vehicle.vin) fill.vin = doc.vehicle.vin;
    if (Object.keys(fill).length) await updateVehicle(vehicle.id, fill);
  }

  // The lines, priced as printed: the line's total with VAT is what the customer pays.
  const had = (await db.items.where('orderId').equals(orderId).toArray()).filter((i) => ['draft', 'pending', 'approved'].includes(i.approvalState));
  const seen = new Set(had.map((i) => `${itemTitle(i, 'en')}|${itemAmounts(i).gross}`));
  const added: OrderItem[] = [];
  let skipped = 0;
  for (const l of doc.lines) {
    if (seen.has(`${l.title}|${l.totalFils}`)) {
      skipped++;
      continue;
    }
    seen.add(`${l.title}|${l.totalFils}`);
    const rate = l.vatFils > 0 ? settings.vatRateBp : 0;
    const qty = l.qty > 0 ? l.qty : 1;
    // Per unit with VAT, kept to the fils ("VAT in the price"); a total that does not divide stays as one.
    const even = Number.isInteger(l.totalFils / qty);
    const price = priceFromEntered(even ? l.totalFils / qty : l.totalFils, rate, rate ? 'incl' : 'none');
    added.push(
      await addItem(orderId, {
        kind: l.kind,
        block: 'A',
        titleEn: even || qty === 1 ? l.title : `${l.title} ×${qty}`,
        qty: even ? qty : 1,
        ...price,
        vatRateBp: rate,
        procurementStatus: l.kind === 'part' ? (doc.kind === 'invoice' ? 'received' : 'needed') : undefined,
      }),
    );
  }
  // An invoice: the work was agreed and done.
  if (doc.kind === 'invoice' && added.length) {
    await approveAll(orderId);
    for (const i of added) await setDone(i.id, true);
  }
  await logEvent(orderId, 'doc_imported', { kind: doc.kind, number: doc.number, date: doc.date, lines: added.length, skipped });
  await syncStage(orderId);
  return { orderId, kind: doc.kind, number: doc.number, added: added.length, skipped, newJob };
}

/** The document's customer already in the base: by phone, by TRN, or by the very same name. */
async function findCustomer(doc: GarageDoc, phone: string): Promise<Customer | undefined> {
  if (phone) {
    const c = await findCustomerByPhone(phone);
    if (c) return c;
  }
  const trn = doc.customer.trn;
  if (trn) {
    const c = await db.customers.filter((x) => !x.archivedAt && x.trn === trn).first();
    if (c) return c;
  }
  const name = doc.customer.name.trim().toLowerCase();
  if (name.length >= 3) return db.customers.filter((x) => !x.archivedAt && [x.name, x.companyName ?? ''].some((n) => n.trim().toLowerCase() === name)).first();
  return undefined;
}
