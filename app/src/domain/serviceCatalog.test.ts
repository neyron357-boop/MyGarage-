import { describe, expect, it } from 'vitest';
import { descKey, lineServices, mergeCatalog, ruleFor, serviceFor, serviceLookup } from './serviceCatalog';
import { SEED_CATEGORIES, SEED_SERVICES } from './serviceCatalogSeed';
import type { Service, ServiceMapEntry } from './types';
import { vehicleTypeOf } from './vehicleType';

/*
 * The standard services (v0.45): a description is its service by the catalogue's entry for it, else by a rule — the
 * longest keyword that fits. Made-up catalogue.
 */

const svc = (id: string, keywords: string[], position: number, more: Partial<Service> = {}): Service => ({ id, name: id, categoryId: 'c', keywords, position, ...more });
const services = [
  svc('oil', ['CHANGE OIL', 'OIL CHANGE'], 1, { kind: 'oil' }),
  svc('wash', ['WASH'], 2),
  svc('pads', ['BRAKE PAD', 'BREAK PAD', 'BRAKD PAD'], 3),
  svc('labour', ['LABOUR', 'LABOUER', 'LABOUT'], 4),
  svc('old', ['FILTER'], 5, { archivedAt: '2026-11-01T00:00:00.000Z' }),
];
const map: ServiceMapEntry[] = [{ id: descKey('AC SERVICE INCLUDING AC FREON GAS,VACUUM'), description: 'AC SERVICE INCLUDING AC FREON GAS,VACUUM', serviceId: 'labour', by: 'hand', at: '' }];

describe('the standard services of invoice lines (v0.45)', () => {
  it('a description’s key: upper case, letters and digits, one space', () => {
    expect(descKey('Change  oil / filter (10K km)')).toBe('CHANGE OIL FILTER 10K KM');
    expect(descKey('CHANGE OIL & FILTER')).toBe(descKey('change oil &filter'));
  });

  it('a rule: the description holds a keyword — any word with it («*WASH*»); the longest that fits wins', () => {
    expect(ruleFor('CHANGE OIL / FILTER', services)?.service.id).toBe('oil');
    expect(ruleFor('OIL CHANGE 10K KM', services)?.service.id).toBe('oil');
    expect(ruleFor('BIG BUS FULL WASH', services)?.service.id).toBe('wash');
    expect(ruleFor('CARWASH', services)?.service.id).toBe('wash');
    expect(ruleFor('BRAKD PAD REAR', services)?.service.id).toBe('pads');
    // Both a pad and the labour on one line: the longer keyword is the line.
    expect(ruleFor('BRAKE PAD + LABOUR', services)?.service.id).toBe('pads');
    // An archived service is no rule any more.
    expect(ruleFor('AIR FILTER', services)).toBeUndefined();
  });

  it('the catalogue’s own entry first, then a rule; nothing — to be looked at', () => {
    expect(serviceFor('AC SERVICE INCLUDING AC FREON GAS, VACUUM', { services, map })).toEqual({ serviceId: 'labour', by: 'hand' });
    expect(serviceFor('LABOUT CHARGES', { services, map })).toEqual({ serviceId: 'labour', by: 'rule' });
    expect(serviceFor('ALTERNATOR', { services, map })).toBeUndefined();
    const look = serviceLookup({ services, map });
    expect([look('CHANGE OIL'), look('ALTERNATOR'), look('AC SERVICE INCLUDING AC FREON GAS,VACUUM')]).toEqual(['oil', undefined, 'labour']);
  });

  it('a car’s body by its make and model', () => {
    expect(vehicleTypeOf('Toyota', 'HILLUX')).toBe('pickup');
    expect(vehicleTypeOf('Mitsubishi', 'L200')).toBe('pickup');
    expect(vehicleTypeOf('Nissan', 'Urvan')).toBe('van');
    expect(vehicleTypeOf('Toyota', 'Coaster')).toBe('bus');
    expect(vehicleTypeOf('Mitsubishi Fuso', 'Canter')).toBe('truck');
    expect(vehicleTypeOf('Suzuki', 'Ertiga')).toBe('mpv');
    expect(vehicleTypeOf('Mitsubishi', 'Pajero')).toBe('suv');
    expect(vehicleTypeOf('Audi', 'A6')).toBe('sedan');
    expect(vehicleTypeOf('Lada', 'Niva')).toBeUndefined();
  });
});

describe('the catalogue that comes with the app (v0.46)', () => {
  const seed = mergeCatalog({ categories: [], services: [], map: [] });
  const id = (description: string) => serviceLookup(seed)(description);

  it('16 categories; every service in one of them, with its words', () => {
    expect(SEED_CATEGORIES).toHaveLength(16);
    expect(new Set(SEED_SERVICES.map((s) => s.id)).size).toBe(SEED_SERVICES.length);
    const cats = new Set(SEED_CATEGORIES.map((c) => c.id));
    for (const s of SEED_SERVICES) {
      expect(cats.has(s.categoryId)).toBe(true);
      expect(s.keywords.length).toBeGreaterThan(0);
      for (const k of s.keywords) expect(descKey(k)).not.toBe('');
    }
    expect(SEED_SERVICES.filter((s) => s.kind === 'oil').map((s) => s.name)).toEqual(['Oil change (engine oil + filter)']);
  });

  it('the rules of the task: an oil change, *WASH*, brake pads, labour — typos too', () => {
    for (const d of ['CHANGE OIL / FILTER', 'CHANGE OIL & FILTER (10K KILOMETERS)', 'OIL CHANGE 10K KM', 'CHANGE OIL 10K KIMOMETERS']) expect(id(d)).toBe('svc-oil-change');
    for (const d of ['CAR WASH', 'CARWASH', 'BIG BUS FULL WASH', 'PICK UP FULL WASH', 'STEAM WASH FOR PASSING']) expect(id(d)).toBe('svc-car-wash');
    for (const d of ['BRAKE PAD', 'BREAK PAD', 'FRONT BRAKD PAD', 'REAR BRAKE PAD ORIGINAL']) expect(id(d)).toBe('svc-brake-pads');
    for (const d of ['LABOUR CHARGES', 'LABOUER CHARGES', 'LABOUT CHARGES', 'LABOUR CHAGES']) expect(id(d)).toBe('svc-labour');
  });

  it('the longest word wins; a line that starts with labour is labour: labour for a power steering is labour, a door handle repair with labour a door', () => {
    expect(id('LABOUR CHARGES WE OPENED THE COMPLETE POWER STEERING SYSTEM')).toBe('svc-labour');
    expect(id('LABOUR CHARGES FOR AC FAN MOTOR WIRING')).toBe('svc-labour');
    expect(id('DOOR HANDLE REPAIR WITH LABOUR')).toBe('svc-door-lock');
    expect(id('TENSIONER BELT')).toBe('svc-drive-belt');
    expect(id('TENSIONER PULLEY')).toBe('svc-tensioner');
    expect(id('COOLANT PIPE SMALL ORIGINAL')).toBe('svc-cooling-hoses');
    expect(id('COOLANT')).toBe('svc-coolant');
    expect(id('AC FILTER DRIER')).toBe('svc-ac-valves');
    expect(id('AC FILTER')).toBe('svc-ac-filter');
    expect(id('FRONT BUMPER PAINTING')).toBe('svc-denting-painting');
    expect(id('FRONT BRAKE DISC')).toBe('svc-brake-discs');
    expect(id('FRONT BRAKE CLEANING')).toBe('svc-brake-cleaning');
    expect(id('REAR BRAKE LIGHT BULB')).toBe('svc-bulbs');
    expect(id('FRONT BRAKE')).toBe('svc-brake-pads');
    expect(id('SEAL HEAD SPARKPLUG')).toBe('svc-gaskets');
    expect(id('DEFERENTIAL OIL 1LTR')).toBe('svc-gear-oil');
    expect(id('DEFERENTIAL USED ORIGINAL')).toBe('svc-differential');
    expect(id('REAR STOP LIGHT LEFT & RIGHT')).toBe('svc-lamps');
    expect(id('A/C CHECK AND RECHARGE')).toBe('svc-ac-service');
    expect(id('AC B LOWER')).toBe('svc-ac-blower');
    expect(id('RIM REPAIR')).toBe('svc-rim-repair');
    expect(id('PRIMER')).toBeUndefined();
    expect(id('LABOUR CHARGE FOR 2 LIGHTS FIXING WITH CONSUMABLES ( WIRE & TAPE)')).toBe('svc-labour');
    expect(id('REAR LEFT SIDE TIRE PUNCTURE REPAIRED')).toBe('svc-puncture');
    expect(id('MAGIC SMOKE REMOVAL')).toBeUndefined();
  });

  it('the garage’s edits over it: a service edited or taken out, one of its own, a description given by hand', () => {
    const oil = SEED_SERVICES.find((s) => s.id === 'svc-oil-change')!;
    const own = mergeCatalog({
      categories: [{ id: 'cat-x', name: 'Fleet extras', position: 99 }],
      services: [
        { ...oil, name: 'Engine oil service', keywords: [...oil.keywords, 'OIL SERVICE'] },
        { ...SEED_SERVICES.find((s) => s.id === 'svc-car-wash')!, archivedAt: '2026-11-18T00:00:00.000Z' },
        { id: 'svc-own', name: 'GPS tracker', categoryId: 'cat-x', keywords: ['GPS'], position: 999 },
      ],
      map: [{ id: descKey('MYSTERY PART'), description: 'MYSTERY PART', serviceId: 'svc-own', by: 'hand', at: '' }],
    });
    expect(own.services).toHaveLength(SEED_SERVICES.length + 1);
    const of = lineServices(own);
    expect(of('OIL SERVICE 5000 KM').service?.name).toBe('Engine oil service');
    expect(of('CAR WASH').service).toBeUndefined();
    expect(of('GPS TRACKER INSTALLATION')).toMatchObject({ service: { id: 'svc-own' }, category: { name: 'Fleet extras' }, by: 'rule' });
    expect(of('Mystery part')).toMatchObject({ service: { id: 'svc-own' }, by: 'hand' });
    expect(own.categories.at(-1)?.id).toBe('cat-x');
  });
});
