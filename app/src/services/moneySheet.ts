import { db } from '../db/db';
import { dubaiDate } from '../domain/dates';
import type { LedgerEntry, Purse } from '../domain/ledger';
import { buildMoneyWorkbook, readMoneyWorkbook, type MoneyPayment, type MoneyRow, type MoneySheet } from '../domain/moneySheet';
import { incomeCategoryNamed } from '../domain/incomeCategories';
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
function sheetCategory(e: LedgerEntry, cats: Map<string, ExpenseCategory>, incomeCats: Map<string, IncomeCategory>): string {
  switch (e.source) {
    case 'payment':
      return e.category === 'refund' ? 'Refund' : e.category === 'prepayment' ? 'Customer Deposit' : 'Repair Labor';
    case 'income': {
      // A debt paid is money for repairs, as a job's payment is.
      if (e.category === 'sales') return 'Sales';
      if (e.category === 'service' || e.category === 'debt') return 'Repair Labor';
      // The garage's own (v0.26: «Emil») goes out by its name — and comes back in as it.
      const c = e.category === 'other' ? undefined : incomeCats.get(e.category);
      return c ? c.nameEn || c.nameRu : 'Other';
    }
    case 'expense':
    case 'credit': {
      // A payment of a credit is the expense it pays off, on the day the money went.
      const code = cats.get(e.credit?.categoryId ?? e.category)?.code;
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
  const [book, cats, incomeCats, orders, vehicles, customers] = await Promise.all([
    loadLedger(),
    db.expenseCategories.toArray(),
    db.incomeCategories.toArray(),
    db.orders.toArray(),
    db.vehicles.toArray(),
    db.customers.toArray(),
  ]);
  const catBy = new Map(cats.map((c) => [c.id, c]));
  const incomeBy = new Map(incomeCats.map((c) => [c.code, c]));
  const orderBy = new Map(orders.map((o) => [o.id, o]));
  const carBy = new Map(vehicles.map((v) => [v.id, v]));
  const customerBy = new Map(customers.map((c) => [c.id, c]));
  const rows: MoneyRow[] = book.entries.map((e) => {
    const o = e.orderId ? orderBy.get(e.orderId) : undefined;
    const v = e.vehicleId ? carBy.get(e.vehicleId) : undefined;
    // The sheet's notes say what the money was for: the job and its car, then the note typed.
    const car = v ? [v.make, v.model, formatPlate(v.plate, 'en')].filter(Boolean).join(' ') : '';
    const debt = e.source === 'income' && e.category === 'debt';
    const c = debt && e.customerId ? customerBy.get(e.customerId) : undefined;
    // A debt paid names its customer (it has no job of its own: it may pay several).
    const about = debt ? ['Debt payment', c ? (c.type === 'company' && c.companyName ? c.companyName : c.name) : ''].filter(Boolean).join(' ') : [o ? `#${o.number}` : '', car].filter(Boolean).join(' ');
    const what = e.source === 'closing' ? 'Day closing difference' : e.source === 'credit' ? ['Credit paid', e.note].filter(Boolean).join(': ') : e.note ?? '';
    return {
      date: e.date,
      type: e.kind === 'in' ? 'Income' : 'Expense',
      amountFils: e.amountFils,
      payment: e.purse === 'cash' ? 'Cash' : e.purse === 'outside' ? 'Owner' : 'Card',
      category: sheetCategory(e, catBy, incomeBy),
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

const purseOfSheet = (p: MoneyPayment): Purse => (p === 'Card' ? 'card' : p === 'Owner' ? 'outside' : 'cash');

/** The income category of a sheet's one: the sheet's own words, else one of the garage's by its name (v0.26), else none. */
const incomeCategory = (c: string, list: IncomeCategory[]): string | undefined =>
  /^(sales|parts sales)$/i.test(c)
    ? 'sales'
    : /^(repair labor|diagnostics|customer deposit|outsourced work)$/i.test(c)
      ? 'service'
      : /^other$/i.test(c)
        ? 'other'
        : incomeCategoryNamed(list, c)?.code;
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
  const key = (date: string, out: boolean, purse: Purse, fils: number) => `${date}|${out ? 'o' : 'i'}|${purse}|${fils}`;
  const have = new Map<string, number>();
  for (const e of book.entries) {
    // A closing's difference would take the row that explains it (an expense never typed) — v0.23.1.
    if (e.source === 'closing') continue;
    const k = key(e.date, e.kind === 'out', e.purse, e.amountFils);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const rows: MoneyRow[] = [];
  let existing = 0;
  for (const r of read.rows) {
    // A day closing's difference as the app writes it out: not an operation — the book keeps its closings.
    if (r.notes?.includes('Day closing difference')) {
      existing++;
      continue;
    }
    const k = key(r.date, r.type === 'Expense', purseOfSheet(r.payment), r.amountFils);
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
  const [cats, incomeCats] = await Promise.all([db.expenseCategories.toArray(), db.incomeCategories.toArray()]);
  const byCode = new Map(cats.map((c) => [c.code, c]));
  const other = byCode.get('other') ?? cats[0];
  if (plan.opening) await setOpeningBalances(plan.sheet.cashStartFils, plan.sheet.cardStartFils);
  let n = 0;
  for (const r of plan.rows) {
    const method = r.payment === 'Card' ? 'card' : r.payment === 'Owner' ? 'outside' : 'cash';
    if (r.type === 'Income') {
      const category = incomeCategory(r.category, incomeCats);
      // A category the app has no place for stays in the note.
      const note = !category && r.category ? [r.category, r.notes].filter(Boolean).join(': ') : r.notes;
      await addIncome({ date: r.date, category: category ?? 'other', amountFils: r.amountFils, method, note });
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
