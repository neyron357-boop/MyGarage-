import { matchPartName } from './partsVocab';
import { CAR_MAKES } from './partMatch';
import { normalizePlate } from './plates';
import type { Emirate, Plate } from './types';
import { checkDigitOk, makeMatches, vinsInText } from './vin';

/*
 * A customer's request in WhatsApp made a job by itself (v0.90, the owner's note #69: «на такие запросы в ватсапе им должен
 * реагировать и автоматически создавать заявку/карточку заказа» — the screenshot: «I want to change engine mounting»,
 * «Nissan Altima 2015», «Original or duplicate?», «Tell me both prices» and a photo of the car's registration card).
 * Pure: what is a request worth asking the AI about (most messages are not), and what of its answer the app takes.
 *  - asked only when the messages name a car (a make, a model the garage knows, a VIN) and a part or work (the garage's
 *    dictionary of parts, the words of asking: change, repair, price…);
 *  - taken: the make if it is a maker, the year if it can be, the plate only whole (emirate, code, number) — without it no
 *    job is made (the board must know the car); the VIN only with its check digit right and of that make;
 *  - a part asked «original or duplicate» — two lines, ORIGINAL and AFTERMARKET, and two options of the quote (v0.90 #72).
 */

const ASK_WORDS =
  /\b(change|chang|replace|repair|fix|service|servic|check|install|fit|price|prices|cost|how much|quotation|quote|estimate|need|want|original|duplicate|genuine|aftermarket)\b|поменя|замен|ремонт|почин|сколько|цен[аыу]|смет|нужн|оригинал|копи|تغيير|غير|بدل|تبديل|تصليح|اصلاح|إصلاح|صيانة|فحص|كم سعر|سعر|قطعة|قطع|غيار|ابغى|أبغى|ابي|أبي|محتاج|اصلي|أصلي|تجاري/i;

/** Arabic names of the makes and models the garage sees (audit 27/11), as the chats write them. */
const CARS_AR = /تويوتا|نيسان|لكزس|هوندا|ميتسوبيشي|متسوبيشي|هيونداي|هونداي|كيا|مرسيدس|بي ام|شفروليه|شيفروليه|فورد|جيب|مازدا|سوزوكي|لاندكروزر|لاند كروزر|باترول|كامري|برادو|يارس|كورولا|هايلكس|اكورد|سيفيك|التيما|صني|رنج روفر/;

/** The words of a chat that name a car: a maker, a model the garage has had, or a VIN. */
export function namesCar(text: string, models: Set<string>): boolean {
  if (vinsInText(text.toUpperCase()).length || CARS_AR.test(text)) return true;
  const words = text.toLowerCase().split(/[^a-z0-9а-яё-]+/i).filter(Boolean);
  return words.some((w) => CAR_MAKES.has(w) || (w.length >= 3 && models.has(w)));
}

/** Worth asking the AI: a car is named and something is asked of it (a part, a repair, a price). */
export function looksLikeRequest(texts: string[], models: Set<string>): boolean {
  const all = texts.join('\n');
  if (!namesCar(all, models)) return false;
  return ASK_WORDS.test(all) || texts.some((t) => matchPartName(t).known);
}

/** What the AI said of the messages (server/src/ai.mjs `request`). */
export interface AiRequest {
  isRequest: boolean;
  car?: { make?: string; model?: string; year?: number; plate?: { emirate?: string; code?: string; number?: string }; vin?: string };
  items?: { name: string; kind: 'part' | 'work'; both?: boolean }[];
  owner?: string;
  confidence: number;
}

/** The job the app makes of it. */
export interface RequestPlan {
  make: string;
  model: string;
  year?: number;
  plate?: Plate;
  vin?: string;
  lines: { titleEn: string; kind: 'part' | 'labor'; side?: 'original' | 'copy' }[];
  /** Two options of the quote: the originals, the copies (the other lines in both). */
  options: boolean;
  owner: string;
}

const EMIRATES: Emirate[] = ['DXB', 'AUH', 'SHJ', 'AJM', 'RAK', 'UAQ', 'FUJ'];
const EMIRATE_WORDS: [RegExp, Emirate][] = [
  [/dub|dxb|дуб/i, 'DXB'],
  [/abu|auh|абу/i, 'AUH'],
  [/shar|shj|шар/i, 'SHJ'],
  [/ajm|адж/i, 'AJM'],
  [/ras|rak|рас/i, 'RAK'],
  [/umm|uaq|умм/i, 'UAQ'],
  [/fuj|фуд/i, 'FUJ'],
];

/** A plate only whole: an emirate, a code, a number of 1–5 digits. */
export function plateOf(p: { emirate?: string; code?: string; number?: string } | undefined): Plate | undefined {
  if (!p) return undefined;
  const raw = String(p.emirate ?? '').trim();
  const emirate = (EMIRATES as string[]).includes(raw.toUpperCase()) ? (raw.toUpperCase() as Emirate) : EMIRATE_WORDS.find(([re]) => re.test(raw))?.[1];
  const plate = normalizePlate({ emirate: emirate ?? 'DXB', code: String(p.code ?? ''), number: String(p.number ?? '') });
  if (!emirate || !plate.code || !/^\d{1,5}$/.test(plate.number) || plate.code.length > 3) return undefined;
  return plate;
}

const caps = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const PLAIN_SIDE = /\b(ORIGINAL|GENUINE|OEM|DUPLICATE|AFTERMARKET|COPY)\b/g;

/** What of the AI's answer is taken (none — not a request, or not sure enough). */
export function requestPlan(ai: AiRequest, now = new Date()): RequestPlan | undefined {
  if (!ai?.isRequest || !(ai.confidence >= 0.6)) return undefined;
  const items = (ai.items ?? []).filter((i) => i && typeof i.name === 'string' && caps(i.name));
  if (!items.length) return undefined;
  const make = String(ai.car?.make ?? '').trim();
  const model = String(ai.car?.model ?? '').trim();
  const known = CAR_MAKES.has(make.toLowerCase().split(/\s+/)[0] ?? '');
  const y = Number(ai.car?.year);
  const year = Number.isInteger(y) && y >= 1980 && y <= now.getFullYear() + 1 ? y : undefined;
  const v = String(ai.car?.vin ?? '').toUpperCase().replace(/\s/g, '');
  const vin = checkDigitOk(v) && makeMatches(v, make) !== false ? v : undefined;
  const lines: RequestPlan['lines'] = [];
  let options = false;
  for (const i of items.slice(0, 12)) {
    const kind = i.kind === 'work' ? 'labor' : 'part';
    const name = caps(i.name);
    if (kind === 'part' && i.both) {
      const base = name.replace(PLAIN_SIDE, ' ').replace(/\s+/g, ' ').trim();
      lines.push({ titleEn: `${base} ORIGINAL`, kind, side: 'original' }, { titleEn: `${base} AFTERMARKET`, kind, side: 'copy' });
      options = true;
    } else lines.push({ titleEn: name, kind });
  }
  return { make: known ? make : '', model: known ? model : '', year, plate: plateOf(ai.car?.plate), vin, lines, options, owner: String(ai.owner ?? '').trim().slice(0, 60) };
}
