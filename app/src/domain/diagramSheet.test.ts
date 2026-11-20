import { describe, expect, it } from 'vitest';
import { CELL, diagramOf, fitInto, fitMark, MARK_SIZES, ringOn, sheetEntries, sheetLayout, sheetName, sheetsOf, stepMark } from './diagramSheet';

const part = (id: string, extra: Record<string, unknown> = {}) => ({ id, titleEn: `PART ${id}`, titleRu: '', qty: 1, ...extra });

describe('the diagrams sheet for a supplier (v0.59)', () => {
  it('numbers the cells as the list sent — only parts with a diagram, the ringed diagram first', () => {
    const items = [
      part('a', { diagramIds: ['d1', 'd2'], partNumber: ' 123 ' }),
      part('b'),
      part('c', { diagramIds: ['d3', 'd4'], diagramMark: { id: 'd4', x: 0.5, y: 0.25, r: 0.09 }, qty: 2 }),
      part('d', { diagramIds: ['d5'], diagramMark: { id: 'gone', x: 0.5, y: 0.5, r: 0.09 } }),
    ];
    const e = sheetEntries(items);
    expect(e.map((x) => [x.n, x.diagramId, !!x.mark])).toEqual([
      [1, 'd1', false],
      [3, 'd4', true],
      [4, 'd5', false],
    ]);
    expect(e[0].partNumber).toBe('123');
    expect(e[1].qty).toBe(2);
    expect(diagramOf({ diagramIds: [] })).toBeUndefined();
  });

  it('four to a sheet', () => {
    expect(sheetsOf([1, 2, 3, 4, 5, 6, 7, 8, 9]).map((s) => s.length)).toEqual([4, 4, 1]);
    expect(sheetsOf([])).toEqual([]);
    expect(sheetName(0, 1, 'png')).toBe('parts-1.png');
    expect(sheetName(1, 3, 'jpg')).toBe('parts-2-of-3.jpg');
  });

  it('lays the cells out: one alone, two side by side, three with the last centred, four two by two', () => {
    const one = sheetLayout(1);
    expect(one.cells).toHaveLength(1);
    expect(one.cells[0].pic.w).toBe(CELL);
    const two = sheetLayout(2);
    expect(two.width).toBeGreaterThan(2 * CELL);
    expect(two.cells[0].cell.y).toBe(two.cells[1].cell.y);
    const three = sheetLayout(3);
    expect(three.cells[2].cell.x + three.cells[2].cell.w / 2).toBeCloseTo(three.width / 2);
    const four = sheetLayout(4);
    expect(four.cells[3].cell.y).toBeGreaterThan(four.cells[0].cell.y);
    // no cell outside the sheet, none over another
    for (const l of [one, two, three, four]) {
      for (const c of l.cells) {
        expect(c.cell.x).toBeGreaterThanOrEqual(0);
        expect(c.cell.x + c.cell.w).toBeLessThanOrEqual(l.width);
        expect(c.cell.y + c.cell.h).toBeLessThanOrEqual(l.height);
      }
    }
  });

  it('fits a diagram whole and puts the ring where the finger was', () => {
    const d = fitInto(2000, 1000, { x: 0, y: 100, w: 1000, h: 1000 }, 0);
    expect(d).toEqual({ x: 0, y: 350, w: 1000, h: 500 });
    const r = ringOn({ id: 'x', x: 0.5, y: 0.5, r: 0.1 }, d);
    expect(r).toEqual({ cx: 500, cy: 600, r: 50 });
  });

  it('keeps a ring sane and steps its size', () => {
    expect(fitMark({ id: 'x', x: -1, y: 2, r: 9 })).toEqual({ id: 'x', x: 0, y: 1, r: MARK_SIZES[MARK_SIZES.length - 1] });
    expect(fitMark({ id: 'x', x: Number.NaN, y: 0.5, r: 0 }).x).toBe(0);
    expect(stepMark(0.09, 1)).toBe(0.13);
    expect(stepMark(0.09, -1)).toBe(0.06);
    expect(stepMark(MARK_SIZES[0], -1)).toBe(MARK_SIZES[0]);
  });
});
