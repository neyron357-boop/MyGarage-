import { brandWord } from './supplierReply';
import { msgKey } from './whatsapp';

/*
 * Which of the garage's requests each message in a supplier's WhatsApp chat is about (v1.04, the owner: «ИИ не понимает
 * контекста ответов поставщиков и присваивает большинство из них к не тем заказам»). Until v1.04 an answer without a
 * quote went to the last request sent to that supplier — and the main supplier gets most requests, often several an
 * hour, while the manager also asks in the same chat by hand (a car's photo with «check same clamp», «gear filter, gear
 * oil», a list pasted from the app): «not avl» to a clamp was put on a Cadillac's three lines and, read again after that
 * job closed, on a truck's radiator cap and bottle.
 *
 * Read on the garage's own chats (28/11/2026: 13 jobs, 22 requests to the main supplier, ~80 answers), a chat goes like a
 * conversation and is read so, message by message:
 *   - our request (the words the app sent) opens its thread; the same words sent again — the same request;
 *   - a message that quotes another is in the quoted one's thread (by its id; else by its words);
 *   - a message naming a car — by its VIN, or its make and model — is about that car's job; a car of no open job, or a
 *     car whose request is not this one — not this request;
 *   - a message naming parts is about the request that has them; our words naming parts of an open job's car that no
 *     request has asked yet — a request of that job made by hand (`chat`); parts of no request — not one of ours;
 *   - anything else (a bare price, «na», «ok», «?», a voice message, a photo) goes on with the thread before it.
 * What our last words in a thread named («Here cap coming», «Brother check radiator bottle») is its `focus`: a bare
 * «20+TAX DUP» after it is the cap's, not the whole request's. Nothing is guessed: a message with no thread is put nowhere.
 */

export interface ThreadLine {
  id: string;
  name: string;
  /** Not bought yet: a line a supplier may still be asked about. */
  open: boolean;
}

/** An open job of the garage: its car and its part lines. */
export interface ThreadJob {
  orderId: string;
  vin?: string;
  make?: string;
  model?: string;
  lines: ThreadLine[];
}

/** A request kept on a job (`PartAsk`), sent to this supplier. */
export interface ThreadAsk {
  id: string;
  orderId: string;
  at: number;
  text: string;
  items: string[];
}

export interface ThreadMsg {
  id: string;
  t: number;
  me: boolean;
  text?: string;
  quote?: { id?: string; text?: string };
}

export interface Thread {
  /** The request kept on a job. */
  ask?: string;
  /** Our own words that asked for lines of an open job by hand (not through the app): the job, the lines, the message. */
  chat?: { orderId: string; items: string[]; msg: string; at: number; text: string };
  /** The lines our last words in the thread were about (item ids). */
  focus?: string[];
  /** Why (for the tests and the log): the request, a quote, a VIN or the car, the parts named, the talk before it. */
  why: 'request' | 'quote' | 'car' | 'parts' | 'before' | 'other' | 'none';
}

/** A thread that puts nothing anywhere: a car's talk with no line of it named yet, another car, parts of no request. */
const NOWHERE = (why: Thread['why']): Thread => ({ why });

/* ---------- Words ---------- */

const clean = (s: string) =>
  s
    .replace(/\r/g, '')
    .replace(/[*_~]/g, ' ')
    .replace(/[‒-―−]/g, '-')
    .toUpperCase();

const norm = (s: string) => clean(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;
export const vinIn = (s: string): string | undefined => {
  const m = VIN_RE.exec(clean(s));
  // a VIN has letters and digits both (a long number is a phone or an account)
  return m && /[A-Z]/.test(m[1]) && /\d/.test(m[1]) ? m[1] : undefined;
};

/** The words a garage writes about a part's place, kind or quantity — not what the part is. */
const NOT_PART = new Set(
  'FRONT REAR LEFT RIGHT AND THE FOR WITH SET FULL ORIGINAL GENUINE OEM ORG DUP DUPL DUPLICATE AFTERMARKET AFTER MARKET COPY USED NEW OLD PCS PIECE PIECES LTR LITER LITRE LITERS LITRES BOTH SIDE SIDES UPPER LOWER INNER OUTER TOP BOTTOM BIG SMALL ONLY COMPLETE ASSY ASSEMBLY KIT PRICE AVAILABILITY PLEASE CHECK NEED SAME CAR VIN'.split(
    ' ',
  ),
);
/** Short forms the garage's suppliers write («FR SHOCK», «RR BRAKE PAD»). */
const SHORT: Record<string, string> = { FR: 'FRONT', FRT: 'FRONT', RR: 'REAR', LH: 'LEFT', RH: 'RIGHT', BRK: 'BRAKE', PADS: 'PAD', BUSHING: 'BUSH', BUSHES: 'BUSH', BEARINGS: 'BEARING', ABSORBERS: 'ABSORBER', SHOCKS: 'SHOCK' };
const word = (w: string) => {
  const s = SHORT[w] ?? w;
  return s.length > 4 && s.endsWith('S') && !s.endsWith('SS') ? s.slice(0, -1) : s;
};
const wordsOf = (s: string) => norm(s).split(' ').filter(Boolean).map(word);

/**
 * The words that name a part (a dictionary of what the garage's suppliers are asked for, its parts' head words): a
 * message with one of them not on a request is about something else.
 */
const PART_WORDS = new Set(
  (
    'ABSORBER ACTUATOR ALTERNATOR ARM AXLE BALL BATTERY BEARING BELT BLADE BLOWER BOLT BONNET BOOSTER BOOT BOTTLE BRAKE BULB BUMPER BUSH CABLE CALIPER CAMSHAFT CAP CARBURETOR CARTRIDGE CATALYTIC CHAIN CLAMP CLIP CLUTCH COIL COMPRESSOR CONDENSER COOLANT COOLER COVER CRANKSHAFT CYLINDER DIFFERENTIAL DISC DISK DRUM EVAPORATOR EXPANSION FAN FENDER FILTER FLUID FLYWHEEL FUSE GASKET GEAR GEARBOX GLASS GREASE GRILLE HANDLE HEADLIGHT HEATER HORN HOSE HUB IGNITION INJECTOR JOINT KNUCKLE LAMP LIGHT LINK MANIFOLD MIRROR MOTOR MOUNT MOUNTING MUFFLER NUT OIL PAD PAN PIPE PISTON PLATE PLUG PULLEY PUMP RACK RADIATOR RELAY RESERVOIR RING RIM ROD ROTOR SEAL SENSOR SHAFT SHOCK SILICON SILICONE SPRING STABILIZER STARTER STRUT SWITCH TANK THERMOSTAT THROTTLE TIE TYRE TIRE TURBO VALVE WASHER WIPER'
  ).split(' '),
);

/** Part words that say what a part is for, not what it is: alone they name no line («gear oil» is not «TRANSMISSION OIL COOLER»). */
const GENERIC = new Set('OIL GEAR GEARBOX BRAKE ENGINE STEERING WHEEL TRANSMISSION POWER AIR FUEL WATER AXLE RADIATOR DOOR TIMING SPARK IGNITION EXHAUST'.split(' '));

/** The part words of a message (a request's own echo is matched against its lines before this is asked). */
export function partWordsIn(text: string): string[] {
  return [...new Set(wordsOf(text).filter((w) => PART_WORDS.has(w) || PART_WORDS.has(w.replace(/S$/, ''))))];
}

/** A line's words that say what it is: no place, kind or quantity, no number, no maker («GEAR OIL NISSAN NS-3», «KYB»). */
function lineWords(name: string): string[] {
  return wordsOf(name.replace(/\(.*?\)/g, ' ')).filter((w) => w.length >= 3 && !/\d/.test(w) && !NOT_PART.has(w) && !brandWord(w));
}

const near = (words: Iterable<string>) => {
  const set = new Set(words);
  return (w: string) => set.has(w) || [...set].some((x) => x.length >= 4 && w.length >= 4 && (x.startsWith(w) || w.startsWith(x)));
};
const PLACES: [string, string][] = [
  ['FRONT', 'REAR'],
  ['LEFT', 'RIGHT'],
  ['UPPER', 'LOWER'],
  ['INNER', 'OUTER'],
];

/**
 * Does the message name this line: what the part is (its last word, or a part's word of it), or two of its words — and
 * no place it is not («FR SHOCK» is the front shock absorber, not the rear one).
 */
export function namesLine(text: string, name: string): boolean {
  const lw = lineWords(name);
  if (!lw.length) return false;
  const words = wordsOf(text);
  const has = near(words.filter((w) => w.length >= 3));
  const hits = lw.filter(has);
  if (!(has(lw[lw.length - 1]) || hits.length >= 2 || hits.some((w) => PART_WORDS.has(w) && !GENERIC.has(w)))) return false;
  const own = new Set(wordsOf(name));
  const said = new Set(words);
  return !PLACES.some(([a, b]) => (said.has(a) && !said.has(b) && own.has(b) && !own.has(a)) || (said.has(b) && !said.has(a) && own.has(a) && !own.has(b)));
}

/** A part word of the message that is on none of these lines. */
function offLines(text: string, names: string[]): string[] {
  const on = near(names.flatMap((n) => wordsOf(n)));
  return partWordsIn(text).filter((w) => !on(w));
}

/** The car a message names without its VIN: its model (four letters or more), or its make and its model. */
function namesCar(text: string, job: ThreadJob): boolean {
  const w = new Set(wordsOf(text));
  const model = (job.model ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter((x) => x.length >= 2);
  const make = (job.make ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter((x) => x.length >= 3);
  if (!model.length) return false;
  const hasModel = model.every((x) => w.has(x));
  if (!hasModel) return false;
  return model.some((x) => x.length >= 4 && /[A-Z]/.test(x)) || make.some((x) => w.has(x));
}

/* ---------- The chat, message by message ---------- */

/** How long a thread waits for an answer with nothing said in it (a supplier answers in hours, not days). */
const QUIET_MS = 3 * 24 * 60 * 60_000;

/**
 * Each message's thread, in the chat's order. `asks` — this supplier's requests kept on open jobs; `jobs` — the garage's
 * open jobs (their cars and part lines).
 */
export function readThreads(msgs: ThreadMsg[], asks: ThreadAsk[], jobs: ThreadJob[]): Map<string, Thread> {
  const out = new Map<string, Thread>();
  const list = [...msgs].sort((a, b) => a.t - b.t);
  const jobOf = new Map(jobs.map((j) => [j.orderId, j]));
  const byKey = new Map<string, Thread>();
  const said: { at: number; text: string; th: Thread }[] = [];
  // Before the first message read: the last request sent before it, if the chat's window starts after it.
  const first = list[0]?.t ?? 0;
  const lastBefore = [...asks].filter((a) => a.at < first).sort((a, b) => b.at - a.at)[0];
  let current: Thread | undefined = lastBefore && first - lastBefore.at < QUIET_MS ? { ask: lastBefore.id, why: 'request' } : undefined;
  let currentAt = lastBefore?.at ?? 0;

  const asksOf = (orderId: string, t: number) => asks.filter((a) => a.orderId === orderId && a.at <= t + 60_000).sort((a, b) => b.at - a.at);
  const jobOfThread = (th?: Thread) => (th?.ask ? asks.find((a) => a.id === th.ask)?.orderId : th?.chat?.orderId);
  const itemsOf = (th?: Thread) => (th?.ask ? (asks.find((a) => a.id === th.ask)?.items ?? []) : (th?.chat?.items ?? []));

  /** A kept request whose own words these are (sent by the app; the same words again — the same request). */
  const requestOf = (m: ThreadMsg) => {
    const n = norm(m.text ?? '').slice(0, 220);
    if (n.length < 12) return undefined;
    return [...asks].filter((a) => a.at <= m.t + 10 * 60_000 && norm(a.text).slice(0, 220) === n).sort((a, b) => b.at - a.at)[0];
  };

  /** The thread of what a message quotes: by its id, else by its words (a kept request's, an earlier message's). */
  const quoted = (m: ThreadMsg): Thread | undefined => {
    const q = m.quote;
    if (!q) return undefined;
    if (q.id) {
      const th = byKey.get(msgKey(q.id)) ?? byKey.get(q.id);
      if (th) return th;
    }
    const qt = norm(q.text ?? '');
    if (qt.length < 2) return undefined;
    const a = [...asks].filter((x) => x.at <= m.t + 60_000 && norm(x.text).startsWith(qt.slice(0, 60))).sort((x, y) => y.at - x.at)[0];
    if (a) return { ask: a.id, why: 'quote' };
    const s = [...said].reverse().find((x) => x.at <= m.t && norm(x.text).startsWith(qt.slice(0, 60)));
    return s?.th;
  };

  /** The lines of a job a message names (open ones; a request's own lines whatever they are). */
  const named = (text: string, orderId: string, among?: string[]) => {
    const job = jobOf.get(orderId);
    if (!job) return [];
    return job.lines.filter((l) => (among ? among.includes(l.id) : l.open) && namesLine(text, l.name)).map((l) => l.id);
  };

  const linesOf = (orderId: string, ids: string[]) => ids.map((id) => jobOf.get(orderId)?.lines.find((l) => l.id === id)).filter((l): l is ThreadLine => !!l);

  /**
   * Another request of this supplier the message names: its open lines named (`plain` — by two of a line's words), every
   * part word of the message on it, and one job only.
   */
  const otherAsk = (m: ThreadMsg, base: Thread | undefined, plain: boolean): Thread | undefined => {
    const text = m.text ?? '';
    const said = near(wordsOf(text));
    const fits = asks
      // a day and a half back at most: an older request is done or forgotten
      .filter((a) => a.at <= m.t + 60_000 && m.t - a.at < 36 * 3600_000 && a.id !== base?.ask && jobOf.has(a.orderId))
      .map((a) => ({ a, lines: linesOf(a.orderId, named(text, a.orderId, a.items)).filter((l) => l.open && (!plain || lineWords(l.name).filter(said).length >= 2)) }))
      .filter((x) => x.lines.length && !offLines(text, linesOf(x.a.orderId, x.a.items).map((l) => l.name)).length);
    if (new Set(fits.map((x) => x.a.orderId)).size !== 1) return undefined;
    const { a, lines } = fits.sort((x, y) => y.a.at - x.a.at)[0];
    return { ask: a.id, why: 'parts', focus: m.me && lines.length < a.items.length ? lines.map((l) => l.id) : undefined };
  };

  /** What a message says it is about, against the thread it would go on with (`base`; `quote` — it is what it quotes). */
  const about = (m: ThreadMsg, base: Thread | undefined, quote: boolean): Thread => {
    const text = m.text ?? '';
    if (!text.trim()) return base ?? NOWHERE('none');
    const vin = vinIn(text);
    let car: ThreadJob | undefined;
    if (vin) {
      car = jobs.find((j) => j.vin && j.vin.toUpperCase() === vin);
      // A VIN of no open job: another car — not one of these requests.
      if (!car) return NOWHERE('other');
    } else {
      const cars = jobs.filter((j) => namesCar(text, j));
      if (cars.length === 1) car = cars[0];
    }
    const baseJob = jobOfThread(base);
    const words = partWordsIn(text);
    if (car && car.orderId !== baseJob) {
      // Another car than the thread's: its request that has the lines named (bought since or not); our words — else a
      // request made by hand (of lines still to buy).
      const kept = asksOf(car.orderId, m.t);
      const asked = named(text, car.orderId, [...new Set(kept.flatMap((a) => a.items))]);
      const has = asked.length ? (kept.find((a) => asked.every((id) => a.items.includes(id))) ?? kept.find((a) => asked.some((id) => a.items.includes(id)))) : undefined;
      if (has) {
        const on = asked.filter((id) => has.items.includes(id));
        return { ask: has.id, why: 'car', focus: m.me && on.length < has.items.length ? on : undefined };
      }
      const lines = named(text, car.orderId);
      if (m.me) return lines.length ? { chat: { orderId: car.orderId, items: lines, msg: m.id, at: m.t, text: text.slice(0, 400) }, why: 'car' } : NOWHERE('car');
      // Theirs about that car: what was asked by hand for it in this chat; the car alone — its latest request.
      const hand = [...said].reverse().find((x) => x.th.chat?.orderId === car!.orderId)?.th;
      if (hand && (lines.length ? lines.some((id) => hand.chat!.items.includes(id)) : !words.length)) return { ...hand, why: 'car', focus: undefined };
      if (!words.length && !lines.length && kept[0]) return { ask: kept[0].id, why: 'car' };
      // A part of that car nobody asked for («MARKED CLIPS» under the car's photo): nothing of ours.
      return NOWHERE('car');
    }
    // The thread's own car, or none named. Their answer to what they quote stays with it.
    if (!words.length || (quote && !m.me && base)) return base ?? NOWHERE('none');
    const items = itemsOf(base);
    const own = baseJob ? linesOf(baseJob, items) : [];
    if (own.length && !offLines(text, own.map((l) => l.name)).length) {
      if (!m.me) return base!;
      // Our words say which of the thread's lines the talk is about now.
      const mine = named(text, baseJob!, items);
      return { ...base!, why: 'parts', focus: mine.length ? (mine.length < items.length ? mine : undefined) : base!.focus };
    }
    // Something else is talked about.
    if (m.me) {
      // Our words: the same car's other lines (their request, else asked by hand), else another request's.
      if (baseJob) {
        const more = named(text, baseJob).filter((id) => !items.includes(id));
        if (more.length) {
          const kept = asksOf(baseJob, m.t).find((a) => more.some((id) => a.items.includes(id)));
          if (kept) {
            const on = more.filter((id) => kept.items.includes(id));
            return { ask: kept.id, why: 'parts', focus: on.length < kept.items.length ? on : undefined };
          }
          return { chat: { orderId: baseJob, items: more, msg: m.id, at: m.t, text: text.slice(0, 400) }, why: 'parts' };
        }
      }
      return otherAsk(m, base, false) ?? NOWHERE('parts');
    }
    // Theirs, quoting nothing: another request only when they name its line plainly; else parts of none of ours.
    return otherAsk(m, base, true) ?? NOWHERE('parts');
  };


  for (const m of list) {
    if (current && m.t - currentAt > QUIET_MS) current = undefined;
    let th: Thread | undefined;
    const request = m.me ? requestOf(m) : undefined;
    if (request) th = { ask: request.id, why: 'request' };
    else {
      const q = quoted(m);
      const base: Thread | undefined = q ? { ...q, why: 'quote' } : current ? { ...current, why: current.why === 'none' ? 'none' : 'before' } : undefined;
      th = about(m, base, !!q);
    }
    out.set(m.id, th);
    byKey.set(msgKey(m.id), th);
    byKey.set(m.id, th);
    if ((m.text ?? '').trim()) said.push({ at: m.t, text: m.text ?? '', th });
    current = th;
    currentAt = m.t;
  }
  return out;
}

/** The request lines' places a thread's focus is about (0 — the first line of the request). */
export function focusIndexes(th: Thread | undefined, items: string[]): number[] | undefined {
  if (!th?.focus?.length) return undefined;
  const at = th.focus.map((id) => items.indexOf(id)).filter((i) => i >= 0);
  return at.length && at.length < items.length ? at : undefined;
}
