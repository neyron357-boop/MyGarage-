import { describe, expect, it } from 'vitest';
import { rowsOf } from './docImport';
import { invoiceProblems, lineVat, matchSummary, monthTable, pageKind, plateKey, plateNear, readDocument, readInvoiceA, readSummary, tableDiff } from './historyInvoices';
import type { TextItem } from './obdReport';

/*
 * Invoices from before this app read off their PDFs (v0.45). Made-up documents in the two templates and a summary —
 * no customer's real ones here.
 */

/** A page's text: each row its pieces at their x, top to bottom. */
function page(n: number, rows: [number, string][][]): TextItem[] {
  return rows.flatMap((row, i) => row.map(([x, str]) => ({ page: n, x, y: 800 - i * 14, str, w: str.length * 5 })));
}

const invoiceA = (n: number) =>
  page(n, [
    [[400, 'INVOICE']],
    [[400, '# 301']],
    [[40, 'RUKN TEST GARAGE'], [400, 'Date:'], [460, 'Mar 4, 2026']],
    [[40, 'Bill To:']],
    [[40, 'ACME CONTRACTING L.L.C.']],
    [[40, 'TOYOTA HILLUX']],
    [[40, 'PLATE NO.EE 12345']],
    [[40, 'Item'], [300, 'Quantity'], [380, 'Rate'], [470, 'Amount']],
    [[40, 'CHANGE OIL & FILTER'], [300, '1'], [380, 'AED 220.00'], [470, 'AED 220.00']],
    [[40, '(10K KILOMETERS)']],
    [[40, 'BRAKE CLEANING'], [300, '3'], [380, 'AED 50.10'], [470, 'AED 150.30']],
    [[380, 'Subtotal:'], [470, 'AED 370.30']],
    [[380, 'Tax (5%):'], [470, 'AED 18.52']],
    [[380, 'Total:'], [470, 'AED 388.82']],
  ]);

const summary = page(1, [
  [[200, 'COMPANY INVOICE SUMMARY']],
  [[40, 'DATE'], [120, 'CAR NAME'], [260, 'PLATE NO.'], [360, 'INVOICE NO.'], [460, 'AMOUNT']],
  [[40, '4-Mar-26'], [120, 'TOYOTA HILLUX'], [260, 'EE-12346'], [360, '301'], [460, '388.82']],
  [[40, '9-Mar-26'], [120, 'NISSAN URVAN'], [260, 'H-50505'], [460, '120.00']],
  [[360, 'TOTAL'], [460, '508.82']],
]);

describe('invoices from before the app, read off their PDFs (v0.45)', () => {
  it('a plate as code-number, whatever its spaces and strokes; a typing slip is near, two are not', () => {
    expect(plateKey('EE 54321')).toBe('EE-54321');
    expect(plateKey('14/12345')).toBe('14-12345');
    expect(plateKey('B - 12345')).toBe('B-12345');
    expect(plateKey('PLATE NO.EE-12345')).toBe('EE-12345');
    expect(plateKey('EE54321')).toBe('EE-54321');
    expect(plateKey('AD1 2345')).toBe(plateKey('AD1 - 2345'));
    expect(plateKey('-43364')).toBe('43364');
    expect(plateNear('EE-40415', 'EE-40414')).toBe(true);
    expect(plateNear('EE-40450', 'EE-40540')).toBe(true);
    expect(plateNear('2-11223', 'Z-11223')).toBe(true);
    expect(plateNear('H-10257', 'H-10265')).toBe(false);
  });

  it('a line’s VAT is ROUND(net × rate), half away from zero', () => {
    expect(lineVat(37000, 500)).toBe(1850);
    expect(lineVat(1010, 500)).toBe(51);
    expect(lineVat(-1010, 500)).toBe(-51);
    expect(lineVat(15030, 500)).toBe(752);
  });

  it('the old template: number, day, car, plate as printed; a wrapped name glued to its line; VAT a line; the sums checked', () => {
    const inv = readInvoiceA(rowsOf(invoiceA(2)), 500)!;
    expect(inv).toMatchObject({ template: 'A', numberKind: 'invoice', number: '301', date: '2026-03-04', plateRaw: 'PLATE NO.EE 12345', plate: 'EE-12345', vehicleText: 'TOYOTA HILLUX' });
    expect(inv.lines).toEqual([
      { description: 'CHANGE OIL & FILTER (10K KILOMETERS)', qty: 1, unitNetFils: 22000, netFils: 22000, vatFils: 1100, grossFils: 23100 },
      { description: 'BRAKE CLEANING', qty: 3, unitNetFils: 5010, netFils: 15030, vatFils: 752, grossFils: 15782 },
    ]);
    expect(invoiceProblems(inv, 500)).toEqual([]);
    // A total that the lines do not make is told.
    expect(invoiceProblems({ ...inv, printed: { ...inv.printed, total: 38883 } }, 500)).toEqual(['Invoice 301 (2026-03-04): the lines add up to 388.82, the total printed is 388.83']);
  });

  it('a summary by its head row’s columns; its rows matched with the invoices — a plate typo, a missing document', () => {
    const s = readSummary([rowsOf(summary)])!;
    expect(s.totalFils).toBe(50882);
    expect(s.rows.map((r) => [r.date, r.plate, r.invoiceNo, r.amountFils])).toEqual([
      ['2026-03-04', 'EE-12346', '301', 38882],
      ['2026-03-09', 'H-50505', undefined, 12000],
    ]);
    const inv = readInvoiceA(rowsOf(invoiceA(2)), 500)!;
    const { matches, unlisted } = matchSummary(s.rows, [inv]);
    expect(matches.map((m) => m.status)).toEqual(['plate', 'missing']);
    expect(unlisted).toEqual([]);
  });

  it('a whole PDF: summary, invoices, an invoice’s terms page; the month table and its difference from the expected one', () => {
    const terms = page(3, [[[40, 'Terms:']], [[40, 'Payment can be made through cash']]]);
    const doc = readDocument([...summary, ...invoiceA(2), ...terms], 4, 500);
    expect(doc.kinds).toEqual({ summary: 1, A: 1, continuation: 1, empty: 1 });
    expect(doc.problems).toEqual([]);
    expect(doc.invoices[0].pages).toBe(2);
    expect(pageKind(rowsOf(terms))).toBe('continuation');
    const table = monthTable(doc.invoices);
    expect(table).toEqual([
      { month: '2026-03', invoices: 1, lines: 2, netFils: 37030, vatFils: 1852, totalFils: 38882 },
      { month: 'all', invoices: 1, lines: 2, netFils: 37030, vatFils: 1852, totalFils: 38882 },
    ]);
    expect(tableDiff(table, table)).toEqual([]);
    expect(tableDiff(table, [{ ...table[0], totalFils: 38883 }, table[1]])).toEqual(['2026-03 totalFils: 388.82 ≠ 388.83']);
  });
});
