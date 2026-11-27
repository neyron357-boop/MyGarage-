import type { Emirate, Plate } from './types';

/**
 * The garage's habits with plates (v0.99, audit П8–П10): the emirate most of its cars come from — the form's default —
 * and, per emirate, its codes from the most frequent. The last emirate typed was the default before: one Sharjah car
 * and the next Dubai car went in as Sharjah, unseen.
 */
export interface PlateHabits {
  emirate: Emirate;
  codes: Partial<Record<Emirate, string[]>>;
}

export function plateHabitsOf(plates: Pick<Plate, 'emirate' | 'code'>[], limit = 6): PlateHabits {
  const byEmirate = new Map<Emirate, number>();
  const codes = new Map<Emirate, Map<string, number>>();
  for (const p of plates) {
    if (!p.emirate) continue;
    byEmirate.set(p.emirate, (byEmirate.get(p.emirate) ?? 0) + 1);
    const code = (p.code ?? '').trim().toUpperCase();
    if (!code) continue;
    const m = codes.get(p.emirate) ?? new Map<string, number>();
    m.set(code, (m.get(code) ?? 0) + 1);
    codes.set(p.emirate, m);
  }
  // Dubai when nothing says otherwise (and on a tie with it).
  let emirate: Emirate = 'DXB';
  for (const [e, n] of byEmirate) if (n > (byEmirate.get(emirate) ?? 0)) emirate = e;
  const out: Partial<Record<Emirate, string[]>> = {};
  for (const [e, m] of codes)
    out[e] = [...m]
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([c]) => c);
  return { emirate, codes: out };
}

/** The codes of these emirates are numbers (Abu Dhabi 1–21 and 50, Sharjah 1–4): the number pad for them. */
export const NUMERIC_CODES: Emirate[] = ['AUH', 'SHJ'];
