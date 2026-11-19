import { matchPartName } from './partsVocab';

/*
 * Two names of one part (v0.50.2, the user: «определить точно заказ — по-умному, чтобы чётко, к какому заказу это
 * относится»): a supplier's receipt says «CANTER TALLLAMP COVER 96-2013» or «FEBEST PULLY 14 FEB», the job's line says
 * «REAR STOP LIGHT LEFT & RIGHT» or «TENSIONER PULLEY». Both names are taken down to what the part is: brands, quality,
 * years, sizes and quantities out; the car's words aside (they tell the job, not the part); lamp = light, tail / stop /
 * rear light one word, mud flap = mud guard, pully = pulley, shocker = shock absorber…; a typo or a joined word
 * («TALLLAMP») within a letter of a known word; front/rear, upper/lower, inner/outer kept — they tell two parts apart.
 * A Russian line goes through the dictionary's English name (domain/partsVocab.ts).
 */

/** One word for one thing. */
const SAME: Record<string, string> = {
  lamp: 'light',
  lite: 'light',
  pully: 'pulley',
  idler: 'pulley',
  tensoner: 'tensioner',
  tentioner: 'tensioner',
  shocker: 'shock',
  absorber: 'shock',
  strut: 'shock',
  tyre: 'tire',
  disk: 'disc',
  rotor: 'disc',
  bushing: 'bush',
  bushe: 'bush',
  mounting: 'mount',
  antifreeze: 'coolant',
  gaskit: 'gasket',
  gearbox: 'transmission',
  tranmission: 'transmission',
  deferential: 'differential',
  defferential: 'differential',
  deferntial: 'differential',
  diff: 'differential',
  mudguard: 'mudflap',
  mudflaps: 'mudflap',
  taillamp: 'taillight',
  stoplight: 'taillight',
  stoplamp: 'taillight',
  headlamp: 'headlight',
  foglamp: 'foglight',
  shockabsorber: 'shock',
  sparkplug: 'plug',
  oring: 'oring',
  aircon: 'ac',
  airco: 'ac',
};
/** Two words for one thing ("tail" + "light" → taillight). */
const PAIRS: Record<string, Record<string, string[]>> = {
  tail: { light: ['taillight'], gate: ['tailgate'] },
  stop: { light: ['taillight'] },
  brake: { light: ['taillight'], pad: ['pad'], disc: ['disc'], shoe: ['shoe'] },
  back: { light: ['taillight'] },
  rear: { light: ['taillight'] },
  head: { light: ['headlight'], gasket: ['head', 'gasket'] },
  fog: { light: ['foglight'] },
  mud: { flap: ['mudflap'], guard: ['mudflap'] },
  splash: { guard: ['mudflap'] },
  shock: { absorber: ['shock'] },
  spark: { plug: ['plug'] },
  gear: { oil: ['transmission', 'oil'], filter: ['transmission', 'filter'], box: ['transmission'] },
  engine: { oil: ['oil'] },
  motor: { oil: ['oil'] },
  o: { ring: ['oring'] },
  a: { c: ['ac'] },
  air: { con: ['ac'], conditioner: ['ac'] },
  wiper: { blade: ['wiper'] },
};
/** The words that only say how it was sold. */
const NOISE = new Set(
  (
    'original genuine oem orig aftermarket after market dupli duplicate copy used new japan japanese china chinese taiwan korea korean thailand thai ' +
    'germany german usa made pcs pc piece pieces nos qty unit units with and for the of to in on fix fixing fixed replacement replace repair ' +
    'assy assembly complete full both side sides big small type std standard kit set pair ton tons ltr liter litre ml warranty guarantee guaranty month months day days ' +
    'left right lh rh l r part parts spare item no number only each per element' +
    // makers of parts (not cars)
    ' febest kyb denso bosch ngk gates skf nsk koyo ntn mahle mann sakura vic aisin exedy tokico monroe sachs valeo hella depo tyc mobil castrol shell ' +
    'total motul liqui moly delphi brembo trw ate textar ferodo bendix akebono nisshinbo nipparts japanparts ashika blue print febi lemforder meyle ' +
    'moog ctr 555 mitsuboshi bando dayco contitech optibelt hiflo acdelco motorcraft mopar'
  ).split(' '),
);
const POSITIONS: [string, string][] = [
  ['front', 'rear'],
  ['upper', 'lower'],
  ['inner', 'outer'],
];
/** What a part's name is usually made of — what a typo or a joined word is put right to. */
const WORDS = new Set(
  (
    'light taillight headlight foglight mudflap flap guard shock pad disc tire pulley tensioner belt filter oil air fuel cabin transmission coolant ' +
    'radiator hose pipe gasket seal oring plug bulb wiper blade battery alternator starter mount bush boot link arm joint bearing hub axle shaft ' +
    'rack steering pump water compressor condenser evaporator valve expansion thermostat fan motor clutch cover lens bumper mirror door handle glass ' +
    'windshield sensor switch relay fuse injector coil cable wheel nut bolt stud spring caliper drum shoe cylinder master piston ring liner head ' +
    'cam crank timing chain sprocket differential engine fluid ac horn stabilizer control ball tie rod end grille fender bonnet hood trunk ' +
    'tailgate lock window regulator seat carpet mat tank cap housing bracket clip lever knob tail stop back fog mud splash spark gear brake lamp ' +
    'cv abs gas egr turbo skimming alignment wiring harness oxygen pedal speed'
  ).split(' '),
);
/** The last word of these is a piece of the one before it («TAIL LIGHT COVER» is the tail light's). */
const PIECES = new Set(['cover', 'lens', 'glass', 'housing', 'bracket', 'clip', 'cap', 'bulb', 'holder', 'socket', 'seal', 'gasket', 'mount', 'bush', 'kit']);
/** Words that make two parts of one kind different ("oil filter" is not "air filter"). */
const KINDS = new Set(
  'oil air fuel cabin transmission ac water coolant brake clutch power steering engine timing alternator fan spark wiper head tail fog taillight headlight foglight radiator differential axle'.split(
    ' ',
  ),
);

export interface PartName {
  /** What the part is, word by word, the head (the thing itself) last. */
  tokens: string[];
  /** front/rear, upper/lower, inner/outer — as said. */
  pos: string[];
  /** The car words in it ("CANTER", "NISSAN"). */
  cars: string[];
}

const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .trim();
const single = (w: string) =>
  w.length > 4 && /(sh|ch|x|ss)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') ? w.slice(0, -1) : w;

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** The same word, or one within a letter (two in a long one): «PULLY» is «PULLEY», «DEFERNTIAL» is «DIFFERENTIAL». */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  if (len < 4 || a[0] !== b[0]) return false;
  const d = distance(a, b);
  return d <= (len >= 8 ? 2 : 1);
}

const known = (w: string, extra?: Set<string>) => WORDS.has(w) || !!extra?.has(w);
/** A word as the part's names write it: its one word, or the known word it is a typo of. */
function fixWord(w: string, extra?: Set<string>): string {
  const s = SAME[w] ?? w;
  if (known(s, extra)) return s;
  // The nearest known word (the first of the nearest), if one is near enough.
  let best = '';
  let near = Infinity;
  for (const k of [...WORDS, ...(extra ?? [])]) {
    if (!sameWord(s, k)) continue;
    const d = distance(s, k);
    if (d < near) (near = d), (best = k);
  }
  return best ? (SAME[best] ?? best) : s;
}

/** A word that is two joined («TALLLAMP» → tail light): both halves known words, or within a letter of them. */
function split(w: string, extra?: Set<string>): string[] | undefined {
  if (w.length < 7 || known(w, extra)) return undefined;
  for (let i = 3; i <= w.length - 3; i++) {
    const a = w.slice(0, i);
    const b = w.slice(i);
    const fa = [...WORDS].find((k) => k === a || (a.length >= 3 && Math.abs(k.length - a.length) <= 1 && k[0] === a[0] && distance(k, a) <= 1));
    const fb = [...WORDS].find((k) => k === b || (b.length >= 3 && Math.abs(k.length - b.length) <= 1 && k[0] === b[0] && distance(k, b) <= 1));
    if (fa && fb) return [fa, fb];
  }
  return undefined;
}

/**
 * What a part's name says the part is. `carWords` — the cars' makes and models the garage has (their words are set
 * aside as the car, not the part).
 */
export function partName(name: string, carWords: Set<string> = new Set()): PartName {
  const russian = /[а-яё]/i.test(name);
  const text = russian ? matchPartName(name).english || name : name;
  const raw = plain(text).split(' ').filter(Boolean);
  const cars: string[] = [];
  const pos: string[] = [];
  const words: string[] = [];
  for (const r of raw) {
    if (/\d/.test(r) && !/^[a-z]+\d*$/.test(r)) continue;
    if (/\d/.test(r)) {
      // "L200", "H1" — a model, if the garage has one so named.
      if (carWords.has(r)) cars.push(r);
      continue;
    }
    const w = single(r);
    if (carWords.has(w) || carWords.has(r)) {
      cars.push(carWords.has(w) ? w : r);
      continue;
    }
    if (POSITIONS.some((p) => p.includes(w)) || w === 'back') {
      pos.push(w === 'back' ? 'rear' : w);
      if (w !== 'back' && w !== 'rear') continue;
      // "rear light", "back light": also the word before "light".
    }
    if (NOISE.has(w)) continue;
    const parts = split(w) ?? [w];
    for (const p of parts) words.push(p);
  }
  // One word each: typos put right, then two words for one thing joined.
  const fixed = words.map((w) => fixWord(w)).filter((w) => w.length >= 2 && (w.length > 3 || known(w)) && !NOISE.has(w));
  const tokens: string[] = [];
  for (let i = 0; i < fixed.length; i++) {
    const next = fixed[i + 1];
    const joined = next ? PAIRS[fixed[i]]?.[next] : undefined;
    if (joined) {
      tokens.push(...joined);
      i++;
    } else if (fixed[i] !== 'rear' && fixed[i] !== 'back') tokens.push(fixed[i]);
  }
  return { tokens: [...new Set(tokens)], pos: [...new Set(pos)], cars: [...new Set(cars)] };
}

const has = (list: string[], w: string) => list.some((x) => sameWord(x, w));
const head = (p: PartName) => p.tokens[p.tokens.length - 1];

/**
 * How sure two names are one part, 0…1: the same words — 1; one name inside the other with the same thing at the end
 * («PULLEY» in «TENSIONER PULLEY») — 1 (0.8 when the other says much more); the other's piece («TAIL LIGHT COVER» for
 * «TAIL LIGHT») — 0.85; sharing a word that is the thing in one of them («BELT TENSIONER» / «TENSIONER PULLEY») — 0.5;
 * two of one kind told apart by what they are for («OIL FILTER» / «AIR FILTER») or by front/rear — 0.
 */
export function partSimilarity(a: PartName, b: PartName): number {
  if (!a.tokens.length || !b.tokens.length) return 0;
  for (const [x, y] of POSITIONS) if ((a.pos.includes(x) && b.pos.includes(y)) || (a.pos.includes(y) && b.pos.includes(x))) return 0;
  const common = a.tokens.filter((w) => has(b.tokens, w)).length;
  if (!common) return 0;
  const aIn = a.tokens.every((w) => has(b.tokens, w));
  const bIn = b.tokens.every((w) => has(a.tokens, w));
  if (aIn && bIn) return 1;
  if (aIn || bIn) {
    const small = aIn ? a : b;
    const large = aIn ? b : a;
    if (sameWord(head(small), head(large))) return large.tokens.length - small.tokens.length <= 1 ? 1 : 0.8;
    if (PIECES.has(head(large)) && large.tokens.length >= 2 && sameWord(head(small), large.tokens[large.tokens.length - 2])) return 0.85;
    return 0.35;
  }
  const extraA = a.tokens.filter((w) => !has(b.tokens, w));
  const extraB = b.tokens.filter((w) => !has(a.tokens, w));
  if (sameWord(head(a), head(b))) return extraA.some((w) => KINDS.has(w)) && extraB.some((w) => KINDS.has(w)) ? 0.15 : 0.6;
  return has(b.tokens, head(a)) || has(a.tokens, head(b)) ? 0.5 : 0.25;
}

/** The words of a car's make and model ("Fuso Canter" → fuso, canter; Mitsubishi Fuso is one maker). */
const MAKERS: Record<string, string[]> = {
  fuso: ['mitsubishi'],
  mitsubishi: ['fuso'],
  benz: ['mercedes'],
  mercedes: ['benz'],
  chevy: ['chevrolet'],
  chevrolet: ['chevy'],
  vw: ['volkswagen'],
  volkswagen: ['vw'],
};
export const CAR_MAKES = new Set(
  'toyota nissan mitsubishi fuso honda hyundai kia mazda suzuki ford chevrolet chevy gmc dodge jeep chrysler ram lexus infiniti mercedes benz bmw audi volkswagen vw skoda renault peugeot citroen isuzu subaru landrover rover jaguar volvo porsche tesla mg geely chery haval changan jetour daihatsu hino opel cadillac lincoln buick'.split(
    ' ',
  ),
);
export function carWordsOf(make = '', model = ''): string[] {
  const words = plain(`${make} ${model}`)
    .split(' ')
    .filter((w) => w.length >= 2 && !WORDS.has(w) && !NOISE.has(w) && (w.length >= 3 || /\d/.test(w)));
  return [...new Set(words.flatMap((w) => [w, ...(MAKERS[w] ?? [])]))];
}
