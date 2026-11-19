import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DIRS, httpError } from './store.mjs';

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
 */

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
/** The light models, for the small questions (a name, a picture, writing an answer down): seconds, a few hundred tokens. */
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
const COOL = 10 * 60_000;
/** A part's number is worth a stronger model: it searches better. The light ones if the strong do not answer. */
const FIND_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const LOOK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const DAY = 24 * 60 * 60_000;
/** How long an answer serves: a VIN and a name do not change; a number found on the web — a month; a guess — half an hour. */
const TTL = { vin: 365 * DAY, name: 365 * DAY, web: 30 * DAY, model: 30 * 60_000 };

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
  search: (part, car, vin, built, hints) =>
    `Find the genuine (OEM) part number of "${part}" for exactly this car: ${car || 'unknown'}${vin ? `, VIN ${vin}` : ''}${built ? ` (built in ${built})` : ''}, in the UAE — GCC specification unless the VIN says otherwise.
Use Google Search now and open catalogue pages (partsouq.com, amayama.com, megazip.net, 7zap.com, the maker's catalogue, dealers' parts shops): every number must come from a search result or an opened page — do not answer from memory.${hints.length ? `\nThe garage used ${hints.join(', ')} for this part on this car before: confirm or correct.` : ''}
For each number: the number as the catalogue writes it, the maker, what tells the variants apart (market, production dates, engine, side), the exact page address where you saw it; a replaced number — the new one and what it replaces. Also addresses of the catalogue diagram picture showing the part and of a photo of the part, if a page has them. Answer as a compact list in plain text.`,
  extract: (text) =>
    `Write this parts-catalogue answer down as JSON, nothing added:
numbers: each {number (as written), brand, note (variants, market, replaces…, under 80 characters), pages: [addresses where it was seen]}; images: each {url, kind: "diagram" | "photo", page}.
Answer:
${text}`,
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
  async function ask(text, { kind = 'other', schema, search = false, images = [], models: list, timeout = 25_000, thinking = 'low' } = {}) {
    if (!key()) throw httpError(503, 'ai off');
    const body = {
      // Each picture under its own label («Picture 1:»…): the answer names them by it.
      contents: [{ parts: [{ text }, ...images.flatMap((i, k) => [{ text: `Picture ${k + 1}:` }, { inline_data: { mime_type: i.type, data: i.data } }])] }],
      ...(search ? { tools: [{ google_search: {} }, { url_context: {} }] } : {}),
      generationConfig: {
        temperature: 0,
        maxOutputTokens: search ? 4096 : 2048,
        thinkingConfig: { thinkingLevel: thinking },
        ...(schema && !search ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}),
      },
    };
    let last;
    for (const model of order(list)) {
      let res;
      try {
        res = await timed(`${API}/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key() }, body: JSON.stringify(body) }, timeout);
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
  function cached(k, kind, ttl, make) {
    const life = (r) => (typeof ttl === 'function' ? ttl(r) : ttl);
    const hit = cache.get(k);
    if (hit && (!('result' in hit) || now() - hit.at < life(hit.result))) return hit.value;
    if (store?.aiCacheGet) {
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
      let res = await timed(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (MyGarage parts lookup)', Accept: 'text/html' } }, 12_000);
      // Search results come as Google's redirect addresses: followed one step at a time, each checked.
      for (let hop = 0; hop < 4 && res.status >= 300 && res.status < 400 && res.headers.get('location'); hop++) {
        url = new URL(res.headers.get('location'), url).toString();
        if (!(await publicUrl(url, lookup))) return null;
        res = await timed(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (MyGarage parts lookup)', Accept: 'text/html' } }, 12_000);
      }
      if (!res.ok || !/html|text/i.test(res.headers.get('content-type') || '')) return null;
      const html = (await res.text()).slice(0, 3_000_000);
      return { url, html };
    } catch {
      return null;
    }
  }

  async function image(url, from) {
    if (!(await publicUrl(url, lookup))) return null;
    try {
      const res = await timed(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MyGarage parts lookup)', Referer: from } }, 15_000);
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!res.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      // Not a pixel or an icon, not a poster (a catalogue drawing is a few hundred KB at most).
      if (buf.length < 6_000 || buf.length > 1_500_000) return null;
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
   * the part itself are kept — two diagrams and three photos at most; logos, the car, other parts, banners go.
   */
  async function lookAt(imgs, part, car) {
    if (!imgs.length) return [];
    const { value } = await json(
      P.look(imgs.length, part, car),
      { type: 'object', properties: { images: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, kind: { type: 'string' }, matches: { type: 'boolean' } }, required: ['index', 'kind', 'matches'] } } }, required: ['images'] },
      { kind: 'look', images: imgs, models: LOOK_MODELS, timeout: 45_000 },
    );
    const said = Array.isArray(value.images) ? value.images : [];
    // Asked to count from 1, a model may still count from 0 (seen 19/11/2026): read either way.
    const base = said.some((v) => Number(v.index) === 0) ? 0 : 1;
    const kept = [];
    for (const v of said) {
      const img = imgs[Number(v.index) - base];
      const kind = v.kind === 'diagram' || v.kind === 'photo' ? v.kind : '';
      if (!img || !kind || v.matches !== true || kept.some((k) => k.url === img.url)) continue;
      if (kept.filter((k) => k.kind === kind).length >= (kind === 'diagram' ? 2 : 3)) continue;
      kept.push({ type: img.type, data: img.data, source: img.source, url: img.url, kind });
    }
    return kept;
  }

  const FIND_SCHEMA = {
    type: 'object',
    properties: {
      numbers: {
        type: 'array',
        items: {
          type: 'object',
          properties: { number: { type: 'string' }, brand: { type: 'string' }, note: { type: 'string' }, pages: { type: 'array', items: { type: 'string' } } },
          required: ['number'],
        },
      },
      images: {
        type: 'array',
        items: { type: 'object', properties: { url: { type: 'string' }, kind: { type: 'string' }, page: { type: 'string' } }, required: ['url'] },
      },
    },
    required: ['numbers'],
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
    /** A device asks at most this often (a loop in the app must not spend the garage's quota). */
    allow(deviceId) {
      const t = now();
      const recent = (calls.get(deviceId) ?? []).filter((x) => x > t - 60_000);
      if (recent.length >= 40) throw httpError(429, 'too many AI questions, wait a minute');
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
        }, { kind: 'vin' });
        // `by` — which Gemini answered (`model` is the car's).
        return { vin, ...value, facts, built, by: model };
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
        }, { kind: 'name' });
        return { name, ...value };
      });
    },

    async partFind({ part, make = '', model = '', year = '', engine = '', vin = '', built = '', hints = [] } = {}) {
      part = String(part ?? '').trim().slice(0, 160);
      if (!part) throw httpError(400, 'no part');
      vin = VIN_RE.test(String(vin).toUpperCase()) ? String(vin).toUpperCase() : '';
      built = String(built || builtWhere(vin)).slice(0, 30);
      hints = (Array.isArray(hints) ? hints : []).map((h) => String(h).trim()).filter(Boolean).slice(0, 3);
      const car = carLine({ make, model, year, engine });
      // Kept by the car, not the VIN: two cars of one model, year, engine and plant share their numbers.
      return cached(`find:${part.toLowerCase()}|${car.toLowerCase()}|${built.toLowerCase()}`, 'find', (r) => (r?.search === 'web' ? TTL.web : TTL.model), async () => {
        // 1. The search, in plain words (a JSON answer keeps the model from searching); low thinking, then medium when
        //    low found nothing. 2. The answer written down as JSON by a light model.
        let said;
        let search = 'web';
        try {
          said = await ask(P.search(part, car, vin, built, hints), { kind: 'find', search: true, models: FIND_MODELS, timeout: 75_000 });
          if (!said.searched || !/\d{4}/.test(said.text)) {
            const again = await ask(P.search(part, car, vin, built, hints), { kind: 'find', search: true, models: FIND_MODELS, timeout: 90_000, thinking: 'medium' });
            if (again.searched || !said.searched) said = again;
          }
          if (!said.searched) search = 'model';
        } catch (e) {
          if (!e.searchOff) throw e;
          // No Google Search on this key: what the model knows itself — never taken as found.
          search = 'model';
          said = await ask(`${P.search(part, car, vin, built, hints)}\nNo web access: say only what you are sure of.`, { kind: 'find', models: FIND_MODELS, timeout: 60_000 });
        }
        const found = await json(P.extract(said.text), FIND_SCHEMA, { kind: 'extract', timeout: 30_000 });
        const numbers = (Array.isArray(found.value.numbers) ? found.value.numbers : [])
          .map((n) => ({ number: String(n.number ?? '').trim().toUpperCase().slice(0, 40), brand: String(n.brand ?? '').trim().slice(0, 40), note: String(n.note ?? '').trim().slice(0, 80), pages: Array.isArray(n.pages) ? n.pages.map(String) : [] }))
          .filter((n) => plainNumber(n.number).length >= 5)
          .slice(0, 5);
        // Seen 1: Google's own reading — the words of the answer that hold the number, backed by search results (their sites).
        const backedBy = (n) => {
          const p = plainNumber(n);
          return said.supports.filter((x) => plainNumber(x.text).includes(p)).flatMap((x) => x.sites.map((site) => siteUrl(site)).filter(Boolean));
        };
        // Seen 2: this computer opens the pages named (public addresses only) and finds the number on them.
        const modelImages = (Array.isArray(found.value.images) ? found.value.images : []).filter((i) => i && typeof i.url === 'string').slice(0, 6);
        const urls = [...new Set([...numbers.flatMap((n) => n.pages), ...modelImages.map((i) => String(i.page || '')).filter(Boolean), ...said.sources.map((x) => x.url)])].slice(0, 10);
        const pages = (await Promise.all(urls.map(page))).filter(Boolean);
        const out = numbers.map((n) => {
          const p = plainNumber(n.number);
          const opened = pages.filter((pg) => plainNumber(pageText(pg.html)).includes(p)).map((pg) => pg.url);
          return { number: n.number, brand: n.brand, note: n.note, seen: [...new Set([...opened, ...(search === 'web' ? backedBy(n.number) : [])])] };
        });
        // Pictures: those the model named, and off the pages that have a number — the likeliest; then a light model looks at
        // them and keeps only the part's diagram and photos of the part itself.
        const candidates = [];
        const add = (url, from, hint) => {
          if (url && !candidates.some((c) => c.url === url)) candidates.push({ url, from, hint });
        };
        for (const i of modelImages) {
          try {
            add(new URL(i.url, i.page || undefined).toString(), i.page || '', i.kind);
          } catch {
            // not an address
          }
        }
        for (const pg of pages) {
          const has = out.filter((n) => n.seen.includes(pg.url)).map((n) => n.number);
          if (!has.length) continue;
          for (const c of diagramImages(pg.html, pg.url, has).slice(0, 3)) add(c.url, pg.url);
        }
        // Fetched all at once (one by one took tens of seconds — the phone's tunnel cuts a request at about 100 s); the
        // first six that came, in the likeliest order.
        const got = await Promise.all(candidates.slice(0, 10).map((c) => image(c.url, c.from || c.url).then((img) => (img ? { ...img, hint: c.hint } : null))));
        const fetched = got.filter(Boolean).slice(0, 6);
        const images = await lookAt(fetched, part, car).catch(() => []);
        return { part, car, search, numbers: out, sources: said.sources.slice(0, 8), images };
      });
    },
  };
}
