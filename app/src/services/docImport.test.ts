import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { lineKind, parseCarText, parseGarageDoc, parsePlateText } from '../domain/docImport';
import { itemAmounts } from '../domain/items';
import type { TextItem } from '../domain/obdReport';
import { importGarageDoc } from './docImport';
import { phaseOf } from './flow';
import { loadOrderBundle } from './orders';
import { ensureSeed } from './seed';

/*
 * A page laid out as the garage's Eaglecart invoice (positions as pdf.js gives them; made-up customer):
 * Arabic captions in pieces, a make split in two pieces, a name over two lines, a line with a discount.
 */
function eaglecartPage(o: { title?: string; numberLabel?: string; number?: string; page?: number; plate?: string; extraPage?: boolean } = {}): TextItem[] {
  const page = o.page ?? 1;
  const items: TextItem[] = [];
  const at = (x: number, y: number, str: string, w?: number) => items.push({ page, x, y, str, w: w ?? str.length * 5 });
  at(38, 733, 'RUKN ZAMZAM GARAGE');
  at(454, 733, 'م ش ذ.م.م');
  at(38, 698, 'AL QUSAIS INDUSTRIAL 4, Dubai Uae');
  at(38, 684, '+971 54 000 0000');
  at(245, 650, o.title ?? 'TAX INVOICE');
  at(319, 650, 'ﺔ');
  at(38, 622, 'SELLER');
  at(504, 622, o.title === 'Quotation' ? 'QUOTATION TO' : 'BILL TO');
  at(542, 622, 'ﻰ');
  at(38, 602, 'RUKN ZAMZAM GARAGE LLC');
  at(350, 614, 'DESERT FALCON TRADING');
  at(552, 601, 'LLC');
  at(504, 587, '+971 50 123 4567');
  at(38, 587, 'Telephone');
  at(103, 587, '+971 54 000 0000');
  at(400, 576, 'Tax ID');
  at(431, 576, 'ﻲ');
  at(478, 576, '(TRN): 100000000000003');
  at(38, 559, 'Tax ID');
  at(110, 559, '(TRN):');
  at(139, 559, '104547914200003');
  at(510, 562, 'M', 10);
  at(520, 562, 'itsubishi Pajero', 60);
  at(584, 562, '(Silver)', 30);
  at(490, 548, 'PLATE');
  at(523, 548, 'ﺔ');
  at(540, 548, ':');
  at(544, 548, o.plate ?? 'DD 22043');
  at(38, 545, o.numberLabel ?? 'Invoice Number');
  at(133, 545, ':');
  at(138, 545, o.number ?? '302');
  at(38, 530, 'Date');
  at(84, 530, '14 Nov 2026, 9:55:00');
  at(164, 530, 'PM · GST');
  // The table.
  for (const [x, s] of [[38, '#'], [55, 'Description'], [261, 'Price'], [323, 'Discount'], [404, 'VAT'], [464, 'Qty'], [523, 'Total']] as const) at(x, 502, s);
  const row = (y: number, n: string, desc: string, price: string, vat: string, qty: string, total: string, discount?: string) => {
    at(38, y, n);
    at(55, y, desc);
    at(261, y, 'AED');
    at(282, y, price);
    if (discount) {
      at(323, y, 'AED');
      at(345, y, discount);
    }
    at(404, y, 'AED');
    at(425, y, vat);
    at(481, y, qty);
    at(528, y, 'AED');
    at(550, y, total);
  };
  row(482, '1.', 'ENGINE BELT', '194.95', '9.75', '1', '204.70');
  row(461, '2.', 'GEARBOX REPAIR (INCLUDING', '4,285.71', '214.29', '1', '4,500.00');
  at(55, 449, 'CONSUMABLES, GEAR OIL)');
  row(425, '3.', 'SPARK PLUG ORIGINAL', '45.00', '2.25', '4', '189.00');
  row(404, '4.', 'CONDENSER FAN', '130.67', '5.83', '1', '122.43', '14.07');
  row(383, '5.', 'LABOUR CHARGES', '750.00', '37.50', '1', '787.50');
  at(38, 353, 'Total Qty');
  at(119, 353, '8');
  at(334, 353, 'Subtotal');
  at(508, 353, 'AED');
  at(529, 353, '5,803.63');
  at(334, 330, 'VAT (');
  at(357, 330, 'Incl.');
  at(516, 330, 'AED');
  at(537, 330, '269.40');
  at(334, 297, 'Total');
  at(496, 297, 'AED');
  at(523, 297, '5,803.63');
  at(75, 249, 'JOB ID');
  at(101, 191, o.number ?? '302');
  return items;
}

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('reading the garage invoice or quotation', () => {
  it('reads who, the car, the number, the date and the lines with their totals', () => {
    const d = parseGarageDoc(eaglecartPage())!;
    expect(d).toMatchObject({ kind: 'invoice', number: '302', date: '2026-11-14', totalFils: 580363 });
    expect(d.customer).toMatchObject({ name: 'DESERT FALCON TRADING LLC', phone: '+971501234567', trn: '100000000000003' });
    expect(d.vehicle).toMatchObject({ make: 'Mitsubishi', model: 'Pajero', color: 'Silver', plate: { emirate: 'DXB', code: 'DD', number: '22043' } });
    expect(d.lines.map((l) => [l.title, l.kind, l.qty, l.totalFils])).toEqual([
      ['ENGINE BELT', 'part', 1, 20470],
      ['GEARBOX REPAIR (INCLUDING CONSUMABLES, GEAR OIL)', 'labor', 1, 450000],
      ['SPARK PLUG ORIGINAL', 'part', 4, 18900],
      ['CONDENSER FAN', 'part', 1, 12243],
      ['LABOUR CHARGES', 'labor', 1, 78750],
    ]);
    expect(d.lines.reduce((a, l) => a + l.totalFils, 0)).toBe(d.totalFils);
  });

  it('tells a quotation, a "Job ID" number, and reads only the first of documents merged in one PDF', () => {
    const q = parseGarageDoc(eaglecartPage({ title: 'Quotation', numberLabel: 'Quotation Number', number: '245' }))!;
    expect(q).toMatchObject({ kind: 'quotation', number: '245' });
    const merged = parseGarageDoc([...eaglecartPage({ number: '101', plate: 'A 11111' }), ...eaglecartPage({ page: 2, number: '102', plate: 'B 22222' })])!;
    expect(merged).toMatchObject({ number: '101', vehicle: { plate: { code: 'A', number: '11111' } } });
    expect(merged.lines).toHaveLength(5);
    expect(parseGarageDoc(eaglecartPage({ numberLabel: 'Job ID', number: '106' }))?.number).toBe('106');
    expect(parseGarageDoc([{ page: 1, x: 10, y: 10, str: 'Hello' }])).toBeNull();
  });

  it('reads a PDF whose pieces came glued ("1. BRAKE PADS", "AED 210.00")', () => {
    const items: TextItem[] = [];
    const at = (x: number, y: number, str: string) => items.push({ page: 1, x, y, str, w: str.length * 6 });
    at(245, 760, 'TAX INVOICE');
    at(470, 730, 'BILL TO');
    at(420, 696, 'Kia Sportage (White)');
    at(420, 680, 'PLATE : K 40404');
    for (const [x, s] of [[38, '#'], [55, 'Description'], [250, 'Price'], [360, 'VAT'], [440, 'Qty'], [500, 'Total']] as const) at(x, 610, s);
    for (const [x, s] of [[38, '1. BRAKE PADS FRONT'], [250, 'AED 200.00'], [360, 'AED 10.00'], [450, '1'], [495, 'AED 210.00']] as const) at(x, 590, s);
    at(334, 530, 'Subtotal');
    at(334, 500, 'Total');
    at(495, 500, 'AED 210.00');
    const d = parseGarageDoc(items)!;
    expect(d.lines).toEqual([{ title: 'BRAKE PADS FRONT', kind: 'part', qty: 1, priceFils: 20000, vatFils: 1000, totalFils: 21000 }]);
    expect(d.totalFils).toBe(21000);
  });

  it('reads plates, cars and kinds of lines as the garage writes them', () => {
    expect(parsePlateText('Z-67274')).toEqual({ emirate: 'DXB', code: 'Z', number: '67274' });
    expect(parsePlateText('5 / 87920')).toEqual({ emirate: 'DXB', code: '5', number: '87920' });
    expect(parsePlateText('Sharjah 3 12345')).toEqual({ emirate: 'SHJ', code: '3', number: '12345' });
    expect(parseCarText('Suzuki Ertiga (Red)')).toEqual({ make: 'Suzuki', model: 'Ertiga', color: 'Red' });
    expect(parseCarText('Land Rover Defender')).toMatchObject({ make: 'Land Rover', model: 'Defender' });
    expect(parseCarText('Mercedes GLE')).toMatchObject({ make: 'Mercedes-Benz', model: 'GLE' });
    expect(parseCarText('Toyota Land Cruiser Prado')).toMatchObject({ make: 'Toyota', model: 'Land Cruiser Prado' });
    expect(lineKind('DISC SKIMMING')).toBe('labor');
    expect(lineKind('CHANGE OIL & FILTER (10K KILOMETERS)')).toBe('labor');
    expect(lineKind('CATALYTIC CLEANER')).toBe('part');
    expect(lineKind('BRAKE PAD ORIGINAL')).toBe('part');
  });
});

describe('a job from the document, in one go', () => {
  it('an invoice: a new car and company customer, the lines agreed and done at the printed prices', async () => {
    const r = await importGarageDoc(eaglecartPage());
    expect(r).toMatchObject({ kind: 'invoice', number: '302', added: 5, skipped: 0, newJob: true });
    const b = (await loadOrderBundle(r.orderId))!;
    expect(b.vehicle).toMatchObject({ make: 'Mitsubishi', model: 'Pajero', color: 'Silver', plate: { emirate: 'DXB', code: 'DD', number: '22043' } });
    expect(b.customer).toMatchObject({ type: 'company', companyName: 'DESERT FALCON TRADING LLC', phone: '+971501234567', trn: '100000000000003' });
    expect(b.items.map((i) => itemAmounts(i).gross)).toEqual([20470, 450000, 18900, 12243, 78750]);
    expect(b.items.every((i) => i.approvalState === 'approved' && i.done)).toBe(true);
    expect(b.items.filter((i) => i.kind === 'part').every((i) => i.procurementStatus === 'installed')).toBe(true);
    expect(phaseOf(b)).toBe('work');
  });

  it('a quotation for a car already in a job goes into that job; lines it has are not added twice', async () => {
    const first = await importGarageDoc(eaglecartPage({ title: 'Quotation', numberLabel: 'Quotation Number', number: '245' }));
    let b = (await loadOrderBundle(first.orderId))!;
    expect(b.items.every((i) => i.approvalState === 'draft')).toBe(true);
    expect(b.items.find((i) => i.kind === 'part')?.procurementStatus).toBe('needed');
    expect(phaseOf(b)).toBe('price');
    const again = await importGarageDoc(eaglecartPage({ title: 'Quotation', numberLabel: 'Quotation Number', number: '245' }));
    expect(again).toMatchObject({ orderId: first.orderId, added: 0, skipped: 5, newJob: false });
    b = (await loadOrderBundle(first.orderId))!;
    expect(b.items).toHaveLength(5);
    expect(await db.customers.count()).toBe(1);
  });

  it('says so when the PDF is not a document of the garage or has no plate', async () => {
    await expect(importGarageDoc([{ page: 1, x: 10, y: 10, str: 'Hello' }])).rejects.toThrow('docImport.badFile');
    await expect(importGarageDoc(eaglecartPage({ plate: '—' }))).rejects.toThrow('docImport.noPlate');
  });
});
