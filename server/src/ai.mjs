import { createHash } from 'node:crypto';
import fs from 'node:fs';
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
 *   receipt(…)        — a supplier's receipt read off its photo (v0.50).
 *
 * The search for a part's number, diagram and photos in the catalogues on the web (v0.49–v0.84: partfind.mjs,
 * catalog.mjs, Google Search grounding) is gone (v0.85, the owner: «Убери поиск каталогов полностью, направим ИИ на
 * более нужные и с меньшим расходом. Оставь определения VIN.» — a week's usage here: ~80 % of the questions, every paid
 * Google search and most thinking tokens went to it). Not to come back without the owner's word.
 *
 * Tokens (v0.49, the user: «чтобы меньше тратил токены»): every answer is kept — in SQLite through the store when
 * there is one, so a restart loses nothing and every device shares it; thinking is kept low (minimal for the light
 * models' small questions); what each call spent is counted (`usage`, shown on this computer's page). What the app
 * takes as true is decided in the app (domain/ai.ts).
 */

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
/** The light models, for the small questions (a VIN, a name): seconds, a few hundred tokens. */
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
const COOL = 10 * 60_000;
/** A receipt: every digit counts (the date under a stamp, a total) — the stronger model reads it, the light ones if it does not answer. */
const RECEIPT_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const DAY = 24 * 60 * 60_000;
/** How long an answer serves: a VIN, a name and a receipt's picture do not change. */
const TTL = 365 * DAY;

/*
 * The questions, ready-made («заготовки»): short, every word earning its tokens, the facts the app already knows put
 * in front of the model instead of being asked of it.
 */
const P = {
  vin: (vin, facts, built) =>
    `VIN ${vin} (car built in ${built || 'unknown region'}; garage in the UAE). NHTSA decoder says: ${facts ? JSON.stringify(facts) : 'nothing'}.
Give make, model (as sold, e.g. "Land Cruiser"), year, engine ("4.0L V6"; "" if unknown), body (one of pickup, van, bus, truck, suv, mpv, sedan; "" if unknown), confidence 0..1. Empty rather than a guess.`,
  name: (name, car) =>
    `A line of a car repair job typed at a UAE garage${car ? ` for a ${car}` : ''}: "${name}" — a spare part, a service or work. It may have typos; it may be English, Russian, or Russian in Latin letters.
fixed: the same words in the same order and language, only spelling put right (keep numbers, sizes, front/rear/left/right); english: the usual English invoice name (e.g. "FRONT BRAKE PADS", "WHEEL ALIGNMENT"); isPart: is it a car part, service or work item; confidence 0..1 for fixed.`,
  // v0.86: the labour line said by the job's parts and work, as a garage writes it on an invoice.
  labour: (parts, work) =>
    `Garage invoice, UAE. Parts on the job: ${parts.join('; ')}.${work.length ? ` Other work on it: ${work.join('; ')}.` : ''}
Write what the labour charge is for, as on a garage invoice: a verb and the parts, e.g. "REPLACE FRONT BRAKE PADS & DISCS", "OVERHAUL GEARBOX, REPLACE ATF FILTER". English capitals, at most 70 characters, no prices, no "LABOR CHARGE".`,
  // v0.86: a supplier's WhatsApp answer read when the app's own rules found no prices in it.
  reply: (text, quote, asks) =>
    `A UAE auto-parts supplier wrote to a garage on WhatsApp. The garage's requests to this supplier (lines numbered):
${asks.map((a, k) => `${String.fromCharCode(65 + k)}) ${a.car || 'car'}: ${a.lines.map((l, n) => `${n + 1}. ${l}`).join('; ')}`).join('\n')}
The supplier's message${quote ? ` (a reply to: "${quote.slice(0, 300)}")` : ''}:
"""${text.slice(0, 2000)}"""
ask: the letter of the request it answers ("" if it gives no prices or answers none). lines: each line it answers — n (line number), offers: each price it says for it — price (AED, one piece, as written), kind ("oem" original/genuine, "aftermarket" copy/duplicate/brand, "used", "" if not said), brand ("" if none), na (true: not available). vat: "incl" if the prices include VAT, "excl" if VAT is on top, "" if not said. Only what the message says.`,
  // v0.86: who a chat is to the garage, by its name and its last words.
  roles: (chats) =>
    `WhatsApp chats of a car repair garage in the UAE. For each, who is it to the garage: "customer" (a car owner, a company bringing cars), "supplier" (sells parts, oils, tyres, or does outside work: paint, tow, machining), "other". By the name and the messages; "other" when unsure.
${chats.map((c) => `${c.id} — "${c.name}": ${c.texts.map((t) => `"${t.slice(0, 160)}"`).join(' / ')}`).join('\n')}`,
  receipt: () =>
    `A photo of a supplier's invoice or receipt in the UAE (amounts in AED; VAT 5 %). The garage is the buyer; read the seller's paper exactly as printed.
Return: isReceipt (an invoice/receipt/bill at all); vendor (the seller's name as printed, not the buyer's); vendorTrn; vendorPhone (a mobile first, "" if none); vendorAddress (a few words, "" if none); kind — "parts" (car parts, accessories, oils, consumables), "service" (a workshop's or contractor's bill for work: paint, alignment, machining, towing, car wash), "fuel", "food" or "other"; invoiceNo;
dateText — the document's date exactly as printed ("18-Nov-2026", "17/11/26"; "" if none); date — that date as YYYY-MM-DD: UAE papers write the day first (05/11/2026 is 5 November); read every digit of day, month and year — a stamp or a fold may cover some; dateSure — false if any digit of the date is hidden or unclear;
items — each {name (as printed), part (the usual English name of the part alone: no brand, car, years, sizes, side or quantity — "TAIL LIGHT COVER", "MUD FLAP", "ATF PAN GASKET"), car (the car make/model the line names, "" if none), partNumber ("" if none), qty, unitPrice, total (as printed)};
subtotal (before VAT, "" if not printed); vat (as printed, 0 if the paper says none, "" if not printed); total (the amount to pay incl. VAT); paymentMethod ("cash", "card", "transfer", "credit" when it says credit / sales credit / unpaid / due, "" if not said); carText (car model, plate, chassis or VIN on the paper, "" if none); confidence 0..1.
Numbers as numbers; never invent a value the paper does not show.`,
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

/** Where a VIN says the car was built — its first characters. */
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

export function createAi({ dataDir, env = process.env, log = () => {}, fetchImpl = fetch, now = () => Date.now(), store } = {}) {
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
  const state = { lastOk: '', lastError: '' };
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
   * What the AI spent: questions and tokens (in, out, thinking) by day — on this computer's page, so the garage sees
   * what its key pays for. Kept in Служебное/ai-usage.json; a month's worth. `searches` — the paid Google searches of
   * the part search (v0.49–v0.84): none any more, the days before v0.85 still show theirs.
   */
  let usage = {};
  try {
    usage = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
  } catch {
    // nothing spent yet
  }
  const day = () => new Date(now()).toISOString().slice(0, 10);
  function spent(kind, u) {
    const d = day();
    const row = (usage[d] ??= { questions: 0, searches: 0, in: 0, out: 0, think: 0, byKind: {} });
    row.questions++;
    row.in += (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0);
    row.out += u?.candidatesTokenCount ?? 0;
    row.think += u?.thoughtsTokenCount ?? 0;
    row.byKind[kind] = (row.byKind[kind] ?? 0) + 1;
    // Tokens by kind too (v0.86): what each question of the garage costs, seen on its own.
    row.tokensByKind ??= {};
    const t = row.tokensByKind[kind] ??= { in: 0, out: 0, think: 0 };
    t.in += (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0);
    t.out += u?.candidatesTokenCount ?? 0;
    t.think += u?.thoughtsTokenCount ?? 0;
    for (const k of Object.keys(usage)) if (new Date(k).getTime() < now() - 62 * DAY) delete usage[k];
    try {
      fs.mkdirSync(path.dirname(usageFile), { recursive: true });
      fs.writeFileSync(usageFile, JSON.stringify(usage));
    } catch {
      // a count, not a need
    }
  }
  const sum = (days) => {
    const out = { questions: 0, searches: 0, in: 0, out: 0, think: 0, byKind: {}, tokensByKind: {} };
    for (const d of days) {
      const r = usage[d];
      if (!r) continue;
      out.questions += r.questions;
      out.searches += r.searches ?? 0;
      out.in += r.in;
      out.out += r.out;
      out.think += r.think;
      for (const [k, v] of Object.entries(r.byKind)) out.byKind[k] = (out.byKind[k] ?? 0) + v;
      for (const [k, v] of Object.entries(r.tokensByKind ?? {})) {
        const t = (out.tokensByKind[k] ??= { in: 0, out: 0, think: 0 });
        t.in += v.in;
        t.out += v.out;
        t.think += v.think;
      }
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
   * One question to Gemini; the next model when one is busy or gone. `schema` — the answer as that JSON; `images` —
   * pictures to look at (inline); `models` — which, in turn; `thinking` — how much ("low" unless there is a reason;
   * «minimal» — the light models only, the stronger ones refuse it: «low»).
   */
  async function ask(text, { kind = 'other', schema, images = [], models: list, timeout = 25_000, thinking = 'low' } = {}) {
    if (!key()) throw httpError(503, 'ai off');
    const bodyFor = (model) => ({
      // Each picture under its own label («Picture 1:»…).
      contents: [{ parts: [{ text }, ...images.flatMap((i, k) => [{ text: `Picture ${k + 1}:` }, { inline_data: { mime_type: i.type, data: i.data } }])] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: thinking === 'minimal' && !/lite/.test(model) ? 'low' : thinking },
        ...(schema ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}),
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
        spent(kind, j.usageMetadata);
        return { text: out, model, usage: j.usageMetadata ?? {} };
      }
      let msg = res.statusText;
      try {
        msg = (await res.json())?.error?.message || msg;
      } catch {
        // not JSON
      }
      last = httpError(res.status === 429 ? 429 : res.status >= 500 || res.status === 404 ? 502 : res.status, `gemini ${model}: ${res.status} ${msg}`);
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
    return { value, model: r.model };
  }

  /**
   * An answer kept: in memory while the server runs, in the store's SQLite for good (a restart, another device — the
   * same answer, no tokens).
   */
  function cached(k, kind, make) {
    const hit = cache.get(k);
    // Being made right now: the same answer for everyone who asks.
    if (hit && !('result' in hit)) return hit.value;
    if (hit && now() - hit.at < TTL) return hit.value;
    if (store?.aiCacheGet) {
      const row = store.aiCacheGet(k);
      if (row && now() - row.at < TTL) {
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

  const carLine = (c) => [c.year, c.make, c.model, c.engine].filter(Boolean).join(' ');

  return {
    on: () => !!key(),
    status: () => ({ on: !!key(), key: key() ? `…${key().slice(-4)}` : '', lastOk: state.lastOk, lastError: state.lastError, usage: usageNow() }),
    /** The key set on this computer's page (kept in Служебное/ai.json — this computer only). */
    setKey(k) {
      saved = { ...saved, key: String(k ?? '').trim() };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
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
      return cached(`vin:${vin}`, 'vin', async () => {
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
     * A supplier's receipt read off its photo (v0.50): the seller, the lines, the sums, the total paid. A model looks at
     * the picture once; the same picture (its bytes' hash) is never read twice.
     */
    async receipt({ image } = {}) {
      const type = String(image?.type ?? '');
      const data = String(image?.data ?? '');
      if (!/^image\/(jpeg|png|webp)$/.test(type) || data.length < 1000 || data.length > 8_000_000) throw httpError(400, 'no picture');
      const hash = createHash('sha256').update(data).digest('hex');
      return cached(`receipt:3:${hash}`, 'receipt', async () => {
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

    /** v0.86: what the labour charge is for, by the job's parts and work (a light model; kept for the same parts). */
    async labour({ parts = [], work = [] } = {}) {
      const p = (Array.isArray(parts) ? parts : []).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 20);
      const w = (Array.isArray(work) ? work : []).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 10);
      if (!p.length) throw httpError(400, 'no parts');
      return cached(`labour:${p.join('|').toLowerCase()}#${w.join('|').toLowerCase()}`, 'labour', async () => {
        const { value } = await json(P.labour(p, w), { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, { kind: 'labour', thinking: 'minimal' });
        const text = String(value.text ?? '')
          .toUpperCase()
          .replace(/^\s*LABOU?R(?: CHARGES?)?\s*[:\-–]\s*/, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80);
        return { text };
      });
    },

    /** v0.86: a supplier's answer the app's rules could not read — which request, which line, what price. */
    async reply({ text, quote = '', asks = [] } = {}) {
      text = String(text ?? '').trim();
      const list = (Array.isArray(asks) ? asks : []).slice(0, 4).map((a) => ({
        id: String(a?.id ?? ''),
        car: String(a?.car ?? '').slice(0, 60),
        lines: (Array.isArray(a?.lines) ? a.lines : []).slice(0, 25).map((l) => String(l).slice(0, 80)),
      }));
      if (!text || !list.length || !list.some((a) => a.lines.length)) throw httpError(400, 'nothing to read');
      const key = createHash('sha1').update(JSON.stringify([text, String(quote).slice(0, 300), list])).digest('hex');
      return cached(`reply:${key}`, 'reply', async () => {
        const offer = { type: 'object', properties: { price: { type: 'number' }, kind: { type: 'string' }, brand: { type: 'string' }, na: { type: 'boolean' } }, required: ['price', 'kind', 'na'] };
        const { value } = await json(
          P.reply(text, String(quote), list),
          {
            type: 'object',
            properties: { ask: { type: 'string' }, lines: { type: 'array', items: { type: 'object', properties: { n: { type: 'number' }, offers: { type: 'array', items: offer } }, required: ['n', 'offers'] } }, vat: { type: 'string' } },
            required: ['ask', 'lines', 'vat'],
          },
          { kind: 'reply', thinking: 'minimal' },
        );
        const ask = list[String(value.ask ?? '').trim().toUpperCase().charCodeAt(0) - 65];
        if (!ask) return { ask: '', lines: [], vat: '' };
        const kinds = new Set(['oem', 'aftermarket', 'used']);
        const lines = (Array.isArray(value.lines) ? value.lines : [])
          .map((l) => ({
            n: Math.round(Number(l?.n)),
            offers: (Array.isArray(l?.offers) ? l.offers : [])
              .map((o) => ({ price: Number(o?.price) > 0 ? Number(o.price) : 0, kind: kinds.has(o?.kind) ? o.kind : '', brand: String(o?.brand ?? '').slice(0, 40), na: !!o?.na }))
              .filter((o) => o.na || o.price > 0),
          }))
          .filter((l) => l.n >= 1 && l.n <= ask.lines.length && l.offers.length);
        return { ask: ask.id, lines, vat: value.vat === 'incl' || value.vat === 'excl' ? value.vat : '' };
      });
    },

    /** v0.86: who chats are to the garage — a few at once, kept by their words. */
    async roles({ chats = [] } = {}) {
      const list = (Array.isArray(chats) ? chats : [])
        .slice(0, 12)
        .map((c) => ({ id: String(c?.id ?? '').slice(0, 80), name: String(c?.name ?? '').slice(0, 80), texts: (Array.isArray(c?.texts) ? c.texts : []).slice(0, 3).map((t) => String(t)) }))
        .filter((c) => c.id && (c.name || c.texts.length));
      if (!list.length) return { chats: [] };
      const key = createHash('sha1').update(JSON.stringify(list)).digest('hex');
      return cached(`roles:${key}`, 'roles', async () => {
        const { value } = await json(
          P.roles(list),
          {
            type: 'object',
            properties: { chats: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, role: { type: 'string' }, confidence: { type: 'number' } }, required: ['id', 'role', 'confidence'] } } },
            required: ['chats'],
          },
          { kind: 'roles', thinking: 'minimal' },
        );
        const ids = new Set(list.map((c) => c.id));
        return {
          chats: (Array.isArray(value.chats) ? value.chats : [])
            .filter((c) => ids.has(c?.id) && ['customer', 'supplier', 'other'].includes(c?.role))
            .map((c) => ({ id: c.id, role: c.role, confidence: Number(c.confidence) || 0 })),
        };
      });
    },

    async partName({ name, make = '', model = '', year = '' } = {}) {
      name = String(name ?? '').trim().slice(0, 160);
      if (!name) throw httpError(400, 'no name');
      const car = carLine({ make, model, year });
      return cached(`name:${name.toLowerCase()}|${car.toLowerCase()}`, 'name', async () => {
        const { value } = await json(P.name(name, car), {
          type: 'object',
          properties: { fixed: { type: 'string' }, english: { type: 'string' }, isPart: { type: 'boolean' }, confidence: { type: 'number' } },
          required: ['fixed', 'english', 'isPart', 'confidence'],
        }, { kind: 'name', thinking: 'minimal' });
        return { name, ...value };
      });
    },
  };
}
