import { describe, expect, it } from 'vitest';
import { arrange, CARD, CARD_INFO, cardHeight, clampWidth, DEFAULT_DESK, normalizeDeskBoard, overlaps, pinnedFirst, placeNew, snap } from './deskBoard';

describe('cars pinned to the top (v0.73, a phone too)', () => {
  it('pinned first — the one pinned last on top — the rest in their own order; nothing pinned, the list as it was', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    const id = (x: string) => x;
    expect(pinnedFirst(list, id, [])).toBe(list);
    expect(pinnedFirst(list, id, ['d'])).toEqual(['d', 'a', 'b', 'c', 'e']);
    expect(pinnedFirst(list, id, ['d', 'b'])).toEqual(['b', 'd', 'a', 'c', 'e']);
    // A pinned job not in this tab (another step, gone off the board): nothing changes for it.
    expect(pinnedFirst(list, id, ['z'])).toBe(list);
  });
});

describe('the PC board laid out by hand (v0.67)', () => {
  it('nothing stored, or nonsense: the cards, nothing placed', () => {
    expect(normalizeDeskBoard(undefined)).toEqual(DEFAULT_DESK);
    expect(DEFAULT_DESK.mode).toBe('cards');
    expect(normalizeDeskBoard({ mode: 'wall', places: 5, important: 'x' })).toEqual(DEFAULT_DESK);
    // A place kept sane: on the canvas, its size within the bounds, on the canvas's step.
    expect(normalizeDeskBoard({ layout: 2, mode: 'canvas', places: { a: { x: -40, y: 13, w: 5000 }, b: { x: 'x' } }, important: ['a', 'a', 3], pinned: ['b'] })).toEqual({
      mode: 'canvas',
      places: { a: { x: 0, y: 12, w: CARD.max } },
      important: ['a'],
      pinned: ['b'],
    });
    expect([snap(17), clampWidth(100), clampWidth(333)]).toEqual([12, CARD.min, 330]);
    // Which card lies on top is kept.
    expect(normalizeDeskBoard({ layout: 2, places: { a: { x: 0, y: 0, w: 290, z: 3 } } }).places.a).toEqual({ x: 0, y: 0, w: 290, z: 3 });
  });

  it('v0.75: the board kept before it — «Шаги» is «Карточки», the marks stay, the canvas is laid out afresh (a card is taller now)', () => {
    const before = { mode: 'steps', places: { a: { x: 0, y: 0, w: 290 } }, important: ['a'], pinned: ['b'] };
    expect(normalizeDeskBoard(before)).toEqual({ mode: 'cards', places: {}, important: ['a'], pinned: ['b'] });
    expect(normalizeDeskBoard({ ...before, mode: 'canvas' }).mode).toBe('canvas');
    expect(normalizeDeskBoard({ mode: 'list' }).mode).toBe('list');
    // A card: its photo 16 : 9 and its facts under it.
    expect(cardHeight(320)).toBe(180 + CARD_INFO);
    expect(overlaps({ x: 0, y: 0, w: 320 }, { x: 0, y: 180 + CARD_INFO + 16, w: 320 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 320 }, { x: 0, y: 200, w: 320 })).toBe(true);
  });

  it('a new card finds a free place — row by row, within the width; the cards placed do not move', () => {
    const placed = { a: { x: 0, y: 0, w: 290 } };
    const add = placeNew(['b', 'c'], placed, 640);
    expect(add.b).toEqual({ x: 312, y: 0, w: CARD.s });
    // No room left in the row: the next one.
    expect(add.c.y).toBeGreaterThan(0);
    expect(add.c.x).toBe(0);
    for (const p of Object.values(add)) expect(overlaps(p, placed.a)).toBe(false);
    expect(overlaps(add.b, add.c)).toBe(false);
    // An important one is larger from the start.
    expect(placeNew(['d'], {}, 1600, () => CARD.l).d).toEqual({ x: 0, y: 0, w: CARD.l });
  });

  it('«Расставить»: all laid out again in the order given, none covering another', () => {
    const ids = ['p', 'i', 'x', 'y', 'z'];
    const out = arrange(ids, 1200, (id) => (id === 'i' ? CARD.l : CARD.s));
    expect(out.p).toEqual({ x: 0, y: 0, w: CARD.s });
    expect(out.i.y).toBe(0);
    const list = Object.values(out);
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) expect(overlaps(list[a], list[b])).toBe(false);
    for (const p of list) expect(p.x + p.w).toBeLessThanOrEqual(1200);
  });
});
