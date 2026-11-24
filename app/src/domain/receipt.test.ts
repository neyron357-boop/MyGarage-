import { describe, expect, it } from 'vitest';
import { guessJob, printedDate, rankJobs, receiptDate, receiptExpense, supplierFromReceipt, type JobForGuess, type ReceiptRead } from './receipt';

const TODAY = '2026-11-19';

describe('a receipt as an expense', () => {
  it('takes the grand total, the VAT as printed, the seller, the date and the lines', () => {
    const r = receiptExpense(
      {
        isReceipt: true,
        vendor: ' Al Quoz Auto Parts ',
        invoiceNo: 'A-1042',
        date: '2026-11-18',
        items: [
          { name: 'Oil filter', partNumber: '90915-yzze1', qty: 1, unitPrice: 35, total: 35 },
          { name: 'Brake pads front', qty: 2, unitPrice: 120, total: 240 },
        ],
        subtotal: 275,
        vat: 13.75,
        total: 288.75,
        paymentMethod: 'cash',
        confidence: 0.9,
      },
      TODAY,
    );
    expect(r.ok).toBe(true);
    expect([r.amountFils, r.vatFils, r.vendor, r.date, r.method]).toEqual([28875, 1375, 'Al Quoz Auto Parts', '2026-11-18', 'cash']);
    // v0.77: the note is the paper's number; the positions are a list of their own (`items` → `Expense.lines`).
    expect(r.note).toBe('#A-1042');
    // The lines were printed without VAT (they add up to the subtotal): their net is as printed.
    expect(r.items.map((i) => [i.name, i.qty, i.partNumber, i.unitNetFils, i.lineNetFils])).toEqual([
      ['OIL FILTER', 1, '90915-YZZE1', 3500, 3500],
      ['BRAKE PADS FRONT', 2, undefined, 12000, 24000],
    ]);
    expect(r.vatShareBp).toBe(500);
  });

  it('invents no VAT and no total: none printed — none; a total and a subtotal — their difference', () => {
    expect(receiptExpense({ isReceipt: true, items: [{ name: 'Bulb', total: 20 }], total: 20, confidence: 0.8 }, TODAY)).toMatchObject({ amountFils: 2000, vatFils: 0, vatShareBp: 0 });
    expect(receiptExpense({ isReceipt: true, items: [], subtotal: 100, total: 105, confidence: 0.8 }, TODAY)).toMatchObject({ amountFils: 10500, vatFils: 500 });
    // No total printed: the subtotal plus the VAT printed; neither — the lines' sum.
    expect(receiptExpense({ isReceipt: true, items: [], subtotal: 100, vat: 5, confidence: 0.8 }, TODAY)).toMatchObject({ amountFils: 10500, vatFils: 500 });
    expect(receiptExpense({ isReceipt: true, items: [{ name: 'A', total: 10 }, { name: 'B', qty: 2, unitPrice: 5 }], confidence: 0.8 }, TODAY)).toMatchObject({ amountFils: 2000, vatFils: 0 });
  });

  it('lines printed with VAT in them are taken down to their net', () => {
    const r = receiptExpense({ isReceipt: true, items: [{ name: 'Pads', total: 105 }, { name: 'Disc', total: 210 }], subtotal: 300, vat: 15, total: 315, confidence: 0.9 }, TODAY);
    expect(r.items.map((i) => i.lineNetFils)).toEqual([10000, 20000]);
  });

  it('the way of payment and the date as the paper says, else cash and today', () => {
    const base = { isReceipt: true, items: [], total: 50, confidence: 0.9 };
    expect(receiptExpense({ ...base, paymentMethod: 'Card' }, TODAY).method).toBe('card');
    expect(receiptExpense({ ...base, paymentMethod: 'bank transfer' }, TODAY).method).toBe('transfer');
    expect(receiptExpense({ ...base, paymentMethod: 'credit' }, TODAY).method).toBe('credit');
    expect(receiptExpense({ ...base, date: '2026-12-01' }, TODAY).date).toBe(TODAY);
    expect(receiptExpense({ ...base, date: '2024-01-01' }, TODAY).date).toBe(TODAY);
    expect(receiptExpense({ ...base, date: '2026-11-01' }, TODAY).date).toBe('2026-11-01');
  });

  it('is no expense without a sum, or when the picture is no receipt', () => {
    expect(receiptExpense({ isReceipt: true, items: [{ name: 'A' }], confidence: 0.9 }, TODAY).ok).toBe(false);
    expect(receiptExpense({ isReceipt: false, items: [], total: 100, confidence: 0.9 }, TODAY).ok).toBe(false);
    expect(receiptExpense({ isReceipt: true, items: [], total: 100, confidence: 0.2 }, TODAY).ok).toBe(false);
  });
});

describe('the job the parts were bought for', () => {
  const job = (id: string, number: number, lines: (string | { name: string; partNumber?: string; costFils?: number; supplierId?: string })[], car = { make: 'Toyota', model: 'Camry', plateNumber: '12345' }, changedAt = '2026-11-10', openedOn = '2026-11-01'): JobForGuess => ({
    id,
    number,
    changedAt,
    openedOn,
    lines: lines.map((l, i) => ({ id: `${id}-${i}`, ...(typeof l === 'string' ? { name: l } : l) })),
    car,
  });
  const camry = job('a', 351, ['FRONT BRAKE PADS', 'OIL FILTER']);
  const patrol = job('b', 352, ['OIL FILTER', 'AIR FILTER'], { make: 'Nissan', model: 'Patrol', plateNumber: '80769' });
  const canter = job('c', 371, ['REAR STOP LIGHT LEFT & RIGHT', 'MUD GUARD REAR LEFT RIGHT'], { make: 'Fuso', model: 'Canter', plateNumber: '44021' });
  const canter2 = job('d', 382, ['AC EVAPORATOR NEW ORIGINAL'], { make: 'Fuso', model: 'Canter', plateNumber: '51177' });
  const pajero = job('e', 302, ['ENGINE BELT', 'TENSIONER', 'TENSIONER PULLEY'], { make: 'Mitsubishi', model: 'Pajero', plateNumber: '30902' });
  const urvan = job('f', 380, ['TENSIONER PULLEY'], { make: 'Nissan', model: 'Urvan', plateNumber: '77310' }, '2026-11-18');
  const guess = (items: Parameters<typeof rankJobs>[0], jobs: JobForGuess[], ctx: Parameters<typeof rankJobs>[2] = {}) => guessJob(rankJobs(items, jobs, ctx));

  it('is the one whose lines name the parts — by the dictionary’s key under any words, or by what the part is', () => {
    const g = guess([{ name: 'КОЛОДКИ ТОРМОЗНЫЕ ПЕРЕДНИЕ' }, { name: 'OIL FILTER 90915-YZZE1' }], [camry, patrol]);
    expect(g).toMatchObject({ orderId: 'a', number: 351, close: false, by: 'app' });
    expect(g!.matched.map((m) => [m.item, m.lineId])).toEqual([
      [0, 'a-0'],
      [1, 'a-1'],
    ]);
    expect(guess([{ name: 'Air filter element' }], [camry, patrol])).toMatchObject({ orderId: 'b' });
  });

  it('the garage’s real papers: a truck’s «TALLLAMP COVER» and «MUD FLAP» are its «REAR STOP LIGHT» and «MUD GUARD»; «FEBEST PULLY» with PAJERO on the paper is the Pajero’s pulley, not a Nissan’s', () => {
    const jobs = [camry, patrol, canter, canter2, pajero, urvan];
    const truck = guess([{ name: 'CANTER TALLLAMP COVER 96 -2013', car: 'CANTER' }, { name: 'MUD FLAP 2.5 TON' }], jobs);
    expect(truck).toMatchObject({ orderId: 'c', number: 371, close: false });
    expect(truck!.matched.map((m) => m.lineId)).toEqual(['c-0', 'c-1']);
    expect(guess([{ name: 'FEBEST PULLY 14 FEB', part: 'PULLY' }], jobs, { carText: 'DCT 10 PAJERO 4-1.30 X 7' })).toMatchObject({ orderId: 'e', number: 302 });
    // Without the car on the paper, the two pulleys are alike: the fresher one, to be looked at.
    expect(guess([{ name: 'FEBEST PULLY 14 FEB' }], jobs)).toMatchObject({ orderId: 'f', close: true });
  });

  it('the car on the paper decides between two jobs with the same part; a line naming another car is none of its; none fits — no job', () => {
    expect(guess([{ name: 'OIL FILTER' }], [camry, patrol], { carText: 'Nissan Patrol' })).toMatchObject({ orderId: 'b', close: false });
    expect(guess([{ name: 'OIL FILTER' }], [camry, patrol])).toMatchObject({ orderId: 'a', close: true });
    expect(guess([{ name: 'NISSAN OIL FILTER' }], [camry])).toBeUndefined();
    expect(guess([{ name: 'WIPER BLADES' }], [camry, patrol])).toBeUndefined();
    expect(guess([], [camry, patrol])).toBeUndefined();
    // The plate's digits on the paper.
    expect(guess([{ name: 'OIL FILTER' }], [camry, patrol], { paperText: 'Vehicle 80769' })).toMatchObject({ orderId: 'b', close: false });
  });

  it('the same part number is the surest; the price as typed on the line and the line already on this seller count too', () => {
    const a = job('x', 400, [{ name: 'FILTER', partNumber: '90915-YZZE1' }]);
    const b = job('y', 401, ['OIL FILTER'], camry.car, '2026-11-15');
    expect(guess([{ name: 'OIL FILTER', partNumber: '90915YZZE1' }], [a, b])).toMatchObject({ orderId: 'x', close: false });
    const c = job('z', 402, [{ name: 'OIL FILTER', costFils: 3500 }]);
    expect(rankJobs([{ name: 'OIL FILTER', unitNetFils: 3500 }], [b, c])[0]).toMatchObject({ orderId: 'z', score: 1.3 });
    const d = job('w', 403, [{ name: 'OIL FILTER', supplierId: 's1' }]);
    expect(rankJobs([{ name: 'OIL FILTER' }], [b, d], { supplierId: 's1' })[0]).toMatchObject({ orderId: 'w', score: 1.2 });
  });

  it('a job opened after the receipt’s day is not it', () => {
    const later = job('n', 410, ['OIL FILTER'], camry.car, '2026-11-19', '2026-11-19');
    expect(guess([{ name: 'OIL FILTER' }], [later], { date: '2026-11-17' })).toBeUndefined();
    expect(guess([{ name: 'OIL FILTER' }], [later], { date: '2026-11-19' })).toMatchObject({ orderId: 'n' });
  });

  it('one line of the job takes one line of the receipt; the surest pairs first', () => {
    const ranked = rankJobs([{ name: 'OIL FILTER' }, { name: 'OIL FILTER' }, { name: 'COOLANT' }], [patrol]);
    expect(ranked[0].matched).toHaveLength(1);
    expect(ranked[0].score).toBe(1);
  });

  // v0.73 (the user: «независимо в каком статусе находится заказ… даже если в архиве программа нашла совпадение и добавила»).
  it('a job closed or cancelled long before the receipt is found when it alone fits; among equals a job still in work comes first; two old ones alike — none put, both offered', () => {
    const gone = (id: string, number: number, lines: string[], car = camry.car, goneOn = '2026-10-20', changedAt = goneOn): JobForGuess => ({ ...job(id, number, lines, car, changedAt, '2026-10-01'), goneOn });
    const pajeroOld = gone('g', 290, ['CLUTCH SET', 'CLUTCH COVER ASSY'], { make: 'Mitsubishi', model: 'Pajero', plateNumber: '84264' });
    // Closed a month before the paper: still found — and its lines matched.
    const g = guess([{ name: 'CLUTCH SET GP' }, { name: 'COC ASSY', part: 'CLUTCH COVER' }], [camry, patrol, pajeroOld], { date: '2026-11-23' });
    expect(g).toMatchObject({ orderId: 'g', number: 290, close: false });
    expect(g!.matched.map((m) => m.lineId)).toContain('g-0');
    // Closed up to three days before: as a job in work.
    expect(rankJobs([{ name: 'CLUTCH SET' }], [gone('h', 291, ['CLUTCH SET'], camry.car, '2026-11-21')], { date: '2026-11-23' })[0].gone).toBeUndefined();
    expect(rankJobs([{ name: 'CLUTCH SET' }], [pajeroOld], { date: '2026-11-23' })[0].gone).toBe(true);
    // The same part on a job in work and on an old one (fresher, even): the one in work first.
    const oldCamry = gone('k', 300, ['OIL FILTER'], camry.car, '2026-10-20', '2026-11-22');
    const ranked = rankJobs([{ name: 'OIL FILTER' }], [oldCamry, camry], { date: '2026-11-23' });
    expect(ranked.map((r) => r.orderId)).toEqual(['a', 'k']);
    expect(guessJob(ranked)).toMatchObject({ orderId: 'a', close: true });
    // Only old ones, alike: none put on the expense (it would be a guess among many), both a tap away.
    const twoOld = rankJobs([{ name: 'OIL FILTER' }], [oldCamry, gone('m', 301, ['OIL FILTER'])], { date: '2026-11-23' });
    expect(twoOld.map((r) => r.score)).toEqual([1, 1]);
    expect(guessJob(twoOld)).toBeUndefined();
    // A cancelled one counts too; one opened after the paper still does not.
    expect(guess([{ name: 'CLUTCH SET' }], [{ ...pajeroOld, openedOn: '2026-11-24' }], { date: '2026-11-23' })).toBeUndefined();
  });
});

describe('a receipt’s day', () => {
  const T = '2026-11-19';
  it('is read as printed, day first, as UAE papers write it', () => {
    expect(printedDate('18-Nov-2026')).toBe('2026-11-18');
    expect(printedDate('Date: 05/11/2026')).toBe('2026-11-05');
    expect(printedDate('17/11/26')).toBe('2026-11-17');
    expect(printedDate('11/25/2026')).toBe('2026-11-25');
    expect(printedDate('Nov 3, 2026')).toBe('2026-11-03');
    expect(printedDate('2026-11-04')).toBe('2026-11-04');
    expect(printedDate('31/02/2026')).toBeUndefined();
    expect(receiptDate({ dateText: '05/11/2026', date: '2026-05-11' }, T)).toEqual({ date: '2026-11-05', sure: false });
    expect(receiptDate({ dateText: '17-Nov-2026', date: '2026-11-17', dateSure: true }, T)).toEqual({ date: '2026-11-17', sure: true });
  });

  it('a year under a stamp («19-Nov-202?» read 2024 or 2023) is this year’s or last year’s day — whichever has passed — and not sure', () => {
    expect(receiptDate({ dateText: '19-Nov-2024', date: '2024-11-19', dateSure: false }, T)).toEqual({ date: '2026-11-19', sure: false });
    expect(receiptDate({ date: '2023-11-19' }, T)).toEqual({ date: '2026-11-19', sure: false });
    // Put right only to a recent day; else today.
    expect(receiptDate({ dateText: '20-Dec-2026' }, T)).toEqual({ date: T, sure: false });
    expect(receiptDate({ date: '2024-01-01' }, T)).toEqual({ date: T, sure: false });
    // Day and month swapped into the future: put back.
    expect(receiptDate({ date: '2026-12-11' }, T)).toEqual({ date: '2026-11-12', sure: false });
    expect(receiptDate({}, T)).toEqual({ date: T, sure: false });
    expect(receiptDate({ dateText: '', date: '' }, T)).toEqual({ date: T, sure: false });
  });
});

describe('the seller as a supplier of the garage’s', () => {
  const fields = (over: Partial<ReceiptRead> = {}) =>
    receiptExpense(
      {
        isReceipt: true,
        vendor: 'AL QUOZ AUTO SPARE PARTS TR. L.L.C.',
        vendorTrn: '100234567800003',
        vendorPhone: '050 442 1190',
        vendorAddress: 'Al Quoz Ind. Area 3, Dubai',
        kind: 'parts',
        items: [{ name: 'Oil filter', total: 35 }, { name: 'Air filter element', total: 85 }],
        total: 120,
        confidence: 0.9,
        ...over,
      },
      TODAY,
    );

  it('is the name, the phone and the address as printed, the car’s make, what it sold, the TRN in the notes', () => {
    expect(supplierFromReceipt(fields(), 'Toyota')).toEqual({
      name: 'AL QUOZ AUTO SPARE PARTS TR. L.L.C.',
      phone: '050 442 1190',
      address: 'Al Quoz Ind. Area 3, Dubai',
      makes: ['Toyota'],
      service: undefined,
      parts: 'OIL FILTER, AIR FILTER ELEMENT',
      notes: 'TRN 100234567800003',
    });
    expect(supplierFromReceipt(fields(), '')).toMatchObject({ makes: undefined });
  });

  it('a contractor’s bill makes a contractor; fuel, food and a name not worth the word make none', () => {
    expect(supplierFromReceipt(fields({ kind: 'service', vendor: 'SPEED PAINT SHOP' }), 'Nissan')).toMatchObject({ name: 'SPEED PAINT SHOP', service: true, makes: ['Nissan'] });
    expect(supplierFromReceipt(fields({ kind: 'fuel', vendor: 'ENOC' }))).toBeUndefined();
    expect(supplierFromReceipt(fields({ kind: 'food' }))).toBeUndefined();
    expect(supplierFromReceipt(fields({ vendor: 'A1' }))).toBeUndefined();
    expect(supplierFromReceipt(fields({ vendor: '' }))).toBeUndefined();
  });

  it('the paper’s kind as the server says it; a reading without one is a parts shop’s', () => {
    expect(fields().kind).toBe('parts');
    expect(fields({ kind: undefined }).kind).toBe('parts');
    expect(fields({ kind: 'service' }).kind).toBe('service');
    expect(fields({ kind: 'fuel' }).kind).toBe('fuel');
    expect(fields({ kind: 'weird' }).kind).toBe('other');
    expect([fields().vendorPhone, fields().vendorTrn, fields().vendorAddress]).toEqual(['050 442 1190', '100234567800003', 'Al Quoz Ind. Area 3, Dubai']);
  });
});
