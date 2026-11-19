import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DIRS, httpError } from './store.mjs';

/*
 * The garage's AI (v0.48, the user: «внедри ИИ Gemini»): Google's Gemini, called from this computer only — its key
 * stays here (Служебное/ai.json, or GEMINI_API_KEY), never on a phone, in the app's code or in the repository.
 *
 *   vin(vin)          — the car a VIN is: the official NHTSA decoder's facts (vpic.nhtsa.dot.gov, free, no key), then
 *                       Gemini reads them with the VIN (cars sold outside the USA: the decoder knows little of them);
 *   partName(…)       — a part's name as typed, its spelling mistakes put right, and its English name;
 *   partFind(…)       — the part's number in the open catalogues: Gemini searches the web (Google Search — a paid
 *                       Gemini plan; without it — its own knowledge, «not checked»), this computer opens the pages it
 *                       names, checks the number is on them and takes the picture of the part's diagram there.
 *
 * What the app takes as true is decided in the app (domain/ai.ts): this only says what was found and where.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
/**
 * Tried in turn. On a key without a paid plan the larger models keep a question waiting for minutes or say «high demand»
 * (503) — the light ones answer in seconds (measured 19/11/2026); a model that did not answer is passed over for ten minutes.
 */
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
const COOL = 10 * 60_000;
/**
 * A part's number is worth a better model and a longer wait (v0.48.2, «максимально точно»): it is looked up in the
 * background — the stronger models first, the light ones if they do not answer.
 */
const FIND_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
/** Pictures are looked at by a light model (cheap, quick). */
const LOOK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const DAY = 24 * 60 * 60_000;

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

export function createAi({ dataDir, env = process.env, log = () => {}, fetchImpl = fetch, lookup = dns.lookup, now = () => Date.now() }) {
  const file = path.join(dataDir, DIRS.service, 'ai.json');
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
  const cache = new Map();
  const calls = new Map();
  /** Models that did not answer lately: until when they are passed over. */
  const cooling = new Map();
  const order = (list) => {
    const all = list ?? models();
    const ready = all.filter((m) => !(cooling.get(m) > now()));
    return ready.length ? ready : all;
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
   * finds; `images` — pictures to look at (inline); `models` — which, in turn.
   */
  async function ask(text, { schema, search = false, images = [], models: list, timeout = 25_000 } = {}) {
    if (!key()) throw httpError(503, 'ai off');
    const body = {
      // Each picture under its own label («Picture 1:»…): the answer names them by it.
      contents: [{ parts: [{ text }, ...images.flatMap((i, k) => [{ text: `Picture ${k + 1}:` }, { inline_data: { mime_type: i.type, data: i.data } }])] }],
      ...(search ? { tools: [{ google_search: {} }, { url_context: {} }] } : {}),
      generationConfig: { temperature: 0, ...(schema ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}) },
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
        if (search) state.search = 'on';
        // What Google itself read: the search results (their sites), which of them back which words of the answer, the
        // pages opened whole (url_context).
        const gm = c?.groundingMetadata ?? {};
        const chunks = (gm.groundingChunks ?? []).map((g) => (g.web?.uri ? { url: g.web.uri, title: g.web.title || '' } : null));
        const sources = chunks.filter(Boolean);
        const supports = (gm.groundingSupports ?? []).map((x) => ({ text: x.segment?.text ?? '', sites: (x.groundingChunkIndices ?? []).map((i) => chunks[i]).filter(Boolean) }));
        const read = (c?.urlContextMetadata?.urlMetadata ?? []).filter((u) => /SUCCESS/.test(u.urlRetrievalStatus ?? '')).map((u) => u.retrievedUrl).filter(Boolean);
        return { text: out, sources, supports, read, model };
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

  /** An answer kept a while: `ms` — how long, or how long for this answer (a guess without the web — not long). */
  function cached(k, ms, make) {
    const hit = cache.get(k);
    if (hit && (!('result' in hit) || now() - hit.at < (typeof ms === 'function' ? ms(hit.result) : ms))) return hit.value;
    const entry = { at: now() };
    entry.value = make().then(
      (v) => {
        entry.result = v;
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
      // Not a pixel or an icon, not a whole album.
      if (buf.length < 6_000 || buf.length > 4 * 1024 * 1024) return null;
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
      `These ${imgs.length} pictures were found on online parts catalogue pages for "${part}"${car ? ` of a ${car}` : ''}, each under its label «Picture N:» (N from 1 to ${imgs.length}); answer with index = N.
For each say:
- kind: "diagram" — a parts catalogue diagram or exploded/assembly drawing on which this part is shown; "photo" — a photograph of this kind of part itself (not of the car, not of a box only); "other" — anything else (logos, banners, icons, the car, other parts).
- matches: whether it really is this part ("${part}").`,
      { type: 'object', properties: { images: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, kind: { type: 'string' }, matches: { type: 'boolean' } }, required: ['index', 'kind', 'matches'] } } }, required: ['images'] },
      { images: imgs, models: LOOK_MODELS, timeout: 45_000 },
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

  return {
    on: () => !!key(),
    status: () => ({ on: !!key(), key: key() ? `…${key().slice(-4)}` : '', search: state.search, lastOk: state.lastOk, lastError: state.lastError }),
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
      return cached(`vin:${vin}`, 30 * DAY, async () => {
        const facts = await vpic(vin);
        const { value, model } = await json(
          `You decode vehicle identification numbers for a car repair garage in the United Arab Emirates.
VIN: ${vin}
Facts from the official NHTSA VIN decoder (complete for cars made for the USA, partial or empty for cars made for the Gulf (GCC), Japan or Europe): ${facts ? JSON.stringify(facts) : 'none'}
Say what car this VIN is: make, model (the model name as sold, e.g. "Land Cruiser", "Camry", "Patrol"), model year, engine (displacement and cylinders, e.g. "4.0L V6"; empty when not known), body (exactly one of: pickup, van, bus, truck, suv, mpv, sedan; empty when not known), and how sure you are of the whole (0..1).
Leave a field empty rather than guess.`,
          {
            type: 'object',
            properties: {
              make: { type: 'string' },
              model: { type: 'string' },
              year: { type: 'integer' },
              engine: { type: 'string' },
              body: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['make', 'model', 'confidence'],
          },
        );
        // `by` — which Gemini answered (`model` is the car's).
        return { vin, ...value, facts, by: model };
      });
    },

    async partName({ name, make = '', model = '', year = '' } = {}) {
      name = String(name ?? '').trim().slice(0, 160);
      if (!name) throw httpError(400, 'no name');
      const car = carLine({ make, model, year });
      return cached(`name:${name.toLowerCase()}|${car.toLowerCase()}`, 30 * DAY, async () => {
        const { value } = await json(
          `A manager at a car repair garage in the UAE typed the name of a spare part${car ? ` for a ${car}` : ''}: "${name}".
It may have typing mistakes, and may be in English, in Russian, or Russian written in Latin letters.
Return:
- fixed: the same name with only its spelling mistakes put right — the same language and the same words, in the same order; do not translate, add or drop words; keep numbers, sizes and side words (front, rear, left, right, upper, lower) as typed. When there is no mistake, the name as typed.
- english: the usual English name of this part as written on a garage invoice (short, e.g. "FRONT BRAKE PADS").
- isPart: whether it is a car part or a car service item at all.
- confidence: how sure you are of "fixed" (0..1).`,
          {
            type: 'object',
            properties: { fixed: { type: 'string' }, english: { type: 'string' }, isPart: { type: 'boolean' }, confidence: { type: 'number' } },
            required: ['fixed', 'english', 'isPart', 'confidence'],
          },
        );
        return { name, ...value };
      });
    },

    async partFind({ part, make = '', model = '', year = '', engine = '', vin = '' } = {}) {
      part = String(part ?? '').trim().slice(0, 160);
      if (!part) throw httpError(400, 'no part');
      vin = VIN_RE.test(String(vin).toUpperCase()) ? String(vin).toUpperCase() : '';
      const car = carLine({ make, model, year, engine });
      // Found on the web — a week; the model's own guess (no search) — half an hour: the search may be on by then.
      return cached(`find:${part.toLowerCase()}|${car.toLowerCase()}|${vin}`, (r) => (r?.search === 'web' ? 7 * DAY : 30 * 60_000), async () => {
        const schema = {
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
        const question = `You are the parts specialist of a car repair garage in the UAE. Find the genuine (OEM) part number of "${part}" for exactly this car: ${car || 'unknown'}${vin ? `, VIN ${vin}` : ''}.
The car is in the United Arab Emirates — a GCC-specification car unless its VIN says otherwise: when the number differs by market or production plant, give the GCC / general-market one first and name the market in its note.
Search the open online parts catalogues by the VIN, or by the model, year and engine: the maker's electronic parts catalogues, partsouq.com, amayama.com, megazip.net, 7zap.com, rockauto.com, dealers' parts shops. Open the pages and read them.
Return:
- numbers: each OEM number exactly as the catalogue writes it; brand (the maker); note — what tells the variants apart (side, engine, "with sensor", production dates; when the catalogue says a number was replaced, give the new one and write "replaces <old number>"); pages — the addresses of the catalogue pages where you saw this number for this car.
- images: addresses of pictures on those pages — kind "diagram": the catalogue's diagram (exploded drawing) that shows this part; kind "photo": a photograph of this part. Only addresses you saw.
Only numbers you saw on a catalogue page for this car — an empty list rather than a guess.`;
        let found;
        let search = 'web';
        try {
          found = await json(question, schema, { search: true, models: FIND_MODELS, timeout: 75_000 });
        } catch (e) {
          if (!e.searchOff) throw e;
          // No Google Search on this key: what the model knows itself — never taken as found.
          search = 'model';
          found = await json(
            `What is the genuine (OEM) part number of "${part}" for this car: ${car || 'unknown'}${vin ? `, VIN ${vin}` : ''}?
Return numbers (number, brand, note), only those you are sure of; an empty list otherwise.`,
            schema,
          );
        }
        const numbers = (Array.isArray(found.value.numbers) ? found.value.numbers : [])
          .map((n) => ({ number: String(n.number ?? '').trim().toUpperCase().slice(0, 40), brand: String(n.brand ?? '').trim().slice(0, 40), note: String(n.note ?? '').trim().slice(0, 80), pages: Array.isArray(n.pages) ? n.pages.map(String) : [] }))
          .filter((n) => plainNumber(n.number).length >= 5)
          .slice(0, 5);
        // Seen 1: Google's own reading — the words of the answer that hold the number, backed by search results (their sites).
        const backedBy = (n) => {
          const p = plainNumber(n);
          return found.supports.filter((x) => plainNumber(x.text).includes(p)).flatMap((x) => x.sites.map((site) => siteUrl(site)).filter(Boolean));
        };
        // Seen 2: this computer opens the pages named (public addresses only) and finds the number on them.
        const modelImages = (Array.isArray(found.value.images) ? found.value.images : []).filter((i) => i && typeof i.url === 'string').slice(0, 6);
        const urls = [...new Set([...numbers.flatMap((n) => n.pages), ...modelImages.map((i) => String(i.page || '')).filter(Boolean), ...found.sources.map((x) => x.url)])].slice(0, 10);
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
        const got = await Promise.all(candidates.slice(0, 10).map((c) => image(c.url, c.from || c.url).then((img) => (img && img.data.length <= 4_000_000 ? { ...img, hint: c.hint } : null))));
        const fetched = got.filter(Boolean).slice(0, 6);
        const images = await lookAt(fetched, part, car).catch(() => []);
        return { part, car, search, numbers: out, sources: found.sources.slice(0, 8), images };
      });
    },
  };
}
