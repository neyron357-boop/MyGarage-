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
    scored.push({ title, score: begins * 1_000_000 + (s.price > 0 ? NEAR[s.from] * 10_000 : 0) + Math.min(s.uses, 9_999) });
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
