import { db, purge, purgeJournal, uid } from '../db/db';
import { mechanicsOf, toggled } from '../domain/crew';
import { hoursBetween, nowIso } from '../domain/dates';
import { whatJobHolds, whyJobStays, type DeleteBlock } from '../domain/deletion';
import { orderDue } from '../domain/debts';
import { byPosition } from '../domain/items';
import { checkTransition, isBackward, type StageContext } from '../domain/stages';
import type {
  Addendum,
  Claim,
  Customer,
  DamageMark,
  Debt,
  Employee,
  EstimateVersion,
  Incident,
  Inspection,
  Invoice,
  ItemDecision,
  JobNote,
  Lang,
  Media,
  MediaBlob,
  MessageLog,
  Order,
  OrderEvent,
  OrderItem,
  Payment,
  Plate,
  Settings,
  Stage,
  SupplierReturn,
  Vehicle,
} from '../domain/types';
import { createCustomer, createVehicle, findCustomerByPhone, updateCustomer, updateVehicle } from './customers';
import { restoreEntry, takeJobPayments, type RemovedEntry } from './entries';
import { AppError } from './errors';
import { getSettings } from './settings';

export async function logEvent(orderId: string, type: string, payload?: Record<string, unknown>): Promise<void> {
  await db.events.add({ id: uid(), orderId, at: nowIso(), type, payload });
}

export interface NewOrderInput {
  customerId: string;
  vehicleId: string;
  complaint: string;
  bookedFor?: string;
  arrivedNow: boolean;
  warrantyOfOrderId?: string;
}

/**
 * A new job. A car that is here goes straight on to diagnostics — the mechanic looks at it, the intake act is
 * optional (check-in, a warranty return). It is the job's creation that puts it there, not the first look at it:
 * opening a job never changes it (the board would put it on top).
 */
/**
 * The garage's own job numbers (v0.42.3, the user): Eaglecart's are its jobs' (up to 319 there) — the garage's own go on
 * from 350, never below it, one after another. The garage's server keeps them unique between devices (server/src/numbers.mjs).
 */
export const FIRST_OWN_NUMBER = 350;

async function nextOrderNumber(): Promise<number> {
  const c = await db.counters.get('order');
  const value = Math.max(FIRST_OWN_NUMBER, (c?.value ?? 0) + 1);
  await db.counters.put({ name: 'order', value });
  return value;
}

export async function createOrder(input: NewOrderInput): Promise<Order> {
  const customer = await db.customers.get(input.customerId);
  if (!customer) throw new AppError('err.notFound');
  return db.transaction('rw', db.orders, db.counters, db.events, async () => {
    const now = nowIso();
    const order: Order = {
      id: uid(),
      number: await nextOrderNumber(),
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      stage: input.arrivedNow ? 'diagnostics' : 'booked',
      outcome: 'in_progress',
      complaint: input.complaint.trim(),
      docLanguage: customer.docLanguage,
      bookedFor: input.bookedFor,
      arrivedAt: input.arrivedNow ? now : undefined,
      warrantyOfOrderId: input.warrantyOfOrderId,
      stageChangedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await db.orders.add(order);
    await logEvent(order.id, 'created', { stage: order.stage, warrantyOf: input.warrantyOfOrderId });
    return order;
  });
}

export interface CheckInInput {
  /** An existing car picked by its plate; otherwise a new car is created from plate/make/model. */
  vehicleId?: string;
  plate: Plate;
  make: string;
  model: string;
  /** An existing customer picked from the suggestions. */
  customerId?: string;
  name: string;
  phone: string;
  docLanguage: Lang;
  complaint: string;
  arrivedNow: boolean;
  bookedFor?: string;
}

/**
 * Fast check-in in one step and one transaction: the plate is enough. A typed phone that already
 * belongs to a customer links to that customer; name and phone may stay empty and be added later
 * (they are filled in on an existing customer only where missing).
 */
export async function checkIn(input: CheckInInput): Promise<Order> {
  return db.transaction('rw', [db.customers, db.vehicles, db.ownerships, db.orders, db.counters, db.events], async () => {
    let vehicle = input.vehicleId ? await db.vehicles.get(input.vehicleId) : undefined;
    let customer: Customer | undefined;
    if (vehicle) {
      customer = await db.customers.get(vehicle.customerId);
      const patch: { make?: string; model?: string } = {};
      if (!vehicle.make && input.make.trim()) patch.make = input.make.trim();
      if (!vehicle.model && input.model.trim()) patch.model = input.model.trim();
      if (patch.make || patch.model) await updateVehicle(vehicle.id, patch);
    } else {
      if (input.customerId) customer = await db.customers.get(input.customerId);
      if (!customer && input.phone.trim()) customer = await findCustomerByPhone(input.phone);
      if (!customer)
        customer = await createCustomer({ name: input.name, phone: input.phone, preferredChannel: 'whatsapp', docLanguage: input.docLanguage, type: 'individual' });
      vehicle = await createVehicle(customer.id, { plate: input.plate, make: input.make.trim(), model: input.model.trim() });
    }
    if (!customer) throw new AppError('err.notFound');
    const fill: { name?: string; phone?: string } = {};
    if (!customer.name && input.name.trim()) fill.name = input.name;
    if (!customer.phone && input.phone.trim()) fill.phone = input.phone;
    if (fill.name !== undefined || fill.phone !== undefined) await updateCustomer(customer.id, fill);
    return createOrder({ customerId: customer.id, vehicleId: vehicle.id, complaint: input.complaint, arrivedNow: input.arrivedNow, bookedFor: input.bookedFor });
  });
}

/**
 * The job's customer is someone already in the base (picked while typing a name or a phone on the job):
 * the job, its car, its messages and claims go to them, and the documents follow their language. The
 * customer the job had is deleted when it was an empty one made at check-in (no name, no phone) and
 * nothing else is theirs. Payments and debts keep whom they were taken from (they never change); an
 * invoice already issued keeps its buyer — what that left blank shows the job's customer now (`invoiceBuyer`).
 */
export async function setJobCustomer(orderId: string, customerId: string): Promise<void> {
  await db.transaction('rw', [db.orders, db.vehicles, db.ownerships, db.customers, db.messages, db.claims, db.payments, db.debts, db.expenses, db.incomes, db.events], async () => {
    const [order, next] = await Promise.all([db.orders.get(orderId), db.customers.get(customerId)]);
    if (!order || !next || next.archivedAt) throw new AppError('err.notFound');
    const prevId = order.customerId;
    if (prevId === customerId) return;
    const now = nowIso();
    await db.orders.update(orderId, { customerId, docLanguage: next.docLanguage, updatedAt: now });
    const vehicle = await db.vehicles.get(order.vehicleId);
    if (vehicle && vehicle.customerId === prevId) {
      for (const o of await db.ownerships.where('vehicleId').equals(vehicle.id).filter((o) => !o.to).toArray()) await db.ownerships.update(o.id, { to: now });
      await db.ownerships.add({ id: uid(), vehicleId: vehicle.id, customerId, from: now });
      await db.vehicles.update(vehicle.id, { customerId });
    }
    await db.messages.where('orderId').equals(orderId).modify({ customerId });
    await db.claims.where('orderId').equals(orderId).modify({ customerId });
    const prev = await db.customers.get(prevId);
    if (prev && !prev.name.trim() && !prev.phone && !prev.companyName) {
      const still = await Promise.all([
        db.orders.where('customerId').equals(prevId).count(),
        db.vehicles.where('customerId').equals(prevId).count(),
        db.messages.where('customerId').equals(prevId).count(),
        db.expenses.where('customerId').equals(prevId).count(),
        db.incomes.where('customerId').equals(prevId).count(),
        db.payments.filter((p) => p.customerId === prevId).count(),
        db.debts.filter((d) => d.customerId === prevId).count(),
        db.claims.filter((c) => c.customerId === prevId).count(),
      ]);
      if (still.every((n) => n === 0)) {
        await db.ownerships.where('customerId').equals(prevId).delete();
        await db.customers.delete(prevId);
      }
    }
    await logEvent(orderId, 'customer_changed', { from: prevId, to: customerId });
  });
}

export interface OrderBundle {
  order: Order;
  customer: Customer;
  vehicle: Vehicle;
  mechanic?: Employee;
  items: OrderItem[];
  versions: EstimateVersion[];
  decisions: ItemDecision[];
  intake?: Inspection;
  handover?: Inspection;
  marks: DamageMark[];
  media: Media[];
  payments: Payment[];
  invoices: Invoice[];
  debts: Debt[];
  events: OrderEvent[];
  messages: MessageLog[];
  incidents: Incident[];
  claims: Claim[];
  /** The manager's notes on the job (text, photo, voice), oldest first. */
  notes: JobNote[];
  settings: Settings;
}

/**
 * The jobs read last, kept in memory: a screen opening a job the board has just read shows it at once
 * (no empty frame while the database answers); the live read follows and replaces it.
 */
const seen = new Map<string, OrderBundle>();
export function seenBundle(orderId: string): OrderBundle | undefined {
  return seen.get(orderId);
}
function remember(b: OrderBundle): OrderBundle {
  seen.delete(b.order.id);
  seen.set(b.order.id, b);
  if (seen.size > 80) seen.delete(seen.keys().next().value as string);
  return b;
}

export async function loadOrderBundle(orderId: string): Promise<OrderBundle | undefined> {
  const order = await db.orders.get(orderId);
  if (!order) {
    seen.delete(orderId);
    return undefined;
  }
  const [customer, vehicle, items, versions, decisions, inspections, payments, invoices, debts, events, messages, incidents, claims, settings, notes] =
    await Promise.all([
      db.customers.get(order.customerId),
      db.vehicles.get(order.vehicleId),
      db.items.where('orderId').equals(orderId).sortBy('createdAt').then((list) => list.sort(byPosition)),
      db.versions.where('orderId').equals(orderId).sortBy('number'),
      db.decisions.where('orderId').equals(orderId).sortBy('decidedAt'),
      db.inspections.where('orderId').equals(orderId).toArray(),
      db.payments.where('orderId').equals(orderId).sortBy('receivedAt'),
      db.invoices.where('orderId').equals(orderId).sortBy('issuedAt'),
      db.debts.where('orderId').equals(orderId).toArray(),
      db.events.where('orderId').equals(orderId).sortBy('at'),
      db.messages.where('orderId').equals(orderId).sortBy('createdAt'),
      db.incidents.where('orderId').equals(orderId).toArray(),
      db.claims.where('orderId').equals(orderId).toArray(),
      getSettings(),
      db.notes.where('orderId').equals(orderId).sortBy('createdAt'),
    ]);
  if (!customer || !vehicle) return undefined;
  // Prefer the signed act if, for any reason, more than one exists.
  const pick = (kind: Inspection['kind']) =>
    inspections.filter((i) => i.kind === kind).sort((a, c) => Number(c.locked) - Number(a.locked) || a.createdAt.localeCompare(c.createdAt))[0];
  const intake = pick('intake');
  const handover = pick('handover');
  const inspIds = inspections.map((i) => i.id);
  const ownerIds = [orderId, ...inspIds, ...items.map((i) => i.id), ...versions.map((v) => v.id), ...debts.map((d) => d.id)];
  const [marks, media, mechanic] = await Promise.all([
    inspIds.length ? db.damageMarks.where('inspectionId').anyOf(inspIds).toArray() : Promise.resolve([] as DamageMark[]),
    db.media.where('ownerId').anyOf(ownerIds).sortBy('createdAt'),
    order.mechanicId ? db.employees.get(order.mechanicId) : Promise.resolve(undefined),
  ]);
  return remember({
    order,
    customer,
    vehicle,
    mechanic,
    items,
    versions,
    decisions,
    intake,
    handover,
    marks,
    media,
    payments,
    invoices,
    debts,
    events,
    messages,
    incidents,
    claims,
    notes,
    settings,
  });
}

/**
 * Jobs as a row of a list shows them (v0.37: the archive's sixty latest) — their order, customer and car, lines,
 * versions, invoices, payments, debts and incidents: what the row, its step, its flags and its sums are made of. Their
 * journal, messages, notes, photos and acts are not read (a row shows none of them; a job's journal is the most of
 * it), and these bundles are not kept to open a job by — a touch on the row reads it whole (`prefetchBundle`). One
 * read a table for all the rows (a job has a record or two in each: a cursor over them is quickest).
 */
export async function loadRowBundles(orders: Order[]): Promise<(OrderBundle | undefined)[]> {
  const ids = orders.map((o) => o.id);
  const [settings, customers, vehicles, items, versions, payments, invoices, debts, incidents] = await Promise.all([
    getSettings(),
    db.customers.bulkGet([...new Set(orders.map((o) => o.customerId))]),
    db.vehicles.bulkGet([...new Set(orders.map((o) => o.vehicleId))]),
    db.items.where('orderId').anyOf(ids).toArray().then(byOrder),
    db.versions.where('orderId').anyOf(ids).toArray().then(byOrder),
    db.payments.where('orderId').anyOf(ids).toArray().then(byOrder),
    db.invoices.where('orderId').anyOf(ids).toArray().then(byOrder),
    db.debts.where('orderId').anyOf(ids).toArray().then(byOrder),
    db.incidents.where('orderId').anyOf(ids).toArray().then(byOrder),
  ]);
  const customerBy = new Map(customers.filter((c): c is Customer => !!c).map((c) => [c.id, c]));
  const vehicleBy = new Map(vehicles.filter((v): v is Vehicle => !!v).map((v) => [v.id, v]));
  return orders.map((order): OrderBundle | undefined => {
    const customer = customerBy.get(order.customerId);
    const vehicle = vehicleBy.get(order.vehicleId);
    if (!customer || !vehicle) return undefined;
    const id = order.id;
    return {
      order,
      customer,
      vehicle,
      // In the order a job's own read gives them (`loadOrderBundle`: Dexie's `sortBy`, ties as they came).
      items: sortedBy(items.get(id) ?? [], 'createdAt').sort(byPosition),
      versions: sortedBy(versions.get(id) ?? [], 'number'),
      payments: sortedBy(payments.get(id) ?? [], 'receivedAt'),
      invoices: sortedBy(invoices.get(id) ?? [], 'issuedAt'),
      debts: debts.get(id) ?? [],
      incidents: incidents.get(id) ?? [],
      decisions: [],
      marks: [],
      media: [],
      events: [],
      messages: [],
      claims: [],
      notes: [],
      settings,
    };
  });
}

/** Sorted by one field, as Dexie's `sortBy` does it (ties keep the order they came in). */
function sortedBy<T>(list: T[], key: keyof T): T[] {
  return list.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
}

/** Records by the job they belong to, in the order they came. */
function byOrder<T extends { orderId?: string }>(list: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of list) {
    if (!r.orderId) continue;
    const l = out.get(r.orderId);
    if (l) l.push(r);
    else out.set(r.orderId, [r]);
  }
  return out;
}

/** A job about to be opened (a finger on its row) read whole now: the job's screen shows it at once (`seenBundle`). */
export function prefetchBundle(orderId: string): void {
  if (!seen.has(orderId)) void loadOrderBundle(orderId).catch(() => undefined);
}

/** What the job still owes — the one sum everywhere (the job, the board's "Debts", "Money → Debts"): `orderDue`. */
export function bundleAmountDue(b: OrderBundle): number {
  return orderDue(b.order, b.items, b.invoices, b.payments);
}

export function stageContext(b: OrderBundle): StageContext {
  return {
    order: b.order,
    items: b.items,
    intakeDone: !!b.intake?.locked || !!b.intake?.completedAt,
    sentVersions: b.versions.length,
    amountDueFils: bundleAmountDue(b),
    debtSigned: b.debts.some((d) => d.status === 'open'),
    qcComplete: !!b.order.qcDoneAt,
    invoiced: b.invoices.some((i) => i.status === 'issued'),
  };
}

/**
 * Storage days beyond the free period while the car waits in "ready". Only acts signed before the
 * fast check-in carry a free-parking term; new jobs have no parking charge.
 */
export function storageDaysOver(b: OrderBundle, now = nowIso()): number {
  const free = b.intake?.conditions?.freeStorageDays;
  if (free === undefined || b.order.stage !== 'ready' || !b.order.readyAt || b.order.storageWaived) return 0;
  const days = Math.floor(hoursBetween(b.order.readyAt, now) / 24);
  return Math.max(0, days - free);
}

const STAMP: Partial<Record<Stage, keyof Order>> = {
  intake: 'arrivedAt',
  ready: 'readyAt',
  delivered: 'deliveredAt',
  closed: 'closedAt',
};

export async function changeStage(orderId: string, to: Stage, reason?: string): Promise<void> {
  const b = await loadOrderBundle(orderId);
  if (!b) throw new AppError('err.notFound');
  const from = b.order.stage;
  const check = checkTransition(from, to, stageContext(b));
  if (!check.ok) throw new AppError(check.reason);
  const backward = isBackward(from, to);
  if (backward && !reason?.trim()) throw new AppError('stageErr.reasonRequired');
  const now = nowIso();
  const patch: Partial<Order> = { stage: to, stageChangedAt: now, updatedAt: now };
  const stamp = STAMP[to];
  if (stamp && !b.order[stamp]) (patch as Record<string, unknown>)[stamp] = now;
  if (to === 'cancelled') {
    patch.outcome = 'cancelled';
    patch.cancelReason = reason;
  }
  if (to === 'delivered' && b.order.outcome === 'in_progress') patch.outcome = 'completed';
  // Quick close: the car is handed over at the same moment.
  if (to === 'closed' && from !== 'delivered') {
    if (!b.order.deliveredAt) patch.deliveredAt = now;
    if (b.order.outcome === 'in_progress') patch.outcome = 'completed';
  }
  if (backward && stageIndexOf(to) < stageIndexOf('ready')) patch.qcDoneAt = undefined;
  await db.transaction('rw', db.orders, db.events, async () => {
    await db.orders.update(orderId, patch);
    await logEvent(orderId, 'stage', { from, to, reason, backward });
  });
}

function stageIndexOf(s: Stage): number {
  return ['booked', 'intake', 'diagnostics', 'awaiting_approval', 'awaiting_parts', 'in_progress', 'quality_check', 'ready'].indexOf(s);
}

/** Try a transition and ignore rule failures (used for automatic moves). */
export async function tryStage(orderId: string, to: Stage): Promise<boolean> {
  try {
    await changeStage(orderId, to);
    return true;
  } catch (e) {
    if (e instanceof AppError) return false;
    throw e;
  }
}

export async function updateOrder(orderId: string, patch: Partial<Pick<Order, 'complaint' | 'promisedReadyAt' | 'bookedFor' | 'docLanguage' | 'storageWaived'>>) {
  await db.transaction('rw', db.orders, db.events, async () => {
    await db.orders.update(orderId, { ...patch, updatedAt: nowIso() });
    await logEvent(orderId, 'updated', { fields: Object.keys(patch) });
  });
}

/** The job's mechanics, as a list (one, several or none); `mechanicId` keeps the first. */
async function setMechanics(orderId: string, ids: string[]): Promise<void> {
  await db.orders.update(orderId, { mechanicIds: ids, mechanicId: ids[0], updatedAt: nowIso() });
  await logEvent(orderId, 'mechanic', { employeeIds: ids });
}

/** One mechanic on the job and no other (or nobody). */
export async function assignMechanic(orderId: string, employeeId: string | undefined): Promise<void> {
  await db.transaction('rw', db.orders, db.events, () => setMechanics(orderId, employeeId ? [employeeId] : []));
}

/** A mechanic put on the job, or taken off it — a job can have several (domain/crew.ts). */
export async function toggleMechanic(orderId: string, employeeId: string): Promise<string[]> {
  return db.transaction('rw', db.orders, db.events, async () => {
    const order = await db.orders.get(orderId);
    if (!order) throw new AppError('err.notFound');
    const ids = toggled(mechanicsOf(order), employeeId);
    await setMechanics(orderId, ids);
    return ids;
  });
}

/** Everything a deleted job took with it, to bring it back ("Undo"). */
export interface DeletedJob {
  order: Order;
  events: OrderEvent[];
  items: OrderItem[];
  inspections: Inspection[];
  marks: DamageMark[];
  media: Media[];
  blobs: MediaBlob[];
  messages: MessageLog[];
  incidents: Incident[];
  notes?: JobNote[];
  /** Money-book entries that were for this job: they stay in the book, only unlinked from it. */
  expenseIds: string[];
  incomeIds: string[];
  /** Deleted with its records (v0.38): its documents, answers, debts, claims, returns — and its money, for "Undo". */
  records?: {
    invoices: Invoice[];
    debts: Debt[];
    versions: EstimateVersion[];
    decisions: ItemDecision[];
    addenda: Addendum[];
    claims: Claim[];
    supplierReturns: SupplierReturn[];
    /** Claims whose warranty job this was: they forget it. */
    warrantyClaimIds: string[];
    money: RemovedEntry;
  };
}

const JOB_TABLES = () => [
  db.orders,
  db.events,
  db.items,
  db.inspections,
  db.damageMarks,
  db.media,
  db.mediaBlobs,
  db.messages,
  db.incidents,
  db.notes,
  db.claims,
  db.invoices,
  db.payments,
  db.debts,
  db.versions,
  db.decisions,
  db.supplierReturns,
  db.expenses,
  db.incomes,
];

/** What a job holds that a plain deletion must not take (v0.38: the sheet lists it) and the money taken for it. */
export interface JobHolds {
  holds: DeleteBlock[];
  invoices: string[];
  paidFils: number;
}

export async function jobHolds(orderId: string): Promise<JobHolds> {
  const [invoices, payments, debts, versions, decisions, inspections, claims, supplierReturns] = await Promise.all([
    db.invoices.where('orderId').equals(orderId).toArray(),
    db.payments.where('orderId').equals(orderId).toArray(),
    db.debts.where('orderId').equals(orderId).toArray(),
    db.versions.where('orderId').equals(orderId).toArray(),
    db.decisions.where('orderId').equals(orderId).toArray(),
    db.inspections.where('orderId').equals(orderId).toArray(),
    db.claims.where('orderId').equals(orderId).toArray(),
    db.supplierReturns.where('orderId').equals(orderId).toArray(),
  ]);
  const items = await db.items.where('orderId').equals(orderId).primaryKeys();
  const owners = [orderId, ...inspections.map((i) => i.id), ...items];
  const lockedMedia = (await db.media.where('ownerId').anyOf(owners).toArray()).some((m) => m.locked);
  const paidFils = payments.reduce((s, p) => s + (p.kind === 'refund' ? -p.amountFils : p.amountFils), 0);
  return {
    holds: whatJobHolds({ invoices, payments, debts, versions, decisions, inspections, claims, supplierReturns, lockedMedia }),
    invoices: invoices.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)).map((i) => i.number),
    paidFils,
  };
}

/** Why this job cannot be deleted (domain/deletion.ts), or undefined when it can. */
export async function jobDeleteBlock(orderId: string): Promise<DeleteBlock | undefined> {
  const [invoices, payments, debts, versions, decisions, inspections, claims, supplierReturns] = await Promise.all([
    db.invoices.where('orderId').equals(orderId).toArray(),
    db.payments.where('orderId').equals(orderId).toArray(),
    db.debts.where('orderId').equals(orderId).toArray(),
    db.versions.where('orderId').equals(orderId).toArray(),
    db.decisions.where('orderId').equals(orderId).toArray(),
    db.inspections.where('orderId').equals(orderId).toArray(),
    db.claims.where('orderId').equals(orderId).toArray(),
    db.supplierReturns.where('orderId').equals(orderId).toArray(),
  ]);
  const items = await db.items.where('orderId').equals(orderId).primaryKeys();
  const owners = [orderId, ...inspections.map((i) => i.id), ...items];
  const lockedMedia = (await db.media.where('ownerId').anyOf(owners).toArray()).some((m) => m.locked);
  return whyJobStays({ invoices, payments, debts, versions, decisions, inspections, claims, supplierReturns, lockedMedia });
}

/**
 * Delete a job opened by mistake, with everything in it (works, photos, unsigned reports, messages, its
 * journal). Plainly — only a job without documents and money (see jobDeleteBlock); `withRecords` (v0.38, the user's
 * call, after the manager confirmed it): any job — its invoices and credit notes, debts, sent estimates and the
 * customer's answers, signed reports, claims, returns to suppliers and their stored PDFs go too, and its payments as
 * each would by itself (`takeJobPayments`: the cash box and the day closings follow). Invoice numbers are not given
 * again (the counter goes on). Its car and customer stay, money-book entries for it stay in the book unlinked.
 * Returns what is needed to undo it.
 */
export async function deleteJob(orderId: string, opts: { withRecords?: boolean } = {}): Promise<DeletedJob> {
  return db.transaction('rw', opts.withRecords ? db.tables : JOB_TABLES(), async () => {
    const order = await db.orders.get(orderId);
    if (!order) throw new AppError('err.notFound');
    const block = opts.withRecords ? undefined : await jobDeleteBlock(orderId);
    if (block) throw new AppError(`order.deleteBlock.${block}`);
    const records = opts.withRecords ? await takeRecords(orderId) : undefined;
    const [events, items, inspections, messages, incidents, expenses, incomes, notes] = await Promise.all([
      db.events.where('orderId').equals(orderId).toArray(),
      db.items.where('orderId').equals(orderId).toArray(),
      db.inspections.where('orderId').equals(orderId).toArray(),
      db.messages.where('orderId').equals(orderId).toArray(),
      db.incidents.where('orderId').equals(orderId).toArray(),
      db.expenses.where('orderId').equals(orderId).toArray(),
      db.incomes.where('orderId').equals(orderId).toArray(),
      db.notes.where('orderId').equals(orderId).toArray(),
    ]);
    const inspIds = inspections.map((i) => i.id);
    const owners = [orderId, ...inspIds, ...items.map((i) => i.id), ...incidents.map((i) => i.id), ...notes.map((n) => n.id)];
    if (records) {
      // Their papers: invoices' and estimates' PDFs, a debt's signature and paper, a receipt, a claim's photos.
      const r = records;
      owners.push(...[r.invoices, r.debts, r.versions, r.claims, r.supplierReturns].flat().map((x) => x.id), ...((r.money.gone.payments ?? []) as { id: string }[]).map((p) => p.id));
    }
    const media = await db.media.where('ownerId').anyOf(owners).toArray();
    const blobs = (await db.mediaBlobs.bulkGet(media.map((m) => m.id))).filter((b): b is NonNullable<typeof b> => !!b);
    const marks = inspIds.length ? await db.damageMarks.where('inspectionId').anyOf(inspIds).toArray() : [];
    for (const e of expenses) await db.expenses.update(e.id, { orderId: undefined });
    for (const i of incomes) await db.incomes.update(i.id, { orderId: undefined });
    await db.damageMarks.bulkDelete(marks.map((m) => m.id));
    await db.mediaBlobs.bulkDelete(media.map((m) => m.id));
    if (records) await purge(db.media, media.map((m) => m.id));
    else await db.media.bulkDelete(media.map((m) => m.id));
    if (records) await purge(db.inspections, inspIds);
    else await db.inspections.bulkDelete(inspIds);
    await db.items.bulkDelete(items.map((i) => i.id));
    await db.messages.bulkDelete(messages.map((m) => m.id));
    await db.incidents.bulkDelete(incidents.map((i) => i.id));
    await db.notes.bulkDelete(notes.map((n) => n.id));
    await purgeJournal(events.map((e) => e.id));
    await db.orders.delete(orderId);
    return { order, events, items, inspections, marks, media, blobs, messages, incidents, notes, expenseIds: expenses.map((e) => e.id), incomeIds: incomes.map((i) => i.id), records };
  });
}

/** A job deleted with its records (v0.38): they go — the guarded ones only by this deletion (`purge`) — and its money. */
async function takeRecords(orderId: string): Promise<NonNullable<DeletedJob['records']>> {
  const [invoices, debts, versions, decisions, claims, supplierReturns, inspIds, warranty] = await Promise.all([
    db.invoices.where('orderId').equals(orderId).toArray(),
    db.debts.where('orderId').equals(orderId).toArray(),
    db.versions.where('orderId').equals(orderId).toArray(),
    db.decisions.where('orderId').equals(orderId).toArray(),
    db.claims.where('orderId').equals(orderId).toArray(),
    db.supplierReturns.where('orderId').equals(orderId).toArray(),
    db.inspections.where('orderId').equals(orderId).primaryKeys(),
    db.claims.filter((c) => c.warrantyOrderId === orderId).toArray(),
  ]);
  const addenda = inspIds.length ? await db.addenda.where('inspectionId').anyOf(inspIds).toArray() : [];
  const money = await takeJobPayments(orderId);
  await purge(db.decisions, decisions.map((x) => x.id));
  await purge(db.versions, versions.map((x) => x.id));
  await purge(db.invoices, invoices.map((x) => x.id));
  await purge(db.debts, debts.map((x) => x.id));
  await purge(db.addenda, addenda.map((x) => x.id));
  await db.claims.bulkDelete(claims.map((x) => x.id));
  await db.supplierReturns.bulkDelete(supplierReturns.map((x) => x.id));
  for (const c of warranty) await db.claims.update(c.id, { warrantyOrderId: undefined });
  return { invoices, debts, versions, decisions, addenda, claims, supplierReturns, warrantyClaimIds: warranty.map((c) => c.id), money };
}

/** "Undo" right after deleting a job: everything comes back as it was (its money — as an operation's "Undo" brings it). */
export async function restoreJob(d: DeletedJob): Promise<void> {
  await db.transaction('rw', d.records ? db.tables : JOB_TABLES(), async () => {
    const r = d.records;
    if (r) {
      await db.invoices.bulkPut(r.invoices);
      await db.debts.bulkPut(r.debts);
      await db.versions.bulkPut(r.versions);
      await db.decisions.bulkPut(r.decisions);
      await db.addenda.bulkPut(r.addenda);
      await db.claims.bulkPut(r.claims);
      await db.supplierReturns.bulkPut(r.supplierReturns);
      for (const id of r.warrantyClaimIds) await db.claims.update(id, { warrantyOrderId: d.order.id });
    }
    await db.orders.put(d.order);
    await db.events.bulkPut(d.events);
    await db.items.bulkPut(d.items);
    await db.inspections.bulkPut(d.inspections);
    await db.damageMarks.bulkPut(d.marks);
    await db.media.bulkPut(d.media);
    await db.mediaBlobs.bulkPut(d.blobs);
    await db.messages.bulkPut(d.messages);
    await db.incidents.bulkPut(d.incidents);
    if (d.notes) await db.notes.bulkPut(d.notes);
    for (const id of d.expenseIds) await db.expenses.update(id, { orderId: d.order.id });
    for (const id of d.incomeIds) await db.incomes.update(id, { orderId: d.order.id });
  });
  if (d.records) await restoreEntry(d.records.money);
}

export async function markNoShow(orderId: string, reason: string): Promise<void> {
  await changeStage(orderId, 'cancelled', reason || 'no_show');
  await db.orders.update(orderId, { outcome: 'no_show' });
}

/**
 * The customer refused the repair after diagnostics: open items are cancelled, the diagnostics fee
 * agreed in the intake act stays, and the car goes to "ready" for handover.
 */
export async function declineRepair(orderId: string): Promise<void> {
  const b = await loadOrderBundle(orderId);
  if (!b) throw new AppError('err.notFound');
  if (!['diagnostics', 'awaiting_approval'].includes(b.order.stage)) throw new AppError('stageErr.notAllowed');
  const fee = b.intake?.conditions?.diagnosticsFeeFils ?? 0;
  const now = nowIso();
  await db.transaction('rw', [db.items, db.orders, db.events], async () => {
    for (const i of b.items) {
      if (i.approvalState === 'draft' || i.approvalState === 'pending') {
        if (i.approvalState === 'draft') await db.items.delete(i.id);
        else await db.items.update(i.id, { approvalState: 'declined' });
      }
    }
    if (fee > 0 && !b.items.some((i) => i.kind === 'fee' && i.approvalState === 'approved')) {
      await db.items.add({
        id: uid(),
        orderId,
        kind: 'fee',
        block: 'A',
        titleRu: 'Диагностика',
        titleEn: 'Diagnostics',
        qty: 1,
        unit: 'pcs',
        unitPriceFils: fee,
        vatRateBp: b.settings.vatRateBp,
        approvalState: 'approved',
        done: true,
        doneAt: now,
        createdAt: now,
      });
    }
    await db.orders.update(orderId, { outcome: 'repair_declined', stage: 'ready', readyAt: now, stageChangedAt: now, updatedAt: now });
    await logEvent(orderId, 'repair_declined', { diagnosticsFee: fee });
  });
}

export async function saveQc(orderId: string, checks: Record<string, boolean>): Promise<void> {
  await db.orders.update(orderId, { qcChecks: checks, updatedAt: nowIso() });
}

export async function completeQc(orderId: string, checks: Record<string, boolean>): Promise<void> {
  await db.transaction('rw', db.orders, db.events, async () => {
    await db.orders.update(orderId, { qcChecks: checks, qcDoneAt: nowIso() });
    await logEvent(orderId, 'qc_done', { checks });
  });
  await changeStage(orderId, 'ready');
}

export async function setTestDrive(orderId: string, patch: { testDriveStartKm?: number; testDriveEndKm?: number }) {
  await db.transaction('rw', db.orders, db.events, async () => {
    await db.orders.update(orderId, { ...patch, updatedAt: nowIso() });
    await logEvent(orderId, 'test_drive', patch);
  });
}
