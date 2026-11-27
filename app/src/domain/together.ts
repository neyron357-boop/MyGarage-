import { lineName } from './items';
import { isLabourCharge, type HistLine } from './linePrices';
import type { JobTemplate, Lang, RelatedRule } from './types';

/*
 * «Что обычно идёт вместе» (audit 27/11; docs/01 §7.2: «Замена сцепления → часто нужны: выжимной подшипник, сальник КПП…
 * потом приложение учится на твоей истории: в 4 из 6 прошлых замен ремня ГРМ меняли и помпу»). Without the AI, two
 * sources, the garage's own first:
 *  - the history: lines agreed on the same jobs — B goes with A when it was on at least `SHARE` of A's jobs (and on two
 *    of them at least), A seen on `MIN_JOBS` jobs or more;
 *  - the starter rules (`relatedRules`, seeded): A is a line of the rule's job template.
 * A labour charge («LABOR CHARGE…», the app's own line) neither brings nor is brought.
 */

export const MIN_JOBS = 3;
export const SHARE = 0.4;

export interface TogetherHint {
  title: string;
  kind: 'part' | 'labor';
  /** From the history: on `jobs` of the `of` jobs that had the line; from a starter rule — none. */
  jobs?: number;
  of?: number;
}

const titleOf = (lang: Lang, ru?: string, en?: string) => lineName((lang === 'ru' ? ru || en : en || ru)?.trim() ?? '');
const counts = (s: HistLine) => s.approvalState === 'approved' && (s.kind === 'part' || s.kind === 'labor');

/** What goes with each title, best first. */
export function buildTogether(lines: HistLine[], lang: Lang, rules: RelatedRule[] = [], templates: JobTemplate[] = []): Map<string, TogetherHint[]> {
  const kindOf = new Map<string, 'part' | 'labor'>();
  const byJob = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!counts(l)) continue;
    const title = titleOf(lang, l.titleRu, l.titleEn);
    if (!title || isLabourCharge(title)) continue;
    kindOf.set(title, l.kind as 'part' | 'labor');
    byJob.set(l.orderId, (byJob.get(l.orderId) ?? new Set()).add(title));
  }
  const seen = new Map<string, number>();
  const pairs = new Map<string, Map<string, number>>();
  for (const set of byJob.values())
    for (const a of set) {
      seen.set(a, (seen.get(a) ?? 0) + 1);
      for (const b of set) {
        if (a === b) continue;
        const m = pairs.get(a) ?? new Map<string, number>();
        m.set(b, (m.get(b) ?? 0) + 1);
        pairs.set(a, m);
      }
    }
  const out = new Map<string, TogetherHint[]>();
  for (const [a, m] of pairs) {
    const of = seen.get(a) ?? 0;
    if (of < MIN_JOBS) continue;
    const hints = [...m.entries()]
      .filter(([, n]) => n >= 2 && n / of >= SHARE)
      .sort((x, y) => y[1] - x[1])
      .map(([title, n]): TogetherHint => ({ title, kind: kindOf.get(title) ?? 'part', jobs: n, of }));
    if (hints.length) out.set(a, hints);
  }
  // The starter rules: each line of the template brings the rule's lines (after what the history says).
  for (const t of templates) {
    if (!t.active) continue;
    const brought = rules.filter((r) => r.triggerTemplateCode === t.code).map((r) => titleOf(lang, r.titleRu, r.titleEn)).filter(Boolean);
    if (!brought.length) continue;
    for (const ti of t.items) {
      const a = titleOf(lang, ti.titleRu, ti.titleEn);
      if (!a) continue;
      const have = out.get(a) ?? [];
      for (const title of brought) if (title !== a && !have.some((h) => h.title === title)) have.push({ title, kind: kindOf.get(title) ?? (/(REPAIR|ALIGNMENT|РЕМОНТ|РАЗВАЛ|УСТРАНЕНИЕ)/.test(title) ? 'labor' : 'part') });
      if (have.length) out.set(a, have);
    }
  }
  return out;
}

/**
 * The hints for what was just added: those not on the job yet (by title), at most `limit`, newest addition's first.
 */
export function hintsFor(together: Map<string, TogetherHint[]> | undefined, added: string[], onJob: string[], limit = 4): TogetherHint[] {
  if (!together) return [];
  const have = new Set(onJob.map((t) => lineName(t)));
  const out: TogetherHint[] = [];
  for (const a of [...added].reverse())
    for (const h of together.get(lineName(a)) ?? []) {
      if (have.has(h.title) || out.some((x) => x.title === h.title)) continue;
      out.push(h);
      if (out.length >= limit) return out;
    }
  return out;
}

/** A line the customer declined on an earlier visit of the car, still not done (audit 27/11). */
export interface DeclinedBefore {
  itemId: string;
  orderId: string;
  title: string;
  /** Its price then, with VAT. */
  gross: number;
  /** The day of that visit. */
  day: string;
}

/**
 * What the customer said no to on the car's earlier visits — offered on this one: the newest no per title, within a
 * year, not done or agreed on a visit after it, not on this job already. Newest first.
 */
export function declinedBefore(
  visits: { order: { id: string; day: string }; items: { id: string; kind: string; titleRu?: string; titleEn?: string; approvalState: string; done?: boolean; gross: number }[] }[],
  current: { id: string; day: string },
  onJob: string[],
  lang: Lang,
  limit = 3,
): DeclinedBefore[] {
  const yearAgo = `${Number(current.day.slice(0, 4)) - 1}${current.day.slice(4)}`;
  const earlier = visits.filter((v) => v.order.id !== current.id && v.order.day <= current.day && v.order.day >= yearAgo).sort((a, b) => b.order.day.localeCompare(a.order.day));
  const have = new Set(onJob.map((t) => lineName(t)));
  const doneAfter = new Map<string, string>();
  for (const v of earlier)
    for (const i of v.items) {
      if (i.approvalState !== 'approved' && !i.done) continue;
      const t = titleOf(lang, i.titleRu, i.titleEn);
      if (t && (doneAfter.get(t) ?? '') < v.order.day) doneAfter.set(t, v.order.day);
    }
  const out: DeclinedBefore[] = [];
  for (const v of earlier)
    for (const i of v.items) {
      if (i.kind === 'discount' || i.kind === 'fee' || i.approvalState !== 'declined') continue;
      const title = titleOf(lang, i.titleRu, i.titleEn);
      if (!title || isLabourCharge(title) || have.has(title) || out.some((x) => x.title === title)) continue;
      if ((doneAfter.get(title) ?? '') >= v.order.day) continue;
      out.push({ itemId: i.id, orderId: v.order.id, title, gross: i.gross, day: v.order.day });
      if (out.length >= limit) return out;
    }
  return out;
}
