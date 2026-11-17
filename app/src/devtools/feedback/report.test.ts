import { describe, expect, it } from 'vitest';
import { badgeAt, frameMark, geometry, renumber } from './render';
import { annotationsJson, shotFile, tasksMarkdown } from './report';
import { fbStrings } from './strings';
import type { FbNote } from './types';

const ru = fbStrings('ru');
const meta = { version: '0.39.0', at: '17/11/2026 21:40', iso: '2026-11-17T17:40:00.000Z' };
const base: Omit<FbNote, 'n' | 'id'> = {
  kind: 'element',
  comment: 'Не работает',
  status: 'new',
  createdAt: '2026-11-17T17:30:00.000Z',
  updatedAt: '2026-11-17T17:30:00.000Z',
  page: { name: 'Клиенты', title: 'Клиенты', route: '#/customers', url: 'https://x/#/customers' },
  element: {
    description: 'Кнопка «Сохранить»',
    tag: 'button',
    text: 'Сохранить',
    classes: ['mantine-Button-root'],
    selector: 'button.mantine-Button-root[aria-label="Сохранить"]',
    path: 'section.screen > div > button.mantine-Button-root',
    rect: { x: 16, y: 700, width: 358, height: 50 },
  },
  viewport: { width: 390, height: 844, dpr: 3, standalone: true, scheme: 'light', lang: 'ru', userAgent: 'test' },
  marks: [{ n: 1, kind: 'rect', x1: 0.03, y1: 0.82, x2: 0.97, y2: 0.89, auto: true }],
  appVersion: '0.39.0',
};
const note = (n: number, extra: Partial<FbNote> = {}): FbNote => ({ ...base, id: `id${n}`, n, ...extra });

describe('the export for an agent (v0.39 feedback tool)', () => {
  it('each task carries its own number, the owner’s words as typed and its screenshot of the same number', () => {
    const items = [
      { note: note(7), shot: { file: shotFile(7), width: 780, height: 1688 } },
      { note: note(12, { comment: 'Убрать\nи цвет', kind: 'screen', element: undefined, marks: [{ n: 1, kind: 'pin', x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5, comment: 'тут' }] }) },
    ];
    const md = tasksMarkdown(items, meta, ru);
    expect(shotFile(7)).toBe('screenshots/007.png');
    expect(md).toContain('## Задача №7');
    expect(md).toContain('- **Страница:** Клиенты (`#/customers`)');
    expect(md).toContain('- **Элемент:** Кнопка «Сохранить»');
    expect(md).toContain('- **Проблема:** Не работает');
    expect(md).toContain('- **Скриншот:** `screenshots/007.png`');
    expect(md).toContain('- **Требование:** Проверить причину по комментарию и скриншоту и исправить, не нарушая остальную функциональность.');
    // No screenshot: said so; a whole-screen note: no element; lines of a comment kept on one line; a pin's words.
    expect(md).toContain('## Задача №12');
    expect(md).toContain('- **Элемент:** — (весь экран, см. отметки)');
    expect(md).toContain('- **Проблема:** Убрать / и цвет');
    expect(md).toContain('  1. Метка — «тут»');
    expect(md).toContain('- **Скриншот:** нет (снимок не получился)');
    // The tool's own frame without words is not listed as the owner's mark.
    expect(md.split('## Задача №12')[0]).not.toContain('Отметки на скриншоте');
  });

  it('annotations.json: the element, the screen, the marks in the screenshot’s px', () => {
    const json = annotationsJson([{ note: note(3), shot: { file: shotFile(3), width: 780, height: 1688 } }], meta);
    const t = json.tasks[0];
    expect(t.n).toBe(3);
    expect(t.comment).toBe('Не работает');
    expect(t.screenshot).toEqual({ file: 'screenshots/003.png', width: 780, height: 1688 });
    expect(t.element?.selector).toBe('button.mantine-Button-root[aria-label="Сохранить"]');
    expect(t.marks[0]).toMatchObject({ n: 1, kind: 'rect', byTool: true, box: { x: 23.4, y: 1384.2, width: 733.2, height: 118.2 } });
    expect(json.version).toBe('0.39.0');
  });
});

describe('marks', () => {
  it('the picked element’s frame: its rectangle (a few px round it) in fractions of the screenshot', () => {
    const m = frameMark({ x: 100, y: 200, width: 50, height: 20 }, 2, 780, 1688);
    expect(m).toMatchObject({ n: 1, kind: 'rect', auto: true });
    expect(m.x1).toBeCloseTo((97 * 2) / 780);
    expect(m.y2).toBeCloseTo((223 * 2) / 1688);
    // Off the picture: kept inside it.
    expect(frameMark({ x: -10, y: 1700, width: 10, height: 10 }, 1, 390, 844)).toMatchObject({ x1: 0, y2: 1 });
  });

  it('numbers stay 1…k after one is taken away; a number sits inside the picture', () => {
    expect(renumber([{ n: 2, kind: 'pin', x1: 0, y1: 0, x2: 0, y2: 0 }, { n: 5, kind: 'pin', x1: 0, y1: 0, x2: 0, y2: 0 }]).map((m) => m.n)).toEqual([1, 2]);
    const g = geometry(780, 1688);
    const b = badgeAt({ n: 1, kind: 'rect', x1: 0, y1: 0, x2: 0.5, y2: 0.5 }, 780, 1688, g);
    expect(b.x).toBeGreaterThanOrEqual(g.badge);
    expect(b.y).toBeGreaterThanOrEqual(g.badge);
  });
});
