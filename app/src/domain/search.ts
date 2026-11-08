/**
 * Keyword search over jobs: what was done, the parts, the complaint, codes, notes. Pure functions —
 * the data is gathered by `services/search.ts`.
 *
 * Words match by their beginning ("колод" finds "колодки", "pad" finds "Pads"), every word of the
 * query has to be found, and common garage words are understood in both languages: the manager types
 * in Russian, the history from Eaglecart is in English ("колодки" finds "Front Brake Pads").
 */

/** Lower case, ё → е, "A/C" → "ac", punctuation → spaces. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\b([a-z])[/.]([a-z])\b/g, '$1$2')
    .replace(/[^a-zа-я0-9؀-ۿ]+/g, ' ')
    .trim();
}

export function tokenize(q: string): string[] {
  const words = normalizeText(q.replace(/^\s*[№#]/, '')).split(' ').filter(Boolean);
  // One letter says nothing about a job (it is the plate code of "A 12345"), unless it is all there is.
  const long = words.filter((w) => w.length > 1 || /\d/.test(w));
  return long.length ? long : words;
}

/**
 * Words that mean the same thing at the garage. A term matches the beginning of a word; "=term"
 * matches only the whole word (short ones like "ac" or "то" would match too much otherwise).
 */
const GROUPS: string[][] = [
  ['масл', 'oil'],
  ['фильтр', 'filter'],
  ['замен', 'change', 'replace'],
  ['тормоз', 'brake'],
  ['колодк', 'pad'],
  ['диск', 'disc', 'disk', 'rotor'],
  ['проточ', 'skimming'],
  ['суппорт', 'caliper'],
  ['кондиц', 'кондей', '=ac', 'aircon', 'air con', 'фреон', 'freon', 'refrigerant'],
  ['компрессор', 'compressor'],
  ['конденсатор', 'condenser'],
  ['испарител', 'evaporator'],
  ['осушител', 'drier', 'dryer'],
  ['радиатор', 'radiator'],
  ['антифриз', 'тосол', 'охлаждающ', 'coolant', 'antifreeze'],
  ['охлад', 'cooler', 'cooling'],
  ['вентилятор', 'fan'],
  ['термостат', 'thermostat'],
  ['помп', 'водян', 'water pump'],
  ['насос', 'pump'],
  ['расширител', 'expansion'],
  ['бачок', 'бачк', 'tank', 'bottle', 'reservoir'],
  ['вакуум', 'vacuum'],
  ['мойк', 'помыв', 'wash'],
  ['шин', 'резин', 'покрыш', 'tire', 'tyre'],
  ['колес', 'wheel'],
  ['прокол', 'puncture'],
  ['развал', 'схожд', 'alignment'],
  ['балансир', 'balancing'],
  ['аккумулятор', '=акб', 'батаре', 'battery'],
  ['двигател', 'мотор', 'engine', 'motor'],
  ['коробк', '=акпп', '=кпп', 'трансмисс', 'gear', 'transmission', '=atf'],
  ['сцеплен', 'clutch'],
  ['рычаг', 'arm'],
  ['тяг', 'rod', 'link'],
  ['рулев', 'руль', 'steering', '=tie'],
  ['рейк', 'rack'],
  ['гидроусил', '=гур', 'power steering'],
  ['амортиз', 'shock', 'absorber', 'strut'],
  ['стойк', 'strut', 'link'],
  ['стабилиз', 'stabili', 'sway'],
  ['подушк', 'опор', 'mounting', 'mount'],
  ['сайлент', 'втулк', 'bush'],
  ['подшипник', 'bearing'],
  ['ступиц', 'hub'],
  ['шаров', 'ball joint'],
  ['полуос', '=шрус', 'axle', '=cv', 'drive shaft'],
  ['клапан', 'valve'],
  ['крышк', 'колпак', 'cover', 'cap'],
  ['датчик', 'sensor'],
  ['натяжител', 'tensioner'],
  ['ремен', 'ремн', 'belt'],
  ['=грм', 'timing'],
  ['ролик', 'шкив', 'pulley', 'idler'],
  ['бампер', 'bumper'],
  ['крыл', 'fender', 'wing'],
  ['фар', 'headlight', 'head lamp', 'headlamp'],
  ['ламп', 'bulb', 'lamp'],
  ['свет', 'light'],
  ['свеч', 'spark', 'plug'],
  ['катушк', 'coil'],
  ['зажиган', 'ignition'],
  ['генератор', 'alternator'],
  ['стартер', 'starter'],
  ['прокладк', 'gasket'],
  ['сальник', 'уплотн', 'seal'],
  ['кольц', 'ring'],
  ['шланг', 'патруб', 'hose', 'pipe'],
  ['труб', 'pipe', 'tube'],
  ['покраск', 'краск', 'paint'],
  ['полиров', 'polish'],
  ['рихтов', 'вмятин', 'dent'],
  ['свар', 'welding'],
  ['ремонт', 'починк', 'repair', 'fixing', 'fix'],
  ['диагност', 'проверк', 'diagnos', 'check', 'inspection', 'scan'],
  ['компьютер', 'computer', 'scan'],
  ['программ', 'кодир', 'прошив', 'programming', 'coding', 'flashing'],
  ['стекл', 'glass', 'windshield', 'windscreen'],
  ['дворник', 'wiper'],
  ['двер', 'door'],
  ['зеркал', 'mirror'],
  ['замок', 'замк', 'lock'],
  ['салон', 'cabin', 'interior'],
  ['воздуш', 'air'],
  ['топлив', 'бензин', 'fuel', 'petrol'],
  ['дизел', 'diesel'],
  ['форсунк', 'injector'],
  ['катализатор', 'catalytic', 'catalyst'],
  ['глушител', 'выхлоп', 'silencer', 'muffler', 'exhaust'],
  ['турбин', 'turbo'],
  ['интеркулер', 'intercooler'],
  ['чистк', 'промыв', 'clean', 'flush'],
  ['жидкост', 'fluid'],
  ['работ', 'labour', 'labor'],
  ['=то', 'техобслуж', 'обслуж', 'service', 'maintenance'],
  ['оригинал', 'original', 'genuine'],
  ['гаранти', 'warranty'],
  ['передн', 'front'],
  ['задн', 'rear'],
  ['лев', 'left'],
  ['прав', 'right'],
  ['верхн', 'upper'],
  ['нижн', 'lower'],
  ['сигнал', 'horn'],
  ['ключ', 'key'],
];

export interface Term {
  text: string;
  exact: boolean;
}

function term(s: string): Term {
  return s.startsWith('=') ? { text: s.slice(1), exact: true } : { text: s, exact: false };
}

/** Does the user's word stand for this dictionary term? */
function relates(token: string, t: Term): boolean {
  if (t.exact) return token === t.text;
  if (token.startsWith(t.text)) return t.text.length >= 3 || token === t.text;
  return token.length >= 3 && t.text.startsWith(token);
}

/**
 * The beginning of a word without its ending, so that "колодки" finds "колодок" and "фильтра",
 * "тормозов" finds "тормоз", "pads" finds "pad". Crude, but the words at a garage are short and few.
 */
export function stem(token: string): string {
  if (/^[а-я]{5,}$/.test(token)) return token.slice(0, Math.max(4, token.length - 2));
  if (/^[a-z]{4,}s$/.test(token)) return token.slice(0, -1);
  return token;
}

/** The word itself and what it means in the other language. */
export function expandToken(token: string): Term[] {
  const base = stem(token);
  const out = new Map<string, Term>([[base, { text: base, exact: base.length <= 2 }]]);
  for (const g of GROUPS) {
    const terms = g.map(term);
    if (terms.some((t) => relates(token, t) || relates(base, t))) for (const t of terms) if (!out.has(t.text)) out.set(t.text, t);
  }
  return [...out.values()];
}

/** Should this word of a shown text be highlighted (it is what the query found)? */
export function wordMatches(word: string, terms: Term[]): boolean {
  const norm = normalizeText(word);
  if (!norm) return false;
  const compact = norm.replace(/ /g, '');
  return terms.some((t) => (/\d/.test(t.text) && compact.includes(t.text)) || norm.split(' ').some((w) => (t.exact ? w === t.text : w.startsWith(t.text))));
}

/** A shown text cut into words (odd indexes) and what is between them (even indexes). */
export function splitWords(text: string): string[] {
  return text.split(/([\p{L}\p{N}]+(?:[/.\-][\p{L}\p{N}]+)*)/u);
}

/** A piece of text prepared for matching. */
export interface Indexed {
  /** Normalized text, words separated by single spaces. */
  norm: string;
  /** Letters and digits only — part numbers typed without their dashes. */
  compact: string;
}

export function indexText(s: string): Indexed {
  const norm = normalizeText(s);
  return { norm, compact: norm.replace(/ /g, '') };
}

function termIn(t: Term, x: Indexed): boolean {
  const words = ` ${x.norm} `;
  if (t.exact) return words.includes(` ${t.text} `);
  return words.includes(` ${t.text}`);
}

/** The term of `terms` found in the text, if any. A word with digits also matches inside a part number. */
export function matchToken(token: string, terms: Term[], x: Indexed): Term | undefined {
  const found = terms.find((t) => termIn(t, x));
  if (found) return found;
  if (/\d/.test(token) && token.length >= 3 && x.compact.includes(token)) return { text: token, exact: false };
  return undefined;
}

export type JobFieldKind = 'item' | 'complaint' | 'code' | 'damage' | 'expense' | 'income';

export interface JobField {
  kind: JobFieldKind;
  /** What is shown in the result. */
  text: string;
  /** What is searched (can hold more than is shown: both titles of a line, its part number and brand). */
  index: Indexed;
}

export interface JobDoc<T = unknown> {
  orderId: string;
  number: number;
  createdAt: string;
  /** Numbers the job is known by: its own, the Eaglecart job and order, its invoices. */
  numbers: string[];
  fields: JobField[];
  /** The car and the customer: they narrow a query ("колодки camry") but alone do not make a job hit. */
  owner: Indexed;
  data: T;
}

export interface JobMatch<T = unknown> {
  doc: JobDoc<T>;
  /** Fields where a word of the query was found, in the order of the job. */
  fields: JobField[];
  /** What to highlight in those fields (see `wordMatches`). */
  highlight: Term[];
  /** The job was found by its number. */
  byNumber: boolean;
}

/** "INV-2026-00012" is found by "inv-2026-00012", "2026-00012" and "12"; "1024" by "1024". */
function numberKeys(n: string): string[] {
  const all = n.replace(/\D/g, '').replace(/^0+/, '');
  const last = (n.match(/(\d+)\D*$/)?.[1] ?? '').replace(/^0+/, '');
  return [all, last].filter(Boolean);
}

/**
 * Words that only say what kind of work it was ("замена масла" = "Engine Oil 5W30"): they help when
 * found but do not exclude a job when missing — unless the query has nothing else.
 */
const SOFT = ['замен', 'установ', 'снят', 'ремонт', 'работ', 'нов', 'change', 'replace', 'repair', 'labour', 'labor', 'charge', 'new'];
const SOFT_WORDS = new Set(['на', 'для', 'по', 'от', 'до', 'за', 'из', 'со', 'the', 'and', 'for', 'with', 'of']);

function isSoft(token: string) {
  return SOFT_WORDS.has(token) || SOFT.some((s) => token.startsWith(s));
}

/** Jobs matching the query, those found by number first, then the newest. */
export function matchJobs<T>(docs: JobDoc<T>[], query: string, limit = 50): { matches: JobMatch<T>[]; total: number } {
  const tokens = tokenize(query);
  if (!tokens.length) return { matches: [], total: 0 };
  const allSoft = tokens.every(isSoft);
  const expanded = tokens.map((tok) => ({ tok, terms: expandToken(tok), soft: !allSoft && isSoft(tok) }));
  // "1024", "#1024", "№ 1024", "INV-2026-00012".
  const numberQuery = /^\s*[№#]?\s*(?:[a-z]{2,4}\s*-?\s*)?\d[\d\s-]*$/i.test(query) ? query.replace(/\D/g, '').replace(/^0+/, '') : '';
  const out: JobMatch<T>[] = [];
  for (const doc of docs) {
    const byNumber = !!numberQuery && doc.numbers.some((n) => numberKeys(n).includes(numberQuery));
    if (byNumber) {
      out.push({ doc, fields: [], highlight: [], byNumber });
      continue;
    }
    const hit = new Set<JobField>();
    const highlight = new Map<string, Term>();
    let inJob = 0;
    let ok = true;
    for (const { tok, terms, soft } of expanded) {
      let found = false;
      for (const f of doc.fields) {
        const m = matchToken(tok, terms, f.index);
        if (m) {
          found = true;
          hit.add(f);
          for (const t of terms) highlight.set(t.text, t);
        }
      }
      if (found) {
        if (!soft) inJob++;
      } else if (!soft && !matchToken(tok, terms, doc.owner)) {
        ok = false;
        break;
      }
    }
    if (ok && inJob > 0) out.push({ doc, fields: doc.fields.filter((f) => hit.has(f)), highlight: [...highlight.values()], byNumber: false });
  }
  out.sort((a, b) => Number(b.byNumber) - Number(a.byNumber) || b.doc.createdAt.localeCompare(a.doc.createdAt));
  return { matches: out.slice(0, limit), total: out.length };
}
