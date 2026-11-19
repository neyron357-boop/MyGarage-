import { db } from '../db/db';
import { dubaiDate } from '../domain/dates';
import { formatNumber } from '../domain/partNumbers';
import {
  guessJob,
  rankJobs,
  receiptExpense,
  supplierFromReceipt,
  type JobForGuess,
  type JobGuess,
  type ReceiptExpense,
  type ReceiptRead,
} from '../domain/receipt';
import { alreadyInBase, sellerKey } from '../domain/suppliers';
import type { Expense, OrderItem, Supplier } from '../domain/types';
import { askAi, notifyAi } from './ai';
import { removeEntry } from './entries';
import { updateItem } from './estimate';
import { addExpense } from './money';
import { saveSupplier, subcontractCategory } from './parts';
import { shrinkPhoto } from './photoSize';

/*
 * A supplier's receipt scanned (v0.50, the user: «нажал Расход — открылась камера — отсканировал — сохраняется фото,
 * берётся название деталей и сумма с VAT, создаётся расход и сам привязывается к заказу по названиям деталей»; v0.50.1:
 * «понимает поставщика и добавляет его»; v0.50.2: «точно брать даты, определить точно заказ»): the photo goes to the
 * garage's server, which has Gemini read it (server/src/ai.mjs `receipt`); the app turns the reading into an expense
 * (domain/receipt.ts — nothing invented, the date read day first, a year under a stamp put right), knows the seller as a
 * supplier of the garage's, finds the job the parts were bought for (`rankJobs`: what the parts are, their numbers,
 * the car on the paper, the job's days — the app alone, no AI) — records the expense in
 * «Запчасти» (a contractor's bill — «Подрядчики») with the photo as its receipt, and, the job sure, puts the purchase
 * price and the supplier on its matched lines. What it did is said once (AiNotices), with «Отменить»; the expense's
 * sheet opens for a look, the other likely jobs a tap away.
 */

/** Another job the receipt may be for: a tap in the expense's sheet puts it there. */
export interface JobOption {
  orderId: string;
  vehicleId: string;
  customerId: string;
  number: number;
  car: string;
}

export interface ReceiptScan {
  expense?: Expense;
  fields?: ReceiptExpense;
  read?: ReceiptRead;
  job?: JobGuess & { car: string };
  /** The other likely jobs (the likeliest first; at most three). */
  others: JobOption[];
  /** The seller as a supplier of the garage's: found in the base, or added off the paper (`added`). */
  supplier?: { id: string; name: string; added: boolean };
  /** Job lines that got their purchase price off the receipt. */
  costed: number;
  /**
   * Nothing recorded: the server did not read it (`ai`), the paper has no sum (`amount`), or it is not a parts shop's
   * or a contractor's paper (`kind`: fuel, food…) — the sheet opens with what was read, the category is the manager's.
   */
  failed?: 'ai' | 'amount' | 'kind';
}

/** The picture as the server takes it: a JPEG no longer than 1600 px (a receipt's figures stay legible; a few hundred KB). */
async function picture(file: File): Promise<{ type: string; data: string }> {
  const small = (await shrinkPhoto(file, 1600).catch(() => undefined)) ?? file;
  const bytes = new Uint8Array(await small.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type: small.type || 'image/jpeg', data: btoa(bin) };
}

const DAY = 86_400_000;

interface Jobs {
  list: JobForGuess[];
  /** Each job's car and customer (for a tap that puts the expense on another job). */
  links: Map<string, { vehicleId: string; customerId: string; car: string }>;
}

/**
 * The jobs the paper may be for: the ones in the garage, and the ones closed in the three days before the receipt's day
 * (parts on credit are often scanned after the car has gone) — with their part lines, their work done outside, their cars.
 */
async function jobsFor(day: string): Promise<Jobs> {
  const since = new Date(Date.parse(`${day}T00:00:00+04:00`) - 3 * DAY).toISOString();
  const [open, closed] = await Promise.all([
    db.orders.where('stage').noneOf(['closed', 'cancelled']).toArray(),
    db.orders
      .where('stage')
      .equals('closed')
      .filter((o) => (o.closedAt ?? o.updatedAt ?? o.createdAt) >= since)
      .toArray(),
  ]);
  const orders = [...open, ...closed];
  const links = new Map<string, { vehicleId: string; customerId: string; car: string }>();
  if (!orders.length) return { list: [], links };
  const [items, vehicles] = await Promise.all([db.items.where('orderId').anyOf(orders.map((o) => o.id)).toArray(), db.vehicles.bulkGet(orders.map((o) => o.vehicleId))]);
  const list = orders.map((o, k) => {
    const v = vehicles[k];
    links.set(o.id, { vehicleId: o.vehicleId, customerId: o.customerId, car: [v?.make, v?.model].filter(Boolean).join(' ') });
    return {
      id: o.id,
      number: o.number,
      changedAt: o.updatedAt ?? o.createdAt,
      openedOn: dubaiDate(o.createdAt),
      lines: items
        .filter((i) => i.orderId === o.id && (i.kind === 'part' || !!i.outsource) && i.approvalState !== 'declined')
        .map((i) => ({ id: i.id, name: i.titleEn || i.titleRu || '', partNumber: i.partNumber, costFils: i.costPriceFils, supplierId: i.supplierId })),
      car: { make: v?.make ?? '', model: v?.model ?? '', plateNumber: v?.plate.number ?? '', year: v?.year },
    };
  });
  return { list, links };
}

/** The seller already in the base: the same phone or name (v0.24), or the same name without its company words. */
async function knownSeller(fields: ReceiptExpense): Promise<Supplier | undefined> {
  if (!supplierFromReceipt(fields)) return undefined;
  const list = await db.suppliers.filter((s) => !s.archivedAt).toArray();
  const key = sellerKey(fields.vendor ?? '');
  return alreadyInBase(list, { name: fields.vendor, phone: fields.vendorPhone }) ?? (key.length >= 3 ? list.find((s) => sellerKey(s.name) === key) : undefined);
}

interface Seller {
  supplier: Supplier;
  added: boolean;
  /** What the paper filled on a supplier already in the base (as kept), for «Отменить». */
  filled: Partial<Pick<Supplier, 'phone' | 'address'>>;
}

/** The seller as the garage's supplier: the known one, its empty phone and address filled off the paper — else a new one. */
async function sellerOf(fields: ReceiptExpense, found: Supplier | undefined, make: string): Promise<Seller | undefined> {
  const wanted = supplierFromReceipt(fields, make);
  if (!wanted) return undefined;
  if (!found) return { supplier: await saveSupplier(wanted), added: true, filled: {} };
  const fill: Partial<Pick<Supplier, 'phone' | 'address'>> = {};
  if (!found.phone?.trim() && wanted.phone) fill.phone = wanted.phone;
  if (!found.address?.trim() && wanted.address) fill.address = wanted.address;
  if (!Object.keys(fill).length) return { supplier: found, added: false, filled: {} };
  const supplier = await saveSupplier({ id: found.id, name: found.name, ...fill });
  return { supplier, added: false, filled: { ...(fill.phone ? { phone: supplier.phone } : {}), ...(fill.address ? { address: supplier.address } : {}) } };
}

/** The receipt photographed: read, recorded as an expense, tied to its job and its supplier. */
export async function scanReceipt(file: File): Promise<ReceiptScan> {
  let read: ReceiptRead;
  try {
    read = await askAi<ReceiptRead>('receipt', { image: await picture(file) }, 'receipt', 90_000);
  } catch {
    return { costed: 0, failed: 'ai', others: [] };
  }
  const fields = receiptExpense(read);
  if (!fields.ok) return { costed: 0, failed: 'amount', read, fields, others: [] };
  // Fuel, food, anything but parts or a contractor's work: which category is the manager's call — the sheet, filled in.
  if (fields.kind !== 'parts' && fields.kind !== 'service') return { costed: 0, failed: 'kind', read, fields, others: [] };
  const [jobs, found] = await Promise.all([jobsFor(fields.date), knownSeller(fields)]);
  const ranked = rankJobs(fields.items, jobs.list, {
    carText: read.carText,
    paperText: [read.carText, ...fields.items.map((i) => i.name)].filter(Boolean).join(' '),
    date: fields.date,
    supplierId: found?.id,
  });
  // The job is the app's own guess (no AI is asked: «чтобы токены не тратились зря»); not sure — the likely ones a tap away.
  const guess = guessJob(ranked);
  const job = guess ? jobs.list.find((j) => j.id === guess.orderId) : undefined;
  const cats = await db.expenseCategories.filter((c) => c.active).toArray();
  const categoryId = fields.kind === 'service' ? await subcontractCategory() : (cats.find((c) => c.code === 'parts') ?? cats[0])?.id;
  if (!categoryId) return { costed: 0, failed: 'amount', read, fields, others: [] };
  const seller = await sellerOf(fields, found, job?.car.make ?? '');
  const expense = await addExpense({
    date: fields.date,
    categoryId,
    amountFils: fields.amountFils,
    vatFils: fields.vatFils,
    // The seller in the garage's own words when it is in the base.
    vendor: seller?.supplier.name ?? fields.vendor,
    supplierId: seller?.supplier.id,
    method: fields.method,
    note: fields.note,
    receipt: file,
    orderId: guess?.orderId,
    // The category's monthly limit is the manager's own warning: a receipt in hand is already spent.
    overLimitComment: 'receipt',
  });
  // The job sure: its matched lines get the purchase price and the seller's VAT off the paper (only where none was
  // typed), the supplier where the line has none, the part number when the line has none; an outsourced work — who
  // did it and that it is paid (its «Платим» is this expense). Not sure — the lines are left alone (the job may change).
  let costed = 0;
  const linked: string[] = [];
  const paid: { id: string; supplier: boolean }[] = [];
  if (guess && job && !guess.close) {
    for (const m of guess.matched) {
      const it = fields.items[m.item];
      const cur = await db.items.get(m.lineId);
      if (!it || !cur) continue;
      const patch: Partial<OrderItem> = {};
      if (!(cur.costPriceFils ?? 0) && it.unitNetFils !== undefined && it.unitNetFils > 0) {
        patch.costPriceFils = it.unitNetFils;
        if (fields.vatShareBp > 0 && it.lineNetFils !== undefined) patch.purchaseVatFils = Math.round((it.lineNetFils * fields.vatShareBp) / 10000);
      }
      if (cur.kind === 'part') {
        if (seller && !cur.supplierId) {
          patch.supplierId = seller.supplier.id;
          linked.push(cur.id);
        }
        if (!cur.partNumber && it.partNumber) patch.partNumber = formatNumber(job.car.make, it.partNumber);
      } else if (cur.outsource && !cur.outsource.expenseId) {
        const supplierId = cur.outsource.supplierId ?? seller?.supplier.id;
        patch.outsource = { ...cur.outsource, supplierId, expenseId: expense.id };
        paid.push({ id: cur.id, supplier: !cur.outsource.supplierId && !!supplierId });
      }
      if (Object.keys(patch).length) {
        await updateItem(m.lineId, patch).catch(() => undefined);
        if (patch.costPriceFils) costed++;
      }
    }
  }
  const car = guess ? (jobs.links.get(guess.orderId)?.car ?? '') : '';
  const others: JobOption[] = ranked
    .filter((r) => r.orderId !== guess?.orderId && r.score > 0)
    .slice(0, 3)
    .map((r) => {
      const l = jobs.links.get(r.orderId)!;
      return { orderId: r.orderId, vehicleId: l.vehicleId, customerId: l.customerId, number: r.number, car: l.car };
    });
  notifyAi({
    kind: 'expense',
    expenseId: expense.id,
    amountFils: expense.amountFils,
    vendor: expense.vendor,
    date: fields.date,
    dateSure: fields.dateSure,
    job: guess ? { number: guess.number, car } : undefined,
    supplier: seller ? { name: seller.supplier.name, added: seller.added } : undefined,
    items: fields.items.length,
    close: !!guess?.close,
    // «Отменить»: the expense goes (its cash movement and photo with it — services/entries.ts), a supplier added here goes
    // too (off the lines it was put on), what the paper filled on a known one is emptied again if untouched since; the
    // lines keep their prices.
    undo: async () => {
      // (An outsourced line's «paid» goes with the expense — removeEntry.)
      await removeEntry({ source: 'expense', id: expense.id });
      if (!seller) return;
      for (const p of paid) {
        const cur = await db.items.get(p.id);
        if (p.supplier && cur?.outsource?.supplierId === seller.supplier.id) await updateItem(p.id, { outsource: { ...cur.outsource, supplierId: undefined } }).catch(() => undefined);
      }
      if (seller.added) {
        for (const id of linked) {
          const cur = await db.items.get(id);
          if (cur?.supplierId === seller.supplier.id) await updateItem(id, { supplierId: undefined }).catch(() => undefined);
        }
        await db.suppliers.delete(seller.supplier.id);
      } else if (Object.keys(seller.filled).length) {
        const cur = await db.suppliers.get(seller.supplier.id);
        if (!cur) return;
        const back: Partial<Supplier> = {};
        if (seller.filled.phone && cur.phone === seller.filled.phone) back.phone = undefined;
        if (seller.filled.address && cur.address === seller.filled.address) back.address = undefined;
        if (Object.keys(back).length) await db.suppliers.update(cur.id, back);
      }
    },
  });
  return {
    expense,
    fields,
    read,
    job: guess ? { ...guess, car } : undefined,
    others,
    supplier: seller ? { id: seller.supplier.id, name: seller.supplier.name, added: seller.added } : undefined,
    costed,
  };
}
