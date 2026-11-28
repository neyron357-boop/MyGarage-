import { db } from '../db/db';
import { paperOf } from '../domain/paperLines';
import { dubaiDate } from '../domain/dates';
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
import type { Expense, Supplier } from '../domain/types';
import { mergePapers, readPaper, type KnownSeller, type PaperRead } from '../domain/receiptText';
import { aiOn, askAi, notifyAi } from './ai';
import { getSettings } from './settings';
import { removeEntry } from './entries';
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
 * the car on the paper, the job's days — the app alone, no AI) — records the expense in «Запчасти» (a contractor's bill —
 * «Подрядчики») with the photo as its receipt. What it did is said once (AiNotices), with «Отменить»; the expense's sheet
 * opens for a look, the likely jobs a tap away. v0.81 (the user's brief: «отключить автоматическую привязку расхода к
 * заказу по распознанным позициям… пользователь выбирает нужный заказ вручную… отправка руководителю только после
 * ручной привязки»): no job is put on it and no job's lines change by themselves; the boss hears of it only by
 * «Отправить руководителю» in its sheet, once a job is picked.
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
   * or a contractor's paper (`kind`: fuel, food…) — the sheet opens with what was read, the category is the manager's;
   * read on the phone but not proven, and no AI to read it (`unsure`) — the sheet, filled in, to be looked at.
   */
  failed?: 'ai' | 'amount' | 'kind' | 'unsure';
}

/** The picture as the server takes it: a JPEG no longer than 1600 px (a receipt's figures stay legible; a few hundred KB); a PDF as it is (v1.05). */
export async function picture(file: Blob, side = 1600): Promise<{ type: string; data: string }> {
  const small = (await shrinkPhoto(file, side).catch(() => undefined)) ?? file;
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
 * The jobs the paper may be for — with their part lines, their work done outside, their cars: the ones in the garage
 * (on the board or taken off it), and (v0.73, the user: «независимо в каком статусе находится заказ… даже если в архиве»)
 * the closed and cancelled ones opened in the year before the receipt's day, however long ago they left — not only the
 * three days before it, as until now. Which one it is, is the ranking's (domain/receipt.ts: a job in work first among
 * equals; one gone long before is put on only when it alone fits).
 */
async function jobsFor(day: string): Promise<Jobs> {
  const since = new Date(Date.parse(`${day}T00:00:00+04:00`) - 365 * DAY).toISOString();
  const [open, gone] = await Promise.all([
    db.orders.where('stage').noneOf(['closed', 'cancelled']).toArray(),
    db.orders
      .where('createdAt')
      .aboveOrEqual(since)
      .filter((o) => o.stage === 'closed' || o.stage === 'cancelled')
      .toArray(),
  ]);
  const orders = [...open, ...gone];
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
      goneOn: o.stage === 'closed' || o.stage === 'cancelled' ? dubaiDate(o.closedAt ?? o.stageChangedAt ?? o.updatedAt ?? o.createdAt) : undefined,
      lines: items
        .filter((i) => i.orderId === o.id && (i.kind === 'part' || !!i.outsource) && i.approvalState !== 'declined')
        .map((i) => ({ id: i.id, name: i.titleEn || i.titleRu || '', partNumber: i.partNumber, costFils: i.costPriceFils, supplierId: i.supplierId })),
      car: { make: v?.make ?? '', model: v?.model ?? '', plateNumber: v?.plate.number ?? '', year: v?.year },
    };
  });
  return { list, links };
}

/**
 * The jobs an expense already written may be for (v0.99, audit Ф26: «Запчасти» with no job, from the report): its paper's
 * lines ranked as a receipt's are (`rankJobs`), the likeliest three. Nothing is put on any job here.
 */
export async function likelyJobsFor(e: Expense): Promise<JobOption[]> {
  const lines = paperOf(e).lines;
  if (!lines.length) return [];
  const jobs = await jobsFor(e.date);
  const ranked = rankJobs(lines.map((l) => ({ name: l.name })), jobs.list, { date: e.date, supplierId: e.supplierId, paperText: lines.map((l) => l.name).join(' ') });
  return ranked
    .filter((r) => r.score > 0)
    .slice(0, 3)
    .map((r) => {
      const l = jobs.links.get(r.orderId)!;
      return { orderId: r.orderId, vehicleId: l.vehicleId, customerId: l.customerId, number: r.number, car: l.car };
    });
}

/** The seller already in the base: its TRN or e-mail, the same phone or name (v0.24), or the same name without its company words. */
export async function knownSeller(fields: Pick<ReceiptExpense, 'vendor' | 'vendorPhone' | 'vendorTrn' | 'vendorEmail' | 'kind'>): Promise<Supplier | undefined> {
  if ((fields.kind !== 'parts' && fields.kind !== 'service') || (fields.vendor ?? '').replace(/[^\p{L}\p{N}]/gu, '').length < 3) return undefined;
  const list = await db.suppliers.filter((s) => !s.archivedAt).toArray();
  const key = sellerKey(fields.vendor ?? '');
  const byPaper = list.find((s) => {
    const k = knownOf(s);
    return (!!fields.vendorTrn && k.trn === fields.vendorTrn) || (!!fields.vendorEmail && k.email === fields.vendorEmail);
  });
  return byPaper ?? alreadyInBase(list, { name: fields.vendor, phone: fields.vendorPhone }) ?? (key.length >= 3 ? list.find((s) => sellerKey(s.name) === key) : undefined);
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

/** A supplier as its papers tell it: the TRN and the e-mail kept in its notes (put there by its first paper), its phone, its name. */
export function knownOf(s: Supplier): KnownSeller {
  const notes = s.notes ?? '';
  return {
    id: s.id,
    name: s.name,
    trn: notes.replace(/(\d)\s(?=\d)/g, '$1').match(/\b(1\d{14})\b/)?.[1],
    email: notes.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0]?.toLowerCase(),
    phones: s.phone ? [s.phone] : [],
  };
}

/** A look into the reading of a paper (tests, a paper that will not read). */
export const receiptTrace: { on?: (step: string, data: unknown) => void } = {};

/**
 * The paper read on the phone (v0.51, the user: «распознавание без ИИ, токены не тратить зря; обучи на реальных
 * инвойсах»): the OCR's words (services/vinReader.ts , the same engine as the VIN's) read twice — in grey,
 * then inked black on white at a higher size (faint dot-matrix print) — and the two readings made one
 * (domain/receiptText.ts : the sum proven by the paper, the date read alike twice). The garage's own name
 * and TRN are the buyer's; its suppliers are known by their TRN, e-mail, phone, name.
 */
export async function readOnPhone(file: File): Promise<PaperRead | undefined> {
  try {
    const { readDocument } = await import('./vinReader');
    const [settings, suppliers] = await Promise.all([getSettings(), db.suppliers.filter((x) => !x.archivedAt).toArray()]);
    const ctx = { garageName: settings.name, garageTrn: settings.trn, known: suppliers.map(knownOf) };
    const first = await readDocument(file, { prep: 'grey', max: 2000 });
    if (!first.words.length) return undefined;
    const a = readPaper(first.words, first.height, ctx, first.skew);
    receiptTrace.on?.('paper', { prep: 'grey', sure: a.sure, why: a.why });
    const second = await readDocument(file, { prep: 'ink', max: 2600, angle: first.angle });
    const b = second.words.length ? readPaper(second.words, second.height, ctx, second.skew) : undefined;
    if (b) receiptTrace.on?.('paper', { prep: 'ink', sure: b.sure, why: b.why });
    return mergePapers(a, b);
  } catch (e) {
    receiptTrace.on?.('paper-failed', String(e));
    return undefined;
  }
}

/**
 * How the paper is read: on the phone first — the sum proven and a date, no AI is asked; not, the garage's AI reads
 * it (one question; its supplier's TRN and e-mail are kept, so the next paper of it reads on the phone); no AI — what
 * the phone read, to be looked at in the sheet.
 */
async function readReceipt(file: File): Promise<{ read?: ReceiptRead; by: 'phone' | 'ai'; sure: boolean }> {
  const phone = await readOnPhone(file);
  if (phone?.sure) return { read: phone.read, by: 'phone', sure: true };
  if (aiOn()) {
    try {
      return { read: await askAi<ReceiptRead>('receipt', { image: await picture(file) }, 'receipt', 90_000), by: 'ai', sure: true };
    } catch {
      // No server, no key: what the phone read stands — looked at in the sheet.
    }
  }
  return { read: phone?.read, by: 'phone', sure: false };
}

/** The receipt photographed: read, recorded as an expense, tied to its job and its supplier. */
export async function scanReceipt(file: File): Promise<ReceiptScan> {
  const { read, by, sure } = await readReceipt(file);
  if (!read) return { costed: 0, failed: 'ai', others: [] };
  receiptTrace.on?.('read', { by, sure });
  const fields = receiptExpense(read);
  if (!fields.ok) return { costed: 0, failed: 'amount', read, fields, others: [] };
  // Read on the phone but not proven (and no AI to read it): not recorded — the sheet opens with it, to be looked at.
  if (!sure) return { costed: 0, failed: 'unsure', read, fields, others: [] };
  // Fuel, food, anything but parts or a contractor's work: which category is the manager's call — the sheet, filled in.
  if (fields.kind !== 'parts' && fields.kind !== 'service') return { costed: 0, failed: 'kind', read, fields, others: [] };
  const [jobs, found] = await Promise.all([jobsFor(fields.date), knownSeller(fields)]);
  const ranked = rankJobs(fields.items, jobs.list, {
    carText: read.carText,
    paperText: [read.carText, ...fields.items.map((i) => i.name)].filter(Boolean).join(' '),
    date: fields.date,
    supplierId: found?.id,
  });
  // The likely jobs are only offered (v0.81, the user's brief: «отключить автоматическую привязку расхода к заказу по
  // распознанным позициям… поле заказа пустое, пользователь выбирает нужный заказ вручную»): a tap each in the sheet, the
  // likeliest first — one paper's parts may fit several jobs. Nothing of any job changes by itself.
  const guess = guessJob(ranked);
  const job = guess ? jobs.list.find((j) => j.id === guess.orderId) : undefined;
  const cats = await db.expenseCategories.filter((c) => c.active).toArray();
  const categoryId = fields.kind === 'service' ? await subcontractCategory() : (cats.find((c) => c.code === 'parts') ?? cats[0])?.id;
  if (!categoryId) return { costed: 0, failed: 'amount', read, fields, others: [] };
  // (The likeliest job's make only says what the seller sells — a supplier added off the paper.)
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
    // What the paper lists — a list of its own in the sheet, not one line of the note (v0.77).
    lines: fields.items.map((i) => ({ name: i.name, qty: i.qty })),
    receipt: file,
    // No job (v0.81): the manager picks it in the sheet — and only then may it go to the boss, by hand.
    scanned: true,
    // The category's monthly limit is the manager's own warning: a receipt in hand is already spent.
    overLimitComment: 'receipt',
  });
  // The likely jobs, the likeliest first (at most three): a tap each in the expense's sheet.
  const others: JobOption[] = ranked
    .filter((r) => r.score > 0)
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
    supplier: seller ? { name: seller.supplier.name, added: seller.added } : undefined,
    items: fields.items.length,
    close: false,
    // «Отменить»: the expense goes (its cash movement and photo with it — services/entries.ts), a supplier added here goes
    // too, what the paper filled on a known one is emptied again if untouched since.
    undo: async () => {
      await removeEntry({ source: 'expense', id: expense.id });
      if (!seller) return;
      if (seller.added) await db.suppliers.delete(seller.supplier.id);
      else if (Object.keys(seller.filled).length) {
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
    others,
    supplier: seller ? { id: seller.supplier.id, name: seller.supplier.name, added: seller.added } : undefined,
    costed: 0,
  };
}
