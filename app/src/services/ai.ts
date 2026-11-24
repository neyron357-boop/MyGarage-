import { db, uid } from '../db/db';
import { type AiFind, type AiName, type AiVin, boughtBySpec, carKnown, type FoundNumber, nameFix, vinFill } from '../domain/ai';
import { carFacts, fitmentsOf, verifiedOnly } from '../domain/fitment';
import { nowIso } from '../domain/dates';
import { itemTitle, lineName } from '../domain/items';
import { formatNumber, sameNumber } from '../domain/partNumbers';
import { garageUses, partsMemory, type Memory, type PriorPart } from '../domain/partsMemory';
import { matchPartName } from '../domain/partsVocab';
import type { Order, OrderItem, Vehicle } from '../domain/types';
import { isVin, vinBuilt } from '../domain/vin';
import { addWebPictures, deleteMedia, mediaBlob } from './media';
import { callJson, SyncError } from './sync/api';
import { syncConfig } from './sync/config';
import { syncLabourNames } from './labourName';

/*
 * The garage's AI on this device (v0.48): questions go to the garage's server (server/src/ai.mjs — Gemini with the key
 * kept on the garage's computer, never here), what of the answer is taken is decided by domain/ai.ts. It works by
 * itself and quietly: no server, no key, no network — nothing happens and nothing is said; what it did is said once
 * (AiNotices: a toast with «Отменить»).
 *
 * v0.49 (the user: «чтобы большую часть задач приложение само делало без ИИ»): the app answers first, the AI last —
 * a part's name by the dictionary (domain/partsVocab.ts) and by lines typed the same before; a part's number by the
 * garage's own jobs (domain/partsMemory.ts: fitted before on this car — written at once; a web search made lately for
 * the same part — served again); a VIN — not asked about when the card is full. Only what the app cannot answer goes
 * to the server, and with what the garage knows (its own numbers as hints, where the VIN says the car was built).
 */

export type AiPath = 'vin' | 'part-name' | 'part-find' | 'receipt';
type Transport = (path: AiPath, body: unknown) => Promise<unknown>;
let transport: Transport | undefined;
/** The server's part played by a test (and by the browser scenario). */
export function setAiTransport(t: Transport | undefined) {
  transport = t;
}

/** A device paired with the garage's server asks it (the server says «ai off» without a key — quietly nothing). */
export const aiOn = (): boolean => !!transport || !!syncConfig();

/** What the AI is working on now — `car:<vehicleId>`, `name:<itemId>`, `find:<itemId>`: the app shows it at work. */
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

/*
 * How far a part's search has got (v0.64, the user: «показать загрузку поиска в процентах, чтобы следить за процессом
 * поиска и понимать, когда закончится — без трат токенов»): the garage's server counts it from the search's own steps
 * (`/api/ai/progress`, server/src/ai.mjs — no question to anyone), asked once a second for all the searches going on, in
 * one request; an older server, or none (a test's) — the time alone: a search takes some twenty seconds, its percent nears
 * 95 and never gets there. Only ever forward. By the work's key (`find:<itemId>`).
 */
interface Going {
  since: number;
  shown: number;
  /** The request's own mark the server knows it by (none — the time alone). */
  track?: string;
  /** The server counts it: the time no longer does. */
  counted?: boolean;
}
const going = new Map<string, Going>();
const progressListeners = new Set<() => void>();
let progressVersion = 0;
const progressChanged = () => {
  progressVersion++;
  progressListeners.forEach((f) => f());
};
/** How far the AI's search under this key has got, 0…99 — none while it is not searching. */
export const aiProgress = (key: string): number | undefined => going.get(key)?.shown;
export const aiProgressVersion = (): number => progressVersion;
export function subscribeAiProgress(fn: () => void): () => void {
  progressListeners.add(fn);
  return () => void progressListeners.delete(fn);
}
/** The time's guess: a part's search takes some 20 s (measured, v0.54–v0.55). */
const GUESS_MS = 20_000;
let ticker: ReturnType<typeof setInterval> | undefined;
let polling = false;
/** The server does not count (older than v0.64): the time alone, not asked again. */
let noCount = false;
function tick() {
  if (!going.size) {
    clearInterval(ticker);
    ticker = undefined;
    return;
  }
  const now = Date.now();
  for (const g of going.values()) if (!g.counted) g.shown = Math.max(g.shown, Math.floor(95 * (1 - Math.exp(-(now - g.since) / GUESS_MS))));
  const marks = [...going.values()].flatMap((g) => (g.track ? [g.track] : []));
  const cfg = syncConfig();
  if (marks.length && cfg && !noCount && !polling) {
    polling = true;
    void callJson<Record<string, number | null>>(cfg, `/api/ai/progress?t=${marks.map(encodeURIComponent).join(',')}`, { timeout: 5000 })
      .then(
        (r) => {
          for (const g of going.values()) {
            const v = g.track ? r?.[g.track] : undefined;
            if (typeof v !== 'number') continue;
            g.counted = true;
            g.shown = Math.max(g.shown, Math.min(99, Math.floor(v)));
          }
          progressChanged();
        },
        (e) => {
          if (e instanceof SyncError && (e.status === 404 || e.status === 405)) noCount = true;
        },
      )
      .finally(() => (polling = false));
  }
  progressChanged();
}

/** One question to the garage's server (the receipts' service asks too). */
export async function askAi<T>(path: AiPath, body: unknown, key: string, timeout = 110_000): Promise<T> {
  working.add(key);
  workChanged();
  // A part's search: how far it has got, by the request's own mark (v0.64).
  const find = path === 'part-find';
  const track = find && !transport ? uid() : undefined;
  if (find) {
    going.set(key, { since: Date.now(), shown: 1, track });
    ticker ??= setInterval(tick, 1000);
    progressChanged();
  }
  try {
    if (transport) return (await transport(path, body)) as T;
    const cfg = syncConfig();
    if (!cfg) throw new Error('no server');
    // A part's number takes the server up to a minute and a half (the web, the pages, the pictures), and the phone's tunnel
    // cuts a request at about 100 s: asked again, the server hands over the same search, still going or done (v0.48.3).
    for (let attempt = 1; ; attempt++) {
      try {
        return await callJson<T>(cfg, `/api/ai/${path}`, { method: 'POST', body: track ? { ...(body as object), track } : body, timeout });
      } catch (e) {
        const status = e instanceof SyncError ? e.status : -1;
        if (path !== 'part-find' || attempt >= 3 || !(status === 0 || status >= 500)) throw e;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  } finally {
    if (find) {
      going.delete(key);
      progressChanged();
    }
    working.delete(key);
    workChanged();
  }
}

/** How the garage's AI stands (Настройки → Данные → Сервер): on, and whether it searches the catalogues on the web. */
export async function aiStatus(): Promise<{ on: boolean; search?: 'on' | 'off' | 'unknown' }> {
  const cfg = syncConfig();
  if (!cfg) return { on: false };
  try {
    return await callJson<{ on: boolean; search: 'on' | 'off' | 'unknown' }>(cfg, '/api/ai/status', { timeout: 15_000 });
  } catch {
    return { on: false };
  }
}

/** A part number looked up on Yandex (the button by the number). */
export const yandexUrl = (number: string): string => `https://yandex.ru/search/?text=${encodeURIComponent(number.trim())}`;

export type CarFill = Partial<Pick<Vehicle, 'make' | 'model' | 'year' | 'engine' | 'type'>>;
export type AiNotice =
  | { kind: 'car'; vehicleId: string; filled: CarFill; undo: () => Promise<void> }
  | { kind: 'name'; itemId: string; from: string; to: string; undo: () => Promise<void> }
  | { kind: 'number'; itemId: string; number: string; catalogs: number; garage: number; undo: () => Promise<void> }
  /** Every part of a job looked at at once (v0.52, `aiAllParts`): how many lines, names put right, numbers written, lines with pictures. */
  | { kind: 'parts'; orderId: string; lines: number; names: number; numbers: number; pictures: number; undo: () => Promise<void> }
  /** No car to look a part up for (v0.55): its make and model, or its VIN, are asked for — nothing was looked up. */
  | { kind: 'needCar' }
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

/** A picture the server sent (base64) as a file — by the browser's own decoder (v0.54: a JS loop over a few hundred KB a picture held the page up). */
async function blobOf(data: string, type: string): Promise<Blob> {
  const U8 = Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array };
  if (typeof U8.fromBase64 === 'function') return new Blob([U8.fromBase64(data) as BlobPart], { type });
  return (await fetch(`data:${type};base64,${data}`)).blob();
}

/*
 * The garage's own part lines with a number or a search (every job), as the memory reads them — read once and kept
 * half a minute (a job's lines are saved one after another); a line this device's search wrote is put into it in place
 * (v0.54: read whole again after every search, every part of a long list scanned every line of every job).
 */
let priorCache: { at: number; lines: PriorPart[] } | undefined;
const remembered = (i: OrderItem) => i.kind === 'part' && !!(i.partNumber?.trim() || i.aiFind?.numbers.length);
function priorLine(i: OrderItem, o: Order | undefined, v: Vehicle | undefined): PriorPart | undefined {
  if (!o || !v) return undefined;
  return {
    id: i.id,
    jobId: o.id,
    jobNo: o.number,
    at: i.createdAt,
    name: i.titleEn || i.titleRu || '',
    number: i.partNumber,
    fitted: i.done || i.procurementStatus === 'received' || i.procurementStatus === 'installed',
    vehicleId: o.vehicleId,
    installed: i.done || i.procurementStatus === 'installed',
    car: { make: v.make, model: v.model, year: v.year, engine: v.engine },
    web: i.aiFind?.search === 'web' && i.aiFind.numbers.length ? { at: i.aiFind.at, numbers: i.aiFind.numbers } : undefined,
    diagramIds: i.diagramIds,
    sampleIds: i.sampleIds,
  };
}
let priorRead: Promise<PriorPart[]> | undefined;
/** The garage's own part lines as the memory reads them (v0.65: the fitment's evidence of the garage's own jobs too). */
export async function priorParts(): Promise<PriorPart[]> {
  if (priorCache && Date.now() - priorCache.at < 30_000) return priorCache.lines;
  // Five parts asking at once read it once.
  priorRead ??= (async () => {
    const items = await db.items.filter(remembered).toArray();
    const orders = new Map((await db.orders.bulkGet([...new Set(items.map((i) => i.orderId))])).filter((o) => !!o).map((o) => [o!.id, o!]));
    const vehicles = new Map((await db.vehicles.bulkGet([...new Set([...orders.values()].map((o) => o.vehicleId))])).filter((v) => !!v).map((v) => [v!.id, v!]));
    const lines: PriorPart[] = [];
    for (const i of items) {
      const o = orders.get(i.orderId);
      const line = priorLine(i, o, o && vehicles.get(o.vehicleId));
      if (line) lines.push(line);
    }
    priorCache = { at: Date.now(), lines };
    return lines;
  })().finally(() => (priorRead = undefined));
  return priorRead;
}
/** The memory reads the lines again next time (a line of this device changed them). */
export function forgetPriorParts() {
  priorCache = undefined;
}
/** One line the search wrote, put into the memory in place (the rest of it stays as read). */
async function refreshPriorPart(itemId: string): Promise<void> {
  if (!priorCache) return;
  const i = await db.items.get(itemId);
  const o = i ? await db.orders.get(i.orderId) : undefined;
  const v = o ? await db.vehicles.get(o.vehicleId) : undefined;
  const line = i && remembered(i) ? priorLine(i, o, v) : undefined;
  if (!priorCache) return;
  priorCache = { at: priorCache.at, lines: [...priorCache.lines.filter((l) => l.id !== itemId), ...(line ? [line] : [])] };
}

/** The pictures of another line (the AI's diagram and samples) copied onto this one. */
async function copyPictures(from: PriorPart, itemId: string): Promise<{ diagrams: string[]; samples: string[] }> {
  const out = { diagrams: [] as string[], samples: [] as string[] };
  for (const [ids, list] of [
    [from.diagramIds ?? [], out.diagrams],
    [from.sampleIds ?? [], out.samples],
  ] as const) {
    for (const id of ids) {
      try {
        const m = await db.media.get(id);
        const blob = await mediaBlob(id);
        if (!m || !blob) continue;
        // With its thumbnail (v0.54: copied without one, the line's preview decoded the whole picture).
        list.push(...(await addWebPictures([{ ownerType: 'item', ownerId: itemId, slot: m.slot, file: blob, name: m.name }])).map((x) => x.id));
      } catch {
        // a picture that would not copy: the numbers still count
      }
    }
  }
  return out;
}

/** The line's pictures replaced by new ones (none new — the old stay). */
async function keepPictures(now: OrderItem, pics: { diagrams: string[]; samples: string[] }): Promise<Partial<OrderItem>> {
  const replaced = [...(pics.diagrams.length ? now.diagramIds ?? [] : []), ...(pics.samples.length ? now.sampleIds ?? [] : [])];
  for (const id of replaced) await deleteMedia(id).catch(() => undefined);
  return { ...(pics.diagrams.length ? { diagramIds: pics.diagrams } : {}), ...(pics.samples.length ? { sampleIds: pics.samples } : {}) };
}


/** The web's numbers and the garage's own put together: the garage's count on the web's numbers, its other numbers after them. */
function merged(web: FoundNumber[], mem: Memory, make: string): FoundNumber[] {
  const out: FoundNumber[] = web.map((n) => {
    const own = mem.numbers.find((m) => sameNumber(m.number, n.number));
    return { ...n, number: formatNumber(make, n.number), ...(own ? { garage: own.times } : {}) };
  });
  for (const m of mem.numbers) if (!out.some((n) => sameNumber(n.number, m.number))) out.push({ number: m.number, seen: [], garage: m.times });
  return out;
}

/**
 * The part's number for the line: the garage's own jobs first (domain/partsMemory.ts) — a number fitted before on this
 * car is written at once, a web search made lately for the same part serves again, both without the AI; else the AI
 * looks it up in the open catalogues (with the garage's own numbers as hints and where the VIN says the car was built):
 * the numbers found go on the line as candidates (a tap takes one), one seen in two catalogues — or in one and used by
 * the garage before — is written itself when the line has none (domain/ai.ts `provenNumber`); the part's diagram and
 * photos of the part are kept with the line (not sent to the customer). Once a line, unless asked again (`again` —
 * ↻ on the line); a guess made without the web is looked up again the next time the line is saved.
 *
 * v0.55 (the garage's server: the maker's open catalogue read by the number, a deeper search step by step): a line with
 * its own number sends it (`number`: the catalogue alone gives its diagram — no AI, no search); ↻ on a line already
 * looked up asks to dig deeper (`deep`); a car with no make and no VIN is not looked a part up for — «Укажите машину»;
 * the diagram comes with the part's place on it (`marks`), drawn into the picture kept.
 */
export function aiFindPart(
  itemId: string,
  { again = false, quiet = false, single = false, pictures = false }: { again?: boolean; quiet?: boolean; single?: boolean; pictures?: boolean } = {},
): Promise<AiFind | undefined> {
  return once(`find:${itemId}`, async () => {
    const item = await db.items.get(itemId);
    const part = item?.titleEn || item?.titleRu || '';
    const looked = item?.aiFind?.part === part && item.aiFind.search !== 'model';
    // `pictures` (every part of a job, v0.52): a line with its number but no pictures is looked up for them too.
    const hasPictures = !!(item?.diagramIds?.length || item?.sampleIds?.length);
    if (!item || item.kind !== 'part' || !part || (!again && (looked || (item.partNumber && !(pictures && !hasPictures))))) return undefined;
    const car = await carOf(item);
    const carKey = { make: car?.make ?? '', model: car?.model ?? '', year: car?.year, engine: car?.engine };
    // No car — no part of it to find (v0.55): said once, nothing asked.
    if (!carKnown(car)) {
      if (!quiet) notify({ kind: 'needCar' });
      return undefined;
    }
    const prior = (await priorParts()).filter((p) => p.id !== itemId);
    const mem = partsMemory(prior, carKey, part);
    const garage = garageUses(prior, carKey, car?.id, part);
    // `single` (v0.52) is what every number now is (v0.65): written only when it alone is verified.
    void single;
    const write = async (r: Pick<AiFind, 'search' | 'numbers' | 'note'>, pics: { diagrams: string[]; samples: string[] }) => {
      const now = await db.items.get(itemId);
      if (!now) return;
      // v0.65 (the user: «система должна предпочесть результат «Не удалось подтвердить», а не выдать ошибочный OEM-номер»):
      // a number goes on the line by itself only when it fits this very car by the fitment's rules (domain/fitment.ts) and
      // is the only one that does — found on pages, on the model's diagrams, by the AI: a candidate, a tap away.
      const fits = fitmentsOf({ part, car: carFacts(car), search: r.search, numbers: r.numbers, marking: now.fitment?.marking, garage, vinCheck: now.fitment?.vinCheck });
      const verified = verifiedOnly(fits);
      const fill = verified && !now.partNumber ? verified : undefined;
      // The AI's note (v0.64) kept with what it found: shown under the numbers (none — the app's own, domain/ai.ts `findNote`).
      const note = r.note?.trim() ? { note: r.note.trim().slice(0, 240) } : {};
      await db.items.update(itemId, { aiFind: { at: nowIso(), search: r.search, part, numbers: r.numbers, filled: fill, ...note }, ...(await keepPictures(now, pics)), ...(fill ? { partNumber: fill } : {}) });
      await refreshPriorPart(itemId);
      if (fill && !quiet) {
        const n = r.numbers.find((x) => sameNumber(x.number, fill));
        notify({
          kind: 'number',
          itemId,
          number: fill,
          catalogs: 0,
          garage: n?.garage ?? 0,
          undo: async () => {
            const cur = await db.items.get(itemId);
            if (cur?.partNumber === fill) await db.items.update(itemId, { partNumber: undefined });
          },
        });
      }
    };
    const askFor = { part, make: carKey.make, model: carKey.model, year: carKey.year ?? '', engine: carKey.engine ?? '', vin: car?.vin ?? '', built: car?.vin ? vinBuilt(car.vin) ?? '' : '' };
    /** The server's pictures kept with the line — all in one write (v0.54); a diagram with the part's place drawn on it (v0.55). */
    const keep = async (imgs: NonNullable<AiFind['images']>) => {
      const pics = { diagrams: [] as string[], samples: [] as string[] };
      const files = await Promise.all(imgs.map((img) => blobOf(img.data, img.type).catch(() => undefined)));
      const kept = await addWebPictures(
        imgs.flatMap((img, k) => (files[k] ? [{ ownerType: 'item' as const, ownerId: itemId, slot: img.kind === 'photo' ? 'sample' : 'diagram', file: files[k]!, name: img.source, marks: img.kind === 'photo' ? undefined : img.marks }] : [])),
      ).catch(() => []);
      // a picture that would not keep: the numbers still count
      for (const m of kept) (m.slot === 'sample' ? pics.samples : pics.diagrams).push(m.id);
      return pics;
    };
    /**
     * The pictures of a number the garage knows already (v0.55): copied from the line that had them — else its diagram
     * from the maker's catalogue, read by the server for nothing (`catalogOnly`: no AI, no search; no server — none).
     */
    const picturesOf = async (number: string, line: PriorPart) => {
      if (item.diagramIds?.length || item.sampleIds?.length) return { diagrams: [], samples: [] };
      const copied = await copyPictures(line, itemId);
      if (copied.diagrams.length || copied.samples.length || !aiOn()) return copied;
      try {
        const r = await askAi<AiFind>('part-find', { ...askFor, number, catalogOnly: true }, `find:${itemId}`, 30_000);
        return await keep(r.images ?? []);
      } catch {
        return copied;
      }
    };
    // 1. Fitted before on this car: the garage's number, no question.
    if (mem.proven && !again) {
      const numbers: FoundNumber[] = mem.numbers.map((n) => ({ number: n.number, seen: [], garage: n.times }));
      await write({ search: 'garage', numbers }, await picturesOf(mem.proven, mem.numbers[0].from));
      return { search: 'garage', numbers };
    }
    // 2. The web looked at lately for the same part on the same car: that answer again.
    if (mem.web?.web && !again) {
      const numbers = merged(mem.web.web.numbers, mem, carKey.make);
      await write({ search: 'web', numbers }, await picturesOf(numbers[0]?.number ?? '', mem.web));
      return { search: 'web', numbers };
    }
    // 3. The AI — or, without it, what the garage used before as candidates.
    if (!aiOn()) {
      if (mem.numbers.length) await write({ search: 'garage', numbers: mem.numbers.map((n) => ({ number: n.number, seen: [], garage: n.times })) }, { diagrams: [], samples: [] });
      return undefined;
    }
    const r = await askAi<AiFind>(
      'part-find',
      {
        ...askFor,
        hints: mem.numbers.slice(0, 3).map((n) => n.number),
        // The line's own number: the catalogue alone may answer (its name, its diagram).
        ...(item.partNumber?.trim() ? { number: item.partNumber.trim() } : {}),
        // ↻ on a line already looked up: dig deeper than what was found.
        ...(again && item.aiFind?.part === part && item.aiFind.search !== 'garage' ? { deep: true } : {}),
      },
      `find:${itemId}`,
    );
    // The pictures: the part's diagram first, then photos of the part (samples), each kept apart from the line's own photos.
    const pics = await keep(r.images ?? []);
    const numbers = merged(
      r.numbers.map((n) => ({
        number: n.number,
        brand: n.brand || undefined,
        note: n.note || undefined,
        seen: n.seen ?? [],
        ...(n.fits ? { fits: true } : {}),
        ...(n.name ? { name: n.name } : {}),
        ...(n.model ? { model: n.model } : {}),
        ...(n.replaces?.length ? { replaces: n.replaces } : {}),
        // What the server found out about it (v0.65): the fitment's evidence.
        ...(n.check ? { check: n.check } : {}),
      })),
      mem,
      carKey.make,
    );
    await write({ search: r.search, numbers, note: r.note }, pics);
    return { ...r, numbers };
  });
}

/** How far every part of a job has got (v0.52): lines done of all — and which (v0.64, for the percent). */
const allProgress = new Map<string, { done: number; total: number; ids: string[]; finished: Set<string> }>();
export const aiPartsProgress = (orderId: string): { done: number; total: number } | undefined => allProgress.get(orderId);

/**
 * Every part of a job, 0…100 (v0.64): a line done counts whole, a line being looked up — its search's own percent, one
 * waiting its turn — nothing yet.
 */
export function aiPartsPercent(orderId: string): number | undefined {
  const p = allProgress.get(orderId);
  if (!p) return undefined;
  let sum = 0;
  for (const id of p.ids) sum += p.finished.has(id) ? 100 : (aiProgress(`find:${id}`) ?? 0);
  return Math.min(99, Math.floor(sum / Math.max(1, p.ids.length)));
}

/** How many parts are looked up side by side (the garage's server and Gemini answer them together). */
const AT_ONCE = 6;

/** A few at a time (the server answers them side by side; a long list is done in minutes, not tens of them). */
async function inTurns<T>(list: T[], at: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(at, list.length) }, async () => {
      while (next < list.length) {
        const x = list[next++];
        await fn(x).catch(() => undefined);
      }
    }),
  );
}

/**
 * Every part of a job at once (v0.52, the user: «одна кнопка — ИИ исправляет все названия, потом ищет на всех схемы и
 * фото и загружает прямо в превью позиции детали; номера добавлять, если они точные, если вышли сразу несколько — не
 * добавлять»): each part's name put right first (the dictionary answers most of them without the AI), then its number,
 * diagram and photos looked up — the garage's own jobs first, the web after — five parts at a time; a number written only
 * when it is proven and the only one found; the pictures go on the line (its preview shows them). Each line shows the AI
 * at work; at the end one card says what was done (and the AI's sound) — «Отменить» brings the names and numbers back.
 */
export async function aiAllParts(
  orderId: string,
  { only }: { only?: string[] } = {},
): Promise<{ lines: number; names: number; numbers: number; pictures: number } | undefined> {
  const key = `all:${orderId}`;
  if (working.has(key)) return undefined;
  // `only` (v0.53, the user: «выбрать несколько деталей и запустить по ним поиск ИИ»): the parts picked on the job.
  const picked = only ? new Set(only) : undefined;
  const items = (await db.items.where('orderId').equals(orderId).toArray())
    .filter((i) => (!picked || picked.has(i.id)) && i.kind === 'part' && i.approvalState !== 'declined' && !i.customerSupplied && !!(i.titleRu || i.titleEn))
    // Tyres, oils, fluids are bought by their kind and size (v0.55): not looked up — unless picked by hand.
    .filter((i) => !!picked || !boughtBySpec(i.titleEn || i.titleRu || ''))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.createdAt.localeCompare(b.createdAt));
  if (!items.length) return undefined;
  // No car — nothing to look up (v0.55): said once for all of them; the names are still put right.
  const order = await db.orders.get(orderId);
  const car = order ? await db.vehicles.get(order.vehicleId) : undefined;
  if (!carKnown(car)) notify({ kind: 'needCar' });
  const before = new Map(items.map((i) => [i.id, { titleRu: i.titleRu, titleEn: i.titleEn, partNumber: i.partNumber, pics: (i.diagramIds?.length ?? 0) + (i.sampleIds?.length ?? 0) }]));
  working.add(key);
  allProgress.set(orderId, { done: 0, total: items.length, ids: items.map((i) => i.id), finished: new Set() });
  workChanged();
  let names = 0;
  let numbers = 0;
  let pictures = 0;
  try {
    // Each part from its name straight to its search, five at a time (v0.54, «намного быстрее»: all the names first, then
    // all the searches, kept the first search waiting for the last name; three at a time — a long list in rounds).
    await inTurns(items, AT_ONCE, async (i) => {
      try {
        if (await aiFixPartName(i.id, { quiet: true })) names++;
        await aiFindPart(i.id, { quiet: true, single: true, pictures: true });
      } finally {
        const now = await db.items.get(i.id);
        const b = before.get(i.id)!;
        if (now?.partNumber && !b.partNumber) numbers++;
        if (now && b.pics === 0 && (now.diagramIds?.length ?? 0) + (now.sampleIds?.length ?? 0) > 0) pictures++;
        const p = allProgress.get(orderId);
        if (p) {
          p.done++;
          p.finished.add(i.id);
        }
        workChanged();
        progressChanged();
      }
    });
  } finally {
    working.delete(key);
    allProgress.delete(orderId);
    workChanged();
  }
  notify({
    kind: 'parts',
    orderId,
    lines: items.length,
    names,
    numbers,
    pictures,
    // The names and the numbers as they were (where nobody changed them since); the pictures stay — they help.
    undo: async () => {
      for (const [id, b] of before) {
        const cur = await db.items.get(id);
        if (!cur) continue;
        const patch: Partial<OrderItem> = {};
        if (cur.approvalState === 'draft' && cur.aiName && (cur.titleRu !== b.titleRu || cur.titleEn !== b.titleEn)) {
          patch.titleRu = b.titleRu;
          patch.titleEn = b.titleEn;
          patch.aiName = { from: cur.aiName.from, to: cur.aiName.from, at: nowIso() };
        }
        if (!b.partNumber && cur.partNumber && cur.aiFind?.filled === cur.partNumber) patch.partNumber = undefined;
        if (Object.keys(patch).length) await db.items.update(id, patch);
      }
    },
  });
  return { lines: items.length, names, numbers, pictures };
}

/**
 * A part line saved: its name looked at — not waited for. Its number, diagram and photos are looked up only when asked
 * (v0.53, the user: «чтобы ИИ сам сразу не начинал поиск детали, пока не нажму кнопку; сразу можно исправлять названия»):
 * «Найти номер» in its sheet, the parts picked on the job, or the AI's tile under the lines.
 */
export function aiAfterPart(itemId: string) {
  void aiFixPartName(itemId);
}
