import { liveLines } from './flow';
import { byPosition, lineName } from './items';
import type { OrderItem } from './types';

/*
 * The labour charge named by the job's parts (v0.80, the owner: «чтобы Labor Charge, оплата труда, сформировалась
 * автоматически — название этого Labor Charge исходя из деталей, которые находятся в позициях»): a line of plain labour
 * words — «LABOR CHARGE», «LABOUR CHARGES», «ОПЛАТА ТРУДА» — says what it is for: «LABOR CHARGE: GEAR FILTER,
 * TRANSMISSION COOLER». It follows the parts while it is a draft (a part added, renamed, taken off); a name typed by hand
 * (`OrderItem.ownName`) stays as typed. Without AI: the parts' own names, in their order.
 */

/** Between the labour words and the parts. */
export const LABOUR_JOIN = ': ';

/** Plain labour words, nothing of what the work is (only these get the parts after them). */
const PLAIN = /^(?:(?:LABOU?R|LABOUER|LABOUT)(?: CHARGES?| COSTS?| FEES?)?|WORKMANSHIP|MAN ?HOURS?|ОПЛАТА ТРУДА|ТРУД|РАБОТА|РАБОТЫ)$/;

/** A name's labour words — what is before the parts. */
export const labourWords = (title: string): string => lineName(title.split(':')[0].trim());

/** A name of plain labour words, with or without the parts after them. */
export const plainLabour = (title: string): boolean => PLAIN.test(labourWords(title));

/** The job's parts by name, in the lines' order, each once (the language asked, else the other). */
export function partNames(items: OrderItem[], lang: 'en' | 'ru'): string[] {
  const out: string[] = [];
  const parts = liveLines(items)
    .filter((i) => i.kind === 'part')
    .sort(byPosition);
  for (const p of parts) {
    const name = lineName(((lang === 'ru' ? p.titleRu || p.titleEn : p.titleEn || p.titleRu) ?? '').trim());
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The labour charge's name with these parts: its words, then the parts («LABOR CHARGE: GEAR FILTER, OIL SEAL»). */
export const labourName = (title: string, parts: string[]): string => (parts.length ? `${labourWords(title)}${LABOUR_JOIN}${parts.join(', ')}` : labourWords(title));

/** Named by the parts: work done here, of plain labour words, a draft, not named by hand. */
export const namedByParts = (i: OrderItem): boolean => i.kind === 'labor' && !i.outsource && i.approvalState === 'draft' && !i.ownName && plainLabour(i.titleEn || i.titleRu || '');

/** What changes: each labour charge named by the parts whose name is not what the parts say now. */
export function labourRenames(items: OrderItem[]): { id: string; patch: Pick<OrderItem, 'titleEn' | 'titleRu'> }[] {
  const out: { id: string; patch: Pick<OrderItem, 'titleEn' | 'titleRu'> }[] = [];
  for (const i of items) {
    if (!namedByParts(i)) continue;
    const patch: Pick<OrderItem, 'titleEn' | 'titleRu'> = {};
    if (i.titleEn && plainLabour(i.titleEn)) {
      const next = labourName(i.titleEn, partNames(items, 'en'));
      if (next !== i.titleEn) patch.titleEn = next;
    }
    if (i.titleRu && plainLabour(i.titleRu)) {
      const next = labourName(i.titleRu, partNames(items, 'ru'));
      if (next !== i.titleRu) patch.titleRu = next;
    }
    if (patch.titleEn !== undefined || patch.titleRu !== undefined) out.push({ id: i.id, patch });
  }
  return out;
}

/**
 * A labour charge's name changed by a person: kept as typed (`ownName`) — unless it is plain labour words again, or just
 * what the parts would make of it.
 */
export function typedOwnName(i: OrderItem, next: Pick<OrderItem, 'titleEn' | 'titleRu'>, items: OrderItem[]): true | undefined {
  if (i.kind !== 'labor') return undefined;
  const en = next.titleEn ?? i.titleEn ?? '';
  const ru = next.titleRu ?? i.titleRu ?? '';
  // Not plain labour words — never named by the parts anyway; plain words alone, or the parts' own name — by the parts.
  const asParts = (t: string, lang: 'en' | 'ru') => !t || !plainLabour(t) || t === labourWords(t) || t === labourName(t, partNames(items, lang));
  return asParts(en, 'en') && asParts(ru, 'ru') ? undefined : true;
}
