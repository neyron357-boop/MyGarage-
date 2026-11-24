import { roundFils } from './money';

/*
 * A supplier's answer to the garage's parts request, read without AI (v0.79, the user: «прочитать переписки с
 * поставщиками и понять, в каких форматах они отправляют цены и наличие, чтобы приложение сразу выставляло цены к
 * позициям заказа — без ИИ»). The formats are the ones the garage's own suppliers write (read in its WhatsApp,
 * 2026-11-24: 16 suppliers, 33 requests, 51 answers):
 *
 *   - our list copied back, a price on each line:  «1. GEAR FILTER ---165  1 HOUR ORDER» · «2. … --- NA» · «+TAX»
 *   - price × quantity either way round:           «55x2» · «4X20+VAT» · «25*4» · «50+50=100»
 *   - several kinds on a line:                     «org 295x1/dupl 155x1» · «25x4 org  15x4  ngk» · «440+VAT ORG---DUP-495+VAT»
 *   - the lines in order, without names:           «440+VAT ORG ⏎ 290+VAT ORG»
 *   - a word of the line instead of its number:    «gasket 85 ⏎ seal 55»
 *   - one price for a one-part request:            «40» · «60  1 LITER»
 *   - none:                                        «NOT AVAILABLE» · «no have» · «Soryy out of stock» · «na» · «21606-00X0B----NA»
 *   - the kind alone, in a message of its own:     «original»
 *
 * What is not sure is not guessed: a line that cannot be told which part it is about is left as words (`unmatched`).
 */

export type OfferKind = 'oem' | 'aftermarket' | 'used';

/** A requested line, as the request listed it (its place in the list is its number). */
export interface AskLine {
  name: string;
  qty: number;
  number?: string;
}

export interface ReplyOffer {
  kind: OfferKind;
  /** The supplier said which kind (else it is the kind the line asked for, or aftermarket). */
  kindSaid: boolean;
  /** A unit's price, fils, as said (`vat` says what it holds). */
  unitFils?: number;
  /** How many the price was said for («55x2» — 2). */
  qty?: number;
  vat: 'net' | 'gross' | 'unsaid';
  brand?: string;
  /** Days until it is here: 0 — today (in stock, «1 hour order»). */
  days?: number;
  /** The supplier's own words that are none of the above («need sample», «set», «1 hour order»). */
  note?: string;
  /** Not available. */
  na?: boolean;
  /** «Checking»: an answer still to come. */
  pending?: boolean;
}

export interface ReplyLine {
  /** The requested line's place (0 — the first). */
  index: number;
  offers: ReplyOffer[];
}

export interface ParsedReply {
  lines: ReplyLine[];
  /** The kind said for the whole message (a line «ORIGINAL» of its own). */
  kindAll?: OfferKind;
  /** «+TAX» on a line of its own: every price is without VAT. */
  vatAll?: 'net' | 'gross';
  /** Only an acknowledgement («ok», «sent», «yes»). */
  ack?: boolean;
  /**
   * «Not available» said to the whole request («na», «no have»): for the parts this supplier has not answered yet —
   * an «na» after prices is about what was left (seen: three priced, then «na» to the question about the fourth).
   */
  naAll?: boolean;
  /** The message lists more parts than the request had: it answers another request (none of it is put on this one). */
  other?: boolean;
  /** Lines with something in them that could not be put on a part. */
  unmatched: string[];
}

/* ---------- Words ---------- */

const OEM = /^(org|orig|orginal|original|origional|orignal|genuine|genuin|gen|oem|oe)$/i;
const AFTER = /^(dup|dupl|dupli|duplicate|duplicat|dupicate|copy|aftermarket|aftermrkt|commercial|taiwan|tw|china|chinese|thailand|korea|replacement|replace|compatible)$/i;
const USED = /^(used|second|2nd|scrap|secondhand|бу)$/i;
/** Makers of parts and oils the garage's suppliers name: a brand is an aftermarket part (the car's own make — the original). */
const BRANDS = new Set(
  'ngk denso bosch valeo aisin kyb tokico mobil shell castrol total motul liqui moly mann mahle sakura febi lemforder trw brembo akebono nisshinbo mintex ctr 555 gates dayco contitech skf ntn nsk koyo fag hella osram philips varta acdelco motorcraft mopar moog sachs exedy luk valvoline petronas adnoc eneos idemitsu toyota nissan honda mitsubishi hyundai kia mazda lexus suzuki subaru isuzu ford chevrolet gmc jeep renault peugeot mg infiniti'.split(' '),
);
const NA = /\b(n\/?a|not\s*(?:available|availabl|avl|avail|in\s*stock)|no\s*(?:have|stock|stok|available)|out\s*of\s*stock|nil|finished|only\s+\w+\s*$)\b/i;
const PENDING = /\b(checking|will\s+check|let\s+me\s+check|check(?:ing)?\s+and\s+(?:tell|update))\b/i;
const ACK = /^(ok(?:ay)?|okk?|sent|yes|yeah|sure|done|noted|thanks?|thank\s+you|👍|✅)[.!\s]*$/i;
const UNIT = /^\s*(l|lt|ltr|ltrs|liter|litre|liters|litres|litr|ml|pcs?|pieces?|psc|nos|hours?|hrs?|days?|mins?|minutes?|kg|g|mm|cm|inch|v|w|amp|ah|k)\b/i;

const clean = (s: string) =>
  s
    .replace(/\r/g, '')
    .replace(/[‒-―−]/g, '-')
    .replace(/×/g, 'x')
    .replace(/[*_~]{1,2}(?=\S)([^\n*_~]+?)[*_~]{1,2}/g, '$1');

const tokens = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** A name as the request listed it, without its quantity and number: «SPARK PLUG ORIGINAL × 4 (90919-01253)» → its words. */
function nameTokens(name: string) {
  return tokens(name.replace(/\(.*?\)/g, ' ').replace(/\s[x×]\s*\d+\s*(pcs?)?\b/gi, ' '));
}

/** The request's own lines in an answer (the car, the VIN, our last line): not the supplier's words. */
function ours(line: string): boolean {
  const l = line.trim();
  if (!l) return true;
  if (/^(vin\b|price and availability|diagrams in the photos|photos of the car|used parts|part no\b|part:)/i.test(l)) return true;
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(l)) return true;
  // our car line, as we write it: «Toyota Camry 2019» (a model's year, no price words)
  if (/^\*?[A-Za-z][\w -]{1,40}\s(19|20)\d{2}\*?$/.test(l) && !/\b(org|dup|vat|tax|aed)\b/i.test(l)) return true;
  return false;
}

/* ---------- Prices ---------- */

interface Atom {
  at: number;
  end: number;
  a: number;
  b?: number;
  vat?: 'net' | 'gross';
}

const num = (s: string) => {
  // «1,250» — thousands; «12,5» — a decimal comma
  const t = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  return Number(t);
};

/** The prices of a piece of text: plain («165»), with a product («55x2», «4X20», «25*4»), with «+VAT», «+», «incl vat». */
function atoms(text: string): Atom[] {
  const out: Atom[] = [];
  // «50+50=100»: a unit's price said as many times as the parts, and their sum.
  const t = text.replace(/\b(\d{1,6})(?:\s*\+\s*\1)+\s*=\s*\d{1,7}\b/g, (m, a: string) => `${a}x${m.split('=')[0].split('+').length}`);
  const re = /(\d{1,3}(?:,\d{3})+|\d{1,6}(?:[.,]\d{1,2})?)(?:\s*[x*]\s*(\d{1,4}(?:[.,]\d{1,2})?))?(?![\p{L}\p{N}-]|[.,]\d)(\s*\+\s*(?:vat|tax)\b|\s*\+(?![\s\d]*\d)|\s*(?:incl\.?|including|with)\s*(?:vat|tax)\b)?/giu;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const before = t.slice(0, m.index);
    const after = t.slice(m.index + m[0].length);
    // attached to a word or a number before it: a part of a part number («K0000001»)
    if (/[\p{L}\p{N}.,]$/u.test(before)) continue;
    if (/-$/.test(before)) {
      // after dashes: «---165», «DUP-295» — a price; «90919-01253», «PE01-10» — a part number
      const word = /([\p{L}\p{N}]+)$/u.exec(before.replace(/-+$/, ''))?.[1];
      if (word && !kindOfWord(word)) continue;
    }
    // a quantity, a size, a time — not a price: «4 LITR», «1 HOUR», «DOT 3», «500ml» (attached ones never match)
    if (!m[2] && UNIT.test(after)) continue;
    if (/\b(dot|no|#|qty|quantity|year|model)\s*$/i.test(before)) continue;
    const a = num(m[1]);
    const b = m[2] ? num(m[2]) : undefined;
    if (!(a > 0)) continue;
    const vatWord = (m[3] ?? '').toLowerCase();
    out.push({ at: m.index, end: m.index + m[0].length, a, b, vat: vatWord ? (/incl|including|with/.test(vatWord) ? 'gross' : 'net') : undefined });
  }
  return out;
}

/** «a x b»: the unit's price and how many — whichever side is the requested quantity, or the small one, is the quantity. */
function unitOf(x: Atom, askedQty: number): { unit: number; qty?: number } {
  if (x.b === undefined) return { unit: x.a };
  const { a, b } = x;
  if (b === askedQty && a !== askedQty) return { unit: a, qty: b };
  if (a === askedQty && b !== askedQty) return { unit: b, qty: a };
  const small = (n: number) => Number.isInteger(n) && n <= 12;
  if (small(b) && !small(a)) return { unit: a, qty: b };
  if (small(a) && !small(b)) return { unit: b, qty: a };
  return { unit: a, qty: b };
}

/* ---------- A piece of text about one part ---------- */

interface WordAt {
  at: number;
  w: string;
}
function wordsAt(text: string): WordAt[] {
  const out: WordAt[] = [];
  // (no «/» inside a word: it parts the options — «org 295x1/dupl 155x1»)
  const re = /[\p{L}\d]+/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ at: m.index, w: m[0] });
  return out;
}

const kindOfWord = (w: string): OfferKind | undefined => (OEM.test(w) ? 'oem' : AFTER.test(w) ? 'aftermarket' : USED.test(w) || /^b\/u$/i.test(w) || /^б\/у$/i.test(w) ? 'used' : undefined);

/** Days from the words: «1 hour order», «today», «tomorrow», «2 days», «available». */
function daysOf(text: string): number | undefined {
  const t = text.toLowerCase();
  const d = /(\d{1,2})\s*(days?|d)\b/.exec(t);
  if (d) return Number(d[1]);
  if (/\btomorrow\b/.test(t)) return 1;
  if (/\b\d{1,2}\s*(hours?|hrs?|h)\b|\btoday\b|\bnow\b|\bin\s*stock\b|\bavailable\b|\bavl\b|\bready\b|\bhave\b/.test(t)) return 0;
  return undefined;
}

/** The offers of one part's piece of text. `wants` — the kind the line asked for (its name says «ORIGINAL»). */
function offersOf(text: string, ctx: { qty: number; wants?: OfferKind; make?: string; vatAll?: 'net' | 'gross'; name?: string[] }): ReplyOffer[] {
  const t = clean(text);
  if (!t.replace(/[\s\-.:]+/g, '')) return [];
  const found = atoms(t);
  const ws = wordsAt(t);
  if (!found.length) {
    if (NA.test(t) || /^\s*-*\s*(na|n\/a|no)\s*$/i.test(t) || /\bsor+y+\b/i.test(t)) return [{ kind: ctx.wants ?? 'aftermarket', kindSaid: false, vat: 'unsaid', na: true, note: naNote(t) || undefined }];
    if (PENDING.test(t)) return [{ kind: ctx.wants ?? 'aftermarket', kindSaid: false, vat: 'unsaid', pending: true }];
    return [];
  }
  // Options: split at «/», else each price with the words nearest to it (a kind word goes to the closer price).
  const offers: ReplyOffer[] = found.map((x) => {
    const u = unitOf(x, ctx.qty);
    return { kind: ctx.wants ?? 'aftermarket', kindSaid: false, unitFils: roundFils(u.unit * 100), qty: u.qty, vat: x.vat ?? ctx.vatAll ?? 'unsaid' };
  });
  const slashes = [...t.matchAll(/\//g)].map((m) => m.index ?? 0).filter((i) => !/b$/i.test(t.slice(0, i)));
  const optionOf = (at: number) => {
    if (slashes.length) {
      // between the slashes
      const k = slashes.filter((s) => s < at).length;
      const sameSide = found.map((x, i) => ({ i, k: slashes.filter((s) => s < x.at).length })).filter((x) => x.k === k);
      if (sameSide.length === 1) return sameSide[0].i;
    }
    let best = 0;
    let dist = Infinity;
    found.forEach((x, i) => {
      const d = at < x.at ? x.at - at : at >= x.end ? at - x.end + 0.5 : 0;
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  };
  const used = new Set<number>();
  ws.forEach((w, wi) => {
    const kind = kindOfWord(w.w);
    const lower = w.w.toLowerCase();
    if (kind) {
      const o = offers[optionOf(w.at)];
      o.kind = kind;
      o.kindSaid = true;
      used.add(wi);
    } else if (BRANDS.has(lower) && !/^\d+$/.test(lower)) {
      const o = offers[optionOf(w.at)];
      o.brand = w.w.toUpperCase();
      // the car's own make: its original; any other maker: aftermarket
      if (!o.kindSaid) {
        o.kind = ctx.make && lower === ctx.make.toLowerCase() ? 'oem' : 'aftermarket';
        o.kindSaid = true;
      }
      used.add(wi);
    } else if (/^(vat|tax|aed|dhs|dh|dirham|dirhams|each|per|pc|pcs|price|rate)$/i.test(w.w)) used.add(wi);
  });
  // A brand name «555» is a number too: not a price when a kind's words are around it only.
  const d = daysOf(t);
  const n = note(t, ws, [...used], found, ctx.name);
  for (const o of offers) {
    if (d !== undefined) o.days = d;
    if (n) o.note = n;
  }
  return offers;
}

/** What is left of the words once prices, kinds, brands and our own words are taken: the supplier's note. */
const TIME_WORDS = /^(today|tomorrow|now|available|avl|avail|ready|stock|in|have|day|days|hour|hours|hr|hrs|order|ordr|l|lt|ltr|ltrs|liter|litre|liters|litres|litr|ml|pcs|pc)$/i;
function note(t: string, ws: WordAt[], used: number[], found: Atom[] = [], name: string[] = []): string {
  const inPrice = (at: number) => found.some((x) => at >= x.at && at < x.end);
  const own = new Set(name);
  const left = ws.filter((w, i) => !used.includes(i) && !inPrice(w.at) && !/\d/.test(w.w) && !own.has(w.w.toUpperCase()) && !TIME_WORDS.test(w.w)).map((w) => w.w);
  // how soon, as the supplier said it: «1 HOUR ORDER»
  const hour = /\b(\d{1,2})\s*(hours?|hrs?)\b(\s*order)?/i.exec(t);
  const s = [hour ? hour[0].toUpperCase().replace(/\s+/g, ' ') : '', ...left].join(' ').trim();
  return s.length > 1 ? s.slice(0, 80) : '';
}

/** «Not available» with something more said («for this car», «only Honda»): that, without the «sorry». */
function naNote(t: string): string {
  const s = t
    .replace(/\b(n\/?a|not\s*(?:available|availabl|avl|avail|in\s*stock)|no\s*(?:have|stock|stok|available)|out\s*of\s*stock|nil|finished)\b/gi, ' ')
    .replace(/\bsor+y+\b/gi, ' ')
    // a part number said with it is not a word of the note
    .split(/[\s\-]+/)
    .filter((w) => w && !/\d/.test(w))
    .map((w) => w.replace(/[^\p{L}]/gu, ''))
    .filter((w) => w && !/^(na|no|not|n)$/i.test(w))
    .join(' ')
    .trim();
  return s.length >= 3 ? s.slice(0, 80) : '';
}

/* ---------- Which part a line is about ---------- */

const SKIP = new Set(['LEFT', 'RIGHT', 'AND', 'FRONT', 'REAR', 'SIDE', 'THE', 'FOR', 'WITH', 'SET', 'FULL', 'ORIGINAL', 'GENUINE', 'PCS', 'LTR', 'X']);

/** The part a free line names by a word of its own («gasket 85» → VALVE COVER GASKET); none — or two — say nothing. */
function byName(line: string, ask: AskLine[]): number | undefined {
  const lt = new Set(tokens(line).filter((w) => w.length >= 3 && !/^\d+$/.test(w)));
  let best = -1;
  let score = 0;
  let tie = false;
  ask.forEach((a, i) => {
    const s = nameTokens(a.name).filter((w) => w.length >= 3 && !SKIP.has(w) && [...lt].some((x) => x === w || (x.length >= 4 && (w.startsWith(x) || x.startsWith(w))))).length;
    if (s > score) {
      score = s;
      best = i;
      tie = false;
    } else if (s === score && s > 0) tie = true;
  });
  return score > 0 && !tie ? best : undefined;
}

/** A numbered line: its place and what follows our echoed name («1. SPARK PLUG ORIGINAL × 4  25x4 org» → «25x4 org»). */
function numbered(line: string, ask: AskLine[]): { index: number; rest: string } | undefined {
  const m = /^\s*(\d{1,2})\s*[.)\-:]\s*(.*)$/.exec(line);
  if (!m) return undefined;
  const index = Number(m[1]) - 1;
  if (index < 0 || index >= ask.length) return undefined;
  let rest = m[2];
  const want = nameTokens(ask[index].name);
  // Our name, echoed: its words taken off the front as far as they go (the supplier may cut it short).
  const re = /[\p{L}\p{N}]+/gu;
  let k = 0;
  let cut = 0;
  for (let w = re.exec(rest); w && k < want.length; w = re.exec(rest)) {
    if (w[0].toUpperCase() !== want[k]) break;
    k++;
    cut = w.index + w[0].length;
  }
  if (k >= Math.min(2, want.length)) rest = rest.slice(cut);
  // …and our quantity and number after it: «× 4», «x 4pcs», «(90919-01253)»
  rest = rest.replace(/^\s*[x×]\s*\d+\s*(pcs?)?\b/i, '').replace(/^\s*\([^)]*\)/, '');
  if (ask[index].number) rest = rest.split(ask[index].number).join(' ');
  return { index, rest };
}

const wantsOf = (a: AskLine): OfferKind | undefined => (/\b(ORIGINAL|GENUINE|OEM)\b/i.test(a.name) ? 'oem' : /\bUSED\b/i.test(a.name) ? 'used' : undefined);

/** A message that only says the kind («original», «Original better»): its kind. */
export function kindOnly(text: string): OfferKind | undefined {
  const ws = tokens(clean(text));
  if (!ws.length || ws.length > 3) return undefined;
  const kinds = ws.map((w) => kindOfWord(w)).filter(Boolean) as OfferKind[];
  return kinds.length === 1 && !atoms(text).length ? kinds[0] : undefined;
}

/**
 * A supplier's message read against the request it answers: for each part — its offers (price, kind, VAT, when, a
 * note) or «not available». `make` — the car's make (its own brand is the original).
 */
export function parseReply(text: string, ask: AskLine[], opts: { make?: string } = {}): ParsedReply {
  const out: ParsedReply = { lines: [], unmatched: [] };
  if (!ask.length) return out;
  const all = clean(text);
  if (ACK.test(all.trim())) return { ...out, ack: true };
  const raw = all.split('\n').map((l) => l.trim());
  // What holds for the whole message: «+TAX» or «ORIGINAL» on a line of its own.
  const lines: string[] = [];
  for (const l of raw) {
    if (ours(l)) continue;
    if (/^\+?\s*(vat|tax)\s*$/i.test(l) || /^\+\s*(vat|tax)\b/i.test(l)) {
      out.vatAll = 'net';
      continue;
    }
    if (/^(incl\.?|including|with)\s*(vat|tax)\s*$/i.test(l)) {
      out.vatAll = 'gross';
      continue;
    }
    const k = kindOnly(l);
    if (k) {
      out.kindAll = k;
      continue;
    }
    lines.push(l);
  }
  // A list numbered past the request's own parts answers another request.
  if (lines.some((l) => Number(/^\s*(\d{1,2})\s*[.)]\s+\p{L}/u.exec(l)?.[1] ?? 0) > ask.length)) return { ...out, other: true, unmatched: lines };
  const byIndex = new Map<number, ReplyOffer[]>();
  const add = (index: number, offers: ReplyOffer[]) => {
    if (!offers.length) return;
    byIndex.set(index, [...(byIndex.get(index) ?? []), ...offers]);
  };
  const ctx = (i: number) => ({ qty: ask[i].qty || 1, wants: wantsOf(ask[i]), make: opts.make, vatAll: out.vatAll, name: nameTokens(ask[i].name) });
  const free: string[] = [];
  for (const l of lines) {
    const n = numbered(l, ask);
    if (n) {
      const offers = offersOf(n.rest, ctx(n.index));
      if (offers.length) add(n.index, offers);
      else if (n.rest.replace(/[\s\-.:]+/g, '')) out.unmatched.push(l);
    } else free.push(l);
  }
  // Lines without numbers: one part asked — all of them are its; else by a word of the part's name; else, as many
  // priced lines as parts, in their order.
  const priced = free.filter((l) => atoms(l).length || NA.test(l) || PENDING.test(l));
  if (ask.length === 1) {
    for (const l of priced) add(0, offersOf(l, ctx(0)));
    for (const l of free) if (!priced.includes(l) && l) out.unmatched.push(l);
  } else {
    const left: string[] = [];
    for (const l of priced) {
      const i = byName(l, ask);
      if (i !== undefined) add(i, offersOf(l, ctx(i)));
      else left.push(l);
    }
    const allNa = left.length && left.every((l) => !atoms(l).length && (NA.test(l) || /\bsor+y\b/i.test(l)));
    if (left.length && !byIndex.size && allNa && left.length === 1) {
      // «NOT AVAILABLE» to the whole request
      ask.forEach((_, i) => add(i, offersOf(left[0], ctx(i))));
      out.naAll = true;
    } else if (left.length && left.length === ask.length && !byIndex.size) {
      left.forEach((l, i) => add(i, offersOf(l, ctx(i))));
    } else out.unmatched.push(...left);
    for (const l of free) if (!priced.includes(l) && l && !ACK.test(l)) out.unmatched.push(l);
  }
  // The kind said for the whole message: on the offers that did not say theirs.
  for (const [index, offers] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    if (out.kindAll) for (const o of offers) if (!o.kindSaid && !o.na) Object.assign(o, { kind: out.kindAll, kindSaid: true });
    if (out.vatAll) for (const o of offers) if (o.vat === 'unsaid' && !o.na) o.vat = out.vatAll;
    out.lines.push({ index, offers });
  }
  return out;
}

/** A unit's price without VAT, fils, as the line's cost is kept: a price «with VAT» has it taken out (5 % — `vatBp`). */
export function netUnit(o: Pick<ReplyOffer, 'unitFils' | 'vat'>, assume: 'net' | 'gross', vatBp: number): number | undefined {
  if (o.unitFils === undefined) return undefined;
  const gross = o.vat === 'gross' || (o.vat === 'unsaid' && assume === 'gross');
  return gross ? roundFils((o.unitFils * 10000) / (10000 + vatBp)) : o.unitFils;
}

/* ---------- Which request an answer is to ---------- */

export interface AskRef {
  id: string;
  at: number;
  /** The request's words as sent (its car line, its VIN). */
  text: string;
}

const vinOf = (s: string) => /\b([A-HJ-NPR-Z0-9]{17})\b/i.exec(s)?.[1]?.toUpperCase();
const firstLine = (s: string) =>
  clean(s)
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
    ?.toUpperCase() ?? '';

/**
 * The request a message answers, of those sent to this supplier before it: the one it quotes (its VIN, its car line),
 * the one whose VIN it names, else the last one sent before it (three days at most).
 */
export function askFor<T extends AskRef>(msg: { t: number; text: string; quote?: string }, asks: T[], maxAge = 3 * 24 * 60 * 60_000): T | undefined {
  const before = asks.filter((a) => a.at <= msg.t + 60_000).sort((a, b) => b.at - a.at);
  const quoteVin = msg.quote ? vinOf(msg.quote) : undefined;
  if (msg.quote) {
    const q = firstLine(msg.quote);
    const hit = before.find((a) => (quoteVin && vinOf(a.text) === quoteVin) || (q && firstLine(a.text) === q));
    if (hit) return hit;
  }
  const vin = vinOf(msg.text);
  if (vin) {
    const hit = before.find((a) => vinOf(a.text) === vin);
    if (hit) return hit;
  }
  const last = before[0];
  return last && msg.t - last.at <= maxAge ? last : undefined;
}
