import { db } from '../db/db';
import { dubaiDate, formatDate } from '../domain/dates';
import { dailyText, type DayFacts } from '../domain/dailySummary';
import { computeReport } from '../domain/reports';
import { waAutoOf } from '../domain/waAuto';
import { loadDebtors } from './debts';
import { getSettings } from './settings';
import { syncConfig, syncState } from './sync/config';
import { queueWa } from './waOutbox';
import { waCan } from './whatsapp';

/*
 * The owner's summary of the day (audit 27/11): one message in the evening instead of the day pieced together from the
 * events. Made from the app's own numbers (the report of the day, the board, the debts), to the boss's chat, through
 * «Проверить и отправить» (nothing leaves by itself); once a day, by the main device only (two devices would ask twice);
 * its key — the day (the server sends a key once).
 */

export async function dayFacts(day = dubaiDate()): Promise<DayFacts> {
  const [settings, orders, invoices, items, allExpenses, payments, closings, cats, incomes, debtors] = await Promise.all([
    getSettings(),
    db.orders.toArray(),
    db.invoices.toArray(),
    db.items.toArray(),
    db.expenses.toArray(),
    db.payments.toArray(),
    db.cashClosings.toArray(),
    db.expenseCategories.toArray(),
    db.incomes.toArray(),
    loadDebtors(),
  ]);
  const expenses = allExpenses.filter((e) => !e.voidedAt);
  const r = computeReport({ from: day, to: day, orders, invoices, items, expenses, payments, closings, incomes, partsCategoryId: cats.find((c) => c.code === 'parts')?.id });
  const today = invoices.filter((i) => dubaiDate(i.issuedAt) === day);
  const discounts = today.filter((i) => i.type !== 'credit_note').reduce((a, i) => a + i.lines.reduce((b, l) => b + (l.kind === 'discount' ? Math.abs(l.gross) : (l.discountFils ?? 0)), 0), 0);
  const closing = closings.filter((c) => c.date === day).pop();
  return {
    garage: settings.name,
    date: formatDate(day),
    carsIn: r.ordersReceived,
    carsOut: r.ordersDelivered,
    onBoard: orders.filter((o) => !o.archivedAt && !['closed', 'cancelled', 'booked', 'delivered'].includes(o.stage)).length,
    revenueFils: r.revenueGross,
    paid: { cash: r.payments.cash, card: r.payments.card, transfer: r.payments.transfer },
    expensesFils: r.expensesGross,
    cash: closing ? { expected: closing.expectedFils, counted: closing.actualFils } : undefined,
    discountsFils: discounts,
    creditNotes: today.filter((i) => i.type === 'credit_note').length,
    owedFils: debtors.reduce((a, d) => a + d.totalFils, 0),
  };
}

/** The summary to the boss's chat — waiting in «Проверить и отправить». False: no boss chat set (or the summary off). */
export async function sendDailySummary(day = dubaiDate()): Promise<boolean> {
  const s = waAutoOf((await getSettings()).waAuto);
  if (!s.boss.on || !s.boss.daily || !s.boss.to) return false;
  await queueWa([{ key: `boss:daily:${day}`, chat: s.boss.to.chat, parts: [{ text: dailyText(await dayFacts(day), s.boss.lang) }], title: s.boss.to.name }]);
  return true;
}

const LAST = 'mygarage.daily.at';
const isMain = () => {
  const cfg = syncConfig();
  const main = syncState().main;
  return !!cfg && !!main && main.id === cfg.deviceId;
};
/** The hour (Dubai) from which the day's summary is prepared. */
export const DAILY_HOUR = 20;

let timer: ReturnType<typeof setInterval> | undefined;
/** Once a day after 20:00 (Dubai) while the app is open on the main device: the summary prepared for a look. */
export function startDailySummary(): void {
  if (timer) return;
  const tick = () => {
    if (!waCan() || !isMain()) return;
    const now = new Date();
    const hour = Number(now.toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', hour12: false }));
    const day = dubaiDate(now.toISOString());
    if (hour < DAILY_HOUR || localStorage.getItem(LAST) === day) return;
    localStorage.setItem(LAST, day);
    void sendDailySummary(day).catch(() => localStorage.removeItem(LAST));
  };
  timer = setInterval(tick, 10 * 60_000);
  setTimeout(tick, 30_000);
}
