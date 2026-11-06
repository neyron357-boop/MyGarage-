import type { CashMovement, Payment } from './types';

export function cashTotals(movements: CashMovement[]): { inFils: number; outFils: number } {
  let inFils = 0;
  let outFils = 0;
  for (const m of movements) {
    if (m.direction === 'in') inFils += m.amountFils;
    else outFils += m.amountFils;
  }
  return { inFils, outFils };
}

export function expectedCash(openingFils: number, movements: CashMovement[]): number {
  const t = cashTotals(movements);
  return openingFils + t.inFils - t.outFils;
}

/** Non-cash payments by method (refunds subtract). */
export function nonCashTotals(payments: Payment[]): { card: number; transfer: number } {
  const out = { card: 0, transfer: 0 };
  for (const p of payments) {
    if (p.method === 'cash') continue;
    out[p.method] += p.kind === 'refund' ? -p.amountFils : p.amountFils;
  }
  return out;
}
