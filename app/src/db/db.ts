import Dexie, { type Table } from 'dexie';
import type {
  Addendum,
  CashClosing,
  CashMovement,
  Claim,
  Counter,
  CreditPayment,
  Customer,
  DamageMark,
  Debt,
  Employee,
  EstimateVersion,
  Expense,
  ExpenseCategory,
  Incident,
  Income,
  IncomeCategory,
  Inspection,
  Invoice,
  ItemDecision,
  JobNote,
  JobTemplate,
  Media,
  MediaBlob,
  MessageLog,
  Order,
  OrderEvent,
  OrderItem,
  Ownership,
  Payment,
  RelatedRule,
  SalaryPayment,
  Settings,
  StoredBook,
  Supplier,
  SupplierReturn,
  Vehicle,
} from '../domain/types';
import { installSyncHooks, isRemote, STAMP } from './syncHooks';

/** Thrown when code tries to change a record that must stay as it was signed/issued. */
export class ImmutableError extends Error {
  constructor(table: string, fields: string[]) {
    super(`Immutable record in "${table}": ${fields.join(', ')}`);
    this.name = 'ImmutableError';
  }
}

export class GarageDB extends Dexie {
  settings!: Table<Settings, string>;
  customers!: Table<Customer, string>;
  vehicles!: Table<Vehicle, string>;
  ownerships!: Table<Ownership, string>;
  orders!: Table<Order, string>;
  events!: Table<OrderEvent, string>;
  inspections!: Table<Inspection, string>;
  damageMarks!: Table<DamageMark, string>;
  addenda!: Table<Addendum, string>;
  media!: Table<Media, string>;
  mediaBlobs!: Table<MediaBlob, string>;
  items!: Table<OrderItem, string>;
  versions!: Table<EstimateVersion, string>;
  decisions!: Table<ItemDecision, string>;
  suppliers!: Table<Supplier, string>;
  supplierReturns!: Table<SupplierReturn, string>;
  payments!: Table<Payment, string>;
  invoices!: Table<Invoice, string>;
  debts!: Table<Debt, string>;
  cashMovements!: Table<CashMovement, string>;
  cashClosings!: Table<CashClosing, string>;
  expenses!: Table<Expense, string>;
  incomes!: Table<Income, string>;
  expenseCategories!: Table<ExpenseCategory, string>;
  incomeCategories!: Table<IncomeCategory, string>;
  employees!: Table<Employee, string>;
  salaryPayments!: Table<SalaryPayment, string>;
  messages!: Table<MessageLog, string>;
  jobTemplates!: Table<JobTemplate, string>;
  relatedRules!: Table<RelatedRule, string>;
  claims!: Table<Claim, string>;
  incidents!: Table<Incident, string>;
  counters!: Table<Counter, string>;
  notes!: Table<JobNote, string>;
  books!: Table<StoredBook, string>;
  creditPayments!: Table<CreditPayment, string>;
  /** Records deleted here, waiting to be told to the server (v0.40). */
  syncTombs!: Table<{ n?: number; t: string; k: string }, number>;

  constructor(name = 'mygarage') {
    super(name);
    this.version(1).stores({
      settings: 'id',
      customers: 'id, name, phone, createdAt',
      vehicles: 'id, customerId, plateSearch, vin',
      ownerships: 'id, vehicleId, customerId',
      orders: 'id, number, customerId, vehicleId, stage, createdAt',
      events: 'id, orderId, at',
      inspections: 'id, orderId',
      damageMarks: 'id, inspectionId',
      addenda: 'id, inspectionId',
      media: 'id, ownerId',
      mediaBlobs: 'id',
      items: 'id, orderId, supplierId, procurementStatus',
      versions: 'id, orderId',
      decisions: 'id, versionId, itemId, orderId',
      suppliers: 'id, name',
      supplierReturns: 'id, status, supplierId, orderId',
      payments: 'id, orderId, receivedAt',
      invoices: 'id, orderId, number, issuedAt',
      debts: 'id, orderId, status',
      cashMovements: 'id, at, closingId',
      cashClosings: 'id, date',
      expenses: 'id, date, categoryId',
      expenseCategories: 'id, code',
      employees: 'id',
      salaryPayments: 'id, employeeId, month',
      messages: 'id, orderId, customerId',
      jobTemplates: 'id, code',
      relatedRules: 'id, triggerTemplateCode',
      claims: 'id, orderId, vehicleId',
      incidents: 'id, orderId',
      counters: 'name',
    });
    // v2: money book — other income, expenses linked to a car / customer.
    this.version(2).stores({
      expenses: 'id, date, categoryId, orderId, vehicleId, customerId',
      incomes: 'id, date, orderId, vehicleId, customerId',
    });
    // v3: a job's notes (text, photo, voice).
    this.version(3).stores({
      notes: 'id, orderId, createdAt',
    });
    // v4: the supplier base workbook last brought in (its other sheets go back out with an export).
    this.version(4).stores({
      books: 'id',
    });
    // v5: expenses on credit and what was paid towards them; a job's payments found by the income they came in.
    this.version(5).stores({
      creditPayments: 'id, expenseId, date',
      payments: 'id, orderId, receivedAt, incomeId',
    });
    // v6: categories of money in (v0.26) — the four of the app (`ensureSeed` puts them in) and the garage's own.
    this.version(6).stores({
      incomeCategories: 'id, code',
    });
    // v7 (v0.40): syncing with the garage's server — every record's stamp of its last change here, indexed (`_t`, see
    // db/syncHooks.ts); a photo's files waiting to be sent (`up`); deletions waiting to be told (`syncTombs`).
    this.version(7).stores({
      settings: 'id, _t',
      customers: 'id, name, phone, createdAt, _t',
      vehicles: 'id, customerId, plateSearch, vin, _t',
      ownerships: 'id, vehicleId, customerId, _t',
      orders: 'id, number, customerId, vehicleId, stage, createdAt, _t',
      events: 'id, orderId, at, _t',
      inspections: 'id, orderId, _t',
      damageMarks: 'id, inspectionId, _t',
      addenda: 'id, inspectionId, _t',
      media: 'id, ownerId, _t',
      mediaBlobs: 'id, up',
      items: 'id, orderId, supplierId, procurementStatus, _t',
      versions: 'id, orderId, _t',
      decisions: 'id, versionId, itemId, orderId, _t',
      suppliers: 'id, name, _t',
      supplierReturns: 'id, status, supplierId, orderId, _t',
      payments: 'id, orderId, receivedAt, incomeId, _t',
      invoices: 'id, orderId, number, issuedAt, _t',
      debts: 'id, orderId, status, _t',
      cashMovements: 'id, at, closingId, _t',
      cashClosings: 'id, date, _t',
      expenses: 'id, date, categoryId, orderId, vehicleId, customerId, _t',
      incomes: 'id, date, orderId, vehicleId, customerId, _t',
      expenseCategories: 'id, code, _t',
      incomeCategories: 'id, code, _t',
      employees: 'id, _t',
      salaryPayments: 'id, employeeId, month, _t',
      messages: 'id, orderId, customerId, _t',
      jobTemplates: 'id, code, _t',
      relatedRules: 'id, triggerTemplateCode, _t',
      claims: 'id, orderId, vehicleId, _t',
      incidents: 'id, orderId, _t',
      counters: 'name, _t',
      notes: 'id, orderId, createdAt, _t',
      books: 'id, _t',
      creditPayments: 'id, expenseId, date, _t',
      syncTombs: '++n',
    });
    installGuards(this);
    installSyncHooks(this);
  }
}

type Guarded = { name: string; hook: Table['hook'] };

/**
 * Database-level protection of evidence records (docs/04, section 4.3) — money is not among them since v0.23.
 * `allowed` lists the only fields that may still change; `isLocked` decides when the rule applies.
 */
function guard<T>(table: Table<T, string>, allowed: string[], isLocked: (obj: T) => boolean = () => true) {
  const t = table as unknown as Guarded;
  t.hook('updating', (modifications: object, _key: unknown, obj: T, trans: unknown) => {
    // What the server brings was signed on another device (v0.40): taken as it is.
    if (isRemote(trans) || !isLocked(obj)) return;
    const mods = modifications as Record<string, unknown>;
    // Dexie may report unchanged arrays/objects as modified, so compare values, not just keys.
    const bad = Object.keys(mods).filter(
      (k) => k !== STAMP && !allowed.includes(k.split('.')[0]) && !sameValue(mods[k], valueAt(obj, k)),
    );
    if (bad.length) throw new ImmutableError(t.name, bad);
  });
  t.hook('deleting', (key: unknown, obj: T, trans: unknown) => {
    if (isRemote(trans) || purgeable.has(String(key))) return;
    if (isLocked(obj)) throw new ImmutableError(t.name, ['(delete)']);
  });
}

function valueAt(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, p) => (o == null ? undefined : (o as Record<string, unknown>)[p]), obj);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Guarded records that may go: only those of a job being deleted whole (services/orders `deleteJob`) — its journal;
 * since v0.38 (the user's call: «сделай так чтобы можно было удалить с подтверждением») also its invoices, debts, sent
 * estimates, the customer's answers, signed reports and their stored PDFs, after the manager confirmed it — and only
 * while that deletion runs.
 */
const purgeable = new Set<string>();
export async function purge(table: Table<any, string>, ids: string[]): Promise<void> {
  if (!ids.length) return;
  ids.forEach((id) => purgeable.add(id));
  try {
    await table.bulkDelete(ids);
  } finally {
    ids.forEach((id) => purgeable.delete(id));
  }
}
export async function purgeJournal(ids: string[]): Promise<void> {
  await purge(db.events, ids);
}

function installGuards(db: GarageDB) {
  guard(db.inspections, ['pdfMediaId', 'pdfSha256'], (o) => o.locked);
  guard(db.media, [], (m) => m.locked);
  guard(db.versions, ['status', 'answeredAt']);
  guard(db.decisions, []);
  guard(db.invoices, ['status']);
  guard(db.debts, ['status']);
  guard(db.events, [], (e) => !purgeable.has(e.id));
  guard(db.addenda, []);
  // Money (payments, income, expenses, payments of credits, the cash box and its closings) is not guarded since
  // v0.23 — the user's call: any operation can be deleted or changed. Only through services/entries.ts, which takes
  // an operation whole and keeps the cash box and the book in step.
}

export let db = new GarageDB();

/** Replace the database instance (used by tests and by backup restore). */
export function setDb(next: GarageDB) {
  db = next;
}

/**
 * Random UUID v4. `crypto.randomUUID` exists only on HTTPS/localhost; when the app is opened from a phone
 * over the local network (http://192.168…) we build the same kind of id from `getRandomValues`, which
 * works everywhere.
 */
/**
 * Records whose `index` is any of `keys`, in the order Dexie's `anyOf` gives them (by key, then by primary key) — but
 * one request a key (v0.37): `anyOf` walks one cursor record by record (sixty jobs' journals, 1 440 records, took a
 * third of a second), while a key's records come back at once. For keys with many records each (a job's journal, an
 * act's photos, a car's visits); where a key has a record or two, `anyOf` is quicker.
 */
export async function whereAnyOf<T>(table: Table<T, string>, index: string, keys: readonly string[]): Promise<T[]> {
  const sorted = [...new Set(keys)].sort();
  return (await Promise.all(sorted.map((k) => table.where(index).equals(k).toArray()))).flat();
}

export function uid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Next value of a named counter (call inside a transaction that includes db.counters). */
export async function nextNumber(name: string, start = 1): Promise<number> {
  const c = await db.counters.get(name);
  const value = c ? c.value + 1 : start;
  await db.counters.put({ name, value });
  return value;
}
