import { CAR_CATALOG, CAR_MAKES, canonicalMake } from './carCatalog';
import { vinCarLocal } from './vinDecode';
import { vinsInText } from './vin';
import { kindOf, type WaMessage } from './whatsapp';

/*
 * What a supplier's chat teaches the garage (v0.91, the owner: «ИИ должен быстро обрабатывать новые чаты или уже
 * существующие… на какие марки авто она часто отвечает… те кто долго или часто пишут нету в наличии или не отвечает —
 * снизить их рейтинг; а те кто чаще всего отвечает, быстро и часто даёт цены — повысить и при поиске деталей показывать
 * самыми первыми»; «в реальном времени изучать переписки… накапливать знание»). Pure, without the AI — the chat's own
 * messages say it:
 *  - a request (`Turn`) is the garage writing to it after a quiet half hour (or two days without an answer) with a car, a
 *    part, a list, a photo or a voice in it — «ok», «thanks», «location?» are not; what follows in the same conversation is
 *    the same request;
 *  - its answer — the supplier's first message within two days (how long it took); a price in what it said within a day;
 *    «not available» (and no price);
 *  - the makes it was asked for — the car the request named (a make, a model of the catalogue, a VIN);
 *  - kept as they come (`mergeTurns`): an old request stays when the chat is read again — the garage's knowledge grows.
 * What it comes to — `seenOf` (the counts), `rateSeen` (a rating, −30…+30 for the order, 1–5 to show) and `chatMakes`
 * (the makes it is known for: by hand, answered for, said by the AI).
 */

/** A request the garage made in a chat and what came of it. */
export interface Turn {
  /** When the garage wrote (ms). */
  t: number;
  /** Seconds to the supplier's first answer (none — not answered, or not yet). */
  r?: number;
  /** Its answer had a price in it. */
  p?: 1;
  /** It said «not available» (and gave no price). */
  na?: 1;
  /** The makes the request named (the catalogue's spelling). */
  mk?: string[];
}

const MIN = 60_000;
/** Quiet this long and the garage's next message is a new request. */
const GAP = 30 * MIN;
/** An answer counts within two days; a request older than that and not answered — not answered. */
const ANSWER = 48 * 60 * MIN;
/** What the supplier said within a day of the request is its answer (a price, «not available»). */
const WINDOW = 24 * 60 * MIN;
/** The requests kept of a chat (the newest) — v0.91.5: enough for a chat's whole history, from the phone's export too. */
export const KEEP_TURNS = 1000;

/* ---------- Makes in words ---------- */

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Model names that are words of their own too («spark» plug, «seal», «charger», «crown» wheel): not a make by themselves. */
const NOT_MODELS = new Set(
  'rush crown echo kicks accent venue soul city jazz pilot passport edge escape territory fusion focus groove spark express terrain journey compass navigator corsair master expert boxer partner symbol swift alto legacy ascent whale preface hunter dashing seal tang dolphin shark ghost phantom dawn spectre roma tipo rapid rosa falcon oyster dost cooper transit neon caliber charger golf logan talisman jumpy superb canter'.split(
    ' ',
  ),
);
/** Makes that are words too («tank», «mini»): only with a model. */
const NOT_MAKES = new Set(['tank', 'mini']);
/** How people write makes in chats. */
const ALIASES: Record<string, string> = {
  benz: 'Mercedes-Benz',
  mercedes: 'Mercedes-Benz',
  merc: 'Mercedes-Benz',
  chevy: 'Chevrolet',
  vw: 'Volkswagen',
  infinity: 'Infiniti',
  landrover: 'Land Rover',
  rangerover: 'Land Rover',
  prado: 'Toyota',
  landcruiser: 'Toyota',
  minicooper: 'Mini',
};

let index: Map<string, string> | undefined;
/** Every make's and model's spelling (no spaces, no dashes) → its make. A model two makes share is left out. */
function wordIndex(): Map<string, string> {
  if (index) return index;
  const out = new Map<string, string>();
  const twice = new Set<string>();
  for (const [make, models] of Object.entries(CAR_CATALOG)) {
    for (const m of models) {
      const k = key(m);
      // a name of letters (not «86», «CX-5»), four or more, not an everyday word
      if (k.length < 4 || /\d/.test(k) || NOT_MODELS.has(m.toLowerCase())) continue;
      if (out.has(k) && out.get(k) !== make) twice.add(k);
      out.set(k, make);
    }
  }
  for (const k of twice) out.delete(k);
  for (const make of CAR_MAKES) if (!NOT_MAKES.has(key(make))) out.set(key(make), make);
  for (const [k, make] of Object.entries(ALIASES)) out.set(k, make);
  index = out;
  return out;
}

/** The car makes some words name — a make, a model of the catalogue, a VIN — each once, the catalogue's spelling. */
export function makesInText(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const vin of vinsInText(text.toUpperCase())) {
    const make = vinCarLocal(vin).make;
    if (make) found.add(canonicalMake(make));
  }
  const idx = wordIndex();
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    // «LC200», «LC300» — a Land Cruiser
    if (/^lc\d{2,3}$/.test(words[i])) {
      found.add('Toyota');
      continue;
    }
    // «Land Cruiser Prado», «Range Rover», «Mercedes Benz»: the longest first
    for (const n of [3, 2, 1]) {
      if (i + n > words.length) continue;
      const make = idx.get(words.slice(i, i + n).join(''));
      if (!make) continue;
      found.add(make);
      i += n - 1;
      break;
    }
  }
  return [...found];
}

/* ---------- Prices and «not available» ---------- */

const UNIT_AFTER = /^\s*(mm|cm|m\b|l\b|lt\b|ltr|ltrs|liters?|litres?|ml|kg|g\b|gm|pcs?|pieces?|nos|v\b|volts?|w\b|amps?|ah\b|inch|km|kms|hp|cc|days?|months?|years?|yrs?|hrs?|hours?|mins?|minutes?|am\b|pm\b|%|th\b|st\b|nd\b|rd\b)/i;
const SAID_AFTER = /^\s*(aed|dhs?|dirhams?|درهم|\/-)/i;
const SAID_BEFORE = /(aed|dhs?|price|rate|cost|total|=|:|@)\s*$/i;

/** Does a supplier's message give a price (a sum in AED, not a year, a size, a part's or a phone's number)? */
export function hasPrice(text: string): boolean {
  if (!text) return false;
  const s = text
    // a VIN, a phone or a long number, a part's number with dashes, a day, a time
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, ' ')
    .replace(/(?:\+|00)?971[\d -]{8,12}\d|\b05\d[\d -]{6,9}\d|\d{9,}/g, ' ')
    .replace(/\b[A-Z0-9]*\d+(?:-[A-Z0-9]+)+\b/gi, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{1,2}\.\d{1,2}\.\d{2,4}\b|\b\d{1,2}:\d{2}\b/g, ' ');
  for (const m of s.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?/g)) {
    const raw = m[0];
    const at = m.index ?? 0;
    const before = s.slice(Math.max(0, at - 12), at);
    const after = s.slice(at + raw.length);
    // inside a code («A4», «X5», «2GR»), a size or a time
    if (/[a-z]$/i.test(before) && !SAID_BEFORE.test(before)) continue;
    if (/^[a-z]/i.test(after) && !SAID_AFTER.test(after) && !/^x\s*\d/i.test(after)) continue;
    if (UNIT_AFTER.test(after)) continue;
    const n = Number(raw.replace(/,(?=\d{3})/g, '').replace(',', '.'));
    const said = SAID_AFTER.test(after) || SAID_BEFORE.test(before);
    // a car's year («Camry 2015»), unless said as a sum
    if (Number.isInteger(n) && n >= 1980 && n <= 2035 && !said) continue;
    if (said ? n >= 5 : n >= 10 && n <= 60_000) return true;
  }
  return false;
}

const NA_WORDS =
  /\b(n\/?a|not\s*(?:available|availabl|avl|avail|in\s*stock|have)|no\s*(?:have|stock|stok|available|availability|item)|out\s*of\s*stock|nil|finished|don'?t\s+have|dont\s+have|nahi|nai\s+hai)\b|غير\s*متوفر|ما\s*في|مافي|مو\s*موجود|нет\s+в\s+наличии/i;
const NO_ONLY = /^\s*(no|nope|nahi|nai|na|لا|нет)\s*[.!]*\s*$/i;

/** «Not available», «no have», a plain «no». */
export const saysNotAvailable = (text: string): boolean => !!text && (NA_WORDS.test(text) || NO_ONLY.test(text));

/* ---------- Requests ---------- */

const ASKING = /\b(price|prices|available|availability|have|need|rate|how much|original|duplicate|genuine|used|org|dup)\b|سعر|متوفر|موجود|عندك/i;

/** The garage's messages that open a conversation: is it a request (a car, a part, a list, a photo, a voice)? */
function isRequest(mine: Pick<WaMessage, 'type' | 'text'>[]): boolean {
  for (const m of mine) {
    const kind = kindOf(m.type);
    if (kind === 'photo' || kind === 'video' || kind === 'voice' || kind === 'audio' || kind === 'file') return true;
    const text = m.text ?? '';
    if (!text.trim()) continue;
    if (makesInText(text).length) return true;
    if (/^\s*\d+[.)]\s*\S/m.test(text)) return true;
    if (text.trim().length >= 8 && ASKING.test(text)) return true;
  }
  return false;
}

/**
 * The garage's requests in a chat's messages (any order; the account's own side is `me`) and what came of each. A request
 * not answered has no `r` — still open while it is younger than two days (`seenOf` does not count it against).
 */
export function turnsOf(messages: Pick<WaMessage, 't' | 'me' | 'type' | 'text'>[]): Turn[] {
  const list = [...messages].filter((m) => m.t > 0 && kindOf(m.type) !== 'call' && kindOf(m.type) !== 'gone').sort((a, b) => a.t - b.t);
  const out: Turn[] = [];
  let cur: { t: number; mine: typeof list; theirs: typeof list } | null = null;
  let lastT = 0;
  const close = () => {
    if (!cur || !isRequest(cur.mine)) return;
    const turn: Turn = { t: cur.t };
    const first = cur.theirs.find((m) => m.t - cur!.t <= ANSWER);
    if (first) turn.r = Math.max(0, Math.round((first.t - cur.t) / 1000));
    const said = cur.theirs.filter((m) => m.t - cur!.t <= WINDOW);
    if (said.some((m) => hasPrice(m.text ?? ''))) turn.p = 1;
    else if (said.some((m) => saysNotAvailable(m.text ?? ''))) turn.na = 1;
    const mk = [...new Set(cur.mine.flatMap((m) => makesInText(m.text ?? '')))];
    if (mk.length) turn.mk = mk;
    out.push(turn);
  };
  for (const m of list) {
    if (m.me) {
      // A greeting answered («Salam» — «Walaikum salam») is no request: what the garage writes next starts one.
      const fresh = !cur || (cur.theirs.length ? m.t - lastT > GAP || !isRequest(cur.mine) : m.t - cur.t > ANSWER);
      if (fresh) {
        close();
        cur = { t: m.t, mine: [m], theirs: [] };
      } else if (!cur!.theirs.length) cur!.mine.push(m);
    } else if (cur) cur.theirs.push(m);
    lastT = m.t;
  }
  close();
  return out;
}

/**
 * What a chat was read to now, put over what was kept: the kept requests from before the messages read stay (the garage's
 * knowledge grows past the messages read at once); those read again — as now. The newest `KEEP_TURNS`.
 */
export function mergeTurns(kept: Turn[] | undefined, fresh: Turn[], readFrom: number): Turn[] {
  const old = (kept ?? []).filter((x) => x.t < readFrom);
  return [...old, ...fresh].sort((a, b) => a.t - b.t).slice(-KEEP_TURNS);
}

/**
 * A chat's export put over what was kept (v0.91.5): its requests take the time it covers (`from`…`to`); kept ones before and
 * after it (read from the server since) stay. The newest `KEEP_TURNS`.
 */
export function spliceTurns(kept: Turn[] | undefined, fresh: Turn[], from: number, to: number): Turn[] {
  const old = (kept ?? []).filter((x) => x.t < from || x.t > to);
  return [...old, ...fresh].sort((a, b) => a.t - b.t).slice(-KEEP_TURNS);
}

/* ---------- What it comes to ---------- */

export interface ChatSeen {
  /** Requests decided: answered, or two days passed without an answer. */
  turns: number;
  answered: number;
  priced: number;
  na: number;
  /** Still within its two days, not answered. */
  open: number;
  /** The middle of its answering times, minutes. */
  replyMin?: number;
  /** Requests answered, by the make they named. */
  makes: Record<string, number>;
  /** The last request (ms). */
  lastAt?: number;
}

export function seenOf(turns: Turn[] | undefined, now: number): ChatSeen {
  const out: ChatSeen = { turns: 0, answered: 0, priced: 0, na: 0, open: 0, makes: {} };
  const times: number[] = [];
  for (const x of turns ?? []) {
    out.lastAt = Math.max(out.lastAt ?? 0, x.t);
    if (x.r === undefined && now - x.t < ANSWER) {
      out.open++;
      continue;
    }
    out.turns++;
    if (x.r === undefined) continue;
    out.answered++;
    times.push(x.r);
    if (x.p) out.priced++;
    else if (x.na) out.na++;
    for (const m of x.mk ?? []) out.makes[m] = (out.makes[m] ?? 0) + 1;
  }
  if (times.length) {
    times.sort((a, b) => a - b);
    const mid = times.length >> 1;
    const sec = times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
    out.replyMin = Math.max(1, Math.round(sec / 60));
  }
  return out;
}

export interface ChatRating {
  /** For the order of lists: about −30 (silent, «not available», slow) … +30 (answers fast, with prices). */
  score: number;
  /** As stars, 1–5. */
  stars: number;
}

/** Fewer decided requests than this — too little to say. */
export const RATE_FROM = 2;

/** How well a supplier answers the garage's requests (none — too few of them yet). */
export function rateSeen(s: ChatSeen): ChatRating | undefined {
  if (s.turns < RATE_FROM) return undefined;
  const answered = s.answered / s.turns;
  const priced = s.priced / s.turns;
  const notThere = s.answered ? s.na / s.answered : 0;
  const m = s.replyMin;
  const speed = m === undefined ? 0 : m <= 15 ? 1 : m <= 60 ? 0.7 : m <= 180 ? 0.35 : m <= 720 ? 0 : -0.5;
  const q = 0.35 * answered + 0.3 * priced + 0.35 * ((speed + 0.5) / 1.5) - 0.5 * Math.max(0, notThere - 0.2);
  // Two requests say less than ten.
  const sure = Math.min(1, s.turns / 6);
  return { score: Math.round((q - 0.5) * 60 * sure), stars: Math.max(1, Math.min(5, Math.round(1 + 4 * Math.max(0, q)))) };
}

export type MakeBy = 'hand' | 'seen' | 'ai';
export interface KnownMake {
  make: string;
  by: MakeBy;
  /** Requests for it answered (by `seen`). */
  n?: number;
}

/**
 * The makes a chat is known for: given by hand (they are all); else answered for — twice or more, or once when it is the
 * only one — the most first; then what the AI said (not already there). Each once.
 */
export function chatMakes(x: { hand?: string[]; seen?: ChatSeen; ai?: string[] }): KnownMake[] {
  const out: KnownMake[] = [];
  const has = new Set<string>();
  const add = (make: string, by: MakeBy, n?: number) => {
    const m = canonicalMake(make);
    const k = m.toLowerCase();
    if (!m || has.has(k)) return;
    has.add(k);
    out.push(n ? { make: m, by, n } : { make: m, by });
  };
  for (const m of x.hand ?? []) add(m, 'hand');
  if (!out.length) {
    const seen = Object.entries(x.seen?.makes ?? {}).sort((a, b) => b[1] - a[1]);
    for (const [m, n] of seen) if (n >= 2 || seen.length === 1) add(m, 'seen', n);
    for (const m of x.ai ?? []) add(m, 'ai');
  }
  return out;
}

/* ---------- Who a chat is: what its own words show (v0.91.2) ---------- */

/**
 * The owner (27/11): «ИИ очень плохо анализировал чаты — те, что ни к чему и не к гаражу, он присвоил статус клиента или
 * поставщика». The AI's word on a chat counts only when the chat's own words back it (`backedRole`): a customer — a car or
 * work on one talked about (a make or a model, repair, service, invoice, «ready»…); a supplier — a request of the garage
 * answered with a price or «not available», their price for a part or a car, or a parts / towing / tyres business by its
 * name. What was read of a chat is kept as these two marks only (`ChatSigns`) — never its words.
 */
export interface ChatSigns {
  /** A car or work on one is talked about. */
  car?: 1;
  /** Parts are priced, offered or asked of them and answered. */
  parts?: 1;
}

const WORK =
  /\b(car|cars|vehicle|repair|repairs|fix|service|servicing|check|checking|noise|engine|brakes?|a\/?c|gear ?box|suspension|tyres?|tires?|battery|oil change|accident|bumper|garage|workshop|invoice|quotation|estimate|bill|pick ?up|collect|mulkiya|registration)\b|سيار|تصليح|فاتورة|ورشة|كراج/i;
const PART_WORDS =
  /\b(org|orig|original|genuine|dup|dupl|duplicate|copy|used|available|avail|pcs|piece|stock|bumper|head ?light|tail ?light|filter|pads?|discs?|shock|mount(?:ing)?|radiator|compressor|sensor|bearing|belt|pump|gasket|clutch|alternator|starter|mirror|grill|fender|bonnet|lamp)\b|قطع|غيار/i;
/** A business that sells parts or works on cars for others, by its name. */
const PARTS_NAME =
  /\b(spare|spares|parts?|tyres?|tires?|batter(?:y|ies)|lubricants?|oils?|towing|recovery|radiators?|gear ?box(?:es)?|scrap|paint|denting|upholstery|machining|tinting)\b|قطع|غيار/i;

/** What a chat's messages show (and its requests: one answered with a price or «not available» — parts). */
export function chatSigns(messages: Pick<WaMessage, 'me' | 'text'>[], turns?: Turn[]): ChatSigns {
  const out: ChatSigns = {};
  for (const m of messages) {
    const text = m.text ?? '';
    if (!text.trim()) continue;
    const makes = makesInText(text).length > 0;
    if (!out.car && (WORK.test(text) || makes)) out.car = 1;
    if (!out.parts && !m.me && hasPrice(text) && (makes || PART_WORDS.test(text))) out.parts = 1;
    if (out.car && out.parts) break;
  }
  if (!out.parts && turns?.some((x) => x.r !== undefined && (x.p || x.na))) out.parts = 1;
  return out;
}

/** Both read: what either showed. */
export const mergeSigns = (a: ChatSigns | undefined, b: ChatSigns | undefined): ChatSigns => ({ ...(a?.car || b?.car ? { car: 1 } : {}), ...(a?.parts || b?.parts ? { parts: 1 } : {}) });
/** The marks as a word ('', 'c', 'p', 'cp') — to see they grew since the AI was asked. */
export const signsKey = (s: ChatSigns | undefined): string => `${s?.car ? 'c' : ''}${s?.parts ? 'p' : ''}`;

/** The AI's word, as far as the chat's own words back it — else «other». */
export function backedRole(role: 'customer' | 'supplier' | 'other', signs: ChatSigns | undefined, name: string): 'customer' | 'supplier' | 'other' {
  if (role === 'supplier') return signs?.parts || PARTS_NAME.test(name) ? 'supplier' : 'other';
  if (role === 'customer') return signs?.car ? 'customer' : 'other';
  return 'other';
}

/**
 * A chat's words for the AI: who wrote each line («G:» — the garage, «T:» — them), the lines that tell (a car, work, a price)
 * first, then the last ones; eight at most, in their order, each a short line.
 */
export function wordsForAi(messages: Pick<WaMessage, 'me' | 'text' | 't'>[], max = 8): string[] {
  const lines = messages.filter((m) => (m.text ?? '').trim().length >= 2);
  const telling = lines.filter((m) => WORK.test(m.text) || hasPrice(m.text) || makesInText(m.text).length > 0).slice(-5);
  const last = lines.slice(-3);
  const picked = [...new Set([...telling, ...last])].sort((a, b) => a.t - b.t).slice(-max);
  return picked.map((m) => `${m.me ? 'G' : 'T'}: ${m.text.replace(/\s+/g, ' ').trim().slice(0, 160)}`);
}

/** The AI's question about who chats are, as asked now (v0.91.2) — an older answer is asked again. */
export const AI_ROLES_V = 3;
