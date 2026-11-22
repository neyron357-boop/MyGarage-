import { normalizePhone } from './phone';
import type { Driver, Order } from './types';

/*
 * The drivers of the garage's customers (v0.43) — who brings a company's cars. Which are offered for what is typed and
 * in what order (the ones who brought this company's cars first), and which one is the same man as the one typed, so
 * that he is never saved twice. Pure: the lists come from services/drivers.ts.
 */

/** The digits of a phone as it is said or typed ("050 111…", "+971 50…", "00971…"): to find a part of a number. */
export function phoneQueryDigits(q: string): string {
  return q.replace(/\D/g, '').replace(/^00/, '').replace(/^0/, '');
}

/** A name as compared: case, spaces and dots aside. */
export function nameKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s.\-_]+/g, ' ').trim();
}

/** How a driver was used by the company of the job: how many of its jobs he brought, this car or not, when last. */
export interface DriverUse {
  /** The company's jobs he brought. */
  company: number;
  /** He brought this very car before. */
  car: boolean;
  /** When he last brought one of the company's cars. */
  last: string;
}

type JobLike = Pick<Order, 'driver' | 'customerId' | 'vehicleId' | 'createdAt' | 'arrivedAt'>;

/** How each driver was used, from the jobs of a company (those with a driver). */
export function driverUse(jobs: JobLike[], customerId?: string, vehicleId?: string): Map<string, DriverUse> {
  const out = new Map<string, DriverUse>();
  for (const o of jobs) {
    const id = o.driver?.id;
    if (!id || (customerId && o.customerId !== customerId)) continue;
    const u = out.get(id) ?? { company: 0, car: false, last: '' };
    const at = o.arrivedAt || o.createdAt;
    u.company++;
    if (vehicleId && o.vehicleId === vehicleId) u.car = true;
    if (at > u.last) u.last = at;
    out.set(id, u);
  }
  return out;
}

/**
 * Who brought this car last time for this company (v0.68, the user: «завтра этот же автомобиль приезжает — при номере
 * машины имя водителя должно выставляться само»): the driver of its latest job that had one. None — none of its jobs did.
 */
export function lastCarDriver(jobs: JobLike[], vehicleId: string, customerId?: string): string | undefined {
  let best: { id: string; at: string } | undefined;
  for (const o of jobs) {
    const id = o.driver?.id;
    if (!id || o.vehicleId !== vehicleId || (customerId && o.customerId !== customerId)) continue;
    const at = o.arrivedAt || o.createdAt;
    if (!best || at > best.at) best = { id, at };
  }
  return best?.id;
}

/** What is typed into the driver's two fields. */
export interface DriverTyped {
  name: string;
  phone: string;
}

/** The phone part of what is typed: the phone field, or the name field when only a number is typed there. */
function typedDigits(typed: DriverTyped): string {
  if (typed.phone.trim()) return phoneQueryDigits(typed.phone);
  return /^[\d\s+()-]+$/.test(typed.name.trim()) ? phoneQueryDigits(typed.name) : '';
}

/** Does the driver fit what is typed: a part of his name (2+ letters) or of his phone (3+ digits, as it is said). */
export function driverMatches(d: Pick<Driver, 'name' | 'phone'>, typed: DriverTyped): boolean {
  const n = nameKey(typed.name);
  const digits = typedDigits(typed);
  const byName = n.length >= 2 && !/^[\d\s+()-]+$/.test(n) && nameKey(d.name).includes(n);
  const byPhone = digits.length >= 3 && !!d.phone && d.phone.replace(/\D/g, '').includes(digits);
  return byName || byPhone;
}

/**
 * The drivers offered for what is typed: the one with exactly this phone first; then those who brought this car, then
 * the company's others, then everyone else; a name that starts so before one that only has it; the recent first.
 * Nothing typed — only the company's own (who brought its cars), this car's first: one tap picks the usual one.
 */
export function rankDrivers(drivers: Driver[], use: Map<string, DriverUse>, typed: DriverTyped, limit = 5): Driver[] {
  const exact = typed.phone.trim() ? normalizePhone(typed.phone) ?? '' : '';
  const empty = !typed.name.trim() && !typed.phone.trim();
  const n = nameKey(typed.name);
  const list = drivers.filter((d) => !d.archivedAt && (empty ? (use.get(d.id)?.company ?? 0) > 0 : (!!exact && d.phone === exact) || driverMatches(d, typed)));
  const score = (d: Driver): number[] => {
    const u = use.get(d.id);
    return [exact && d.phone === exact ? 1 : 0, u?.car ? 1 : 0, u?.company ? 1 : 0, n && nameKey(d.name).startsWith(n) ? 1 : 0];
  };
  const when = (d: Driver) => use.get(d.id)?.last || d.updatedAt || d.createdAt;
  return list
    .map((d) => ({ d, s: score(d) }))
    .sort((a, b) => {
      for (let i = 0; i < a.s.length; i++) if (a.s[i] !== b.s[i]) return b.s[i] - a.s[i];
      return when(b.d).localeCompare(when(a.d)) || a.d.name.localeCompare(b.d.name);
    })
    .slice(0, limit)
    .map((x) => x.d);
}

/**
 * The driver already in the list for what was typed — the same man is never saved twice: the one with this phone
 * (whoever he drove for; one taken off the list too — he comes back); with no phone, the one of this company's
 * drivers with this name and no phone either (another phone is another man).
 */
export function sameDriver(drivers: Driver[], use: Map<string, DriverUse>, input: { name: string; phone: string }, exceptId?: string): Driver | undefined {
  const others = drivers.filter((d) => d.id !== exceptId);
  if (input.phone) return others.find((d) => d.phone === input.phone && !d.archivedAt) ?? others.find((d) => d.phone === input.phone);
  const n = nameKey(input.name);
  if (!n) return undefined;
  return others.find((d) => !d.archivedAt && !d.phone && nameKey(d.name) === n && (use.get(d.id)?.company ?? 0) > 0);
}
