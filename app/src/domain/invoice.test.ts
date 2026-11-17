import { describe, expect, it } from 'vitest';
import { invoicePaidAt } from './invoice';
import type { Invoice, Payment } from './types';

const party = { name: 'X' };
const invoice = (id: string, totalFils: number, extra: Partial<Invoice> = {}): Invoice => ({
  id,
  number: `INV-${id}`,
  type: 'tax_invoice',
  orderId: 'o',
  issuedAt: '2026-11-10T08:00:00.000Z',
  seller: party,
  buyer: party,
  lines: [],
  subtotalFils: totalFils,
  vatFils: 0,
  totalFils,
  currency: 'AED',
  status: 'issued',
  ...extra,
});
const pay = (amountFils: number, receivedAt: string, kind: Payment['kind'] = 'payment'): Payment => ({ id: receivedAt, orderId: 'o', customerId: 'c', kind, method: 'cash', amountFils, receivedAt }) as Payment;

describe('an invoice paid in full (v0.38: the PAID stamp)', () => {
  it('is paid when its payments cover it — on the day the last came; not while anything is left', () => {
    const inv = invoice('1', 10_000);
    expect(invoicePaidAt(inv, [inv], [pay(4_000, '2026-11-11T08:00:00.000Z')], {})).toBeUndefined();
    expect(invoicePaidAt(inv, [inv], [pay(4_000, '2026-11-11T08:00:00.000Z'), pay(6_000, '2026-11-12T08:00:00.000Z')], {})).toBe('2026-11-12T08:00:00.000Z');
    // A refund takes it back below the total.
    expect(invoicePaidAt(inv, [inv], [pay(10_000, '2026-11-11T08:00:00.000Z'), pay(1_000, '2026-11-12T08:00:00.000Z', 'refund')], {})).toBeUndefined();
  });

  it('paid to the owner counts; closed without payment does not', () => {
    const inv = invoice('1', 10_000);
    expect(invoicePaidAt(inv, [inv], [], { waived: { at: '2026-11-13T08:00:00.000Z', fils: 10_000, via: 'owner' } })).toBe('2026-11-13T08:00:00.000Z');
    expect(invoicePaidAt(inv, [inv], [], { waived: { at: '2026-11-13T08:00:00.000Z', fils: 10_000 } })).toBeUndefined();
  });

  it('is never a credit note, nor an invoice a later one replaced (its payments are the new one’s)', () => {
    const old = invoice('1', 10_000, { status: 'credited' });
    const credit = invoice('2', 10_000, { type: 'credit_note', originalInvoiceId: '1', issuedAt: '2026-11-11T08:00:00.000Z' });
    const next = invoice('3', 12_000, { issuedAt: '2026-11-11T09:00:00.000Z' });
    const all = [old, credit, next];
    const paid = [pay(12_000, '2026-11-12T08:00:00.000Z')];
    expect(invoicePaidAt(old, all, paid, {})).toBeUndefined();
    expect(invoicePaidAt(credit, all, paid, {})).toBeUndefined();
    expect(invoicePaidAt(next, all, paid, {})).toBe('2026-11-12T08:00:00.000Z');
  });
});
