import { describe, expect, it } from 'vitest';
import { buildTogether, declinedBefore, hintsFor } from './together';
import type { HistLine } from './linePrices';
import type { JobTemplate, RelatedRule } from './types';

const line = (orderId: string, titleEn: string, kind: 'part' | 'labor' = 'part', approvalState: HistLine['approvalState'] = 'approved'): HistLine => ({ orderId, kind, titleEn, unitPriceFils: 1000, approvalState });

describe('what usually goes together (audit 27/11)', () => {
  it('the history: what was on at least 40 % of a line’s jobs, the line seen on 3 jobs or more', () => {
    const lines = [
      ...['a', 'b', 'c', 'd', 'e'].flatMap((o) => [line(o, 'TIMING BELT KIT')]),
      ...['a', 'b', 'c'].map((o) => line(o, 'WATER PUMP')),
      line('d', 'DRIVE BELT'),
      // Declined — not what went together.
      line('e', 'DRIVE BELT', 'part', 'declined'),
      // The app's labour charge brings nothing.
      ...['a', 'b', 'c'].map((o) => line(o, 'LABOR CHARGE: TIMING BELT KIT', 'labor')),
    ];
    const t = buildTogether(lines, 'en');
    expect(t.get('TIMING BELT KIT')).toEqual([{ title: 'WATER PUMP', kind: 'part', jobs: 3, of: 5 }]);
    // A water pump on 3 jobs, the kit on all three: it brings the kit.
    expect(t.get('WATER PUMP')?.[0]).toMatchObject({ title: 'TIMING BELT KIT', jobs: 3, of: 3 });
    expect(t.has('LABOR CHARGE: TIMING BELT KIT')).toBe(false);
  });

  it('the starter rules: a line of the rule’s template brings its lines, after the history', () => {
    const templates: JobTemplate[] = [
      { id: 't1', code: 'brake_pads_front', titleRu: 'Замена передних колодок', titleEn: 'Front brake pads replacement', active: true, items: [{ kind: 'part', block: 'A', titleRu: 'Колодки передние', titleEn: 'Front brake pads', qty: 1, unit: 'set', unitPriceFils: 0 }] },
    ];
    const rules: RelatedRule[] = [{ id: 'r1', triggerTemplateCode: 'brake_pads_front', titleRu: 'Передние тормозные диски', titleEn: 'Front brake discs', priceMinFils: 0, priceMaxFils: 0 }];
    const t = buildTogether([], 'en', rules, templates);
    expect(t.get('FRONT BRAKE PADS')).toEqual([{ title: 'FRONT BRAKE DISCS', kind: 'part' }]);
    expect(buildTogether([], 'ru', rules, templates).get('КОЛОДКИ ПЕРЕДНИЕ')?.[0].title).toBe('ПЕРЕДНИЕ ТОРМОЗНЫЕ ДИСКИ');
  });

  it('the hints: what is not on the job yet, the newest addition’s first, four at most', () => {
    const t = new Map([
      ['A', [{ title: 'B', kind: 'part' as const }, { title: 'C', kind: 'part' as const }]],
      ['D', [{ title: 'E', kind: 'labor' as const }]],
    ]);
    expect(hintsFor(t, ['A', 'D'], ['A', 'D', 'C']).map((h) => h.title)).toEqual(['E', 'B']);
    expect(hintsFor(undefined, ['A'], [])).toEqual([]);
  });
});

describe('declined on an earlier visit (audit 27/11)', () => {
  const it_ = (id: string, titleEn: string, approvalState: string, gross = 38000) => ({ id, kind: 'part', titleEn, approvalState, gross });
  it('the newest no per title, within a year, not done after, not on this job', () => {
    const visits = [
      { order: { id: 'v1', day: '2026-03-10' }, items: [it_('a', 'FRONT BRAKE DISCS', 'declined', 30000), it_('b', 'AIR FILTER', 'declined')] },
      { order: { id: 'v2', day: '2026-08-02' }, items: [it_('c', 'FRONT BRAKE DISCS', 'declined'), it_('d', 'AIR FILTER', 'approved'), it_('e', 'WIPER BLADES', 'declined')] },
      { order: { id: 'old', day: '2025-01-05' }, items: [it_('f', 'BATTERY', 'declined')] },
      { order: { id: 'now', day: '2026-11-27' }, items: [] },
    ];
    const got = declinedBefore(visits, { id: 'now', day: '2026-11-27' }, ['WIPER BLADES'], 'en');
    expect(got).toEqual([{ itemId: 'c', orderId: 'v2', title: 'FRONT BRAKE DISCS', gross: 38000, day: '2026-08-02' }]);
  });
});
