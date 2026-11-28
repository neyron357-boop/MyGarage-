import { describe, expect, it } from 'vitest';
import { carOfLine, carOfText, carsOfLine, dateByNumbers, expenseOf, lineKind, lineOf, paperDate, paperDoubts, paperFields, paperStats, partWithoutCar, setGarageModels, twinOf } from './papers';
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

describe('v1.05.2: what the first papers taught (every line here made up)', () => {
  it('every car a line fits — a list of models, a name a letter off, a short make, a make and its number', () => {
    const c = carsOfLine('CONDENSER RIO/ACCENT/VELOSTR 2010-2018');
    expect([c.make, c.model]).toEqual(['Kia', 'Rio']);
    expect(c.fits).toEqual([
      { make: 'Kia', model: 'Rio' },
      { make: 'Hyundai', model: 'Accent' },
      { make: 'Hyundai', model: 'Veloster' },
    ]);
    expect(carOfLine('ELENTRA SHOCK ABSORBER FRT')).toMatchObject({ make: 'Hyundai', model: 'Elantra' });
    expect(carOfLine('SPROTAGE ENG MOUNTING')).toMatchObject({ make: 'Kia', model: 'Sportage' });
    expect(carOfLine('MIT ASX AC FILTER')).toMatchObject({ make: 'Mitsubishi', model: 'ASX' });
    expect(carOfLine('MAZDA 6 BRAKE PAD')).toMatchObject({ make: 'Mazda', model: 'Mazda6' });
    // a part word that is a model somewhere is the part
    expect(carOfLine('SPARK PLUG IRIDIUM').make).toBeUndefined();
    expect(carOfLine('CLUTCH MASTER CYLINDER').make).toBeUndefined();
  });
  it('a model the catalogue lacks — read when it is one of the garage’s own cars', () => {
    expect(carOfLine('ZQ WIPER BLADE').make).toBeUndefined();
    setGarageModels([{ make: 'Toyota', model: 'ZQ' }, { make: 'Nobody', model: 'Zz' }]);
    try {
      expect(carOfLine('ZQ WIPER BLADE')).toMatchObject({ make: 'Toyota', model: 'ZQ' });
      // short: only where the papers write the car
      expect(carOfLine('WIPER BLADE ZQ').make).toBeUndefined();
    } finally {
      setGarageModels([]);
    }
  });
  it('the part written out: shorthand, misspellings, the years and the kind’s code gone', () => {
    expect(partWithoutCar('RD LANCER 2008-2016 G')).toBe('RADIATOR');
    expect(partWithoutCar('COC ASSY HIACE')).toBe('CLUTCH OPERATING CYLINDER ASSY');
    expect(partWithoutCar('CON ROD BEARING STD')).toBe('CONNECTING ROD BEARING STD');
    expect(partWithoutCar('CON HONDA CIVIC 07-09 (KOYO)')).toBe('CONDENSER (KOYO)');
    expect(partWithoutCar('FRT BRK PAID COROLLA D')).toBe('FRONT BRAKE PAD');
    expect(partWithoutCar('AC COMPARASSOR TUCSON')).toBe('AC COMPRESSOR');
    expect(partWithoutCar('A/C HOSE 1/2"')).toBe('AC HOSE 1/2"');
    expect(partWithoutCar('THARMOSTAT GENIUNE')).toBe('THERMOSTAT');
  });
  it('original or copy as the papers say: «… G», «… D», a maker as the brand — not the car the line is for', () => {
    expect(lineKind('BRAKE PAD FRONT G')).toMatchObject({ kind: 'oem', said: true });
    expect(lineKind('BRAKE PAD FRONT D')).toMatchObject({ kind: 'aftermarket', said: true });
    expect(lineKind('BRAKE PAD FRONT', { brand: 'G' })).toMatchObject({ kind: 'oem', said: true });
    expect(lineKind('OIL FILTER 90915 TOYOTA', 'Toyota')).toMatchObject({ kind: 'oem', brand: 'TOYOTA' });
    // the car's make is not its brand
    expect(lineKind('MAZDA 6 BRAKE PAD', { brand: 'MAZDA' })).toEqual({ kind: 'aftermarket', said: false });
    expect(lineKind('HONDA CIVIC CONDENSER KOYO', { brand: 'HONDA' })).toMatchObject({ kind: 'aftermarket', said: true });
    expect(lineKind('ENGINE OIL HONDA')).toMatchObject({ kind: 'oem', brand: 'HONDA' });
  });
  it('the AI’s word for the kind — only where the line’s own words say nothing', () => {
    expect(lineOf({ name: 'OIL COOLER', kind: 'oem', qty: 1 }, {})).toMatchObject({ kind: 'oem', said: { kind: 'oem' } });
    expect(lineOf({ name: 'OIL COOLER', kind: 'oem', qty: 1 }, {}).unsure).toBeUndefined();
    expect(lineOf({ name: 'OIL COOLER D', kind: 'oem', qty: 1 }, {}).kind).toBe('aftermarket');
    expect(lineOf({ name: 'OIL COOLER', qty: 1 }, {})).toMatchObject({ kind: 'aftermarket', unsure: true });
    // its cars: the line's own, every one
    expect(lineOf({ name: 'CONDENSER RIO/ACCENT', qty: 1 }, { make: 'Toyota', model: 'Hiace' })).toMatchObject({ make: 'Kia', model: 'Rio', fits: [{ make: 'Hyundai', model: 'Accent' }] });
  });
  it('the year by the supplier’s numbering: a faint 6 read as 4 among November’s papers', () => {
    const others = [
      { id: 'a', supplierId: 's', invoiceNo: '5100', date: '2026-11-20', dateSure: true, state: 'done' as const },
      { id: 'b', supplierId: 's', invoiceNo: '4300', date: '2026-08-02', dateSure: true, state: 'done' as const },
      { id: 'c', supplierId: 'other', invoiceNo: '5121', date: '2023-01-01', dateSure: true, state: 'done' as const },
    ];
    expect(dateByNumbers({ id: 'p', supplierId: 's', invoiceNo: 'INV-5120', date: '2024-11-25' }, others)).toBe('2026-11-25');
    // the same year, another supplier, a number far off, a neighbour not sure: as read
    expect(dateByNumbers({ id: 'p', supplierId: 's', invoiceNo: '5120', date: '2026-10-25' }, others)).toBeUndefined();
    expect(dateByNumbers({ id: 'p', supplierId: 'x', invoiceNo: '5120', date: '2024-11-25' }, others)).toBeUndefined();
    expect(dateByNumbers({ id: 'p', supplierId: 's', invoiceNo: '9999', date: '2024-11-25' }, others)).toBeUndefined();
    expect(dateByNumbers({ id: 'p', supplierId: 's', invoiceNo: '5120', date: '2024-11-25' }, others.map((o) => ({ ...o, dateSure: false })))).toBeUndefined();
    // one neighbour alone, or neighbours of two years: as read (the neighbour may be the misread one)
    expect(dateByNumbers({ id: 'p', supplierId: 's', invoiceNo: '5120', date: '2024-11-25' }, others.slice(0, 1))).toBeUndefined();
    expect(dateByNumbers({ id: 'p', supplierId: 's', invoiceNo: '5120', date: '2024-11-25' }, [...others, { id: 'd', supplierId: 's', invoiceNo: '5121', date: '2024-11-26', dateSure: true, state: 'done' as const }])).toBeUndefined();
    // a year apart with the same months is a real year apart — kept
    expect(dateByNumbers({ id: 'p', supplierId: 's', invoiceNo: '5120', date: '2025-05-25' }, others)).toBeUndefined();
  });
});
