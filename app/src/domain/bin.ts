import type { Order, OrderItem } from './types';

/*
 * The job's bin (v0.68, the user: «иногда удаляю позиции, потом нужно вернуть — вернуть не могу, приходится заново
 * создавать, а иногда забываю, какие цены указывал; нужна корзина в каждой карточке заказа»): the lines taken off it —
 * drafts deleted (kept on the job as they were, `Order.removedLines`) and lines the customer was told, taken off
 * (still among its lines, cancelled — the quotes sent keep them), and (v0.70, «восстановить отменённые») the lines the
 * customer refused. Each comes back as a draft: a deleted one as itself,
 * a cancelled one as a new line like it (the cancelled one stays as it was, `restoredAt` — out of the bin). Pure.
 */

/** How many deleted lines a job keeps. */
export const BIN_SIZE = 30;

export interface BinLine {
  /** The line's id (a deleted one's comes back with it). */
  id: string;
  item: OrderItem;
  /** Deleted (a draft), cancelled (it was told), or refused by the customer (v0.70). */
  how: 'deleted' | 'cancelled' | 'declined';
  /** When it was deleted; a cancelled one — when it was added. */
  at: string;
}

/** What is in the bin, the newest first: the deleted lines, then the cancelled and refused ones not brought back. */
export function binOf(order: Pick<Order, 'removedLines'>, items: OrderItem[]): BinLine[] {
  const here = new Set(items.map((i) => i.id));
  const deleted = (order.removedLines ?? []).filter((r) => !here.has(r.item.id)).map((r): BinLine => ({ id: r.item.id, item: r.item, how: 'deleted', at: r.at }));
  const cancelled = items
    .filter((i) => (i.approvalState === 'cancelled' || i.approvalState === 'declined') && i.kind !== 'discount' && !i.restoredAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((i): BinLine => ({ id: i.id, item: i, how: i.approvalState === 'declined' ? 'declined' : 'cancelled', at: i.createdAt }));
  return [...deleted, ...cancelled];
}

/** The job's deleted lines with these put in (the newest first, one each, at most `BIN_SIZE`). */
export function withRemoved(order: Pick<Order, 'removedLines'>, removed: OrderItem[], at: string): NonNullable<Order['removedLines']> {
  const ids = new Set(removed.map((i) => i.id));
  return [...removed.map((item) => ({ item, at })), ...(order.removedLines ?? []).filter((r) => !ids.has(r.item.id))].slice(0, BIN_SIZE);
}

/** The job's deleted lines without these (brought back). */
export function withoutRemoved(order: Pick<Order, 'removedLines'>, ids: string[]): Order['removedLines'] {
  const gone = new Set(ids);
  const left = (order.removedLines ?? []).filter((r) => !gone.has(r.item.id));
  return left.length ? left : undefined;
}

/**
 * A cancelled line as a new draft: what it is and its price — not what was told of it or decided (versions,
 * decisions), not done, not paid outside.
 */
export function draftLike(i: OrderItem, id: string, now: string): OrderItem {
  return {
    ...i,
    id,
    approvalState: 'draft',
    introducedInVersionId: undefined,
    lastVersionId: undefined,
    bChoice: undefined,
    bNeeded: undefined,
    done: false,
    doneAt: undefined,
    outsource: i.outsource ? { state: 'todo', supplierId: i.outsource.supplierId } : undefined,
    restoredAt: undefined,
    position: undefined,
    createdAt: now,
  };
}
