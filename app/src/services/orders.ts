import { db, nextNumber, purgeJournal, uid } from '../db/db';
import { hoursBetween, nowIso } from '../domain/dates';
import { whyJobStays, type DeleteBlock } from '../domain/deletion';
import { amountDue } from '../domain/invoice';
import { summarize } from '../domain/items';
import { checkTransition, isBackward, type StageContext } from '../domain/stages';
import type {
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
  MessageLog,
  Order,
  OrderEvent,
  OrderItem,
  Payment,
  Plate,
  Settings,
  Stage,
  Vehicle,
} from '../domain/types';
import { createCustomer, createVehicle, findCustomerByPhone, updateCustomer, updateVehicle } from './customers';
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

export async function createOrder(input: NewOrderInput): Promise<Order> {
  const customer = await db.customers.get(input.customerId);
  if (!customer) throw new AppError('err.notFound');
  return db.transaction('rw', db.orders, db.counters, db.events, async () => {
    const now = nowIso();
    const order: Order = {
      id: uid(),
      number: await nextNumber('order', 1001),
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      stage: input.arrivedNow ? 'intake' : 'booked',
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
      db.items.where('orderId').equals(orderId).sortBy('createdAt'),
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

export function bundleAmountDue(b: OrderBundle): number {
  // History from Eaglecart: payments were not kept there consistently, so nothing is shown as owed.
  if (b.order.imported?.history) return 0;
  const due = amountDue(summarize(b.items).approvedGross, b.invoices, b.payments);
  // Closed without payment: nothing is owed (money paid over is still shown as such).
  return b.order.waived ? Math.min(0, due) : due;
}

export function stageContext(b: OrderBundle): StageContext {
  return {
    order: b.order,
    items: b.items,
    intakeDone: !!b.intake?.locked || !!b.intake?.completedAt,
    sentVersions: b.versions.length,
    handoverSigned: !!b.handover?.locked,
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

export async function assignMechanic(orderId: string, employeeId: string | undefined): Promise<void> {
  await db.transaction('rw', db.orders, db.events, async () => {
    await db.orders.update(orderId, { mechanicId: employeeId, updatedAt: nowIso() });
    await logEvent(orderId, 'mechanic', { employeeId });
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
  blobs: { id: string; blob: Blob; thumb?: Blob }[];
  messages: MessageLog[];
  incidents: Incident[];
  notes?: JobNote[];
  /** Money-book entries that were for this job: they stay in the book, only unlinked from it. */
  expenseIds: string[];
  incomeIds: string[];
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
 * journal). Only a job without documents and money (see jobDeleteBlock); its car and customer stay,
 * money-book entries for it stay in the book unlinked. Returns what is needed to undo it.
 */
export async function deleteJob(orderId: string): Promise<DeletedJob> {
  return db.transaction('rw', JOB_TABLES(), async () => {
    const order = await db.orders.get(orderId);
    if (!order) throw new AppError('err.notFound');
    const block = await jobDeleteBlock(orderId);
    if (block) throw new AppError(`order.deleteBlock.${block}`);
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
    const media = await db.media.where('ownerId').anyOf(owners).toArray();
    const blobs = (await db.mediaBlobs.bulkGet(media.map((m) => m.id))).filter((b): b is NonNullable<typeof b> => !!b);
    const marks = inspIds.length ? await db.damageMarks.where('inspectionId').anyOf(inspIds).toArray() : [];
    for (const e of expenses) await db.expenses.update(e.id, { orderId: undefined });
    for (const i of incomes) await db.incomes.update(i.id, { orderId: undefined });
    await db.damageMarks.bulkDelete(marks.map((m) => m.id));
    await db.mediaBlobs.bulkDelete(media.map((m) => m.id));
    await db.media.bulkDelete(media.map((m) => m.id));
    await db.inspections.bulkDelete(inspIds);
    await db.items.bulkDelete(items.map((i) => i.id));
    await db.messages.bulkDelete(messages.map((m) => m.id));
    await db.incidents.bulkDelete(incidents.map((i) => i.id));
    await db.notes.bulkDelete(notes.map((n) => n.id));
    await purgeJournal(events.map((e) => e.id));
    await db.orders.delete(orderId);
    return { order, events, items, inspections, marks, media, blobs, messages, incidents, notes, expenseIds: expenses.map((e) => e.id), incomeIds: incomes.map((i) => i.id) };
  });
}

/** "Undo" right after deleting a job: everything comes back as it was. */
export async function restoreJob(d: DeletedJob): Promise<void> {
  await db.transaction('rw', JOB_TABLES(), async () => {
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
