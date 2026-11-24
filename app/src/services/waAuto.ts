import { db, uid } from '../db/db';
import { onLocalWrites, type LocalWrite } from '../db/syncHooks';
import { mechanicsOf } from '../domain/crew';
import { dubaiDate, nowIso } from '../domain/dates';
import { liveLines } from '../domain/flow';
import { itemTitle } from '../domain/items';
import type { Customer, Expense, Income, Invoice, ItemDecision, Media, Order, OrderItem, Payment, EstimateVersion, Settings } from '../domain/types';
import { bossText, clientText, isWash, waAutoOf, washText, workText, type BossEvent, type CarFace, type LineFace, type WaAuto, type WaTarget, type WorkTrigger } from '../domain/waAuto';
import { COVER_SLOTS, coverOf } from './cover';
import { invoicePdf, versionPdf } from './documents';
import { AppError } from './errors';
import { bundleAmountDue, loadOrderBundle } from './orders';
import { getSettings, saveSettings } from './settings';
import { blobBase64, queueWa, type OutPart } from './waOutbox';

/*
 * What the garage's WhatsApp says by itself (v0.79, the rules — domain/waAuto.ts): what happens here (a job in, the
 * customer agreed, an invoice, a payment, an expense, a line «CAR WASH») is heard as it is kept (db/syncHooks
 * `onLocalWrites` — never what came from another device: that one said it), and its message handed to the garage's
 * server (services/waOutbox.ts), which sends it when WhatsApp answers. Each message has a key of its own (the record's
 * id): it goes once, whichever device and however often it is heard. A tap on the job sends its reports by hand.
 */

/* ---------- The settings ---------- */

export async function waAutoSettings(): Promise<WaAuto> {
  return waAutoOf((await getSettings()).waAuto);
}

/** A change of the settings: a section's fields (the rest kept). */
export async function saveWaAuto<K extends keyof WaAuto>(section: K, patch: Partial<WaAuto[K]>): Promise<void> {
  const s = await getSettings();
  const kept = (s.waAuto ?? {}) as NonNullable<Settings['waAuto']>;
  await saveSettings({ waAuto: { ...kept, [section]: { ...(kept[section] ?? {}), ...patch } } });
}

/** A company's own group (none — taken off). */
export async function setCustomerGroup(customerId: string, to: WaTarget | undefined): Promise<void> {
  await db.customers.update(customerId, { waGroup: to });
}

/* ---------- What a job says ---------- */

const nameOf = (c?: Pick<Customer, 'name' | 'type' | 'companyName'>) => ((c?.type === 'company' && c.companyName) || c?.name || '').trim();

async function jobFace(orderId: string) {
  const order = await db.orders.get(orderId);
  if (!order) throw new AppError('err.notFound');
  const [vehicle, customer, items] = await Promise.all([db.vehicles.get(order.vehicleId), db.customers.get(order.customerId), db.items.where('orderId').equals(orderId).toArray()]);
  const car: CarFace = { make: vehicle?.make, model: vehicle?.model, year: vehicle?.year, plate: vehicle?.plate };
  return { order, vehicle, customer, items, car };
}

const lineFaces = (items: OrderItem[], lang: 'en' | 'ru'): LineFace[] =>
  [...items]
    .filter((i) => i.kind !== 'discount')
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.createdAt.localeCompare(b.createdAt))
    .map((i) => ({ title: itemTitle(i, lang), qty: i.kind === 'part' ? i.qty : undefined }));

/** The car's photos, its main one first: those the car has of its own sides. */
async function carPhotos(vehicleId: string, n: number): Promise<string[]> {
  if (n <= 0) return [];
  const cover = await coverOf(vehicleId);
  const all = (await db.media.where('ownerId').equals(vehicleId).toArray()).filter((m: Media) => m.ownerType === 'vehicle' && (m.slot === 'cover' || COVER_SLOTS.includes(m.slot ?? '')));
  const ids = [cover, ...all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((m) => m.id)].filter((x): x is string => !!x);
  return [...new Set(ids)].slice(0, n);
}

/** The words, with the photos: on the first photo when they fit a caption, else before them. */
function withPhotos(text: string, photos: string[]): OutPart[] {
  if (!photos.length) return [{ text }];
  if (text.length <= 900) return [{ media: photos[0], caption: text, fallback: text }, ...photos.slice(1).map((media) => ({ media }))];
  return [{ text }, ...photos.map((media) => ({ media }))];
}

async function remember(orderId: string, entry: NonNullable<Order['waSent']>[number]) {
  const order = await db.orders.get(orderId);
  if (!order) return;
  await db.orders.update(orderId, { waSent: [...(order.waSent ?? []), entry].slice(-40) });
}

/* ---------- The work group ---------- */

/**
 * The job to the work group: its car's photo and what is to be done — `lines` (those just agreed), else every live line.
 * By hand — each tap a message; by itself — once (its key).
 */
export async function sendWorkReport(orderId: string, trigger: WorkTrigger = 'manual', lines?: OrderItem[]): Promise<boolean> {
  const s = await waAutoSettings();
  const to = s.work.to;
  if (!to) throw new AppError('wa.err.noGroup');
  const { order, items, car, vehicle } = await jobFace(orderId);
  const live = lines ?? liveLines(items);
  const staff = await db.employees.toArray();
  const mechanics = [...new Set([...mechanicsOf(order), ...live.map((i) => i.employeeId).filter((x): x is string => !!x)])].map((id) => staff.find((e) => e.id === id)?.name).filter((x): x is string => !!x);
  const text = workText({ car, number: order.number, complaint: order.complaint, lines: lineFaces(live, s.work.lang), mechanics, trigger }, s.work.lang, s.work);
  const photo = vehicle ? await coverOf(vehicle.id) : undefined;
  const key = trigger === 'manual' ? `work:hand:${orderId}:${uid().slice(0, 8)}` : `work:${trigger}:${orderId}${lines ? `:${hashOf(lines.map((i) => i.id))}` : ''}`;
  const [r] = await queueWa([{ key, chat: to.chat, parts: withPhotos(text, photo ? [photo] : []), title: `#${order.number} · ${to.name}` }]);
  if (r.state === 'sent' && trigger !== 'manual') return false;
  await remember(orderId, { kind: 'work', at: nowIso(), key, trigger });
  return true;
}

/* ---------- A company's group ---------- */

/** The visit to the company's own group: the car's photos, the day, its driver, its mileage, the work — no prices. */
export async function sendClientReport(orderId: string, auto = false): Promise<boolean> {
  const s = await waAutoSettings();
  const { order, customer, items, car, vehicle } = await jobFace(orderId);
  const to = customer?.waGroup;
  if (!to) throw new AppError('wa.err.noGroup');
  // What was done or agreed; nothing agreed yet — what is on the job.
  const agreed = items.filter((i) => i.approvalState === 'approved' && i.kind !== 'discount');
  const lines = agreed.length ? agreed : liveLines(items);
  const text = clientText({ car, day: dubaiDate(order.arrivedAt ?? order.createdAt), driver: order.driver?.name, mileageKm: order.mileageKm, complaint: order.complaint, lines: lineFaces(lines, s.client.lang) }, s.client.lang, s.client);
  const photos = vehicle ? await carPhotos(vehicle.id, s.client.photos) : [];
  const key = auto ? `client:done:${orderId}` : `client:hand:${orderId}:${uid().slice(0, 8)}`;
  const [r] = await queueWa([{ key, chat: to.chat, parts: withPhotos(text, photos), title: `#${order.number} · ${to.name}` }]);
  if (r.state === 'sent' && auto) return false;
  await remember(orderId, { kind: 'client', at: nowIso(), key, trigger: auto ? 'done' : 'manual' });
  return true;
}

/* ---------- The wash ---------- */

export async function sendWash(orderId: string): Promise<boolean> {
  const s = await waAutoSettings();
  const to = s.wash.to;
  if (!to) return false;
  const { car, vehicle, order } = await jobFace(orderId);
  const text = washText({ car }, 'en', s.wash);
  const photo = vehicle ? await coverOf(vehicle.id) : undefined;
  const key = `wash:${orderId}`;
  const [r] = await queueWa([{ key, chat: to.chat, parts: photo ? [{ media: photo, caption: text, fallback: `${text}\n${[car.make, car.model].filter(Boolean).join(' ')}` }] : [{ text: [text, [car.make, car.model].filter(Boolean).join(' ')].filter(Boolean).join('\n') }], title: `#${order.number} · ${to.name}` }]);
  if (r.state === 'sent') return false;
  await remember(orderId, { kind: 'wash', at: nowIso(), key });
  return true;
}

/* ---------- The boss ---------- */

async function toBoss(key: string, event: BossEvent, files: OutPart[] = []): Promise<void> {
  const s = await waAutoSettings();
  if (!s.boss.on || !s.boss.to) return;
  await queueWa([{ key, chat: s.boss.to.chat, parts: [{ text: bossText(event, s.boss.lang) }, ...files], title: s.boss.to.name }]);
}

async function pdfPart(make: () => Promise<{ blob: Blob; filename: string }>): Promise<OutPart[]> {
  try {
    const f = await make();
    return [{ data: await blobBase64(f.blob), name: f.filename, mime: 'application/pdf', doc: true }];
  } catch {
    // the words go without it
    return [];
  }
}

async function bossInvoice(inv: Invoice) {
  const s = await waAutoSettings();
  if (!s.boss.invoice || inv.type === 'credit_note') return;
  const { order, customer, car } = await jobFace(inv.orderId);
  const files = s.boss.pdf ? await pdfPart(() => invoicePdf(inv.id)) : [];
  await toBoss(`boss:invoice:${inv.id}`, { kind: 'invoice', number: inv.number, car, customer: nameOf(customer), total: inv.totalFils, jobNumber: order.number }, files);
}

async function bossEstimate(v: EstimateVersion) {
  const s = await waAutoSettings();
  if (!s.boss.estimate || v.status !== 'sent') return;
  const { order, customer, car } = await jobFace(v.orderId);
  const lines = v.items.filter((i) => i.kind !== 'discount').map((i) => ({ title: i.title, gross: i.gross }));
  const files = s.boss.pdf ? await pdfPart(() => versionPdf(v.id)) : [];
  await toBoss(`boss:estimate:${v.id}`, { kind: 'estimate', number: order.number, car, customer: nameOf(customer), lines, total: v.fixedGross, version: v.number }, files);
}

async function bossPayment(p: Payment) {
  const s = await waAutoSettings();
  if (!s.boss.payment || p.incomeId || p.kind === 'refund') return;
  const b = await loadOrderBundle(p.orderId);
  if (!b) return;
  await toBoss(`boss:payment:${p.id}`, { kind: 'payment', amount: p.amountFils, method: p.method, car: { make: b.vehicle.make, model: b.vehicle.model, year: b.vehicle.year, plate: b.vehicle.plate }, customer: nameOf(b.customer), jobNumber: b.order.number, due: Math.max(0, bundleAmountDue(b)) });
}

async function bossIncome(x: Income) {
  const s = await waAutoSettings();
  if (!s.boss.income || x.voidedAt) return;
  const customer = x.customerId ? await db.customers.get(x.customerId) : undefined;
  const cat = (await db.incomeCategories.toArray()).find((c) => c.code === x.category);
  const what = [cat ? (s.boss.lang === 'ru' ? cat.nameRu : cat.nameEn) : '', x.note?.trim() ?? ''].filter(Boolean).join(' · ');
  await toBoss(`boss:income:${x.id}`, { kind: 'income', amount: x.amountFils, method: x.method, what, customer: nameOf(customer) || undefined, debt: x.category === 'debt' });
}

/** An expense — or one paid in parts (its parts come together): one message. */
async function bossExpense(list: Expense[]) {
  const s = await waAutoSettings();
  const parts = list.filter((e) => !e.voidedAt);
  if (!s.boss.expense || !parts.length) return;
  const e = parts[0];
  const cat = await db.expenseCategories.get(e.categoryId);
  const supplier = e.supplierId ? await db.suppliers.get(e.supplierId) : undefined;
  const order = e.orderId ? await db.orders.get(e.orderId) : undefined;
  const vehicle = order ? await db.vehicles.get(order.vehicleId) : e.vehicleId ? await db.vehicles.get(e.vehicleId) : undefined;
  const total = parts.reduce((n, x) => n + x.amountFils, 0);
  const photo = s.boss.photo ? parts.map((x) => x.receiptMediaId).find(Boolean) : undefined;
  await toBoss(
    `boss:expense:${e.splitId ?? e.id}`,
    {
      kind: 'expense',
      amount: total,
      method: e.method,
      category: cat ? (s.boss.lang === 'ru' ? cat.nameRu : cat.nameEn) : '',
      vendor: supplier?.name || e.vendor,
      note: e.note,
      car: vehicle ? { make: vehicle.make, model: vehicle.model, year: vehicle.year, plate: vehicle.plate } : undefined,
      jobNumber: order?.number,
      parts: parts.length > 1 ? parts.map((x) => ({ method: x.method, amount: x.amountFils })) : undefined,
    },
    photo ? [{ media: photo }] : [],
  );
}

/* ---------- Heard as it is kept ---------- */

const hashOf = (ids: string[]) => {
  let h = 0;
  for (const ch of [...ids].sort().join(',')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
};

/** How long each waits (a test makes them short). */
const DELAY = { agree: 4000, checkin: 45_000, cover: 3000, ready: 3000, wash: 3000 };
export function setWaAutoDelays(patch: Partial<typeof DELAY>) {
  Object.assign(DELAY, patch);
}

/** What a job's agreement waits for: a moment (one agreement writes in steps), then one message. */
const agreeing = new Map<string, ReturnType<typeof setTimeout>>();
const checkins = new Map<string, ReturnType<typeof setTimeout>>();

async function agreed(orderId: string) {
  const s = await waAutoSettings();
  if (!s.work.on || !s.work.agreed || !s.work.to) return;
  const order = await db.orders.get(orderId);
  if (!order || order.stage === 'closed' || order.stage === 'cancelled') return;
  const items = (await db.items.where('orderId').equals(orderId).toArray()).filter((i) => i.approvalState === 'approved' && i.kind !== 'discount');
  // Told already: only what was agreed since («Добавлено»).
  const told = new Set(order.waSentItems ?? []);
  const fresh = items.filter((i) => !told.has(i.id));
  if (!fresh.length) return;
  if (await sendWorkReport(orderId, told.size ? 'added' : 'agreed', fresh)) {
    const now = await db.orders.get(orderId);
    await db.orders.update(orderId, { waSentItems: [...new Set([...(now?.waSentItems ?? []), ...fresh.map((i) => i.id)])] });
  }
}

async function checkedIn(orderId: string) {
  const s = await waAutoSettings();
  if (!s.work.on || !s.work.checkin || !s.work.to) return;
  const order = await db.orders.get(orderId);
  if (!order || order.stage === 'closed' || order.stage === 'cancelled' || order.stage === 'booked') return;
  // A job typed in afterwards is not a car in now.
  if (order.backdated || Date.now() - Date.parse(order.createdAt) > 6 * 60 * 60_000) return;
  await sendWorkReport(orderId, 'checkin');
}

async function ready(orderId: string) {
  const s = await waAutoSettings();
  const order = await db.orders.get(orderId);
  if (!order) return;
  if (s.work.on && s.work.done && s.work.to) await sendWorkReport(orderId, 'done').catch(() => undefined);
  const customer = await db.customers.get(order.customerId);
  if (s.client.on && s.client.done && customer?.waGroup) await sendClientReport(orderId, true).catch(() => undefined);
}

function later(map: Map<string, ReturnType<typeof setTimeout>>, id: string, ms: number, fn: () => Promise<unknown>) {
  clearTimeout(map.get(id));
  map.set(
    id,
    setTimeout(() => {
      map.delete(id);
      void fn().catch(() => undefined);
    }, ms),
  );
}

/** What a transaction kept, read for news. Many records at once is not news (an import that was not muted). */
const HEARD = new Set(['invoices', 'versions', 'payments', 'incomes', 'expenses', 'decisions', 'orders', 'media', 'items']);
async function heard(writes: LocalWrite[]) {
  // (most writes are none of these: nothing read for them)
  if (!writes.some((w) => HEARD.has(w.table))) return;
  const s = await waAutoSettings();
  const created = (table: string) => writes.filter((w) => w.table === table && w.kind === 'create').map((w) => w.obj);
  if (writes.filter((w) => w.kind === 'create').length > 60) return;
  // The boss
  if (s.boss.on && s.boss.to) {
    for (const inv of created('invoices') as unknown as Invoice[]) void bossInvoice(inv).catch(() => undefined);
    for (const v of created('versions') as unknown as EstimateVersion[]) void bossEstimate(v).catch(() => undefined);
    for (const p of created('payments') as unknown as Payment[]) void bossPayment(p).catch(() => undefined);
    for (const x of created('incomes') as unknown as Income[]) void bossIncome(x).catch(() => undefined);
    const expenses = created('expenses') as unknown as Expense[];
    const groups = new Map<string, Expense[]>();
    for (const e of expenses) groups.set(e.splitId ?? e.id, [...(groups.get(e.splitId ?? e.id) ?? []), e]);
    for (const g of groups.values()) void bossExpense(g).catch(() => undefined);
  }
  // The customer agreed: the lines to do, to the work group (a moment later: one agreement writes in steps).
  for (const d of created('decisions') as unknown as ItemDecision[]) if (d.decision === 'approve') later(agreeing, d.orderId, DELAY.agree, () => agreed(d.orderId));
  // A car in: its photo is usually taken a moment after — the report waits a little for it.
  for (const o of created('orders') as unknown as Order[]) later(checkins, o.id, DELAY.checkin, () => checkedIn(o.id));
  for (const m of created('media') as unknown as Media[]) {
    if (m.ownerType !== 'vehicle' || m.slot !== 'cover') continue;
    const open = (await db.orders.where('vehicleId').equals(m.ownerId).toArray()).filter((o) => o.stage !== 'closed' && o.stage !== 'cancelled' && Date.now() - Date.parse(o.createdAt) < 6 * 60 * 60_000);
    for (const o of open) later(checkins, o.id, DELAY.cover, () => checkedIn(o.id));
  }
  // Ready: an invoice made.
  for (const inv of created('invoices') as unknown as Invoice[]) if (inv.type !== 'credit_note') later(checkins, `ready:${inv.orderId}`, DELAY.ready, () => ready(inv.orderId));
  // The wash: a line named so, new or renamed.
  if (s.wash.on && s.wash.to) {
    for (const w of writes) {
      if (w.table !== 'items') continue;
      const it = w.obj as unknown as OrderItem;
      const name = `${it.titleEn ?? ''} ${it.titleRu ?? ''}`;
      if (!isWash(name, s.wash.words)) continue;
      if (w.kind === 'update') {
        const was = w.was as unknown as OrderItem;
        if (isWash(`${was?.titleEn ?? ''} ${was?.titleRu ?? ''}`, s.wash.words)) continue;
      }
      later(checkins, `wash:${it.orderId}`, DELAY.wash, () => sendWash(it.orderId));
    }
  }
}

let started = false;
/** Once, at the app's start. */
export function startWaAuto() {
  if (started) return;
  started = true;
  onLocalWrites((writes) => void heard(writes).catch(() => undefined));
}
