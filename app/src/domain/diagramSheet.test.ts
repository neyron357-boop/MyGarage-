import { describe, expect, it } from 'vitest';
import { CELL, diagramOf, fitInto, fitMark, fromOldRing, MARK_MAX, MARK_MIN, markAtTap, markFromBox, marksOf, MAX_MARKS, onMark, ovalOn, scaleMark, sheetEntries, sheetLayout, sheetName, sheetsOf } from './diagramSheet';

const part = (id: string, extra: Record<string, unknown> = {}) => ({ id, titleEn: `PART ${id}`, titleRu: '', qty: 1, ...extra });
const oval = (id: string, x = 0.5, y = 0.5, rx = 0.1, ry = 0.1) => ({ id, x, y, rx, ry });

describe('the diagrams sheet for a supplier (v0.59, v0.59.1)', () => {
  it('numbers the cells as the list sent — only parts with a diagram, the outlined diagram first', () => {
    const items = [
      part('a', { diagramIds: ['d1', 'd2'], partNumber: ' 123 ' }),
      part('b'),
      part('c', { diagramIds: ['d3', 'd4'], diagramMarks: [oval('d4'), oval('d4', 0.2, 0.3)], qty: 2 }),
      part('d', { diagramIds: ['d5'], diagramMarks: [oval('gone')] }),
      part('e', { diagramIds: ['d6', 'd7'], diagramMark: { id: 'd7', x: 0.5, y: 0.5, r: 0.09 } }),
    ];
    const e = sheetEntries(items);
    expect(e.map((x) => [x.n, x.diagramId, x.marks.length])).toEqual([
      [1, 'd1', 0],
      [3, 'd4', 2],
      [4, 'd5', 0],
      [5, 'd7', 1],
    ]);
    expect(e[0].partNumber).toBe('123');
    expect(e[1].qty).toBe(2);
    // v0.59's one ring is read as it was
    expect(e[3].marks[0]).toEqual({ id: 'd7', x: 0.5, y: 0.5, r: 0.09 });
    expect(diagramOf({ diagramIds: [] })).toBeUndefined();
    // the new outlines win over the old ring
    expect(marksOf(part('f', { diagramIds: ['d8'], diagramMark: { id: 'd8', x: 0, y: 0, r: 0.1 }, diagramMarks: [oval('d8')] }) as never)).toEqual([oval('d8')]);
    // no more than eight
    expect(marksOf(part('g', { diagramIds: ['d9'], diagramMarks: Array.from({ length: 12 }, () => oval('d9')) }) as never)).toHaveLength(MAX_MARKS);
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
    for (const l of [one, two, three, four]) {
      for (const c of l.cells) {
        expect(c.cell.x).toBeGreaterThanOrEqual(0);
        expect(c.cell.x + c.cell.w).toBeLessThanOrEqual(l.width);
        expect(c.cell.y + c.cell.h).toBeLessThanOrEqual(l.height);
      }
    }
  });

  it('fits a diagram whole and puts the outlines where the finger drew them', () => {
    const d = fitInto(2000, 1000, { x: 0, y: 100, w: 1000, h: 1000 }, 0);
    expect(d).toEqual({ x: 0, y: 350, w: 1000, h: 500 });
    expect(ovalOn(oval('x', 0.5, 0.5, 0.1, 0.2), d)).toEqual({ cx: 500, cy: 600, rx: 100, ry: 100 });
    // the old ring stays round
    expect(ovalOn({ id: 'x', x: 0.5, y: 0.5, r: 0.1 }, d)).toEqual({ cx: 500, cy: 600, rx: 50, ry: 50 });
  });

  it('a drawn box, a tap, an old ring — ovals of the right size', () => {
    const b = markFromBox('x', 0.6, 0.5, 0.2, 0.3);
    expect(b.x).toBeCloseTo(0.4);
    expect(b.y).toBeCloseTo(0.4);
    expect(b.rx).toBeCloseTo(0.2 * 1.08);
    expect(b.ry).toBeCloseTo(0.1 * 1.08);
    // a tap on a wide picture: a circle on screen — narrower in the width's parts
    const tap = markAtTap('x', 0.5, 0.5, 2000, 1000);
    expect(tap.rx * 2000).toBeCloseTo(tap.ry * 1000);
    const old = fromOldRing({ id: 'x', x: 0.3, y: 0.3, r: 0.1 }, 2000, 1000);
    expect(old.rx * 2000).toBeCloseTo(100);
    expect(old.ry * 1000).toBeCloseTo(100);
  });

  it('keeps an outline sane, scales it, finds it under the finger', () => {
    expect(fitMark({ id: 'x', x: -1, y: 2, rx: 9, ry: 0 })).toEqual({ id: 'x', x: 0, y: 1, rx: MARK_MAX, ry: MARK_MIN });
    expect(fitMark({ id: 'x', x: Number.NaN, y: 0.5, rx: 0.1, ry: 0.1 }).x).toBe(0);
    const m = oval('x', 0.5, 0.5, 0.1, 0.05);
    expect(scaleMark(m, 2)).toEqual(oval('x', 0.5, 0.5, 0.2, 0.1));
    expect(onMark(m, 0.59, 0.5)).toBe(true);
    expect(onMark(m, 0.5, 0.56, 0.25)).toBe(true);
    expect(onMark(m, 0.5, 0.7)).toBe(false);
  });
});
