import { describe, expect, it } from 'vitest';
import { formatAed, parseAed, roundFils } from './money';
import { enteredFromNet, fromNet, lineAmounts, netFromEntered, netFromGross, rateFor, switchVatMode, vatModeOf, vatOf } from './vat';
import { formatPlate, plateMatches, plateSearchKey } from './plates';
import { formatPhone, normalizePhone, phoneDigits } from './phone';
import { dubaiDate, formatDate, formatDateTime } from './dates';
import {
  canMarkDone,
  decisionPatch,
  isAwaitingClient,
  isAwaitingDisassembly,
  noCallLimitRemaining,
  resolveBlockB,
  summarize,
} from './items';
import { checkTransition, isBackward, type StageContext } from './stages';
import { activeInvoice, amountDue, chooseInvoiceType, formatDocNumber, invoiceLines, invoiceTotals } from './invoice';
import { expectedCash, nonCashTotals } from './cash';
import { computeReport } from './reports';
import type { CashMovement, Invoice, ItemDecision, Order, OrderItem, Payment } from './types';

let seq = 0;
function item(p: Partial<OrderItem>): OrderItem {
  seq += 1;
  return {
    id: p.id ?? `i${seq}`,
    orderId: 'o1',
    kind: 'labor',
    block: 'A',
    titleRu: 'Работа',
    titleEn: 'Work',
    qty: 1,
    unit: 'pcs',
    unitPriceFils: 10000,
    vatRateBp: 500,
    approvalState: 'draft',
    done: false,
    createdAt: '2026-11-06T08:00:00.000Z',
    ...p,
  };
}

function order(p: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    number: 1,
    customerId: 'c1',
    vehicleId: 'v1',
    stage: 'booked',
    outcome: 'in_progress',
    complaint: '',
    docLanguage: 'ru',
    stageChangedAt: '2026-11-06T08:00:00.000Z',
    createdAt: '2026-11-06T08:00:00.000Z',
    updatedAt: '2026-11-06T08:00:00.000Z',
    ...p,
  };
}

describe('money', () => {
  it('parses user input in AED', () => {
    expect(parseAed('1234.5')).toBe(123450);
    expect(parseAed('1 234,50')).toBe(123450);
    expect(parseAed('80 AED')).toBe(8000);
    expect(parseAed('abc')).toBeNull();
    expect(parseAed('')).toBeNull();
    expect(parseAed(0.1 + 0.2)).toBe(30);
  });
  it('rounds half away from zero', () => {
    expect(roundFils(2.5)).toBe(3);
    expect(roundFils(-2.5)).toBe(-3);
    expect(roundFils(-0.4)).toBe(0);
  });
  it('formats', () => {
    expect(formatAed(123450, 'en')).toBe('1,234.50 AED');
    expect(formatAed(123450, 'ru')).toBe('1 234,50 AED');
  });
});

describe('vat', () => {
  it('computes 5% per line with rounding', () => {
    expect(vatOf(10000, 500)).toBe(500);
    expect(vatOf(1999, 500)).toBe(100); // 99.95 -> 100
    expect(fromNet(1990, 500)).toEqual({ net: 1990, vat: 100, gross: 2090 }); // 99.5 -> 100
    expect(lineAmounts(1.5, 20000, 500)).toEqual({ net: 30000, vat: 1500, gross: 31500 });
  });
  it('extracts net from a VAT-inclusive amount', () => {
    expect(netFromGross(10500, 500)).toBe(10000);
    expect(netFromGross(100, 500)).toBe(95);
  });
  it('counts a typed price with VAT on top, inside, or without VAT', () => {
    expect(vatModeOf(500, false)).toBe('add');
    expect(vatModeOf(500, true)).toBe('incl');
    expect(vatModeOf(undefined, true)).toBe('incl');
    expect(vatModeOf(0, false)).toBe('none');
    expect(rateFor('none', 500)).toBe(0);
    expect(rateFor('incl', 500)).toBe(500);
    // 100 AED typed: +VAT → net 100 (pays 105); VAT inside → net 95.24 (pays 100); no VAT → net 100 (pays 100).
    expect(netFromEntered(10000, 500, 'add')).toBe(10000);
    expect(netFromEntered(10000, 500, 'incl')).toBe(9524);
    expect(netFromEntered(10000, 500, 'none')).toBe(10000);
    expect(enteredFromNet(9524, 500, 'incl')).toBe(10000);
    expect(lineAmounts(1, netFromEntered(10000, 500, 'none'), rateFor('none', 500))).toEqual({ net: 10000, vat: 0, gross: 10000 });
    // Another mode keeps the typed amount.
    expect(switchVatMode(10000, 500, 'add', 'incl')).toBe(9524);
    expect(switchVatMode(9524, 500, 'incl', 'none')).toBe(10000);
    expect(switchVatMode(10000, 500, 'none', 'add')).toBe(10000);
  });
  it('an untaxed line goes onto the invoice with no VAT', () => {
    const lines = invoiceLines([item({ approvalState: 'approved' }), item({ approvalState: 'approved', vatRateBp: 0, unitPriceFils: 5000 })], 'en');
    expect(lines[1]).toMatchObject({ net: 5000, vatRateBp: 0, vat: 0, gross: 5000 });
    expect(invoiceTotals(lines)).toEqual({ subtotalFils: 15000, vatFils: 500, totalFils: 15500 });
  });
});

describe('plates and phones', () => {
  it('normalizes plates', () => {
    const p = { emirate: 'DXB' as const, code: 'a', number: '12 345' };
    expect(plateSearchKey(p)).toBe('A12345');
    expect(formatPlate(p, 'en')).toBe('Dubai A 12345');
    expect(formatPlate(p, 'ru')).toBe('Дубай A 12345');
    expect(plateMatches('A12345', 'a 123')).toBe(true);
    expect(plateMatches('A12345', '999')).toBe(false);
  });
  it('normalizes UAE phones', () => {
    expect(normalizePhone('050 123 4567')).toBe('+971501234567');
    expect(normalizePhone('501234567')).toBe('+971501234567');
    expect(normalizePhone('00971 50 123 4567')).toBe('+971501234567');
    expect(normalizePhone('+7 916 123-45-67')).toBe('+79161234567');
    expect(normalizePhone('12')).toBeNull();
    expect(formatPhone('+971501234567')).toBe('+971 50 123 4567');
    expect(phoneDigits('+971501234567')).toBe('971501234567');
  });
});

describe('dates (Dubai time)', () => {
  it('uses Asia/Dubai', () => {
    expect(dubaiDate('2026-11-06T21:30:00.000Z')).toBe('2026-11-07');
    expect(formatDate('2026-11-06T21:30:00.000Z')).toBe('07/11/2026');
    expect(formatDate('2026-03-12')).toBe('12/03/2026');
    expect(formatDateTime('2026-11-06T10:32:00.000Z')).toBe('06/11/2026 14:32');
  });
});

describe('items and approvals', () => {
  it('summarizes blocks A/B/C into fixed / max / recommended', () => {
    const items = [
      item({ block: 'A', unitPriceFils: 40000, approvalState: 'pending' }),
      item({ block: 'B', unitPriceFils: 20000, priceMinFils: 15000, priceMaxFils: 30000, approvalState: 'pending' }),
      item({ block: 'C', unitPriceFils: 10000, approvalState: 'pending' }),
      item({ block: 'C', unitPriceFils: 5000, approvalState: 'declined' }),
    ];
    const s = summarize(items);
    expect(s.fixedGross).toBe(42000);
    expect(s.minGross).toBe(42000 + 15750);
    expect(s.maxGross).toBe(42000 + 31500);
    expect(s.recommendedGross).toBe(10500);
    expect(s.declinedGross).toBe(5250);
    expect(s.pendingGross).toBe(42000 + 31500 + 10500);
  });

  it('customer supplied parts and discounts', () => {
    const s = summarize([
      item({ kind: 'part', customerSupplied: true, unitPriceFils: 99999, approvalState: 'approved' }),
      item({ kind: 'discount', unitPriceFils: 1000, approvalState: 'approved' }),
      item({ unitPriceFils: 10000, approvalState: 'approved' }),
    ]);
    expect(s.approvedGross).toBe(10500 - 1050);
  });

  it('only approved items can be marked done', () => {
    expect(canMarkDone(item({ approvalState: 'pending' }))).toBe(false);
    expect(canMarkDone(item({ approvalState: 'declined' }))).toBe(false);
    expect(canMarkDone(item({ approvalState: 'approved' }))).toBe(true);
  });

  it('applies decisions; B choices keep the item pending until disassembly', () => {
    const b = item({ block: 'B', approvalState: 'pending' });
    expect(isAwaitingClient(b)).toBe(true);
    const patched = { ...b, ...decisionPatch(b, 'do_if_needed') };
    expect(patched.approvalState).toBe('pending');
    expect(isAwaitingDisassembly(patched)).toBe(true);
    expect(isAwaitingClient(patched)).toBe(false);
    expect(() => decisionPatch(item({ block: 'A' }), 'call_me')).toThrow();
    expect(decisionPatch(item({}), 'decline')).toEqual({ approvalState: 'declined' });
  });

  it('resolves block B after disassembly', () => {
    const b = item({ block: 'B', approvalState: 'pending', bChoice: 'do_if_needed', priceMaxFils: 30000 });
    expect(resolveBlockB(b, true, 25000).kind).toBe('auto_approved');
    expect(resolveBlockB(b, true, 35000).kind).toBe('needs_approval');
    expect(resolveBlockB(b, true, 35000).patch.approvalState).toBe('draft');
    expect(resolveBlockB({ ...b, bChoice: 'call_me' }, true, 1000).kind).toBe('needs_approval');
    expect(resolveBlockB(b, false, 0).patch.approvalState).toBe('cancelled');
  });

  it('computes the remaining no-call limit', () => {
    const a = item({ id: 'x1', unitPriceFils: 8000, approvalState: 'approved' }); // 84.00 gross
    const decisions: ItemDecision[] = [
      { id: 'd1', versionId: 'v', itemId: 'x1', orderId: 'o1', decision: 'approve', via: 'limit', decidedAt: '' },
    ];
    expect(noCallLimitRemaining(20000, [a], decisions)).toBe(20000 - 8400);
    expect(noCallLimitRemaining(5000, [a], decisions)).toBe(0);
  });
});

describe('stage transitions', () => {
  const base = (p: Partial<StageContext> = {}): StageContext => ({
    order: order(),
    items: [],
    intakeDone: false,
    sentVersions: 0,
    handoverSigned: false,
    amountDueFils: 0,
    debtSigned: false,
    qcComplete: false,
    invoiced: false,
    ...p,
  });

  it('requires a finished intake act', () => {
    expect(checkTransition('intake', 'diagnostics', base()).ok).toBe(false);
    expect(checkTransition('intake', 'diagnostics', base({ intakeDone: true })).ok).toBe(true);
  });
  it('cannot skip stages', () => {
    expect(checkTransition('intake', 'ready', base({ intakeDone: true })).ok).toBe(false);
  });
  it('blocks work when parts are missing or nothing approved', () => {
    const part = item({ kind: 'part', approvalState: 'approved', procurementStatus: 'ordered' });
    expect(checkTransition('awaiting_approval', 'in_progress', base()).ok).toBe(false);
    expect(checkTransition('awaiting_approval', 'in_progress', base({ items: [part] })).ok).toBe(false);
    expect(
      checkTransition('awaiting_approval', 'in_progress', base({ items: [{ ...part, procurementStatus: 'received' }] })).ok,
    ).toBe(true);
  });
  it('quality check needs all approved work done and no open questions', () => {
    const done = item({ approvalState: 'approved', done: true });
    const pending = item({ approvalState: 'pending' });
    expect(checkTransition('in_progress', 'quality_check', base({ items: [done] })).ok).toBe(true);
    expect(checkTransition('in_progress', 'quality_check', base({ items: [done, pending] })).ok).toBe(false);
    expect(checkTransition('in_progress', 'quality_check', base({ items: [item({ approvalState: 'approved' })] })).ok).toBe(
      false,
    );
  });
  it('delivery requires a signed act and payment or a signed debt', () => {
    expect(checkTransition('ready', 'delivered', base({ amountDueFils: 0 })).ok).toBe(false);
    expect(checkTransition('ready', 'delivered', base({ handoverSigned: true, amountDueFils: 100 })).ok).toBe(false);
    expect(checkTransition('ready', 'delivered', base({ handoverSigned: true, amountDueFils: 100, debtSigned: true })).ok).toBe(
      true,
    );
    expect(checkTransition('delivered', 'closed', base({ amountDueFils: 100 })).ok).toBe(false);
  });
  it('closes from any working stage once the invoice is paid (quick path)', () => {
    expect(checkTransition('intake', 'closed', base()).ok).toBe(false);
    expect(checkTransition('intake', 'closed', base({ invoiced: true, amountDueFils: 100 })).ok).toBe(false);
    expect(checkTransition('intake', 'closed', base({ invoiced: true, amountDueFils: 0 })).ok).toBe(true);
    expect(checkTransition('in_progress', 'closed', base({ invoiced: true, amountDueFils: 100, debtSigned: true })).ok).toBe(true);
    expect(checkTransition('booked', 'closed', base({ invoiced: true })).ok).toBe(false);
  });
  it('declined repair goes straight to ready', () => {
    expect(checkTransition('awaiting_approval', 'ready', base()).ok).toBe(false);
    expect(checkTransition('awaiting_approval', 'ready', base({ order: order({ outcome: 'repair_declined' }) })).ok).toBe(true);
  });
  it('allows going back between diagnostics and ready only', () => {
    expect(isBackward('ready', 'in_progress')).toBe(true);
    expect(isBackward('delivered', 'ready')).toBe(false);
    expect(isBackward('diagnostics', 'intake')).toBe(false);
  });
});

describe('invoices', () => {
  const items = [
    item({ kind: 'labor', unitPriceFils: 15000, approvalState: 'approved' }),
    item({ kind: 'part', unitPriceFils: 9999, qty: 2, approvalState: 'approved' }),
    item({ kind: 'part', customerSupplied: true, unitPriceFils: 5000, approvalState: 'approved' }),
    item({ kind: 'labor', unitPriceFils: 70000, approvalState: 'declined' }),
  ];
  it('builds lines from approved items only', () => {
    const lines = invoiceLines(items, 'en');
    expect(lines).toHaveLength(3);
    expect(lines[2].gross).toBe(0);
    expect(invoiceTotals(lines)).toEqual({ subtotalFils: 34998, vatFils: 750 + 1000, totalFils: 36748 });
  });
  it('chooses the invoice type', () => {
    expect(chooseInvoiceType({ type: 'company', trn: '100000000000003' })).toBe('tax_invoice');
    expect(chooseInvoiceType({ type: 'company' })).toBe('simplified_tax_invoice');
    expect(chooseInvoiceType({ type: 'individual' })).toBe('simplified_tax_invoice');
  });
  it('computes amount due against the active invoice', () => {
    const pay = (kind: Payment['kind'], amountFils: number): Payment => ({
      id: kind + amountFils,
      orderId: 'o1',
      customerId: 'c1',
      kind,
      method: 'cash',
      amountFils,
      receiptNumber: 'r',
      receivedAt: '',
    });
    const inv = (p: Partial<Invoice>): Invoice => ({
      id: 'inv',
      number: 'INV',
      type: 'simplified_tax_invoice',
      orderId: 'o1',
      issuedAt: '2026-11-06T10:00:00.000Z',
      seller: { name: 's' },
      buyer: { name: 'b' },
      lines: [],
      subtotalFils: 0,
      vatFils: 0,
      totalFils: 50000,
      currency: 'AED',
      status: 'issued',
      ...p,
    });
    expect(amountDue(40000, [], [pay('prepayment', 10000)])).toBe(30000);
    expect(amountDue(40000, [inv({})], [pay('prepayment', 10000), pay('refund', 1000)])).toBe(41000);
    const credited = inv({ id: 'old', status: 'credited', issuedAt: '2026-11-06T09:00:00.000Z' });
    expect(activeInvoice([credited, inv({ id: 'new' })])?.id).toBe('new');
    expect(activeInvoice([credited])).toBeUndefined();
    expect(formatDocNumber('INV', 2026, 7)).toBe('INV-2026-00007');
  });
});

describe('cash', () => {
  it('computes the expected cash balance', () => {
    const m = (direction: 'in' | 'out', amountFils: number): CashMovement => ({
      id: direction + amountFils,
      at: '',
      direction,
      amountFils,
      reason: 'other',
    });
    expect(expectedCash(10000, [m('in', 5000), m('out', 2500)])).toBe(12500);
    expect(
      nonCashTotals([
        { id: '1', orderId: '', customerId: '', kind: 'payment', method: 'card', amountFils: 300, receiptNumber: '', receivedAt: '' },
        { id: '2', orderId: '', customerId: '', kind: 'refund', method: 'card', amountFils: 100, receiptNumber: '', receivedAt: '' },
        { id: '3', orderId: '', customerId: '', kind: 'payment', method: 'cash', amountFils: 999, receiptNumber: '', receivedAt: '' },
      ]),
    ).toEqual({ card: 200, transfer: 0 });
  });
});

describe('reports', () => {
  it('computes revenue, costs, VAT and profit for a period', () => {
    const inv: Invoice = {
      id: 'inv1',
      number: 'INV-1',
      type: 'simplified_tax_invoice',
      orderId: 'o1',
      issuedAt: '2026-11-06T10:00:00.000Z',
      seller: { name: 's' },
      buyer: { name: 'b' },
      lines: [
        { description: 'l', kind: 'labor', qty: 1, unit: 'pcs', unitPriceFils: 20000, net: 20000, vatRateBp: 500, vat: 1000, gross: 21000 },
        { description: 'p', kind: 'part', qty: 1, unit: 'pcs', unitPriceFils: 10000, net: 10000, vatRateBp: 500, vat: 500, gross: 10500 },
      ],
      subtotalFils: 30000,
      vatFils: 1500,
      totalFils: 31500,
      currency: 'AED',
      status: 'issued',
    };
    const r = computeReport({
      from: '2026-11-01',
      to: '2026-11-30',
      orders: [order({ arrivedAt: '2026-11-05T08:00:00.000Z', deliveredAt: '2026-11-06T12:00:00.000Z' })],
      invoices: [inv, { ...inv, id: 'old', issuedAt: '2026-10-01T10:00:00.000Z' }],
      items: [
        item({
          kind: 'part',
          approvalState: 'approved',
          costPriceFils: 6000,
          purchaseVatFils: 300,
          receivedAt: '2026-11-05T09:00:00.000Z',
        }),
      ],
      expenses: [
        { id: 'e', date: '2026-11-03', categoryId: 'rent', amountFils: 10500, vatFils: 500, method: 'cash', createdAt: '' },
        { id: 'e2', date: '2026-12-01', categoryId: 'rent', amountFils: 99999, vatFils: 0, method: 'cash', createdAt: '' },
      ],
      payments: [
        { id: 'p', orderId: 'o1', customerId: 'c1', kind: 'payment', method: 'card', amountFils: 31500, receiptNumber: '', receivedAt: '2026-11-06T12:00:00.000Z' },
      ],
      closings: [
        {
          id: 'c',
          date: '2026-11-06',
          openingFils: 0,
          cashInFils: 0,
          cashOutFils: 0,
          expectedFils: 0,
          actualFils: -500,
          diffFils: -500,
          cardTotalFils: 0,
          transferTotalFils: 0,
          closedAt: '',
        },
      ],
    });
    expect(r.ordersReceived).toBe(1);
    expect(r.ordersDelivered).toBe(1);
    expect(r.revenueNet).toBe(30000);
    expect(r.laborNet).toBe(20000);
    expect(r.partsNet).toBe(10000);
    expect(r.partsCostNet).toBe(6000);
    expect(r.expensesNet).toBe(10000);
    expect(r.grossProfit).toBe(30000 - 6000 - 10000);
    expect(r.vatOutput).toBe(1500);
    expect(r.vatInput).toBe(300 + 500);
    expect(r.payments.card).toBe(31500);
    expect(r.cashDiffFils).toBe(-500);
    expect(r.averageTicketGross).toBe(31500);
  });
});
