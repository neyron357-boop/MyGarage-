import { describe, expect, it } from 'vitest';
import { guessJob, receiptExpense, supplierFromReceipt, type JobForGuess, type ReceiptRead } from './receipt';

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
    expect(r.note).toBe('#A-1042 · OIL FILTER · BRAKE PADS FRONT ×2');
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
  const job = (id: string, number: number, lines: string[], car = { make: 'Toyota', model: 'Camry', plateNumber: '12345' }, changedAt = '2026-11-10'): JobForGuess => ({
    id,
    number,
    changedAt,
    lines: lines.map((name, i) => ({ id: `${id}-${i}`, name })),
    car,
  });
  const camry = job('a', 351, ['FRONT BRAKE PADS', 'OIL FILTER']);
  const patrol = job('b', 352, ['OIL FILTER', 'AIR FILTER'], { make: 'Nissan', model: 'Patrol', plateNumber: '80769' });

  it('is the one whose lines name the parts — by the dictionary’s key under any words, or by most of their words', () => {
    const g = guessJob([{ name: 'КОЛОДКИ ТОРМОЗНЫЕ ПЕРЕДНИЕ' }, { name: 'OIL FILTER 90915-YZZE1' }], '', [camry, patrol]);
    expect(g).toMatchObject({ orderId: 'a', number: 351, close: false });
    expect(g!.matched.map((m) => [m.item, m.lineId, m.how])).toEqual([
      [0, 'a-0', 'key'],
      [1, 'a-1', 'key'],
    ]);
    expect(guessJob([{ name: 'Air filter element' }], '', [camry, patrol])).toMatchObject({ orderId: 'b' });
  });

  it('the car named on the paper decides between two jobs with the same part; none fits — no job', () => {
    expect(guessJob([{ name: 'OIL FILTER' }], 'Nissan Patrol 80769', [camry, patrol])).toMatchObject({ orderId: 'b', close: false });
    expect(guessJob([{ name: 'OIL FILTER' }], '', [camry, patrol])).toMatchObject({ orderId: 'a', close: true });
    expect(guessJob([{ name: 'WIPER BLADES' }], '', [camry, patrol])).toBeUndefined();
    expect(guessJob([], '', [camry, patrol])).toBeUndefined();
  });

  it('one line of the job takes one line of the receipt; a part on no job is no match', () => {
    const g = guessJob([{ name: 'OIL FILTER' }, { name: 'OIL FILTER' }, { name: 'COOLANT' }], '', [patrol])!;
    expect(g.matched).toHaveLength(1);
    expect(g.score).toBe(1);
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
