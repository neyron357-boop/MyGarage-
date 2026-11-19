import { normalizePhone, phoneDigits } from './phone';
import type { Supplier } from './types';

/*
 * Adding a supplier (v0.24): what a business card says (its numbers, its name), how one is found by a number typed the
 * way it is said ("050 123…"), and the one already in the base — the same number or the same name — so it is not
 * added twice.
 */

/** A UAE number as it is said here: "0501234567" (a landline: "042345678"). */
export function localPhone(e164: string): string {
  const d = phoneDigits(e164);
  return d.startsWith('971') ? `0${d.slice(3)}` : d;
}

/**
 * The UAE numbers in a text read off a card — E.164, mobiles first, each once. Cards print them with spaces, dashes,
 * dots or brackets, as "+971", "00971", "971" or a leading 0, and several in a row: each run of digits is walked
 * through, a number taken wherever one starts (a mobile — 5 and 8 digits; a landline — its area code and 7 digits).
 */
export function phonesInText(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\+?\d[\d\s\-.()]{7,}/g)) {
    // The groups of digits as printed: a number starts and ends between them (a long code — a TRN, a licence — is no number).
    const groups = m[0].match(/\d+/g) ?? [];
    const d = groups.join('');
    const edges = new Set<number>([0]);
    groups.reduce((at, g) => (edges.add(at + g.length), at + g.length), 0);
    for (let i = 0; i < d.length; ) {
      const head = d.startsWith('00971', i) ? 5 : d.startsWith('971', i) ? 3 : d[i] === '0' ? 1 : 0;
      const rest = head ? d.slice(i + head) : '';
      const national = [/^5\d{8}/.exec(rest)?.[0], /^[2-46-9]\d{7}/.exec(rest)?.[0]].find((n) => n && edges.has(i + head + n.length));
      if (!edges.has(i) || !national) {
        i++;
        continue;
      }
      const p = `+971${national}`;
      if (!found.includes(p)) found.push(p);
      i += head + national.length;
    }
  }
  return [...found.filter((p) => p.startsWith('+9715')), ...found.filter((p) => !p.startsWith('+9715'))];
}

/** A line read off a card, with how tall its letters are. */
export interface CardLine {
  text: string;
  height: number;
}

/**
 * The name a card shows: the line in its largest letters that is a name — mostly letters, not a number, an e-mail or a
 * web address, nor a title of a person ("Sales Manager").
 */
export function cardName(lines: CardLine[]): string | undefined {
  const ok = (t: string) => {
    const letters = (t.match(/[A-Za-z]/g) ?? []).length;
    return letters >= 3 && letters / t.replace(/\s/g, '').length >= 0.7 && !/@|www|https?:|\.(com|ae|net)\b/i.test(t) && !/\b(manager|sales|director|mobile|tel|fax|phone)\b/i.test(t);
  };
  const best = [...lines].filter((l) => ok(l.text.trim())).sort((a, b) => b.height - a.height)[0];
  return best?.text.trim().replace(/\s+/g, ' ');
}

/** What a supplier is found by: name, makes, what they sell, where, notes, the phone (also as said here: 050…). */
export function supplierHay(s: Pick<Supplier, 'name' | 'makes' | 'parts' | 'address' | 'notes' | 'phone'>, extra = ''): string {
  const phone = s.phone ? `${s.phone} ${phoneDigits(s.phone)} ${localPhone(s.phone)}` : '';
  return `${s.name} ${s.makes?.join(' ') ?? ''} ${s.parts ?? ''} ${s.address ?? ''} ${s.notes ?? ''} ${phone} ${extra}`.toLowerCase();
}

/** Does a search find this supplier: every word of it, in any of the supplier's words. */
export function supplierMatches(s: Parameters<typeof supplierHay>[0], query: string, extra = ''): boolean {
  const hay = supplierHay(s, extra);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Typed like a number: digits, with "+", spaces or dashes — not a name. */
export const looksLikePhone = (q: string) => /^\+?[\d\s\-()]{6,}$/.test(q.trim());

/** A company's own words, not its name («TRADING L.L.C», «TR. LLC», «FZE»). */
const LEGAL = new Set(['llc', 'fze', 'fzco', 'fzc', 'fz', 'est', 'establishment', 'trading', 'tr', 'trd', 'co', 'company', 'ltd', 'limited', 'general', 'gen', 'br', 'branch']);

/**
 * A seller's name as one seller (v0.50.2): letters and digits only, the company's own words left out — «AL MAROOF AUTO
 * SPARE PARTS TRADING L.L.C», «Al Maroof Auto Spare Parts Trading LLC» and «… TR. LLC» are one.
 */
export function sellerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bl\.l\.c\.?/g, ' llc ')
    .split(/[^a-z0-9؀-ۿЀ-ӿ]+/)
    .filter((w) => w && !LEGAL.has(w))
    .join('');
}

/** The supplier already in the base that this one is: the same phone, else the same name (letters and digits only). */
export function alreadyInBase<T extends Pick<Supplier, 'id' | 'name' | 'phone' | 'archivedAt'>>(list: T[], v: { id?: string; name?: string; phone?: string }): T | undefined {
  const others = list.filter((s) => s.id !== v.id && !s.archivedAt);
  const phone = v.phone?.trim() ? normalizePhone(v.phone) : null;
  if (phone) {
    const d = phoneDigits(phone);
    const byPhone = others.find((s) => s.phone && phoneDigits(normalizePhone(s.phone) ?? s.phone) === d);
    if (byPhone) return byPhone;
  }
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9؀-ۿЀ-ӿ]/g, '');
  const name = v.name ? key(v.name) : '';
  return name.length >= 3 ? others.find((s) => key(s.name) === name) : undefined;
}
