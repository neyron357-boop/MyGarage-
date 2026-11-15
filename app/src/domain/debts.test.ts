import { describe, expect, it } from 'vitest';
import { allocate, creditLeft, groupDebts, isCustomerDebt, orderDue, type DebtJob } from './debts';
import type { Customer, Invoice, Order, OrderItem, Payment, Vehicle } from './types';

const customer = (id: string, name: string) => ({ id, name, type: 'individual' }) as Customer;
const car = (id: string) => ({ id, make: 'Toyota', model: id }) as Vehicle;
const job = (n: number, c: Customer, v: Vehicle, dueFils: number, since: string): DebtJob => ({ order: { id: `o${n}`, number: n, stage: 'delivered' } as Order, vehicle: v, customer: c, dueFils, since });

describe('what a job owes', () => {
  const invoice = { id: 'i', type: 'tax_invoice', status: 'issued', totalFils: 60_000 } as Invoice;
  const paid = (amountFils: number, kind: Payment['kind'] = 'payment') => ({ kind, amountFils }) as Payment;
  it('is its invoice less the payments; a refund gives it back', () => {
    expect(orderDue({} as Order, [], [invoice], [paid(25_000)])).toBe(35_000);
    expect(orderDue({} as Order, [], [invoice], [paid(60_000), paid(10_000, 'refund')])).toBe(10_000);
  });
  it('before an invoice — the agreed lines', () => {
    const line = { kind: 'labor', qty: 1, unitPriceFils: 10_000, vatRateBp: 500, approvalState: 'approved' } as OrderItem;
    expect(orderDue({} as Order, [line], [], [])).toBe(10_500);
  });
  it('is nothing for a job closed unpaid, or carried over from the old system', () => {
    expect(orderDue({ waived: { at: '', fils: 60_000 } } as Order, [], [invoice], [])).toBe(0);
    expect(orderDue({ imported: { history: true } } as Order, [], [invoice], [])).toBe(0);
  });
  it('is a debt only once the car has left', () => {
    expect(isCustomerDebt({ stage: 'delivered' } as Order, 100)).toBe(true);
    expect(isCustomerDebt({ stage: 'closed' } as Order, 100)).toBe(true);
    expect(isCustomerDebt({ stage: 'ready' } as Order, 100)).toBe(false);
    expect(isCustomerDebt({ stage: 'delivered' } as Order, 0)).toBe(false);
  });
});

describe('debts by customer', () => {
  it('one card per customer — three cars are one card with three cars — whoever owes most first', () => {
    const anna = customer('a', 'Anna');
    const bob = customer('b', 'Bob');
    const cards = groupDebts([
      job(1, anna, car('camry'), 10_000, '2026-11-01'),
      job(2, bob, car('patrol'), 90_000, '2026-11-02'),
      job(3, anna, car('yaris'), 60_000, '2026-11-03'),
      job(4, anna, car('prado'), 40_000, '2026-11-04'),
      job(5, anna, car('camry'), 5_000, '2026-10-20'),
    ]);
    expect(cards.map((d) => [d.customer.name, d.totalFils])).toEqual([
      ['Anna', 115_000],
      ['Bob', 90_000],
    ]);
    // Anna's cars, the one owing most first; a car's jobs oldest first.
    expect(cards[0].cars.map((c) => [c.vehicle.model, c.totalFils, c.jobs.map((j) => j.order.number)])).toEqual([
      ['yaris', 60_000, [3]],
      ['prado', 40_000, [4]],
      ['camry', 15_000, [5, 1]],
    ]);
  });
});

describe('a sum received towards a customer’s debts', () => {
  const debts = [
    { orderId: 'new', dueFils: 40_000, since: '2026-11-10' },
    { orderId: 'old', dueFils: 60_000, since: '2026-11-01' },
  ];
  it('goes to the oldest first', () => {
    expect(allocate(25_000, debts)).toEqual({ parts: [{ orderId: 'old', amountFils: 25_000 }], restFils: 0 });
    expect(allocate(70_000, debts)).toEqual({ parts: [{ orderId: 'old', amountFils: 60_000 }, { orderId: 'new', amountFils: 10_000 }], restFils: 0 });
  });
  it('goes to the job picked first, then to the oldest', () => {
    expect(allocate(50_000, debts, 'new')).toEqual({ parts: [{ orderId: 'new', amountFils: 40_000 }, { orderId: 'old', amountFils: 10_000 }], restFils: 0 });
  });
  it('more than is owed, or no debts at all: the rest is left over', () => {
    expect(allocate(120_000, debts)).toEqual({ parts: [{ orderId: 'old', amountFils: 60_000 }, { orderId: 'new', amountFils: 40_000 }], restFils: 20_000 });
    expect(allocate(25_000, [])).toEqual({ parts: [], restFils: 25_000 });
  });
});

describe('an expense taken on credit', () => {
  it('owes what was not paid yet', () => {
    expect(creditLeft({ amountFils: 100_000 }, [])).toBe(100_000);
    expect(creditLeft({ amountFils: 100_000 }, [{ amountFils: 30_000 }])).toBe(70_000);
    expect(creditLeft({ amountFils: 100_000 }, [{ amountFils: 30_000 }, { amountFils: 70_000 }])).toBe(0);
  });
});
