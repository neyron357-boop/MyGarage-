import { db, uid, whereAnyOf } from '../db/db';
import { nowIso } from '../domain/dates';
import { itemTitle, lineName } from '../domain/items';
import { withMarkup } from '../domain/money';
import { kindOnly, netUnit, numbersSaid, parseReply, type AskLine, type ParsedReply } from '../domain/supplierReply';
import { focusIndexes, namesLine, readThreads, type Thread, type ThreadJob } from '../domain/supplierThread';
import { aiPictureText, aiReadReply, aiVoiceText, type AiReply } from './ai';
import { kindOf, msgKey, type WaMessage } from '../domain/whatsapp';
import type { Order, OrderItem, PartAsk, PartOffer, Supplier, Vehicle } from '../domain/types';
import { enteredPrice, priceFromEntered, vatModeOf } from '../domain/vat';
import { waAutoOf } from '../domain/waAuto';
import { waDigits } from '../domain/whatsapp';
import { AppError } from './errors';
import { pricesNews, quoteNews } from './newsWatch';
import { updateItem } from './estimate';
import { partsRequestText } from './messages';
import { saveSupplier } from './parts';
import { getSettings } from './settings';
import { blobBase64, queueWa, type OutItem } from './waOutbox';
import { chatOfPhone, fetchChatMessages, loadChatRoles, numberOnWa, onWaEvent, waReady, waStore } from './whatsapp';

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
/**
 * A supplier only in WhatsApp, asked (v0.91, the owner's note #74): made one of the base — its chat's name and number, the
 * makes given to the chat by hand (`wa:<chat>` in the sheet; services/supplierRank.ts `chatSuppliers`). One of the base
 * with the same number already — that one.
 */
export async function supplierOfChat(chatId: string): Promise<string | undefined> {
  const [fact, roles] = await Promise.all([db.chatFacts.get(chatId), loadChatRoles()]);
  const chat = waStore().chats.find((c) => c.id === chatId);
  const phone = chat?.phone || fact?.phone;
  if (!phone) return undefined;
  const have = (await db.suppliers.toArray()).find((s) => waDigits(s.phone) === phone);
  if (have) return have.id;
  const s = await saveSupplier({ name: (chat?.name || fact?.name || '').trim() || `+${phone}`, phone: `+${phone}`, makes: fact?.makes?.length ? fact.makes : undefined, service: roles.tags[chatId] === 'service' || undefined });
  return s.id;
}

export async function askSuppliers(
  orderId: string,
  picks: AskPick[],
  x: {
    items: OrderItem[];
    sheets: File[];
    usedFiles: File[];
    /** v0.91.7 (#76): sent then, not now (ms). */
    after?: number;
    /**
     * v0.99 (audit W28): the request's words were in front of the person when he tapped «Отправить» (the sheet shows them) —
     * that tap is the one that sends (v0.84.4: seen and tapped); otherwise it waits in «Проверить и отправить».
     */
    seen?: boolean;
  },
): Promise<{ asked: number; noNumber: string[]; queued: boolean }> {
  const s = waAutoOf((await getSettings()).waAuto);
  const later = x.after && x.after > Date.now() + 30_000 ? x.after : undefined;
  // A server that does not keep a message until its time would send it now.
  if (later && !waStore().status?.later) throw new AppError('later.oldServer');
  if (!picks.length) return { asked: 0, noNumber: [], queued: false };
  if (picks.length > s.ask.max) throw new AppError('wa.err.tooManySuppliers', { n: s.ask.max });
  if (!x.items.length) throw new AppError('wa.err.noParts');
  // Suppliers only in WhatsApp (v0.91): of the base now — the request is kept on the job under them.
  if (picks.some((p) => p.supplierId.startsWith('wa:'))) {
    const ids = await Promise.all(picks.map(async (p) => (p.supplierId.startsWith('wa:') ? ((await supplierOfChat(p.supplierId.slice(3))) ?? p.supplierId) : p.supplierId)));
    picks = picks.map((p, k) => ({ ...p, supplierId: ids[k] }));
  }
  const order = await db.orders.get(orderId);
  const vehicle = order ? await db.vehicles.get(order.vehicleId) : undefined;
  if (!order || !vehicle) throw new AppError('err.notFound');
  const suppliers = (await db.suppliers.bulkGet(picks.map((p) => p.supplierId))).filter((v): v is Supplier => !!v);
  const sheets = await Promise.all(x.sheets.map(async (f) => ({ data: await blobBase64(f), name: f.name || 'diagrams.jpg', mime: f.type || 'image/jpeg' })));
  const used = await Promise.all(x.usedFiles.map(async (f) => ({ data: await blobBase64(f), name: f.name || 'photo.jpg', mime: f.type || 'image/jpeg' })));
  const batch = uid().slice(0, 8);
  const noNumber: string[] = [];
  const asks: PartAsk[] = [];
  const items: OutItem[] = [];
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
    // Asked when it goes: an answer is looked for after it.
    const ask: PartAsk = { id: `${batch}:${sup.id}`, supplierId: sup.id, phone, at: later ? new Date(later).toISOString() : nowIso(), items: x.items.map((i) => i.id), text, via: 'server', key, used: isUsed || undefined };
    asks.push(ask);
    items.push({ key, phone, gap: s.ask.gapSec, title: `#${order.number} · ${sup.name}`, parts: [{ text }, ...files], ask: { orderId, ask }, ...(later ? { after: later } : {}) });
  }
  if (!items.length) return { asked: 0, noNumber, queued: false };
  const went = await queueWa(items, { confirmed: !!x.seen });
  // Kept on the job only once it went (audit 27/11): a request dropped in «Проверить и отправить» is not «asked» —
  // `keepSentAsks` keeps it at «Отправить». Handed over already (seen in the sheet, or no review on this device) — kept now.
  await keepSentAsks(items.filter((_, k) => went[k]?.state !== 'confirm'));
  return { asked: asks.length, noNumber, queued: went.some((w) => w.state === 'confirm') };
}

/** The supplier requests among what really went (audit 27/11): each kept on its job, its answer looked for after it. */
export async function keepSentAsks(items: OutItem[]): Promise<void> {
  const byJob = new Map<string, PartAsk[]>();
  for (const it of items) if (it.ask) byJob.set(it.ask.orderId, [...(byJob.get(it.ask.orderId) ?? []), it.ask.ask]);
  for (const [orderId, asks] of byJob) await keepAsks(orderId, asks);
  askPhones = undefined;
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

/**
 * The numbers asked and not yet past their five days (v0.80.2): a message from anyone else is not a supplier's answer —
 * nothing is read for it. Kept a minute (a busy account writes every few seconds); a new request puts it aside at once.
 */
let askPhones: { at: number; set: Set<string> } | undefined;
async function openAskPhones(): Promise<Set<string>> {
  if (askPhones && Date.now() - askPhones.at < 60_000) return askPhones.set;
  const set = new Set(asksOf(await openOrders()).map((x) => x.ask.phone));
  askPhones = { at: Date.now(), set };
  return set;
}

const openOrders = () => db.orders.where('stage').noneOf(['closed', 'cancelled']).toArray();

/** Requests still worth reading answers to: five days, a job not closed. */
function asksOf(orders: Order[]): { order: Order; ask: PartAsk }[] {
  const since = Date.now() - 5 * 24 * 60 * 60_000;
  return orders.flatMap((order) => (order.asks ?? []).filter((a) => Date.parse(a.at) > since).map((ask) => ({ order, ask })));
}

/** The open jobs as a supplier's chat is read against them (v1.04): their cars, their lines a supplier is asked about. */
async function threadJobs(orders: Order[]): Promise<ThreadJob[]> {
  const [vehicles, items] = await Promise.all([db.vehicles.bulkGet([...new Set(orders.map((o) => o.vehicleId))]), whereAnyOf(db.items, 'orderId', orders.map((o) => o.id))]);
  const car = new Map(vehicles.filter((v): v is Vehicle => !!v).map((v) => [v.id, v]));
  return orders.map((o) => {
    const v = car.get(o.vehicleId);
    return {
      orderId: o.id,
      vin: v?.vin?.trim().toUpperCase() || undefined,
      make: v?.make,
      model: v?.model,
      lines: items
        .filter((i) => i.orderId === o.id && i.kind !== 'labor' && i.kind !== 'discount')
        .map((i) => ({ id: i.id, name: lineName((i.titleEn || i.titleRu || '').trim()), open: (!i.procurementStatus || i.procurementStatus === 'needed') && !i.customerSupplied })),
    };
  });
}

/**
 * The messages this device has decided on and put nowhere (v1.04): not read again — a message with digits would ask the
 * AI each time. Eight days, on the device (what was put on a job is kept on the job: `PartAsk.replies`).
 */
const READ_KEY = 'mygarage.waAsk.read';
let readMemo: Map<string, number> | undefined;
function readHere(): Map<string, number> {
  if (readMemo) return readMemo;
  readMemo = new Map();
  try {
    for (const [id, t] of Object.entries(JSON.parse(localStorage.getItem(READ_KEY) ?? '{}') as Record<string, number>)) readMemo.set(id, t);
  } catch {
    // no storage (tests): this run only
  }
  return readMemo;
}
function keepRead() {
  const memo = readHere();
  const since = Date.now() - 8 * 24 * 60 * 60_000;
  for (const [id, t] of memo) if (t < since) memo.delete(id);
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(Object.fromEntries(memo)));
  } catch {
    // no storage
  }
}
/** Tests: every device starts with nothing decided. */
export function resetWaReplies() {
  readMemo = new Map();
  try {
    localStorage.removeItem(READ_KEY);
  } catch {
    // no storage
  }
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
function offerOf(o: ReturnType<typeof parseReply>['lines'][number]['offers'][number], ctx: { msg: string; supplierId: string; n: string; vat: 'net' | 'gross'; vatBp: number; ai?: boolean }): PartOffer {
  return {
    ...(ctx.ai ? { ai: true as const } : {}),
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

type Open = { order: Order; ask: PartAsk };

/**
 * v1.04 (the owner: «ИИ не понимает контекста ответов поставщиков и присваивает большинство из них к не тем заказам»): a
 * supplier's chat is read as the conversation it is (domain/supplierThread.ts) — each of their messages goes to the request
 * the talk before it was about, or nowhere; until v1.04 a message without a quote went to the request sent last, and,
 * once its job was closed, was read again onto another one.
 */
async function readNow(phones?: string[]): Promise<number> {
  const settings = await getSettings();
  const s = waAutoOf(settings.waAuto);
  if (!s.ask.read || !waReady()) return 0;
  const orders = await openOrders();
  const byPhone = new Map<string, Open[]>();
  for (const x of asksOf(orders)) if (!phones || phones.includes(x.ask.phone)) byPhone.set(x.ask.phone, [...(byPhone.get(x.ask.phone) ?? []), x]);
  if (!byPhone.size) return 0;
  const jobs = await threadJobs(orders);
  const memo = readHere();
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
    let msgs: WaMessage[];
    try {
      msgs = (await fetchChatMessages(chat, 100)).sort((a, b) => a.t - b.t);
    } catch {
      continue;
    }
    const threads = readThreads(
      msgs.map((m) => ({ id: m.id, t: m.t, me: m.me, text: m.text, quote: m.quote ? { id: m.quote.id, text: m.quote.text } : undefined })),
      asks.map((x) => ({ id: x.ask.id, orderId: x.order.id, at: Date.parse(x.ask.at), text: x.ask.text, items: x.ask.items })),
      jobs,
    );
    const seen = new Set(asks.flatMap((a) => (a.ask.replies ?? []).map((r) => r.id)));
    const supplierId = [...asks].sort((a, b) => Date.parse(b.ask.at) - Date.parse(a.ask.at))[0].ask.supplierId;
    for (const raw of msgs) {
      if (raw.me || seen.has(raw.id) || memo.has(raw.id)) continue;
      const th = threads.get(raw.id);
      const x = th?.ask ? asks.find((a) => a.ask.id === th.ask) : th?.chat ? byHand(th.chat, orders, phone, supplierId) : undefined;
      // About no request of ours (another car, parts asked by hand of no open job, nothing said before it): put nowhere.
      if (!x || raw.t < Date.parse(x.ask.at) - 60_000) continue;
      // Audit 27/11: an answer said aloud (a voice message up to 3 minutes) or shown (a photo of the price list, a
      // screenshot of their system, a PDF quotation) — written down by the garage's AI, then read as words by the rules.
      const heard = await heardOf(raw);
      const m = heard ? { ...raw, text: heard } : raw;
      if (!(m.text ?? '').trim()) continue;
      const got = await answer(x, { id: m.id, t: m.t, text: m.text ?? '', quote: m.quote?.text }, th, settings, s, { heard: !!heard, context: contextOf(msgs, threads, raw) });
      if (got === undefined) {
        memo.set(raw.id, raw.t);
        continue;
      }
      seen.add(raw.id);
      priced += got;
      // v0.97: the prices told at once — the supplier, the car, the lines with their prices.
      if (got > 0) {
        const now = await db.orders.get(x.order.id);
        const ask = now?.asks?.find((a) => a.id === x.ask.id);
        if (now && ask && (await pricesNews({ order: now, ask }, m.id).catch(() => false))) void quoteNews(now.id).catch(() => false);
      }
    }
  }
  keepRead();
  return priced;
}

/** A request asked by hand in the chat (v1.04): kept on its job only once its answer gives something. */
function byHand(c: NonNullable<Thread['chat']>, orders: Order[], phone: string, supplierId: string): Open | undefined {
  const order = orders.find((o) => o.id === c.orderId);
  if (!order) return undefined;
  const id = `c:${msgKey(c.msg).slice(-16)}:${supplierId}`;
  const kept = order.asks?.find((a) => a.id === id);
  return { order, ask: kept ?? { id, supplierId, phone, at: new Date(c.at).toISOString(), items: c.items, text: c.text, via: 'chat' } };
}

/** The talk of the message's own thread just before it (the AI's context): a few lines, who said each. */
function contextOf(msgs: WaMessage[], threads: Map<string, Thread>, m: WaMessage): string[] {
  const th = threads.get(m.id);
  const key = th?.ask ?? th?.chat?.msg;
  if (!key) return [];
  const before = msgs.filter((x) => x.t <= m.t && x.id !== m.id).slice(-30);
  return before
    .filter((x) => {
      const t = threads.get(x.id);
      return (t?.ask ?? t?.chat?.msg) === key;
    })
    .slice(-6)
    .map((x) => `${x.me ? 'G' : 'S'}: ${(x.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 140) || `[${kindOf(x.type)}]`}`);
}

/**
 * One message of a supplier read for the request its thread is (v1.04): by the rules, with what the talk before it was
 * about; the AI only when the rules placed nothing and it has digits (then with the talk, and only prices it says).
 * `undefined` — nothing for this request (nothing kept, not read again here).
 */
async function answer(
  x: Open,
  m: { id: string; t: number; text: string; quote?: string },
  th: Thread | undefined,
  settings: Awaited<ReturnType<typeof getSettings>>,
  s: ReturnType<typeof waAutoOf>,
  o: { heard: boolean; context: string[] },
): Promise<number | undefined> {
  const order = await db.orders.get(x.order.id);
  if (!order) return undefined;
  const stored = order.asks?.find((a) => a.id === x.ask.id);
  if (stored?.replies?.some((r) => r.id === m.id)) return 0;
  const { lines, car } = await linesOf({ order, ask: x.ask });
  const v = await db.vehicles.get(order.vehicleId);
  const focus = focusIndexes(th, x.ask.items);
  let parsed: ParsedReply & { ai?: true } = parseReply(m.text, lines, { make: v?.make, focus });
  // A list longer than this request: another request's answer.
  if (parsed.other) return undefined;
  if (o.heard) {
    parsed = { ...parsed, ai: true };
    // A voice message with only «no have» in it and no line named (the card machine, the account): not about the parts.
    if (parsed.lines.length && parsed.lines.every((l) => l.offers.every((of) => of.na)) && !lines.some((l) => namesLine(m.text, l.name))) parsed = { ...parsed, lines: [] };
  }
  // The app's own rules placed nothing and there are digits in it (v0.86): the AI reads it — with the talk before it.
  if (!parsed.lines.length && !o.heard && /\d/.test(m.text)) parsed = (await aiRead(m, lines, car, focus, o.context)) ?? parsed;
  if (!stored) {
    // Asked by hand: kept on the job only for an answer that gives something.
    if (!parsed.lines.length) return undefined;
    await keepAsks(order.id, [x.ask]);
  }
  return applyReply(order.id, x.ask.id, m, parsed, settings, s);
}

/** A request's lines, as the request lists them (the line's own order). */
async function linesOf(x: { order: Order; ask: PartAsk }): Promise<{ items: OrderItem[]; lines: AskLine[]; car: string }> {
  const items = (await db.items.bulkGet(x.ask.items)).filter((i): i is OrderItem => !!i);
  const ordered = x.ask.items.map((id) => items.find((i) => i.id === id)).filter((i): i is OrderItem => !!i);
  const v = await db.vehicles.get(x.order.vehicleId);
  return { items, lines: askLines(ordered), car: [v?.make, v?.model].filter(Boolean).join(' ') };
}

/**
 * The AI's reading of a supplier's message (v0.86, the owner: «если поставщик дал цены, ИИ должен понимать, к какому заказу
 * относится, и в этом заказе заполнять цены закупок, но чтобы я понимал, что ИИ это заполнил»): only a message with digits
 * in which the rules placed nothing. v1.04 — the request is the one the chat's talk says (the AI does not choose among
 * jobs), the AI sees that talk and what it was about, and a price it gives is taken only when the message says that
 * number (one piece's, or the line's quantity's) — kept as read by the AI (`PartOffer.ai`, `OrderItem.costAi`).
 */
async function aiRead(m: { text: string; quote?: string }, lines: AskLine[], car: string, focus: number[] | undefined, context: string[]): Promise<(ParsedReply & { ai: true }) | undefined> {
  const id = 'A';
  const r = await aiReadReply(m.text, m.quote ?? '', [{ id, car, lines: lines.map((l) => `${l.name}${l.qty > 1 ? ` × ${l.qty}` : ''}`) }], { context, focus: focus?.map((i) => i + 1) });
  if (!r || r.ask !== id || !r.lines.length) return undefined;
  const said = numbersSaid(m.text);
  const says = (p: number, qty: number) => said.some((n) => Math.abs(n - p) < 0.01 || Math.abs(n - p * qty) < 0.01);
  const kept: AiReply = {
    ...r,
    lines: r.lines
      .filter((l) => l.n >= 1 && l.n <= lines.length)
      .map((l) => ({ ...l, offers: l.offers.filter((of) => of.na || (of.price >= 1 && says(of.price, lines[l.n - 1].qty || 1))) }))
      .filter((l) => l.offers.length),
  };
  return kept.lines.length ? { ...fromAi(kept), ai: true } : undefined;
}

/** The AI's lines as the rules give theirs. */
function fromAi(r: AiReply): ParsedReply {
  const vat = r.vat === 'incl' ? 'gross' : r.vat === 'excl' ? 'net' : 'unsaid';
  return {
    lines: r.lines.map((l) => ({
      index: l.n - 1,
      offers: l.offers.map((o) => ({
        kind: o.kind || 'aftermarket',
        kindSaid: !!o.kind,
        unitFils: o.na ? undefined : Math.round(o.price * 100),
        vat,
        brand: o.brand || undefined,
        na: o.na || undefined,
      })),
    })),
    unmatched: [],
  };
}

/**
 * The words of a supplier's answer that has none of its own (audit 27/11): a voice message (≤ 3 min) heard, a picture or a
 * PDF quotation (≤ 4 MB) whose caption gives no price — written down by the AI (its caption first). Else nothing: the
 * AI is asked only about such a message, once (`PartAsk.replies`).
 */
async function heardOf(raw: WaMessage): Promise<string | undefined> {
  const kind = kindOf(raw.type);
  const own = (raw.text ?? '').trim();
  if (!own && (kind === 'voice' || kind === 'audio') && (raw.file?.sec ?? 0) <= 180) {
    const h = await aiVoiceText(raw.id);
    return h ? (h.english || h.text).trim() || undefined : undefined;
  }
  const pdf = kind === 'file' && /pdf/i.test(raw.file?.mime ?? '') && (raw.file?.size ?? 0) <= 4_000_000;
  if ((kind === 'photo' || pdf) && !/\d/.test(own)) {
    const seen = await aiPictureText(raw.id);
    return seen ? [own, seen].filter(Boolean).join('\n') : undefined;
  }
  return undefined;
}

/**
 * One message of a supplier put on the request it answers: its prices as offers, its words kept with the request.
 * v1.04: a newer answer of the supplier for a line replaces his earlier offer of the same kind («ALL PRICES NOT SAME» and
 * the list again), and a cost (and the customer's price) the answers put follows it while nobody has changed it.
 */
async function applyReply(orderId: string, askId: string, m: { id: string; t: number; text: string }, parsed: ParsedReply & { ai?: true }, settings: Awaited<ReturnType<typeof getSettings>>, s: ReturnType<typeof waAutoOf>): Promise<number> {
  const order = await db.orders.get(orderId);
  const ask = order?.asks?.find((a) => a.id === askId);
  if (!order || !ask || ask.replies?.some((r) => r.id === m.id)) return 0;
  const items = (await db.items.bulkGet(ask.items)).filter((i): i is OrderItem => !!i);
  const ai = !!parsed.ai;
  const kind = parsed.lines.length ? undefined : kindOnly(m.text);
  // When each earlier answer on this job was said (an offer older than this message may be replaced by it).
  const said = new Map((order.asks ?? []).flatMap((a) => (a.replies ?? []).map((r) => [r.id, Date.parse(r.at)] as const)));
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
      const fresh = line.offers.map((o, k) => offerOf(o, { msg: m.id, supplierId: ask.supplierId, n: `wa:${short}:${n}:${k}`, vat: s.ask.vat, vatBp: item.vatRateBp || settings.vatRateBp, ai }));
      const older = (o: PartOffer) => o.supplierId === ask.supplierId && !!o.msg && o.msg !== m.id && (said.get(o.msg) ?? 0) <= m.t && fresh.some((f) => f.kind === o.kind);
      offers = offers.filter((o) => o.msg !== m.id && !older(o));
      offers.push(...fresh);
      if (line.offers.some((o) => !o.na && !o.pending)) priced++;
    }
    if (JSON.stringify(offers) === before) continue;
    const patch: Partial<OrderItem> = { offers };
    // As set: the line's cost (and its supplier) from the best offer — on a line without a cost yet, or whose cost the
    // answers put and nobody changed since (v1.04); not bought yet.
    const best = bestOffer(offers, s.ask.prefer);
    const byAnswers = !!item.costBy && item.costPriceFils === item.costBy.fils;
    const free = (item.costPriceFils === undefined || byAnswers) && (!item.procurementStatus || item.procurementStatus === 'needed') && !item.customerSupplied;
    // v0.98: a job of a request (its autopilot) takes the customer's price too — the quote is to be ready by itself.
    const prices = order.fromChat ? 'price' : s.ask.prices;
    if (best && best.costFils !== undefined && free && (prices === 'cost' || prices === 'price') && (best.costFils !== item.costPriceFils || best.id !== item.costBy?.offer)) {
      patch.costPriceFils = best.costFils;
      patch.supplierId = best.supplierId;
      // Put by the AI's reading: said so on the line (v0.86).
      patch.costAi = best.ai ? true : undefined;
      const by: NonNullable<OrderItem['costBy']> = { offer: best.id, fils: best.costFils };
      // …and the customer's price by the garage's markup — a draft line without a price, or with the one the answers put.
      const priceByAnswers = item.costBy?.price !== undefined && item.unitPriceFils === item.costBy.price;
      if (prices === 'price' && item.approvalState === 'draft' && (!item.unitPriceFils || priceByAnswers)) {
        const rate = item.vatRateBp || settings.vatRateBp;
        const mode = vatModeOf(item, settings.pricesIncludeVat);
        const net = withMarkup(best.costFils, settings.defaultMarkupBp);
        Object.assign(patch, priceFromEntered(enteredPrice({ unitPriceFils: net }, rate, mode), rate, mode));
        by.price = patch.unitPriceFils;
      }
      patch.costBy = by;
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
