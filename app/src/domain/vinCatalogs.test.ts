import { describe, expect, it } from 'vitest';
import { carFacts, fitmentOf } from './fitment';
import { carRegion, catalogOfHost, vinCatalogs } from './vinCatalogs';

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
    expect(catalogOfHost('www.emexdwc.ae')).toBe('emex');
  });

  it('a number the manager found by this car’s VIN is verified — for that number and that VIN only; a conflict still wins', () => {
    const car = carFacts({ id: 'v', make: 'Honda', model: 'Civic', year: 2008, engine: '1.8L', vin: 'JHMFD16408S200000' });
    const check = { number: '56992-RNA-A02', vin: 'JHMFD16408S200000', source: 'emexdwc.ae', at: '2026-11-22T10:00:00.000Z' };
    const f = fitmentOf({ part: 'ENGINE BELT', car, candidate: { number: '56992RNAA02', seen: [] }, search: 'web', vinCheck: check });
    expect(f.status).toBe('verified');
    expect(f.reasons).toEqual([{ code: 'vinCatalogue', params: { site: 'emexdwc.ae' } }]);
    expect(f.evidence[0]).toMatchObject({ kind: 'vin', source: 'emexdwc.ae', weight: 'fits' });
    // Another number, or another VIN in the card: it no longer holds — and the check by VIN is what is missing.
    const other = fitmentOf({ part: 'ENGINE BELT', car, candidate: { number: '31110-RSA-G01', seen: [] }, search: 'web', vinCheck: check });
    expect(other.status).toBe('unverified');
    expect(other.missing).toContain('vinCheck');
    expect(fitmentOf({ part: 'ENGINE BELT', car: { ...car, vinCode: 'JHMFD16408S299999' }, candidate: { number: '56992-RNA-A02', seen: [] }, search: 'web', vinCheck: check }).status).not.toBe('verified');
    // The belt on the car says otherwise (a 7PK1535 stated for it): a conflict, whatever was clicked.
    const conflict = fitmentOf({
      part: 'ENGINE BELT',
      car,
      candidate: { number: '56992-RNA-A02', seen: [], check: { at: check.at, epc: { state: 'unread' }, web: [], specs: [{ text: '7PK1535', by: 'page', from: 'https://a.example' }], named: 'search' } },
      search: 'web',
      vinCheck: check,
      marking: { text: '7PK2164', from: 'typed', confidence: 1, at: check.at },
    });
    expect(conflict.status).toBe('conflict');
  });
});
