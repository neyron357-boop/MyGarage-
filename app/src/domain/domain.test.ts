import { describe, expect, it } from 'vitest';
import { formatAed, parseAed, roundFils } from './money';
import { enteredFromNet, enteredPrice, fromGross, fromNet, lineAmounts, netFromEntered, netFromGross, priceFromEntered, rateFor, switchVatMode, vatModeOf, vatOf } from './vat';
import { formatPlate, plateMatches, plateSearchKey } from './plates';
import { formatPhone, normalizePhone, phoneDigits } from './phone';
import { dayHeading, dubaiDate, formatDate, formatDateTime } from './dates';
import {
  canMarkDone,
  decisionPatch,
  isAwaitingClient,
  isAwaitingDisassembly,
  itemAmounts,
  noCallLimitRemaining,
  resolveBlockB,
  summarize,
} from './items';
import { canCloseUnpaid, checkTransition, isBackward, type StageContext } from './stages';
import { flowStage, jobPhase, nothingToBill, stepToward, type FlowFacts } from './flow';
import { activeInvoice, amountDue, chooseInvoiceType, formatDocNumber, invoiceLines, invoiceTotals } from './invoice';
import { apportion, discountPctLabel, discountPrice, splitDiscount, spreadDiscount } from './discount';
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
    expect(vatModeOf({ vatRateBp: 500 }, false)).toBe('add');
    expect(vatModeOf({ vatRateBp: 500 }, true)).toBe('incl');
    expect(vatModeOf(undefined, true)).toBe('incl');
    expect(vatModeOf({ vatRateBp: 0 }, false)).toBe('none');
    expect(vatModeOf({ vatRateBp: 500, unitGrossFils: 25000 }, false)).toBe('incl');
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
  it('a price typed with VAT keeps its total to the fils', () => {
    // 250.00 with VAT inside: 238.10 + 11.90, not 238.10 + 11.91 = 250.01.
    expect(fromGross(25000, 500)).toEqual({ net: 23810, vat: 1190, gross: 25000 });
    expect(fromNet(netFromGross(25000, 500), 500).gross).toBe(25001); // why the gross is kept
    const p = priceFromEntered(25000, 500, 'incl');
    expect(p).toEqual({ unitPriceFils: 23810, unitGrossFils: 25000 });
    expect(itemAmounts(item({ ...p }))).toEqual({ net: 23810, vat: 1190, gross: 25000 });
    expect(itemAmounts(item({ ...p, qty: 2 }))).toEqual({ net: 47619, vat: 2381, gross: 50000 });
    expect(enteredPrice({ ...p }, 500, 'incl')).toBe(25000);
    expect(priceFromEntered(25000, 500, 'add')).toEqual({ unitPriceFils: 25000, unitGrossFils: undefined });
    expect(priceFromEntered(25000, 0, 'incl')).toEqual({ unitPriceFils: 25000, unitGrossFils: undefined });
    // A discount line with VAT inside is negative to the fils too.
    expect(itemAmounts(item({ kind: 'discount', unitPriceFils: 2858, unitGrossFils: 3001 }))).toEqual({ net: -2858, vat: -143, gross: -3001 });
    // The invoice line carries the exact amounts.
    expect(invoiceLines([item({ ...p, approvalState: 'approved' })], 'en')[0]).toMatchObject({ unitPriceFils: 23810, net: 23810, vat: 1190, gross: 25000 });
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
  it('heads a day of a list in words (money book)', () => {
    const now = '2026-11-14T08:00:00.000Z'; // Saturday in Dubai
    expect(dayHeading('2026-11-14', 'ru', now)).toEqual({ word: 'today', text: '' });
    expect(dayHeading('2026-11-13', 'en', now)).toEqual({ word: 'yesterday', text: '' });
    expect(dayHeading('2026-11-09', 'ru', now).text).toBe('понедельник, 9 ноября');
    expect(dayHeading('2026-11-09', 'en', now).text).toBe('Monday 9 November');
    expect(dayHeading('2026-10-02', 'ru', now).text).toBe('2 октября');
    expect(dayHeading('2025-12-30', 'ru', now).text).toBe('30/12/2025');
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

describe('lazy flow: what to do with a job now', () => {
  const facts = (items: OrderItem[], p: Partial<FlowFacts> = {}): FlowFacts => ({ order: { stage: 'diagnostics', outcome: 'in_progress' }, items, invoices: [], dueFils: 0, ...p });
  const inv = { type: 'simplified_tax_invoice', status: 'issued', issuedAt: '2026-11-10T08:00:00.000Z' } as Invoice;
  it('reads the phase from the lines, the answers and the money', () => {
    expect(jobPhase(facts([]))).toBe('look');
    expect(jobPhase(facts([item({})]))).toBe('price');
    expect(jobPhase(facts([item({ approvalState: 'pending' }), item({})]))).toBe('wait');
    expect(jobPhase(facts([item({ approvalState: 'approved' })]))).toBe('work');
    // Something new found during the work: the customer has to hear it first.
    expect(jobPhase(facts([item({ approvalState: 'approved' }), item({})]))).toBe('price');
    expect(jobPhase(facts([item({ approvalState: 'approved', done: true })], { invoices: [inv], dueFils: 10500 }))).toBe('pay');
    expect(jobPhase(facts([item({ approvalState: 'approved', done: true })], { invoices: [inv], dueFils: 0 }))).toBe('out');
    expect(jobPhase(facts([item({ approvalState: 'declined' })], { order: { stage: 'ready', outcome: 'repair_declined' } }))).toBe('out');
    expect(jobPhase(facts([], { order: { stage: 'delivered', outcome: 'completed' }, dueFils: 500 }))).toBe('debt');
    expect(jobPhase(facts([], { order: { stage: 'booked', outcome: 'in_progress' } }))).toBe('booked');
    // A discount alone is not something to tell the customer or to work on.
    expect(jobPhase(facts([item({ kind: 'discount' })]))).toBe('look');
  });
  it('moves the stage forward by itself', () => {
    expect(flowStage('intake', 'look', true)).toBe('diagnostics');
    expect(flowStage('diagnostics', 'price', true)).toBeNull();
    expect(flowStage('intake', 'wait', true)).toBe('awaiting_approval');
    expect(flowStage('in_progress', 'wait', true)).toBeNull(); // a supplement during the work
    expect(flowStage('awaiting_approval', 'work', false)).toBe('awaiting_parts');
    expect(flowStage('awaiting_parts', 'work', true)).toBe('in_progress');
    expect(flowStage('in_progress', 'work', false)).toBeNull();
    expect(flowStage('ready', 'pay', true)).toBeNull();
    expect(stepToward('intake', 'in_progress')).toBe('diagnostics');
    expect(stepToward('awaiting_approval', 'in_progress')).toBe('awaiting_parts');
    expect(stepToward('awaiting_parts', 'in_progress')).toBeNull();
  });
  it('knows when there is nothing to charge for', () => {
    expect(nothingToBill([])).toBe(true);
    expect(nothingToBill([item({ approvalState: 'declined' }), item({ approvalState: 'cancelled' })])).toBe(true);
    expect(nothingToBill([item({ customerSupplied: true, kind: 'part' })])).toBe(true);
    expect(nothingToBill([item({})])).toBe(false);
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

  it('the mechanic may look at the car right after check-in (the intake act is optional)', () => {
    expect(checkTransition('intake', 'diagnostics', base()).ok).toBe(true);
  });
  it('a job with nothing to charge for can be closed without an invoice', () => {
    expect(checkTransition('diagnostics', 'closed', base()).ok).toBe(true);
    expect(checkTransition('awaiting_approval', 'closed', base({ items: [item({ approvalState: 'declined' })] })).ok).toBe(true);
    expect(checkTransition('diagnostics', 'closed', base({ items: [item({ approvalState: 'draft' })] }))).toEqual({ ok: false, reason: 'stageErr.noInvoice' });
    expect(checkTransition('in_progress', 'closed', base({ items: [item({ approvalState: 'approved' })] })).ok).toBe(false);
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
    expect(checkTransition('intake', 'closed', base({ items: [item({ approvalState: 'approved' })] })).ok).toBe(false);
    expect(checkTransition('intake', 'closed', base({ invoiced: true, amountDueFils: 100 })).ok).toBe(false);
    expect(checkTransition('intake', 'closed', base({ invoiced: true, amountDueFils: 0 })).ok).toBe(true);
    expect(checkTransition('in_progress', 'closed', base({ invoiced: true, amountDueFils: 100, debtSigned: true })).ok).toBe(true);
    expect(checkTransition('booked', 'closed', base({ invoiced: true })).ok).toBe(false);
  });
  it('closes without payment and without a debt once what is due is let go', () => {
    const waived = order({ waived: { at: '2026-11-12T10:00:00Z', fils: 10500 } });
    expect(checkTransition('in_progress', 'closed', base({ order: waived, items: [item({ approvalState: 'approved' })] })).ok).toBe(true);
    expect(checkTransition('ready', 'closed', base({ order: waived, invoiced: true, amountDueFils: 10500 })).ok).toBe(true);
    expect(checkTransition('booked', 'closed', base({ order: waived })).ok).toBe(false);
    expect(canCloseUnpaid('in_progress', 10500)).toBe(true);
    expect(canCloseUnpaid('delivered', 10500)).toBe(true);
    expect(canCloseUnpaid('ready', 0)).toBe(false);
    expect(canCloseUnpaid('booked', 10500)).toBe(false);
    expect(canCloseUnpaid('closed', 10500)).toBe(false);
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

describe('the discount on documents', () => {
  // The garage's own example: 130 + 150 + 200 + 2 × 10 + 350 AED (+ 5 % VAT = 892.50 AED), 92 AED off → 800.50 AED.
  const job = () => [
    item({ kind: 'part', titleEn: 'CONDENSER FAN (AFTER MARKET)', unitPriceFils: 13000, approvalState: 'approved' }),
    item({ kind: 'part', titleEn: 'FRONT AC FREON GAS', unitPriceFils: 15000, approvalState: 'approved' }),
    item({ kind: 'part', titleEn: 'AC CHILLER GAS', unitPriceFils: 20000, approvalState: 'approved' }),
    item({ kind: 'part', titleEn: 'AC PIPE O RING', qty: 2, unitPriceFils: 1000, approvalState: 'approved' }),
    item({ kind: 'labor', titleEn: 'LABOUR CHARGE', unitPriceFils: 35000, approvalState: 'approved' }),
  ];
  const withDiscount = (items: OrderItem[], grossOff: number, titleEn = 'Discount') => [
    ...items,
    ...splitDiscount(items, grossOff).map((p) => item({ kind: 'discount', titleEn, approvalState: 'approved', ...discountPrice(p) })),
  ];

  it('shares the discount over the lines, exact to the fils', () => {
    const lines = invoiceLines(withDiscount(job(), 9200), 'en');
    const s = spreadDiscount(lines);
    expect(s.rest).toEqual([]);
    expect(s.lines.map((l) => l.line.description)).toEqual(['CONDENSER FAN (AFTER MARKET)', 'FRONT AC FREON GAS', 'AC CHILLER GAS', 'AC PIPE O RING', 'LABOUR CHARGE']);
    // Totals of the lines as on the garage's own invoice: 122.43, 141.26, 188.35, 18.84, 329.62.
    expect(s.lines.map((l) => l.gross)).toEqual([12243, 14126, 18835, 1884, 32962]);
    expect(s.lines.map((l) => l.vat)).toEqual([583, 673, 897, 90, 1569]);
    // The discount excl. VAT, like the price: price × qty − discount + VAT = total on every line.
    expect(s.lines.map((l) => l.discount)).toEqual([1340, 1547, 2062, 206, 3607]);
    for (const l of s.lines) expect(l.line.net - l.discount + l.vat).toBe(l.gross);
    // Totals: 892.50 − 92.00 = 800.50, VAT 38.12 — the lines add up to the invoice.
    const tot = invoiceTotals(lines);
    expect([s.subtotal, s.discount, tot.totalFils, tot.vatFils]).toEqual([89250, -9200, 80050, 3812]);
    expect(s.lines.reduce((a, l) => a + l.gross, 0)).toBe(tot.totalFils);
    expect(s.lines.reduce((a, l) => a + l.vat, 0)).toBe(tot.vatFils);
    expect(s.lines.reduce((a, l) => a + l.discount, 0)).toBe(-lines.filter((l) => l.kind === 'discount').reduce((a, l) => a + l.net, 0));
  });

  it('a percentage takes exactly that share of every line, with and without VAT', () => {
    const items = [...job(), item({ kind: 'fee', titleEn: 'RECOVERY', unitPriceFils: 5000, vatRateBp: 0, approvalState: 'approved' })];
    const lines = invoiceLines(withDiscount(items, 9425, 'Discount 10%'), 'en');
    const s = spreadDiscount(lines);
    expect(s.lines.map((l) => l.discount)).toEqual([1300, 1500, 2000, 200, 3500, 500]);
    expect(s.lines.map((l) => l.gross)).toEqual([12285, 14175, 18900, 1890, 33075, 4500]);
    expect(s.lines.map((l) => l.vat)).toEqual([585, 675, 900, 90, 1575, 0]);
    expect([s.subtotal, s.discount]).toEqual([94250, -9425]);
    expect(discountPctLabel(lines.filter((l) => l.kind === 'discount').map((l) => l.description))).toBe('10%');
    expect(discountPctLabel(['Скидка 7,5 %'])).toBe('7.5%');
    expect(discountPctLabel(['Discount'])).toBeUndefined();
  });

  it('a discount with no line to sit on stays a line of its own', () => {
    const lines = invoiceLines([item({ unitPriceFils: 10000, vatRateBp: 0, approvalState: 'approved' }), item({ kind: 'discount', unitPriceFils: 952, unitGrossFils: 1000, approvalState: 'approved' })], 'en');
    const s = spreadDiscount(lines);
    expect(s.rest).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ discount: 0, gross: 10000 });
    // Older quotations keep no VAT rate: lines with VAT and without are told apart by their VAT.
    const old = spreadDiscount([
      { kind: 'labor' as const, net: 10000, vat: 500, gross: 10500 },
      { kind: 'part' as const, net: 5000, vat: 0, gross: 5000 },
      { kind: 'discount' as const, net: -1000, vat: -50, gross: -1050 },
    ]);
    expect(old.lines.map((l) => [l.discount, l.vat, l.gross])).toEqual([[1000, 450, 9450], [0, 0, 5000]]);
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
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

describe('the board order', () => {
  it('takes the latest of everything that happened on a job', async () => {
    const { lastChange } = await import('./flow');
    const order = { createdAt: '2026-11-10T08:00:00Z', updatedAt: '2026-11-10T09:00:00Z', stageChangedAt: '2026-11-10T08:30:00Z' };
    expect(lastChange({ order })).toBe('2026-11-10T09:00:00Z');
    expect(lastChange({ order, events: [{ at: '2026-11-11T07:00:00Z' }], payments: [{ receivedAt: '2026-11-10T10:00:00Z' }] })).toBe('2026-11-11T07:00:00Z');
    expect(lastChange({ order, items: [{ createdAt: '2026-11-10T08:10:00Z', doneAt: '2026-11-11T12:00:00Z' }], media: [{ createdAt: '2026-11-11T11:00:00Z' }] })).toBe('2026-11-11T12:00:00Z');
  });
});

describe('daylight in Dubai (the Auto theme)', () => {
  it('knows sunrise and sunset through the year', async () => {
    const { isDaytime, sunTimes } = await import('./daylight');
    const local = (d: Date) => new Date(d.getTime() + 4 * 3600_000).toISOString().slice(11, 16);
    const near = (got: string, want: string) => Math.abs(+got.slice(0, 2) * 60 + +got.slice(3) - (+want.slice(0, 2) * 60 + +want.slice(3))) <= 4;
    const june = sunTimes(new Date('2026-06-21T08:00:00Z'));
    expect(near(local(june.rise), '05:29')).toBe(true);
    expect(near(local(june.set), '19:13')).toBe(true);
    const dec = sunTimes(new Date('2026-12-21T08:00:00Z'));
    expect(near(local(dec.rise), '07:02')).toBe(true);
    expect(near(local(dec.set), '17:33')).toBe(true);
    // Dubai is UTC+4: 06:30 in June is day, in December still night; 18:00 the other way round.
    expect(isDaytime(new Date('2026-06-21T02:30:00Z'))).toBe(true);
    expect(isDaytime(new Date('2026-12-21T02:30:00Z'))).toBe(false);
    expect(isDaytime(new Date('2026-06-21T14:00:00Z'))).toBe(true);
    expect(isDaytime(new Date('2026-12-21T14:00:00Z'))).toBe(false);
    expect(isDaytime(new Date('2026-11-11T22:00:00Z'))).toBe(false); // 02:00 at night
    expect(isDaytime(new Date('2026-11-11T08:00:00Z'))).toBe(true); // noon
  });
});
