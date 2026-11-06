import { db, uid } from '../db/db';
import { dubaiDate, nowIso } from '../domain/dates';
import type { Claim, Incident } from '../domain/types';
import { AppError } from './errors';
import { addExpense } from './money';
import { createOrder, logEvent } from './orders';

export async function openClaim(orderId: string, description: string): Promise<Claim> {
  const o = await db.orders.get(orderId);
  if (!o) throw new AppError('err.notFound');
  if (!description.trim()) throw new AppError('err.textRequired');
  const c: Claim = { id: uid(), orderId, vehicleId: o.vehicleId, customerId: o.customerId, description: description.trim(), openedAt: nowIso() };
  await db.claims.add(c);
  await logEvent(orderId, 'claim', { description: c.description });
  return c;
}

export async function closeClaim(id: string, outcome: NonNullable<Claim['outcome']>, notes?: string): Promise<void> {
  const c = await db.claims.get(id);
  if (!c) throw new AppError('err.notFound');
  await db.claims.update(id, { outcome, notes: notes?.trim() || undefined, closedAt: nowIso() });
  await logEvent(c.orderId, 'claim_closed', { outcome, notes });
}

/** Warranty return: a new order linked to the original one. */
export async function createWarrantyOrder(originalOrderId: string, complaint: string, claimId?: string) {
  const o = await db.orders.get(originalOrderId);
  if (!o) throw new AppError('err.notFound');
  const created = await createOrder({ customerId: o.customerId, vehicleId: o.vehicleId, complaint, arrivedNow: true, warrantyOfOrderId: o.id });
  if (claimId) await db.claims.update(claimId, { warrantyOrderId: created.id, outcome: 'warranty' });
  await logEvent(originalOrderId, 'warranty_order', { orderId: created.id, number: created.number });
  return created;
}

export async function addIncident(orderId: string, input: Pick<Incident, 'description' | 'damageEstimateFils' | 'employeeId'>): Promise<Incident> {
  if (!input.description.trim()) throw new AppError('err.textRequired');
  const inc: Incident = { ...input, id: uid(), orderId, status: 'open', at: nowIso() };
  await db.incidents.add(inc);
  await logEvent(orderId, 'incident', { description: input.description });
  return inc;
}

export async function resolveIncident(id: string, resolution: string, costFils: number, method: 'cash' | 'card' | 'transfer' = 'cash'): Promise<void> {
  const inc = await db.incidents.get(id);
  if (!inc) throw new AppError('err.notFound');
  if (costFils > 0) {
    const cat = await db.expenseCategories.where('code').equals('incidents').first();
    if (cat) await addExpense({ date: dubaiDate(), categoryId: cat.id, amountFils: costFils, vatFils: 0, method, orderId: inc.orderId, note: resolution, overLimitComment: resolution });
  }
  await db.incidents.update(id, { status: 'resolved', resolution: resolution.trim() });
  await logEvent(inc.orderId, 'incident_resolved', { resolution, costFils });
}
