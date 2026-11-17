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

/**
 * Everything the job holds that a plain deletion must not take (v0.38: the sheet lists them all, and the manager may
 * still delete the job with them, confirmed — `deleteJob(id, { withRecords: true })`).
 */
export function whatJobHolds(j: DeletableJob): DeleteBlock[] {
  const out: DeleteBlock[] = [];
  if (j.invoices.length) out.push('invoice');
  if (j.payments.length) out.push('payment');
  if (j.debts.length) out.push('debt');
  if (j.inspections.some((i) => i.locked) || j.lockedMedia) out.push('signed');
  if (j.versions.length || j.decisions.length) out.push('sent');
  if (j.claims.length) out.push('claim');
  if (j.supplierReturns?.length) out.push('return');
  return out;
}

/** Why the job cannot be deleted plainly, or undefined when it can. */
export function whyJobStays(j: DeletableJob): DeleteBlock | undefined {
  return whatJobHolds(j)[0];
}
