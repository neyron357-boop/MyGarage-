import { db } from '../db/db';
import { dubaiDate } from '../domain/dates';
import { liveLines, type Phase } from '../domain/flow';
import { itemAmounts } from '../domain/items';
import { formatPlate } from '../domain/plates';
import type { Customer, HistoryInvoice, Order, Vehicle } from '../domain/types';
import { workMonths, type OpenWork, type WorkMonth } from '../domain/workMonths';
import { customerAccount } from './account';
import { phaseOf } from './flow';
import { loadRowBundles } from './orders';

/*
 * A customer's works by month (v0.69, «Долги» → a customer → «По месяцам»; the grouping — domain/workMonths.ts): its
 * account as the statement counts it, and its jobs still in the workshop, with what each row shows — the car, the job's
 * number, a job in the workshop's step.
 */

export interface WorkMonthsView {
  customer: Customer;
  months: WorkMonth[];
  /** Each job of the customer: the job, its car, and — in the workshop — its step. */
  jobs: Map<string, { order: Order; vehicle?: Vehicle; phase?: Phase }>;
  history: Map<string, HistoryInvoice>;
  leftFils: number;
}

/** In the workshop: arrived, not gone, not cancelled (a car booked for later is not a work yet). */
const inWorkshop = (o: Order) => !['delivered', 'closed', 'cancelled', 'booked'].includes(o.stage);

export async function loadWorkMonths(customerId: string): Promise<WorkMonthsView | undefined> {
  const account = await customerAccount(customerId);
  if (!account) return undefined;
  const [orders, history] = await Promise.all([db.orders.where('customerId').equals(customerId).toArray(), db.historyInvoices.where('customerId').equals(customerId).toArray()]);
  const cars = await db.vehicles.bulkGet([...new Set(orders.map((o) => o.vehicleId))]);
  const car = new Map(cars.filter((v): v is Vehicle => !!v).map((v) => [v.id, v]));
  const open = orders.filter(inWorkshop);
  const bundles = (await loadRowBundles(open)).filter((b): b is NonNullable<typeof b> => !!b);
  const jobs = new Map(orders.map((order) => [order.id, { order, vehicle: car.get(order.vehicleId) } as { order: Order; vehicle?: Vehicle; phase?: Phase }]));
  const works: OpenWork[] = bundles.map((b) => {
    jobs.get(b.order.id)!.phase = phaseOf(b);
    const v = car.get(b.order.vehicleId);
    return {
      orderId: b.order.id,
      date: dubaiDate(b.order.arrivedAt ?? b.order.createdAt),
      totalFils: liveLines(b.items).reduce((a, i) => a + itemAmounts(i).gross, 0),
      label: v ? [[v.make, v.model].filter(Boolean).join(' '), formatPlate(v.plate, 'en')].filter(Boolean).join(' · ') : undefined,
    };
  });
  const months = workMonths(account.lines, account.payments, works, account.customer);
  return {
    customer: account.customer,
    months,
    jobs,
    history: new Map(history.map((h) => [h.id, h])),
    leftFils: months.reduce((a, m) => a + m.leftFils, 0),
  };
}
