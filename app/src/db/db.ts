import Dexie, { type Table } from 'dexie';
import type {
  Addendum,
  CashClosing,
  CashMovement,
  Claim,
  Counter,
  Customer,
  DamageMark,
  Debt,
  Employee,
  EstimateVersion,
  Expense,
  ExpenseCategory,
  Incident,
  Income,
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
  Supplier,
  SupplierReturn,
  Vehicle,
} from '../domain/types';

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
  employees!: Table<Employee, string>;
  salaryPayments!: Table<SalaryPayment, string>;
  messages!: Table<MessageLog, string>;
  jobTemplates!: Table<JobTemplate, string>;
  relatedRules!: Table<RelatedRule, string>;
  claims!: Table<Claim, string>;
  incidents!: Table<Incident, string>;
  counters!: Table<Counter, string>;
  notes!: Table<JobNote, string>;

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
    installGuards(this);
  }
}

type Guarded = { name: string; hook: Table['hook'] };

/**
 * Database-level protection of evidence and money records (docs/04, section 4.3).
 * `allowed` lists the only fields that may still change; `isLocked` decides when the rule applies.
 */
function guard<T>(table: Table<T, string>, allowed: string[], isLocked: (obj: T) => boolean = () => true) {
  const t = table as unknown as Guarded;
  t.hook('updating', (modifications: object, _key: unknown, obj: T) => {
    if (!isLocked(obj)) return;
    const mods = modifications as Record<string, unknown>;
    // Dexie may report unchanged arrays/objects as modified, so compare values, not just keys.
    const bad = Object.keys(mods).filter(
      (k) => !allowed.includes(k.split('.')[0]) && !sameValue(mods[k], valueAt(obj, k)),
    );
    if (bad.length) throw new ImmutableError(t.name, bad);
  });
  t.hook('deleting', (_key: unknown, obj: T) => {
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
 * Journal entries that may go: only those of a job being deleted whole, a job with no documents and no
 * money (domain/deletion.ts, services/orders deleteJob), and only while that deletion runs.
 */
const purgeable = new Set<string>();
export async function purgeJournal(ids: string[]): Promise<void> {
  ids.forEach((id) => purgeable.add(id));
  try {
    await db.events.bulkDelete(ids);
  } finally {
    ids.forEach((id) => purgeable.delete(id));
  }
}

function installGuards(db: GarageDB) {
  guard(db.inspections, ['pdfMediaId', 'pdfSha256'], (o) => o.locked);
  guard(db.media, [], (m) => m.locked);
  guard(db.versions, ['status', 'answeredAt']);
  guard(db.decisions, []);
  guard(db.invoices, ['status']);
  guard(db.payments, []);
  guard(db.cashMovements, ['closingId']);
  guard(db.cashClosings, []);
  guard(db.debts, ['status']);
  guard(db.events, [], (e) => !purgeable.has(e.id));
  guard(db.addenda, []);
  // Money book entries: what they were for can be corrected, the money itself (amount, method, date)
  // cannot; a wrong entry is cancelled (voidedAt), never deleted.
  const links = ['note', 'orderId', 'vehicleId', 'customerId', 'voidedAt'];
  guard(db.expenses, [...links, 'categoryId', 'vendor', 'overLimitComment', 'receiptMediaId']);
  guard(db.incomes, [...links, 'category']);
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
