import { describe, expect, it } from 'vitest';
import { printedDate, receiptExpense } from './receipt';
import { cleanName, knownSellerOf, mergePapers, moneyOf, paperRows, readPaper, type PaperWord } from './receiptText';

/*
 * Invented papers only (the garage's real ones stay out of the repository): each line of text laid out as the OCR
 * would give it — every word with its place.
 */
type Line = [x: number, y: number, text: string];
const W = 14;
function paper(lines: Line[], tilt = 0): PaperWord[] {
  const out: PaperWord[] = [];
  for (const [x0, y0, text] of lines) {
    let x = x0;
    for (const t of text.split(' ').filter(Boolean)) {
      const w = t.length * W;
      const y = y0 + tilt * x;
      out.push({ text: t, conf: 90, x0: x, y0: y, x1: x + w, y1: y + 22 });
      x += w + W;
    }
  }
  return out;
}
const ctx = { garageName: 'RUKN ZAMZAM GARAGE LLC', garageTrn: '100999888700003' };

/** A dot-matrix form as a parts shop prints it: its header, the buyer, the date, the table, the totals' boxes. */
const FORM: Line[] = [
  [100, 60, 'GULF STAR'],
  [100, 100, 'AUTO SPARE PARTS TRADING L.L.C'],
  [100, 140, 'Mob: 050 1234567 , 055 7654321'],
  [100, 170, 'Email: gulfstarparts@gmail.com'],
  [100, 200, 'TRN: 100123456700003'],
  [100, 230, 'Invoice No. 51234'],
  [700, 240, 'TAX INVOICE'],
  [100, 280, 'RUKN ZAMZAM GARAGE LLC'],
  [900, 280, 'DATE : 17-Nov-2026'],
  [100, 320, 'TRN: 100999888700003'],
  [900, 320, 'Sales Type : Sales Credit'],
  [900, 360, 'OUR TRN : 100123456700003'],
  [100, 420, 'No. Description Qty Unit Price Tax% Tax Amount Total Amount'],
  [100, 470, '1 CANTER TAIL LAMP COVER'],
  [700, 470, '2 15.00 5% 1.50 31.50'],
  [100, 510, '2 MUD FLAP 2.5 TON'],
  [700, 510, '1 35.00 5% 1.75 36.75'],
  [100, 900, 'GROSS AMT. 65.00'],
  [500, 900, 'DISCOUNT'],
  [800, 900, 'VAT AMOUNT 3.25'],
  [100, 950, 'IN WORDS UAE Dirhams Sixty Eight and Twenty Five Fils Only'],
  [900, 950, 'NET AMT. DHS. 68.25'],
  [800, 1000, 'For GULF STAR AUTO SPARE PARTS TRADING L.L.C'],
];

describe('a paper read on the phone', () => {
  it('proves its own sum — the amount, its 5 % VAT and the total among the figures — and reads its date, number, seller, way and lines', () => {
    const r = readPaper(paper(FORM), 1200, ctx);
    expect(r.sure).toBe(true);
    expect(r.read).toMatchObject({ total: 68.25, vat: 3.25, subtotal: 65, date: '2026-11-17', invoiceNo: '51234', vendorTrn: '100123456700003', vendorEmail: 'gulfstarparts@gmail.com', paymentMethod: 'credit', kind: 'parts' });
    expect(r.read.vendor).toBe('GULF STAR AUTO SPARE PARTS TRADING L.L.C');
    expect(r.read.items!.map((i) => [i.name, i.qty, i.total])).toEqual([
      ['CANTER TAIL LAMP COVER', 2, 31.5],
      ['MUD FLAP', 1, 36.75],
    ]);
    const f = receiptExpense(r.read, '2026-11-19');
    expect([f.amountFils, f.vatFils, f.date, f.method]).toEqual([6825, 325, '2026-11-17', 'credit']);
    expect(f.items.map((i) => i.lineNetFils)).toEqual([3000, 3500]);
  });

  it('its totals’ boxes unread: its lines, each proven by its own VAT, added up; one line’s three figures are not the paper’s', () => {
    const noTotals = FORM.filter(([, y]) => y < 900);
    const r = readPaper(paper(noTotals), 1200, ctx);
    expect(r.read).toMatchObject({ total: 68.25, vat: 3.25 });
    expect(r.sure).toBe(true);
    expect(r.why.join(' ')).toMatch(/36\.75 is a line's/);
    // A line whose price is misread («550.00» as «560.0») is still proven by its VAT and its total.
    const misread = noTotals.map(([x, y, t]): Line => [x, y, t.replace('1 35.00 5% 1.75 36.75', '1 36.0 5% 1.75 36.75')]);
    expect(readPaper(paper(misread), 1200, ctx).read).toMatchObject({ total: 68.25, vat: 3.25 });
    // A line not proven: no sum to take.
    const broken = noTotals.map(([x, y, t]): Line => [x, y, t.replace('1 35.00 5% 1.75 36.75', '1 35.00 5%')]);
    expect(readPaper(paper(broken), 1200, ctx).sure).toBe(false);
  });

  it('a photo’s tilt: the rows follow it', () => {
    const tilted = paper(FORM, 0.04);
    expect(readPaper(tilted, 1200, ctx, 0).read.items!.length).toBeLessThan(2);
    const level = readPaper(tilted, 1200, ctx, 0.04);
    expect(level.read.items!.map((i) => i.name)).toEqual(['CANTER TAIL LAMP COVER', 'MUD FLAP']);
    expect(paperRows(tilted, 0.04).some((r) => r.text.startsWith('1 CANTER TAIL LAMP COVER 2 15.00'))).toBe(true);
  });

  it('a card slip on the paper — the card, whatever the form says; «Paid on Cash» — cash; nothing said — cash', () => {
    const slip: Line[] = [...FORM, [60, 600, 'MASTERCARD(Contactless)'], [60, 630, 'APPROVAL CODE: 065171'], [60, 660, 'AMOUNT: 68.25']];
    expect(readPaper(paper(slip), 1200, ctx).read.paymentMethod).toBe('card');
    const cash = FORM.map(([x, y, t]): Line => [x, y, t.replace('Sales Type : Sales Credit', 'Paid on Cash 17/11/2026')]);
    expect(readPaper(paper(cash), 1200, ctx).read.paymentMethod).toBe('cash');
  });

  it('a card slip alone: its amount, no VAT on it', () => {
    const r = readPaper(paper([[100, 100, 'NEOPAY'], [100, 140, 'GULF STAR AUTO SPARE PART'], [100, 180, 'DATE: 17/11/26 TIME: 15:44:31'], [100, 220, 'SALE'], [100, 260, 'MASTERCARD(Contactless)'], [100, 300, 'AMOUNT: 189.00'], [100, 340, 'APPROVAL CODE: R86375'], [100, 380, '<<MERCHANT COPY>>']]), 500, ctx);
    expect(r.read).toMatchObject({ total: 189, vat: 0, paymentMethod: 'card', date: '2026-11-17' });
    expect(r.sure).toBe(true);
  });

  it('the garage’s own TRN and name are the buyer’s, not the seller’s', () => {
    const r = readPaper(paper(FORM.filter(([, , t]) => !t.includes('100123456700003'))), 1200, ctx);
    expect(r.read.vendorTrn).toBeUndefined();
    expect(r.read.vendor).not.toMatch(/RUKN/);
  });

  it('a known supplier: by its TRN, its e-mail, its phone or its name however the OCR parts the words', () => {
    const known = [{ id: 's1', name: 'Gulf Star Auto Spare Parts Trading LLC', trn: '100123456700003' }];
    const r = readPaper(paper(FORM), 1200, { ...ctx, known });
    expect([r.seller?.id, r.read.vendor]).toEqual(['s1', 'Gulf Star Auto Spare Parts Trading LLC']);
    expect(knownSellerOf('Email: gulfstarparts@gmail.com', [], [{ id: 'e', name: 'X Y', email: 'gulfstarparts@gmail.com' }])?.id).toBe('e');
    expect(knownSellerOf('Mob: 050 123 4567', [], [{ id: 'p', name: 'X Y', phones: ['+971501234567'] }])?.id).toBe('p');
    expect(knownSellerOf('GULFSTAR AUTO SPARE PART S TRADING', [], [{ id: 'n', name: 'Gulf Star Auto Spare Parts Trading LLC' }])?.id).toBe('n');
    expect(knownSellerOf('ANOTHER SHOP', [], known)).toBeUndefined();
  });

  it('a seller not known and its name not read clean: not sure (the AI reads that one paper)', () => {
    const messy = FORM.map(([x, y, t]): Line => [x, y, t.replace('GULF STAR', 'G~L ¢ =').replace('AUTO SPARE PARTS TRADING L.L.C', 'AU 9 =').replace('For GULF STAR AUTO SPARE PARTS TRADING L.L.C', '')]).filter(([, , t]) => t);
    const r = readPaper(paper(messy), 1200, ctx);
    expect(r.read.total).toBe(68.25);
    expect(r.sure).toBe(false);
    expect(cleanName('GULF STAR AUTO PARTS')).toBe(true);
    expect(cleanName('AL ROOF ERE 8 9 AUTO')).toBe(false);
  });
});

describe('two readings of one paper', () => {
  const a = readPaper(paper(FORM), 1200, ctx);
  it('the same date twice — sure; the sum proven by either', () => {
    const m = mergePapers(a, readPaper(paper(FORM), 1200, ctx))!;
    expect([m.sure, m.read.date, m.read.dateSure]).toEqual([true, '2026-11-17', true]);
    const noSum = readPaper(paper(FORM.filter(([, y]) => y < 460 || y > 960)), 1200, ctx);
    expect(mergePapers(noSum, a)).toMatchObject({ sure: true, read: { total: 68.25 } });
  });

  it('two dates apart — the labelled one, not sure; two sums apart — not sure at all', () => {
    const otherDay = readPaper(paper(FORM.map(([x, y, t]): Line => [x, y, t.replace('17-Nov-2026', '7-Nov-2026')])), 1200, ctx);
    const m = mergePapers(a, otherDay)!;
    expect([m.sure, m.read.dateSure]).toEqual([true, false]);
    const otherSum = readPaper(paper(FORM.map(([x, y, t]): Line => [x, y, t.replace('68.25', '78.75').replace('65.00', '75.00').replace('3.25', '3.75')])), 1200, ctx);
    expect(mergePapers(a, otherSum)!.sure).toBe(false);
  });

  it('no date in either — not sure (the AI, or the sheet)', () => {
    const undated = readPaper(paper(FORM.filter(([, , t]) => !t.includes('DATE'))), 1200, ctx);
    expect(mergePapers(undated, undated)!.sure).toBe(false);
  });
});

describe('figures and dates as OCR reads them', () => {
  it('figures', () => {
    expect(['1,470.00', '76.190', 'Đ136.00', 'AED', '75.0C', '1.4OO.OO', '560.0', '12345', 'S5.00'].map(moneyOf)).toEqual([1470, 76.19, 136, undefined, 75, undefined, 560, undefined, 55]);
  });
  it('a month within a letter', () => {
    expect(printedDate('4-Qct-2026')).toBe('2026-10-04');
    expect(printedDate('19-N0v-2026')).toBe('2026-11-19');
    expect(printedDate('5-Oct-26')).toBe('2026-10-05');
  });
});
