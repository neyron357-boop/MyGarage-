import { db } from '../db/db';
import { catalogCount, nameFix, provenNumber, vinFill, type AiFind, type AiName, type AiVin } from '../domain/ai';
import { nowIso } from '../domain/dates';
import { itemTitle, lineName } from '../domain/items';
import { formatNumber, sameNumber } from '../domain/partNumbers';
import { partsMemory, type Memory, type PriorPart } from '../domain/partsMemory';
import { matchPartName } from '../domain/partsVocab';
import type { OrderItem, Vehicle } from '../domain/types';
import { isVin, vinBuilt } from '../domain/vin';
import { addMedia, deleteMedia, mediaBlob } from './media';
import { callJson, SyncError } from './sync/api';
import { syncConfig } from './sync/config';

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

/** One question to the garage's server (the receipts' service asks too). */
export async function askAi<T>(path: AiPath, body: unknown, key: string, timeout = 110_000): Promise<T> {
  working.add(key);
  workChanged();
  try {
    if (transport) return (await transport(path, body)) as T;
    const cfg = syncConfig();
    if (!cfg) throw new Error('no server');
    // A part's number takes the server up to a minute and a half (the web, the pages, the pictures), and the phone's tunnel
    // cuts a request at about 100 s: asked again, the server hands over the same search, still going or done (v0.48.3).
    for (let attempt = 1; ; attempt++) {
      try {
        return await callJson<T>(cfg, `/api/ai/${path}`, { method: 'POST', body, timeout });
      } catch (e) {
        const status = e instanceof SyncError ? e.status : -1;
        if (path !== 'part-find' || attempt >= 3 || !(status === 0 || status >= 500)) throw e;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  } finally {
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
export function aiFixPartName(itemId: string): Promise<boolean | undefined> {
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
    if (fix.title || fix.english) {
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
        },
      });
    }
    return !!(fix.title || fix.english);
  });
}

const blobOf = (data: string, type: string) => {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

/*
 * The garage's own part lines with a number or a search (every job), as the memory reads them — read once and kept
 * half a minute (a job's lines are saved one after another).
 */
let priorCache: { at: number; lines: PriorPart[] } | undefined;
async function priorParts(): Promise<PriorPart[]> {
  if (priorCache && Date.now() - priorCache.at < 30_000) return priorCache.lines;
  const items = await db.items.filter((i) => i.kind === 'part' && !!(i.partNumber?.trim() || i.aiFind?.numbers.length)).toArray();
  const orders = new Map((await db.orders.bulkGet([...new Set(items.map((i) => i.orderId))])).filter((o) => !!o).map((o) => [o!.id, o!]));
  const vehicles = new Map((await db.vehicles.bulkGet([...new Set([...orders.values()].map((o) => o.vehicleId))])).filter((v) => !!v).map((v) => [v!.id, v!]));
  const lines: PriorPart[] = [];
  for (const i of items) {
    const o = orders.get(i.orderId);
    const v = o && vehicles.get(o.vehicleId);
    if (!o || !v) continue;
    lines.push({
      id: i.id,
      jobId: o.id,
      jobNo: o.number,
      at: i.createdAt,
      name: i.titleEn || i.titleRu || '',
      number: i.partNumber,
      fitted: i.done || i.procurementStatus === 'received' || i.procurementStatus === 'installed',
      car: { make: v.make, model: v.model, year: v.year, engine: v.engine },
      web: i.aiFind?.search === 'web' && i.aiFind.numbers.length ? { at: i.aiFind.at, numbers: i.aiFind.numbers } : undefined,
      diagramIds: i.diagramIds,
      sampleIds: i.sampleIds,
    });
  }
  priorCache = { at: Date.now(), lines };
  return lines;
}
/** The memory reads the lines again next time (a line of this device changed them). */
export function forgetPriorParts() {
  priorCache = undefined;
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
        list.push((await addMedia({ ownerType: 'item', ownerId: itemId, slot: m.slot, file: blob, name: m.name, compress: false })).id);
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

type FoundNumber = AiFind['numbers'][number];

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
 */
export function aiFindPart(itemId: string, { again = false }: { again?: boolean } = {}): Promise<AiFind | undefined> {
  return once(`find:${itemId}`, async () => {
    const item = await db.items.get(itemId);
    const part = item?.titleEn || item?.titleRu || '';
    const looked = item?.aiFind?.part === part && item.aiFind.search !== 'model';
    if (!item || item.kind !== 'part' || !part || (!again && (item.partNumber || looked))) return undefined;
    const car = await carOf(item);
    const carKey = { make: car?.make ?? '', model: car?.model ?? '', year: car?.year, engine: car?.engine };
    const mem = partsMemory((await priorParts()).filter((p) => p.id !== itemId), carKey, part);
    const write = async (r: Pick<AiFind, 'search' | 'numbers'>, pics: { diagrams: string[]; samples: string[] }, proven: string | undefined) => {
      const now = await db.items.get(itemId);
      if (!now) return;
      const fill = proven && !now.partNumber ? proven : undefined;
      await db.items.update(itemId, { aiFind: { at: nowIso(), search: r.search, part, numbers: r.numbers, filled: fill }, ...(await keepPictures(now, pics)), ...(fill ? { partNumber: fill } : {}) });
      forgetPriorParts();
      if (fill) {
        const n = r.numbers.find((x) => sameNumber(x.number, fill));
        notify({
          kind: 'number',
          itemId,
          number: fill,
          catalogs: catalogCount(n?.seen ?? []),
          garage: n?.garage ?? 0,
          undo: async () => {
            const cur = await db.items.get(itemId);
            if (cur?.partNumber === fill) await db.items.update(itemId, { partNumber: undefined });
          },
        });
      }
    };
    // 1. Fitted before on this car: the garage's number, no question.
    if (mem.proven && !again) {
      const numbers: FoundNumber[] = mem.numbers.map((n) => ({ number: n.number, seen: [], garage: n.times }));
      const pics = item.diagramIds?.length || item.sampleIds?.length ? { diagrams: [], samples: [] } : await copyPictures(mem.numbers[0].from, itemId);
      await write({ search: 'garage', numbers }, pics, mem.proven);
      return { search: 'garage', numbers };
    }
    // 2. The web looked at lately for the same part on the same car: that answer again.
    if (mem.web?.web && !again) {
      const numbers = merged(mem.web.web.numbers, mem, carKey.make);
      const pics = item.diagramIds?.length || item.sampleIds?.length ? { diagrams: [], samples: [] } : await copyPictures(mem.web, itemId);
      await write({ search: 'web', numbers }, pics, provenNumber({ search: 'web', numbers }, carKey.make));
      return { search: 'web', numbers };
    }
    // 3. The AI — or, without it, what the garage used before as candidates.
    if (!aiOn()) {
      if (mem.numbers.length) await write({ search: 'garage', numbers: mem.numbers.map((n) => ({ number: n.number, seen: [], garage: n.times })) }, { diagrams: [], samples: [] }, undefined);
      return undefined;
    }
    const r = await askAi<AiFind>(
      'part-find',
      { part, make: carKey.make, model: carKey.model, year: carKey.year ?? '', engine: carKey.engine ?? '', vin: car?.vin ?? '', built: car?.vin ? vinBuilt(car.vin) ?? '' : '', hints: mem.numbers.slice(0, 3).map((n) => n.number) },
      `find:${itemId}`,
    );
    // The pictures: the part's diagram and photos of the part (samples), each kept apart from the line's own photos.
    const pics = { diagrams: [] as string[], samples: [] as string[] };
    for (const img of r.images ?? []) {
      const sample = img.kind === 'photo';
      try {
        const id = (await addMedia({ ownerType: 'item', ownerId: itemId, slot: sample ? 'sample' : 'diagram', file: blobOf(img.data, img.type), name: img.source })).id;
        (sample ? pics.samples : pics.diagrams).push(id);
      } catch {
        // a picture that would not keep: the numbers still count
      }
    }
    const numbers = merged(
      r.numbers.map((n) => ({ number: n.number, brand: n.brand || undefined, note: n.note || undefined, seen: n.seen ?? [] })),
      mem,
      carKey.make,
    );
    await write({ search: r.search, numbers }, pics, provenNumber({ search: r.search, numbers }, carKey.make));
    return { ...r, numbers };
  });
}

/** A part line saved: its name looked at, then its number looked up — not waited for. */
export function aiAfterPart(itemId: string) {
  void (async () => {
    await aiFixPartName(itemId);
    await aiFindPart(itemId);
  })();
}
