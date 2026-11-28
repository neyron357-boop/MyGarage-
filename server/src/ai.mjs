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
 *   receipt(…)        — a supplier's receipt read off its photo (v0.50);
 *   request(…)        — a customer's request in WhatsApp (v0.90): the car and what is asked, off the chat's words and
 *                       its last picture (a registration card) — a light model, no thinking, the same messages never twice
 *   car(…)            — a car's make and model off a small photo taken at check-in (v0.89: low resolution, a few
 *                       hundred tokens).
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
/**
 * A VIN (v0.88): the model read off the maker's own code — the stronger model first, with a little thinking (two or three
 * a day; a light model with none named a Toyota built in Indonesia «Land Cruiser»).
 */
const VIN_MODELS = RECEIPT_MODELS;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const DAY = 24 * 60 * 60_000;
/** How long an answer serves: a VIN, a name and a receipt's picture do not change. */
const TTL = 365 * DAY;

/*
 * The questions, ready-made («заготовки»): short, every word earning its tokens, the facts the app already knows put
 * in front of the model instead of being asked of it.
 */
const P = {
  // Audit 27/11: a WhatsApp message in Arabic, Hindi/Urdu… for the manager; a voice message written down. Never kept.
  translate: (to) =>
    `Translate the WhatsApp message below into ${to === 'ru' ? 'Russian' : 'English'} for the manager of a car garage in the UAE. Keep numbers, prices, part numbers, car and part names as they are. "text": the translation; "from": the message's language (ISO 639-1); "text" is "" when the message is already in that language.`,
  voice: () =>
    `A WhatsApp voice message to a car garage in the UAE — a supplier with prices, a customer, a mechanic; English, Arabic, Hindi/Urdu, Russian or a mix. "text": what is said, word for word, numbers as digits; "english": the same in English ("" when it is English); "from": its language (ISO 639-1); "" for what cannot be heard.`,
  // Audit 27/11: the manager dictates a job's lines. No part named as an example — a light model gives an example back.
  lines: () =>
    `A car garage manager in the UAE dictates what a car needs — parts to replace, work, services — in Russian, English, Arabic or Hindi/Urdu, maybe mixed. "lines": each thing said, in the order said: "name" — in English, in capitals, as a UAE garage writes it on an invoice (the part's usual trade name, with front/rear and left/right when said); "qty" — as said ("both", "left and right", "pair", "обе", "пара" → 2; a set of four → 4), else 1; "kind" — "part" (a thing bought and fitted), "labor" (work the garage does), "service" (a car service done outside or by the hour: wash, towing, painting, alignment); "price" — the sale price in AED only when a number is said for that thing, else 0. Only what is said, nothing added; nothing said — "lines": []. "text": what was said, word for word.`,
  pictureText: () =>
    `A picture or PDF a supplier sent to a car garage in the UAE in answer to a parts request — a price list, a photo of parts with prices, a screenshot of their system, a quotation. "text": every line with a part and its price as written, one per line ("1. brake pads original 180"), numbers as digits; "" if no price is in it.`,
  payment: () =>
    `A picture a customer sent to a car garage in the UAE. isPayment: it is a payment's proof — a bank transfer's confirmation, a card slip, an Apple Pay / wallet receipt. amount: as printed (a number); currency: as printed (AED…); date: as printed, YYYY-MM-DD; reference: the transaction's reference / number; bank: the bank or app; way: "card" for a card slip / POS receipt, else "transfer". Only what is printed — "" or 0 for what is not; confidence 0..1.`,
  // v0.88 (the owner: «по VIN ИИ узнала… марку угадала, но модель неверная: верный Veloz, а ИИ написала Land Cruiser»): no
  // model named in the question — a light model with no thinking gave back the example; the VIN's parts said instead.
  vin: (vin, facts, built) =>
    `VIN ${vin}, a car at a garage in the UAE. Characters 1-3 ("${vin.slice(0, 3)}") are the maker and its plant${built ? ` (built in ${built})` : ''}; 4-8 ("${vin.slice(3, 8)}") are that maker's code of the model, body and engine; the 10th the model year. NHTSA decoder says: ${facts ? JSON.stringify(facts) : 'nothing'}.
Give make, model (the name it is sold under), year, engine (litres and cylinders; "" if unknown), body (one of pickup, van, bus, truck, suv, mpv, sedan; "" if unknown), confidence 0..1 that the model is right. The model only if characters 1-8 tell it — never a model that plant does not build; "" rather than a guess.`,
  // v0.89 (the owner: «распознавание марки и модели автомобиля по фотографии… расход токенов минимальным»): a small photo
  // of the car taken at check-in; no model named in the question (v0.88: a light model gives an example back).
  car: () =>
    `A photo taken as a car comes into a garage in the UAE. isCar: a car (or van, pickup, truck) is the main thing in it. make and model: as it is sold, read off its badges, grille, lights and body; "" for what you cannot tell. confidence 0..1 that the model is right.`,
  // v0.90 (the owner's note #69: «на такие запросы в ватсапе реагировать и автоматически создавать заявку/карточку
  // заказа»): the messages a chat just sent, a picture last (a registration card, the car) when there was one.
  request: (texts, picture) =>
    `WhatsApp messages to a car repair garage in the UAE, oldest first ("[photo]" — a picture${picture ? '; the last one is attached' : ''}; "[voice]" — a voice message written down; "[fwd]" — passed on from someone else):
${texts.map((t) => `- "${t.slice(0, 400)}"`).join('\n')}
isRequest: someone asks the garage to repair, service, fit or price parts or work on a car (not a supplier offering parts, not small talk). car: make, model, year (0 if not said), plate (as written or as on the registration card in the picture: emirate — DXB, AUH, SHJ, AJM, UAQ, RAK, FUJ or ""; code — the letters or digits before the number; number; "" for what is not seen), vin (the 17 characters if shown, else ""). items: each part or work asked, as an English invoice line ("ENGINE MOUNT", "FRONT BRAKE PADS", "AC SERVICE"), kind "part" or "work", both: true when they ask the price of the original and of a copy (duplicate, aftermarket). owner: the car owner's name if said, else "". picture: what the attached picture is — "registration" (the car's registration card, mulkiya), "car", "part", "other", "" if none. confidence 0..1 that it is a request. Only what the messages and the picture show.`,
  name: (name, car) =>
    `A line of a car repair job typed at a UAE garage${car ? ` for a ${car}` : ''}: "${name}" — a spare part, a service or work. It may have typos; it may be English, Russian, or Russian in Latin letters.
fixed: the same words in the same order and language, only spelling put right (keep numbers, sizes, front/rear/left/right); english: the usual English invoice name (e.g. "FRONT BRAKE PADS", "WHEEL ALIGNMENT"); isPart: is it a car part, service or work item; kind: "part" (a spare part, fluid or material that is bought — "CHECK VALVE", "SERVICE KIT", "ENGINE OIL"), "labour" (the labour charge itself), "service" (work done on the car — repair, replacement, fitting, alignment, wash, AC service, towing); kindSure 0..1 for kind; confidence 0..1 for fixed.`,
  // v0.86: the labour line said by the job's parts and work, as a garage writes it on an invoice.
  labour: (parts, work) =>
    `Garage invoice, UAE. Parts on the job: ${parts.join('; ')}.${work.length ? ` Other work on it: ${work.join('; ')}.` : ''}
Write what the labour charge is for, as on a garage invoice: a verb and the parts, e.g. "REPLACE FRONT BRAKE PADS & DISCS", "OVERHAUL GEARBOX, REPLACE ATF FILTER". English capitals, at most 70 characters, no prices, no "LABOR CHARGE".`,
  // v0.86: a supplier's WhatsApp answer read when the app's own rules found no prices in it.
  // v1.04 (the owner: «ИИ не понимает контекста ответов поставщиков… ошибочно понимает, где цена, а где количество»): the
  // chat's talk before the message (the app tells which request it is from the chat itself) and what that talk was about;
  // what is a price and what is not, as the garage's suppliers write.
  reply: (text, quote, asks, context = [], focus = []) =>
    `A UAE auto-parts supplier wrote to a garage on WhatsApp. The garage's requests to this supplier (lines numbered):
${asks.map((a, k) => `${String.fromCharCode(65 + k)}) ${a.car || 'car'}: ${a.lines.map((l, n) => `${n + 1}. ${l}`).join('; ')}`).join('\n')}
${context.length ? `The chat about it just before, oldest first ("G:" the garage, "S:" the supplier):\n${context.map((c) => `  ${c.slice(0, 160)}`).join('\n')}\n` : ''}${focus.length ? `The garage's last words there were about line${focus.length > 1 ? 's' : ''} ${focus.join(', ')}.\n` : ''}The supplier's message${quote ? ` (a reply to: "${quote.slice(0, 300)}")` : ''}:
"""${text.slice(0, 2000)}"""
ask: the letter of the request it answers ("" if it gives no prices or answers none). lines: each line it gives a price or "not available" for — n (line number; a bare price or "na" is about the line the talk was about), offers: each price it says for it — price (AED for ONE piece: "95x2" or "2x95" for two pieces is 95; parts of a set added up, "150+80+75+80", is 385 for the line), kind ("oem" original/genuine, "aftermarket" copy/duplicate/brand, "used", "" if not said), brand ("" if none), na (true: not available). A size (0.25, std, 4L), a quantity, a part number, a phone or account number, a percentage, a time or a day is never a price; a question or a remark with no price gives no lines. vat: "incl" if the prices include VAT, "excl" if VAT is on top ("+", "+VAT", "+TAX"), "" if not said. Only what the message says.`,
  // v0.86: who a chat is to the garage, by its name and its last words. v0.91 (the owner: «на какие марки авто она часто
  // отвечает»): and the car makes a supplier deals with. v0.91.2 (the owner: «ИИ очень плохо анализировал чаты — те, что ни к
  // чему и не к гаражу, он присвоил статус клиента или поставщика»; measured on made-up chats: a friend's own car problem —
  // «customer», another garage borrowing a tool — «supplier»): who wrote each line is said (G — the garage, T — them), «other»
  // is the rule and the two roles need what is written to show them; each chat a short key (c1…), not its long number.
  roles: (chats) =>
    `A car repair garage in the UAE runs WhatsApp on its business phone. Most chats on it are NOT the garage's business: family, friends, neighbours, other garages and mechanics, banks, government, insurance, shops, delivery, ads, people talking about their own cars to a friend.
For each chat decide what it is TO THIS GARAGE, only by its name and what is written ("G:" — written by the garage, "T:" — written by them):
- "supplier": sells THIS garage car parts, oils, tyres or batteries, or does paid outside work on its cars (paint, towing, machining, upholstery). Signs: the garage (G) asks for a part, a price or availability for a car and they (T) answer with a price or availability; they offer parts for sale; or the name is an auto-parts or car-service business.
- "customer": brings or sends their own car or their company's cars to THIS garage for repair or service. Signs: they (T) ask the garage to repair or check their car, the price of the work, when their car is ready, for the invoice, or they pay the garage; or the garage (G) tells them about their car, its price or invoice.
- "other": everything else, and whenever the words do not clearly show one of the two: a name alone, greetings, personal talk, a friend's car problems, borrowing tools, selling a car, insurance, registration, rent, money between people, jobs, ads, a business of another kind.
makes: for a supplier, the car makes it sells parts for when its name or words say so (e.g. ["Toyota","Lexus"]; "American" — ["Ford","Chevrolet","GMC","Dodge","Jeep"]); [] otherwise. confidence: 0..1 that the role is right.
${chats.map((c) => `${c.key}${c.known ? ` (known ${c.known})` : ''} — "${c.name}": ${c.texts.length ? c.texts.map((t) => `"${t.slice(0, 160)}"`).join(' / ') : '(no messages)'}`).join('\n')}`,
  receipt: () =>
    `A photo (or a PDF) of a supplier's invoice or receipt in the UAE (amounts in AED; VAT 5 %). The garage is the buyer; read the seller's paper exactly as printed.
Return: isReceipt (an invoice/receipt/bill at all); vendor (the seller's name as printed, not the buyer's); vendorTrn; vendorPhone (a mobile first, "" if none); vendorEmail ("" if none); vendorAddress (a few words, "" if none); kind — "parts" (car parts, accessories, oils, consumables), "service" (a workshop's or contractor's bill for work: paint, alignment, machining, towing, car wash), "fuel", "food" or "other"; invoiceNo;
dateText — the document's date exactly as printed ("18-Nov-2026", "17/11/26"; "" if none); date — that date as YYYY-MM-DD: UAE papers write the day first (05/11/2026 is 5 November); read every digit of day, month and year — a stamp or a fold may cover some; dateSure — false if any digit of the date is hidden or unclear;
items — every line printed, none left out and none twice, each {name (as printed), part (the usual English name of the part alone, in full words: no brand, car, years, sizes, side or quantity — "TAIL LIGHT COVER", "MUD FLAP", "ATF PAN GASKET"; shorthand written out and misspellings put right — RD: RADIATOR, CON: CONDENSER (CON ROD: CONNECTING ROD), COC: CLUTCH OPERATING CYLINDER, CMC: CLUTCH MASTER CYLINDER, FRT BRK PAD: FRONT BRAKE PADS, ENG MOUNT: ENGINE MOUNT, BREAK FLUID: BRAKE FLUID; these papers write the car first: "TUCSON AC VALVE KX" is an AC valve of a Hyundai Tucson, "COROLLA HYBRID FAN MOTOR ZR" a fan motor of a Toyota Corolla Hybrid), car (the car make/model the line names, as written — "TUCSON", "COROLLA HYBRID"; "" if none), brand (a maker or a short code written with the part — "KX", "ZR", "DENSO"; never read as a word of the part — a code "SAT" is not "SET"; "" if none), kind ("oem" when the line says genuine/original or ends in G, "aftermarket" when it says duplicate/copy or ends in D, "used", "" if not said), partNumber ("" if none), qty, unitPrice, total (as printed)};
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

/** A voice recording as the questions take it (an iPhone's AAC in MP4 named m4a — the name Gemini knows). */
function audioOf(audio) {
  const type = String(audio?.type ?? '').split(';')[0].trim().toLowerCase();
  const data = String(audio?.data ?? '');
  if (!/^audio\/(ogg|opus|mpeg|mp3|mp4|m4a|aac|wav|webm)$/.test(type) || data.length < 200 || data.length > 8_000_000) throw httpError(400, 'no voice');
  return { type: type === 'audio/mp4' ? 'audio/m4a' : type, data };
}

const LINE_KINDS = new Set(['part', 'labor', 'service']);

/** A picture as the questions take it: JPEG, PNG or WebP (a supplier's quotation also as a PDF), base64, a sane size. */
function picOf(image, { pdf = false } = {}) {
  const type = String(image?.type ?? '').split(';')[0].trim().toLowerCase();
  const data = String(image?.data ?? '');
  if (!(/^image\/(jpeg|png|webp)$/.test(type) || (pdf && type === 'application/pdf')) || data.length < 500 || data.length > 6_000_000) throw httpError(400, 'no picture');
  return { type, data };
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
   * «minimal» — the light models only, the stronger ones refuse it: «low»); `media: 'low'` — the pictures looked at in
   * low resolution (v0.89: a car's make — a few hundred tokens, not a thousand; a model that does not take it is asked
   * again without it); `'medium'` — a paper's letters (v0.90: a registration card in a WhatsApp request).
   */
  async function ask(text, { kind = 'other', schema, images = [], audio, models: list, timeout = 25_000, thinking = 'low', media } = {}) {
    if (!key()) throw httpError(503, 'ai off');
    const bodyFor = (model, res) => ({
      // Each picture under its own label («Picture 1:»…).
      contents: [{ parts: [{ text }, ...images.flatMap((i, k) => [{ text: `Picture ${k + 1}:` }, { inline_data: { mime_type: i.type, data: i.data } }]), ...(audio ? [{ text: 'Voice message:' }, { inline_data: { mime_type: audio.type, data: audio.data } }] : [])] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: thinking === 'minimal' && !/lite/.test(model) ? 'low' : thinking },
        ...(res ? { mediaResolution: res === 'medium' ? 'MEDIA_RESOLUTION_MEDIUM' : 'MEDIA_RESOLUTION_LOW' } : {}),
        ...(schema ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}),
      },
    });
    let last;
    for (const model of order(list)) {
      let res;
      try {
        res = await timed(`${API}/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key() }, body: JSON.stringify(bodyFor(model, media)) }, timeout);
        // The resolution refused by this model: the same question at its own.
        if (res.status === 400 && media) res = await timed(`${API}/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key() }, body: JSON.stringify(bodyFor(model, false)) }, timeout);
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
      // (v0.88: a new question — what the old one answered is not given again.)
      return cached(`vin:2:${vin}`, 'vin', async () => {
        const facts = await vpic(vin);
        const built = builtWhere(vin);
        // The official decoder said it all (a car made for the USA): nothing to ask Gemini.
        const own = carFromFacts(facts);
        if (own && own.make && own.model && own.year && (own.engine || own.body)) return { vin, ...own, confidence: 0.95, facts, built, by: 'nhtsa' };
        const { value, model } = await json(P.vin(vin, facts, built), {
          type: 'object',
          properties: { make: { type: 'string' }, model: { type: 'string' }, year: { type: 'integer' }, engine: { type: 'string' }, body: { type: 'string' }, confidence: { type: 'number' } },
          required: ['make', 'model', 'confidence'],
        }, { kind: 'vin', models: VIN_MODELS, thinking: 'low' });
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
      // v1.05: a PDF invoice too (the multi-scanner of the suppliers' papers)
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(type) || data.length < 1000 || data.length > 8_000_000) throw httpError(400, 'no picture');
      const hash = createHash('sha256').update(data).digest('hex');
      return cached(`receipt:6:${hash}`, 'receipt', async () => {
        const { value, model } = await json(
          P.receipt(),
          {
            type: 'object',
            properties: {
              isReceipt: { type: 'boolean' },
              vendor: { type: 'string' },
              vendorTrn: { type: 'string' },
              vendorPhone: { type: 'string' },
              vendorEmail: { type: 'string' },
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
                  properties: { name: { type: 'string' }, part: { type: 'string' }, car: { type: 'string' }, brand: { type: 'string' }, kind: { type: 'string' }, partNumber: { type: 'string' }, qty: { type: 'number' }, unitPrice: { type: 'number' }, total: { type: 'number' } },
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

    /**
     * The car's make and model off its photo at check-in (v0.89): a small picture (the app sends ~512 px), looked at in low
     * resolution by a light model with no thinking — a few hundred tokens; the same picture never twice. The app takes
     * it only where the card is empty, and holds it against the VIN later (domain/carPhoto.ts).
     */
    async car({ image } = {}) {
      const type = String(image?.type ?? '');
      const data = String(image?.data ?? '');
      if (!/^image\/(jpeg|png|webp)$/.test(type) || data.length < 1000 || data.length > 1_500_000) throw httpError(400, 'no picture');
      const hash = createHash('sha256').update(data).digest('hex');
      return cached(`car:1:${hash}`, 'car', async () => {
        const { value, model } = await json(
          P.car(),
          { type: 'object', properties: { isCar: { type: 'boolean' }, make: { type: 'string' }, model: { type: 'string' }, confidence: { type: 'number' } }, required: ['isCar', 'make', 'model', 'confidence'] },
          { kind: 'car', images: [{ type, data }], thinking: 'minimal', media: 'low', timeout: 30_000 },
        );
        return { ...value, by: model };
      });
    },

    /**
     * A customer's request in WhatsApp (v0.90, #69): is it one, the car (its plate and VIN as written or as on the
     * registration card in the picture), the parts and work asked. A light model, no thinking, the picture at medium
     * resolution; the same messages and picture never twice. The app checks what it takes (domain/waRequest.ts).
     */
    async request({ texts = [], image } = {}) {
      const list = (Array.isArray(texts) ? texts : []).map((x) => String(x).trim().slice(0, 400)).filter(Boolean).slice(-12);
      if (!list.length) throw httpError(400, 'no messages');
      const type = String(image?.type ?? '');
      const data = String(image?.data ?? '');
      const pic = /^image\/(jpeg|png|webp)$/.test(type) && data.length > 1000 && data.length < 3_000_000 ? [{ type, data }] : [];
      const hash = createHash('sha256').update(JSON.stringify(list)).update(pic[0]?.data ?? '').digest('hex');
      return cached(`request:2:${hash}`, 'request', async () => {
        const item = { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['part', 'work'] }, both: { type: 'boolean' } }, required: ['name', 'kind'] };
        const plate = { type: 'object', properties: { emirate: { type: 'string' }, code: { type: 'string' }, number: { type: 'string' } }, required: ['emirate', 'code', 'number'] };
        const { value, model } = await json(
          P.request(list, pic.length > 0),
          {
            type: 'object',
            properties: {
              isRequest: { type: 'boolean' },
              car: { type: 'object', properties: { make: { type: 'string' }, model: { type: 'string' }, year: { type: 'integer' }, plate, vin: { type: 'string' } }, required: ['make', 'model'] },
              items: { type: 'array', items: item },
              owner: { type: 'string' },
              picture: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['isRequest', 'items', 'confidence'],
          },
          { kind: 'request', images: pic, thinking: 'minimal', media: 'medium', timeout: 40_000 },
        );
        return { ...value, by: model };
      });
    },

    /**
     * Audit 27/11: a chat message in the manager's language (Arabic, Hindi/Urdu… → Russian or English). A light model, no
     * thinking. The answer is NOT kept (the chat's words are never stored, v0.78) — asked each time it is tapped.
     */
    async translate({ text, to } = {}) {
      const t = String(text ?? '').trim().slice(0, 2000);
      if (!t) throw httpError(400, 'no text');
      const { value, model } = await json(`${P.translate(to === 'ru' ? 'ru' : 'en')}\n\nMessage:\n${t}`, { type: 'object', properties: { text: { type: 'string' }, from: { type: 'string' } }, required: ['text', 'from'] }, { kind: 'translate', thinking: 'minimal', timeout: 20_000 });
      return { text: String(value.text ?? ''), from: String(value.from ?? ''), by: model };
    },

    /**
     * Audit 27/11: a voice message written down (and in English) — a supplier's prices said aloud, a customer's request.
     * Gemini hears it (32 tokens a second: half a minute ≈ 1 000). NOT kept, as the chat's words never are.
     */
    async voice({ audio } = {}) {
      const type = String(audio?.type ?? '').split(';')[0].trim().toLowerCase();
      const data = String(audio?.data ?? '');
      if (!/^audio\/(ogg|opus|mpeg|mp3|mp4|m4a|aac|wav|webm)$/.test(type) || data.length < 200 || data.length > 8_000_000) throw httpError(400, 'no voice');
      // Gemini knows m4a, not mp4 (an iPhone's recording is AAC in MP4).
      const mime = type === 'audio/mp4' ? 'audio/m4a' : type;
      const { value, model } = await json(P.voice(), { type: 'object', properties: { text: { type: 'string' }, english: { type: 'string' }, from: { type: 'string' } }, required: ['text', 'english', 'from'] }, { kind: 'voice', audio: { type: mime, data }, thinking: 'minimal', timeout: 60_000 });
      return { text: String(value.text ?? ''), english: String(value.english ?? ''), from: String(value.from ?? ''), by: model };
    },

    /**
     * Audit 27/11: a supplier's prices sent as a picture (a photo of a price list, a screenshot of their system) — its
     * lines written down as text, read then by the app's own rules. A light model, low resolution; NOT kept.
     */
    /**
     * Audit 27/11: the job's lines dictated (the «Добавить позицию» sheet's microphone): what was said, as lines — the
     * name in English, the number, the kind, a price only when said. The app's own rules name and price them after
     * (the dictionary, the garage's history). NOT kept.
     */
    async voiceLines({ audio } = {}) {
      const a = audioOf(audio);
      const { value, model } = await json(
        P.lines(),
        {
          type: 'object',
          properties: {
            text: { type: 'string' },
            lines: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'number' }, kind: { type: 'string' }, price: { type: 'number' } }, required: ['name', 'qty', 'kind', 'price'] } },
          },
          required: ['text', 'lines'],
        },
        { kind: 'lines', audio: a, thinking: 'minimal', timeout: 60_000 },
      );
      const lines = (Array.isArray(value.lines) ? value.lines : [])
        .map((l) => ({
          name: String(l?.name ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 80),
          qty: Math.min(20, Math.max(1, Math.round(Number(l?.qty) || 1))),
          kind: LINE_KINDS.has(l?.kind) ? l.kind : 'part',
          price: Math.min(100_000, Math.max(0, Number(l?.price) || 0)),
        }))
        .filter((l) => l.name.length >= 2)
        .slice(0, 20);
      return { text: String(value.text ?? '').slice(0, 2000), lines, by: model };
    },

    async pictureText({ image } = {}) {
      const pic = picOf(image, { pdf: true });
      const { value, model } = await json(P.pictureText(), { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, { kind: 'picture', images: [pic], thinking: 'minimal', media: 'medium', timeout: 40_000 });
      return { text: String(value.text ?? ''), by: model };
    },

    /**
     * Audit 27/11: a customer's picture — is it a payment (a bank transfer's screenshot, a card slip): the amount, the
     * currency, the day, the reference, the bank. Only what is printed; the app checks it against what is due. NOT kept.
     */
    async payment({ image } = {}) {
      const pic = picOf(image);
      const { value, model } = await json(
        P.payment(),
        {
          type: 'object',
          properties: { isPayment: { type: 'boolean' }, amount: { type: 'number' }, currency: { type: 'string' }, date: { type: 'string' }, reference: { type: 'string' }, bank: { type: 'string' }, way: { type: 'string' }, confidence: { type: 'number' } },
          required: ['isPayment', 'amount', 'currency', 'confidence'],
        },
        { kind: 'payment', images: [pic], thinking: 'minimal', media: 'medium', timeout: 40_000 },
      );
      return { ...value, by: model };
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
    async reply({ text, quote = '', asks = [], context = [], focus = [] } = {}) {
      text = String(text ?? '').trim();
      const list = (Array.isArray(asks) ? asks : []).slice(0, 4).map((a) => ({
        id: String(a?.id ?? ''),
        car: String(a?.car ?? '').slice(0, 60),
        lines: (Array.isArray(a?.lines) ? a.lines : []).slice(0, 25).map((l) => String(l).slice(0, 80)),
      }));
      if (!text || !list.length || !list.some((a) => a.lines.length)) throw httpError(400, 'nothing to read');
      // v1.04: the talk before it (a few lines) and the lines it was about.
      const talk = (Array.isArray(context) ? context : []).slice(-6).map((c) => String(c).slice(0, 160));
      const about = (Array.isArray(focus) ? focus : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 25).slice(0, 10);
      const key = createHash('sha1').update(JSON.stringify([text, String(quote).slice(0, 300), list, ...(talk.length || about.length ? [talk, about] : [])])).digest('hex');
      return cached(`reply:2:${key}`, 'reply', async () => {
        const offer = { type: 'object', properties: { price: { type: 'number' }, kind: { type: 'string' }, brand: { type: 'string' }, na: { type: 'boolean' } }, required: ['price', 'kind', 'na'] };
        const { value } = await json(
          P.reply(text, String(quote), list, talk, about),
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

    /**
     * v0.86: who chats are to the garage — a few at once, kept by their words. v0.91: a supplier's makes too (`makes` in
     * every answer: the app knows this server says them); `known` — what the garage already knows the chat to be.
     */
    async roles({ chats = [] } = {}) {
      const list = (Array.isArray(chats) ? chats : [])
        .slice(0, 12)
        .map((c) => ({
          id: String(c?.id ?? '').slice(0, 80),
          name: String(c?.name ?? '').slice(0, 80),
          // v0.91.2: up to eight lines, each «G: …» (the garage) or «T: …» (them).
          texts: (Array.isArray(c?.texts) ? c.texts : []).slice(0, 8).map((t) => String(t)),
          known: ['customer', 'supplier'].includes(c?.known) ? c.known : '',
        }))
        .filter((c) => c.id && (c.name || c.texts.length))
        .map((c, k) => ({ ...c, key: `c${k + 1}` }));
      if (!list.length) return { chats: [] };
      const key = createHash('sha1').update(JSON.stringify(list)).digest('hex');
      return cached(`roles:3:${key}`, 'roles', async () => {
        const { value } = await json(
          P.roles(list),
          {
            type: 'object',
            properties: {
              chats: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, role: { type: 'string' }, makes: { type: 'array', items: { type: 'string' } }, confidence: { type: 'number' } },
                  required: ['id', 'role', 'makes', 'confidence'],
                },
              },
            },
            required: ['chats'],
          },
          // v0.91.2: a little thinking — the two roles need the words weighed, not the name guessed.
          { kind: 'roles', thinking: 'low' },
        );
        const byKey = new Map(list.map((c) => [c.key, c.id]));
        return {
          chats: (Array.isArray(value.chats) ? value.chats : [])
            .filter((c) => byKey.has(c?.id) && ['customer', 'supplier', 'other'].includes(c?.role))
            .map((c) => ({
              id: byKey.get(c.id),
              role: c.role,
              makes: (Array.isArray(c.makes) ? c.makes : []).map((m) => String(m).trim().slice(0, 30)).filter(Boolean).slice(0, 8),
              confidence: Number(c.confidence) || 0,
            })),
        };
      });
    },

    async partName({ name, make = '', model = '', year = '' } = {}) {
      name = String(name ?? '').trim().slice(0, 160);
      if (!name) throw httpError(400, 'no name');
      const car = carLine({ make, model, year });
      // v0.91.7: the kind too (one «Добавить» for every kind — the app's guess not sure): asked anew (`name:2:`).
      return cached(`name:2:${name.toLowerCase()}|${car.toLowerCase()}`, 'name', async () => {
        const { value } = await json(P.name(name, car), {
          type: 'object',
          properties: { fixed: { type: 'string' }, english: { type: 'string' }, isPart: { type: 'boolean' }, kind: { type: 'string', enum: ['part', 'labour', 'service'] }, kindSure: { type: 'number' }, confidence: { type: 'number' } },
          required: ['fixed', 'english', 'isPart', 'kind', 'kindSure', 'confidence'],
        }, { kind: 'name', thinking: 'minimal' });
        return { name, ...value };
      });
    },
  };
}
