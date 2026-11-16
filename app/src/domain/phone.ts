/**
 * Normalize a phone number to E.164. Local UAE formats are assumed by default:
 * "050 123 4567" -> "+971501234567", "501234567" -> "+971501234567", "00971..." -> "+971...".
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let s = trimmed.replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    if (s.startsWith('971')) s = '+' + s;
    else if (s.startsWith('0')) {
      // Local: a mobile "05X XXX XXXX" or a landline "04 555 1111" (Dubai), "06…" (Sharjah). Anything else with a 0
      // ("04 222 3333/4", one with an extension) is not a number to guess at: kept as typed by whoever asked.
      if (/^05\d{8}$/.test(s) || /^0[2-46-9]\d{7}$/.test(s)) s = '+971' + s.slice(1);
      else return null;
    } else if (s.length === 9 && s.startsWith('5')) s = '+971' + s;
    // UAE shared-cost and toll-free numbers (600…, 800…) are dialled as they are, not abroad.
    else if (/^(600|800)/.test(s)) return null;
    else s = '+' + s;
  }
  // "+971 (0)50 123 4567", as cards print it: the trunk 0 is not dialled after the country code.
  if (s.startsWith('+9710')) s = '+971' + s.slice(5);
  const digits = s.slice(1);
  if (!/^\d{8,15}$/.test(digits)) return null;
  return '+' + digits;
}

/** Digits only, for wa.me links. */
export function phoneDigits(e164: string): string {
  return e164.replace(/\D/g, '');
}

/** "+971 50 123 4567" for UAE numbers, otherwise unchanged. */
export function formatPhone(e164: string): string {
  const m = /^\+971(\d{2})(\d{3})(\d{4})$/.exec(e164);
  if (m) return `+971 ${m[1]} ${m[2]} ${m[3]}`;
  // A landline: "+971 4 333 4455".
  const l = /^\+971(\d)(\d{3})(\d{4})$/.exec(e164);
  if (l) return `+971 ${l[1]} ${l[2]} ${l[3]}`;
  return e164;
}
