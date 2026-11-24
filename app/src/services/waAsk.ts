import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { itemTitle, lineName } from '../domain/items';
import { roundFils } from '../domain/money';
import { askFor, kindOnly, netUnit, parseReply, type AskLine } from '../domain/supplierReply';
import type { Order, OrderItem, PartAsk, PartOffer, Supplier, Vehicle } from '../domain/types';
import { enteredPrice, priceFromEntered, vatModeOf } from '../domain/vat';
import { waAutoOf } from '../domain/waAuto';
import { waDigits } from '../domain/whatsapp';
import { AppError } from './errors';
import { updateItem } from './estimate';
import { partsRequestText } from './messages';
import { getSettings } from './settings';
import { blobBase64, queueWa } from './waOutbox';
import { chatOfPhone, fetchChatMessages, numberOnWa, onWaEvent, waReady, waStore } from './whatsapp';

/*
 * Parts asked of suppliers through the garage's WhatsApp, and their answers read (v0.79, the user: «автоотправка
 * заявок в WhatsApp поставщиков — сначала выбрать их, потом отправить»; «прочитать переписки с поставщиками… чтобы
 * приложение сразу выставляло цены к позициям заказа — без ИИ»).
 *
 * A request: the job's list (the car, its VIN, the parts, numbered) and the diagrams' sheets — to each supplier picked,
 * by the garage's server, one after another with a pause between (the manager's setting). Each is kept on the job
 * (`Order.asks`): to whom, which lines in which order. An answer from that supplier after it is read (domain/supplierReply.ts)
 * and its prices become the lines' offers (`PartOffer.msg`) — and, as set, the line's cost and the customer's price.
 */

/** The parts a request lists, as the request lists them. */
const askLines = (items: OrderItem[]): AskLine[] => items.map((i) => ({ name: lineName((i.titleEn || i.titleRu || '').trim()), qty: i.qty || 1, number: i.partNumber?.trim() || undefined }));

/** A supplier's number as WhatsApp has it (its own WhatsApp number from the book first). */
const phoneOf = (s: Supplier): string => waDigits(s.phone) || '';

export interface AskPick {
  supplierId: string;
  /** A seller of used parts: the car's and the parts' photos with the words. */
  used?: boolean;
}

/**
 * The request to each supplier picked, sent by the garage's server (`files` — the diagrams' sheets; `usedFiles` — the
 * car's and the parts' photos for a used-parts seller). What could not be asked (no number) is said back.
 */
export async function askSuppliers(orderId: string, picks: AskPick[], x: { items: OrderItem[]; sheets: File[]; usedFiles: File[] }): Promise<{ asked: number; noNumber: string[] }> {
  const s = waAutoOf((await getSettings()).waAuto);
  if (!picks.length) return { asked: 0, noNumber: [] };
  if (picks.length > s.ask.max) throw new AppError('wa.err.tooManySuppliers', { n: s.ask.max });
  if (!x.items.length) throw new AppError('wa.err.noParts');
  const order = await db.orders.get(orderId);
  const vehicle = order ? await db.vehicles.get(order.vehicleId) : undefined;
  if (!order || !vehicle) throw new AppError('err.notFound');
  const suppliers = (await db.suppliers.bulkGet(picks.map((p) => p.supplierId))).filter((v): v is Supplier => !!v);
  const sheets = await Promise.all(x.sheets.map(async (f) => ({ data: await blobBase64(f), name: f.name || 'diagrams.jpg', mime: f.type || 'image/jpeg' })));
  const used = await Promise.all(x.usedFiles.map(async (f) => ({ data: await blobBase64(f), name: f.name || 'photo.jpg', mime: f.type || 'image/jpeg' })));
  const batch = uid().slice(0, 8);
  const noNumber: string[] = [];
  const asks: PartAsk[] = [];
  const items = [];
  for (const sup of suppliers) {
    const phone = phoneOf(sup);
    if (!phone) {
      noNumber.push(sup.name);
      continue;
    }
    const isUsed = !!picks.find((p) => p.supplierId === sup.id)?.used;
    const files = isUsed ? used : sheets;
    const text = partsRequestText(vehicle as Vehicle, x.items, { diagrams: !isUsed && sheets.length > 0, used: isUsed });
    const key = `ask:${orderId}:${batch}:${sup.id}`;
    items.push({ key, phone, gap: s.ask.gapSec, title: `#${order.number} · ${sup.name}`, parts: [{ text }, ...files] });
    asks.push({ id: `${batch}:${sup.id}`, supplierId: sup.id, phone, at: nowIso(), items: x.items.map((i) => i.id), text, via: 'server', key, used: isUsed || undefined });
  }
  if (!items.length) return { asked: 0, noNumber };
  await queueWa(items);
  await keepAsks(orderId, asks);
  askPhones = undefined;
  return { asked: asks.length, noNumber };
}

/** The request opened by hand (the supplier's chat by its link, the list in it): its answer is read the same way. */
export async function recordLinkAsk(orderId: string, supplierId: string, items: OrderItem[], text: string): Promise<void> {
  const sup = await db.suppliers.get(supplierId);
  const phone = sup ? phoneOf(sup) : '';
  if (!phone || !items.length) return;
  await keepAsks(orderId, [{ id: `${uid().slice(0, 8)}:${supplierId}`, supplierId, phone, at: nowIso(), items: items.map((i) => i.id), text, via: 'link' }]);
}

async function keepAsks(orderId: string, asks: PartAsk[]) {
  const order = await db.orders.get(orderId);
  if (!order) return;
  // The last 30 requests of a job are kept (their answers with them).
  await db.orders.update(orderId, { asks: [...(order.asks ?? []), ...asks].slice(-30) });
  askPhones = undefined;
}

/* ---------- The answers ---------- */

/** Requests still worth reading answers to: five days, a job not closed. */
/**
 * The numbers asked and not yet past their five days (v0.80.2): a message from anyone else is not a supplier's answer —
 * nothing is read for it. Kept a minute (a busy account writes every few seconds); a new request puts it aside at once.
 */
let askPhones: { at: number; set: Set<string> } | undefined;
async function openAskPhones(): Promise<Set<string>> {
  if (askPhones && Date.now() - askPhones.at < 60_000) return askPhones.set;
  const set = new Set((await openAsks()).map((x) => x.ask.phone));
  askPhones = { at: Date.now(), set };
  return set;
}

async function openAsks(): Promise<{ order: Order; ask: PartAsk }[]> {
  const orders = await db.orders.where('stage').noneOf(['closed', 'cancelled']).toArray();
  const since = Date.now() - 5 * 24 * 60 * 60_000;
  return orders.flatMap((order) => (order.asks ?? []).filter((a) => Date.parse(a.at) > since).map((ask) => ({ order, ask })));
}

/** The lines a reply priced, by job — for the notice («Цены от … — 2 позиции»). */
export interface RepliesRead {
  orderId: string;
  number: number;
  supplier: string;
  lines: number;
}
type ReadListener = (r: RepliesRead) => void;
const readListeners = new Set<ReadListener>();
export function onRepliesRead(fn: ReadListener): () => void {
  readListeners.add(fn);
  return () => void readListeners.delete(fn);
}

/** The offer kept for a part, from a parsed one. */
function offerOf(o: ReturnType<typeof parseReply>['lines'][number]['offers'][number], ctx: { msg: string; supplierId: string; n: string; vat: 'net' | 'gross'; vatBp: number }): PartOffer {
  return {
    id: ctx.n,
    kind: o.kind,
    costFils: o.na ? undefined : netUnit(o, ctx.vat, ctx.vatBp),
    supplierId: ctx.supplierId,
    days: o.days,
    msg: ctx.msg,
    unsure: !o.kindSaid && !o.na ? true : undefined,
    na: o.na ? true : undefined,
    brand: o.brand,
    note: o.note ?? (o.pending ? 'checking' : undefined),
  };
}

/** The best offer for the line, as the settings say: the original first, or the cheapest; not one «not available». */
function bestOffer(offers: PartOffer[], prefer: 'oem' | 'cheap'): PartOffer | undefined {
  const priced = offers.filter((o) => o.costFils !== undefined && !o.na);
  if (!priced.length) return undefined;
  const cheap = (list: PartOffer[]) => [...list].sort((a, b) => (a.costFils ?? 0) - (b.costFils ?? 0))[0];
  if (prefer === 'oem') {
    const oem = priced.filter((o) => o.kind === 'oem' && !o.unsure);
    if (oem.length) return cheap(oem);
  }
  return cheap(priced);
}

let reading: Promise<number> | undefined;
let again = false;
/**
 * The answers to the open requests read: each supplier's chat once, the messages after the request that were not read
 * yet; their prices put on the lines. `phones` — only these suppliers' chats (a message just came from one).
 */
export function readReplies(phones?: string[]): Promise<number> {
  if (reading) {
    again = true;
    return reading;
  }
  reading = readNow(phones).finally(() => {
    reading = undefined;
    if (again) {
      again = false;
      void readReplies();
    }
  });
  return reading;
}

async function readNow(phones?: string[]): Promise<number> {
  const settings = await getSettings();
  const s = waAutoOf(settings.waAuto);
  if (!s.ask.read || !waReady()) return 0;
  const open = await openAsks();
  const byPhone = new Map<string, { order: Order; ask: PartAsk }[]>();
  for (const x of open) if (!phones || phones.includes(x.ask.phone)) byPhone.set(x.ask.phone, [...(byPhone.get(x.ask.phone) ?? []), x]);
  let priced = 0;
  for (const [phone, asks] of byPhone) {
    let chat = chatOfPhone(phone)?.id;
    if (!chat) {
      try {
        const r = await numberOnWa(phone);
        chat = r.ok ? r.chat : undefined;
      } catch {
        chat = undefined;
      }
    }
    if (!chat) continue;
    let msgs;
    try {
      msgs = await fetchChatMessages(chat, 60);
    } catch {
      continue;
    }
    const first = Math.min(...asks.map((a) => Date.parse(a.ask.at))) - 60_000;
    const seen = new Set(asks.flatMap((a) => (a.ask.replies ?? []).map((r) => r.id)));
    for (const m of msgs) {
      if (m.me || m.t < first || seen.has(m.id) || !(m.text ?? '').trim()) continue;
      const target = askFor({ t: m.t, text: m.text, quote: m.quote?.text }, asks.map((a) => ({ ...a.ask, at: Date.parse(a.ask.at), ref: a })));
      if (!target) continue;
      // A list numbered past that request's parts answers another one to the same supplier (the newest that fits).
      const others = asks.filter((a) => a !== target.ref && Date.parse(a.ask.at) <= m.t + 60_000).sort((a, b) => Date.parse(b.ask.at) - Date.parse(a.ask.at));
      let got = -1;
      for (const x of [target.ref, ...others]) {
        got = await applyReply(x.order.id, x.ask.id, m, settings, s, true);
        if (got >= 0) break;
      }
      if (got < 0) got = await applyReply(target.ref.order.id, target.ref.ask.id, m, settings, s, false);
      priced += Math.max(0, got);
      seen.add(m.id);
    }
  }
  return priced;
}

/**
 * One message of a supplier put on the job it answers: its prices as offers, its words kept with the request. `strict`
 * — a message that answers another request is left (−1): the caller tries the supplier's other requests.
 */
async function applyReply(orderId: string, askId: string, m: { id: string; t: number; text: string }, settings: Awaited<ReturnType<typeof getSettings>>, s: ReturnType<typeof waAutoOf>, strict = false): Promise<number> {
  const order = await db.orders.get(orderId);
  const ask = order?.asks?.find((a) => a.id === askId);
  if (!order || !ask || ask.replies?.some((r) => r.id === m.id)) return 0;
  const vehicle = await db.vehicles.get(order.vehicleId);
  const items = (await db.items.bulkGet(ask.items)).filter((i): i is OrderItem => !!i);
  const lines = askLines(ask.items.map((id) => items.find((i) => i.id === id)).filter((i): i is OrderItem => !!i));
  const parsed = parseReply(m.text, lines, { make: vehicle?.make });
  if (parsed.other && strict) return -1;
  const kind = parsed.lines.length ? undefined : kindOnly(m.text);
  let priced = 0;
  const short = m.id.slice(-10);
  for (const [n, itemId] of ask.items.entries()) {
    const item = items.find((i) => i.id === itemId);
    if (!item) continue;
    let offers = [...(item.offers ?? [])];
    const before = JSON.stringify(offers);
    const mine = (o: PartOffer) => o.supplierId === ask.supplierId && !!o.msg && (ask.replies ?? []).some((r) => r.id === o.msg);
    // «original» on its own: the kind of what this supplier said last without one.
    if (kind) offers = offers.map((o) => (mine(o) && o.unsure ? { ...o, kind, unsure: undefined } : o));
    const line = parsed.lines.find((l) => l.index === n);
    // «na» to the whole request: only for the parts this supplier has not answered.
    if (line && !(parsed.naAll && offers.some(mine))) {
      offers = offers.filter((o) => o.msg !== m.id);
      offers.push(...line.offers.map((o, k) => offerOf(o, { msg: m.id, supplierId: ask.supplierId, n: `wa:${short}:${n}:${k}`, vat: s.ask.vat, vatBp: item.vatRateBp || settings.vatRateBp })));
      if (line.offers.some((o) => !o.na && !o.pending)) priced++;
    }
    if (JSON.stringify(offers) === before) continue;
    const patch: Partial<OrderItem> = { offers };
    // As set: the line's cost (and its supplier) from the best offer — only on a line without a cost yet, not bought yet.
    const best = bestOffer(offers, s.ask.prefer);
    const free = item.costPriceFils === undefined && (!item.procurementStatus || item.procurementStatus === 'needed') && !item.customerSupplied;
    if (best && free && (s.ask.prices === 'cost' || s.ask.prices === 'price')) {
      patch.costPriceFils = best.costFils;
      patch.supplierId = best.supplierId;
      // …and the customer's price by the garage's markup — a draft line without a price only.
      if (s.ask.prices === 'price' && item.approvalState === 'draft' && !item.unitPriceFils && best.costFils !== undefined) {
        const rate = item.vatRateBp || settings.vatRateBp;
        const mode = vatModeOf(item, settings.pricesIncludeVat);
        const net = roundFils(best.costFils * (1 + settings.defaultMarkupBp / 10000));
        Object.assign(patch, priceFromEntered(enteredPrice({ unitPriceFils: net }, rate, mode), rate, mode));
      }
    }
    try {
      await updateItem(item.id, patch);
    } catch {
      // a line sent to the customer keeps its price: the offers alone
      await updateItem(item.id, { offers });
    }
  }
  // The message kept with the request (read once; its words shown on the job's suppliers screen).
  const now = await db.orders.get(orderId);
  const asks = (now?.asks ?? []).map((a) => (a.id === askId ? { ...a, replies: [...(a.replies ?? []), { id: m.id, at: new Date(m.t).toISOString(), text: m.text.slice(0, 400), lines: priced }].slice(-12) } : a));
  await db.orders.update(orderId, { asks });
  if (priced) {
    const sup = await db.suppliers.get(ask.supplierId);
    for (const fn of readListeners) fn({ orderId, number: order.number, supplier: sup?.name ?? '', lines: priced });
  }
  return priced;
}

/* ---------- Running ---------- */

let started = false;
let soon: ReturnType<typeof setTimeout> | undefined;
const waiting = new Set<string>();
/** Once, at the app's start: an answer read the moment it comes; all open requests when WhatsApp is ready, and every 15 minutes. */
export function startWaReplies() {
  if (started || typeof window === 'undefined') return;
  started = true;
  onWaEvent((ev) => {
    if (ev.t === 'msg' && !ev.msg.me) {
      const phone = ev.chat?.phone || waStore().chats.find((c) => c.id === ev.msg.chat)?.phone;
      if (!phone) return;
      // Only a number asked for parts: the rest of the account's messages read nothing (v0.80.2).
      void openAskPhones()
        .then((asked) => {
          if (!asked.has(phone)) return;
          waiting.add(phone);
          clearTimeout(soon);
          soon = setTimeout(() => {
            const list = [...waiting];
            waiting.clear();
            void readReplies(list).catch(() => undefined);
          }, 2500);
        })
        .catch(() => undefined);
    }
    if (ev.t === 'state' && ev.state.phase === 'ready') setTimeout(() => void readReplies().catch(() => undefined), 5000);
  });
  setTimeout(() => void readReplies().catch(() => undefined), 15_000);
  setInterval(() => document.visibilityState === 'visible' && void readReplies().catch(() => undefined), 15 * 60_000);
}

/** The words of a line as a supplier is asked (the list's own). */
export const askTitle = (i: OrderItem) => itemTitle(i, 'en');
