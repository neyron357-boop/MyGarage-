import { canonicalMake } from './carCatalog';

/*
 * Genuine part numbers as the makers write them (v0.49): a number the AI (or anyone) offers for a Toyota that is not
 * shaped like a Toyota number is not a Toyota number — a check that costs nothing and catches a guess, a truncation or
 * a number read off the wrong maker's page. Unknown maker — any letters and digits. Pure.
 */

const plain = (s: string) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

type Format = { test: RegExp; write?: (p: string) => string };

/** `#####-#####` — Toyota, Lexus, Nissan, Infiniti, Hyundai, Kia, Genesis, Suzuki (letters and digits after the hyphen). */
const tenDash: Format = { test: /^[A-Z0-9]{5}[A-Z0-9]{5}$/, write: (p) => `${p.slice(0, 5)}-${p.slice(5)}` };

const FORMATS: [makes: string[], format: Format][] = [
  [['toyota', 'lexus'], { test: /^\d{5}[A-Z0-9]{5}$/, write: tenDash.write }],
  [['nissan', 'infiniti', 'hyundai', 'genesis', 'kia', 'suzuki'], tenDash],
  [['honda', 'acura'], { test: /^\d{5}[A-Z0-9]{3}[A-Z0-9]{3,4}$/, write: (p) => `${p.slice(0, 5)}-${p.slice(5, 8)}-${p.slice(8)}` }],
  [['mitsubishi', 'fuso', 'mitsubishi fuso'], { test: /^(MR|MN|MB|MD|ME|MS|MQ)\d{6}$|^\d{4}[A-Z]\d{3}$|^[A-Z0-9]{7,9}$/ }],
  [['mazda'], { test: /^[A-Z0-9]{4,5}\d{2}[A-Z0-9]{3,4}$/, write: (p) => (p.length >= 10 ? `${p.slice(0, p.length - 5)}-${p.slice(-5, -3)}-${p.slice(-3)}` : p) }],
  [['subaru'], { test: /^\d{5}[A-Z]{2}\d{3}[A-Z]?$/ }],
  [['isuzu'], { test: /^\d{10}$|^\d{9}$/ }],
  [['ford', 'lincoln'], { test: /^[A-Z0-9]{2,4}\d{4,5}[A-Z]{1,3}$|^[A-Z]{1,2}\d{1,2}[A-Z]\d{4,5}[A-Z]{1,3}$/ }],
  [['chevrolet', 'gmc', 'cadillac', 'buick', 'hummer'], { test: /^\d{7,8}$|^\d{8}[A-Z]{0,2}$/ }],
  [['dodge', 'chrysler', 'jeep', 'ram'], { test: /^\d{8}[A-Z]{2}$|^\d{8}$|^[A-Z0-9]{5}[A-Z]{2,3}$/ }],
  [['mercedes-benz', 'mercedes'], { test: /^[AB]?\d{10}(\d{2}|[A-Z0-9]{2})?$/, write: (p) => (/^[AB]?\d{10}$/.test(p) ? p.replace(/^([AB]?\d{3})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4') : p) }],
  [['bmw', 'mini'], { test: /^\d{11}$/, write: (p) => p.replace(/^(\d{2})(\d{2})(\d)(\d{3})(\d{3})$/, '$1 $2 $3 $4 $5') }],
  [['volkswagen', 'vw', 'audi', 'porsche', 'skoda', 'seat'], { test: /^[A-Z0-9]{3}\d{3}\d{3}[A-Z]{0,2}$/, write: (p) => p.replace(/^([A-Z0-9]{3})(\d{3})(\d{3})([A-Z]{0,2})$/, '$1 $2 $3 $4').trim() }],
  [['land rover', 'range rover', 'jaguar'], { test: /^[A-Z]{2,3}\d{4,6}$|^[A-Z]\d[A-Z]\d{5,6}$/ }],
  [['volvo'], { test: /^\d{7,8}$/ }],
  [['peugeot', 'citroen'], { test: /^\d{4}[A-Z0-9]{2}$|^\d{10}$/ }],
  [['renault', 'dacia'], { test: /^\d{10}$|^\d{6}[A-Z0-9]{4}$/ }],
  [['tesla'], { test: /^\d{7}\d{2}[A-Z]$/, write: (p) => `${p.slice(0, 7)}-${p.slice(7, 9)}-${p.slice(9)}` }],
];

const plainMake = (make: string) => canonicalMake(make).toLowerCase().replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();

function formatOf(make: string): Format | undefined {
  const m = plainMake(make);
  if (!m) return undefined;
  return FORMATS.find(([makes]) => makes.some((x) => m === x || m.startsWith(`${x} `)))?.[1];
}

/**
 * Whether a number is shaped like this maker's: `true` / `false` when the maker's shape is known, `undefined` when it
 * is not (a Chinese make, no make). Anything shorter than five letters and digits is no number.
 */
export function numberPlausible(make: string, number: string): boolean | undefined {
  const p = plain(number);
  if (p.length < 5 || p.length > 20) return false;
  const f = formatOf(make);
  return f ? f.test.test(p) : undefined;
}

/** The number written the maker's way («0446533480» → «04465-33480»); as given (trimmed, upper case) when the way is not known. */
export function formatNumber(make: string, number: string): string {
  const p = plain(number);
  const f = formatOf(make);
  if (!p) return String(number ?? '').trim().toUpperCase();
  if (f && f.write && f.test.test(p)) return f.write(p);
  return String(number ?? '').trim().toUpperCase();
}

/** The same number, however written. */
export const sameNumber = (a: string, b: string): boolean => !!plain(a) && plain(a) === plain(b);
