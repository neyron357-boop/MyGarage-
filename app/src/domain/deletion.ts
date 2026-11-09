/**
 * When a job can be deleted whole. A job that was opened by mistake (or for a try) and has nothing
 * that counts — no tax invoice, no money taken, no debt, no signed report, no estimate sent to the
 * customer, no claim, no part returned to a supplier — can go with everything in it. Anything of
 * those is a record that must stay (docs/04: invoices, payments, signed acts… are never deleted); such
 * a job is corrected instead (credit note, refund, closing).
 */
export type DeleteBlock = 'invoice' | 'payment' | 'debt' | 'signed' | 'sent' | 'claim' | 'return';

export interface DeletableJob {
  invoices: readonly unknown[];
  payments: readonly unknown[];
  debts: readonly unknown[];
  versions: readonly unknown[];
  decisions: readonly unknown[];
  inspections: readonly { locked: boolean }[];
  claims: readonly unknown[];
  supplierReturns?: readonly unknown[];
  /** A stored document of the job (a signed report's PDF and the like) is locked. */
  lockedMedia?: boolean;
}

/** Why the job cannot be deleted, or undefined when it can. */
export function whyJobStays(j: DeletableJob): DeleteBlock | undefined {
  if (j.invoices.length) return 'invoice';
  if (j.payments.length) return 'payment';
  if (j.debts.length) return 'debt';
  if (j.inspections.some((i) => i.locked) || j.lockedMedia) return 'signed';
  if (j.versions.length || j.decisions.length) return 'sent';
  if (j.claims.length) return 'claim';
  if (j.supplierReturns?.length) return 'return';
  return undefined;
}
