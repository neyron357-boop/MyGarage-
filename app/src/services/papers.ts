import { db, uid } from '../db/db';
import { dubaiDate, nowIso } from '../domain/dates';
import { expenseOf, paperDoubts, paperFields, paperStats, partOfLine, twinOf, type PaperFields, type PaperStats } from '../domain/papers';
import type { ReceiptRead } from '../domain/receipt';
import { sellerKey } from '../domain/suppliers';
import type { PricePoint, Supplier, SupplierPaper } from '../domain/types';
import { aiOn, askAi } from './ai';
import { claimOnce } from './claim';
import { removeEntry } from './entries';
import { addMedia, compressImage, deleteMedia, mediaBlob, sha256Hex } from './media';
import { addExpense } from './money';
import { saveSupplier, subcontractCategory } from './parts';
import { knownSeller, picture, readOnPhone } from './receipts';
import { oneAtATime } from './serial';
import { installId, syncConfig } from './sync/config';

/*
 * The multi-scanner (v1.05, the owner: «сотни, 200 инвойсов от разных поставщиков… мультисканер в приложении, который
 * прошёлся по всем инвойсам… ИИ должен анализировать… узнать поставщика и присваивать им работы… рейтинг… кто что часто
 * продаёт… сохранял все цены… даже если поставщик не существует — создать поставщика, брать данные из бумажного инвойса»).
 *
 * Papers go in by the handful (`addPapers`: the phone's photos, the app's camera one after another, PDFs): each is kept at
 * once — its photo and a record «waiting» — so nothing is lost if the phone closes the app; the reading goes on by itself,
 * on the device that took them (and on any other open device once that one has gone quiet — the garage's server says who
 * reads which: `claimOnce`). Each paper: read by the garage's AI (the receipt reader, server/src/ai.mjs — every line, its
 * part, its car; no AI — on the phone, as the «Расход» scanner reads), its seller found in the base (TRN, e-mail, phone,
 * name) or added off the paper, the same paper scanned twice told (`twinOf`), the expense it already is told
 * (`expenseOf`). What it teaches: the supplier's history and rating (its lines are bought lines — services/supplierRank.ts
 * `boughtLines`), who sells what for which car, and each line's price into the price book (`via: 'paper'` — the «+ Цена»
 * of a new job's line offers it: «этот поставщик продавал тебе это»). It writes no money: the days of those papers are not
 * the app's money book; one may be put there by hand («Записать расходом»).
 */

const READ_SIDE = 2048;
/** A device that began reading a paper and said nothing for this long has gone: another takes it over. */
const STALE_MS = 4 * 60_000;
/** Papers read at once on a device (the AI's reading takes seconds; what is learnt is written one by one). */
const AT_ONCE = 3;

/* ---------- Taking them in ---------- */

export interface Added {
  added: number;
  /** The same photo was taken in before. */
  twins: number;
}

/** Papers taken in: their photos kept, each a record «waiting»; the reading starts by itself. */
export async function addPapers(files: File[]): Promise<Added> {
  let added = 0;
  let twins = 0;
  const device = installId();
  for (const file of files) {
    const hash = await sha256Hex(file);
    if (await db.papers.where('hash').equals(hash).first()) {
      twins++;
      continue;
    }
    const pdf = file.type === 'application/pdf';
    // Kept a little smaller than taken (the small print stays legible), its preview with it.
    let small: { blob: Blob; thumb?: Blob } = { blob: file };
    if (!pdf && typeof document !== 'undefined') small = await compressImage(file, 2400, 0.85).catch(() => ({ blob: file as Blob }));
    const id = uid();
    const media = await addMedia({ ownerType: 'paper', ownerId: id, slot: 'receipt', file: small.blob, thumb: small.thumb, compress: false, name: file.name || undefined });
    const now = nowIso();
    await db.papers.add({ id, hash, mediaId: media.id, state: 'waiting', device, createdAt: now, updatedAt: now });
    added++;
  }
  if (added) kick();
  return { added, twins };
}

/* ---------- Reading ---------- */

let running: Promise<number> | undefined;
let again = false;
const listeners = new Set<() => void>();
/** The reading moved on (a paper read): screens follow (they also read the table). */
export function onPapersMoved(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const moved = () => listeners.forEach((fn) => fn());

/** Is a paper this device's to read now: its own, or one whose reader has gone quiet. */
function mine(p: SupplierPaper, me: string, now = Date.now()): boolean {
  if (p.state === 'waiting') return !p.device || p.device === me || now - Date.parse(p.updatedAt) > STALE_MS;
  return p.state === 'reading' && now - Date.parse(p.readingAt ?? p.updatedAt) > STALE_MS;
}

/** Reads the papers waiting (as many as there are), a few at once; again when more came meanwhile. */
export function readPapers(): Promise<number> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let n = 0;
    for (;;) {
      again = false;
      const me = installId();
      const list = (await db.papers.where('state').anyOf(['waiting', 'reading']).toArray()).filter((p) => mine(p, me)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (!list.length) break;
      let at = 0;
      const lane = async () => {
        while (at < list.length) {
          const p = list[at++];
          if (await readPaper(p.id)) n++;
          moved();
        }
      };
      await Promise.all(Array.from({ length: Math.min(AT_ONCE, list.length) }, lane));
      if (!again) break;
    }
    return n;
  })().finally(() => (running = undefined));
  return running;
}

let soon: ReturnType<typeof setTimeout> | undefined;
function kick(ms = 300) {
  clearTimeout(soon);
  soon = setTimeout(() => void readPapers().catch(() => undefined), ms);
}

let started = false;
/** At the app's start: what waits is read; again when the app comes back and every few minutes (another device's left over). */
export function startPaperReader() {
  if (started || typeof window === 'undefined') return;
  started = true;
  kick(8000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && kick(1500));
  setInterval(() => document.visibilityState === 'visible' && kick(0), 5 * 60_000);
}

/**
 * One paper read and learnt from. True — read (done, to look at, or a twin). A paper another device reads, or whose photo
 * is not here yet (taken on a phone, not on the server yet) — left as it was.
 */
export async function readPaper(id: string): Promise<boolean> {
  const p = await db.papers.get(id);
  if (!p || (p.state !== 'waiting' && p.state !== 'reading')) return false;
  const tries = (p.tries ?? 0) + 1;
  // Taken over from a device gone quiet, or more than one device open: the garage's server says who reads it.
  const alone = p.device === installId();
  if (!alone && !(await claimOnce(`paper:${p.id}:${tries}`))) return false;
  await db.papers.update(id, { state: 'reading', tries, readingAt: nowIso(), updatedAt: nowIso() });
  const blob = await mediaBlob(p.mediaId).catch(() => undefined);
  if (!blob) {
    // The photo is on the phone that took it, not on the server yet: that phone reads it (or this one, later).
    await db.papers.update(id, { state: p.device === installId() ? 'failed' : 'waiting', why: p.device === installId() ? 'noFile' : undefined, updatedAt: nowIso() });
    return false;
  }
  const got = await readFile(blob, p.id);
  if (!got.read) {
    await db.papers.update(id, { state: 'failed', why: got.why, updatedAt: nowIso() });
    return true;
  }
  const fields = paperFields(got.read);
  if (fields.notPaper || fields.kind === 'other' || (!fields.ok && !fields.lines.length)) {
    await db.papers.update(id, { state: 'failed', why: fields.notPaper || fields.kind === 'other' ? 'notPaper' : 'unread', by: got.by, vendor: fields.vendor, updatedAt: nowIso() });
    return true;
  }
  // What is learnt is written one by one: two papers of a seller new to the base do not add it twice.
  return oneAtATime('papers', () => learn(id, fields, got.by, tries));
}

/** The paper's words: the garage's AI first (every line); without it — the phone's reading, when it proves its sum. */
async function readFile(blob: Blob, id: string): Promise<{ read?: ReceiptRead; by?: 'ai' | 'phone'; why?: SupplierPaper['why'] }> {
  if (aiOn()) {
    try {
      const read = await askAi<ReceiptRead>('receipt', { image: await picture(blob, READ_SIDE) }, `paper:${id}`, 120_000);
      return { read, by: 'ai' };
    } catch {
      // the server, its key or the network: the phone tries
    }
  }
  if (blob.type === 'application/pdf') return { why: aiOn() ? 'unread' : 'noAi' };
  const phone = await readOnPhone(new File([blob], 'paper.jpg', { type: blob.type || 'image/jpeg' }));
  if (phone?.sure) return { read: phone.read, by: 'phone' };
  return { why: aiOn() ? 'unread' : 'noAi' };
}

/** The seller of the base it is (its TRN, e-mail, phone, name) — else added off the paper; its empty contacts filled. */
async function sellerFor(f: PaperFields, tries: number): Promise<{ supplier?: Supplier; added?: true; wait?: true }> {
  const ask = { vendor: f.vendor, vendorPhone: f.vendorPhone, vendorTrn: f.vendorTrn, vendorEmail: f.vendorEmail, kind: f.kind === 'service' ? ('service' as const) : ('parts' as const) };
  const found = await knownSeller(ask);
  const said = [f.vendorTrn ? `TRN ${f.vendorTrn}` : '', f.vendorEmail ?? ''].filter(Boolean);
  if (found) {
    const fill: Partial<Supplier> = {};
    // Added off a paper (its name as that paper printed it, not changed since): the fuller name another paper prints
    // («AL-NOOR SPARE PARTS» → «Al Noor Auto Spare Parts LLC») — whichever paper was read first.
    const first = await db.papers.filter((x) => x.supplierId === found.id && !!x.added).first();
    const words = (s?: string) => (s ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).length;
    if (first?.vendor && found.name === first.vendor && f.vendor && words(f.vendor) > words(found.name)) fill.name = f.vendor.trim();
    if (!found.phone?.trim() && f.vendorPhone) fill.phone = f.vendorPhone;
    if (!found.address?.trim() && f.vendorAddress) fill.address = f.vendorAddress;
    // Its TRN and e-mail in its notes: the next paper of it is known by them (and read on the phone — services/receipts.ts).
    const notes = found.notes ?? '';
    const more = said.filter((x) => !notes.replace(/\s/g, '').includes(x.replace(/^TRN /, '').replace(/\s/g, '')));
    if (more.length) fill.notes = [notes.trim(), ...more].filter(Boolean).join(' · ');
    if (Object.keys(fill).length) return { supplier: await saveSupplier({ id: found.id, name: found.name, ...fill }) };
    return { supplier: found };
  }
  const name = f.vendor?.trim() ?? '';
  if (name.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return {};
  // A seller new to the base: one device adds it (another reading a paper of it at the same time waits for it to come).
  if (syncConfig() && tries < 3 && !(await claimOnce(`paper-supplier:${sellerKey(name)}`))) return { wait: true };
  const sold = [...new Set(f.lines.map((l) => partOfLine(l)).filter(Boolean))].slice(0, 4).join(', ').slice(0, 80);
  const supplier = await saveSupplier({
    name,
    phone: f.vendorPhone,
    address: f.vendorAddress,
    service: f.kind === 'service' || undefined,
    parts: sold || undefined,
    notes: said.join(' · ') || undefined,
  });
  return { supplier, added: true };
}

/** The paper written as read: its seller, a twin or not, the expense it is, what needs a look; its prices into the book. */
async function learn(id: string, f: PaperFields, by: 'ai' | 'phone' | undefined, tries: number): Promise<boolean> {
  const seller = await sellerFor(f, tries);
  if (seller.wait) {
    await db.papers.update(id, { state: 'waiting', updatedAt: nowIso() });
    kick(20_000);
    return false;
  }
  const others = await db.papers.where('state').anyOf(['done', 'look']).toArray();
  const draft = {
    supplierId: seller.supplier?.id,
    vendor: f.vendor,
    invoiceNo: f.invoiceNo,
    date: f.date,
    totalFils: f.totalFils || undefined,
  };
  const twin = twinOf(draft, others);
  const expenses = f.date ? await db.expenses.where('date').between(shift(f.date, -40), shift(f.date, 40), true, true).toArray() : [];
  const expenseId = expenseOf(draft, expenses.filter((e) => !e.voidedAt));
  const base: Partial<SupplierPaper> = {
    by,
    ...draft,
    ...(seller.added ? { added: true as const } : {}),
    dateSure: f.dateSure,
    vatFils: f.vatFils || undefined,
    method: f.method,
    kind: f.kind === 'service' ? 'service' : 'parts',
    car: f.car,
    make: f.make,
    model: f.model,
    lines: f.lines,
    adds: f.adds,
    expenseId,
    why: undefined,
    updatedAt: nowIso(),
  };
  if (twin) {
    // The same paper twice: the one read with more lines is kept (the other photo may have been cut or blurred).
    if (f.lines.length <= (twin.lines?.length ?? 0)) {
      await db.papers.update(id, { ...base, state: 'twin', twinOf: twin.id });
      return true;
    }
    // the supplier it added goes with the one kept
    if (twin.added) base.added = true;
    await db.papers.update(twin.id, { state: 'twin', twinOf: id, added: undefined, updatedAt: nowIso() });
    await notePaperPrices(twin.id);
    const older = await db.papers.filter((x) => x.twinOf === twin.id).toArray();
    for (const o of older) await db.papers.update(o.id, { twinOf: id });
  }
  const doubts = paperDoubts({ supplierId: base.supplierId, date: base.date, dateSure: base.dateSure, lines: base.lines, adds: base.adds });
  await db.papers.update(id, { ...base, state: doubts.length ? 'look' : 'done', twinOf: undefined });
  await notePaperPrices(id);
  return true;
}
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A paper's lines into the price book (each a record of its own, `paper:<id>:<n>`); what it had there before goes. */
export async function notePaperPrices(id: string): Promise<number> {
  const p = await db.papers.get(id);
  const old = await db.priceBook.where('id').startsWith(`paper:${id}:`).primaryKeys();
  const now = nowIso();
  const at = p?.date ? `${p.date}T08:00:00.000Z` : p?.createdAt ?? now;
  const points: PricePoint[] =
    p && p.supplierId && (p.state === 'done' || p.state === 'look')
      ? (p.lines ?? []).flatMap((l, k): PricePoint[] => {
          const part = partOfLine(l);
          if (!part || l.unitFils === undefined || l.unitFils <= 0) return [];
          return [
            {
              id: `paper:${id}:${k}`,
              part,
              ...(l.make ? { make: l.make } : {}),
              ...(l.model ? { model: l.model } : {}),
              supplierId: p.supplierId,
              costFils: l.unitFils,
              kind: l.kind,
              ...(l.brand ? { brand: l.brand } : {}),
              ...(l.unsure ? { unsure: true as const } : {}),
              ...(p.by === 'ai' ? { ai: true as const } : {}),
              via: 'paper',
              at,
              orderId: '',
              itemId: '',
              paper: id,
              ...(p.invoiceNo ? { invoiceNo: p.invoiceNo } : {}),
              ...(l.partNumber ? { partNumber: l.partNumber } : {}),
              qty: l.qty,
              updatedAt: now,
            },
          ];
        })
      : [];
  await db.transaction('rw', db.priceBook, async () => {
    const keep = new Set(points.map((x) => x.id));
    const gone = old.filter((k) => !keep.has(k));
    if (gone.length) await db.priceBook.bulkDelete(gone);
    if (points.length) await db.priceBook.bulkPut(points);
  });
  return points.length;
}

/* ---------- What the manager does with one ---------- */

/** Read again (the AI asked again, its seller found again). */
export async function rereadPaper(id: string): Promise<void> {
  await db.papers.update(id, { state: 'waiting', device: installId(), tries: 0, readingAt: undefined, twinOf: undefined, why: undefined, updatedAt: nowIso() });
  kick(0);
}

/** Every paper that could not be read, read again. */
export async function rereadFailed(): Promise<number> {
  const list = await db.papers.where('state').equals('failed').toArray();
  for (const p of list) await db.papers.update(p.id, { state: 'waiting', device: installId(), tries: 0, why: undefined, updatedAt: nowIso() });
  if (list.length) kick(0);
  return list.length;
}

/** The seller put right by hand: its prices go with it. */
export async function setPaperSupplier(id: string, supplierId: string): Promise<void> {
  const p = await db.papers.get(id);
  if (!p) return;
  const doubts = paperDoubts({ ...p, supplierId });
  await db.papers.update(id, { supplierId, state: p.state === 'twin' || p.state === 'failed' ? p.state : doubts.length ? 'look' : 'done', updatedAt: nowIso() });
  await notePaperPrices(id);
}

/** The day put right by hand (sure now). */
export async function setPaperDate(id: string, date: string): Promise<void> {
  const p = await db.papers.get(id);
  if (!p || date > dubaiDate()) return;
  const doubts = paperDoubts({ ...p, date, dateSure: true });
  await db.papers.update(id, { date, dateSure: true, state: p.state === 'look' || p.state === 'done' ? (doubts.length ? 'look' : 'done') : p.state, updatedAt: nowIso() });
  await notePaperPrices(id);
}

/** Looked at and fine as it is: no more «Проверить». */
export async function settlePaper(id: string): Promise<void> {
  const p = await db.papers.get(id);
  if (p?.state === 'look') await db.papers.update(id, { state: 'done', ...(p.date ? { dateSure: true } : {}), updatedAt: nowIso() });
}

/** Not a twin after all: counted as a paper of its own. */
export async function notTwin(id: string): Promise<void> {
  const p = await db.papers.get(id);
  if (p?.state !== 'twin') return;
  await db.papers.update(id, { state: paperDoubts(p).length ? 'look' : 'done', twinOf: undefined, updatedAt: nowIso() });
  await notePaperPrices(id);
}

/** A paper taken away (its photo and its prices with it); «Отменить» brings it back as it was. */
export async function removePaper(id: string): Promise<() => Promise<void>> {
  const p = await db.papers.get(id);
  if (!p) return async () => undefined;
  const points = await db.priceBook.where('id').startsWith(`paper:${id}:`).toArray();
  await db.transaction('rw', db.papers, db.priceBook, async () => {
    await db.papers.delete(id);
    await db.priceBook.bulkDelete(points.map((x) => x.id));
  });
  // Its photo goes once «Отменить» is past (a moment longer than the banner stays).
  let back = false;
  setTimeout(() => {
    if (!back) void deleteMedia(p.mediaId).catch(() => undefined);
  }, 12_000);
  return async () => {
    back = true;
    await db.transaction('rw', db.papers, db.priceBook, async () => {
      await db.papers.put(p);
      if (points.length) await db.priceBook.bulkPut(points);
    });
  };
}

/**
 * The paper put in the money book by hand (one of these days the app was already there and it was never recorded):
 * an expense of «Запчасти» (a contractor's — «Подрядчики»), its photo the receipt. «Отменить» takes it away again.
 */
export async function paperToExpense(id: string): Promise<{ expenseId: string; undo: () => Promise<void> } | undefined> {
  const p = await db.papers.get(id);
  if (!p || p.expenseId || !p.date || !p.totalFils) return undefined;
  const cats = await db.expenseCategories.filter((c) => c.active).toArray();
  const categoryId = p.kind === 'service' ? await subcontractCategory() : (cats.find((c) => c.code === 'parts') ?? cats[0])?.id;
  if (!categoryId) return undefined;
  const blob = await mediaBlob(p.mediaId);
  const sup = p.supplierId ? await db.suppliers.get(p.supplierId) : undefined;
  const expense = await addExpense({
    date: p.date,
    categoryId,
    amountFils: p.totalFils,
    vatFils: p.vatFils ?? 0,
    vendor: sup?.name ?? p.vendor,
    supplierId: p.supplierId,
    method: p.method ?? 'cash',
    note: p.invoiceNo ? `#${p.invoiceNo}` : '',
    lines: (p.lines ?? []).map((l) => ({ name: l.name, qty: l.qty })),
    ...(blob ? { receipt: new File([blob], 'supplier-invoice.jpg', { type: blob.type || 'image/jpeg' }) } : {}),
    scanned: true,
    overLimitComment: 'receipt',
  });
  await db.papers.update(id, { expenseId: expense.id, updatedAt: nowIso() });
  return {
    expenseId: expense.id,
    undo: async () => {
      await removeEntry({ source: 'expense', id: expense.id });
      await db.papers.update(id, { expenseId: undefined, updatedAt: nowIso() });
    },
  };
}

/* ---------- What the screens read ---------- */

export interface PapersView {
  papers: SupplierPaper[];
  suppliers: Map<string, Supplier>;
  counts: { all: number; waiting: number; look: number; done: number; twin: number; failed: number };
  /** Suppliers the papers name, those added off them; lines read; prices put in the book. */
  learnt: { suppliers: number; added: number; lines: number; prices: number };
}

/** The papers (of one supplier, or all), the newest paper's day first; what they taught. */
export async function loadPapers(supplierId?: string): Promise<PapersView> {
  const [all, sups, prices] = await Promise.all([supplierId ? db.papers.where('supplierId').equals(supplierId).toArray() : db.papers.toArray(), db.suppliers.toArray(), db.priceBook.where('id').startsWith('paper:').count()]);
  const papers = [...all].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.createdAt.localeCompare(a.createdAt));
  const counts = { all: papers.length, waiting: 0, look: 0, done: 0, twin: 0, failed: 0 };
  for (const p of papers) {
    if (p.state === 'waiting' || p.state === 'reading') counts.waiting++;
    else counts[p.state]++;
  }
  const read = papers.filter((p) => p.state === 'done' || p.state === 'look');
  return {
    papers,
    suppliers: new Map(sups.map((s) => [s.id, s])),
    counts,
    learnt: {
      suppliers: new Set(read.map((p) => p.supplierId).filter(Boolean)).size,
      added: read.filter((p) => p.added).length,
      lines: read.reduce((s, p) => s + (p.lines?.length ?? 0), 0),
      prices,
    },
  };
}

/** What a supplier's papers say of it (its card). */
export async function supplierPaperStats(supplierId: string): Promise<PaperStats> {
  return paperStats(await db.papers.where('supplierId').equals(supplierId).toArray());
}

/** Tests: the reader as at the app's start. */
export function resetPaperReader() {
  running = undefined;
  again = false;
  clearTimeout(soon);
}
