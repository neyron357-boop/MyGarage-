import { canonicalMake } from './carCatalog';
import { isVin, vinBuilt } from './vin';

/*
 * The parts catalogues the garage looks a part up in by the car's VIN (v0.66, the user: «я дам тебе ссылки на каталоги…
 * в первую очередь прошлись по ним, введя VIN… случай: ИИ не мог найти деталь, а я зашёл в emexdwc.ae, вбил VIN и нашёл
 * деталь — такого не должно повториться»). Which ones, in what order for this car, and the address that opens each on it.
 *
 * What a program may do there was checked (22/11/2026): EMEX DWC opens its found vehicles by a VIN in the address, EXIST
 * finds the car by a VIN in the address — the rest of their catalogues (the car's units, the search by a part's name) are
 * closed to programs by their own rules (robots.txt: Vehicle.aspx, Unit.aspx, QuickDetails.aspx; elcats.ru — everything);
 * 7zap's search by VIN is a paid plan's; showmetheparts.com and partsgeek.com turn programs away (Incapsula, 403);
 * RockAuto opens a car's catalogue by make, year and model. So nothing walks them — the manager is taken there in one
 * tap, on this car, the VIN copied for the sites that do not take it in the address (v0.85: links only — the AI's
 * catalogue search and the fitment's «found by VIN» are gone, the owner's decision).
 */

export type CatalogId = 'emex' | 'exist' | '7zap' | 'elcats' | 'catcar' | 'showmetheparts' | 'partsgeek' | 'rockauto';

export interface VinCatalog {
  id: CatalogId;
  name: string;
  /** Where it opens: on this car (the VIN, or make–year–model in the address) or its own page. */
  url: string;
  /** The address carries the VIN: nothing to paste. Else the VIN is copied on the tap. */
  vinInUrl: boolean;
}

/** Where the car comes from, for the catalogues' order: built for North America, in Japan or Korea, or the rest (the GCC's own). */
export type CarRegion = 'us' | 'jk' | 'gcc';

const JK_MAKES = /^(toyota|lexus|nissan|infiniti|honda|acura|mitsubishi|mazda|subaru|suzuki|isuzu|daihatsu|hino|hyundai|kia|genesis|ssangyong)$/;
const EU_MAKES = /^(audi|volkswagen|vw|skoda|seat|porsche|bmw|mini|mercedes|mercedesbenz|opel|peugeot|citroen|renault|volvo|landrover|jaguar|fiat|alfaromeo)$/;
const squash = (s: string) => canonicalMake(s).toLowerCase().replace(/[^a-z]/g, '');

/** Where a car was built, by its VIN's maker code (none — no VIN, or a code that says nothing). */
export function carRegion(vin: string | undefined): CarRegion {
  const v = (vin ?? '').toUpperCase().replace(/\s/g, '');
  const built = isVin(v) ? vinBuilt(v) : undefined;
  if (built === 'USA' || built === 'Canada' || built === 'Mexico') return 'us';
  if (built === 'Japan' || built === 'Korea') return 'jk';
  return 'gcc';
}

/** A part of an address: lower case, spaces as «+» (RockAuto's own way). */
const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '+');

/**
 * The catalogues for this car, the likeliest first: a car built for North America — RockAuto (its catalogue and photos of
 * the parts), showmetheparts, PartsGeek; one built in Japan or Korea — EMEX DWC, then catcar (most here are GCC cars built
 * there: a VIN does not tell the market, and EMEX found by the VIN what the search had not); the rest (the GCC's) — EMEX
 * DWC, EXIST, 7zap, elcats. The other catalogues follow, each on this car where its address can say so.
 */
export function vinCatalogs(car: { vin?: string; make?: string; model?: string; year?: number }): VinCatalog[] {
  const vin = (car.vin ?? '').toUpperCase().replace(/\s/g, '');
  const valid = isVin(vin);
  const make = squash(car.make ?? '');
  const region = carRegion(vin);
  const all: Record<CatalogId, VinCatalog> = {
    emex: { id: 'emex', name: 'EMEX DWC', url: valid ? `https://emexdwc.ae/Vehicles.aspx?ft=findByVIN&c=&ssd=&vin=${vin}` : 'https://emexdwc.ae/', vinInUrl: valid },
    exist: { id: 'exist', name: 'EXIST', url: valid ? `https://www.exist.ru/Price/Empty.aspx?q=${vin}` : 'https://www.exist.ru/Catalog/', vinInUrl: valid },
    '7zap': { id: '7zap', name: '7zap', url: 'https://7zap.com/ru/vin-decoder/', vinInUrl: false },
    elcats: { id: 'elcats', name: 'Elcats', url: 'https://www.elcats.ru/', vinInUrl: false },
    catcar: { id: 'catcar', name: 'Catcar', url: 'https://www.catcar.info/en/', vinInUrl: false },
    showmetheparts: { id: 'showmetheparts', name: 'ShowMeTheParts', url: 'https://www.showmetheparts.com/', vinInUrl: false },
    partsgeek: { id: 'partsgeek', name: 'PartsGeek', url: 'https://www.partsgeek.com/', vinInUrl: false },
    rockauto: {
      id: 'rockauto',
      name: 'RockAuto',
      url: car.make?.trim() && car.model?.trim() && car.year ? `https://www.rockauto.com/en/catalog/${slug(car.make)},${car.year},${slug(car.model)}` : 'https://www.rockauto.com/',
      vinInUrl: false,
    },
  };
  const order: CatalogId[] =
    region === 'us'
      ? ['rockauto', 'showmetheparts', 'partsgeek', 'emex', 'exist', '7zap', 'elcats', 'catcar']
      : region === 'jk'
        ? ['emex', 'catcar', 'exist', '7zap', 'elcats', 'showmetheparts', 'partsgeek', 'rockauto']
        : JK_MAKES.test(make)
          ? ['emex', 'exist', '7zap', 'catcar', 'elcats', 'showmetheparts', 'partsgeek', 'rockauto']
          : EU_MAKES.test(make)
            ? ['emex', 'elcats', 'exist', '7zap', 'showmetheparts', 'partsgeek', 'rockauto', 'catcar']
            : ['emex', 'exist', '7zap', 'elcats', 'showmetheparts', 'partsgeek', 'catcar', 'rockauto'];
  return order.map((id) => all[id]);
}
