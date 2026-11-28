import { lineName } from './items';
import type { Suggestion, Suggestions } from './linePrices';
import { expandToken, indexText, matchToken, normalizeText, tokenize } from './search';

/*
 * The quick «＋» sheet of a job (v0.81, the user's brief: «короткое окно с поиском и фокусом в строке… названия из истории
 * подсказывать по мере набора, в том числе при вводе на английском; если в истории есть левая и правая версии, показать их
 * отдельными вариантами»): which titles of the history are offered for what is typed, best first. Pure — the titles and
 * their prices come from `buildSuggestions` (domain/linePrices.ts).
 *
 * Every word typed must be found at the start of a word of the title — in either of its languages, and through the
 * garage's dictionary (domain/search.ts: «колодки» finds «BRAKE PADS», «pads» finds «КОЛОДКИ»). Nearer prices first (this
 * car, this customer, the same model…), then the most used; a title that begins as typed before one that only holds it.
 * Titles that differ only by their side («… LH» and «… RH», «LEFT» and «RIGHT») are separate lines, next to each other,
 * the left first.
 */

/** The words of a side — read off a title in capitals. */
const SIDE_WORDS = /(?:^|[\s,(/-])(LH|RH|L\/H|R\/H|LEFT|RIGHT|L|R|ЛЕВ[А-ЯЁ]*|ПРАВ[А-ЯЁ]*)(?=$|[\s,)/-])/g;

/** Which side a title names: the left, the right — or none (both, or no side). */
export function sideOf(title: string): 'L' | 'R' | undefined {
  const t = lineName(title.trim());
  let left = false;
  let right = false;
  for (const m of t.matchAll(SIDE_WORDS)) {
    if (/^(LH|L\/H|LEFT|L|ЛЕВ)/.test(m[1])) left = true;
    else right = true;
  }
  return left === right ? undefined : left ? 'L' : 'R';
}

/** A title without its side: «HEADLIGHT LH» and «HEADLIGHT RH» are one part, two sides. */
export function sideless(title: string): string {
  return lineName(title.trim()).replace(SIDE_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

const NEAR: Record<Suggestion['from'], number> = { car: 5, customer: 4, model: 3, make: 2, any: 1, list: 0 };

/**
 * The titles offered for `query` (none typed — the usual ones, `top`), at most `limit`. Each title is the one the job's
 * documents print (the key of `set.list`).
 */
export function quickMatches(set: Suggestions | undefined, query: string, limit = 8): string[] {
  if (!set) return [];
  const q = query.trim();
  if (!q) return pairSides(set.top, set.list).slice(0, limit);
  const tokens = tokenize(q);
  if (!tokens.length) return [];
  const terms = tokens.map((tk) => ({ tk, terms: expandToken(tk) }));
  const typed = normalizeText(q);
  const scored: { title: string; score: number }[] = [];
  for (const [title, s] of set.list) {
    const x = indexText(`${title} ${s.titleEn ?? ''} ${s.titleRu ?? ''}`);
    if (!terms.every(({ tk, terms }) => matchToken(tk, terms, x))) continue;
    const own = normalizeText(title);
    // As typed from its first letter, as typed somewhere, or found through the dictionary.
    const begins = own.startsWith(typed) || normalizeText(s.titleEn ?? '').startsWith(typed) || normalizeText(s.titleRu ?? '').startsWith(typed) ? 2 : own.includes(typed) ? 1 : 0;
    // v1.06: bought for this car before (an invoice) — as near as this car's own; for its make — as the same make's
    const near = Math.max(s.price > 0 ? NEAR[s.from] : 0, s.bought ? (s.bought.near >= 2 ? NEAR.car : NEAR.make) : 0);
    scored.push({ title, score: begins * 1_000_000 + near * 10_000 + Math.min(s.uses, 9_999) });
  }
  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return pairSides(
    scored.map((x) => x.title),
    set.list,
  ).slice(0, limit);
}

/** The list as ranked, a side's other side pulled up beside it (the left first). */
function pairSides(titles: string[], list: Map<string, Suggestion>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const byPart = new Map<string, string[]>();
  for (const t of titles) {
    if (!sideOf(t)) continue;
    const k = sideless(t);
    byPart.set(k, [...(byPart.get(k) ?? []), t]);
  }
  for (const t of titles) {
    if (seen.has(t)) continue;
    const side = sideOf(t);
    const pair = side ? (byPart.get(sideless(t)) ?? [t]) : [t];
    const ordered = pair.length > 1 ? [...pair].sort((a, b) => (sideOf(a) === 'L' ? 0 : 1) - (sideOf(b) === 'L' ? 0 : 1)) : pair;
    for (const p of ordered)
      if (!seen.has(p) && list.has(p)) {
        seen.add(p);
        out.push(p);
      }
  }
  return out;
}

/** The title typed is one of the history (as the documents print it): that one — its price comes with it. */
export function exactTitle(set: Suggestions | undefined, typed: string): string | undefined {
  const t = lineName(typed.trim());
  return t && set?.list.has(t) ? t : undefined;
}

/**
 * A price typed after the name (v0.90, the owner's note #73: «два дефиса и сумма… после двух дефисов цифру — это нужно
 * засчитать как цена продажи сразу же»): «GEAR OIL -- 450» is GEAR OIL sold at 450. Two hyphens — or the dash an iPhone
 * makes of them as they are typed (— or –) — then the amount, as the price fields take it: 450 · 450.50 · 450,50 · 1,200 ·
 * 1 200 (AED after it is fine). What is before is the name; anything else is no price, and the text is the name as it is.
 */
export function typedPrice(text: string): { name: string; priceFils?: number } {
  const m = /^(.*?\S)\s*(?:-\s*-+|[—–]+|−\s*−)\s*(\d[\d\s,.]*?)\s*(?:AED|ДИРХ\S*|DH)?\s*$/i.exec(text);
  if (!m) return { name: text };
  let n = m[2].replace(/\s+/g, '');
  // «1,200» and «12,500.50» — thousands; «450,50» — the decimals typed with a comma.
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(n)) n = n.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(n)) n = n.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(n)) return { name: text };
  const fils = Math.round(Number(n) * 100);
  return fils > 0 ? { name: m[1], priceFils: fils } : { name: text };
}

/* ---------- One «Добавить» for every kind (v0.91.7) ---------- */

/*
 * The owner: «при добавлении позиции в карточке заказа оставить одну сплошную кнопку с автоопределением типа позиции
 * моментально на ходу и с автоисправлением названия с ИИ, если написал с ошибками… добавляю вперемешку запчасть, труд
 * или услугу — система с ИИ сама определяет тип… подсказки умные, даже умнее, чем прежде… молниеносно». Here, at once and
 * without the AI: the kind of what is typed (its history first, then its words, then the parts' dictionary), and the
 * suggestions of every kind together; the AI looks again only at a kind not sure (services/ai.ts `aiFixPartName`).
 */

export type AutoKind = 'part' | 'labor' | 'service';
export interface KindGuess {
  kind: AutoKind;
  /** Known — by the history, a labour word, a service word, the parts' dictionary; not — a part by default. */
  sure: boolean;
}

/** A kit, a set, an assembly — a part, whatever work word is in it («REPAIR KIT», «SERVICE KIT»). */
const PART_WORDS = /(?:^|[^A-ZА-ЯЁ])(KIT|SET|ASSY|ASSEMBLY|КОМПЛЕКТ|РЕМКОМПЛЕКТ|НАБОР)(?![A-ZА-ЯЁ])/;
/** What is done to a car (a service — v0.68: everything done to it but the labour charge). */
const SERVICE_WORDS =
  /(?:^|[^A-ZА-ЯЁ])(REPAIR(?:ING)?|REPLACE(?:MENT)?|R\s*&\s*R|INSTALL(?:ATION|ING)?|FIX(?:ING)?|CHECKING|CHECKUP|INSPECTION|DIAGNOS[A-ZА-ЯЁ]*|TESTING|SCANNING|PROGRAMM[A-ZА-ЯЁ]*|CODING|CALIBRAT[A-ZА-ЯЁ]*|ADJUST[A-ZА-ЯЁ]*|OVERHAUL(?:ING)?|REMOV(?:E|AL)|REFIT[A-ZА-ЯЁ]*|RESURFAC[A-ZА-ЯЁ]*|SKIMMING|WELD[A-ZА-ЯЁ]*|DENT[A-ZА-ЯЁ]*|STRAIGHTEN[A-ZА-ЯЁ]*|ALIGNMENT|BALANCING|FLUSH(?:ING)?|REFILL[A-ZА-ЯЁ]*|RECHARG[A-ZА-ЯЁ]*|REGAS|TOP ?UP|CLEANING|POLISH(?:ING)?|PAINT(?:ING)?|SPRAY[A-ZА-ЯЁ]*|TINT(?:ING)?|WRAP(?:PING)?|DETAILING|WASH(?:ING)?|TOW(?:ING)?|RECOVERY|SERVICING|MAINTENANCE|РЕМОНТ[A-ZА-ЯЁ]*|ЗАМЕН[A-ZА-ЯЁ]*|УСТАНОВК[A-ZА-ЯЁ]*|СНЯТИ[A-ZА-ЯЁ]*|ДИАГНОСТ[A-ZА-ЯЁ]*|ПРОВЕРК[A-ZА-ЯЁ]*|РЕГУЛИРОВК[A-ZА-ЯЁ]*|ПРОГРАММИР[A-ZА-ЯЁ]*|КАЛИБРОВК[A-ZА-ЯЁ]*|ПЕРЕБОРК[A-ZА-ЯЁ]*|КАПРЕМОНТ[A-ZА-ЯЁ]*|СВАРК[A-ZА-ЯЁ]*|РИХТОВК[A-ZА-ЯЁ]*|РАЗВАЛ[A-ZА-ЯЁ]*|СХОД[A-ZА-ЯЁ]*|БАЛАНСИРОВК[A-ZА-ЯЁ]*|ПРОМЫВК[A-ZА-ЯЁ]*|ЗАПРАВК[A-ZА-ЯЁ]*|ЧИСТК[A-ZА-ЯЁ]*|ПОЛИРОВК[A-ZА-ЯЁ]*|ПОКРАСК[A-ZА-ЯЁ]*|ТОНИРОВК[A-ZА-ЯЁ]*|МОЙК[A-ZА-ЯЁ]*|ЭВАКУАТОР[A-ZА-ЯЁ]*|ОБСЛУЖИВАНИ[A-ZА-ЯЁ]*)(?![A-ZА-ЯЁ])/;
/**
 * Work words that also begin parts' names («CHECK VALVE», «SERVICE KIT», «TEST LIGHT»): a service, not sure — the AI looks.
 * (A WASHER is a part: whole words only, as domain/waAuto.ts `isWash`.)
 */
const SERVICE_MAYBE = /(?:^|[^A-ZА-ЯЁ])(CHECK|TEST|SCAN|RESET|CLEAN|SERVICE|CHANGE)(?![A-ZА-ЯЁ])/;

/**
 * What kind a line typed is. `sets` — the job's suggestions: a title of the history is what it was. `known` — the parts'
 * dictionary knows every word of it as a part (domain/partsVocab.ts `matchPartName`, given by the caller).
 */
export function guessKind(title: string, sets?: { part: Suggestions; work: Suggestions; service: Suggestions }, known = false): KindGuess {
  const t = lineName(title.trim());
  if (sets?.part.list.has(t)) return { kind: 'part', sure: true };
  if (sets?.work.list.has(t)) return { kind: sets.service.list.has(t) || !LABOUR.test(t) ? 'service' : 'labor', sure: true };
  if (LABOUR.test(t)) return { kind: 'labor', sure: true };
  if (PART_WORDS.test(t)) return { kind: 'part', sure: true };
  if (SERVICE_WORDS.test(t)) return { kind: 'service', sure: true };
  if (SERVICE_MAYBE.test(t)) return known ? { kind: 'part', sure: false } : { kind: 'service', sure: false };
  return { kind: 'part', sure: known };
}
const LABOUR = /^(LABOU?R|LABOUER|LABOUT|WORKMANSHIP|MAN ?HOURS?|ОПЛАТА ТРУДА|РАБОТА|РАБОТЫ|ТРУД)(?![A-ZА-ЯЁ0-9])/;

export interface AutoMatch {
  title: string;
  kind: AutoKind;
}

/**
 * The titles offered for `query` among every kind (the parts and the work together), best first: as typed from the start,
 * then nearer prices, then the most used. Nothing typed — the most used of both. `alt` — the same typed with its spelling
 * put right (the parts' dictionary): looked for too when it finds more.
 */
export function autoMatches(sets: { part: Suggestions; work: Suggestions; service: Suggestions } | undefined, query: string, limit = 8, alt?: string): AutoMatch[] {
  if (!sets) return [];
  const kindOf = (title: string, from: 'part' | 'work'): AutoKind => (from === 'part' ? 'part' : sets.service.list.has(title) || !LABOUR.test(title) ? 'service' : 'labor');
  const q = query.trim();
  if (!q) {
    const all = [
      ...sets.part.top.map((title) => ({ title, from: 'part' as const, uses: sets.part.list.get(title)?.uses ?? 0 })),
      ...sets.work.top.map((title) => ({ title, from: 'work' as const, uses: sets.work.list.get(title)?.uses ?? 0 })),
    ];
    all.sort((a, b) => b.uses - a.uses || a.title.localeCompare(b.title));
    return uniq(all.map((x) => ({ title: x.title, kind: kindOf(x.title, x.from) }))).slice(0, limit);
  }
  const scored = [...scoreMatches(sets.part, q).map((x) => ({ ...x, from: 'part' as const })), ...scoreMatches(sets.work, q).map((x) => ({ ...x, from: 'work' as const }))];
  const fixed = alt && lineName(alt) !== lineName(q) ? [...scoreMatches(sets.part, alt).map((x) => ({ ...x, from: 'part' as const })), ...scoreMatches(sets.work, alt).map((x) => ({ ...x, from: 'work' as const }))] : [];
  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  fixed.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const ranked = [...scored, ...fixed];
  const out: AutoMatch[] = [];
  const seen = new Set<string>();
  const put = (title: string, kind: AutoKind) => {
    if (seen.has(title)) return;
    seen.add(title);
    out.push({ title, kind });
  };
  for (const x of ranked) {
    if (out.length >= limit) break;
    if (seen.has(x.title)) continue;
    if (x.from === 'part' && sideOf(x.title)) {
      // A part's two sides next to each other, the left first (as before).
      const k = sideless(x.title);
      const pair = ranked.filter((y) => y.from === 'part' && sideOf(y.title) && sideless(y.title) === k).map((y) => y.title);
      for (const t of [...new Set(pair)].sort((a, b) => (sideOf(a) === 'L' ? 0 : 1) - (sideOf(b) === 'L' ? 0 : 1))) put(t, 'part');
    } else put(x.title, x.from === 'part' ? 'part' : kindOf(x.title, 'work'));
  }
  return out.slice(0, limit);
}

const uniq = (list: AutoMatch[]) => {
  const seen = new Set<string>();
  return list.filter((x) => !seen.has(x.title) && (seen.add(x.title), true));
};

/** Each title of a set that holds every word typed, with its score (as `quickMatches` ranks them). */
function scoreMatches(set: Suggestions, query: string): { title: string; score: number }[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const terms = tokens.map((tk) => ({ tk, terms: expandToken(tk) }));
  const typed = normalizeText(query);
  const out: { title: string; score: number }[] = [];
  for (const [title, s] of set.list) {
    const x = indexText(`${title} ${s.titleEn ?? ''} ${s.titleRu ?? ''}`);
    if (!terms.every(({ tk, terms }) => matchToken(tk, terms, x))) continue;
    const own = normalizeText(title);
    const begins = own.startsWith(typed) || normalizeText(s.titleEn ?? '').startsWith(typed) || normalizeText(s.titleRu ?? '').startsWith(typed) ? 2 : own.includes(typed) ? 1 : 0;
    out.push({ title, score: begins * 1_000_000 + (s.price > 0 ? NEAR[s.from] * 10_000 : 0) + Math.min(s.uses, 9_999) });
  }
  return out;
}
