import { describe, expect, it } from 'vitest';
import { expandToken, indexText, matchJobs, normalizeText, splitWords, stem, tokenize, wordMatches, type JobDoc, type JobField } from './search';

function doc(id: string, createdAt: string, items: string[], extra: Partial<JobDoc<null>> = {}): JobDoc<null> {
  const fields: JobField[] = items.map((t) => ({ kind: 'item', text: t, index: indexText(t) }));
  return { orderId: id, number: Number(id), createdAt, numbers: [id], fields, owner: indexText('A 12345 Toyota Camry Ahmed Ali'), data: null, ...extra };
}

const docs = [
  doc('1001', '2026-01-10', ['Front Brake Pads', 'Brake Disc Skimming', 'Labour Charges']),
  doc('1002', '2026-02-10', ['Engine Oil 5W30', 'Oil Filter'], { owner: indexText('B 777 Nissan Patrol Omar') }),
  doc('1003', '2026-03-10', ['A/C Gas Charge', 'Compressor Original']),
  doc('1004', '2026-04-10', ['Замена масла', 'Фильтр масляный'], { numbers: ['1004', 'INV-2026-00012'] }),
  doc('1005', '2026-05-10', ['Spark plug', '90919-02240'], {
    fields: [
      { kind: 'item', text: 'Ignition coil · 90919-02240', index: indexText('Ignition coil 90919-02240 Denso') },
      { kind: 'complaint', text: 'Двигатель троит на холостых', index: indexText('Двигатель троит на холостых') },
      { kind: 'code', text: 'P0300, P0303', index: indexText('P0300, P0303') },
    ],
  }),
];

const ids = (q: string) => matchJobs(docs, q).matches.map((m) => m.doc.orderId);

describe('job search', () => {
  it('normalizes text and the query', () => {
    expect(normalizeText('A/C Ёлка, (масло)')).toBe('ac елка масло');
    expect(tokenize('A 12345 колодки')).toEqual(['12345', 'колодки']);
    expect(tokenize('#1024')).toEqual(['1024']);
    expect(expandToken('колодки').map((t) => t.text)).toContain('pad');
    expect(expandToken('oil').map((t) => t.text)).toContain('масл');
  });

  it('finds jobs by works and parts in either language, by the beginning of words', () => {
    expect(ids('колодки')).toEqual(['1001']);
    expect(ids('pads')).toEqual(['1001']);
    expect(ids('тормоз')).toEqual(['1001']);
    // Newest first: the Russian job and the English one.
    expect(ids('масло')).toEqual(['1004', '1002']);
    expect(ids('масляный фильтр')).toEqual(['1004', '1002']);
    expect(ids('кондиционер')).toEqual(['1003']);
    expect(ids('компрес')).toEqual(['1003']);
    expect(ids('ac')).toEqual(['1003']);
    expect(ids('катушка зажигания')).toEqual(['1005']);
  });

  it('every word must be found; the car or customer narrows the query', () => {
    expect(ids('колодки camry')).toEqual(['1001']);
    expect(ids('масло patrol')).toEqual(['1002']);
    expect(ids('масло camry')).toEqual(['1004']);
    expect(ids('колодки компрессор')).toEqual([]);
    // The car alone is not a job hit (the car list shows it).
    expect(ids('camry')).toEqual([]);
  });

  it('general words do not exclude a job', () => {
    expect(ids('замена масла')).toEqual(['1004', '1002']);
    expect(ids('ремонт тормозов')).toEqual(['1001']);
    expect(ids('замена')).toEqual(['1004']);
  });

  it('finds the complaint, OBD codes and part numbers', () => {
    expect(ids('троит')).toEqual(['1005']);
    expect(ids('p0303')).toEqual(['1005']);
    expect(ids('9091902240')).toEqual(['1005']);
    expect(ids('02240')).toEqual(['1005']);
    expect(ids('denso')).toEqual(['1005']);
  });

  it('finds a job by its number and invoice number, first', () => {
    expect(ids('1003')).toEqual(['1003']);
    expect(ids('№1003')).toEqual(['1003']);
    expect(ids('INV-2026-00012')).toEqual(['1004']);
    expect(ids('12')).toEqual(['1004']);
    // A year is not an invoice number.
    expect(ids('2026')).toEqual([]);
  });

  it('understands Russian endings and English plurals', () => {
    expect(stem('колодки')).toBe('колод');
    expect(ids('колодок')).toEqual(['1001']);
    expect(ids('фильтра')).toEqual(['1004', '1002']);
    expect(ids('тормозов')).toEqual(['1001']);
    expect(ids('filters')).toEqual(['1004', '1002']);
  });

  it('reports which lines matched and highlights whole words', () => {
    const m = matchJobs(docs, 'колодки').matches[0]!;
    expect(m.fields.map((f) => f.text)).toEqual(['Front Brake Pads']);
    const marked = (text: string, q: string) => {
      const terms = matchJobs(docs, q).matches[0]!.highlight;
      return splitWords(text).filter((w, i) => i % 2 === 1 && wordMatches(w, terms));
    };
    expect(marked('Front Brake Pads', 'колодки')).toEqual(['Pads']);
    expect(marked('Замена масла · Фильтр масляный', 'масло')).toEqual(['масла', 'масляный']);
    expect(marked('A/C Gas Charge', 'кондиционер')).toEqual(['A/C']);
    expect(marked('Ignition coil · 90919-02240', '02240')).toEqual(['90919-02240']);
  });
});
