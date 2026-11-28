import { describe, expect, it } from 'vitest';
import { carOfLine, carOfText, expenseOf, lineKind, paperDate, paperDoubts, paperFields, paperStats, partWithoutCar, twinOf } from './papers';
import type { SupplierPaper } from './types';

/*
 * The suppliers' paper invoices read in bulk (v1.05). Every seller, TRN, number, part and price here is made up.
 */

const TODAY = '2026-11-28';

describe('an old paper’s day', () => {
  it('years back is right; a day after today is a misread (a year before, or day and month swapped); none — none', () => {
    expect(paperDate({ dateText: '14/03/2024', date: '2024-03-14' }, TODAY)).toEqual({ date: '2024-03-14', sure: true });
    // read apart: the printed one, not sure
    expect(paperDate({ dateText: '14/03/2024', date: '2024-03-15' }, TODAY)).toEqual({ date: '2024-03-14', sure: false });
    expect(paperDate({ dateText: '', date: '2027-02-10' }, TODAY)).toEqual({ date: '2026-02-10', sure: false });
    expect(paperDate({ dateText: '', date: '2027-12-20' }, TODAY)).toEqual({ date: undefined, sure: false });
    expect(paperDate({ dateText: '', date: '2015-01-01' }, TODAY)).toEqual({ sure: false });
    expect(paperDate({}, TODAY)).toEqual({ sure: false });
  });
});

describe('v1.05.1: the car a line names, as the garage’s suppliers write it (the model first)', () => {
  it('the model in the line — written together or apart, its own last word, «LC200»; an everyday-word model only first', () => {
    expect(carOfLine('SANTAFE AC EXPANSION VALVE QWE')).toMatchObject({ make: 'Hyundai', model: 'Santa Fe' });
    expect(carOfLine('SANTA FE AC VALVE')).toMatchObject({ make: 'Hyundai', model: 'Santa Fe' });
    expect(carOfLine('CAMRY HIBRID COOLING FAN ZRT')).toMatchObject({ make: 'Toyota', model: 'Camry' });
    expect(carOfLine('PRADO SHOCK ABSORBER REAR')).toMatchObject({ make: 'Toyota', model: 'Land Cruiser Prado' });
    expect(carOfLine('LC200 BRAKE PAD FRONT')).toMatchObject({ make: 'Toyota', model: 'Land Cruiser' });
    expect(carOfLine('ACCENT HEADLIGHT LH')).toMatchObject({ make: 'Hyundai', model: 'Accent' });
    // «accent» further in is a word, not the car
    expect(carOfLine('HEADLIGHT ACCENT TRIM').make).toBeUndefined();
    expect(carOfLine('NISSAN SUNNY GEAR FILTER')).toMatchObject({ make: 'Nissan', model: 'Sunny' });
    expect(carOfLine('OIL FILTER').make).toBeUndefined();
  });
  it('the part is the line without its car (and «HYBRID», a year)', () => {
    expect(partWithoutCar('SANTAFE AC EXPANSION VALVE QWE')).toBe('AC EXPANSION VALVE QWE');
    expect(partWithoutCar('CAMRY HIBRID COOLING FAN ZRT')).toBe('COOLING FAN ZRT');
    expect(partWithoutCar('TOYOTA CAMRY 2018 RADIATOR HOSE')).toBe('RADIATOR HOSE');
    expect(partWithoutCar('FAN MOTOR')).toBe('FAN MOTOR');
  });
  it('a paper of such lines: each line its own car, its part without it, its brand apart', () => {
    const f = paperFields(
      {
        isReceipt: true,
        vendor: 'Desert Star Spare Parts LLC',
        kind: 'parts',
        invoiceNo: '97001',
        dateText: '10-Nov-2026',
        date: '2026-11-10',
        items: [
          // as the garage's AI read a real one: the car apart, the part apart, the code apart
          { name: 'CAMRY HIBRID COOLING FAN ZRT', part: 'COOLING FAN', car: 'CAMRY HIBRID', brand: 'ZRT', qty: 2, unitPrice: 140, total: 294 },
          // the phone's reading: only the line — its car and part from its own words
          { name: 'SANTAFE AC EXPANSION VALVE QWE', qty: 1, unitPrice: 65, total: 68.25 },
        ],
        subtotal: 345,
        vat: 17.25,
        total: 362.25,
        confidence: 0.9,
      },
      TODAY,
    );
    expect(f.lines.map((l) => [l.part, l.make, l.model, l.brand, l.unitFils, l.kind])).toEqual([
      ['COOLING FAN', 'Toyota', 'Camry', 'ZRT', 14000, 'aftermarket'],
      ['AC EXPANSION VALVE QWE', 'Hyundai', 'Santa Fe', undefined, 6500, 'aftermarket'],
    ]);
  });
});

describe('the car and the kind of a line', () => {
  it('the make (one), its model when named', () => {
    expect(carOfText('TOYOTA LAND CRUISER 2019 V8')).toEqual({ make: 'Toyota', model: 'Land Cruiser' });
    expect(carOfText('NISSAN PATROL Y62')).toEqual({ make: 'Nissan', model: 'Patrol' });
    expect(carOfText('HONDA CIVIC 2010')).toEqual({ make: 'Honda', model: 'Civic' });
    expect(carOfText('toyota / nissan')).toEqual({});
    expect(carOfText('')).toEqual({});
  });
  it('the car’s own make or «genuine» — original; another maker, «copy» — aftermarket; «used»', () => {
    expect(lineKind('BRAKE PAD FRONT GENUINE', 'Toyota')).toEqual({ kind: 'oem', said: true });
    expect(lineKind('BRAKE PAD FRONT TOYOTA', 'Toyota')).toMatchObject({ kind: 'oem', brand: 'TOYOTA' });
    expect(lineKind('SPARK PLUG NGK', 'Toyota')).toMatchObject({ kind: 'aftermarket', brand: 'NGK' });
    expect(lineKind('HEADLIGHT USED', 'Toyota')).toMatchObject({ kind: 'used' });
    expect(lineKind('OIL FILTER', 'Toyota')).toEqual({ kind: 'aftermarket', said: false });
  });
});

describe('a paper’s fields', () => {
  const read = {
    isReceipt: true,
    vendor: 'Al Noor Auto Spare Parts LLC',
    vendorTrn: '100 0000 0000 0003',
    vendorPhone: '+971 50 000 0001',
    kind: 'parts',
    invoiceNo: 'INV-0042',
    dateText: '05/02/2025',
    date: '2025-02-05',
    carText: 'TOYOTA HIACE 2018',
    items: [
      { name: 'Brake pad front genuine', part: 'FRONT BRAKE PADS', qty: 1, unitPrice: 180, total: 180 },
      { name: 'Oil filter', part: 'OIL FILTER', qty: 2, unitPrice: 25, total: 50 },
      { name: 'Spark plug NGK', part: 'SPARK PLUG', car: 'NISSAN SUNNY', qty: 4, unitPrice: 20, total: 80 },
    ],
    subtotal: 310,
    vat: 15.5,
    total: 325.5,
    confidence: 0.9,
  };
  it('who, when, the number, the sums; each line with its part, its car, its kind, its price without VAT', () => {
    const f = paperFields(read, TODAY);
    expect([f.ok, f.kind, f.vendor, f.vendorTrn, f.invoiceNo, f.date, f.dateSure, f.totalFils, f.vatFils, f.make, f.model, f.adds]).toEqual([true, 'parts', 'Al Noor Auto Spare Parts LLC', '100000000000003', 'INV-0042', '2025-02-05', true, 32550, 1550, 'Toyota', 'Hiace', true]);
    expect(f.lines.map((l) => [l.part, l.qty, l.unitFils, l.make, l.model, l.kind, !!l.unsure, l.brand])).toEqual([
      ['FRONT BRAKE PADS', 1, 18000, 'Toyota', 'Hiace', 'oem', false, undefined],
      ['OIL FILTER', 2, 2500, 'Toyota', 'Hiace', 'aftermarket', true, undefined],
      ['SPARK PLUG', 4, 2000, 'Nissan', 'Sunny', 'aftermarket', false, 'NGK'],
    ]);
  });
  it('not an invoice, another kind; lines that do not add up; what needs a look', () => {
    expect(paperFields({ ...read, isReceipt: false }, TODAY).notPaper).toBe(true);
    expect(paperFields({ ...read, kind: 'fuel' }, TODAY).kind).toBe('other');
    const off = paperFields({ ...read, items: [{ name: 'Oil filter', qty: 1, unitPrice: 25, total: 25 }] }, TODAY);
    expect(off.adds).toBe(false);
    expect(paperDoubts({ supplierId: 's', date: off.date, dateSure: true, lines: off.lines, adds: off.adds })).toEqual(['sum']);
    expect(paperDoubts({ supplierId: undefined, date: undefined, dateSure: false, lines: [], adds: true })).toEqual(['seller', 'date', 'lines']);
  });
});

const paper = (x: Partial<SupplierPaper>): SupplierPaper => ({ id: 'p', hash: 'h', mediaId: 'm', state: 'done', createdAt: '', updatedAt: '', ...x });

describe('the same paper twice, the expense it already is', () => {
  it('the same seller and number; else the same seller, day and sum', () => {
    const one = paper({ id: 'a', supplierId: 's1', invoiceNo: 'INV-0420', date: '2025-02-05', totalFils: 32550 });
    expect(twinOf({ supplierId: 's1', invoiceNo: 'inv 420', date: '2025-02-05', totalFils: 1 }, [one])?.id).toBe('a');
    expect(twinOf({ supplierId: 's1', invoiceNo: 'INV-0430', date: '2025-02-05', totalFils: 32550 }, [one])).toBeUndefined();
    expect(twinOf({ supplierId: 's2', invoiceNo: 'INV-0420', date: '2025-02-05', totalFils: 32550 }, [one])).toBeUndefined();
    const noNo = paper({ id: 'b', supplierId: 's1', date: '2025-03-01', totalFils: 9000 });
    expect(twinOf({ supplierId: 's1', date: '2025-03-01', totalFils: 9000 }, [noNo])?.id).toBe('b');
    expect(twinOf({ supplierId: 's1', date: '2025-03-01', totalFils: 9100 }, [noNo])).toBeUndefined();
    // by the seller's name when it is not in the base yet
    expect(twinOf({ vendor: 'AL NOOR AUTO SPARE PARTS L.L.C', invoiceNo: '420', date: '2025-02-05' }, [paper({ id: 'c', vendor: 'Al Noor Auto Spare Parts LLC', invoiceNo: '0420' })])?.id).toBe('c');
  });
  it('an expense of the same seller, sum and days — or its number in the note', () => {
    const e = [
      { id: 'e1', supplierId: 's1', vendor: 'Al Noor', note: '', date: '2025-02-06', amountFils: 32550 },
      { id: 'e2', supplierId: 's1', vendor: 'Al Noor', note: '#INV-0199', date: '2025-03-20', amountFils: 50000 },
    ];
    expect(expenseOf({ supplierId: 's1', date: '2025-02-05', totalFils: 32600 }, e)).toBe('e1');
    expect(expenseOf({ supplierId: 's1', date: '2025-02-01', totalFils: 32550 }, e)).toBeUndefined();
    expect(expenseOf({ supplierId: 's1', invoiceNo: '199', date: '2025-03-01', totalFils: 1 }, e)).toBe('e2');
    expect(expenseOf({ supplierId: 's2', date: '2025-02-05', totalFils: 32550 }, e)).toBeUndefined();
  });
});

describe('what a supplier’s papers say of it', () => {
  it('how many, the money, since when; what it sold most (its last price); for which makes', () => {
    const lines = (price: number, make: string) => [
      { name: 'BRAKE PAD', part: 'FRONT BRAKE PADS', qty: 1, unitFils: price, make, kind: 'aftermarket' as const },
      { name: 'OIL FILTER', qty: 1, unitFils: 2500, make, kind: 'aftermarket' as const },
    ];
    const st = paperStats([
      paper({ date: '2025-01-10', totalFils: 20000, lines: lines(17000, 'Toyota') }),
      paper({ date: '2025-06-01', totalFils: 21000, lines: lines(18000, 'Toyota') }),
      paper({ date: '2025-03-01', totalFils: 5000, lines: [{ name: 'SPARK PLUG', qty: 4, unitFils: 2000, make: 'Nissan', kind: 'aftermarket' }] }),
      paper({ state: 'twin', date: '2025-06-01', totalFils: 21000, lines: lines(18000, 'Toyota') }),
    ]);
    expect([st.papers, st.totalFils, st.firstAt, st.lastAt]).toEqual([3, 46000, '2025-01-10', '2025-06-01']);
    expect(st.parts.slice(0, 2)).toEqual([
      { part: 'FRONT BRAKE PADS', times: 2, lastFils: 18000, make: 'Toyota' },
      { part: 'OIL FILTER', times: 2, lastFils: 2500, make: 'Toyota' },
    ]);
    expect(st.makes).toEqual([
      { make: 'Toyota', n: 2 },
      { make: 'Nissan', n: 1 },
    ]);
  });
});
