import { describe, expect, it } from 'vitest';
import {
  beltSpecsIn,
  carFacts,
  compareBelts,
  fitmentOf,
  independentSources,
  markingSure,
  partCategory,
  positionConflict,
  readBeltMarking,
  verifiedOnly,
  type Candidate,
  type CarFacts,
  type GarageUse,
  type Marking,
  type NumberCheck,
} from './fitment';

const AT = '2026-11-22T08:00:00.000Z';
/** A Honda Civic as typed by the manager — no VIN. */
const civic: CarFacts = carFacts({ id: 'v1', make: 'Honda', model: 'Civic', year: 2008, engine: '1.8L', vin: '' });
const typed = (text: string): Marking => ({ text, from: 'typed', confidence: 1, at: AT });
const check = (over: Partial<NumberCheck> = {}): NumberCheck => ({
  at: AT,
  epc: { state: 'read', url: 'https://www.megazip.net/parts/honda-31110rsag01', name: 'Belt, Alternator (Bando)', kind: true, diagrams: 2, fit: 'model', headings: ['Civic · 2006–2011'] },
  web: [
    { url: 'https://www.amayama.com/en/part/honda/31110rsag01', how: 'search' },
    { url: 'https://partsouq.com/en/search/all?q=31110-RSA-G01', how: 'search' },
  ],
  specs: [],
  named: 'search',
  ...over,
});

describe('the belt marking (v0.65)', () => {
  it('7PK2164 read into ribs, profile and length; the real case — 7PK2164 and 7PK1535 are not the same belt', () => {
    const r = readBeltMarking('7PK2164');
    expect(r.spec).toEqual({ kind: 'ribbed', ribs: 7, profile: 'PK', lengthMm: 2164, text: '7PK2164' });
    expect(compareBelts(r.spec!, beltSpecsIn('7PK1535')[0])).toBe('conflict');
    // Other ribs — another belt even at the same length; makers' few millimetres — close.
    expect(compareBelts(r.spec!, beltSpecsIn('6PK2164')[0])).toBe('conflict');
    expect(compareBelts(r.spec!, beltSpecsIn('7PK2160')[0])).toBe('close');
    expect(beltSpecsIn('Bando 7 PK 2164, Gates 7PK-2165')).toEqual([
      { kind: 'ribbed', ribs: 7, profile: 'PK', lengthMm: 2164, text: '7PK2164' },
      { kind: 'ribbed', ribs: 7, profile: 'PK', lengthMm: 2165, text: '7PK2165' },
    ]);
  });

  it('an incomplete or unclear marking is no size: a part missing, letters put right, two readings', () => {
    expect(readBeltMarking('PK2164')).toEqual({ readings: [], corrected: false, incomplete: true });
    expect(readBeltMarking('7PK21')).toEqual({ readings: [], corrected: false, incomplete: true });
    // A camera's l for 1: put right — a reading, never a sure one.
    const fixed = readBeltMarking('7PK2l64');
    expect([fixed.spec, fixed.corrected]).toEqual([undefined, true]);
    expect(fixed.readings.map((x) => x.text)).toEqual(['7PK2164']);
    expect(markingSure(typed('7PK2l64'))).toBeUndefined();
    // Read off a photo: sure only when clean, sure enough and with no other reading.
    expect(markingSure({ text: '7PK2164', from: 'photo', confidence: 0.6, at: AT })).toBeUndefined();
    expect(markingSure({ text: '7PK2164', from: 'photo', confidence: 0.92, alternatives: ['7PK2154'], at: AT })).toBeUndefined();
    expect(markingSure({ text: '7PK2164', from: 'photo', confidence: 0.92, at: AT })?.text).toBe('7PK2164');
    expect(markingSure(typed('7PK2164'))?.text).toBe('7PK2164');
    // A length no PK belt is made in is a wrong reading.
    expect(beltSpecsIn('7PK9164')).toEqual([]);
  });
});

describe('the real case: ENGINE BELT on a Honda, the belt on the car 7PK2164 (regression)', () => {
  const g01: Candidate = { number: '31110-RSA-G01', brand: 'Honda', seen: [], check: check({ specs: [{ text: '7PK1535', by: 'page', from: 'https://www.gates.example/xref/31110-RSA-G01' }] }) };
  const g02: Candidate = { number: '31110-RSA-G02', brand: 'Honda', seen: [], check: check({ epc: { ...check().epc, url: 'https://www.megazip.net/parts/honda-31110rsag02' }, specs: [{ text: '7PK1535', by: 'page', from: 'https://www.dayco.example/31110-RSA-G02' }] }) };
  const rna: Candidate = { number: '56992-RNA-A02', brand: 'Honda', seen: [], check: check({ epc: { ...check().epc, name: 'Belt, Compressor (Bando)' }, specs: [{ text: '7PK2164', by: 'page', from: 'https://www.bando.example/7PK2164' }] }) };
  const fit = (c: Candidate, marking?: Marking) => fitmentOf({ part: 'ENGINE BELT', car: civic, candidate: c, search: 'web', marking });

  it('31110-RSA-G01 / G02 against the belt on the car: a conflict — never green, whatever found them', () => {
    for (const c of [g01, g02]) {
      const f = fit(c, typed('7PK2164'));
      expect(f.status).toBe('conflict');
      expect(f.conflicts).toEqual([{ code: 'markingDiffers', params: { marking: '7PK2164', spec: '7PK1535', by: 'page' } }]);
    }
  });

  it('without the marking: on the model’s diagram — partial at most, and what is missing says why (no VIN, the drive, the marking)', () => {
    const f = fit(g01);
    expect(f.status).toBe('partial');
    expect(f.missing).toEqual(expect.arrayContaining(['vin', 'drive', 'marking', 'frame']));
  });

  it('the 7PK2164 belt’s number: the same size as on the car and on the model’s diagram — partial, not verified (no VIN, no configuration code)', () => {
    const f = fit(rna, typed('7PK2164'));
    expect(f.status).toBe('partial');
    expect(f.reasons.map((r) => r.code)).toEqual(['epcModel', 'markingMatches']);
    expect(f.missing).toEqual(expect.arrayContaining(['vin', 'frame']));
  });

  it('v0.64’s green — «seen in 2 catalogues» (two mirrors of one catalogue) — is one source, and no proof', () => {
    const legacy: Candidate = { number: '31110-RSA-G01', brand: 'Honda', seen: ['https://www.amayama.com/p/1', 'https://partsouq.com/p/2'] };
    const f = fit(legacy);
    expect(f.status).toBe('unverified');
    expect(f.sources).toBe(1);
    expect(independentSources(['https://www.amayama.com/p/1', 'https://partsouq.com/p/2', 'https://www.megazip.net/x'])).toBe(1);
  });
});

describe('the fitment rules (v0.65)', () => {
  const base: Candidate = { number: '04465-60320', brand: 'Toyota', seen: [], check: { ...check(), epc: { state: 'read', url: 'https://www.megazip.net/parts/toyota-0446560320', name: 'Pad Kit, Disc Brake, Front', kind: true, diagrams: 1, fit: 'model', headings: ['Land Cruiser URJ202 · 2007–2021'] } } };
  const lc = carFacts({ id: 'v2', make: 'Toyota', model: 'Land Cruiser URJ202', year: 2016, engine: '5.7L', vin: 'JTMHV05J604123456' });

  it('the kind of part decides its rules', () => {
    expect(['ENGINE BELT', 'РЕМЕНЬ ГЕНЕРАТОРА', 'TIMING BELT', 'SEAT BELT', 'FRONT BRAKE PADS', 'OIL FILTER', 'O2 SENSOR', 'BUMPER', 'WIPER BLADE'].map(partCategory)).toEqual([
      'belt',
      'belt',
      'timing',
      'body',
      'brake',
      'filter',
      'sensor',
      'body',
      'other',
    ]);
  });

  it('a car with no VIN, or one the AI read, gets no configuration made up', () => {
    const f = carFacts({ id: 'v3', make: 'Toyota', model: 'Corolla', year: 2009, engine: '1.8L 4-cyl', vin: 'JTDBR42E39J016456', vinAi: { vin: 'JTDBR42E39J016456', at: AT, filled: ['model', 'engine', 'year'] } });
    expect(f.vin).toBe('valid');
    expect([f.model.by, f.engine.by, f.year.by]).toEqual(['ai', 'ai', 'vin']);
    // A model the AI wrote gives no configuration code; the market is not the plant.
    expect(f.frames).toEqual([]);
    expect(f.built).toBe('Japan');
    const none = carFacts({ id: 'v4', make: 'Honda', model: '', vin: 'NOTAVIN' });
    expect([none.vin, none.model.by, none.year.by, none.engine.by, none.frames]).toEqual(['invalid', 'none', 'none', 'none', []]);
    // A part needing the engine on a car with the AI's engine: not verified.
    const pads = fitmentOf({ part: 'OIL FILTER', car: f, candidate: { ...base, check: { ...base.check!, epc: { ...base.check!.epc, name: 'Element, Oil Filter', headings: ['Corolla ZRE142 · 2006–2013'] } } }, search: 'web' });
    expect(pads.status).toBe('partial');
    expect(pads.missing).toEqual(expect.arrayContaining(['engine', 'model', 'frame']));
  });

  it('verified by the maker’s catalogue only on the car’s own configuration code, as typed, with what the part needs known', () => {
    const f = fitmentOf({ part: 'FRONT BRAKE PADS', car: lc, candidate: base, search: 'web' });
    expect(f.status).toBe('verified');
    expect(f.reasons).toEqual([{ code: 'epcFrame', params: { frame: 'URJ202' } }]);
    // Brake pads with no axle said: which pads — not known.
    expect(fitmentOf({ part: 'BRAKE PADS', car: lc, candidate: base, search: 'web' }).status).toBe('partial');
    // Another frame typed: the model's diagram only.
    expect(fitmentOf({ part: 'FRONT BRAKE PADS', car: { ...lc, frames: ['UZJ200'] }, candidate: base, search: 'web' }).status).toBe('partial');
  });

  it('the other axle or another part in the maker’s own name: rejected', () => {
    const rear = { ...base, check: { ...base.check!, epc: { ...base.check!.epc, name: 'Pad Kit, Disc Brake, Rear' } } };
    expect(fitmentOf({ part: 'FRONT BRAKE PADS', car: lc, candidate: rear, search: 'web' })).toMatchObject({ status: 'rejected', conflicts: [{ code: 'otherAxle' }] });
    expect(positionConflict('LEFT HEADLAMP', 'Unit Assy, Headlamp, RH')).toBe('side');
    const other = { ...base, check: { ...base.check!, epc: { ...base.check!.epc, kind: false, name: 'Filter, Oil' } } };
    expect(fitmentOf({ part: 'FRONT BRAKE PADS', car: lc, candidate: other, search: 'web' }).status).toBe('rejected');
  });

  it('sources that disagree on its size give no green tick', () => {
    const c: Candidate = { ...base, number: '31110-RNA-004', brand: 'Honda', check: check({ specs: [{ text: '7PK1535', by: 'page', from: 'https://a.example/1' }, { text: '7PK2164', by: 'page', from: 'https://b.example/2' }] }) };
    const f = fitmentOf({ part: 'ENGINE BELT', car: civic, candidate: c, search: 'web' });
    expect(f.status).toBe('conflict');
    expect(f.conflicts[0]).toEqual({ code: 'specsDisagree', params: { specs: '7PK1535 / 7PK2164' } });
  });

  it('an analog found next to the model’s name is not a fitting part', () => {
    const analog: Candidate = { number: '7PK2164', brand: 'Bando', seen: [], check: { at: AT, epc: { state: 'none' }, web: [{ url: 'https://shop.example/honda-civic-belt-7pk2164', how: 'page' }], specs: [{ text: '7PK2164', by: 'page', from: 'https://shop.example/honda-civic-belt-7pk2164' }], named: 'search' } };
    const f = fitmentOf({ part: 'ENGINE BELT', car: civic, candidate: analog, search: 'web', marking: typed('7PK2164') });
    expect(f.status).not.toBe('verified');
    expect(f.missing).toEqual(expect.arrayContaining(['oem', 'epc']));
  });

  it('the maker’s replacement of the number fitted on this car is apart from a number merely like it', () => {
    const fitted: GarageUse[] = [{ number: '31110-RNA-003', name: 'ENGINE BELT', sameVehicle: true, installed: true, jobNo: 351, at: AT }];
    const newer: Candidate = { number: '31110-RNA-004', brand: 'Honda', replaces: ['31110-RNA-003'], seen: [], check: check() };
    const like: Candidate = { number: '31110-RNA-005', brand: 'Honda', seen: [], check: check() };
    const f = fitmentOf({ part: 'ENGINE BELT', car: civic, candidate: newer, search: 'web', garage: fitted });
    expect(f.status).toBe('verified');
    expect(f.reasons).toEqual([{ code: 'replacesFittedHere', params: { number: '31110-RNA-003' } }]);
    expect(fitmentOf({ part: 'ENGINE BELT', car: civic, candidate: like, search: 'web', garage: fitted })).toMatchObject({ status: 'conflict', conflicts: [{ code: 'fittedOther', params: { number: '31110-RNA-003' } }] });
    // The same number fitted on this car before: verified; on another car of the model — partial.
    expect(fitmentOf({ part: 'ENGINE BELT', car: civic, candidate: { ...like, number: '31110-RNA-003' }, search: 'garage', garage: fitted }).status).toBe('verified');
    expect(fitmentOf({ part: 'ENGINE BELT', car: civic, candidate: { ...like, number: '31110-RNA-003', check: undefined }, search: 'garage', garage: [{ ...fitted[0], sameVehicle: false }] }).status).toBe('partial');
    // Bought for this car but not fitted: no proof.
    expect(fitmentOf({ part: 'ENGINE BELT', car: civic, candidate: { ...like, number: '31110-RNA-003', check: undefined }, search: 'garage', garage: [{ ...fitted[0], installed: false }] }).status).toBe('unverified');
  });

  it('with no source reachable it says so: not verified, nothing thrown', () => {
    const down: Candidate = { number: '17220-RNA-A00', brand: 'Honda', seen: [], check: { at: AT, epc: { state: 'unreachable' }, web: [], specs: [], named: 'memory' } };
    const f = fitmentOf({ part: 'AIR FILTER', car: civic, candidate: down, search: 'model' });
    expect(f.status).toBe('unverified');
    expect(f.missing).toEqual(expect.arrayContaining(['epc']));
    expect(f.sources).toBe(0);
    expect(fitmentOf({ part: 'AIR FILTER', car: carFacts(undefined), candidate: { number: 'X1', seen: [] }, search: 'model' }).status).toBe('unverified');
  });

  it('a number kept before v0.65 (no check) is judged again by what it has: «on the diagram» — partial, not green', () => {
    const old: Candidate = { number: '04465-60320', brand: 'Toyota', seen: ['https://www.megazip.net/parts/toyota-0446560320'], fits: true, name: 'Pad Kit, Disc Brake, Front', model: 'Land Cruiser · 2007–2021' };
    expect(fitmentOf({ part: 'FRONT BRAKE PADS', car: { ...lc, frames: [] }, candidate: old, search: 'web' }).status).toBe('partial');
  });

  it('a conflict stays a conflict whatever the AI says and whoever fitted the model before', () => {
    const c: Candidate = { number: '31110-RSA-G01', brand: 'Honda', note: 'Verified: fits this exact car, 100% sure', seen: [], check: check({ specs: [{ text: '7PK1535', by: 'ai' }], named: 'memory' }) };
    const f = fitmentOf({ part: 'ENGINE BELT', car: { ...civic, frames: ['FD1'] }, candidate: c, search: 'model', marking: typed('7PK2164'), garage: [{ number: '31110-RSA-G01', name: 'ENGINE BELT', sameVehicle: false, installed: true, at: AT }] });
    expect(f.status).toBe('conflict');
    expect(f.conflicts[0]).toMatchObject({ code: 'markingDiffers', params: { by: 'ai' } });
  });

  it('a photo’s unclear reading still stops a green tick when every reading of it disagrees', () => {
    const c: Candidate = { number: '31110-RSA-G01', brand: 'Honda', seen: [], check: check({ specs: [{ text: '7PK1535', by: 'page', from: 'https://a.example' }] }) };
    const unsure: Marking = { text: '7PK2l64', from: 'photo', confidence: 0.5, at: AT };
    expect(fitmentOf({ part: 'ENGINE BELT', car: civic, candidate: c, search: 'web', marking: unsure }).status).toBe('conflict');
    const close: Marking = { text: '7PK153S', from: 'photo', confidence: 0.5, at: AT };
    const f = fitmentOf({ part: 'ENGINE BELT', car: civic, candidate: c, search: 'web', marking: close });
    expect(f.status).toBe('partial');
    expect(f.missing).toContain('markingUnclear');
  });

  it('a line takes a number by itself only when it is the one verified', () => {
    const v = fitmentOf({ part: 'FRONT BRAKE PADS', car: lc, candidate: base, search: 'web' });
    const p = fitmentOf({ part: 'FRONT BRAKE PADS', car: { ...lc, frames: [] }, candidate: base, search: 'web' });
    expect(verifiedOnly([{ number: 'A', fit: v }, { number: 'B', fit: p }])).toBe('A');
    expect(verifiedOnly([{ number: 'A', fit: v }, { number: 'B', fit: v }])).toBeUndefined();
    expect(verifiedOnly([{ number: 'B', fit: p }])).toBeUndefined();
  });
});
