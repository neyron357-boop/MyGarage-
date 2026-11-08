import { db } from '../db/db';
import { itemTitle } from '../domain/items';
import { indexText, type JobDoc, type JobField } from '../domain/search';
import type { Customer, Lang, Order, Vehicle } from '../domain/types';

export interface JobHitData {
  order: Order;
  vehicle?: Vehicle;
  customer?: Customer;
}

function group<T, K extends keyof T>(rows: T[], key: K): Map<T[K], T[]> {
  const m = new Map<T[K], T[]>();
  for (const r of rows) {
    const k = r[key];
    if (k === undefined) continue;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function field(kind: JobField['kind'], text: string, searchText = text): JobField {
  return { kind, text, index: indexText(searchText) };
}

/**
 * Everything a job can be found by besides the car and the customer: its lines (both titles, part
 * number, brand), the complaint, OBD codes, intake notes, the money linked to it, its numbers.
 * Read once and kept while the data does not change; each typed letter only filters it.
 */
export async function loadJobIndex(lang: Lang): Promise<JobDoc<JobHitData>[]> {
  const [orders, items, inspections, marks, addenda, invoices, expenses, incomes, vehicles, customers] = await Promise.all([
    db.orders.toArray(),
    db.items.toArray(),
    db.inspections.toArray(),
    db.damageMarks.toArray(),
    db.addenda.toArray(),
    db.invoices.toArray(),
    db.expenses.toArray(),
    db.incomes.toArray(),
    db.vehicles.toArray(),
    db.customers.toArray(),
  ]);
  const itemsBy = group(items, 'orderId');
  const inspBy = group(inspections, 'orderId');
  const marksBy = group(marks, 'inspectionId');
  const addBy = group(addenda, 'inspectionId');
  const invBy = group(invoices, 'orderId');
  const expBy = group(expenses.filter((e) => !e.voidedAt), 'orderId');
  const incBy = group(incomes.filter((e) => !e.voidedAt), 'orderId');
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  return orders.map((order) => {
    const fields: JobField[] = [];
    for (const i of itemsBy.get(order.id) ?? []) {
      if (i.kind === 'discount') continue;
      const title = itemTitle(i, lang);
      fields.push(field('item', [title, i.partNumber].filter(Boolean).join(' · '), [i.titleRu, i.titleEn, i.partNumber, i.brand].filter(Boolean).join(' ')));
    }
    const ins = inspBy.get(order.id) ?? [];
    const complaints = new Set([order.complaint, ...ins.map((x) => x.complaint ?? '')].map((s) => s.trim()).filter(Boolean));
    for (const c of complaints) fields.push(field('complaint', c));
    if (order.cancelReason?.trim()) fields.push(field('complaint', order.cancelReason.trim()));
    const codes = [...new Set(ins.flatMap((x) => x.obdCodes))];
    if (codes.length) fields.push(field('code', codes.join(', ')));
    for (const x of ins) {
      for (const m of marksBy.get(x.id) ?? []) if (m.note?.trim()) fields.push(field('damage', m.note.trim()));
      for (const a of addBy.get(x.id) ?? []) if (a.text.trim()) fields.push(field('damage', a.text.trim()));
    }
    for (const e of expBy.get(order.id) ?? []) {
      const text = [e.vendor, e.note].filter((s) => s?.trim()).join(' — ');
      if (text) fields.push(field('expense', text));
    }
    for (const e of incBy.get(order.id) ?? []) if (e.note?.trim()) fields.push(field('income', e.note.trim()));

    const vehicle = vehicleById.get(order.vehicleId);
    const customer = customerById.get(order.customerId);
    const owner = indexText(
      [
        vehicle && `${vehicle.plate.code} ${vehicle.plate.number} ${vehicle.plate.code}${vehicle.plate.number}`,
        vehicle?.make,
        vehicle?.model,
        vehicle?.year,
        vehicle?.vin,
        customer?.name,
        customer?.companyName,
      ]
        .filter(Boolean)
        .join(' '),
    );
    const numbers = [String(order.number), order.imported?.jobNo, order.imported?.orderNo, ...(invBy.get(order.id) ?? []).map((x) => x.number)].filter(
      (n): n is string => !!n,
    );
    return { orderId: order.id, number: order.number, createdAt: order.createdAt, numbers, fields, owner, data: { order, vehicle, customer } };
  });
}
