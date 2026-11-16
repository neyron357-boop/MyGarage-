import type { Emirate } from './types';

/*
 * A UAE number plate as a reading of its photo gives it (v0.28 — «＋» → «Фото номера»): the emirate's word in English
 * (Arabic is not read), the code — letters in Dubai and most northern emirates (A, B, AA…), a number in Abu Dhabi and
 * Sharjah (1, 2, 50…) — and the number, one to five digits. A reading is imperfect: a zero comes out an O, a one an I,
 * an eight a B; the code and the number run together ("A12345"); the plate's words (DUBAI, PRIVATE) and stray marks sit
 * on the same line. Each reading of a line gives its guesses; several readings (cuts of the photo, ways of reading)
 * vote, and a plate is sure only when they agree.
 */

export interface PlateGuess {
  emirate?: Emirate;
  /** Letters (A, AA) or digits (1, 50); '' — none read. */
  code: string;
  /** 1–5 digits. */
  number: string;
  /** How much it looks like a plate (longer numbers with a code read clean score higher). */
  score: number;
  /** The code was guessed out of a run of digits (no gap read before the number): it backs no agreement. */
  split?: boolean;
}

/** The emirates' words on their plates, as an English reading spells them (and its usual slips: an I read as 1 or L). */
const EMIRATE_WORDS: [RegExp, Emirate][] = [
  [/\bDUBA[I1L|]\b|\bDXB\b/, 'DXB'],
  [/\bSHAR[J]?AH?\b|\bSHARJA\b|\bSHJ\b/, 'SHJ'],
  [/\bABU ?DHAB[I1L]\b|\bAUH\b/, 'AUH'],
  [/\bAJMAN\b|\bAJM\b/, 'AJM'],
  [/\bRAS ?AL ?KHA[I1L]MAH?\b|\bRAK\b/, 'RAK'],
  [/\bUMM ?AL ?QU?WA[I1L]N\b|\bUAQ\b/, 'UAQ'],
  [/\bFUJA[I1L]RAH?\b|\bFUJ\b/, 'FUJ'],
];

/** Other words printed on plates (and around them) — not the plate's code. */
const NOISE = /\b(?:U\.?A\.?E|PRIVATE|TAXI|TRANSPORT|PUBLIC|EXPORT|CLASSIC|TRADE|TEMPORARY|POLICE|DIPLOMAT)\b/g;

/** The emirate a reading names, if any. */
export function emirateIn(text: string): Emirate | undefined {
  const up = ` ${text.toUpperCase().replace(/[^A-Z0-9|]+/g, ' ')} `;
  return EMIRATE_WORDS.find(([re]) => re.test(up))?.[1];
}

const NAMES: [string, Emirate][] = [
  ['DUBAI', 'DXB'],
  ['SHARJAH', 'SHJ'],
  ['ABUDHABI', 'AUH'],
  ['AJMAN', 'AJM'],
  ['RASALKHAIMAH', 'RAK'],
  ['UMMALQUWAIN', 'UAQ'],
  ['FUJAIRAH', 'FUJ'],
];

/** How many letters apart two words are (insert, drop, change). */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return d[b.length];
}

/**
 * The emirate a plate's small word names (v0.32), a slip of a letter allowed (two in a long name): the word is in the
 * plate's own lettering — Dubai's new plates read "DUBRI", "OUBAI". Read alone, as the word it is.
 */
export function emirateLike(text: string): Emirate | undefined {
  const exact = emirateIn(text);
  if (exact) return exact;
  const words = text.toUpperCase().replace(/[^A-Z]+/g, ' ').trim().split(' ').filter(Boolean);
  for (const w of [...words, words.join('')]) {
    if (w.length < 4) continue;
    for (const [name, e] of NAMES) {
      const slips = name.length <= 5 ? 1 : 2;
      if (Math.abs(w.length - name.length) <= slips && editDistance(w, name) <= slips) return e;
    }
  }
  return undefined;
}

/** Letters a reading gives for digits (in a run that is mostly digits). */
const AS_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', J: '1', S: '5', B: '8', Z: '2', G: '6' };

/** A word that is a number, its look-alike letters taken for digits — or undefined (mostly letters, or none of it a digit). */
function digitsOf(w: string): string | undefined {
  let real = 0;
  let out = '';
  for (const ch of w) {
    if (ch >= '0' && ch <= '9') {
      real++;
      out += ch;
    } else if (AS_DIGIT[ch]) out += AS_DIGIT[ch];
    else return undefined;
  }
  return real > 0 && real * 2 >= w.length ? out : undefined;
}

const isCode = (w: string) => /^[A-Z]{1,2}$/.test(w);

const numberScore = (n: string) => [0, 0.5, 1, 2, 2.5, 3][n.length] ?? 0;

/** The plates a line of reading may be: the number with the code before it (or after it, as older plates have it). */
export function platesInLine(text: string): PlateGuess[] {
  const up = text.toUpperCase();
  const emirate = emirateIn(up);
  let rest = ` ${up.replace(/[^A-Z0-9|]+/g, ' ')} `;
  for (const [re] of EMIRATE_WORDS) rest = rest.replace(new RegExp(re.source, 'g'), ' ');
  rest = rest.replace(NOISE, ' ').replace(/\|/g, ' ');
  const words = rest.trim().split(/\s+/).filter(Boolean);
  // A code glued to its number ("A12345", "B12345" — not 812345: no number has six digits) is two words.
  const tokens: string[] = [];
  for (const w of words) {
    const m = /^([A-Z]{1,2})([0-9][0-9A-Z]*)$/.exec(w);
    const tail = m && digitsOf(m[2]);
    const whole = digitsOf(w);
    if (m && tail && tail.length <= 5 && (!whole || whole.length > 5)) tokens.push(m[1], m[2]);
    else tokens.push(w);
  }
  const out: PlateGuess[] = [];
  const add = (code: string, number: string, bonus: number, split = false) => {
    if (!number || number.length > 5 || /^0+$/.test(number)) return;
    out.push({ emirate, code, number, score: numberScore(number) + (code ? 2 : 0) + bonus + (emirate ? 1 : 0), ...(split ? { split } : {}) });
  };
  tokens.forEach((t, i) => {
    let n = digitsOf(t);
    if (!n) return;
    const clean = /^\d+$/.test(t) ? 0.5 : 0;
    let code = '';
    // Six or seven digits in one: a number code run into the number (Abu Dhabi "1 12345" read without its gap).
    if (n.length > 5 && n.length <= 7) {
      code = n.slice(0, n.length - 5);
      n = n.slice(-5);
      return add(code, n, clean - 1.5, true);
    }
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (prev && isCode(prev)) add(prev, n, clean);
    else if (prev && digitsOf(prev) && digitsOf(prev)!.length <= 2 && /^\d+$/.test(prev)) add(prev, n, clean);
    else if (next && isCode(next) && !digitsOf(next)) add(next, n, clean - 0.5);
    else add('', n, clean);
  });
  return out.sort((a, b) => b.score - a.score);
}

export interface PlateVote {
  /** The guesses of one reading (one cut of the photo, one way of reading it). */
  guesses: PlateGuess[];
  /** How sure the reading itself was (0–100). */
  confidence?: number;
  /** The emirate the reading named (its word may stand on a line of its own, above the number). */
  emirate?: Emirate;
}

export interface PlatePick {
  emirate?: Emirate;
  code: string;
  number: string;
  /** Readings that gave this number. */
  agree: number;
  /** Readings that gave this code with it. */
  codeAgree: number;
  /** Agreed on by two readings or more, or read clean and surely once with its code. */
  sure: boolean;
}

/**
 * The plate the readings agree on: the number most of them give (each reading counts once, its best guess for that
 * number), then the code most of those give — a reading that missed the code still backs the number. The emirate:
 * the one named most.
 */
export function pickPlate(votes: PlateVote[]): PlatePick | undefined {
  type Tally = { score: number; agree: number; codes: Map<string, { weight: number; count: number }>; best: number };
  const byNumber = new Map<string, Tally>();
  const emirates = new Map<Emirate, number>();
  for (const v of votes) {
    if (v.emirate) emirates.set(v.emirate, (emirates.get(v.emirate) ?? 0) + 1);
    const seen = new Set<string>();
    for (const g of v.guesses) {
      if (g.emirate) emirates.set(g.emirate, (emirates.get(g.emirate) ?? 0) + 1);
      if (seen.has(g.number)) continue;
      seen.add(g.number);
      const e: Tally = byNumber.get(g.number) ?? { score: 0, agree: 0, codes: new Map(), best: 0 };
      const weight = g.score * (0.5 + (v.confidence ?? 50) / 100);
      e.score += weight;
      e.agree++;
      e.best = Math.max(e.best, g.score + (v.confidence ?? 50) / 50);
      // A code weighs what its guess weighs: one read with the number, clean, outweighs one guessed out of a run of digits
      // or read apart from it (a reading's own confidence says little of one character).
      if (g.code) {
        const c = e.codes.get(g.code) ?? { weight: 0, count: 0 };
        e.codes.set(g.code, { weight: c.weight + g.score, count: c.count + (g.split ? 0 : 1) });
      }
      byNumber.set(g.number, e);
    }
  }
  let number = '';
  let top: Tally | undefined;
  for (const [n, e] of byNumber) if (!top || e.score > top.score || (e.score === top.score && n.length > number.length)) (top = e), (number = n);
  if (!top) return undefined;
  let code = '';
  let codeVotes = 0;
  let codeAgree = 0;
  for (const [c, k] of top.codes) if (k.weight > codeVotes) (code = c), (codeVotes = k.weight), (codeAgree = k.count);
  let emirate: Emirate | undefined;
  let named = 0;
  for (const [e, k] of emirates) if (k > named) (emirate = e), (named = k);
  const sure = number.length >= 2 && (top.agree >= 2 || (!!code && top.best >= 6.5));
  return { emirate, code, number, agree: top.agree, codeAgree, sure };
}
