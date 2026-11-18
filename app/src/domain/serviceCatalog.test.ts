import { describe, expect, it } from 'vitest';
import { descKey, ruleFor, serviceFor, serviceLookup } from './serviceCatalog';
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
