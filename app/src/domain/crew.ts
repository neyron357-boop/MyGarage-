import type { Order } from './types';

/*
 * Who does a job: the mechanics on it — one, or several (one does the engine, another the electrics, a
 * third helps). A job written before v0.17.2 has one (`mechanicId`); now the list is `mechanicIds`, and
 * `mechanicId` keeps its first for whatever reads it.
 */

export function mechanicsOf(order: Pick<Order, 'mechanicId' | 'mechanicIds'>): string[] {
  return order.mechanicIds ?? (order.mechanicId ? [order.mechanicId] : []);
}

/** A mechanic put on the job, or taken off it; the others keep the order they were put on in. */
export function toggled(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
