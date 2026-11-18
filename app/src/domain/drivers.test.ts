import { describe, expect, it } from 'vitest';
import { driverMatches, driverUse, nameKey, phoneQueryDigits, rankDrivers, sameDriver } from './drivers';
import type { Driver, Order } from './types';

const driver = (id: string, name: string, phone = '', extra: Partial<Driver> = {}): Driver => ({ id, name, phone, createdAt: '2026-11-01T08:00:00.000Z', ...extra });
const job = (customerId: string, vehicleId: string, driverId: string, at: string): Pick<Order, 'driver' | 'customerId' | 'vehicleId' | 'createdAt' | 'arrivedAt'> => ({
  customerId,
  vehicleId,
  driver: { id: driverId, name: '', phone: '' },
  createdAt: at,
  arrivedAt: at,
});

describe('drivers (v0.43)', () => {
  it('a phone as it is said — 050…, +971…, 00971… — is the same digits; a name without case and dots', () => {
    expect(phoneQueryDigits('050 111 2233')).toBe('501112233');
    expect(phoneQueryDigits('+971 50 111')).toBe('97150111');
    expect(phoneQueryDigits('0097150')).toBe('97150');
    expect(nameKey('  Muhammad   ALI. ')).toBe('muhammad ali');
  });

  it('found by a part of the name or of the phone (3 digits and more)', () => {
    const m = driver('m', 'Muhammad Ali', '+971501112233');
    expect(driverMatches(m, { name: 'muh', phone: '' })).toBe(true);
    expect(driverMatches(m, { name: 'ali', phone: '' })).toBe(true);
    expect(driverMatches(m, { name: '', phone: '050 111' })).toBe(true);
    expect(driverMatches(m, { name: '', phone: '2233' })).toBe(true);
    expect(driverMatches(m, { name: '', phone: '+971 50 11' })).toBe(true);
    // A number typed into the name field is a number too.
    expect(driverMatches(m, { name: '111 22', phone: '' })).toBe(true);
    expect(driverMatches(m, { name: '', phone: '22' })).toBe(false);
    expect(driverMatches(m, { name: 'ahmed', phone: '' })).toBe(false);
  });

  it('the company’s drivers first — who brought this car before the others; the exact phone above all; nothing typed — only the company’s', () => {
    const drivers = [driver('a', 'Ahmed', '+971551112233'), driver('m', 'Muhammad', '+971501112233'), driver('x', 'Muhammad Khan', '+971521112233'), driver('old', 'Ahmad', '', { archivedAt: '2026-11-10T00:00:00.000Z' })];
    // ABC's jobs: Muhammad brought the Hiace (h) twice, Ahmed the Urvan (u) once — later.
    const use = driverUse([job('abc', 'h', 'm', '2026-11-02T08:00:00.000Z'), job('abc', 'h', 'm', '2026-11-05T08:00:00.000Z'), job('abc', 'u', 'a', '2026-11-08T08:00:00.000Z'), job('other', 'z', 'x', '2026-11-09T08:00:00.000Z')], 'abc', 'h');
    expect(use.get('m')).toEqual({ company: 2, car: true, last: '2026-11-05T08:00:00.000Z' });
    expect(use.get('x')).toBeUndefined(); // another company's job

    expect(rankDrivers(drivers, use, { name: '', phone: '' }).map((d) => d.id)).toEqual(['m', 'a']);
    expect(rankDrivers(drivers, use, { name: 'muh', phone: '' }).map((d) => d.id)).toEqual(['m', 'x']);
    expect(rankDrivers(drivers, use, { name: 'a', phone: '1112233' }).map((d) => d.id)).toEqual(['m', 'a', 'x']);
    // The whole number typed — that driver first, however it is written.
    expect(rankDrivers(drivers, use, { name: '', phone: '052 111 2233' }).map((d) => d.id)[0]).toBe('x');
    // Taken off the list — not offered.
    expect(rankDrivers(drivers, use, { name: 'ahmad', phone: '' })).toEqual([]);
  });

  it('the same man is not saved twice: the same phone (one taken off the list comes back); no phone — the same name among the company’s drivers without one', () => {
    const drivers = [driver('m', 'Muhammad', '+971501112233'), driver('s', 'Saleem'), driver('o', 'Omar', '+971509998877', { archivedAt: '2026-11-10T00:00:00.000Z' })];
    const use = driverUse([job('abc', 'h', 'm', '2026-11-02T08:00:00.000Z'), job('abc', 'h', 's', '2026-11-03T08:00:00.000Z')], 'abc');
    expect(sameDriver(drivers, use, { name: 'Mohammed', phone: '+971501112233' })?.id).toBe('m');
    expect(sameDriver(drivers, use, { name: 'Omar', phone: '+971509998877' })?.id).toBe('o');
    expect(sameDriver(drivers, use, { name: 'saleem ', phone: '' })?.id).toBe('s');
    // A name alone is not enough where the one in the list has a phone (another Muhammad), or drives for others.
    expect(sameDriver(drivers, use, { name: 'Muhammad', phone: '' })).toBeUndefined();
    expect(sameDriver(drivers, new Map(), { name: 'Saleem', phone: '' })).toBeUndefined();
    expect(sameDriver(drivers, use, { name: 'Muhammad', phone: '+971505550000' })).toBeUndefined();
  });
});
