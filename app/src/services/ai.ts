import { db } from '../db/db';
import { type AiName, type AiVin, nameFix, vinFill } from '../domain/ai';
import { nowIso } from '../domain/dates';
import { itemTitle, lineName } from '../domain/items';
import { matchPartName } from '../domain/partsVocab';
import type { OrderItem, Vehicle } from '../domain/types';
import { isVin } from '../domain/vin';
import { callJson } from './sync/api';
import { syncConfig } from './sync/config';
import { syncLabourNames } from './labourName';

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

export type AiPath = 'vin' | 'part-name' | 'receipt';
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
  | { kind: 'car'; vehicleId: string; filled: CarFill; undo: () => Promise<void> }
  | { kind: 'name'; itemId: string; from: string; to: string; undo: () => Promise<void> }
  /** A supplier's receipt read and recorded as an expense (v0.50, services/receipts.ts). */
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
    if (!aiOn()) return undefined;
    const v = await db.vehicles.get(vehicleId);
    const vin = v?.vin?.toUpperCase();
    if (!v || !vin || !isVin(vin) || v.vinAi?.vin === vin) return undefined;
    if (v.make?.trim() && v.model?.trim() && v.year && v.engine?.trim() && v.type) {
      await db.vehicles.update(vehicleId, { vinAi: { vin, at: nowIso(), filled: [] } });
      return {};
    }
    const ai = await askAi<AiVin>('vin', { vin }, `car:${vehicleId}`);
    // Read again: something may have been typed in the card while the AI was asked.
    const now = await db.vehicles.get(vehicleId);
    if (!now || now.vin?.toUpperCase() !== vin) return undefined;
    const fill = vinFill(now, vin, ai);
    const keys = Object.keys(fill) as (keyof CarFill)[];
    const before: CarFill = Object.fromEntries(keys.map((k) => [k, now[k]]));
    await db.vehicles.update(vehicleId, { ...fill, vinAi: { vin, at: nowIso(), filled: keys } });
    if (keys.length)
      notify({
        kind: 'car',
        vehicleId,
        filled: fill,
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

/** Asked about a VIN put in the card — not waited for. */
export function aiReadVinLater(vehicleId: string) {
  if (aiOn()) void aiReadVin(vehicleId);
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
    if (!item || item.kind !== 'part' || item.approvalState !== 'draft' || !typed || item.aiName?.from === typed || item.aiName?.to === typed) return false;
    const russian = !!item.titleRu;
    const was = lineName(typed.trim());
    let fix: { title?: string; english?: string } | undefined;
    // 1. The dictionary: every word known — put right and named in English without asking anyone.
    const m = matchPartName(typed);
    if (m.known) {
      fix = {};
      if (m.changed && m.fixed !== was) fix.title = m.fixed;
      if (russian && !item.titleEn && m.english) fix.english = m.english;
    }
    // 2. A line typed exactly the same before, already looked at: its answer again.
    if (!fix) {
      const memo = await db.items.filter((i) => i.id !== itemId && i.kind === 'part' && i.aiName?.from === typed).first();
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
    }
    const now = await db.items.get(itemId);
    if (!now || now.approvalState !== 'draft' || (now.titleRu || now.titleEn) !== typed) return false;
    const patch: Partial<OrderItem> = { aiName: { from: typed, to: fix.title ?? typed, at: nowIso() } };
    if (fix.title) patch[russian ? 'titleRu' : 'titleEn'] = fix.title;
    if (fix.english) patch.titleEn = fix.english;
    await db.items.update(itemId, patch);
    // The part's name put right — the labour charge says it so (v0.80).
    if (fix.title || fix.english) await syncLabourNames(now.orderId);
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
  void aiFixPartName(itemId);
}
