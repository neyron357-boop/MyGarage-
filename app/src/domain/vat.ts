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
 * Amounts of a VAT-inclusive gross: the gross stays exactly as it is and its VAT is taken out of it
 * (250.00 with 5 % → 238.10 + 11.90). Counting VAT on top of a rounded net instead can miss the
 * typed total by a fils (238.10 + 11.91 = 250.01).
 */
export function fromGross(grossFils: number, rateBp: number): Amounts {
  const net = netFromGross(grossFils, rateBp);
  return { net, vat: grossFils - net, gross: grossFils };
}

/**
 * How a typed price is counted for one line: VAT added on top of it, VAT already inside it,
 * or no VAT on this line at all (the line's rate becomes 0 — like a non-taxed item in Eaglecart).
 */
export type VatMode = 'add' | 'incl' | 'none';

/** A line's price as stored: the net unit price, and the VAT-inclusive one when it was typed with VAT. */
export interface LinePrice {
  unitPriceFils: number;
  unitGrossFils?: number;
}

/**
 * The mode a line opens with: "no VAT" for an untaxed line, "VAT in the price" for a price typed
 * with VAT, otherwise as the settings say.
 */
export function vatModeOf(line: { vatRateBp?: number; unitGrossFils?: number } | undefined, pricesIncludeVat: boolean): VatMode {
  if (line?.vatRateBp === 0) return 'none';
  if (line?.unitGrossFils !== undefined) return 'incl';
  return pricesIncludeVat ? 'incl' : 'add';
}

/** The amount a price field shows for a stored line price in this mode. */
export function enteredPrice(line: LinePrice, rateBp: number, mode: VatMode): number {
  if (mode !== 'incl') return line.unitPriceFils;
  return line.unitGrossFils ?? fromNet(line.unitPriceFils, rateBp).gross;
}

/** The line price to store for an amount typed in this mode ("VAT in the price" keeps the typed gross). */
export function priceFromEntered(enteredFils: number, rateBp: number, mode: VatMode): LinePrice {
  if (mode === 'incl' && rateBp > 0) return { unitPriceFils: netFromGross(enteredFils, rateBp), unitGrossFils: enteredFils };
  return { unitPriceFils: enteredFils, unitGrossFils: undefined };
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
