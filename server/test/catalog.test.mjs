import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogHtml } from './catalog-page.mjs';
import { catalogSlugs, catalogUrl, diagramFits, diagramFrames, frameFits, headingModels, readCatalogPage, sameKind, yearsOf } from '../src/catalog.mjs';

describe('the open catalogue, read by a number', () => {
  it('knows its makes (a sister make is tried next) and writes a number’s address', () => {
    assert.deepEqual(catalogSlugs('Toyota'), ['toyota', 'lexus']);
    assert.deepEqual(catalogSlugs('LEXUS'), ['lexus', 'toyota']);
    assert.deepEqual(catalogSlugs('Mercedes-Benz'), ['mercedes']);
    assert.deepEqual(catalogSlugs('Fuso'), ['mitsubishi']);
    assert.deepEqual(catalogSlugs('GMC'), []);
    assert.equal(catalogUrl('toyota', '88310-52481'), 'https://www.megazip.net/parts/toyota-8831052481');
    assert.equal(catalogUrl('mercedes', 'A 276 180 00 09'), 'https://www.megazip.net/parts/mercedes-2761800009');
    assert.equal(catalogUrl('toyota', '12'), '');
  });

  it('reads a page: the number as written, the maker’s name, the numbers that replaced it, the diagrams with their model, years and the callout’s place', () => {
    const pg = readCatalogPage(
      catalogHtml({
        number: '1234567890',
        formatted: '12345-67890',
        name: 'Compressor Assy, W/Pulley',
        superseded: true,
        family: ['12345-67891'],
        diagrams: [
          { image: 'https://epc.partsbooster.com/schemas/toyota/aa.png', name: 'Heating & Air Conditioning Compressor', header: 'Toyota Verso NCP91', sub: ['2nd Gen', '2005 — 2011'], areas: [[314, 74, 373, 94]] },
          { image: 'https://epc.partsbooster.com/schemas/toyota/bb.png', name: 'Compressor', header: 'Toyota Limo NCP92', sub: ['2002 for today'], areas: [] },
        ],
      }),
    );
    assert.deepEqual([pg.number, pg.name, pg.brand], ['12345-67890', 'Compressor Assy, W/Pulley', 'Toyota']);
    assert.deepEqual([pg.newer, pg.older], [['12345-67891'], []]);
    assert.deepEqual(pg.diagrams.map((d) => [d.model, d.years, d.areas.length]), [['Toyota Verso NCP91', { from: 2005, to: 2011 }, 1], ['Toyota Limo NCP92', { from: 2002 }, 0]]);
    assert.deepEqual(pg.diagrams[0].areas[0], { x1: 314, y1: 74, x2: 373, y2: 94 });
    // The other way: this number replaced an older one.
    const newer = readCatalogPage(catalogHtml({ number: '1234567891', formatted: '12345-67891', name: 'Compressor Assy, W/Pulley', replaces: true, family: ['12345-67890'] }));
    assert.deepEqual([newer.newer, newer.older], [[], ['12345-67890']]);
  });

  it('reads what it can of a page that changed (its title, its pictures) — and nothing of a page that is no part’s', () => {
    const pg = readCatalogPage('<html><head><title>55555-0A010 Genuine Lexus Pad Kit, Disc Brake &amp; Shim | Megazip</title></head><body><img src="https://epc.partsbooster.com/schemas/lexus/zz.png" alt=""></body></html>');
    assert.deepEqual([pg.number, pg.brand, pg.name, pg.diagrams.length, pg.diagrams[0].image], ['55555-0A010', 'Lexus', 'Pad Kit, Disc Brake & Shim', 1, 'https://epc.partsbooster.com/schemas/lexus/zz.png']);
    assert.equal(readCatalogPage('<html><head><title>Search results | Megazip</title></head><body>nothing</body></html>'), null);
    assert.equal(readCatalogPage(''), null);
  });

  it('years: a span, «for today», a model year', () => {
    assert.deepEqual(yearsOf(['2nd Gen', '2005 — 2011']), { from: 2005, to: 2011 });
    assert.deepEqual(yearsOf(['2002 for today']), { from: 2002 });
    assert.deepEqual(yearsOf(['G5', 'Model 2016']), { from: 2016 });
    assert.equal(yearsOf(['5th Gen']), undefined);
  });

  it('a diagram is of this car: its model (not a longer-named other one), its years — a year either side; years that end lately are open', () => {
    const now = new Date('2026-11-19');
    const d = (model, from, to) => ({ model, years: { from, to } });
    const fits = (x, car, brand) => diagramFits(x, car, brand, now);
    assert.deepEqual(headingModels('Nissan Nv350 Caravan/Urvan E26', 'Nissan'), ['nv350caravan', 'urvan']);
    assert.deepEqual(headingModels('Toyota Land Cruiser Prado KDJ150', 'Toyota'), ['landcruiserprado']);
    assert.deepEqual(headingModels('Mazda Mazda 3 BM', 'Mazda'), ['mazda3', '3']);
    assert.ok(fits(d('Toyota Yaris NCP91', 2005, 2011), { make: 'Toyota', model: 'Yaris', year: 2006 }, 'Toyota'));
    assert.ok(fits(d('Toyota Yaris NCP91', 2005, 2011), { make: 'Toyota', model: 'Yaris', year: 2012 }, 'Toyota'));
    assert.ok(!fits(d('Toyota Yaris NCP91', 2005, 2011), { make: 'Toyota', model: 'Yaris', year: 2014 }, 'Toyota'));
    assert.ok(!fits(d('Toyota Land Cruiser Prado KDJ150', 2009, 2023), { make: 'Toyota', model: 'Land Cruiser', year: 2016 }, 'Toyota'));
    assert.ok(fits(d('Toyota Land Cruiser UZJ200', 2007, 2021), { make: 'Toyota', model: 'Land Cruiser', year: 2016 }, 'Toyota'));
    // The catalogue's data ends in 2021, the model is still made: a 2026 car is of it.
    assert.ok(fits(d('Nissan Nv350 Caravan/Urvan E26', 2012, 2021), { make: 'Nissan', model: 'Urvan', year: 2026 }, 'Nissan'));
    assert.ok(fits(d('Mazda Mazda 3 BM', 2013, 2019), { make: 'Mazda', model: '3', year: 2015 }, 'Mazda'));
    assert.ok(fits(d('Lexus LX570 URJ201', 2007, 2015), { make: 'Lexus', model: 'LX 570', year: 2013 }, 'Lexus'));
    // No year — not said (a model's generations have different parts).
    assert.ok(!fits(d('Toyota Yaris NCP91', 2005, 2011), { make: 'Toyota', model: 'Yaris' }, 'Toyota'));
  });

  it('a diagram’s frame codes, and a car’s frame among them', () => {
    assert.deepEqual(diagramFrames({ model: 'Toyota Yaris NCP91', lines: ['2nd Gen', '2005 — 2011'] }), ['NCP91']);
    assert.deepEqual(diagramFrames({ model: 'Hyundai Elantra / Avante', lines: ['2015 — 2021', 'AD'] }), ['AD']);
    assert.ok(frameFits({ model: 'Toyota Yaris NCP91', lines: [] }, ['NCP91L', 'NCP93']));
    assert.ok(!frameFits({ model: 'Toyota Yaris NCP90', lines: [] }, ['NCP91', 'NCP93']));
    assert.ok(frameFits({ model: 'Nissan Nv350 Caravan/Urvan CS8E26', lines: [] }, ['E26']));
    assert.ok(frameFits({ model: 'Toyota Land Cruiser GRJ200', lines: [] }, ['GRJ200', 'URJ202']));
    assert.ok(!frameFits({ model: 'Toyota Land Cruiser UZJ200', lines: [] }, []));
  });

  it('two names of one part: the same head word and no other system — a garage’s word order against a catalogue’s', () => {
    const yes = [
      ['FRONT BRAKE PADS', 'Pad Kit, Disc Brake, Front'],
      ['RADIATOR HOSE', 'Hose, Radiator, Inlet'],
      ['OIL FILTER', 'Cartridge, Oil Filter'],
      ['OIL FILTER', 'OIL FILTER'],
      ['AC COMPRESSOR NEW', 'Compressor Assy, W/Pulley'],
      ['TENSIONER PULLEY', 'Tensioner Assy'],
      ['ENGINE KIT GASKET COMPLETE', 'Gasket Kit,Eng Overhaul'],
      ['AC EVAPORATOR NEW ORIGINAL', 'EVAPORATORAC'],
      ['FRONT SHOCK ABSORBER LEFT & RIGHT KYB', 'Absorber Assy, Shock, Front RH'],
      ['CABIN FILTER', 'Element, Air Refiner'],
      ['ENGINE MOUNT FULL SET', 'Insulator Sub-Assy, Engine Mounting, Front'],
      ['COMPRESSOR W/PULLEY', 'Compressor Assy, W/Pulley'],
      ['BRAKE PADS WITH SENSOR', 'Pad Kit, Disc Brake, Front'],
      ['BATTERY (12 MONTHS WARRANTY)', 'Battery'],
    ];
    const no = [
      ['FRONT BRAKE PADS', 'Disc, Front'],
      ['BRAKE DISC', 'Pad Kit, Disc Brake, Front'],
      ['RADIATOR HOSE', 'Radiator Assy'],
      ['AIR FILTER', 'Filter Assy-Oil'],
      ['WATER PUMP', 'Pump Assy, Oil'],
      ['ENGINE GASKET KIT', 'Engine Assy'],
    ];
    for (const [a, c] of yes) assert.equal(sameKind(a, c), true, `${a} | ${c}`);
    for (const [a, c] of no) assert.equal(sameKind(a, c), false, `${a} | ${c}`);
    // Nothing to compare: not known.
    assert.equal(sameKind('AC COMPRESSOR', 'New Genuine Part'), undefined);
  });
});
