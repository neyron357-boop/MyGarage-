import { describe, expect, it } from 'vitest';
import { cleanPaperLines, expenseNoteLine, paperListText, paperOf } from './paperLines';

describe("a supplier's paper by its positions (v0.77)", () => {
  it('kept by themselves: as they are, the note beside them', () => {
    const e = { note: '#98352', lines: [{ name: 'SWITCH ON OFF 3PIN D', qty: 2 }, { name: 'RELAY 12V', qty: 1 }], receiptMediaId: 'm1' };
    expect(paperOf(e)).toEqual({ note: '#98352', lines: e.lines });
    // Every one-line view — as before v0.77.
    expect(expenseNoteLine(e)).toBe('#98352 · SWITCH ON OFF 3PIN D ×2 · RELAY 12V');
    expect(expenseNoteLine({ lines: e.lines })).toBe('SWITCH ON OFF 3PIN D ×2 · RELAY 12V');
  });

  it('a receipt recorded before: read out of the note it wrote', () => {
    expect(paperOf({ note: '#98352 · SWITCH ON OFF 3PIN D ×2 · RELAY 12V', receiptMediaId: 'm1' })).toEqual({
      note: '#98352',
      lines: [
        { name: 'SWITCH ON OFF 3PIN D', qty: 2 },
        { name: 'RELAY 12V', qty: 1 },
      ],
    });
    // A number alone with one position; no number — two at least; a part of a litre.
    expect(paperOf({ note: '#A 17 · OIL 5W30 ×4.5', receiptMediaId: 'm1' })).toEqual({ note: '#A 17', lines: [{ name: 'OIL 5W30', qty: 4.5 }] });
    expect(paperOf({ note: 'OIL FILTER · BRAKE PADS ×2', receiptMediaId: 'm1' }).lines).toHaveLength(2);
    // The same line back: the old note is shown as it was everywhere.
    expect(expenseNoteLine({ note: '#98352 · SWITCH ON OFF 3PIN D ×2 · RELAY 12V', receiptMediaId: 'm1' })).toBe('#98352 · SWITCH ON OFF 3PIN D ×2 · RELAY 12V');
  });

  it('a note typed by the manager is a note: no receipt photo, small letters, one piece without a number', () => {
    expect(paperOf({ note: 'OIL FILTER · BRAKE PADS', receiptMediaId: undefined })).toEqual({ note: 'OIL FILTER · BRAKE PADS', lines: [] });
    expect(paperOf({ note: '#98352 · paid by Ali', receiptMediaId: 'm1' })).toEqual({ note: '#98352 · paid by Ali', lines: [] });
    expect(paperOf({ note: 'BRAKE PADS', receiptMediaId: 'm1' })).toEqual({ note: 'BRAKE PADS', lines: [] });
    expect(paperOf({ note: undefined, receiptMediaId: 'm1' })).toEqual({ note: undefined, lines: [] });
  });

  it('a numbered list to share, a line each', () => {
    expect(paperListText([{ name: 'SWITCH ON OFF 3PIN D', qty: 2 }, { name: 'RELAY 12V', qty: 1 }])).toEqual(['1. SWITCH ON OFF 3PIN D × 2', '2. RELAY 12V']);
  });

  it('keeps names and how many: none — none, no quantity — one', () => {
    expect(cleanPaperLines([{ name: '  BULB ', qty: 0 }, { name: ' ', qty: 3 }])).toEqual([{ name: 'BULB', qty: 1 }]);
    expect(cleanPaperLines([])).toBeUndefined();
    expect(cleanPaperLines(Array.from({ length: 80 }, (_, i) => ({ name: `P${i}`, qty: 1 })))).toHaveLength(60);
  });
});
