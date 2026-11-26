import { currentDiscount, discountGross, discountPrice, discountTitles, grossOf, splitDiscount } from './discount';
import { byPosition, itemAmounts } from './items';
import type { Lang, OrderItem, QuoteOption } from './types';

/*
 * A quote's options (v0.90, the owner's note #72: «отправить смету — разные версии сметы: клиент просит цену без какой-либо
 * детали и с этой деталью, чтобы увидеть разницу, что выгоднее… копии деталей и оригиналы… не могу всё это вместе здесь
 * записать — придётся удалять оригинал и отправить копии, потом заново добавить… подготовить разные версии сметы,
 * отправлять клиенту и сохранять эти версии»). Every line stays on the job as typed (the original and the copy side by
 * side); an option is which of them it has. Each is its own quote — its lines, its total; the job's discount on its lines
 * (a percentage — of them; an amount — as given, never more than they are). The customer chose one: the job's lines become
 * its lines, the others «не подтверждена» (v0.88) — they stay to be seen, out of every total. Pure.
 */

/** A line an option can have: one of the job's lines that still counts (not a discount, not refused or taken back). */
export const optionable = (i: OrderItem): boolean => i.kind !== 'discount' && (i.approvalState === 'draft' || i.approvalState === 'pending' || i.approvalState === 'approved');

/** The option's lines, in the job's order, and the job's discount on them (as lines of their own, not stored). */
export function optionItems(items: OrderItem[], option: Pick<QuoteOption, 'itemIds' | 'id'>): OrderItem[] {
  const has = new Set(option.itemIds);
  const lines = items.filter((i) => has.has(i.id) && optionable(i)).sort(byPosition);
  const spec = currentDiscount(items);
  const base = grossOf(lines);
  if (!spec || base <= 0) return lines;
  const off = Math.min(discountGross(spec, base), base);
  const [first] = items.filter((i) => i.kind === 'discount');
  const pct = 'pctBp' in spec ? spec.pctBp : undefined;
  return [
    ...lines,
    ...splitDiscount(lines, off).map((p, k): OrderItem => ({
      ...(first ?? {}),
      id: `${option.id}:off:${k}`,
      orderId: lines[0].orderId,
      kind: 'discount',
      block: 'A',
      unit: 'pcs',
      qty: 1,
      approvalState: 'draft',
      done: false,
      createdAt: first?.createdAt ?? '',
      ...discountTitles(spec),
      ...discountPrice(p),
      discountPctBp: pct,
    })),
  ];
}

/** What the customer pays for the option (with VAT). */
export const optionGross = (items: OrderItem[], option: Pick<QuoteOption, 'itemIds' | 'id'>): number => optionItems(items, option).reduce((s, i) => s + itemAmounts(i).gross, 0);

/** Its name as said: typed, or «Вариант 2» / «Option 2». */
export const optionName = (o: Pick<QuoteOption, 'name'>, n: number, lang: Lang): string => o.name.trim() || (lang === 'ru' ? `Вариант ${n}` : `Option ${n}`);

/**
 * The lines a new option starts with: the last option's (the next one is mostly the same, a line or two swapped); the first
 * — the lines that count now (the unconfirmed aside).
 */
export function freshOptionLines(items: OrderItem[], options: QuoteOption[]): string[] {
  const last = options[options.length - 1];
  if (last) return last.itemIds.filter((id) => items.some((i) => i.id === id && optionable(i)));
  return items
    .filter((i) => optionable(i) && !i.unconfirmed)
    .sort(byPosition)
    .map((i) => i.id);
}

/** The options as they stand: lines gone from the job are gone from them too. */
export function liveOptions(items: OrderItem[], options: QuoteOption[] | undefined): QuoteOption[] {
  const ok = new Set(items.filter(optionable).map((i) => i.id));
  return (options ?? []).map((o) => (o.itemIds.every((id) => ok.has(id)) ? o : { ...o, itemIds: o.itemIds.filter((id) => ok.has(id)) }));
}

/** Choosing an option: its drafts confirmed, the job's other drafts not confirmed (the sent and agreed are left as they are). */
export function chosenLines(items: OrderItem[], option: QuoteOption): { confirm: string[]; unconfirm: string[] } {
  const has = new Set(option.itemIds);
  const drafts = items.filter((i) => i.approvalState === 'draft' && i.kind !== 'discount');
  return {
    confirm: drafts.filter((i) => has.has(i.id) && i.unconfirmed).map((i) => i.id),
    unconfirm: drafts.filter((i) => !has.has(i.id) && !i.unconfirmed).map((i) => i.id),
  };
}
