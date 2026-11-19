/*
 * The open parts catalogue read by a part's number (v0.55, the user: «улучши способность поиска ИИ деталей; приоритет по
 * фото — схема детали; сократи траты на токены максимально; сделай намного быстрее»).
 *
 * megazip.net (the PartsBooster EPC) serves a page for a genuine number of the Japanese and Korean makes (and some
 * German ones) at a plain address — https://www.megazip.net/parts/<make>-<NUMBER>: the maker's own name of the part, the
 * numbers that replaced it or that it replaced, and the factory diagrams it is on — each with the model, its years and
 * the place of the part's callout on the drawing. This computer reads that page itself: no AI, no paid search, half a
 * second. So a number — found on the web, guessed by the model, typed by the manager, remembered from another job — is
 * checked for free: it exists, it is that kind of part, it is on a diagram of this model in these years; and the part's
 * diagram comes with it, its callout marked.
 *
 * Nothing here is executed from the page: its data is read with patterns, and what is not found is simply not known
 * (the page may change — then a number is «not checked», never wrong).
 */

export const CATALOG_HOST = 'https://www.megazip.net';

/** The catalogue's makes: how the car's make is written → the catalogue's own; a sister make's numbers are tried next. */
const SLUGS = {
  toyota: ['toyota', 'lexus'],
  lexus: ['lexus', 'toyota'],
  scion: ['toyota'],
  daihatsu: ['daihatsu', 'toyota'],
  nissan: ['nissan', 'infiniti'],
  infiniti: ['infiniti', 'nissan'],
  datsun: ['nissan'],
  honda: ['honda', 'acura'],
  acura: ['acura', 'honda'],
  mitsubishi: ['mitsubishi'],
  fuso: ['mitsubishi'],
  mitsubishifuso: ['mitsubishi'],
  mazda: ['mazda'],
  subaru: ['subaru'],
  suzuki: ['suzuki'],
  isuzu: ['isuzu'],
  hyundai: ['hyundai', 'kia'],
  kia: ['kia', 'hyundai'],
  genesis: ['hyundai'],
  bmw: ['bmw'],
  mini: ['bmw'],
  mercedes: ['mercedes'],
  mercedesbenz: ['mercedes'],
};

const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const plainNumber = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The catalogue's makes to try for a car's make (none — the catalogue does not have the make). */
export function catalogSlugs(make) {
  return SLUGS[squash(make)] ?? [];
}

/** The address of a number's page; '' when the number cannot be one. */
export function catalogUrl(slug, number) {
  let n = plainNumber(number);
  // A Mercedes number is written with its «A» in front; the catalogue has it without.
  if (slug === 'mercedes') n = n.replace(/^A(?=\d{9,})/, '');
  return n.length >= 5 && n.length <= 20 ? `${CATALOG_HOST}/parts/${slug}-${n}` : '';
}

/** A text of the page's data: a quoted string with its escapes. */
const STR = '"((?:[^"\\\\]|\\\\.)*)"';
function unquote(s) {
  try {
    return String(JSON.parse(`"${s}"`));
  } catch {
    return String(s ?? '');
  }
}
const entities = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The years a diagram's model was made: «2005 — 2011», «2002 for today», «Model 2016». */
export function yearsOf(lines) {
  for (const l of lines) {
    const span = /(\d{4})\s*[—–-]\s*(\d{4})/.exec(l);
    if (span) return { from: Number(span[1]), to: Number(span[2]) };
    const open = /(\d{4})\s*(?:for today|[—–-]\s*(?:present|now|today)|[—–-]\s*$)/i.exec(l) ?? /(?:model|from|since)\s*(\d{4})/i.exec(l);
    if (open) return { from: Number(open[1]) };
  }
  return undefined;
}

/**
 * A number's page read: the number as the catalogue writes it, the maker's name of the part, the make, the numbers that
 * replaced it (`newer`) or that it replaced (`older`), and its diagrams — the picture, the diagram's name, the model
 * and its years, where the part's callout is on the drawing (`areas`, in the picture's own pixels). Not a part's page — null.
 */
export function readCatalogPage(html) {
  html = String(html ?? '');
  let number = '';
  let name = '';
  let brand = '';
  // 1. What the page says of itself to the search engines (schema.org) — the steadiest part of it.
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j?.['@type'] !== 'Product') continue;
      number = String(j.mpn ?? '').trim();
      name = String(j.name ?? '').trim();
      brand = String(j.brand?.name ?? '').trim();
    } catch {
      // not this one
    }
  }
  // 2. The page's own data: the part, its family of numbers, its diagrams.
  const at = html.indexOf('/getPart/');
  const dAt = html.indexOf('/getPartDiagrams/');
  const part = at >= 0 ? html.slice(at, dAt > at ? dAt : at + 6000) : '';
  const own = new RegExp(`part:\\{id:\\d+,number:${STR},numberFormatted:${STR},name:${STR}`).exec(part);
  if (own) {
    number = number || unquote(own[2]);
    name = name || unquote(own[3]);
  }
  if (!brand) {
    const b = new RegExp(`brand:\\{slug:${STR},name:${STR}\\}`).exec(part);
    if (b) brand = unquote(b[2]);
  }
  if (!number) {
    // 3. The title, as a last word: «88310-52481 Genuine Toyota Compressor Assy, W/Pulley | Megazip».
    const t = /<title>\s*([A-Z0-9][A-Z0-9 -]{3,24}?)\s+Genuine\s+(\S+)\s+([^<|]+?)\s*\|/i.exec(html);
    if (!t) return null;
    number = t[1].trim();
    brand = brand || t[2];
    name = name || entities(t[3]);
  }
  // The family: the numbers after the part's own in its data. Which way — by the part's own marks.
  const family = [...new Set([...part.matchAll(new RegExp(`numberFormatted:${STR}`, 'g'))].map((m) => unquote(m[1])))].filter((n) => plainNumber(n) !== plainNumber(number));
  const marks = /supersessions:\[(.*?)\],reverseSupersessions:\[(.*?)\]\}/.exec(part);
  const superseded = !!marks && /supersessionSet/.test(marks[1]);
  const replaces = !!marks && marks[2].trim().length > 0;
  const newer = superseded && !replaces ? family : [];
  const older = replaces && !superseded ? family : [];
  const diagrams = [];
  if (dAt >= 0) {
    const end = html.indexOf('/getPartRating/', dAt);
    const data = html.slice(dAt, end > dAt ? end : dAt + 40_000);
    const one = new RegExp(`\\{image:${STR},name:${STR},text:\\{header:${STR},subHeader:\\[([^\\]]*)\\]\\},areas:\\[([^\\]]*)\\]\\}`, 'g');
    for (const m of data.matchAll(one)) {
      const image = unquote(m[1]);
      if (!/^https:\/\//.test(image) || diagrams.some((d) => d.image === image)) continue;
      const lines = [...m[4].matchAll(new RegExp(STR, 'g'))].map((x) => unquote(x[1]));
      const areas = [...m[5].matchAll(/\{x1:([\d.]+),y1:([\d.]+),x2:([\d.]+),y2:([\d.]+)\}/g)].map((a) => ({ x1: Number(a[1]), y1: Number(a[2]), x2: Number(a[3]), y2: Number(a[4]) }));
      diagrams.push({ image, name: unquote(m[2]), model: unquote(m[3]), lines, years: yearsOf(lines), areas: areas.slice(0, 12) });
    }
  }
  if (!diagrams.length) {
    // The data not read (the page changed): the diagrams' pictures are still in it.
    for (const m of html.matchAll(/<img[^>]+src="(https:\/\/epc\.partsbooster\.com\/schemas\/[^"]+)"/g)) if (!diagrams.some((d) => d.image === m[1])) diagrams.push({ image: m[1], name: '', model: '', lines: [], years: undefined, areas: [] });
  }
  return { number, name: entities(name), brand, newer, older, family, diagrams };
}

/** Words of a body or a drive that may follow a model's name without making it another model. */
const GENERIC = /^(hybrid|sedan|hatchback|hatch|wagon|coupe|van|bus|pickup|truck|ev|hev|phev|plugin|liftback|cabrio|convertible|sport|cross|4wd|2wd|awd|suv|\d+)*$/;

/** The models a diagram's heading names: «Nissan Nv350 Caravan/Urvan E26» → nv350caravan, urvan (the make and the frame code set aside). */
export function headingModels(heading, brand = '') {
  let words = String(heading ?? '').trim().split(/\s+/).filter(Boolean);
  const b = squash(brand);
  // The make in front (one word or two: «Land Rover»).
  for (const n of [2, 1]) {
    if (b && words.length > n && squash(words.slice(0, n).join('')) === b) {
      words = words.slice(n);
      break;
    }
  }
  // The frame code last: «NCP91», «UZJ200», «E26», «BM».
  const last = words[words.length - 1] ?? '';
  if (words.length > 1 && /^[A-Z0-9]{2,8}$/.test(last) && (/\d/.test(last) || last.length <= 3) && !/^\d{1,2}$/.test(last)) words = words.slice(0, -1);
  const out = new Set();
  for (const v of words.join(' ').split('/')) {
    const s = squash(v);
    if (!s) continue;
    out.add(s);
    // «Mazda 3» under Mazda: also «3».
    if (b && s.startsWith(b) && s.length > b.length) out.add(s.slice(b.length));
  }
  return [...out];
}

/**
 * A diagram is of this car: its heading names the car's model, and the car's year is within the model's years (a year
 * either side allowed: a model year begins before its calendar year). No year known — not said (a model's generations
 * have different parts).
 */
export function diagramFits(diagram, car, brand = '', now = new Date()) {
  const model = squash(car?.model);
  const year = Number(car?.year) || 0;
  if (!model || !year || !diagram?.years) return false;
  const make = squash(car?.make);
  const mine = [model, ...(make && model.startsWith(make) && model.length > make.length ? [model.slice(make.length)] : [])];
  const named = headingModels(diagram.model, brand).some((v) => mine.some((m) => v === m || (v.startsWith(m) && GENERIC.test(v.slice(m.length))) || (m.startsWith(v) && GENERIC.test(m.slice(v.length)))));
  if (!named) return false;
  // Years that end lately are where the catalogue's data ends, not the model (a model still made): open to today.
  const thisYear = now.getFullYear();
  const to = diagram.years.to === undefined || diagram.years.to >= thisYear - 6 ? thisYear + 1 : diagram.years.to;
  return year >= diagram.years.from - 1 && year <= to + 1;
}

/*
 * Is the catalogue's name the part that was asked for? Two names of one part are compared by what the part IS — its
 * head word: a garage says it last («RADIATOR HOSE», «FRONT BRAKE PADS»), a maker's catalogue first («Hose, Radiator,
 * Inlet», «Pad Kit, Disc Brake, Front») — and by the system it belongs to, when both name one («AIR FILTER» is not
 * «Filter Assy-Oil»). Strict on purpose: a number is taken on the catalogue's word alone only when this says yes; a
 * «no» or a «not known» only sends the search on.
 */
const FILLER = new Set(['assy', 'assembly', 'kit', 'set', 'sub', 'genuine', 'new', 'part', 'with', 'for', 'and', 'the', 'original', 'oem', 'complete', 'comp', 'full', 'left', 'right', 'lh', 'rh', 'front', 'rear', 'upper', 'lower', 'inner', 'outer', 'no', 'big', 'small', 'large', 'long', 'short', 'used', 'dup', 'pcs', 'pair', 'unit', 'kyb', 'denso', 'bosch', 'ngk', 'aisin', 'febest', 'valeo', 'mann', 'japan', 'china', 'taiwan', 'korea', 'thailand', 'aftermarket', 'copy', 'local', 'brand', 'warranty', 'months', 'month']);
/** Words meaning one thing, in a garage's words and in the catalogues'. */
const ALIAS = {
  ac: 'cooler', aircon: 'cooler', conditioner: 'cooler', conditioning: 'cooler', eng: 'engine', pads: 'pad', shock: 'absorber', strut: 'absorber', damper: 'absorber', tyre: 'tire', lamp: 'light',
  bellows: 'boot', mounting: 'mount', insulator: 'mount', bushing: 'bush', bushes: 'bush', rod: 'link', wishbone: 'arm', rotor: 'disc', disk: 'disc', pulley: 'tensioner', idler: 'tensioner', plugs: 'plug',
  element: 'filter', strainer: 'filter', cartridge: 'filter', pipe: 'hose', tube: 'hose', reservoir: 'tank', bottle: 'tank', generator: 'alternator', axle: 'shaft', driveshaft: 'shaft', catalytic: 'converter',
  silencer: 'exhaust', muffler: 'exhaust', gearbox: 'transmission', gear: 'transmission', coolant: 'water', blade: 'wiper', hub: 'bearing', cabin: 'air', pollen: 'air',
};
/** The systems a part belongs to: two names that each say one must say the same one. */
const SYSTEMS = new Set(['brake', 'engine', 'oil', 'air', 'fuel', 'water', 'door', 'wheel', 'power', 'transmission', 'clutch', 'cooler']);

/** A name's words in their order: lower case, singular, the same thing in one word, filler and figures dropped. */
export function nameWords(name) {
  const out = [];
  for (const raw of String(name ?? '').toLowerCase().replace(/&amp;/g, ' ').replace(/\ba\/c\b/g, 'ac').split(/[^a-z0-9]+/)) {
    let w = raw;
    if (!w || /^\d+$/.test(w)) continue;
    if (!ALIAS[w] && w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    w = ALIAS[w] ?? w;
    if (w.length < 3 || FILLER.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

const near = (x, y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)));

/**
 * The catalogue's name is of the part asked for: true — the same head word and no other system; false — another part;
 * undefined — nothing to compare (the catalogue's «New Genuine Part»).
 */
export function sameKind(asked, catalogName) {
  const cat = String(catalogName ?? '').trim();
  if (!cat || /^new genuine part$/i.test(cat)) return undefined;
  // What comes after «with», «for», «w/» in a garage's words is not the part itself («COMPRESSOR W/PULLEY» is a compressor).
  const a = nameWords(String(asked ?? '').split(/\s+(?:w\/o?|(?:with|without|for|incl|including)\b)|\(/i)[0]);
  const c = nameWords(cat);
  if (!a.length || !c.length) return undefined;
  const coreA = a.filter((w) => !SYSTEMS.has(w));
  const coreC = c.filter((w) => !SYSTEMS.has(w));
  // Asked by its system alone («ENGINE OIL»): any word shared.
  if (!coreA.length) return a.some((x) => c.some((y) => near(x, y)));
  if (!coreC.length) return false;
  const head = coreA[coreA.length - 1];
  // A catalogue writes the head first; a name with no comma or dash may be in a garage's order («OIL FILTER»).
  const heads = /[,\-–]/.test(cat) || coreC.length === 1 ? [coreC[0]] : [coreC[0], coreC[coreC.length - 1]];
  // Glued or cut words («EVAPORATORAC», «Eng»): the head inside the catalogue's word.
  if (!heads.some((h) => near(head, h) || (head.length >= 5 && h.includes(head)))) return false;
  const sa = a.filter((w) => SYSTEMS.has(w));
  const sc = c.filter((w) => SYSTEMS.has(w));
  if (sa.length && sc.length && !sa.some((x) => sc.includes(x))) return false;
  return true;
}

/** The frame (chassis) codes a diagram is of: its heading's last word («NCP91», «UZJ200») and the codes in its lines («AD», «HC / YC»). */
export function diagramFrames(diagram) {
  const out = new Set();
  const words = String(diagram?.model ?? '').trim().split(/\s+/);
  const last = words[words.length - 1] ?? '';
  if (words.length > 1 && /^[A-Z0-9]{2,8}$/.test(last) && (/\d/.test(last) || last.length <= 3) && !/^\d{1,2}$/.test(last)) out.add(last);
  for (const l of diagram?.lines ?? []) for (const w of String(l).split(/[\s/,]+/)) if (/^[A-Z][A-Z0-9]{1,7}$/.test(w)) out.add(w);
  return [...out];
}

/**
 * A diagram is of one of these frames (as the model, or a VIN, names the car's): the same code, or one with its
 * letters of body and market after it («NCP91L» is NCP91), or a variant's code ending in it («CS8E26» is an E26).
 */
export function frameFits(diagram, frames) {
  const mine = diagramFrames(diagram).map(squash);
  return (frames ?? []).some((f) => {
    const x = squash(f);
    return x.length >= 2 && mine.some((m) => m === x || (m.length >= 4 && x.startsWith(m)) || (x.length >= 4 && m.startsWith(x)) || (x.length >= 3 && m.length > x.length && m.endsWith(x)));
  });
}
