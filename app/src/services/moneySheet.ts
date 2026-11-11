import { db } from '../db/db';
import { dubaiDate } from '../domain/dates';
import type { LedgerEntry } from '../domain/ledger';
import { buildMoneyWorkbook, readMoneyWorkbook, type MoneyRow, type MoneySheet } from '../domain/moneySheet';
import { formatPlate } from '../domain/plates';
import type { ExpenseCategory, IncomeCategory } from '../domain/types';
import { AppError } from './errors';
import { addIncome, loadLedger, setOpeningBalances } from './ledger';
import { addExpense, categoryMonthSpent } from './money';

/*
 * The money book in and out of the garage's own money sheet ("Money Tracker — Income & Expenses",
 * domain/moneySheet.ts). Out: every entry of the book, oldest first, with the opening cash and card.
 * In: the sheet's rows become incomes and expenses — rows the book already has (same day, in/out,
 * purse and amount) are left out, so a sheet exported from here or imported twice adds nothing.
 */

/** The sheet's category of a book entry. */
function sheetCategory(e: LedgerEntry, cats: Map<string, ExpenseCategory>): string {
  switch (e.source) {
    case 'payment':
      return e.category === 'refund' ? 'Refund' : e.category === 'prepayment' ? 'Customer Deposit' : 'Repair Labor';
    case 'income':
      return e.category === 'sales' ? 'Sales' : e.category === 'service' ? 'Repair Labor' : 'Other';
    case 'expense': {
      const code = cats.get(e.category)?.code;
      return code === 'parts' ? 'Parts Purchases' : code === 'consumables' ? 'Workshop Supplies' : code === 'tools' ? 'Tools & Equipment' : code === 'rent' ? 'Workshop Rent' : code === 'utilities' ? 'Workshop Utilities' : code === 'salaries' ? 'Staff Wages' : 'Other';
    }
    case 'movement':
      return e.category === 'parts_purchase' ? 'Parts Purchases' : e.category === 'supplier_refund' ? 'Refund' : e.category === 'salary' ? 'Staff Wages' : e.category === 'collection' ? 'Transfer' : 'Other';
    default:
      return 'Other';
  }
}

/** The whole money book as the money sheet. */
export async function moneySheetOfBook(): Promise<MoneySheet> {
  const [book, cats, orders, vehicles] = await Promise.all([loadLedger(), db.expenseCategories.toArray(), db.orders.toArray(), db.vehicles.toArray()]);
  const catBy = new Map(cats.map((c) => [c.id, c]));
  const orderBy = new Map(orders.map((o) => [o.id, o]));
  const carBy = new Map(vehicles.map((v) => [v.id, v]));
  const rows: MoneyRow[] = book.entries.map((e) => {
    const o = e.orderId ? orderBy.get(e.orderId) : undefined;
    const v = e.vehicleId ? carBy.get(e.vehicleId) : undefined;
    // The sheet's notes say what the money was for: the job and its car, then the note typed.
    const car = v ? [v.make, v.model, formatPlate(v.plate, 'en')].filter(Boolean).join(' ') : '';
    const about = [o ? `#${o.number}` : '', car].filter(Boolean).join(' ');
    const what = e.source === 'closing' ? 'Day closing difference' : e.note ?? '';
    return {
      date: e.date,
      type: e.kind === 'in' ? 'Income' : 'Expense',
      amountFils: e.amountFils,
      payment: e.purse === 'cash' ? 'Cash' : 'Card',
      category: sheetCategory(e, catBy),
      notes: [about, what].filter(Boolean).join(' — '),
    };
  });
  return { cashStartFils: book.cashStartFils, cardStartFils: book.cardStartFils, rows };
}

/** The money sheet file of the whole book (.xlsx). */
export async function exportMoneySheet(): Promise<File> {
  const bytes = buildMoneyWorkbook(await moneySheetOfBook());
  return new File([bytes.slice()], `Money Tracker — ${dubaiDate()}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ---------------- Import ---------------- */

const incomeCategory = (c: string): IncomeCategory =>
  /^(sales|parts sales)$/i.test(c) ? 'sales' : /^(repair labor|diagnostics|customer deposit|outsourced work)$/i.test(c) ? 'service' : 'other';
const expenseCode = (c: string): string =>
  /^parts purchases$/i.test(c)
    ? 'parts'
    : /^workshop supplies$/i.test(c)
      ? 'consumables'
      : /^tools & equipment$/i.test(c)
        ? 'tools'
        : /^(staff wages|salary)$/i.test(c)
          ? 'salaries'
          : /^(workshop rent|housing)$/i.test(c)
            ? 'rent'
            : /^(workshop utilities|phone & internet)$/i.test(c)
              ? 'utilities'
              : 'other';

export interface MoneyImportPlan {
  sheet: MoneySheet;
  /** Rows to add (not in the book yet). */
  rows: MoneyRow[];
  incomes: number;
  expenses: number;
  /** Rows the book already has. */
  existing: number;
  /** Rows without a date, type or amount. */
  skipped: number;
  /** The sheet's opening balances will be taken (the book has none yet). */
  opening: boolean;
}

/** What importing this workbook would do (nothing is written). */
export async function planMoneyImport(bytes: Uint8Array): Promise<MoneyImportPlan> {
  let read;
  try {
    read = await readMoneyWorkbook(bytes);
  } catch {
    throw new AppError('moneySheet.badFile');
  }
  const book = await loadLedger();
  // The book's entries by day, in/out, purse and amount: each matches one row of the sheet at most.
  const key = (date: string, out: boolean, card: boolean, fils: number) => `${date}|${out ? 'o' : 'i'}|${card ? 'k' : 'c'}|${fils}`;
  const have = new Map<string, number>();
  for (const e of book.entries) {
    const k = key(e.date, e.kind === 'out', e.purse === 'card', e.amountFils);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const rows: MoneyRow[] = [];
  let existing = 0;
  for (const r of read.rows) {
    const k = key(r.date, r.type === 'Expense', r.payment === 'Card', r.amountFils);
    const n = have.get(k) ?? 0;
    if (n > 0) {
      have.set(k, n - 1);
      existing++;
    } else rows.push(r);
  }
  const opening = !book.cashStartLocked && !book.cashStartFils && !book.cardStartFils && (read.cashStartFils > 0 || read.cardStartFils > 0);
  return {
    sheet: read,
    rows,
    incomes: rows.filter((r) => r.type === 'Income').length,
    expenses: rows.filter((r) => r.type === 'Expense').length,
    existing,
    skipped: read.skipped,
    opening,
  };
}

/** Add the plan's rows to the book (and its opening balances when the book has none). Returns how many. */
export async function importMoneyPlan(plan: MoneyImportPlan): Promise<number> {
  const cats = await db.expenseCategories.toArray();
  const byCode = new Map(cats.map((c) => [c.code, c]));
  const other = byCode.get('other') ?? cats[0];
  if (plan.opening) await setOpeningBalances(plan.sheet.cashStartFils, plan.sheet.cardStartFils);
  let n = 0;
  for (const r of plan.rows) {
    const method = r.payment === 'Card' ? 'card' : 'cash';
    if (r.type === 'Income') {
      const category = incomeCategory(r.category);
      // A category the app has no place for stays in the note.
      const note = category === 'other' && r.category && !/^other$/i.test(r.category) ? [r.category, r.notes].filter(Boolean).join(': ') : r.notes;
      await addIncome({ date: r.date, category, amountFils: r.amountFils, method, note });
    } else {
      const cat = byCode.get(expenseCode(r.category)) ?? other;
      const note = cat === other && r.category && !/^other$/i.test(r.category) ? [r.category, r.notes].filter(Boolean).join(': ') : r.notes;
      // History from the sheet: a month already over the category's limit is not asked about again.
      const over = cat.monthlyLimitFils > 0 && (await categoryMonthSpent(cat.id, r.date.slice(0, 7))) + r.amountFils > cat.monthlyLimitFils;
      await addExpense({ date: r.date, categoryId: cat.id, amountFils: r.amountFils, vatFils: 0, method, note, overLimitComment: over ? 'Money Tracker' : undefined });
    }
    n++;
  }
  return n;
}
