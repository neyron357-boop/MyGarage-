import { describe, expect, it } from 'vitest';
import { allocate, creditLeft, debtQueue, groupCredits, groupDebts, historyDues, historyKey, isCustomerDebt, orderDue, spread, type DebtJob } from './debts';
import type { Customer, HistoryInvoice, Income, Invoice, Order, OrderItem, Payment, Vehicle } from './types';

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

describe('the invoices from before the app as a debt (v0.47)', () => {
  const acme = { id: 'acme', name: '', companyName: 'ACME', type: 'company' } as Customer;
  const hist = (id: string, date: string, totalFils: number): HistoryInvoice => ({ id, customerId: 'acme', vehicleId: 'v1', date, number: id, numberKind: 'job', plate: 'W-1', totalFils }) as HistoryInvoice;
  const pays = (parts: [string, number][], more: Partial<Income> = {}) => ({ category: 'debt', historyParts: parts.map(([invoiceId, amountFils]) => ({ invoiceId, amountFils })), ...more }) as Income;
  const invoices = [hist('may-1', '2026-05-02', 30_000), hist('jun-1', '2026-06-03', 20_000), hist('may-2', '2026-05-20', 10_000)];

  it('each owes its total less what debt payments set against it; a cancelled payment does not count', () => {
    const dues = historyDues(invoices, [pays([['may-1', 30_000], ['may-2', 4_000]]), pays([['jun-1', 20_000]], { voidedAt: 'x' }), { category: 'sale' } as Income]);
    expect(dues.map((d) => [d.invoiceId, d.dueFils])).toEqual([
      ['may-2', 6_000],
      ['jun-1', 20_000],
    ]);
  });

  it('one queue with the jobs: the oldest first — the invoices from before the app go before every job — or the job picked first', () => {
    const job1 = job(7, acme, car('hiace'), 50_000, '2026-11-12T10:00:00.000Z');
    const dues = historyDues(invoices, []);
    expect(spread(45_000, debtQueue([job1], dues)).parts).toEqual([
      { key: historyKey('may-1'), amountFils: 30_000 },
      { key: historyKey('may-2'), amountFils: 10_000 },
      { key: historyKey('jun-1'), amountFils: 5_000 },
    ]);
    expect(spread(60_000, debtQueue([job1], dues), 'o7')).toEqual({ parts: [{ key: 'o7', amountFils: 50_000 }, { key: historyKey('may-1'), amountFils: 10_000 }], restFils: 0 });
    // More than all of it: the rest is money in with no debt.
    expect(spread(120_000, debtQueue([job1], dues)).restFils).toBe(10_000);
    // The jobs' own spread is as it was.
    expect(allocate(20_000, [{ orderId: 'o7', dueFils: 50_000, since: '2026-11-12' }])).toEqual({ parts: [{ orderId: 'o7', amountFils: 20_000 }], restFils: 0 });
  });

  it('on the customer’s card: a month a row, oldest first, with what it still owes; with the jobs, one total', () => {
    const dues = historyDues(invoices, [pays([['may-1', 30_000]])]);
    const [only] = groupDebts([], [{ customer: acme, dues }]);
    expect(only).toMatchObject({ totalFils: 30_000, cars: [] });
    expect(only.history.map((m) => [m.month, m.dues.length, m.dueFils])).toEqual([
      ['2026-05', 1, 10_000],
      ['2026-06', 1, 20_000],
    ]);
    const [both] = groupDebts([job(7, acme, car('hiace'), 50_000, '2026-11-12')], [{ customer: acme, dues }]);
    expect(both.totalFils).toBe(80_000);
    expect(both.cars).toHaveLength(1);
  });
});

describe('whom the garage owes (v0.50.2)', () => {
  const credit = (id: string, vendor: string | undefined, date: string, leftFils: number, supplierId?: string) => ({ expense: { id, vendor, date, supplierId }, leftFils });
  const suppliers = [
    { id: 's1', name: 'Al Maroof Auto Spare Parts Trading LLC', phone: '+971528850442' },
    { id: 's2', name: 'Nakash', phone: undefined },
  ];

  it('one seller is one card, its credits inside the oldest first — by its supplier, its name without the company’s words, or the name as written', () => {
    const { creditors, loose } = groupCredits(
      [
        credit('e1', 'Al Maroof Auto Spare Parts Trading LLC', '2026-11-19', 9450),
        credit('e2', 'AL MAROOF AUTO SPARE PARTS TRADING L.L.C', '2026-11-17', 6825),
        credit('e3', 'Something else', '2026-11-18', 5000, 's1'),
        credit('e4', 'NAKASH', '2026-11-15', 12100),
        credit('e5', 'Gulf Star', '2026-11-10', 3000),
        credit('e6', 'GULF STAR TR. L.L.C.', '2026-11-12', 2000),
        credit('e7', undefined, '2026-11-16', 26000),
        credit('e8', '  ', '2026-11-16', 1000),
      ],
      suppliers,
    );
    expect(creditors.map((c) => [c.name, c.supplier?.id, c.credits.map((d) => d.expense.id), c.leftFils])).toEqual([
      ['Al Maroof Auto Spare Parts Trading LLC', 's1', ['e2', 'e3', 'e1'], 21275],
      ['Nakash', 's2', ['e4'], 12100],
      ['Gulf Star', undefined, ['e5', 'e6'], 5000],
    ]);
    expect(loose.map((d) => d.expense.id)).toEqual(['e7', 'e8']);
  });
});
