import { liveLines } from './flow';
import { itemTitle } from './items';
import type { Lang, OrderItem } from './types';

/**
 * What a job is about, in a line (v0.30 — on the board's cards, to remember it without opening it): its work, then
 * its parts, by name — the first few and how many more; nothing on it yet — what the customer complained of.
 */
export function jobSummary(items: OrderItem[], complaint: string | undefined, lang: Lang, max = 3): string {
  const live = liveLines(items).filter((i) => i.kind !== 'discount');
  const ordered = [...live.filter((i) => i.kind !== 'part'), ...live.filter((i) => i.kind === 'part')];
  const names = [...new Set(ordered.map((i) => itemTitle(i, lang)).filter(Boolean))];
  if (names.length) return names.slice(0, max).join(' · ') + (names.length > max ? ` +${names.length - max}` : '');
  return (complaint ?? '').replace(/\s+/g, ' ').trim();
}
