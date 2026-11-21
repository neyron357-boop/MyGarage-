import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { catalogSlugs, catalogUrl, readCatalogPage } from './catalog.mjs';
import { createPartFind, parseFound } from './partfind.mjs';
import { DIRS, httpError } from './store.mjs';

export { parseFound };

/*
 * The garage's AI (v0.48, the user: «внедри ИИ Gemini»): Google's Gemini, called from this computer only — its key
 * stays here (Служебное/ai.json, or GEMINI_API_KEY), never on a phone, in the app's code or in the repository.
 *
 *   vin(vin)          — the car a VIN is: the official NHTSA decoder's facts (vpic.nhtsa.dot.gov, free, no key) alone
 *                       when they are enough (v0.49), else Gemini reads them with the VIN (cars sold outside the USA:
 *                       the decoder knows little of them);
 *   partName(…)       — a part's name as typed, its spelling mistakes put right, and its English name;
 *   partFind(…)       — the part's number in the open catalogues (v0.49, two steps — a JSON answer kept Gemini 3 from
 *                       searching at all, it answered from memory with made-up page addresses): 1. Gemini searches the
 *                       web and reads the pages, answering in plain words (Google Search — a paid Gemini plan; without
 *                       it — its own knowledge, «not checked»); 2. a light model writes that answer down as JSON. This
 *                       computer then opens the pages named, checks each number is on them, fetches the pictures and has
 *                       a light model say which is the part's diagram and which a photo of the part.
 *
 * Tokens (v0.49, the user: «чтобы меньше тратил токены»): every answer is kept — in SQLite through the store when
 * there is one, so a restart loses nothing and every device shares it; thinking is kept low (a part number looked up
 * with low thinking cost 831 tokens against 22 000 with the default, the same number); what each call spent is counted
 * (`usage`, shown on this computer's page). What the app takes as true is decided in the app (domain/ai.ts): this
 * only says what was found and where.
 *
 * Faster and cheaper (v0.54, the user: «сделай процесс поиска ИИ намного быстрее; оптимизируй расход токенов»): measured on
 * the real Gemini, a part took ~29 s, 3 questions, 6–9 Google searches (each paid) and 5–8 thousand tokens. Now: the
 * search with Google only (the pages it opened whole — `url_context` — cost seconds and thousands of tokens; this
 * computer opens them itself), «one or two searches»; its answer in lines this computer reads itself (no second question
 * to write it down as JSON — only when the lines are not there); asked again only when nothing was found, then with the
 * pages read (never with more thinking); pages and pictures fetched together, each with a short limit; the pictures
 * looked at in low resolution (265 tokens a picture instead of 1 098); the light models' small questions with minimal
 * thinking (the stronger ones do not take it — low).
 *
 * Deeper, surer, cheaper (v0.55 — partfind.mjs, catalog.mjs): a number is first looked for without a paid search — the
 * garage's own numbers and the model's own knowledge, each read by this computer in the open catalogue (it exists, it
 * is that part, it is on this model's diagram in these years) — and the web is asked only when that did not find it:
 * one search, then with the pages read, then a deep one. The part's factory diagram comes from the catalogue, its
 * callout's place with it; a photo of the part after. No car — nothing is asked at all.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
/** The light models, for the small questions (a name, a picture, writing an answer down): seconds, a few hundred tokens. */
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
const COOL = 10 * 60_000;
/** A part's number is worth a stronger model: it searches better. The light ones if the strong do not answer. */
const FIND_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const LOOK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
/** A receipt: every digit counts (the date under a stamp, a total) — the stronger model reads it, the light ones if it does not answer. */
const RECEIPT_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
/** A page or a picture: this long at most a step (v0.54 — 12–15 s held a part up); all of them together — `FETCH_MS`. */
const PAGE_MS = 6_000;
const FETCH_MS = 8_000;
const DAY = 24 * 60 * 60_000;
/** How long an answer serves: a VIN and a name do not change; a number found on the web — a month; a guess — half an hour. */
const TTL = { vin: 365 * DAY, name: 365 * DAY, web: 30 * DAY, proven: 365 * DAY, model: 30 * 60_000, catalog: 90 * DAY, noPage: 7 * DAY };
const UA = 'Mozilla/5.0 (MyGarage parts lookup)';

/*
 * The questions, ready-made («заготовки»): short, every word earning its tokens, the facts the app already knows put
 * in front of the model instead of being asked of it.
 */
const P = {
  vin: (vin, facts, built) =>
    `VIN ${vin} (car built in ${built || 'unknown region'}; garage in the UAE). NHTSA decoder says: ${facts ? JSON.stringify(facts) : 'nothing'}.
Give make, model (as sold, e.g. "Land Cruiser"), year, engine ("4.0L V6"; "" if unknown), body (one of pickup, van, bus, truck, suv, mpv, sedan; "" if unknown), confidence 0..1. Empty rather than a guess.`,
  name: (name, car) =>
    `Spare part name typed at a UAE garage${car ? ` for a ${car}` : ''}: "${name}". It may have typos; it may be English, Russian, or Russian in Latin letters.
fixed: the same words in the same order and language, only spelling put right (keep numbers, sizes, front/rear/left/right); english: the usual English invoice name (e.g. "FRONT BRAKE PADS"); isPart: is it a car part or service item; confidence 0..1 for fixed.`,
  receipt: () =>
    `A photo of a supplier's invoice or receipt in the UAE (amounts in AED; VAT 5 %). The garage is the buyer; read the seller's paper exactly as printed.
Return: isReceipt (an invoice/receipt/bill at all); vendor (the seller's name as printed, not the buyer's); vendorTrn; vendorPhone (a mobile first, "" if none); vendorAddress (a few words, "" if none); kind — "parts" (car parts, accessories, oils, consumables), "service" (a workshop's or contractor's bill for work: paint, alignment, machining, towing, car wash), "fuel", "food" or "other"; invoiceNo;
dateText — the document's date exactly as printed ("18-Nov-2026", "17/11/26"; "" if none); date — that date as YYYY-MM-DD: UAE papers write the day first (05/11/2026 is 5 November); read every digit of day, month and year — a stamp or a fold may cover some; dateSure — false if any digit of the date is hidden or unclear;
items — each {name (as printed), part (the usual English name of the part alone: no brand, car, years, sizes, side or quantity — "TAIL LIGHT COVER", "MUD FLAP", "ATF PAN GASKET"), car (the car make/model the line names, "" if none), partNumber ("" if none), qty, unitPrice, total (as printed)};
subtotal (before VAT, "" if not printed); vat (as printed, 0 if the paper says none, "" if not printed); total (the amount to pay incl. VAT); paymentMethod ("cash", "card", "transfer", "credit" when it says credit / sales credit / unpaid / due, "" if not said); carText (car model, plate, chassis or VIN on the paper, "" if none); confidence 0..1.
Numbers as numbers; never invent a value the paper does not show.`,
  look: (n, part, car) =>
    `${n} pictures from parts-catalogue pages for "${part}"${car ? ` of a ${car}` : ''}, each under its label «Picture N:» (N 1…${n}); answer with index = N.
For each: kind — "diagram" (catalogue/exploded drawing showing this part), "photo" (a photograph of this kind of part itself; not the car, not a box only) or "other" (logos, banners, the car, other parts); matches — is it really "${part}".`,
};

/** The JSON a model wrote (in a ```json fence or around words, when it could not be held to a schema). */
export function parseJson(text) {
  const s = String(text ?? '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return undefined;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return undefined;
  }
}

/** A part number as catalogues differ in writing it (04465-33471, 0446533471, 04465 33471): letters and digits. */
export const plainNumber = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** What came within `ms`: the rest let go (a slow page or picture does not hold the answer up). */
async function within(promises, ms) {
  const out = new Array(promises.length).fill(null);
  let timer;
  await Promise.race([
    Promise.all(promises.map((p, i) => p.then((v) => (out[i] = v), () => null))),
    new Promise((r) => (timer = setTimeout(r, ms))),
  ]);
  clearTimeout(timer);
  return out;
}

/** Where a VIN says the car was built — its first characters (the same model built in Japan and in the USA takes different numbers). */
export function builtWhere(vin) {
  const v = String(vin ?? '').toUpperCase();
  if (v.length < 3) return '';
  const a = v[0];
  const b = v[1];
  if ('145'.includes(a)) return 'USA';
  const one = { 2: 'Canada', 3: 'Mexico', 6: 'Australia', 7: 'New Zealand', 8: 'Argentina', 9: 'Brazil', J: 'Japan', K: 'Korea', L: 'China', W: 'Germany', X: 'Russia', Z: 'Italy', U: 'Europe' }[a];
  if (one) return one;
  if (a === 'M') return 'ABCDE'.includes(b) ? 'India' : 'FGHJK'.includes(b) ? 'Indonesia' : 'LMNPR'.includes(b) ? 'Thailand' : 'Asia';
  if (a === 'N') return 'LMNPR'.includes(b) ? 'Turkey' : 'Iran';
  if (a === 'P') return 'LMNPR'.includes(b) ? 'Malaysia' : 'Philippines';
  if (a === 'R') return 'ABCDE'.includes(b) ? 'UAE' : 'LMNPR'.includes(b) ? 'Taiwan' : 'Asia';
  if (a === 'S') return 'ABCDEFGHJKLM'.includes(b) ? 'UK' : 'NPRST'.includes(b) ? 'Germany' : 'Poland';
  if (a === 'T') return 'ABCDEFGH'.includes(b) ? 'Switzerland' : 'JKLMNP'.includes(b) ? 'Czech Republic' : 'Hungary';
  if (a === 'V') return 'ABCDE'.includes(b) ? 'Austria' : 'FGHJKLMNPR'.includes(b) ? 'France' : 'Spain';
  if (a === 'Y') return 'ABCDE'.includes(b) ? 'Belgium' : 'FGHJK'.includes(b) ? 'Finland' : 'Sweden';
  return '';
}

/** An address on the open internet only: never this computer, its network or anything inside it. */
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:') && privateIp(x.slice(7));
}

export async function publicUrl(u, lookup = dns.lookup) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || /^(localhost|.*\.local|.*\.internal)$/i.test(host)) return false;
  if (net.isIP(host)) return !privateIp(host);
  try {
    const all = await lookup(host, { all: true });
    return all.length > 0 && all.every((r) => !privateIp(r.address));
  } catch {
    return false;
  }
}

/** The text of a page, for looking a number up in it. */
export function pageText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/**
 * The pictures of a page that may be the part's diagram: the page's own picture (og:image) and pictures whose address
 * or caption names the part's number or says diagram / illustration / scheme — the likeliest first.
 */
export function diagramImages(html, base, numbers = []) {
  const out = [];
  const add = (src, score) => {
    if (!src) return;
    try {
      const u = new URL(src.replace(/&amp;/g, '&'), base).toString();
      if (!/^https?:/.test(u) || /\.svg(\?|$)/i.test(u) || /logo|icon|sprite|banner|avatar|flag|payment/i.test(u)) return;
      const had = out.find((x) => x.url === u);
      if (had) had.score = Math.max(had.score, score);
      else out.push({ url: u, score });
    } catch {
      // not an address
    }
  };
  const plain = numbers.map(plainNumber).filter((n) => n.length >= 5);
  const og = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/gi;
  for (const m of String(html).match(og) ?? []) add(/content=["']([^"']+)["']/i.exec(m)?.[1], 2);
  for (const m of String(html).match(/<img\b[^>]*>/gi) ?? []) {
    const src = /\b(?:data-src|data-original|src)=["']([^"']+)["']/i.exec(m)?.[1];
    if (!src || src.startsWith('data:')) continue;
    const words = `${src} ${/\balt=["']([^"']*)["']/i.exec(m)?.[1] ?? ''} ${/\btitle=["']([^"']*)["']/i.exec(m)?.[1] ?? ''}`;
    const named = plain.some((n) => plainNumber(words).includes(n));
    const diagram = /diagram|illustration|scheme|schema|exploded|figure|epc|catalog/i.test(words);
    if (named || diagram) add(src, (named ? 3 : 0) + (diagram ? 2 : 0));
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The body of a NHTSA decoder answer as the app's car: its model year, engine and body, when it gave them. */
export function carFromFacts(facts) {
  if (!facts) return null;
  const body = /pickup/i.test(facts.body) ? 'pickup' : /bus/i.test(facts.body) ? 'bus' : /truck/i.test(facts.body) && !/sport/i.test(facts.body) ? 'truck' : /minivan|mpv|multi-purpose/i.test(facts.body) ? 'mpv' : /^van|cargo van|van/i.test(facts.body) ? 'van' : /suv|sport utility|crossover/i.test(facts.body) ? 'suv' : /sedan|saloon|coupe|hatchback|wagon|convertible/i.test(facts.body) ? 'sedan' : '';
  const litres = Number(facts.litres) ? `${Number(facts.litres).toFixed(1)}L` : '';
  const cyl = Number(facts.cylinders) ? `${Number(facts.cylinders)}-cyl` : '';
  const engine = [litres, cyl].filter(Boolean).join(' ');
  const title = (s) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
  return { make: facts.make ? title(facts.make) : '', model: facts.model ? title(facts.model) : '', year: Number(facts.year) || undefined, engine, body };
}

export function createAi({ dataDir, env = process.env, log = () => {}, fetchImpl = fetch, lookup = dns.lookup, now = () => Date.now(), store } = {}) {
  const file = path.join(dataDir, DIRS.service, 'ai.json');
  const usageFile = path.join(dataDir, DIRS.service, 'ai-usage.json');
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // no key yet
  }
  const key = () => String(env.GEMINI_API_KEY || saved.key || '').trim();
  const models = () => (Array.isArray(saved.models) && saved.models.length ? saved.models : MODELS);
  /** How it went lately: shown on this computer's page. */
  const state = { lastOk: '', lastError: '', search: 'unknown' };
  /** Answers in memory (and in the store's SQLite when there is one). */
  const cache = new Map();
  const calls = new Map();
  /** Models that did not answer lately: until when they are passed over. */
  const cooling = new Map();
  const order = (list) => {
    const all = list ?? models();
    const ready = all.filter((m) => !(cooling.get(m) > now()));
    return ready.length ? ready : all;
  };

  /*
   * What the AI spent: questions, Google searches and tokens (in, out, thinking) by day — on this computer's page, so
   * the garage sees what its key pays for. Kept in Служебное/ai-usage.json; a month's worth.
   */
  let usage = {};
  try {
    usage = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
  } catch {
    // nothing spent yet
  }
  const day = () => new Date(now()).toISOString().slice(0, 10);
  function spent(kind, u, searches) {
    const d = day();
    const row = (usage[d] ??= { questions: 0, searches: 0, in: 0, out: 0, think: 0, byKind: {} });
    row.questions++;
    row.searches += searches;
    row.in += (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0);
    row.out += u?.candidatesTokenCount ?? 0;
    row.think += u?.thoughtsTokenCount ?? 0;
    row.byKind[kind] = (row.byKind[kind] ?? 0) + 1;
    for (const k of Object.keys(usage)) if (new Date(k).getTime() < now() - 62 * DAY) delete usage[k];
    try {
      fs.mkdirSync(path.dirname(usageFile), { recursive: true });
      fs.writeFileSync(usageFile, JSON.stringify(usage));
    } catch {
      // a count, not a need
    }
  }
  const sum = (days) => {
    const out = { questions: 0, searches: 0, in: 0, out: 0, think: 0, byKind: {} };
    for (const d of days) {
      const r = usage[d];
      if (!r) continue;
      out.questions += r.questions;
      out.searches += r.searches;
      out.in += r.in;
      out.out += r.out;
      out.think += r.think;
      for (const [k, v] of Object.entries(r.byKind)) out.byKind[k] = (out.byKind[k] ?? 0) + v;
    }
    return out;
  };
  const usageNow = () => {
    const d = day();
    return { today: sum([d]), month: sum(Object.keys(usage).filter((k) => k.slice(0, 7) === d.slice(0, 7))) };
  };

  async function timed(url, init, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      return await fetchImpl(url, { ...init, signal: ctl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * One question to Gemini; the next model when one is busy or gone. `search` — with Google Search and the pages it
   * finds (plain words then: a JSON schema keeps Gemini 3 from searching); `schema` — the answer as that JSON; `images` —
   * pictures to look at (inline); `models` — which, in turn; `thinking` — how much ("low" unless there is a reason).
   */
  async function ask(text, { kind = 'other', schema, search = false, read = false, images = [], lowImages = false, models: list, timeout = 25_000, thinking = 'low' } = {}) {
    if (!key()) throw httpError(503, 'ai off');
    // `read` — the pages Google finds read whole (url_context: seconds and thousands of tokens a page — only when a
    // search alone found nothing, v0.54); `lowImages` — pictures in low resolution (a quarter of the tokens: enough to
    // tell a drawing from a photo); thinking «minimal» — the light models only (the stronger ones refuse it: «low»).
    const bodyFor = (model) => ({
      // Each picture under its own label («Picture 1:»…): the answer names them by it.
      contents: [{ parts: [{ text }, ...images.flatMap((i, k) => [{ text: `Picture ${k + 1}:` }, { inline_data: { mime_type: i.type, data: i.data } }])] }],
      ...(search ? { tools: read ? [{ google_search: {} }, { url_context: {} }] : [{ google_search: {} }] } : {}),
      generationConfig: {
        temperature: 0,
        maxOutputTokens: search ? 4096 : 2048,
        thinkingConfig: { thinkingLevel: thinking === 'minimal' && !/lite/.test(model) ? 'low' : thinking },
        ...(lowImages && images.length ? { mediaResolution: 'MEDIA_RESOLUTION_LOW' } : {}),
        ...(schema && !search ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}),
      },
    });
    let last;
    for (const model of order(list)) {
      let res;
      try {
        res = await timed(`${API}/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key() }, body: JSON.stringify(bodyFor(model)) }, timeout);
      } catch (e) {
        last = httpError(504, `gemini ${model}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
        cooling.set(model, now() + COOL);
        continue;
      }
      if (res.ok) {
        const j = await res.json();
        const c = j.candidates?.[0];
        const out = (c?.content?.parts ?? []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
        state.lastOk = new Date(now()).toISOString();
        // What Google itself read: the search results (their sites), which of them back which words of the answer, the
        // pages opened whole (url_context).
        const gm = c?.groundingMetadata ?? {};
        const chunks = (gm.groundingChunks ?? []).map((g) => (g.web?.uri ? { url: g.web.uri, title: g.web.title || '' } : null));
        const sources = chunks.filter(Boolean);
        const supports = (gm.groundingSupports ?? []).map((x) => ({ text: x.segment?.text ?? '', sites: (x.groundingChunkIndices ?? []).map((i) => chunks[i]).filter(Boolean) }));
        const read = (c?.urlContextMetadata?.urlMetadata ?? []).filter((u) => /SUCCESS/.test(u.urlRetrievalStatus ?? '')).map((u) => u.retrievedUrl).filter(Boolean);
        const searches = (gm.webSearchQueries ?? []).length;
        if (search && sources.length) state.search = 'on';
        spent(kind, j.usageMetadata, searches);
        return { text: out, sources, supports, read, model, searched: sources.length > 0, usage: j.usageMetadata ?? {} };
      }
      let msg = res.statusText;
      try {
        msg = (await res.json())?.error?.message || msg;
      } catch {
        // not JSON
      }
      last = httpError(res.status === 429 ? 429 : res.status >= 500 || res.status === 404 ? 502 : res.status, `gemini ${model}: ${res.status} ${msg}`);
      // Google Search is a paid plan's: the key's quota for it is nil — every model will say the same.
      if (res.status === 429 && search) {
        state.search = 'off';
        throw Object.assign(last, { searchOff: true });
      }
      // A wrong key, a refused question: the next model would say the same.
      if (res.status === 400 || res.status === 401 || res.status === 403) break;
      cooling.set(model, now() + COOL);
    }
    state.lastError = `${new Date(now()).toISOString()} ${last?.message ?? 'no model answered'}`;
    log(`ai: ${last?.message}`);
    throw last ?? httpError(502, 'no model answered');
  }

  async function json(text, schema, opts = {}) {
    const r = await ask(text, { schema, ...opts });
    const value = parseJson(r.text);
    if (!value) throw httpError(502, 'gemini: no JSON');
    return { value, sources: r.sources, supports: r.supports ?? [], read: r.read ?? [], model: r.model };
  }

  /**
   * An answer kept: in memory while the server runs, in the store's SQLite for good (a restart, another device — the
   * same answer, no tokens). `ttl` — how long it serves, or how long for this answer (a guess — not long).
   */
  function cached(k, kind, ttl, make, { fresh = false } = {}) {
    const life = (r) => (typeof ttl === 'function' ? ttl(r) : ttl);
    const hit = cache.get(k);
    // Being made right now: the same answer for everyone who asks (also when asked anew).
    if (hit && !('result' in hit)) return hit.value;
    if (hit && !fresh && now() - hit.at < life(hit.result)) return hit.value;
    if (store?.aiCacheGet && !fresh) {
      const row = store.aiCacheGet(k);
      if (row && now() - row.at < life(row.value)) {
        const entry = { at: row.at, result: row.value, value: Promise.resolve(row.value) };
        cache.set(k, entry);
        return entry.value;
      }
    }
    const entry = { at: now() };
    entry.value = make().then(
      (v) => {
        entry.result = v;
        try {
          store?.aiCachePut?.(k, kind, entry.at, v);
        } catch (e) {
          log(`ai cache: ${e.message}`);
        }
        return v;
      },
      (e) => {
        cache.delete(k);
        throw e;
      },
    );
    cache.set(k, entry);
    return entry.value;
  }

  /** What is kept under a key, however old (where a deeper search starts from). */
  function peek(k) {
    const hit = cache.get(k);
    if (hit && 'result' in hit) return hit.result;
    try {
      return store?.aiCacheGet?.(k)?.value;
    } catch {
      return undefined;
    }
  }

  /** The open catalogue is asked a few pages at a time (a long list of parts must not come down on it at once). */
  let catalogBusy = 0;
  const catalogQueue = [];
  async function catalogTurn(fn) {
    if (catalogBusy >= 4) await new Promise((r) => catalogQueue.push(r));
    catalogBusy++;
    try {
      return await fn();
    } finally {
      catalogBusy--;
      catalogQueue.shift()?.();
    }
  }

  /**
   * A number's page in the open catalogue (catalog.mjs), read by this computer and kept: a quarter of a year (a part's
   * name and diagrams do not change), «no such number» a week. The car's make first, its sister make after (a Lexus
   * part under Toyota). None — null; the catalogue not answering — an error (not kept).
   */
  async function catalogPage(make, number) {
    for (const slug of catalogSlugs(make)) {
      const url = catalogUrl(slug, number);
      if (!url) continue;
      const got = await cached(`cat:${slug}-${plainNumber(number)}`, 'catalog', (r) => (r?.none ? TTL.noPage : TTL.catalog), () =>
        catalogTurn(async () => {
          if (!(await publicUrl(url, lookup))) return { none: true };
          const res = await timed(url, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html' } }, PAGE_MS);
          if (res.status === 404 || res.status === 410 || (res.status >= 300 && res.status < 400)) return { none: true };
          if (!res.ok) throw httpError(502, `catalogue: ${res.status}`);
          const read = readCatalogPage((await res.text()).slice(0, 2_000_000));
          return read ? { url, slug, ...read } : { none: true };
        }),
      );
      if (got && !got.none) return got;
    }
    return null;
  }

  /** The official decoder's facts (it knows the cars sold in the USA best; others — the maker and the year at least). */
  async function vpic(vin) {
    try {
      const res = await timed(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, {}, 10_000);
      if (!res.ok) return null;
      const r = (await res.json())?.Results?.[0] ?? {};
      const pick = (k) => String(r[k] ?? '').trim();
      const facts = {
        make: pick('Make'),
        model: pick('Model'),
        year: pick('ModelYear'),
        trim: pick('Trim'),
        series: pick('Series'),
        body: pick('BodyClass'),
        litres: pick('DisplacementL'),
        cylinders: pick('EngineCylinders'),
        fuel: pick('FuelTypePrimary'),
        country: pick('PlantCountry'),
      };
      return Object.values(facts).some(Boolean) ? facts : null;
    } catch {
      return null;
    }
  }

  async function page(url) {
    if (!(await publicUrl(url, lookup))) return null;
    try {
      let res = await timed(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (MyGarage parts lookup)', Accept: 'text/html' } }, PAGE_MS);
      // Search results come as Google's redirect addresses: followed one step at a time, each checked.
      for (let hop = 0; hop < 4 && res.status >= 300 && res.status < 400 && res.headers.get('location'); hop++) {
        url = new URL(res.headers.get('location'), url).toString();
        if (!(await publicUrl(url, lookup))) return null;
        res = await timed(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (MyGarage parts lookup)', Accept: 'text/html' } }, PAGE_MS);
      }
      if (!res.ok || !/html|text/i.test(res.headers.get('content-type') || '')) return null;
      const html = (await res.text()).slice(0, 3_000_000);
      return { url, html };
    } catch {
      return null;
    }
  }

  async function image(url, from, least = 6_000) {
    if (!(await publicUrl(url, lookup))) return null;
    try {
      const res = await timed(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MyGarage parts lookup)', Referer: from } }, PAGE_MS);
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!res.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      // Not a pixel or an icon, not a poster (a catalogue drawing is a few hundred KB at most).
      if (buf.length < least || buf.length > 1_500_000) return null;
      return { type, data: buf.toString('base64'), source: from, url };
    } catch {
      return null;
    }
  }

  const carLine = (c) => [c.year, c.make, c.model, c.engine].filter(Boolean).join(' ');

  /** A search result as an address of its site: Google gives its own redirect address, and the site as the title. */
  function siteUrl(src) {
    const t = String(src?.title ?? '').trim().toLowerCase();
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t)) return `https://${t.replace(/^www\./, '')}/`;
    try {
      const u = new URL(src.url);
      return /vertexaisearch|google\./.test(u.hostname) ? '' : `https://${u.hostname.replace(/^www\./, '')}/`;
    } catch {
      return '';
    }
  }

  /**
   * The pictures found, looked at by a light model: the part's diagram (a catalogue drawing showing it) and photos of
   * the part itself are kept — a diagram and two photos at most (v0.54: what the phone fetches, decodes and keeps — five
   * were too many); logos, the car, other parts, banners go. Looked at in low resolution, with minimal thinking.
   */
  async function lookAt(imgs, part, car) {
    if (!imgs.length) return [];
    const { value } = await json(
      P.look(imgs.length, part, car),
      { type: 'object', properties: { images: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, kind: { type: 'string' }, matches: { type: 'boolean' } }, required: ['index', 'kind', 'matches'] } } }, required: ['images'] },
      { kind: 'look', images: imgs, lowImages: true, thinking: 'minimal', models: LOOK_MODELS, timeout: 30_000 },
    );
    const said = Array.isArray(value.images) ? value.images : [];
    // Asked to count from 1, a model may still count from 0 (seen 19/11/2026): read either way.
    const base = said.some((v) => Number(v.index) === 0) ? 0 : 1;
    const kept = [];
    for (const v of said) {
      const img = imgs[Number(v.index) - base];
      const kind = v.kind === 'diagram' || v.kind === 'photo' ? v.kind : '';
      if (!img || !kind || v.matches !== true || kept.some((k) => k.url === img.url)) continue;
      if (kept.filter((k) => k.kind === kind).length >= (kind === 'diagram' ? 1 : 2)) continue;
      kept.push({ type: img.type, data: img.data, source: img.source, url: img.url, kind });
    }
    return kept;
  }

  const findPart = createPartFind({ ask, json, page, image, lookAt, catalogPage, pageText, diagramImages, siteUrl, within, models: FIND_MODELS, fetchMs: FETCH_MS, log });

  /*
   * How far a part's search has got (v0.64, the user: «показать загрузку поиска в процентах, чтобы следить за процессом
   * и понимать, когда закончится — без трат токенов»): each step of partfind.mjs says when it starts; inside a step the
   * time it has run against how long such a step takes here (measured: the catalogue a second or two, the model's memory
   * a few, a search 10–20 s, a deep one half a minute). Counted on this computer — nothing asked of anyone, no tokens. A
   * device asks by its own mark of the request (`track`): the same search asked twice (a tunnel's cut) is one search.
   */
  const runs = new Map();
  const tracks = new Map();
  /** A step: where its percent goes and how long it usually takes (ms). */
  const STEPS = { catalog: [8, 2_500], memory: [26, 6_000], web1: [66, 16_000], web2: [80, 22_000], web3: [92, 32_000], pages: [94, 5_000], pictures: [98, 5_000] };
  const percentOf = (r) => {
    if (!r) return undefined;
    if (r.done) return 100;
    return r.from + (r.to - r.from) * (1 - Math.exp(-Math.max(0, now() - r.at) / r.typical));
  };
  const stepper = (key) => (name) => {
    const [to, typical] = STEPS[name] ?? [95, 10_000];
    const from = percentOf(runs.get(key)) ?? 0;
    // Only ever forward: a step that starts past its usual mark (a deep search) still has room to go.
    runs.set(key, { at: now(), from, to: Math.min(99, Math.max(to, from + 4)), typical });
  };
  const forgetOld = () => {
    for (const [k, t] of tracks) if (now() - t.at > 15 * 60_000) tracks.delete(k);
    for (const [k, r] of runs) if (r.done && now() - r.done > 15 * 60_000) runs.delete(k);
  };

  return {
    on: () => !!key(),
    status: () => ({ on: !!key(), key: key() ? `…${key().slice(-4)}` : '', search: state.search, lastOk: state.lastOk, lastError: state.lastError, usage: usageNow() }),
    /** The key set on this computer's page (kept in Служебное/ai.json — this computer only). */
    setKey(k) {
      saved = { ...saved, key: String(k ?? '').trim() };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
      state.search = 'unknown';
      state.lastError = '';
      cache.clear();
    },
    /** A device asks at most this often — 120 a minute (a loop in the app must not spend the garage's quota). */
    allow(deviceId) {
      const t = now();
      const recent = (calls.get(deviceId) ?? []).filter((x) => x > t - 60_000);
      if (recent.length >= 120) throw httpError(429, 'too many AI questions, wait a minute');
      recent.push(t);
      calls.set(deviceId, recent);
    },

    async vin(vin) {
      vin = String(vin ?? '').toUpperCase().replace(/\s/g, '');
      if (!VIN_RE.test(vin)) throw httpError(400, 'not a VIN');
      return cached(`vin:${vin}`, 'vin', TTL.vin, async () => {
        const facts = await vpic(vin);
        const built = builtWhere(vin);
        // The official decoder said it all (a car made for the USA): nothing to ask Gemini.
        const own = carFromFacts(facts);
        if (own && own.make && own.model && own.year && (own.engine || own.body)) return { vin, ...own, confidence: 0.95, facts, built, by: 'nhtsa' };
        const { value, model } = await json(P.vin(vin, facts, built), {
          type: 'object',
          properties: { make: { type: 'string' }, model: { type: 'string' }, year: { type: 'integer' }, engine: { type: 'string' }, body: { type: 'string' }, confidence: { type: 'number' } },
          required: ['make', 'model', 'confidence'],
        }, { kind: 'vin', thinking: 'minimal' });
        // `by` — which Gemini answered (`model` is the car's).
        return { vin, ...value, facts, built, by: model };
      });
    },

    /**
     * A supplier's receipt read off its photo (v0.50): the seller, the lines, the sums, the total paid. A light model
     * looks at the picture once; the same picture (its bytes' hash) is never read twice.
     */
    async receipt({ image } = {}) {
      const type = String(image?.type ?? '');
      const data = String(image?.data ?? '');
      if (!/^image\/(jpeg|png|webp)$/.test(type) || data.length < 1000 || data.length > 8_000_000) throw httpError(400, 'no picture');
      const hash = createHash('sha256').update(data).digest('hex');
      return cached(`receipt:3:${hash}`, 'receipt', TTL.vin, async () => {
        const { value, model } = await json(
          P.receipt(),
          {
            type: 'object',
            properties: {
              isReceipt: { type: 'boolean' },
              vendor: { type: 'string' },
              vendorTrn: { type: 'string' },
              vendorPhone: { type: 'string' },
              vendorAddress: { type: 'string' },
              kind: { type: 'string', enum: ['parts', 'service', 'fuel', 'food', 'other'] },
              invoiceNo: { type: 'string' },
              dateText: { type: 'string' },
              date: { type: 'string' },
              dateSure: { type: 'boolean' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { name: { type: 'string' }, part: { type: 'string' }, car: { type: 'string' }, partNumber: { type: 'string' }, qty: { type: 'number' }, unitPrice: { type: 'number' }, total: { type: 'number' } },
                  required: ['name'],
                },
              },
              subtotal: { type: 'string' },
              vat: { type: 'string' },
              total: { type: 'number' },
              paymentMethod: { type: 'string' },
              carText: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['isReceipt', 'kind', 'dateText', 'date', 'items', 'total', 'confidence'],
          },
          { kind: 'receipt', images: [{ type, data }], models: RECEIPT_MODELS, timeout: 60_000 },
        );
        const num = (x) => (x === '' || x === null || x === undefined || Number.isNaN(Number(x)) ? undefined : Number(x));
        return { ...value, subtotal: num(value.subtotal), vat: num(value.vat), total: num(value.total), by: model };
      });
    },

    async partName({ name, make = '', model = '', year = '' } = {}) {
      name = String(name ?? '').trim().slice(0, 160);
      if (!name) throw httpError(400, 'no name');
      const car = carLine({ make, model, year });
      return cached(`name:${name.toLowerCase()}|${car.toLowerCase()}`, 'name', TTL.name, async () => {
        const { value } = await json(P.name(name, car), {
          type: 'object',
          properties: { fixed: { type: 'string' }, english: { type: 'string' }, isPart: { type: 'boolean' }, confidence: { type: 'number' } },
          required: ['fixed', 'english', 'isPart', 'confidence'],
        }, { kind: 'name', thinking: 'minimal' });
        return { name, ...value };
      });
    },

    /**
     * A part's number, its diagram and a photo of it (partfind.mjs). `number` — the line's own number (typed, or the
     * garage's): the catalogue alone may answer; `deep` — asked to dig deeper: what is kept is where it starts from, and
     * is replaced; `catalogOnly` — only the catalogue's word on `number` (its name, its diagram): no AI, nothing paid.
     * No car (no make, no VIN) — nothing is looked for.
     */
    /** How far the searches marked so have got: 0…100 each (100 — done), null — not heard of (v0.64). */
    progress(list) {
      const out = {};
      for (const t of String(list ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 24)) {
        const key = tracks.get(t)?.key;
        const p = key ? percentOf(runs.get(key)) : undefined;
        const kept = key ? cache.get(key) : undefined;
        out[t] = p !== undefined ? Math.floor(p) : kept && 'result' in kept ? 100 : null;
      }
      return out;
    },

    async partFind({ part, make = '', model = '', year = '', engine = '', vin = '', built = '', hints = [], number = '', deep = false, catalogOnly = false, track = '' } = {}) {
      part = String(part ?? '').trim().slice(0, 160);
      if (!part) throw httpError(400, 'no part');
      vin = VIN_RE.test(String(vin).toUpperCase()) ? String(vin).toUpperCase() : '';
      make = String(make ?? '').trim();
      // v0.55: 15 of the garage's first 44 searches were asked with no car — each a paid question that could find nothing.
      if (!make && !vin) throw httpError(400, 'no car');
      built = String(built || builtWhere(vin)).slice(0, 30);
      hints = (Array.isArray(hints) ? hints : []).map((h) => String(h).trim()).filter(Boolean).slice(0, 3);
      number = String(number ?? '').trim().toUpperCase().slice(0, 40);
      const car = carLine({ make, model, year, engine });
      // Kept by the car, not the VIN: two cars of one model, year, engine and plant share their numbers.
      const key = `find3:${part.toLowerCase()}|${car.toLowerCase()}|${built.toLowerCase()}${number ? `|#${plainNumber(number)}` : ''}${catalogOnly ? '|catalog' : ''}`;
      // A number on this car's diagram, or seen in two places, serves a year; another found on the web — a month; a guess — half an hour.
      const life = (r) => (r?.search !== 'web' ? TTL.model : (r.numbers ?? []).some((n) => n.fits || (n.seen ?? []).length >= 2) ? TTL.proven : TTL.web);
      const before = deep ? peek(key) : undefined;
      if (catalogOnly && !number) throw httpError(400, 'no number');
      forgetOld();
      track = String(track ?? '').slice(0, 64);
      if (track) tracks.set(track, { key, at: now() });
      return cached(
        key,
        'find',
        life,
        async () => {
          runs.set(key, { at: now(), from: 0, to: 4, typical: 1_500 });
          try {
            return await findPart({ part, make, model, year, engine, vin, built, hints, number, deep: !!deep, before, car, catalogOnly: !!catalogOnly, step: stepper(key) });
          } finally {
            runs.set(key, { done: now() });
          }
        },
        { fresh: !!deep },
      );
    },
  };
}
