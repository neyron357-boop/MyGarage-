import { db } from '../db/db';
import { nameFix, provenNumber, vinFill, type AiFind, type AiName, type AiVin } from '../domain/ai';
import { nowIso } from '../domain/dates';
import { itemTitle } from '../domain/items';
import type { OrderItem, Vehicle } from '../domain/types';
import { isVin } from '../domain/vin';
import { addMedia } from './media';
import { callJson } from './sync/api';
import { syncConfig } from './sync/config';

/*
 * The garage's AI on this device (v0.48): questions go to the garage's server (server/src/ai.mjs — Gemini with the key
 * kept on the garage's computer, never here), what of the answer is taken is decided by domain/ai.ts. It works by
 * itself and quietly: no server, no key, no network — nothing happens and nothing is said; what it did is said once
 * (AiNotices: a toast with «Отменить»).
 */

type Transport = (path: 'vin' | 'part-name' | 'part-find', body: unknown) => Promise<unknown>;
let transport: Transport | undefined;
/** The server's part played by a test (and by the browser scenario). */
export function setAiTransport(t: Transport | undefined) {
  transport = t;
}

/** A device paired with the garage's server asks it (the server says «ai off» without a key — quietly nothing). */
export const aiOn = (): boolean => !!transport || !!syncConfig();

async function ask<T>(path: 'vin' | 'part-name' | 'part-find', body: unknown): Promise<T> {
  if (transport) return (await transport(path, body)) as T;
  const cfg = syncConfig();
  if (!cfg) throw new Error('no server');
  return callJson<T>(cfg, `/api/ai/${path}`, { method: 'POST', body, timeout: 120_000 });
}

export type CarFill = Partial<Pick<Vehicle, 'make' | 'model' | 'year' | 'engine' | 'type'>>;
export type AiNotice =
  | { kind: 'car'; vehicleId: string; filled: CarFill; undo: () => Promise<void> }
  | { kind: 'name'; itemId: string; to: string; undo: () => Promise<void> }
  | { kind: 'number'; itemId: string; number: string; undo: () => Promise<void> };

const listeners = new Set<(n: AiNotice) => void>();
/** What the AI did by itself (the app's notices show it, with «Отменить»). */
export function onAiNotice(fn: (n: AiNotice) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const notify = (n: AiNotice) => listeners.forEach((f) => f(n));

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
 * The car's VIN read by the AI, once a VIN: what is empty in its card — make, model, year, engine, body — filled with
 * what agrees with the VIN (domain/ai.ts `vinFill`). Asked when a VIN is put in the card (typed, read off a photo,
 * kept on the «Проверка VIN» sheet).
 */
export function aiReadVin(vehicleId: string): Promise<CarFill | undefined> {
  return once(`car:${vehicleId}`, async () => {
    if (!aiOn()) return undefined;
    const v = await db.vehicles.get(vehicleId);
    const vin = v?.vin?.toUpperCase();
    if (!v || !vin || !isVin(vin) || v.vinAi?.vin === vin) return undefined;
    const ai = await ask<AiVin>('vin', { vin });
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
 * A part's name as typed, looked at by the AI once: typing mistakes put right, and its English name for the documents
 * when it was typed in Russian (domain/ai.ts `nameFix`). Only a draft line (a quote sent keeps its words).
 */
export function aiFixPartName(itemId: string): Promise<boolean | undefined> {
  return once(`name:${itemId}`, async () => {
    if (!aiOn()) return false;
    const item = await db.items.get(itemId);
    const typed = item?.titleRu || item?.titleEn || '';
    if (!item || item.kind !== 'part' || item.approvalState !== 'draft' || !typed || item.aiName?.from === typed || item.aiName?.to === typed) return false;
    const car = await carOf(item);
    const r = await ask<AiName>('part-name', { name: typed, make: car?.make ?? '', model: car?.model ?? '', year: car?.year ?? '' });
    const now = await db.items.get(itemId);
    if (!now || now.approvalState !== 'draft' || (now.titleRu || now.titleEn) !== typed) return false;
    const fix = nameFix(typed, r, !!now.titleEn);
    const russian = !!now.titleRu;
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

/**
 * The part's number looked up by the AI in the open catalogues: the numbers found go on the line as candidates (a tap
 * takes one), a number seen in two catalogues is written itself when the line has none (domain/ai.ts
 * `provenNumber`); the part's diagram, when a catalogue page had one, is kept with the line (not sent to the customer).
 * Once a line, unless asked again (`again` — the ✦ on the line).
 */
export function aiFindPart(itemId: string, { again = false }: { again?: boolean } = {}): Promise<AiFind | undefined> {
  return once(`find:${itemId}`, async () => {
    if (!aiOn()) return undefined;
    const item = await db.items.get(itemId);
    const part = item?.titleEn || item?.titleRu || '';
    if (!item || item.kind !== 'part' || !part || (!again && (item.partNumber || item.aiFind?.part === part))) return undefined;
    const car = await carOf(item);
    const r = await ask<AiFind>('part-find', { part, make: car?.make ?? '', model: car?.model ?? '', year: car?.year ?? '', engine: car?.engine ?? '', vin: car?.vin ?? '' });
    const now = await db.items.get(itemId);
    if (!now) return undefined;
    const diagrams: string[] = [];
    for (const img of r.images ?? []) {
      try {
        diagrams.push((await addMedia({ ownerType: 'item', ownerId: itemId, slot: 'diagram', file: blobOf(img.data, img.type), name: img.source })).id);
      } catch {
        // a picture that would not keep: the numbers still count
      }
    }
    const proven = provenNumber(r);
    const fill = proven && !now.partNumber ? proven : undefined;
    const numbers = r.numbers.map((n) => ({ number: n.number, brand: n.brand || undefined, note: n.note || undefined, seen: n.seen ?? [] }));
    await db.items.update(itemId, {
      aiFind: { at: nowIso(), search: r.search, part, numbers, filled: fill },
      ...(diagrams.length ? { diagramIds: [...(now.diagramIds ?? []), ...diagrams] } : {}),
      ...(fill ? { partNumber: fill } : {}),
    });
    if (fill)
      notify({
        kind: 'number',
        itemId,
        number: fill,
        undo: async () => {
          const cur = await db.items.get(itemId);
          if (cur?.partNumber === fill) await db.items.update(itemId, { partNumber: undefined });
        },
      });
    return r;
  });
}

/** A part line saved: its name looked at, then its number looked up — not waited for. */
export function aiAfterPart(itemId: string) {
  if (!aiOn()) return;
  void (async () => {
    await aiFixPartName(itemId);
    await aiFindPart(itemId);
  })();
}
