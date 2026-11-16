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

/** Card and transfer payments (refunds subtract); cash is in the cash box, money the owner took (`outside`) is in neither. */
export function nonCashTotals(payments: Payment[]): { card: number; transfer: number } {
  const out = { card: 0, transfer: 0 };
  for (const p of payments) {
    if (p.method === 'cash' || p.method === 'outside') continue;
    out[p.method] += p.kind === 'refund' ? -p.amountFils : p.amountFils;
  }
  return out;
}
