/*
 * 1D barcodes read off a row of brightness (v0.25) — no camera API, no library: the two a car's VIN comes in.
 *   - Code 39: the VIN's own barcode (door-jamb labels, GCC plates, windscreen labels): 9 elements a character, 3 of
 *     them wide, "*" at both ends;
 *   - Code 128: the newer labels and papers: 6 elements a character, 11 modules, a checksum.
 * A barcode is exact where a reading of letters guesses: its characters are told apart by widths, not shapes — B is
 * never an 8. A row across the bars (found and levelled by services/vinReader.ts) comes in as brightness 0–255.
 */

/** Runs of dark and light along a row, by widths in samples (edges placed between samples); `dark` — the first is dark. */
export interface Runs {
  widths: number[];
  dark: boolean;
}

/**
 * A row of brightness cut into dark and light runs: each point against the darkest and lightest around it (glare and
 * shade move the middle along the row), flat stretches kept as they were; an edge is put where the brightness crosses
 * the middle between two samples — a bar two samples wide still measures true.
 */
export function runsOf(row: ArrayLike<number>, reach = 24): Runs {
  const n = row.length;
  if (n < 8) return { widths: [], dark: false };
  // The lowest and highest within `reach` of each sample (two passes of a running extreme).
  const lo = new Float32Array(n);
  const hi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let a = 255;
    let b = 0;
    const from = Math.max(0, i - reach);
    const to = Math.min(n - 1, i + reach);
    for (let k = from; k <= to; k++) {
      const v = row[k];
      if (v < a) a = v;
      if (v > b) b = v;
    }
    lo[i] = a;
    hi[i] = b;
  }
  let span = 0;
  for (let i = 0; i < n; i++) span = Math.max(span, hi[i] - lo[i]);
  const flat = Math.max(18, span * 0.22);
  const mid = new Float32Array(n);
  let last = (lo[0] + hi[0]) / 2;
  for (let i = 0; i < n; i++) {
    if (hi[i] - lo[i] >= flat) last = (lo[i] + hi[i]) / 2;
    mid[i] = last;
  }
  const widths: number[] = [];
  let dark = row[0] < mid[0];
  const first = dark;
  let from = 0;
  for (let i = 1; i < n; i++) {
    const d = row[i] < mid[i];
    if (d === dark) continue;
    const a = row[i - 1] - mid[i - 1];
    const b = row[i] - mid[i];
    const edge = i - 1 + (a === b ? 0.5 : a / (a - b));
    widths.push(edge - from);
    from = edge;
    dark = d;
  }
  widths.push(n - from);
  return { widths, dark: first };
}

/* ---------------- Code 39 ---------------- */

const C39 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*';
// Each character as 15 modules, a wide element three of them (the table jsbarcode prints from; its "*" without the gap it carries).
const C39_BITS = [
  20957, 29783, 23639, 30485, 20951, 29813, 23669, 20855, 29789, 23645, 29975, 23831, 30533, 22295, 30149, 24005, 21623, 29981, 23837, 22301, 30023, 23879,
  30545, 22343, 30161, 24017, 21959, 30065, 23921, 22385, 29015, 18263, 29141, 17879, 29045, 18293, 17783, 29021, 18269, 17477, 17489, 17681, 20753, 17885,
];
/** Which of a character's 9 elements are wide ("nnnwwnwnn") → the character. */
const C39_BY_PATTERN = new Map<string, string>(
  C39_BITS.map((bits, i) => {
    const s = bits.toString(2);
    let key = '';
    for (let k = 0; k < s.length; ) {
      let e = k;
      while (e < s.length && s[e] === s[k]) e++;
      key += e - k >= 2 ? 'w' : 'n';
      k = e;
    }
    return [key, C39[i]];
  }),
);

/**
 * The Code 39 character whose 9 elements start at `i` (a bar). Bars and spaces are judged apart — ink spreads, bars
 * print fatter than the gaps: two of the five bars are wide and one of the four spaces, or (for "$ / + %") none of the
 * bars and three of the spaces.
 */
function c39Char(w: number[], i: number): { ch: string; width: number } | undefined {
  if (i + 8 >= w.length) return undefined;
  const bars = [w[i], w[i + 2], w[i + 4], w[i + 6], w[i + 8]];
  const spaces = [w[i + 1], w[i + 3], w[i + 5], w[i + 7]];
  const sb = [...bars].sort((a, b) => b - a);
  const ss = [...spaces].sort((a, b) => b - a);
  const RATIO = 1.45;
  let wideBars = 0;
  let wideSpaces = 0;
  if (sb[1] >= sb[2] * RATIO && sb[0] <= sb[1] * 1.8) {
    wideBars = 2;
    wideSpaces = 1;
    if (ss[0] < ss[1] * RATIO) return undefined;
  } else if (sb[0] < sb[4] * RATIO * 1.2) {
    wideSpaces = 3;
    if (ss[2] < ss[3] * RATIO) return undefined;
  } else return undefined;
  const barCut = wideBars ? (sb[1] + sb[2]) / 2 : Infinity;
  const spaceCut = (ss[wideSpaces - 1] + ss[wideSpaces]) / 2;
  let key = '';
  let width = 0;
  for (let k = 0; k < 9; k++) {
    const v = w[i + k];
    width += v;
    key += (k % 2 === 0 ? v > barCut : v > spaceCut) ? 'w' : 'n';
  }
  const ch = C39_BY_PATTERN.get(key);
  return ch ? { ch, width } : undefined;
}

/** Every Code 39 message in a run of elements (bars at the even places from `start`): between two "*". */
function code39In(w: number[], start: number): string[] {
  const out: string[] = [];
  for (let i = start; i + 8 < w.length; i += 2) {
    const first = c39Char(w, i);
    if (first?.ch !== '*') continue;
    let text = '';
    let at = i + 10;
    let width = first.width;
    for (;;) {
      const c = c39Char(w, at);
      // The characters of one barcode are one width (a shot at an angle narrows them little by little, not at once).
      if (!c || c.width > width * 1.35 || c.width < width * 0.74) break;
      // The gap between two characters is a narrow one.
      if (w[at - 1] > c.width * 0.3) break;
      if (c.ch === '*') {
        if (text.length >= 1) out.push(text);
        break;
      }
      text += c.ch;
      width = c.width;
      at += 10;
    }
  }
  return out;
}

/* ---------------- Code 128 ---------------- */

// The 107 symbols as the widths of their elements in modules (bar, space, bar…): 103 data, three starts, the stop.
const C128 = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 ' +
  '213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 ' +
  '112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 ' +
  '111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 ' +
  '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 ' +
  '211232 2331112'
)
  .split(' ')
  .map((s) => [...s].map(Number));

/** The Code 128 symbol whose 6 elements start at `i` (a bar): the nearest pattern, each element within 0.7 of a module. */
function c128Symbol(w: number[], i: number, elements = 6): number {
  if (i + elements - 1 >= w.length) return -1;
  let total = 0;
  for (let k = 0; k < elements; k++) total += w[i + k];
  const unit = total / (elements === 7 ? 13 : 11);
  let best = -1;
  let least = 0.28 * elements;
  for (let c = 0; c < C128.length; c++) {
    const p = C128[c];
    if (p.length !== elements) continue;
    let off = 0;
    let ok = true;
    for (let k = 0; k < elements && ok; k++) {
      const d = Math.abs(w[i + k] / unit - p[k]);
      if (d > 0.7) ok = false;
      off += d;
    }
    if (ok && off < least) (least = off), (best = c);
  }
  return best;
}

/** Every Code 128 message in a run of elements (bars at the even places from `start`): a start, symbols, a checksum that adds up, the stop. */
function code128In(w: number[], start: number): string[] {
  const out: string[] = [];
  for (let i = start; i + 12 < w.length; i += 2) {
    const first = c128Symbol(w, i);
    if (first < 103 || first > 105) continue;
    const codes: number[] = [];
    let at = i + 6;
    let stopped = false;
    for (; at + 5 < w.length; at += 6) {
      if (c128Symbol(w, at, 7) === 106) {
        stopped = true;
        break;
      }
      const c = c128Symbol(w, at);
      if (c < 0 || c > 102) break;
      codes.push(c);
    }
    if (!stopped || codes.length < 2) continue;
    const check = codes.pop()!;
    let sum = first;
    codes.forEach((c, k) => (sum += c * (k + 1)));
    if (sum % 103 !== check) continue;
    let set = first === 103 ? 'A' : first === 104 ? 'B' : 'C';
    let shift = '';
    let text = '';
    for (const c of codes) {
      const now = shift || set;
      shift = '';
      if (now === 'C') {
        if (c < 100) text += String(c).padStart(2, '0');
        else if (c === 100) set = 'B';
        else if (c === 101) set = 'A';
        continue;
      }
      if (c === 98) shift = now === 'A' ? 'B' : 'A';
      else if (c === 99) set = 'C';
      else if (c === 100) set = now === 'B' ? set : 'B';
      else if (c === 101) set = now === 'A' ? set : 'A';
      else if (c < 96) text += now === 'B' || c < 64 ? String.fromCharCode(c + 32) : String.fromCharCode(c - 64);
    }
    if (text.trim()) out.push(text);
  }
  return out;
}

/**
 * Every barcode message a row of brightness holds — read left to right and right to left (a label shot upside down),
 * dark bars on light and light bars on dark (an etched plate) — each once.
 */
export function readBarcodeRow(row: ArrayLike<number>): string[] {
  const out = new Set<string>();
  const { widths, dark } = runsOf(row);
  if (widths.length < 20) return [];
  const back = [...widths].reverse();
  const backDark = widths.length % 2 === 1 ? dark : !dark;
  for (const [w, firstDark] of [
    [widths, dark],
    [back, backDark],
  ] as const) {
    // Bars are the dark runs; then, for light bars on a dark ground, the light ones.
    for (const bars of [firstDark ? 0 : 1, firstDark ? 1 : 0]) {
      for (const t of code39In(w, bars)) out.add(t);
      for (const t of code128In(w, bars)) out.add(t);
    }
  }
  return [...out];
}

/** The module pattern of a Code 39 message ("1" — dark), a wide element `ratio` modules — to draw one (tests, a picture to try the reader on). */
export function code39Modules(text: string, ratio = 3): string {
  let out = '';
  for (const ch of `*${text}*`) {
    const i = C39.indexOf(ch);
    if (i < 0) throw new Error(`not a Code 39 character: ${ch}`);
    const s = C39_BITS[i].toString(2);
    for (let k = 0; k < s.length; ) {
      let e = k;
      while (e < s.length && s[e] === s[k]) e++;
      out += s[k].repeat(e - k >= 2 ? ratio : 1);
      k = e;
    }
    out += '0';
  }
  return out;
}

/** The module pattern of a Code 128 message in set B ("1" — dark), with its checksum and stop. */
export function code128Modules(text: string): string {
  const codes = [...text].map((c) => c.charCodeAt(0) - 32);
  if (codes.some((c) => c < 0 || c > 95)) throw new Error('not a Code 128 B text');
  let sum = 104;
  codes.forEach((c, k) => (sum += c * (k + 1)));
  let out = '';
  for (const c of [104, ...codes, sum % 103, 106]) C128[c].forEach((n, k) => (out += (k % 2 === 0 ? '1' : '0').repeat(n)));
  return out;
}

/**
 * The VIN a barcode message is: the 17 characters themselves, or behind the "I" some makers put before it (the
 * barcode's data identifier) — nothing else. A barcode does not mistake letters: one with an I, O or Q in it is not a VIN.
 */
export function vinOfBarcode(text: string): string | undefined {
  const t = text.trim().toUpperCase().replace(/\s+/g, '');
  const v = t.length === 18 && t[0] === 'I' ? t.slice(1) : t;
  return /^[A-HJ-NPR-Z0-9]{13}[0-9]{4}$/.test(v) ? v : undefined;
}

/* ---------------- Code 39 by fitting (a washed-out or coarse barcode) ---------------- */

/** Which of each Code 39 character's 9 elements are wide. */
const C39_WIDE: [string, boolean[]][] = [...C39_BY_PATTERN.entries()].map(([key, ch]) => [ch, [...key].map((c) => c === 'w')]);

/**
 * How dark each point of a row is, against the light around it (the running lightest within `reach`): a bar is a
 * rise, the ground is 0 — glare and shade along the row taken out.
 */
function darkness(row: ArrayLike<number>, reach: number): Float32Array {
  const n = row.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let hi = 0;
    const to = Math.min(n - 1, i + reach);
    for (let k = Math.max(0, i - reach); k <= to; k++) if (row[k] > hi) hi = row[k];
    out[i] = hi - row[i];
  }
  return out;
}

/** How well a character's bars (`wide` — its 9 elements; a module `N` samples, a wide one `R` modules) lie on the dark of the row from `S`. */
function c39Match(D: Float32Array, S: number, N: number, R: number, wide: boolean[]): number {
  // The ends of its elements, in samples from S.
  const edge = [0];
  for (let k = 0; k < 9; k++) edge.push(edge[k] + (wide[k] ? R : 1) * N);
  const len = edge[9] + N;
  const from = Math.ceil(S);
  const to = Math.min(D.length - 1, Math.floor(S + len));
  if (from < 0 || to - from < 8) return -1;
  // How much of [a, b] (samples from S) is bar.
  const bars = (a: number, b: number) => {
    let sum = 0;
    for (let k = 0; k < 9; k += 2) {
      const lo = Math.max(a, edge[k]);
      const hi = Math.min(b, edge[k + 1]);
      if (hi > lo) sum += hi - lo;
    }
    return sum;
  };
  // A sample sees about a module's width around it (the lens, the sensor).
  const half = Math.max(0.5, N * 0.5);
  let st = 0;
  let sd = 0;
  let stt = 0;
  let sdd = 0;
  let std = 0;
  let cnt = 0;
  for (let x = from; x <= to; x++) {
    const u = x - S;
    const t = bars(u - half, u + half) / (2 * half);
    const d = D[x];
    st += t;
    sd += d;
    stt += t * t;
    sdd += d * d;
    std += t * d;
    cnt++;
  }
  const vt = stt - (st * st) / cnt;
  const vd = sdd - (sd * sd) / cnt;
  if (vt <= 0 || vd <= 0) return -1;
  return (std - (st * sd) / cnt) / Math.sqrt(vt * vd);
}

/**
 * Code 39 read by fitting, for a barcode the widths no longer tell (v0.25): an etched plate in glare has its narrow
 * bars washed out — only the wide ones stand, each thinned; a small photo gives a module a pixel and a half. What still
 * holds is where things are: every character is as wide as every other and has two wide bars, "*" has them side by
 * side. So: two dark marks side by side at both ends are the two "*"; the marks between them, two a character, give
 * the module and the wide one's width; then each character is the one of the 43 whose bars lie best on the dark of the
 * row (the faint dips of its narrow bars tell where its wide space is). Nothing is returned unless it starts and ends
 * with "*" and every character fits well and clearly better than any other.
 */
export function fitCode39Row(row: ArrayLike<number>): string[] {
  const out = new Set<string>();
  for (const flip of [false, true]) {
    const r = flip ? Array.from(row).reverse() : row;
    const { widths, dark } = runsOf(r);
    // The dark marks: where each stands (its middle) and how wide it is.
    const marks: { c: number; w: number }[] = [];
    let x = 0;
    widths.forEach((w, k) => {
      if ((k % 2 === 0) === dark) marks.push({ c: x + w / 2, w });
      x += w;
    });
    if (marks.length < 10) continue;
    const D = darkness(r, 60);
    const tried = new Set<string>();
    for (let i = 0; i + 3 < marks.length && i < 14; i++) {
      const d0 = marks[i + 1].c - marks[i].c;
      for (let j = marks.length - 2; j >= i + 8; j--) {
        if ((j - i) % 2) continue;
        const d1 = marks[j + 1].c - marks[j].c;
        if (Math.abs(d1 - d0) > 0.18 * Math.max(d0, d1)) continue;
        const chars = (j - i) / 2 + 1;
        const d = (d0 + d1) / 2;
        const Wc = (marks[j].c - marks[i].c) / (chars - 1);
        // A character is (7 + 3R) modules, the two wide bars of "*" stand (R + 1) modules apart.
        const N = (Wc - 3 * d) / 4;
        const R = d / N - 1;
        if (!(N >= 0.8) || R < 1.7 || R > 3.6) continue;
        const key = `${i} ${j}`;
        if (tried.has(key)) continue;
        tried.add(key);
        // "*": narrow bar, wide space, narrow bar, narrow space, then its first wide bar.
        let S = marks[i].c - (3 + 1.5 * R) * N;
        let n = N;
        let text = '';
        let ok = true;
        for (let k = 0; k < chars && ok; k++) {
          let best = { ch: '', score: -1, S: S, n };
          let second = -1;
          for (const scale of [0.975, 1, 1.025]) {
            for (let shift = -0.6; shift <= 0.61; shift += 0.2) {
              for (const [ch, wide] of C39_WIDE) {
                const score = c39Match(D, S + shift * n, n * scale, R, wide);
                if (score > best.score) {
                  if (ch !== best.ch) second = best.score;
                  best = { ch, score, S: S + shift * n, n: n * scale };
                } else if (ch !== best.ch && score > second) second = score;
              }
            }
          }
          if (best.score < 0.6 || best.score - second < 0.015) ok = false;
          text += best.ch;
          n = best.n;
          S = best.S + (7 + 3 * R) * n;
        }
        if (ok && text.length >= 3 && text[0] === '*' && text[text.length - 1] === '*' && !text.slice(1, -1).includes('*')) out.add(text.slice(1, -1));
      }
    }
  }
  return [...out];
}
