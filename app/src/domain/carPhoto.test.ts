import { describe, expect, it } from 'vitest';
import { carCheckOf, photoCar, photoFill, photoProven, photoSays } from './carPhoto';
import { stemCar } from './vinDecode';

/*
 * v0.89: the car's make and model off its photo, then the VIN — the same car, nothing; another, the person chooses.
 * (VINs here are made up: a Toyota built in Indonesia «MHF…», one built in Japan «JTD…», a Nissan «JN1…».)
 */
const VELOZ_VIN = 'MHFAB1BY4P3069309';
const TOYOTA_JP = 'JTDBR42E39J016456';

describe('the photo’s answer as the app takes it', () => {
  it('a car, a make the catalogue knows, sure enough; its model only when surer', () => {
    expect(photoCar({ isCar: true, make: 'TOYOTA', model: 'land cruiser', confidence: 0.8 })).toEqual({ make: 'Toyota', model: 'Land Cruiser' });
    expect(photoCar({ isCar: true, make: 'Toyota', model: 'Veloz', confidence: 0.55 })).toEqual({ make: 'Toyota', model: '' });
    expect(photoCar({ isCar: true, make: 'Toyota', model: 'Veloz', confidence: 0.3 })).toBeUndefined();
    expect(photoCar({ isCar: false, make: 'Toyota', model: 'Veloz', confidence: 0.9 })).toBeUndefined();
    expect(photoCar({ isCar: true, make: 'Zorgmobile', model: 'X', confidence: 0.9 })).toBeUndefined();
    expect(photoCar(undefined)).toBeUndefined();
  });

  it('only into what is empty; a model only under the same make', () => {
    const photo = { make: 'Toyota', model: 'Veloz' };
    expect(photoFill({ make: '', model: '' }, photo)).toEqual({ make: 'Toyota', model: 'Veloz' });
    expect(photoFill({ make: 'Toyota', model: '' }, photo)).toEqual({ model: 'Veloz' });
    expect(photoFill({ make: 'Nissan', model: '' }, photo)).toEqual({});
    expect(photoFill({ make: 'Toyota', model: 'Avanza' }, photo)).toEqual({});
  });
});

describe('the photo against the VIN', () => {
  const said = (make: string, model: string) => ({ make: 'Toyota', model: 'Land Cruiser', photoAi: { make, model, at: '' } });

  it('the same car — nothing to ask; its model said too — the photo is proven', () => {
    const card = { make: 'Toyota', model: 'Veloz', photoAi: { make: 'Toyota', model: 'Veloz', at: '' } };
    expect(carCheckOf(card, VELOZ_VIN, { make: 'Toyota', model: 'Veloz' })).toBeUndefined();
    expect(photoProven(card, VELOZ_VIN, { make: 'Toyota', model: 'Veloz' })).toBe(true);
    // The VIN's model unknown: nothing to ask, nothing proven either.
    expect(carCheckOf(card, VELOZ_VIN, {})).toBeUndefined();
    expect(photoProven(card, VELOZ_VIN, {})).toBe(false);
  });

  it('another model (the owner’s Veloz the AI took for a Land Cruiser) — the person is asked', () => {
    expect(carCheckOf(said('Toyota', 'Land Cruiser'), VELOZ_VIN, { make: 'Toyota', model: 'Veloz' })).toEqual({ photo: { make: 'Toyota', model: 'Land Cruiser' }, vin: { make: 'Toyota', model: 'Veloz' } });
  });

  it('another make: the VIN’s own first characters say so, with no model known', () => {
    const card = { make: 'Nissan', model: 'Patrol', photoAi: { make: 'Nissan', model: 'Patrol', at: '' } };
    expect(carCheckOf(card, TOYOTA_JP, {})).toEqual({ photo: { make: 'Nissan', model: 'Patrol' }, vin: {} });
  });

  it('a person changed the make or model since, or chose already — the photo is no longer asked about', () => {
    expect(photoSays({ make: 'Toyota', model: 'Veloz', photoAi: { make: 'Toyota', model: 'Land Cruiser', at: '' } })).toBe(false);
    expect(carCheckOf({ make: 'Toyota', model: 'Veloz', photoAi: { make: 'Toyota', model: 'Land Cruiser', at: '' } }, VELOZ_VIN, { make: 'Toyota', model: 'Veloz' })).toBeUndefined();
    expect(carCheckOf({ make: 'Toyota', model: 'Land Cruiser', photoAi: { make: 'Toyota', model: 'Land Cruiser', at: '', checked: true } }, VELOZ_VIN, { make: 'Toyota', model: 'Veloz' })).toBeUndefined();
    expect(carCheckOf({ make: 'Toyota', model: 'Land Cruiser' }, VELOZ_VIN, { make: 'Toyota', model: 'Veloz' })).toBeUndefined();
  });

  it('the garage’s next car of the same VIN does not learn a model only the photo said', () => {
    const guessed = { id: 'a', vin: VELOZ_VIN, make: 'Toyota', model: 'Land Cruiser', photoAi: { make: 'Toyota', model: 'Land Cruiser' } };
    expect(stemCar('MHFAB1BY4P3011111', [guessed])).toBeUndefined();
    // Proven by its VIN (or chosen by a person): it counts.
    expect(stemCar('MHFAB1BY4P3011111', [{ ...guessed, photoAi: { ...guessed.photoAi, checked: true as const } }])?.model).toBe('Land Cruiser');
    // Written by a person over the photo's word: it counts.
    expect(stemCar('MHFAB1BY4P3011111', [{ ...guessed, model: 'Veloz' }])?.model).toBe('Veloz');
  });
});
