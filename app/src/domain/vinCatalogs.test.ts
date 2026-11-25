import { describe, expect, it } from 'vitest';
import { carRegion, vinCatalogs } from './vinCatalogs';

describe('the catalogues by the car’s VIN (v0.66)', () => {
  it('the likeliest first, by where the car was built', () => {
    // Built in Japan — EMEX DWC, then catcar; built for North America — RockAuto; built elsewhere — EMEX DWC.
    expect(carRegion('JHMFD16408S200000')).toBe('jk');
    expect(carRegion('1HGCM82633A004352')).toBe('us');
    expect(carRegion('MR0FZ29G601000000')).toBe('gcc');
    expect(carRegion(undefined)).toBe('gcc');
    expect(vinCatalogs({ vin: '1HGCM82633A004352', make: 'Honda', model: 'Accord', year: 2003 }).map((c) => c.id).slice(0, 3)).toEqual(['rockauto', 'showmetheparts', 'partsgeek']);
    expect(vinCatalogs({ vin: 'JHMFD16408S200000', make: 'Honda' }).map((c) => c.id).slice(0, 2)).toEqual(['emex', 'catcar']);
    expect(vinCatalogs({ vin: 'MR0FZ29G601000000', make: 'Toyota' }).map((c) => c.id).slice(0, 4)).toEqual(['emex', 'exist', '7zap', 'catcar']);
    expect(vinCatalogs({ make: 'BMW' }).map((c) => c.id).slice(0, 2)).toEqual(['emex', 'elcats']);
    // All eight, each once.
    expect(new Set(vinCatalogs({}).map((c) => c.id)).size).toBe(8);
  });

  it('opens on this car: the VIN in the address where the site takes it, make–year–model at RockAuto', () => {
    const list = vinCatalogs({ vin: '1hgcm82633a004352', make: 'Honda', model: 'Accord Coupe', year: 2003 });
    const by = Object.fromEntries(list.map((c) => [c.id, c]));
    expect(by.emex).toMatchObject({ url: 'https://emexdwc.ae/Vehicles.aspx?ft=findByVIN&c=&ssd=&vin=1HGCM82633A004352', vinInUrl: true });
    expect(by.exist).toMatchObject({ url: 'https://www.exist.ru/Price/Empty.aspx?q=1HGCM82633A004352', vinInUrl: true });
    expect(by.rockauto.url).toBe('https://www.rockauto.com/en/catalog/honda,2003,accord+coupe');
    expect(by['7zap'].vinInUrl).toBe(false);
    // No VIN: the sites' own pages, nothing made up.
    const none = Object.fromEntries(vinCatalogs({ make: 'Honda' }).map((c) => [c.id, c]));
    expect([none.emex.url, none.emex.vinInUrl, none.rockauto.url]).toEqual(['https://emexdwc.ae/', false, 'https://www.rockauto.com/']);
  });
});
