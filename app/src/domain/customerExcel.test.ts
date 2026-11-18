import { describe, expect, it } from 'vitest';
import { checkWorkbook, customerWorkbook, periodText } from './customerExcel';
import { mergeCatalog } from './serviceCatalog';
import { OTHER, serviceReport, type ReportInvoice, type ReportLine } from './serviceReport';
import type { HistoryInvoice, HistorySummaryRow } from './types';
import { unzip } from './zip';

/*
 * A customer's service report (v0.46): the figures by month, category, service and car are the invoices' own — the
 * summary's sum is the sum of the invoices; the workbook carries them as values and as formulas (SUBTOTAL, SUMIFS) with
 * those values; the garage's check shows where the summaries typed by hand differ. Made-up invoices.
 */

const line = (description: string, qty: number, unit: number): ReportLine => {
  const net = qty * unit;
  const vat = Math.round(net * 0.05);
  return { description, qty, unitNetFils: unit, netFils: net, vatFils: vat, grossFils: net + vat };
};
const invoice = (number: string, date: string, plate: string, lines: ReportLine[]): ReportInvoice => ({
  number,
  date,
  plate,
  vehicle: plate.startsWith('EE') ? 'Toyota HiLux' : 'Nissan Urvan',
  type: plate.startsWith('EE') ? 'pickup' : 'van',
  netFils: lines.reduce((a, l) => a + l.netFils, 0),
  vatFils: lines.reduce((a, l) => a + l.vatFils, 0),
  totalFils: lines.reduce((a, l) => a + l.grossFils, 0),
  lines,
});

const INVOICES = [
  invoice('204', '2026-05-02', 'EE-11111', [line('CHANGE OIL / FILTER', 1, 18000), line('LABOUR CHARGES', 1, 10000)]),
  invoice('71', '2026-07-03', 'EE-11111', [line('CHANGE OIL & FILTER (10K KILOMETERS)', 1, 18000), line('SUV CAR WASH', 1, 5000)]),
  invoice('72', '2026-07-09', 'W-22222', [line('OIL CHANGE 10K KM', 1, 20000), line('TIRE YOKOHAMA 2026', 4, 45000), line('MAGIC SMOKE REMOVAL', 1, 3333)]),
];
const catalog = mergeCatalog({ categories: [], services: [], map: [] });

async function sheets(bytes: Uint8Array): Promise<Map<string, string>> {
  const files = await unzip(bytes);
  const out = new Map<string, string>();
  for (const [name, data] of files) out.set(name, new TextDecoder().decode(data));
  return out;
}

describe('a customer’s service report (v0.46)', () => {
  it('the figures are the invoices’: by month, service, car — the summary’s sum is the sum of the invoices', () => {
    const r = serviceReport(INVOICES, catalog);
    const total = INVOICES.reduce((a, i) => a + i.totalFils, 0);
    expect(r.totals).toEqual({ invoices: 3, lines: 7, vehicles: 2, netFils: 254333, vatFils: 12717, totalFils: total });
    expect(r.months.map((m) => [m.month, m.invoices, m.vehicles])).toEqual([
      ['2026-05', 1, 1],
      ['2026-07', 2, 2],
    ]);
    expect(r.months.reduce((a, m) => a + m.totalFils, 0)).toBe(total);
    expect(r.categories.reduce((a, c) => a + c.totalFils, 0)).toBe(total);
    expect(r.services.reduce((a, s) => a + s.totalFils, 0)).toBe(total);
    // Three oil changes on two cars, the most done first.
    expect(r.services[0]).toMatchObject({ name: 'Oil change (engine oil + filter)', category: 'Oil & filters', times: 3, vehicles: 2, qty: 3 });
    expect(r.services.find((s) => s.name === 'Tyres')).toMatchObject({ times: 1, qty: 4, netFils: 180000 });
    // A line no service fits: «Other» here, and asked about.
    expect(r.services.find((s) => s.name === OTHER)).toMatchObject({ category: OTHER, times: 1 });
    expect(r.unmapped).toEqual([{ description: 'MAGIC SMOKE REMOVAL', lines: 1 }]);
    // Cars by what was spent on them; the oil changes and the last one.
    expect(r.vehicles.map((v) => [v.plate, v.visits, v.first, v.last, v.oilChanges, v.lastOil, v.type])).toEqual([
      ['W-22222', 1, '2026-07-09', '2026-07-09', 1, '2026-07-09', 'van'],
      ['EE-11111', 2, '2026-05-02', '2026-07-03', 2, '2026-07-03', 'pickup'],
    ]);
  });

  it('the period in words', () => {
    expect(periodText('2026-10-01', '2026-10-31')).toBe('October 2026');
    expect(periodText('2026-05-01', '2026-10-31')).toBe('May – Oct 2026');
    expect(periodText('2025-12-01', '2026-01-31')).toBe('Dec 2025 – Jan 2026');
    expect(periodText('2026-05-03', '2026-10-15')).toBe('3 May 2026 – 15 Oct 2026');
  });

  it('the workbook: five sheets; totals as SUBTOTAL formulas with their values; a frozen head row, filters, no grid; two charts', async () => {
    const r = serviceReport(INVOICES, catalog);
    const files = await sheets(customerWorkbook(r, { customer: 'ACME CONTRACTING LLC', garage: 'TEST GARAGE LLC', from: '2026-05-01', to: '2026-07-31', vatRateBp: 500, made: '2026-11-18' }));
    const book = files.get('xl/workbook.xml')!;
    expect([...book.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(['Overview', 'Invoices', 'Work Details', 'Services', 'Vehicles']);
    expect(book).toContain('fullCalcOnLoad="1"');
    const strings = [...files.get('xl/sharedStrings.xml')!.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]);
    const invoices = files.get('xl/worksheets/sheet2.xml')!;
    // The TOTAL row (row 5): the count and the sums, each a SUBTOTAL that a filter counts again.
    const total = INVOICES.reduce((a, i) => a + i.totalFils, 0) / 100;
    expect(invoices).toContain(`<c r="I5" s="`);
    expect(invoices).toMatch(new RegExp(`<c r="I5" s="\\d+"><f>SUBTOTAL\\(109,I2:I4\\)</f><v>${total}</v></c>`));
    expect(invoices).toMatch(/<c r="D5" s="\d+"><f>SUBTOTAL\(103,D2:D4\)<\/f><v>3<\/v><\/c>/);
    expect(invoices).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(invoices).toContain('<autoFilter ref="A1:I4"/>');
    expect(invoices).toContain('showGridLines="0"');
    // Head words and what is in the cells: no ids, files or checks.
    for (const w of ['No.', 'Month', 'Date', 'Invoice No.', 'Plate No.', 'Vehicle', 'Amount excl. VAT', 'VAT 5%', 'Total', 'Work / part', 'Service', 'Category', 'Times done', 'Average price excl. VAT', 'Share of spend', 'Visits', 'First visit', 'Last visit', 'Total spent', 'Average per visit', 'Oil changes', 'Last oil change', 'Pickup', 'Van / Minibus', 'TOTAL'])
      expect(strings).toContain(w);
    expect(strings.some((s) => /\.pdf$|^(File|Page|Flags|Lines check)$/i.test(s))).toBe(false);
    // The services: counted by COUNTIFS over the Work Details, with their values.
    expect(files.get('xl/worksheets/sheet4.xml')).toMatch(/<c r="D2" s="\d+"><f>COUNTIFS\('Work Details'!\$F\$2:\$F\$8,B2\)<\/f><v>3<\/v><\/c>/);
    // The styles: Arial, a navy head row, sums #,##0.00, days dd mmm yyyy.
    const styles = files.get('xl/styles.xml')!;
    expect(styles).toContain('<name val="Arial"/>');
    expect(styles).toContain('<fgColor rgb="FF1F3864"/>');
    expect(styles).toContain('formatCode="dd mmm yyyy"');
    expect(styles).toContain('numFmtId="4"');
    // The Overview's two charts over its tables.
    expect(files.get('xl/charts/chart1.xml')).toContain("<c:f>Overview!$F$10:$F$11</c:f>");
    expect(files.get('xl/charts/chart2.xml')).toContain('<c:barDir val="bar"/>');
    expect(files.get('[Content_Types].xml')).toContain('/xl/charts/chart2.xml');
  });

  it('the garage’s check: the months against their summaries, each row with its invoice and how it differs', async () => {
    const hist = (id: string, date: string, number: string, plate: string, totalFils: number): HistoryInvoice => ({
      id,
      customerId: 'c',
      vehicleId: `car-${plate}`,
      template: 'B',
      numberKind: 'job',
      number,
      date,
      plateRaw: plate,
      plate,
      vehicleText: 'Toyota HiLux',
      lines: [{ description: 'CHANGE OIL', qty: 1, unitNetFils: totalFils - Math.round(totalFils / 21), netFils: totalFils - Math.round(totalFils / 21), vatFils: Math.round(totalFils / 21), grossFils: totalFils }],
      netFils: totalFils - Math.round(totalFils / 21),
      vatFils: Math.round(totalFils / 21),
      totalFils,
      source: { file: 'July.pdf', sha256: 'x', page: 2 },
      importedAt: '',
    });
    const row = (no: number, amountFils: number, status: HistorySummaryRow['status'], invoiceId?: string): HistorySummaryRow => ({
      id: `r${no}`,
      customerId: 'c',
      month: '2026-07',
      kind: 'row',
      no,
      date: '2026-07-03',
      vehicleText: 'TOYOTA HILUX',
      plateRaw: 'EE 11111',
      plate: 'EE-11111',
      amountFils,
      ...(invoiceId ? { invoiceId } : {}),
      status,
      source: { file: 'July.pdf', sha256: 'x', page: 1 },
      importedAt: '',
    });
    const files = await sheets(
      checkWorkbook({
        customer: 'ACME CONTRACTING LLC',
        from: '2026-07-01',
        to: '2026-07-31',
        invoices: [hist('a', '2026-07-03', '41', 'EE-11111', 43200)],
        rows: [row(1, 43208, 'amount', 'a'), row(2, 25000, 'missing'), { ...row(0, 68208, 'total'), kind: 'total', no: 0 }],
        jobNumber: () => '41',
        carPlate: () => 'EE-11111',
      }),
    );
    expect([...files.get('xl/workbook.xml')!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(['Months', 'Summary rows', 'Invoices', 'Flags']);
    const strings = [...files.get('xl/sharedStrings.xml')!.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]);
    for (const w of ['Another amount', 'No document', 'Job ID 41', 'July 2026', 'July.pdf']) expect(strings).toContain(w);
    // July: the summary's rows are 250.08 more than the invoice — 250.00 without a document, 0.08 a typo.
    expect(files.get('xl/worksheets/sheet1.xml')).toMatch(/<c r="J2" s="\d+"><v>250.08<\/v><\/c>/);
  });
});
