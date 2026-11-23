import type { Phase } from './flow';
import type { Order } from './types';

/*
 * The board's few tabs (v0.70, the user: «не так уж много вкладок — достаточно пары самых важных… выбрать несколько
 * заказов и присваивать им статусы, например в ожидании, в работе — я сам, и они попадали в те вкладки… в работе,
 * ожидания, архив, все… и вкладку заявки — те заказы, где физически автомобиль не приехал, а просто удалённо спросили про
 * цены»). Each job on the board is in one of three: in work, waiting, a request — where the manager put it
 * (`Order.boardTab`), else by its step: a car booked and not here yet — a request; one waiting for the customer's
 * answer — waiting; the rest — in work. Pure.
 */

export type BoardStatus = NonNullable<Order['boardTab']>;
export const BOARD_STATUSES: BoardStatus[] = ['work', 'wait', 'request'];

/** The tab a job on the board is in. */
export function boardStatusOf(order: Pick<Order, 'boardTab'>, phase: Phase): BoardStatus {
  if (order.boardTab) return order.boardTab;
  return phase === 'booked' ? 'request' : phase === 'wait' ? 'wait' : 'work';
}

/** Each tab in a step's colours and symbol (its glow too): in work — work's, waiting — the wait's, a request — a booking's. */
export const STATUS_PHASE: Record<BoardStatus, Phase> = { work: 'work', wait: 'wait', request: 'booked' };
