import { describe, expect, it } from 'vitest';
import { partsMemory, sameCar, type PriorPart } from './partsMemory';

const camry = { make: 'Toyota', model: 'Camry', year: 2018, engine: '2.5L' };
const line = (p: Partial<PriorPart> & { number?: string }): PriorPart => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  jobId: 'j',
  jobNo: p.jobNo ?? 100,
  at: p.at ?? '2026-11-01T10:00:00.000Z',
  name: p.name ?? 'FRONT BRAKE PADS',
  number: p.number,
  fitted: p.fitted ?? false,
  car: p.car ?? camry,
  web: p.web,
  diagramIds: p.diagramIds,
  sampleIds: p.sampleIds,
});

describe('the same car for the parts’ sake', () => {
  it('is the same make and model, within three years (four with the same engine), the engines not at odds', () => {
    expect(sameCar(camry, { make: 'toyota', model: 'CAMRY', year: 2020, engine: '2.5' })).toBe(true);
    expect(sameCar(camry, { make: 'Toyota', model: 'Camry', year: 2022, engine: '2.5L' })).toBe(true);
    expect(sameCar(camry, { make: 'Toyota', model: 'Camry', year: 2022 })).toBe(false);
    expect(sameCar(camry, { make: 'Toyota', model: 'Camry', year: 2021 })).toBe(true);
    expect(sameCar(camry, { make: 'Toyota', model: 'Camry', year: 2018, engine: '3.5L V6' })).toBe(false);
    expect(sameCar(camry, { make: 'Toyota', model: 'Corolla', year: 2018 })).toBe(false);
    expect(sameCar(camry, { make: 'Lexus', model: 'Camry', year: 2018 })).toBe(false);
    // A car whose model is not known matches none.
    expect(sameCar({ make: 'Toyota', model: '' }, { make: 'Toyota', model: '' })).toBe(false);
  });
});

describe('the garage’s memory of parts', () => {
  it('a number fitted before on this car, and no other: proven', () => {
    const prior = [line({ number: '04465-33480', fitted: true, jobNo: 101 }), line({ number: '0446533480', fitted: false, jobNo: 102, at: '2026-11-05T10:00:00.000Z' })];
    const m = partsMemory(prior, camry, 'колодки передние');
    expect(m.proven).toBe('04465-33480');
    expect(m.numbers).toHaveLength(1);
    expect(m.numbers[0]).toMatchObject({ number: '04465-33480', times: 2, fitted: 1, jobs: [102, 101] });
  });

  it('two different numbers fitted (two variants): candidates, the most fitted first — nothing proven', () => {
    const prior = [line({ number: '04465-33480', fitted: true }), line({ number: '04465-0E060', fitted: true }), line({ number: '04465-0E060', fitted: true, jobNo: 103 })];
    const m = partsMemory(prior, camry, 'FRONT BRAKE PADS');
    expect(m.proven).toBeUndefined();
    expect(m.numbers.map((n) => [n.number, n.fitted])).toEqual([['04465-0E060', 2], ['04465-33480', 1]]);
  });

  it('a number used but never fitted is a candidate only; another car’s or another part’s number is not remembered', () => {
    const prior = [
      line({ number: '04465-33480' }),
      line({ number: '04466-33230', name: 'REAR BRAKE PADS', fitted: true }),
      line({ number: '04465-02220', fitted: true, car: { make: 'Toyota', model: 'Corolla', year: 2018 } }),
    ];
    const m = partsMemory(prior, camry, 'FRONT BRAKE PADS');
    expect(m.proven).toBeUndefined();
    expect(m.numbers.map((n) => n.number)).toEqual(['04465-33480']);
  });

  it('a web search made lately for the same part on the same car serves again; an old one does not', () => {
    const web = { at: '2026-11-10T10:00:00.000Z', numbers: [{ number: '04465-33480', seen: ['https://a.com/1', 'https://b.com/2'] }] };
    const fresh = line({ web, diagramIds: ['d1'] });
    expect(partsMemory([fresh], camry, 'FRONT BRAKE PADS', new Date('2026-11-19T00:00:00Z')).web).toBe(fresh);
    expect(partsMemory([fresh], camry, 'FRONT BRAKE PADS', new Date('2026-12-25T00:00:00Z')).web).toBeUndefined();
    expect(partsMemory([line({ web: { at: web.at, numbers: [] } })], camry, 'FRONT BRAKE PADS', new Date('2026-11-19T00:00:00Z')).web).toBeUndefined();
  });

  it('remembers which line has the pictures', () => {
    const bare = line({ number: '04465-33480', fitted: true, at: '2026-11-12T10:00:00.000Z' });
    const pictured = line({ number: '04465-33480', fitted: true, at: '2026-11-02T10:00:00.000Z', diagramIds: ['d'], sampleIds: ['s'] });
    expect(partsMemory([bare, pictured], camry, 'FRONT BRAKE PADS').numbers[0].from).toBe(pictured);
  });
});
