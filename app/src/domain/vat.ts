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

/**
 * How a typed price is counted for one line: VAT added on top of it, VAT already inside it,
 * or no VAT on this line at all (the line's rate becomes 0 — like a non-taxed item in Eaglecart).
 */
export type VatMode = 'add' | 'incl' | 'none';

/** The mode a line opens with: "no VAT" for an untaxed line, otherwise as the settings say. */
export function vatModeOf(lineRateBp: number | undefined, pricesIncludeVat: boolean): VatMode {
  if (lineRateBp === 0) return 'none';
  return pricesIncludeVat ? 'incl' : 'add';
}

/** The VAT rate of a line entered in this mode (`rateBp` is the rate of a taxed line). */
export function rateFor(mode: VatMode, rateBp: number): number {
  return mode === 'none' ? 0 : rateBp;
}

/** The amount shown in a price field for a net price. */
export function enteredFromNet(netFils: number, rateBp: number, mode: VatMode): number {
  return mode === 'incl' ? fromNet(netFils, rateBp).gross : netFils;
}

/** The net price for an amount typed in this mode. */
export function netFromEntered(enteredFils: number, rateBp: number, mode: VatMode): number {
  return mode === 'incl' ? netFromGross(enteredFils, rateBp) : enteredFils;
}

/** Another mode keeps the typed amount and counts it the new way; returns the new net price. */
export function switchVatMode(netFils: number, rateBp: number, from: VatMode, to: VatMode): number {
  return netFromEntered(enteredFromNet(netFils, rateBp, from), rateBp, to);
}

export function lineAmounts(qty: number, unitPriceFils: number, rateBp: number): Amounts {
  return fromNet(roundFils(qty * unitPriceFils), rateBp);
}

export function sumAmounts(list: Amounts[]): Amounts {
  return list.reduce((a, b) => ({ net: a.net + b.net, vat: a.vat + b.vat, gross: a.gross + b.gross }), { ...ZERO });
}
