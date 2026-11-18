import type { ServiceReport } from './serviceReport';
import type { HistoryInvoice, HistorySummaryRow } from './types';
import { VEHICLE_TYPE_EN } from './vehicleType';
import { buildWorkbook, colName, daySerial, sheetRef, type XCell, type XSheet, type XStyle } from './xlsx';

/*
 * The customer's service report as an Excel workbook (v0.46) — read by the customer, not the garage: five sheets
 * (Overview · Invoices · Work Details · Services · Vehicles), no ids, checks, files or helper columns. Arial, a navy head
 * row with white words, every other row light, no grid, sums #,##0.00, days dd mmm yyyy, the head row frozen, filters,
 * the TOTAL row bold — its sums SUBTOTAL formulas (a filter counts them again), the figures of the Overview SUMIFS and
 * COUNTIFS over the sheets (each with its value worked out here). English. The garage's own check of the invoices against
 * the monthly summaries typed by hand is a workbook apart (`checkWorkbook`), never given to the customer. Pure.
 */

const NAVY = '1F3864';
const ZEBRA = 'EEF2F8';
const TILE = 'E8EDF5';
const GREY = '5F6B7A';
const MONEY = '#,##0.00';
const DAY = 'dd mmm yyyy';

const HEAD: XStyle = { bold: true, color: 'FFFFFF', fill: NAVY, valign: 'center', wrap: true };
const aed = (fils: number) => fils / 100;

export interface ReportMeta {
  customer: string;
  garage: string;
  from: string;
  to: string;
  vatRateBp: number;
  /** The day the report is made, YYYY-MM-DD. */
  made: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = (d: string, withYear = true) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1].slice(0, 3)}${withYear ? ` ${d.slice(0, 4)}` : ''}`;
const lastDay = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();

/** "October 2026"; "May – Oct 2026" (whole months); "3 May 2026 – 15 Oct 2026". */
export function periodText(from: string, to: string): string {
  const whole = from.endsWith('-01') && +to.slice(8, 10) === lastDay(to.slice(0, 7));
  if (whole && from.slice(0, 7) === to.slice(0, 7)) return `${MONTHS[+from.slice(5, 7) - 1]} ${from.slice(0, 4)}`;
  const mon = (d: string) => MONTHS[+d.slice(5, 7) - 1].slice(0, 3);
  if (whole) return from.slice(0, 4) === to.slice(0, 4) ? `${mon(from)} – ${mon(to)} ${to.slice(0, 4)}` : `${mon(from)} ${from.slice(0, 4)} – ${mon(to)} ${to.slice(0, 4)}`;
  return `${day(from)} – ${day(to)}`;
}

/** Every other row of a list is light (i — the row's place in the list, from 0). */
const z = (i: number, s: XStyle = {}): XStyle => (i % 2 ? { ...s, fill: ZEBRA } : s);
const TOTAL: XStyle = { bold: true, top: NAVY };
/** A name a formula can look for as it is (no wildcards, not read as a comparison). */
const plain = (s: string) => !/[*?~]/.test(s) && !/^[=<>]/.test(s);
const quoted = (s: string) => `"${s.replace(/"/g, '""')}"`;

const ALIGN = { l: 'left', c: 'center', r: 'right' } as const;
/** The head row; `align` — a letter a column (l · c · r), standing as its figures do. */
function head(titles: string[], align = ''): XCell[] {
  return titles.map((v, i) => ({ v, s: { ...HEAD, align: ALIGN[(align[i] ?? 'l') as keyof typeof ALIGN] } }));
}

export function customerWorkbook(r: ServiceReport, meta: ReportMeta): Uint8Array {
  const vat = `VAT ${meta.vatRateBp / 100}%`;
  const nInv = r.invoices.length;
  const nWork = r.work.length;
  const invLast = nInv + 1;
  const workLast = nWork + 1;
  const vehLast = r.vehicles.length + 1;
  const INV = sheetRef('Invoices');
  const WD = sheetRef('Work Details');
  const VEH = sheetRef('Vehicles');
  const wd = (col: string) => `${WD}!$${col}$2:$${col}$${workLast}`;
  const iv = (col: string) => `${INV}!$${col}$2:$${col}$${invLast}`;

  /* ---- Invoices ---- */
  const invoices: XSheet = {
    name: 'Invoices',
    cols: [7.5, 11, 13, 12, 12, 30, 17, 12, 14],
    freeze: 1,
    filter: `A1:I${invLast}`,
    printRows: '$1:$1',
    landscape: true,
    textNumbers: `D2:D${invLast}`,
    heights: { 1: 22 },
    rows: [
      head(['No.', 'Month', 'Date', 'Invoice No.', 'Plate No.', 'Vehicle', 'Amount excl. VAT', vat, 'Total'], 'clllllrrr'),
      ...r.invoices.map((inv, i) => [
        { v: i + 1, s: z(i, { align: 'center' }) },
        { date: `${inv.date.slice(0, 7)}-01`, s: z(i, { fmt: 'mmm yyyy', align: 'left' }) },
        { date: inv.date, s: z(i, { fmt: DAY, align: 'left' }) },
        { v: inv.number, s: z(i, { align: 'left' }) },
        { v: inv.plate, s: z(i) },
        { v: inv.vehicle, s: z(i) },
        { v: aed(inv.netFils), s: z(i, { fmt: MONEY }) },
        { v: aed(inv.vatFils), s: z(i, { fmt: MONEY }) },
        { v: aed(inv.totalFils), s: z(i, { fmt: MONEY }) },
      ]),
      [
        { v: 'TOTAL', s: TOTAL },
        { s: TOTAL },
        { s: TOTAL },
        { f: `SUBTOTAL(103,D2:D${invLast})`, v: nInv, s: { ...TOTAL, fmt: '0 "invoices"', align: 'left' } },
        { s: TOTAL },
        { s: TOTAL },
        { f: `SUBTOTAL(109,G2:G${invLast})`, v: aed(r.totals.netFils), s: { ...TOTAL, fmt: MONEY } },
        { f: `SUBTOTAL(109,H2:H${invLast})`, v: aed(r.totals.vatFils), s: { ...TOTAL, fmt: MONEY } },
        { f: `SUBTOTAL(109,I2:I${invLast})`, v: aed(r.totals.totalFils), s: { ...TOTAL, fmt: MONEY } },
      ],
    ],
  };

  /* ---- Work Details ---- */
  const qtySum = r.work.reduce((a, w) => a + w.qty, 0);
  const work: XSheet = {
    name: 'Work Details',
    cols: [13, 11, 12, 24, 44, 32, 22, 7, 12, 16, 11, 13],
    freeze: 1,
    filter: `A1:L${workLast}`,
    printRows: '$1:$1',
    landscape: true,
    textNumbers: `B2:B${workLast}`,
    heights: { 1: 22 },
    rows: [
      head(['Date', 'Invoice No.', 'Plate No.', 'Vehicle', 'Work / part', 'Service', 'Category', 'Qty', 'Unit price', 'Amount excl. VAT', vat, 'Total'], 'lllllllcrrrr'),
      ...r.work.map((w, i) => [
        { date: w.invoice.date, s: z(i, { fmt: DAY, align: 'left' }) },
        { v: w.invoice.number, s: z(i, { align: 'left' }) },
        { v: w.invoice.plate, s: z(i) },
        { v: w.invoice.vehicle, s: z(i) },
        { v: w.description, s: z(i) },
        { v: w.service, s: z(i) },
        { v: w.category, s: z(i) },
        { v: w.qty, s: z(i, { align: 'center' }) },
        { v: aed(w.unitNetFils), s: z(i, { fmt: MONEY }) },
        { v: aed(w.netFils), s: z(i, { fmt: MONEY }) },
        { v: aed(w.vatFils), s: z(i, { fmt: MONEY }) },
        { v: aed(w.grossFils), s: z(i, { fmt: MONEY }) },
      ]),
      [
        { v: 'TOTAL', s: TOTAL },
        { s: TOTAL },
        { s: TOTAL },
        { s: TOTAL },
        { f: `SUBTOTAL(103,E2:E${workLast})`, v: nWork, s: { ...TOTAL, fmt: '0 "lines"', align: 'left' } },
        { s: TOTAL },
        { s: TOTAL },
        { f: `SUBTOTAL(109,H2:H${workLast})`, v: qtySum, s: { ...TOTAL, align: 'center' } },
        { s: TOTAL },
        { f: `SUBTOTAL(109,J2:J${workLast})`, v: aed(r.work.reduce((a, w) => a + w.netFils, 0)), s: { ...TOTAL, fmt: MONEY } },
        { f: `SUBTOTAL(109,K2:K${workLast})`, v: aed(r.work.reduce((a, w) => a + w.vatFils, 0)), s: { ...TOTAL, fmt: MONEY } },
        { f: `SUBTOTAL(109,L2:L${workLast})`, v: aed(r.work.reduce((a, w) => a + w.grossFils, 0)), s: { ...TOTAL, fmt: MONEY } },
      ],
    ],
  };

  /* ---- Services ---- */
  const svcLast = r.services.length + 1;
  const spent = r.services.reduce((a, s) => a + s.totalFils, 0);
  const services: XSheet = {
    name: 'Services',
    cols: [7.5, 36, 24, 12, 11, 11, 16, 15, 12],
    freeze: 1,
    filter: `A1:I${svcLast}`,
    printRows: '$1:$1',
    landscape: true,
    heights: { 1: 30 },
    rows: [
      head(['No.', 'Service', 'Category', 'Times done', 'Vehicles', 'Total qty', 'Average price excl. VAT', 'Total', 'Share of spend'], 'cllcccrrc'),
      ...r.services.map((s, i) => {
        const row = i + 2;
        const by = plain(s.name);
        const avg = s.qty ? aed(s.netFils) / s.qty : 0;
        return [
          { v: i + 1, s: z(i, { align: 'center' }) },
          { v: s.name, s: z(i) },
          { v: s.category, s: z(i) },
          by ? { f: `COUNTIFS(${wd('F')},B${row})`, v: s.times, s: z(i, { align: 'center' }) } : { v: s.times, s: z(i, { align: 'center' }) },
          { v: s.vehicles, s: z(i, { align: 'center' }) },
          by ? { f: `SUMIFS(${wd('H')},${wd('F')},B${row})`, v: s.qty, s: z(i, { align: 'center' }) } : { v: s.qty, s: z(i, { align: 'center' }) },
          by ? { f: `IFERROR(SUMIFS(${wd('J')},${wd('F')},B${row})/F${row},0)`, v: avg, s: z(i, { fmt: MONEY }) } : { v: avg, s: z(i, { fmt: MONEY }) },
          by ? { f: `SUMIFS(${wd('L')},${wd('F')},B${row})`, v: aed(s.totalFils), s: z(i, { fmt: MONEY }) } : { v: aed(s.totalFils), s: z(i, { fmt: MONEY }) },
          { f: `IFERROR(H${row}/SUM($H$2:$H${svcLast}),0)`, v: spent ? s.totalFils / spent : 0, s: z(i, { fmt: '0.0%', align: 'center' }) },
        ] as XCell[];
      }),
      [
        { v: 'TOTAL', s: TOTAL },
        { s: TOTAL },
        { s: TOTAL },
        { f: `SUBTOTAL(109,D2:D${svcLast})`, v: nWork, s: { ...TOTAL, align: 'center' } },
        { s: TOTAL },
        { f: `SUBTOTAL(109,F2:F${svcLast})`, v: qtySum, s: { ...TOTAL, align: 'center' } },
        { s: TOTAL },
        { f: `SUBTOTAL(109,H2:H${svcLast})`, v: aed(spent), s: { ...TOTAL, fmt: MONEY } },
        { f: `SUBTOTAL(109,I2:I${svcLast})`, v: spent ? 1 : 0, s: { ...TOTAL, fmt: '0.0%', align: 'center' } },
      ],
    ],
  };

  /* ---- Vehicles ---- */
  const oilNames = [...new Set(r.work.filter((w) => w.kind === 'oil').map((w) => w.service))];
  const oilFormula = oilNames.length === 1 && plain(oilNames[0]);
  const vehicles: XSheet = {
    name: 'Vehicles',
    cols: [7.5, 13, 30, 15, 9, 13, 13, 15, 15, 11, 15],
    freeze: 1,
    filter: `A1:K${vehLast}`,
    printRows: '$1:$1',
    landscape: true,
    heights: { 1: 30 },
    rows: [
      head(['No.', 'Plate No.', 'Vehicle', 'Type', 'Visits', 'First visit', 'Last visit', 'Total spent', 'Average per visit', 'Oil changes', 'Last oil change'], 'clllcllrrcl'),
      ...r.vehicles.map((v, i) => {
        const row = i + 2;
        const by = plain(v.plate);
        return [
          { v: i + 1, s: z(i, { align: 'center' }) },
          { v: v.plate, s: z(i) },
          { v: v.vehicle, s: z(i) },
          { v: v.type ? VEHICLE_TYPE_EN[v.type] : '', s: z(i) },
          by ? { f: `COUNTIFS(${iv('E')},B${row})`, v: v.visits, s: z(i, { align: 'center' }) } : { v: v.visits, s: z(i, { align: 'center' }) },
          { date: v.first, s: z(i, { fmt: DAY, align: 'left' }) },
          { date: v.last, s: z(i, { fmt: DAY, align: 'left' }) },
          by ? { f: `SUMIFS(${iv('I')},${iv('E')},B${row})`, v: aed(v.totalFils), s: z(i, { fmt: MONEY }) } : { v: aed(v.totalFils), s: z(i, { fmt: MONEY }) },
          { f: `IFERROR(H${row}/E${row},0)`, v: v.visits ? aed(v.totalFils) / v.visits : 0, s: z(i, { fmt: MONEY }) },
          by && oilFormula ? { f: `COUNTIFS(${wd('C')},B${row},${wd('F')},${quoted(oilNames[0])})`, v: v.oilChanges, s: z(i, { align: 'center' }) } : { v: v.oilChanges, s: z(i, { align: 'center' }) },
          v.lastOil ? { date: v.lastOil, s: z(i, { fmt: DAY, align: 'left' }) } : { s: z(i) },
        ] as XCell[];
      }),
      [
        { v: 'TOTAL', s: TOTAL },
        { f: `SUBTOTAL(103,B2:B${vehLast})`, v: r.vehicles.length, s: { ...TOTAL, fmt: '0 "vehicles"', align: 'left' } },
        { s: TOTAL },
        { s: TOTAL },
        { f: `SUBTOTAL(109,E2:E${vehLast})`, v: nInv, s: { ...TOTAL, align: 'center' } },
        { s: TOTAL },
        { s: TOTAL },
        { f: `SUBTOTAL(109,H2:H${vehLast})`, v: aed(r.totals.totalFils), s: { ...TOTAL, fmt: MONEY } },
        { f: `IFERROR(H${vehLast + 1}/E${vehLast + 1},0)`, v: nInv ? aed(r.totals.totalFils) / nInv : 0, s: { ...TOTAL, fmt: MONEY } },
        { f: `SUBTOTAL(109,J2:J${vehLast})`, v: r.vehicles.reduce((a, v) => a + v.oilChanges, 0), s: { ...TOTAL, align: 'center' } },
        { s: TOTAL },
      ],
    ],
  };

  /* ---- Overview ---- */
  const rows: XCell[][] = [];
  const heights: Record<number, number> = {};
  const merges: string[] = ['A1:F1', 'A2:F2', 'A3:F3'];
  const at = () => rows.length + 1;
  rows.push([{ v: meta.customer, s: { bold: true, size: 16, color: NAVY } }]);
  heights[1] = 26;
  rows.push([{ v: `Service report · ${periodText(meta.from, meta.to)}`, s: { size: 11, color: GREY } }]);
  rows.push([{ v: `${meta.garage} · prepared ${day(meta.made)}`, s: { size: 9, color: GREY } }]);
  rows.push([]);
  heights[4] = 8;
  const tileLabel: XStyle = { size: 9, color: GREY, fill: TILE, valign: 'bottom', indent: 1 };
  const tileValue: XStyle = { bold: true, size: 14, color: NAVY, fill: TILE, valign: 'center', indent: 1, align: 'left' };
  rows.push(['Period', 'Invoices', 'Vehicles', 'Amount excl. VAT', vat, 'Total (AED)'].map((v) => ({ v, s: tileLabel })));
  heights[5] = 20;
  rows.push([
    { v: periodText(meta.from, meta.to), s: { ...tileValue, size: 12 } },
    { f: `COUNTA(${iv('D')})`, v: nInv, s: { ...tileValue, fmt: '#,##0' } },
    { f: `COUNTA(${VEH}!$B$2:$B$${vehLast})`, v: r.vehicles.length, s: { ...tileValue, fmt: '#,##0' } },
    { f: `SUM(${iv('G')})`, v: aed(r.totals.netFils), s: { ...tileValue, fmt: MONEY } },
    { f: `SUM(${iv('H')})`, v: aed(r.totals.vatFils), s: { ...tileValue, fmt: MONEY } },
    { f: `SUM(${iv('I')})`, v: aed(r.totals.totalFils), s: { ...tileValue, fmt: MONEY } },
  ]);
  heights[6] = 30;
  rows.push([]);
  const section = (title: string) => {
    rows.push([{ v: title, s: { bold: true, size: 11, color: NAVY } }]);
    heights[at() - 1] = 20;
  };

  // By month
  section('By month');
  rows.push(head(['Month', 'Invoices', 'Vehicles', 'Amount excl. VAT', vat, 'Total'], 'lccrrr'));
  heights[at() - 1] = 20;
  const monthFirst = at();
  r.months.forEach((m, i) => {
    const row = at();
    rows.push([
      { date: `${m.month}-01`, s: z(i, { fmt: 'mmmm yyyy', align: 'left' }) },
      { f: `COUNTIFS(${iv('B')},A${row})`, v: m.invoices, s: z(i, { align: 'center' }) },
      { v: m.vehicles, s: z(i, { align: 'center' }) },
      { f: `SUMIFS(${iv('G')},${iv('B')},A${row})`, v: aed(m.netFils), s: z(i, { fmt: MONEY }) },
      { f: `SUMIFS(${iv('H')},${iv('B')},A${row})`, v: aed(m.vatFils), s: z(i, { fmt: MONEY }) },
      { f: `SUMIFS(${iv('I')},${iv('B')},A${row})`, v: aed(m.totalFils), s: z(i, { fmt: MONEY }) },
    ]);
  });
  const monthLast = at() - 1;
  rows.push([
    { v: 'TOTAL', s: TOTAL },
    { f: `SUM(B${monthFirst}:B${monthLast})`, v: nInv, s: { ...TOTAL, align: 'center' } },
    { v: r.vehicles.length, s: { ...TOTAL, align: 'center' } },
    { f: `SUM(D${monthFirst}:D${monthLast})`, v: aed(r.totals.netFils), s: { ...TOTAL, fmt: MONEY } },
    { f: `SUM(E${monthFirst}:E${monthLast})`, v: aed(r.totals.vatFils), s: { ...TOTAL, fmt: MONEY } },
    { f: `SUM(F${monthFirst}:F${monthLast})`, v: aed(r.totals.totalFils), s: { ...TOTAL, fmt: MONEY } },
  ]);
  rows.push([]);

  // The money of a row of the Work Details by its name in column `by` (G — category, F — service): without VAT, VAT,
  // total — the same columns (D, E, F) as the months above.
  const sums = (row: number, by: 'F' | 'G', name: string, net: number, vatF: number, total: number, i: number): XCell[] =>
    plain(name)
      ? [
          { f: `SUMIFS(${wd('J')},${wd(by)},A${row})`, v: aed(net), s: z(i, { fmt: MONEY }) },
          { f: `SUMIFS(${wd('K')},${wd(by)},A${row})`, v: aed(vatF), s: z(i, { fmt: MONEY }) },
          { f: `SUMIFS(${wd('L')},${wd(by)},A${row})`, v: aed(total), s: z(i, { fmt: MONEY }) },
        ]
      : [
          { v: aed(net), s: z(i, { fmt: MONEY }) },
          { v: aed(vatF), s: z(i, { fmt: MONEY }) },
          { v: aed(total), s: z(i, { fmt: MONEY }) },
        ];
  const times = (row: number, by: 'F' | 'G', name: string, n: number, i: number): XCell =>
    plain(name) ? { f: `COUNTIFS(${wd(by)},A${row})`, v: n, s: z(i, { align: 'center' }) } : { v: n, s: z(i, { align: 'center' }) };

  // By category
  section('By category');
  rows.push(head(['Category', 'Times done', 'Share of spend', 'Amount excl. VAT', vat, 'Total'], 'lccrrr'));
  heights[at() - 1] = 20;
  const catFirst = at();
  const catTotalRow = catFirst + r.categories.length;
  r.categories.forEach((c, i) => {
    const row = at();
    rows.push([
      { v: c.name, s: z(i) },
      times(row, 'G', c.name, c.times, i),
      { f: `IFERROR(F${row}/F$${catTotalRow},0)`, v: spent ? c.totalFils / spent : 0, s: z(i, { fmt: '0.0%', align: 'center' }) },
      ...sums(row, 'G', c.name, c.netFils, c.vatFils, c.totalFils, i),
    ]);
  });
  const catLast = at() - 1;
  rows.push([
    { v: 'TOTAL', s: TOTAL },
    { f: `SUM(B${catFirst}:B${catLast})`, v: nWork, s: { ...TOTAL, align: 'center' } },
    { f: `SUM(C${catFirst}:C${catLast})`, v: spent ? 1 : 0, s: { ...TOTAL, fmt: '0.0%', align: 'center' } },
    { f: `SUM(D${catFirst}:D${catLast})`, v: aed(r.work.reduce((a, w) => a + w.netFils, 0)), s: { ...TOTAL, fmt: MONEY } },
    { f: `SUM(E${catFirst}:E${catLast})`, v: aed(r.work.reduce((a, w) => a + w.vatFils, 0)), s: { ...TOTAL, fmt: MONEY } },
    { f: `SUM(F${catFirst}:F${catLast})`, v: aed(spent), s: { ...TOTAL, fmt: MONEY } },
  ]);
  rows.push([]);

  // Top 10 services
  section('Top 10 services');
  rows.push(head(['Service', 'Times done', 'Vehicles', 'Amount excl. VAT', vat, 'Total'], 'lccrrr'));
  heights[at() - 1] = 20;
  r.services.slice(0, 10).forEach((s, i) => {
    const row = at();
    rows.push([{ v: s.name, s: z(i) }, times(row, 'F', s.name, s.times, i), { v: s.vehicles, s: z(i, { align: 'center' }) }, ...sums(row, 'F', s.name, s.netFils, s.vatFils, s.totalFils, i)]);
  });

  // Two charts to the right of the tables: the months beside theirs, the categories below.
  const OV = sheetRef('Overview');
  const chart1Top = monthFirst - 3;
  const chart1Bottom = Math.max(chart1Top + 16, monthLast + 2);
  const chart2Top = Math.max(chart1Bottom + 1, catFirst - 3);
  const chart2Bottom = chart2Top + Math.max(15, Math.round(r.categories.length * 1.3) + 5);
  const overview: XSheet = {
    name: 'Overview',
    cols: [32, 12, 15, 19, 15, 19, 3, 10, 10, 10, 10, 10, 10, 10, 10],
    merges,
    heights,
    landscape: true,
    rows,
    charts: [
      {
        type: 'column',
        title: 'Total by month, AED',
        cats: { ref: `${OV}!$A$${monthFirst}:$A$${monthLast}`, values: r.months.map((m) => daySerial(`${m.month}-01`)), fmt: 'mmm yyyy' },
        values: { ref: `${OV}!$F$${monthFirst}:$F$${monthLast}`, values: r.months.map((m) => aed(m.totalFils)), name: 'Total' },
        color: NAVY,
        from: [7, chart1Top],
        to: [15, chart1Bottom],
      },
      {
        type: 'bar',
        title: 'Total by category, AED',
        cats: { ref: `${OV}!$A$${catFirst}:$A$${catLast}`, values: r.categories.map((c) => c.name) },
        values: { ref: `${OV}!$F${catFirst}:$F${catLast}`, values: r.categories.map((c) => aed(c.totalFils)), name: 'Total' },
        color: '2E75B6',
        from: [7, chart2Top],
        to: [15, chart2Bottom],
      },
    ],
  };
  return buildWorkbook([overview, invoices, work, services, vehicles], { title: `${meta.customer} — Service report ${periodText(meta.from, meta.to)}`, author: meta.garage });
}

/* ---------------- The garage's own check («для своих») ---------------- */

export interface CheckData {
  customer: string;
  from: string;
  to: string;
  /** The period's invoices from before the app. */
  invoices: HistoryInvoice[];
  /** The rows of the summaries of the months these are in. */
  rows: HistorySummaryRow[];
  /** A job here (its number) and a car here (its plate). */
  jobNumber: (orderId: string) => string | undefined;
  carPlate: (vehicleId: string) => string | undefined;
}

const STATUS: Record<HistorySummaryRow['status'], string> = {
  ok: 'OK',
  amount: 'Another amount',
  plate: 'Another plate',
  'plate-amount': 'Another plate and amount',
  missing: 'No document',
  total: 'Total',
};
const FLAG: Record<string, string> = { 'job-sum': 'Job sum', 'job-car': 'Job car', 'job-twin': 'Twin', 'no-job': 'No job', plate: 'Plate', 'new-car': 'New car' };

/**
 * The invoices against the monthly summaries typed by hand — the garage's own (technical columns kept: files, pages,
 * flags): Months (counted from the invoices beside the summaries), Summary rows (each with its invoice and how they
 * differ), Invoices (each with its checks and its summary row), Flags.
 */
export function checkWorkbook(d: CheckData): Uint8Array {
  const invById = new Map(d.invoices.map((i) => [i.id, i]));
  const rowOf = new Map(d.rows.filter((r) => r.invoiceId).map((r) => [r.invoiceId!, r]));
  const months = [...new Set([...d.invoices.map((i) => i.date.slice(0, 7)), ...d.rows.map((r) => r.month)])].sort();
  const hd = (titles: string[]) => head(titles);
  const M = (v: number) => ({ v: aed(v), s: { fmt: MONEY } as XStyle });
  const bad: XStyle = { color: 'C00000', bold: true };
  const linesOk = (i: HistoryInvoice) => i.lines.every((l) => l.netFils + l.vatFils === l.grossFils) && i.lines.reduce((a, l) => a + l.grossFils, 0) === i.totalFils;

  const monthRows = months.map((m) => {
    const inv = d.invoices.filter((i) => i.date.slice(0, 7) === m);
    const rows = d.rows.filter((r) => r.month === m && r.kind === 'row');
    const printed = d.rows.find((r) => r.month === m && r.kind === 'total');
    const total = inv.reduce((a, i) => a + i.totalFils, 0);
    const typed = rows.reduce((a, r) => a + r.amountFils, 0);
    const odd = rows.filter((r) => r.status !== 'ok' && r.status !== 'missing');
    const missing = rows.filter((r) => r.status === 'missing');
    const unlisted = inv.filter((i) => !rowOf.has(i.id));
    return [
      { v: `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` },
      { v: inv.length },
      { v: inv.reduce((a, i) => a + i.lines.length, 0) },
      M(inv.reduce((a, i) => a + i.netFils, 0)),
      M(inv.reduce((a, i) => a + i.vatFils, 0)),
      M(total),
      { v: rows.length },
      M(typed),
      printed ? M(printed.amountFils) : {},
      { v: aed(typed - total), s: { fmt: MONEY, ...(typed !== total ? bad : {}) } },
      { v: odd.length, s: odd.length ? bad : {} },
      { v: missing.length, s: missing.length ? bad : {} },
      M(missing.reduce((a, r) => a + r.amountFils, 0)),
      { v: unlisted.length, s: unlisted.length ? bad : {} },
    ] as XCell[];
  });

  const summary = d.rows
    .filter((r) => r.kind === 'row')
    .sort((a, b) => a.month.localeCompare(b.month) || a.no - b.no)
    .map((r) => {
      const inv = r.invoiceId ? invById.get(r.invoiceId) : undefined;
      const diff = inv ? r.amountFils - inv.totalFils : undefined;
      return [
        { v: r.month },
        { v: r.no },
        r.date ? { date: r.date, s: { fmt: DAY, align: 'left' } } : {},
        { v: r.vehicleText ?? '' },
        { v: r.plateRaw ?? '' },
        { v: r.plate ?? '' },
        { v: r.invoiceNo ?? '' },
        M(r.amountFils),
        { v: STATUS[r.status], s: r.status === 'ok' ? {} : bad },
        { v: inv ? `${inv.numberKind === 'job' ? 'Job ID' : 'Invoice'} ${inv.number}` : '' },
        inv ? { date: inv.date, s: { fmt: DAY, align: 'left' } } : {},
        { v: inv?.plate ?? '' },
        inv ? M(inv.totalFils) : {},
        diff !== undefined ? { v: aed(diff), s: { fmt: MONEY, ...(diff ? bad : {}) } } : {},
        { v: r.source.file },
        { v: r.source.page },
      ] as XCell[];
    });

  const invoiceRows = [...d.invoices]
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, 'en', { numeric: true }))
    .map((i) => {
      const row = rowOf.get(i.id);
      const here = d.carPlate(i.vehicleId);
      return [
        { v: i.date.slice(0, 7) },
        { date: i.date, s: { fmt: DAY, align: 'left' } },
        { v: i.numberKind === 'job' ? 'Job ID' : 'Invoice' },
        { v: i.number },
        { v: i.plateRaw },
        { v: i.plate },
        { v: here ?? '', s: here && here !== i.plate ? bad : {} },
        { v: i.vehicleText },
        { v: i.lines.length },
        M(i.netFils),
        M(i.vatFils),
        M(i.totalFils),
        { v: linesOk(i) ? 'OK' : 'Check', s: linesOk(i) ? {} : bad },
        { v: row ? `${row.month} #${row.no}` : 'Not in summary', s: row ? {} : bad },
        { v: (i.orderId && d.jobNumber(i.orderId)) || '' },
        { v: (i.flags ?? []).map((f) => FLAG[f.code] ?? f.code).join(', '), s: i.flags?.length ? bad : {} },
        { v: i.source.file },
        { v: i.source.page },
      ] as XCell[];
    });

  const flags = d.invoices
    .flatMap((i) => (i.flags ?? []).map((f) => ({ i, f })))
    .sort((a, b) => a.i.date.localeCompare(b.i.date))
    .map(({ i, f }) => [{ date: i.date, s: { fmt: DAY, align: 'left' } }, { v: `${i.numberKind === 'job' ? 'Job ID' : 'Invoice'} ${i.number}` }, { v: i.plate }, { v: FLAG[f.code] ?? f.code }, { v: f.text }] as XCell[]);

  const sheet = (name: string, titles: string[], body: XCell[][], cols: number[]): XSheet => ({
    name,
    cols,
    freeze: 1,
    filter: `A1:${colName(titles.length - 1)}${Math.max(2, body.length + 1)}`,
    printRows: '$1:$1',
    landscape: true,
    heights: { 1: 30 },
    rows: [hd(titles), ...body.map((cells, i) => cells.map((c) => ({ ...c, s: z(i, c.s) })))],
  });
  return buildWorkbook(
    [
      sheet(
        'Months',
        ['Month', 'Invoices', 'Lines', 'Amount excl. VAT', 'VAT', 'Total (invoices)', 'Summary rows', 'Summary (rows)', 'Summary TOTAL as printed', 'Summary − invoices', 'Rows that differ', 'No document', 'No document, AED', 'Invoices not in summary'],
        monthRows,
        [16, 10, 8, 16, 12, 16, 11, 16, 16, 15, 11, 11, 15, 13],
      ),
      sheet(
        'Summary rows',
        ['Month', 'No.', 'Date', 'Vehicle', 'Plate as typed', 'Plate', 'Invoice No.', 'Amount', 'Status', 'Invoice', 'Invoice date', 'Invoice plate', 'Invoice amount', 'Difference', 'File', 'Page'],
        summary,
        [9, 6, 13, 24, 15, 12, 11, 13, 22, 15, 13, 13, 14, 12, 34, 6],
      ),
      sheet(
        'Invoices',
        ['Month', 'Date', 'Kind', 'No.', 'Plate as printed', 'Plate', 'Car here', 'Vehicle as printed', 'Lines', 'Amount excl. VAT', 'VAT', 'Total', 'Lines check', 'Summary row', 'Job here', 'Flags', 'File', 'Page'],
        invoiceRows,
        [9, 13, 9, 8, 18, 12, 12, 26, 7, 16, 12, 13, 8, 15, 10, 22, 34, 6],
      ),
      sheet('Flags', ['Date', 'Invoice', 'Plate', 'Flag', 'What'], flags, [13, 16, 12, 12, 70]),
    ],
    { title: `${d.customer} — internal check ${periodText(d.from, d.to)}` },
  );
}
