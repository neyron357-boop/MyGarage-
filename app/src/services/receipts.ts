import { db } from '../db/db';
import { formatNumber } from '../domain/partNumbers';
import { guessJob, receiptExpense, supplierFromReceipt, type JobForGuess, type JobGuess, type ReceiptExpense, type ReceiptRead } from '../domain/receipt';
import { alreadyInBase } from '../domain/suppliers';
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
 * «понимает поставщика и добавляет его»): the photo goes to the garage's server, which has Gemini read it
 * (server/src/ai.mjs `receipt`); the app turns the reading into an expense (domain/receipt.ts — nothing invented),
 * finds the job whose lines the receipt names (`guessJob`), knows the seller as a supplier of the garage's (the one in
 * the base by phone or name, else a new one off the paper), records the expense in «Запчасти» (a contractor's bill — in
 * «Подрядчики») with the photo as its receipt, and puts the purchase price and the supplier on the job's matched lines.
 * What it did is said once (AiNotices), with «Отменить»; the expense's sheet opens for a look.
 */

export interface ReceiptScan {
  expense?: Expense;
  fields?: ReceiptExpense;
  read?: ReceiptRead;
  job?: JobGuess & { car: string };
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

/** The jobs still in the garage, with their part and outsourced-work lines and their cars — what the paper may be for. */
async function openJobs(): Promise<JobForGuess[]> {
  const orders = await db.orders.where('stage').noneOf(['closed', 'cancelled']).toArray();
  if (!orders.length) return [];
  const [items, vehicles] = await Promise.all([db.items.where('orderId').anyOf(orders.map((o) => o.id)).toArray(), db.vehicles.bulkGet(orders.map((o) => o.vehicleId))]);
  return orders.map((o, k) => ({
    id: o.id,
    number: o.number,
    changedAt: o.updatedAt ?? o.createdAt,
    lines: items.filter((i) => i.orderId === o.id && (i.kind === 'part' || !!i.outsource) && i.approvalState !== 'declined').map((i) => ({ id: i.id, name: i.titleEn || i.titleRu || '', costFils: i.costPriceFils })),
    car: { make: vehicles[k]?.make ?? '', model: vehicles[k]?.model ?? '', plateNumber: vehicles[k]?.plate.number ?? '' },
  }));
}

interface Seller {
  supplier: Supplier;
  added: boolean;
  /** What the paper filled on a supplier already in the base (as kept), for «Отменить». */
  filled: Partial<Pick<Supplier, 'phone' | 'address'>>;
}

/**
 * The seller as the garage's supplier: the one already in the base — by its phone or its name (v0.24 `alreadyInBase`),
 * its empty phone and address filled off the paper — else a new one with what the paper says.
 */
async function sellerOf(fields: ReceiptExpense, make: string): Promise<Seller | undefined> {
  const wanted = supplierFromReceipt(fields, make);
  if (!wanted) return undefined;
  const list = await db.suppliers.filter((s) => !s.archivedAt).toArray();
  const found = alreadyInBase(list, { name: wanted.name, phone: wanted.phone });
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
    return { costed: 0, failed: 'ai' };
  }
  const fields = receiptExpense(read);
  if (!fields.ok) return { costed: 0, failed: 'amount', read, fields };
  // Fuel, food, anything but parts or a contractor's work: which category is the manager's call — the sheet, filled in.
  if (fields.kind !== 'parts' && fields.kind !== 'service') return { costed: 0, failed: 'kind', read, fields };
  const jobs = await openJobs();
  const guess = guessJob(fields.items, [read.carText, read.vendor, ...fields.items.map((i) => i.name)].filter(Boolean).join(' '), jobs);
  const job = guess ? jobs.find((j) => j.id === guess.orderId) : undefined;
  const cats = await db.expenseCategories.filter((c) => c.active).toArray();
  const categoryId = fields.kind === 'service' ? await subcontractCategory() : (cats.find((c) => c.code === 'parts') ?? cats[0])?.id;
  if (!categoryId) return { costed: 0, failed: 'amount', read, fields };
  const seller = await sellerOf(fields, job?.car.make ?? '');
  const expense = await addExpense({
    date: fields.date,
    categoryId,
    amountFils: fields.amountFils,
    vatFils: fields.vatFils,
    // The seller in the garage's own words when it is in the base.
    vendor: seller?.supplier.name ?? fields.vendor,
    method: fields.method,
    note: fields.note,
    receipt: file,
    orderId: guess?.orderId,
    // The category's monthly limit is the manager's own warning: a receipt in hand is already spent.
    overLimitComment: 'receipt',
  });
  // The job's matched lines: the purchase price and the seller's VAT off the paper (only where none was typed), the
  // supplier where the line has none, the part number when the line has none; an outsourced work — who did it and that
  // it is paid (its «Платим» is this expense).
  let costed = 0;
  const linked: string[] = [];
  const paid: { id: string; supplier: boolean }[] = [];
  if (guess && job) {
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
  const car = job ? [job.car.make, job.car.model].filter(Boolean).join(' ') : '';
  notifyAi({
    kind: 'expense',
    expenseId: expense.id,
    amountFils: expense.amountFils,
    vendor: expense.vendor,
    job: job && guess ? { number: guess.number, car } : undefined,
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
    job: guess && job ? { ...guess, car } : undefined,
    supplier: seller ? { id: seller.supplier.id, name: seller.supplier.name, added: seller.added } : undefined,
    costed,
  };
}
