import { roundFils } from './money';

export interface Amounts {
  net: number;
  vat: number;
  gross: number;
}

export const ZERO: Amounts = { net: 0, vat: 0, gross: 0 };

/** VAT for a net amount, rounded per line to the nearest fils. */
export function vatOf(netFils: number, rateBp: number): number {
  return roundFils((netFils * rateBp) / 10000);
}

export function fromNet(netFils: number, rateBp: number): Amounts {
  const vat = vatOf(netFils, rateBp);
  return { net: netFils, vat, gross: netFils + vat };
}

/** Net amount contained in a VAT-inclusive gross amount. */
export function netFromGross(grossFils: number, rateBp: number): number {
  return roundFils((grossFils * 10000) / (10000 + rateBp));
}

export function lineAmounts(qty: number, unitPriceFils: number, rateBp: number): Amounts {
  return fromNet(roundFils(qty * unitPriceFils), rateBp);
}

export function sumAmounts(list: Amounts[]): Amounts {
  return list.reduce((a, b) => ({ net: a.net + b.net, vat: a.vat + b.vat, gross: a.gross + b.gross }), { ...ZERO });
}
