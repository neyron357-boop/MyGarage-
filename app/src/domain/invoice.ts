import { byPosition, itemAmounts, itemTitle } from './items';
import type { Customer, Invoice, InvoiceLine, InvoiceType, Lang, Order, OrderItem, PartySnapshot, Payment, Stage } from './types';

/** The name a customer goes by on a document: a company's name, else the person's. */
export const buyerName = (c: Pick<Customer, 'type' | 'companyName' | 'name'>): string => (c.type === 'company' && c.companyName ? c.companyName : c.name);

/**
 * Whom an invoice is billed to, as shown and printed. An issued invoice never changes and keeps the buyer it
 * was issued to; what that left blank — a car taken in with no name or phone, the customer added on the job
 * after the invoice — comes from the job's customer now, and only when it is the same person (the name and
 * the phone the invoice has, if any, are theirs). The TRN is not filled in: a buyer's TRN makes a full tax
 * invoice — that is a credit note and a new invoice. Nothing to fill in: the invoice's own buyer, the same object.
 */
export function invoiceBuyer(buyer: PartySnapshot, now: Pick<Customer, 'type' | 'companyName' | 'name' | 'phone' | 'email' | 'address'> | undefined): PartySnapshot {
  if (!now) return buyer;
  const name = buyerName(now).trim();
  const had = buyer.name.trim();
  if (had && had.toLowerCase() !== name.toLowerCase()) return buyer;
  if (buyer.phone && buyer.phone !== now.phone) return buyer;
  const fill: Partial<PartySnapshot> = {};
  if (!had && name) fill.name = name;
  if (!buyer.phone && now.phone) fill.phone = now.phone;
  if (!buyer.email?.trim() && now.email?.trim()) fill.email = now.email.trim();
  if (!buyer.address?.trim() && now.address?.trim()) fill.address = now.address.trim();
  return Object.keys(fill).length ? { ...buyer, ...fill } : buyer;
}

/** Lines for an invoice: every approved item (including zero-priced customer-supplied parts), in the job's order. */
export function invoiceLines(items: OrderItem[], lang: Lang): InvoiceLine[] {
  return [...items]
    .sort(byPosition)
    .filter((i) => i.approvalState === 'approved')
    .map((i) => {
      const a = itemAmounts(i);
      return {
        description: itemTitle(i, lang),
        kind: i.kind,
        qty: i.qty,
        unit: i.unit,
        unitPriceFils: i.customerSupplied ? 0 : i.kind === 'discount' ? -Math.abs(i.unitPriceFils) : i.unitPriceFils,
        net: a.net,
        vatRateBp: i.vatRateBp,
        vat: a.vat,
        gross: a.gross,
        customerSupplied: i.customerSupplied || undefined,
      };
    });
}

export function invoiceTotals(lines: InvoiceLine[]): { subtotalFils: number; vatFils: number; totalFils: number } {
  let subtotalFils = 0;
  let vatFils = 0;
  for (const l of lines) {
    subtotalFils += l.net;
    vatFils += l.vat;
  }
  return { subtotalFils, vatFils, totalFils: subtotalFils + vatFils };
}

/** Company with a TRN gets a full Tax Invoice, everyone else a Simplified Tax Invoice. */
export function chooseInvoiceType(customer: Pick<Customer, 'type' | 'trn'>): Exclude<InvoiceType, 'credit_note'> {
  return customer.type === 'company' && customer.trn ? 'tax_invoice' : 'simplified_tax_invoice';
}

/** Money received from the customer minus refunds. */
export function paidNet(payments: Payment[]): number {
  let sum = 0;
  for (const p of payments) sum += p.kind === 'refund' ? -p.amountFils : p.amountFils;
  return sum;
}

/**
 * When a job's invoice was paid in full (v0.38: the PAID stamp on it) — its payments cover it, or the customer paid the
 * garage's owner (closed «Оплата у главного»): the moment the last payment came (or the job was closed so). Never a
 * credit note, an invoice another replaced (its payments count for the new one), a job closed without payment.
 */
export function invoicePaidAt(inv: Invoice, invoices: Invoice[], payments: Payment[], order: Pick<Order, 'waived'>): string | undefined {
  if (inv.type === 'credit_note' || inv.status !== 'issued' || inv.totalFils <= 0) return undefined;
  if (activeInvoice(invoices)?.id !== inv.id) return undefined;
  if (order.waived?.via === 'owner') return order.waived.at;
  if (amountDue(0, invoices, payments) > 0) return undefined;
  return payments.filter((p) => p.kind !== 'refund').map((p) => p.receivedAt).sort().at(-1) ?? inv.issuedAt;
}

/** The invoice that currently counts for an order (issued and not credited). */
export function activeInvoice(invoices: Invoice[]): Invoice | undefined {
  return invoices
    .filter((i) => i.type !== 'credit_note' && i.status === 'issued')
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
}

/**
 * An issued invoice can still be changed — cancelled by a credit note, the lines changed, a new invoice
 * issued — while the job is open: the car in the garage, or gone on credit (v0.34, the user's call — a signed
 * debt does not freeze the lines: its paper stays as signed, what is owed follows the new invoice). Not once
 * the job is closed.
 */
export function canAmendInvoice(stage: Stage, invoices: Invoice[]): boolean {
  return !!activeInvoice(invoices) && !['booked', 'closed', 'cancelled'].includes(stage);
}

/** Amount still due: active invoice total (or approved total before invoicing) minus what was paid. */
export function amountDue(approvedGross: number, invoices: Invoice[], payments: Payment[]): number {
  const inv = activeInvoice(invoices);
  const base = inv ? inv.totalFils : approvedGross;
  return base - paidNet(payments);
}

export function formatDocNumber(prefix: string, year: number, value: number): string {
  return `${prefix}-${year}-${String(value).padStart(5, '0')}`;
}
