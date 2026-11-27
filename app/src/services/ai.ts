import { db } from '../db/db';
import { aiKindOf, type AiName, type AiVin, nameFix, vinFill } from '../domain/ai';
import { nowIso } from '../domain/dates';
import { itemTitle, lineName } from '../domain/items';
import { matchPartName } from '../domain/partsVocab';
import type { OrderItem, Vehicle } from '../domain/types';
import { isVin, makeMatches } from '../domain/vin';
import { canonicalMake, canonicalModel } from '../domain/carCatalog';
import { photoSays, type VinSaid } from '../domain/carPhoto';
import { checkCarByVin } from './carPhoto';
import { stemCar, vinStem } from '../domain/vinDecode';
import { callJson } from './sync/api';
import { syncConfig } from './sync/config';
import { syncLabourNames } from './labourName';
import { ensureLabourLine } from './estimate';
import { liveLines } from '../domain/flow';
import { namedByParts, partNames, partsKey } from '../domain/labourName';

/*
 * The garage's AI on this device (v0.48): questions go to the garage's server (server/src/ai.mjs — Gemini with the key
 * kept on the garage's computer, never here), what of the answer is taken is decided by domain/ai.ts. It works by
 * itself and quietly: no server, no key, no network — nothing happens and nothing is said; what it did is said once
 * (AiNotices: a toast with «Отменить»).
 *
 * v0.49 (the user: «чтобы большую часть задач приложение само делало без ИИ»): the app answers first, the AI last —
 * a part's name by the dictionary (domain/partsVocab.ts) and by lines typed the same before; a VIN — not asked about
 * when the card is full.
 *
 * What it does now: a VIN read into the car's card, a part's name put right, a supplier's receipt read
 * (services/receipts.ts). The search for a part's number, diagram and photos in the catalogues (v0.48–v0.84) is gone
 * (v0.85, the owner: «Убери поиск каталогов полностью, направим ИИ на более нужные и с меньшим расходом. Оставь
 * определения VIN.»): not to come back without his word.
 */

export type AiPath = 'vin' | 'part-name' | 'receipt' | 'labour' | 'reply' | 'roles' | 'car' | 'request' | 'translate' | 'voice' | 'picture' | 'payment' | 'lines';
type Transport = (path: AiPath, body: unknown) => Promise<unknown>;
let transport: Transport | undefined;
/** The server's part played by a test (and by the browser scenario). */
export function setAiTransport(t: Transport | undefined) {
  transport = t;
}

/** A device paired with the garage's server asks it (the server says «ai off» without a key — quietly nothing). */
export const aiOn = (): boolean => !!transport || !!syncConfig();

/** What the AI is working on now — `car:<vehicleId>`, `name:<itemId>`: the app shows it at work. */
const working = new Set<string>();
const workListeners = new Set<() => void>();
let workVersion = 0;
const workChanged = () => {
  workVersion++;
  workListeners.forEach((f) => f());
};
export const aiWorking = (key: string): boolean => working.has(key);
export const aiWorkVersion = (): number => workVersion;
export function subscribeAiWork(fn: () => void): () => void {
  workListeners.add(fn);
  return () => void workListeners.delete(fn);
}

/** One question to the garage's server (the receipts' service asks too). */
export async function askAi<T>(path: AiPath, body: unknown, key: string, timeout = 110_000): Promise<T> {
  working.add(key);
  workChanged();
  try {
    if (transport) return (await transport(path, body)) as T;
    const cfg = syncConfig();
    if (!cfg) throw new Error('no server');
    return await callJson<T>(cfg, `/api/ai/${path}`, { method: 'POST', body, timeout });
  } finally {
    working.delete(key);
    workChanged();
  }
}

/** How the garage's AI stands (Настройки → Данные → Сервер): on the server, or not. */
export async function aiStatus(): Promise<{ on: boolean }> {
  const cfg = syncConfig();
  if (!cfg) return { on: false };
  try {
    return await callJson<{ on: boolean }>(cfg, '/api/ai/status', { timeout: 15_000 });
  } catch {
    return { on: false };
  }
}

/** A part number looked up on Yandex (the globe by «Номер» in a part's sheet). */
export const yandexUrl = (number: string): string => `https://yandex.ru/search/?text=${encodeURIComponent(number.trim())}`;

export type CarFill = Partial<Pick<Vehicle, 'make' | 'model' | 'year' | 'engine' | 'type'>>;
export type AiNotice =
  /** `from: 'garage'` (v0.88): said by the garage's own car of the same VIN, not by the AI; `'photo'` (v0.89): seen on its photo by the AI. */
  | { kind: 'car'; vehicleId: string; filled: CarFill; from?: 'garage' | 'photo'; undo: () => Promise<void> }
  | { kind: 'name'; itemId: string; from: string; to: string; undo: () => Promise<void> }
  /** A supplier's receipt read and recorded as an expense (v0.50, services/receipts.ts). */
  /** A customer's request in WhatsApp made a job of «Заявки» (v0.90, services/waRequest.ts). */
  | { kind: 'request'; orderId: string; number: number; car: string; undo: () => Promise<void> }
  | { kind: 'expense'; expenseId: string; amountFils: number; vendor?: string; date: string; dateSure: boolean; job?: { number: number; car: string }; supplier?: { name: string; added: boolean }; items: number; close: boolean; undo: () => Promise<void> };

const listeners = new Set<(n: AiNotice) => void>();
/** What the AI did by itself (the app's notices show it, with «Отменить»). */
export function onAiNotice(fn: (n: AiNotice) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const notify = (n: AiNotice) => listeners.forEach((f) => f(n));
/** Said by another service of the AI's (the receipts'). */
export const notifyAi = notify;

/** One question at a time about one car or one line. */
const asking = new Set<string>();
async function once<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (asking.has(key)) return undefined;
  asking.add(key);
  try {
    return await fn();
  } catch {
    // The AI is a help: offline, no key, a busy model — the card and the line stay as typed.
    return undefined;
  } finally {
    asking.delete(key);
  }
}

/**
 * The car's VIN read once a VIN: what is empty in its card — make, model, year, engine, body — filled with what agrees
 * with the VIN (domain/ai.ts `vinFill`). Asked when a VIN is put in the card (typed, read off a photo, kept on the
 * «Проверка VIN» sheet); not asked at all when the card has everything already (v0.49). The server answers from the
 * official decoder alone when it can, Gemini only for the rest.
 */
export function aiReadVin(vehicleId: string): Promise<CarFill | undefined> {
  return once(`car:${vehicleId}`, async () => {
    const v = await db.vehicles.get(vehicleId);
    const vin = v?.vin?.toUpperCase();
    if (!v || !vin || !isVin(vin) || v.vinAi?.vin === vin) return undefined;
    // The garage's own cars of this VIN's maker and model code first (v0.88): what a person wrote on them — with or without
    // the AI, and over it.
    const known = await garageCarOf(vin, vehicleId);
    // The card's make and model are the photo's guess (v0.89): the VIN's model is wanted to hold it against — asked even
    // when the card is full, unless the garage's own cars of this VIN say it.
    const verify = photoSays(v) && !known?.model;
    if (whole({ ...v, ...emptyOf(v, known) }) && !verify) {
      if (!known || whole(v)) {
        const said = saidOf(known);
        await db.vehicles.update(vehicleId, { vinAi: { vin, at: nowIso(), filled: [], ...said } });
        await checkCarByVin(vehicleId, vin, said);
        return {};
      }
    }
    let ai: AiVin | undefined;
    if (aiOn() && (!whole({ ...v, ...emptyOf(v, known) }) || verify)) {
      try {
        ai = await askAi<AiVin>('vin', { vin }, `car:${vehicleId}`);
      } catch {
        // offline, no key: the garage's own word stands, the AI is asked the next time
      }
    }
    if (!ai && !known) {
      // Its maker alone (its first characters) is enough to tell the photo's make was another.
      await checkCarByVin(vehicleId, vin, {});
      return undefined;
    }
    // Read again: something may have been typed in the card while the AI was asked.
    const now = await db.vehicles.get(vehicleId);
    if (!now || now.vin?.toUpperCase() !== vin) return undefined;
    const own = emptyOf(now, known);
    const fromAi = ai ? vinFill({ ...now, ...own }, vin, ai) : {};
    const fill: CarFill = { ...own, ...fromAi };
    const keys = Object.keys(fill) as (keyof CarFill)[];
    const byAi = Object.keys(fromAi) as (keyof CarFill)[];
    const before: CarFill = Object.fromEntries(keys.map((k) => [k, now[k]]));
    // Marked read once the AI answered (or had nothing to add): the garage's own word alone leaves it to be asked later.
    const done = !!ai || whole({ ...now, ...fill });
    // What the VIN says the car is (v0.89): the garage's own cars first, the AI when it is sure and its maker is the VIN's.
    const said = saidOf(known, ai, vin);
    await db.vehicles.update(vehicleId, { ...fill, ...(done ? { vinAi: { vin, at: nowIso(), filled: byAi, ...said } } : {}) });
    await checkCarByVin(vehicleId, vin, said);
    if (keys.length)
      notify({
        kind: 'car',
        vehicleId,
        filled: fill,
        // The garage's own car said it all (no AI's word in it).
        ...(byAi.length ? {} : { from: 'garage' as const }),
        // Only what is still as the AI wrote it goes back (a field changed since stays).
        undo: async () => {
          const cur = await db.vehicles.get(vehicleId);
          if (!cur) return;
          const back: Partial<Vehicle> = {};
          for (const k of keys) if (cur[k] === fill[k]) (back as Record<string, unknown>)[k] = before[k];
          await db.vehicles.update(vehicleId, back);
        },
      });
    return fill;
  });
}

/** Asked about a VIN put in the card — not waited for (the garage's own cars answer without the AI too, v0.88). */
export function aiReadVinLater(vehicleId: string) {
  void aiReadVin(vehicleId);
}

/** What the VIN says the car is (v0.89): the garage's own cars of it, else the AI when sure of it and its maker is the VIN's. */
function saidOf(known: ReturnType<typeof stemCar>, ai?: AiVin, vin = ''): VinSaid {
  if (known) return { make: known.make, model: known.model };
  if (!ai?.make?.trim() || (ai.confidence ?? 0) < 0.6 || makeMatches(vin, ai.make) === false) return {};
  return { make: canonicalMake(ai.make.trim()), ...(ai.model?.trim() ? { model: canonicalModel(ai.make.trim(), ai.model.trim()) } : {}) };
}

/** The card has all a VIN can fill. */
const whole = (c: Partial<CarFill>): boolean => !!(c.make?.trim() && c.model?.trim() && c.year && c.engine?.trim() && c.type);

/** What the garage itself knows of this VIN (v0.88, domain/vinDecode.ts `stemCar`): its other cars of the same stem. */
async function garageCarOf(vin: string, selfId: string): Promise<ReturnType<typeof stemCar>> {
  const stem = vinStem(vin);
  if (!stem) return undefined;
  return stemCar(vin, await db.vehicles.where('vin').startsWith(stem).toArray(), selfId);
}

/** The garage's word, into what is empty — not over a make typed as another (the car is not that one, or the make is wrong). */
function emptyOf(car: Partial<CarFill>, known: ReturnType<typeof stemCar>): CarFill {
  if (!known) return {};
  const make = car.make?.trim();
  if (make && make.toLowerCase().replace(/[^a-z0-9]/g, '') !== known.make.toLowerCase().replace(/[^a-z0-9]/g, '')) return {};
  const out: CarFill = {};
  if (!make) out.make = known.make;
  if (!car.model?.trim()) out.model = known.model;
  if (known.engine && !car.engine?.trim()) out.engine = known.engine;
  if (known.type && !car.type) out.type = known.type as CarFill['type'];
  return out;
}

async function carOf(item: OrderItem): Promise<Vehicle | undefined> {
  const order = await db.orders.get(item.orderId);
  return order ? db.vehicles.get(order.vehicleId) : undefined;
}

/**
 * A part's name as typed, looked at once: typing mistakes put right, and its English name for the documents when it
 * was typed in Russian (domain/ai.ts `nameFix`). The dictionary first (domain/partsVocab.ts), then a line typed the
 * same before, the AI last (v0.49). Only a draft line (a quote sent keeps its words).
 */
export function aiFixPartName(itemId: string, { quiet = false }: { quiet?: boolean } = {}): Promise<boolean | undefined> {
  return once(`name:${itemId}`, async () => {
    const item = await db.items.get(itemId);
    const typed = item?.titleRu || item?.titleEn || '';
    // Every line (v0.86, the owner: «автоисправление названий позиций и деталей»): a part, work, a service — not a discount,
    // not the labour charge named by the parts.
    if (!item || item.kind === 'discount' || namedByParts(item) || item.approvalState !== 'draft' || !typed || item.aiName?.from === typed || item.aiName?.to === typed) return false;
    const russian = !!item.titleRu;
    const was = lineName(typed.trim());
    let fix: { title?: string; english?: string } | undefined;
    // v0.91.7: a kind the app only guessed (one «Добавить» for every kind) — the AI is asked whatever the dictionary knows.
    let kind: 'part' | 'labor' | undefined;
    // 1. The dictionary: every word known — put right and named in English without asking anyone.
    const m = matchPartName(typed);
    if (m.known && !item.autoKind) {
      fix = {};
      if (m.changed && m.fixed !== was) fix.title = m.fixed;
      if (russian && !item.titleEn && m.english) fix.english = m.english;
    }
    // 2. A line typed exactly the same before, already looked at: its answer again.
    if (!fix) {
      const memo = await db.items.filter((i) => i.id !== itemId && i.kind !== 'discount' && i.aiName?.from === typed).first();
      if (memo?.aiName) {
        fix = {};
        if (memo.aiName.to && memo.aiName.to !== was) fix.title = memo.aiName.to;
        if (russian && !item.titleEn && memo.titleEn && memo.titleEn !== memo.titleRu) fix.english = memo.titleEn;
      }
    }
    // 3. The AI.
    if (!fix) {
      if (!aiOn()) return false;
      const car = await carOf(item);
      const r = await askAi<AiName>('part-name', { name: typed, make: car?.make ?? '', model: car?.model ?? '', year: car?.year ?? '' }, `name:${itemId}`);
      fix = nameFix(typed, r, !!item.titleEn);
      kind = aiKindOf(r);
    }
    const now = await db.items.get(itemId);
    if (!now || now.approvalState !== 'draft' || (now.titleRu || now.titleEn) !== typed) return false;
    const patch: Partial<OrderItem> = { aiName: { from: typed, to: fix.title ?? typed, at: nowIso() } };
    // The kind put right (a guess of the app; not changed since): a part or work; the guess's mark goes either way.
    if (now.autoKind) {
      patch.autoKind = undefined;
      if (kind && kind !== now.kind) patch.kind = kind;
    }
    if (fix.title) patch[russian ? 'titleRu' : 'titleEn'] = fix.title;
    if (fix.english) patch.titleEn = fix.english;
    await db.items.update(itemId, patch);
    // The part's name put right — the labour charge says it so (v0.80). A part that is work after all (v0.91.7) — the
    // labour line follows the parts (it comes with the first part, a line of its own without any goes).
    if (patch.kind === 'part') await ensureLabourLine(now.orderId);
    if (fix.title || fix.english || patch.kind) await syncLabourNames(now.orderId);
    if ((fix.title || fix.english) && !quiet) {
      const before = { titleRu: now.titleRu, titleEn: now.titleEn };
      // Said as the line now shows it: in the job's documents' language (an English name, once there is one).
      const lang = (await db.orders.get(now.orderId))?.docLanguage ?? 'en';
      notify({
        kind: 'name',
        itemId,
        from: itemTitle(now, lang),
        to: itemTitle({ ...now, ...patch }, lang),
        undo: async () => {
          const cur = await db.items.get(itemId);
          if (!cur || cur.approvalState !== 'draft') return;
          // The name as typed comes back — and is not asked about again.
          await db.items.update(itemId, { titleRu: before.titleRu, titleEn: before.titleEn, aiName: { from: typed, to: typed, at: nowIso() } });
          await syncLabourNames(cur.orderId);
        },
      });
    }
    return !!(fix.title || fix.english);
  });
}

/**
 * A part line saved: its name looked at — not waited for (v0.53: nothing else is looked up by itself; v0.85: and
 * nothing else at all — the search for its number is gone).
 */
export function aiAfterPart(itemId: string) {
  aiAfterLine(itemId);
}

/**
 * A line saved (v0.86): its name looked at, then the job's labour charge said by its parts — one after the other, not
 * waited for.
 */
export function aiAfterLine(itemId: string) {
  void (async () => {
    await aiFixPartName(itemId);
    const item = await db.items.get(itemId);
    if (item) await aiLabourName(item.orderId);
  })();
}

/**
 * The labour charge said by the AI (v0.86, the owner: «использовать ИИ для описания труда исходя из деталей и позиций»):
 * «LABOR CHARGE: REPLACE FRONT BRAKE PADS & DISCS» for the job's parts and its other work — a light model, kept on the
 * server for the same parts (no tokens the second time). Only a draft named by the parts (not typed by hand, not told
 * to the customer); the parts changed meanwhile — not put (the rules name it by the parts until it is said anew).
 */
export function aiLabourName(orderId: string): Promise<boolean | undefined> {
  return once(`labour:${orderId}`, async () => {
    if (!aiOn()) return false;
    const items = await db.items.where('orderId').equals(orderId).toArray();
    const charges = items.filter(namedByParts);
    const parts = partNames(items, 'en');
    if (!charges.length || !parts.length) return false;
    const key = partsKey(items);
    if (charges.every((c) => c.labourAi?.parts === key)) return false;
    const work = liveLines(items)
      .filter((i) => i.kind !== 'part' && i.kind !== 'discount' && !namedByParts(i))
      .map((i) => lineName((i.titleEn || i.titleRu || '').trim()))
      .filter(Boolean);
    const r = await askAi<{ text: string }>('labour', { parts, work }, `labour:${orderId}`);
    const text = lineName(String(r?.text ?? '').trim()).slice(0, 80);
    if (!text) return false;
    const now = await db.items.where('orderId').equals(orderId).toArray();
    if (partsKey(now) !== key) return false;
    for (const c of now.filter(namedByParts)) await db.items.update(c.id, { labourAi: { parts: key, text } });
    await syncLabourNames(orderId);
    return true;
  });
}

/** What the AI read in a supplier's answer (v0.86): the request it answers, each line's prices. */
export interface AiReply {
  ask: string;
  lines: { n: number; offers: { price: number; kind: '' | 'oem' | 'aftermarket' | 'used'; brand: string; na: boolean }[] }[];
  vat: '' | 'incl' | 'excl';
}

/** A supplier's answer the rules found no price in, read by the AI (light model; none — undefined). */
/**
 * Audit 27/11: a chat message in the manager's language — asked by a tap, kept nowhere (the chat's words never are).
 */
export async function aiTranslate(text: string, to: 'ru' | 'en'): Promise<{ text: string; from: string } | undefined> {
  if (!aiOn() || !text.trim()) return undefined;
  try {
    return await askAi<{ text: string; from: string }>('translate', { text, to }, `translate:${text.slice(0, 40)}`, 30_000);
  } catch {
    return undefined;
  }
}

/**
 * Audit 27/11: a voice message written down — the server takes its sound from WhatsApp on the garage's PC itself (the
 * phone sends only the message's id); kept nowhere.
 */
export async function aiVoiceText(id: string): Promise<{ text: string; english: string; from: string } | undefined> {
  if (!aiOn() || !id) return undefined;
  try {
    return await askAi<{ text: string; english: string; from: string }>('voice', { id }, `voice:${id}`, 90_000);
  } catch {
    return undefined;
  }
}

/**
 * Audit 27/11: a supplier's prices in a picture or a PDF from the chat (a price list, a screenshot of their system, a
 * quotation) — written down by the garage's AI as lines, read then by the app's own rules (`parseReply`). Not kept.
 */
export async function aiPictureText(id: string): Promise<string | undefined> {
  if (!aiOn() || !id) return undefined;
  try {
    return (await askAi<{ text: string }>('picture', { id }, `picture:${id}`, 60_000)).text?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** What a customer's payment proof says (audit 27/11): only what is printed on it; the app checks it against what is due. */
export interface AiPaymentShot {
  isPayment: boolean;
  amount: number;
  currency: string;
  date?: string;
  reference?: string;
  bank?: string;
  /** «card» — a card slip; else a transfer. */
  way?: string;
  confidence: number;
}
export async function aiPaymentShot(id: string): Promise<AiPaymentShot | undefined> {
  if (!aiOn() || !id) return undefined;
  try {
    return await askAi<AiPaymentShot>('payment', { id }, `payment:${id}`, 60_000);
  } catch {
    return undefined;
  }
}

/** A line said aloud (audit 27/11): the name in English, the number, the kind, the sale price in AED only when said. */
export interface SaidLine {
  name: string;
  qty: number;
  kind: 'part' | 'labor' | 'service';
  price: number;
}
/**
 * The job's lines dictated in «Добавить позицию» (audit 27/11: «механик диктует — я быстро заполняю список»): the
 * recording to the garage's AI once, the lines it heard back. The app names and prices them by its own rules after
 * (services: the sheet's `add`). Not kept anywhere. No server, no key — nothing (undefined).
 */
export async function aiVoiceLines(voice: Blob): Promise<{ text: string; lines: SaidLine[] } | undefined> {
  if (!aiOn()) return undefined;
  const bytes = new Uint8Array(await voice.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return askAi<{ text: string; lines: SaidLine[] }>('lines', { audio: { type: voice.type || 'audio/webm', data: btoa(s) } }, 'lines', 90_000);
}

export async function aiReadReply(text: string, quote: string, asks: { id: string; car: string; lines: string[] }[]): Promise<AiReply | undefined> {
  if (!aiOn() || !asks.length) return undefined;
  try {
    return await askAi<AiReply>('reply', { text, quote, asks }, `reply:${asks[0].id}`, 40_000);
  } catch {
    return undefined;
  }
}

/**
 * Who these chats are to the garage, as the AI says by their names and words (v0.86); v0.91 — a supplier's makes too
 * (`makes` — a server from before v0.91 does not say them). `known` — what the garage knows the chat to be already.
 */
export interface AiChatRole {
  id: string;
  role: 'customer' | 'supplier' | 'other';
  makes?: string[];
  confidence: number;
}
export async function aiChatRoles(chats: { id: string; name: string; texts: string[]; known?: 'customer' | 'supplier' }[]): Promise<AiChatRole[]> {
  if (!aiOn() || !chats.length) return [];
  try {
    return (await askAi<{ chats: AiChatRole[] }>('roles', { chats }, 'roles', 40_000)).chats ?? [];
  } catch {
    return [];
  }
}
