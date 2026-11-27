import { formatAed } from './money';
import type { Lang } from './types';

/*
 * The owner's summary of the day (audit 27/11: the boss got a message for every event — each a confirmation for the
 * manager, 10–20 a day — and never the day as a whole). One message in the evening: the cars, the money in and out, the
 * cash as counted, the discounts and credit notes, what customers owe. Its words only — the numbers are the app's own
 * (domain/reports.ts and the debts); it goes through «Проверить и отправить», as everything does.
 */

export interface DayFacts {
  garage: string;
  /** DD/MM/YYYY. */
  date: string;
  carsIn: number;
  carsOut: number;
  onBoard: number;
  revenueFils: number;
  paid: { cash: number; card: number; transfer: number };
  expensesFils: number;
  /** The day closed: what the cash should have and what was counted. */
  cash?: { expected: number; counted: number };
  discountsFils: number;
  creditNotes: number;
  owedFils: number;
}

const W = {
  ru: { title: 'Итоги дня', cars: 'Машины', in: 'принято', out: 'выдано', board: 'на доске', revenue: 'Выручка (инвойсы)', paid: 'Оплачено', cash: 'наличные', card: 'карта', transfer: 'перевод', expenses: 'Расходы', box: 'Касса', should: 'должно', counted: 'факт', off: 'Скидки', cn: 'кредит-ноты', owed: 'Долги клиентов' },
  en: { title: 'The day', cars: 'Cars', in: 'in', out: 'out', board: 'on the board', revenue: 'Revenue (invoices)', paid: 'Paid', cash: 'cash', card: 'card', transfer: 'transfer', expenses: 'Expenses', box: 'Cash box', should: 'should be', counted: 'counted', off: 'Discounts', cn: 'credit notes', owed: 'Customers owe' },
};

export function dailyText(f: DayFacts, lang: Lang): string {
  const w = W[lang] ?? W.en;
  const m = (fils: number) => formatAed(fils, lang);
  const lines = [`📊 *${f.garage ? `${f.garage} · ` : ''}${w.title} ${f.date}*`, `🚗 ${w.cars}: ${w.in} ${f.carsIn} · ${w.out} ${f.carsOut} · ${w.board} ${f.onBoard}`, `💰 ${w.revenue}: ${m(f.revenueFils)}`];
  const paid = [f.paid.cash ? `${w.cash} ${m(f.paid.cash)}` : '', f.paid.card ? `${w.card} ${m(f.paid.card)}` : '', f.paid.transfer ? `${w.transfer} ${m(f.paid.transfer)}` : ''].filter(Boolean);
  if (paid.length) lines.push(`💵 ${w.paid}: ${paid.join(' · ')}`);
  if (f.expensesFils) lines.push(`🧾 ${w.expenses}: ${m(f.expensesFils)}`);
  if (f.cash) {
    const diff = f.cash.counted - f.cash.expected;
    lines.push(`🏦 ${w.box}: ${w.should} ${m(f.cash.expected)} · ${w.counted} ${m(f.cash.counted)}${diff ? ` (${diff > 0 ? '+' : '−'}${m(Math.abs(diff))})` : ''}`);
  }
  if (f.discountsFils || f.creditNotes) lines.push(`📉 ${w.off}: ${m(f.discountsFils)}${f.creditNotes ? ` · ${w.cn}: ${f.creditNotes}` : ''}`);
  if (f.owedFils) lines.push(`⏳ ${w.owed}: ${m(f.owedFils)}`);
  return lines.join('\n');
}
