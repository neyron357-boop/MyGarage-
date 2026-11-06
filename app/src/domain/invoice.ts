import { itemAmounts, itemTitle } from './items';
import type { Customer, Invoice, InvoiceLine, InvoiceType, Lang, OrderItem, Payment } from './types';

/** Lines for an invoice: every approved item (including zero-priced customer-supplied parts). */
export function invoiceLines(items: OrderItem[], lang: Lang): InvoiceLine[] {
  return items
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

/** The invoice that currently counts for an order (issued and not credited). */
export function activeInvoice(invoices: Invoice[]): Invoice | undefined {
  return invoices
    .filter((i) => i.type !== 'credit_note' && i.status === 'issued')
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
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
