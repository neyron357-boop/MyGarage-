import { SEED_CATEGORIES, SEED_SERVICES } from './serviceCatalogSeed';
import type { Service, ServiceCategory, ServiceMapEntry } from './types';

/*
 * The standard services (v0.45, filled in v0.46): what a line of an invoice is, whatever its words — «CHANGE OIL /
 * FILTER», «OIL CHANGE 10K KM» are both «Oil change (engine oil + filter)». A description is its service by the
 * catalogue's entry for it (set by hand), else by a rule: a service's keywords — the line whose words hold one is that
 * service («*WASH*» — any word with WASH in it). None — the line waits in «Проверить». The catalogue comes with the app
 * (serviceCatalogSeed.ts), the garage's edits over it (`mergeCatalog`). Pure.
 */

/** A description's key: upper case, letters and digits only, one space between words. */
export function descKey(description: string): string {
  return description
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface Catalog {
  services: Service[];
  categories: ServiceCategory[];
  map: ServiceMapEntry[];
}

/**
 * The keyword of a service that fits a description best, with its service; none — none fits. The longest keyword wins
 * (the most it says: «FRONT BRAKE DISC» is a disc, not «BRAKE» — pads); a line that starts with a labour word is labour,
 * whatever it names after («LABOUR CHARGES … POWER STEERING …»; «DOOR HANDLE REPAIR WITH LABOUR» is a door); a tie — the
 * service listed first.
 */
export function ruleFor(description: string, services: Service[]): { service: Service; keyword: string } | undefined {
  const key = descKey(description);
  let best: { service: Service; keyword: string; score: number } | undefined;
  for (const s of services) {
    if (s.archivedAt) continue;
    for (const k of s.keywords) {
      const kk = descKey(k);
      if (!kk || !key.includes(kk)) continue;
      const score = (s.kind === 'labour' && key.startsWith(kk) ? 1000 : 0) + kk.length;
      if (!best || score > best.score || (score === best.score && s.position < best.service.position)) best = { service: s, keyword: k, score };
    }
  }
  return best && { service: best.service, keyword: best.keyword };
}

/** A description's service: the catalogue's entry for it, else a rule's; none — to be looked at. */
export function serviceFor(description: string, catalog: Pick<Catalog, 'services' | 'map'>): { serviceId: string; by: ServiceMapEntry['by'] } | undefined {
  const key = descKey(description);
  const entry = catalog.map.find((e) => e.id === key);
  if (entry && catalog.services.some((s) => s.id === entry.serviceId && !s.archivedAt)) return { serviceId: entry.serviceId, by: entry.by };
  const rule = ruleFor(description, catalog.services);
  return rule ? { serviceId: rule.service.id, by: 'rule' } : undefined;
}

const byPosition = <T extends { position: number; name: string }>(a: T, b: T) => a.position - b.position || a.name.localeCompare(b.name);

/**
 * The catalogue the garage works with: the one that comes with the app (serviceCatalogSeed.ts) with the garage's own
 * records over it — a service or a category edited (or taken out) is its record of the same id, one added is a record
 * only. Each list in its order.
 */
export function mergeCatalog(own: Catalog, seed: Pick<Catalog, 'categories' | 'services'> = { categories: SEED_CATEGORIES, services: SEED_SERVICES }): Catalog {
  const over = <T extends { id: string }>(base: T[], mine: T[]) => {
    const all = new Map(base.map((x) => [x.id, x]));
    for (const x of mine) all.set(x.id, x);
    return [...all.values()];
  };
  return { categories: over(seed.categories, own.categories).sort(byPosition), services: over(seed.services, own.services).sort(byPosition), map: own.map };
}

/** What a line is: its service and that service's category; none — to be looked at («Проверить»). */
export interface LineService {
  service?: Service;
  category?: ServiceCategory;
  by?: ServiceMapEntry['by'];
}

/** A line's service and category by the catalogue, for many lines at once. */
export function lineServices(catalog: Catalog): (description: string) => LineService {
  const services = new Map(catalog.services.map((s) => [s.id, s]));
  const categories = new Map(catalog.categories.map((c) => [c.id, c]));
  const cache = new Map<string, LineService>();
  return (description) => {
    const key = descKey(description);
    const had = cache.get(key);
    if (had) return had;
    const found = serviceFor(description, catalog);
    const service = found && services.get(found.serviceId);
    const line: LineService = service ? { service, category: categories.get(service.categoryId), by: found.by } : {};
    cache.set(key, line);
    return line;
  };
}

/** A quick look-up of a catalogue (a map by key), for many lines at once. */
export function serviceLookup(catalog: Pick<Catalog, 'services' | 'map'>): (description: string) => string | undefined {
  const active = new Set(catalog.services.filter((s) => !s.archivedAt).map((s) => s.id));
  const byKey = new Map(catalog.map.filter((e) => active.has(e.serviceId)).map((e) => [e.id, e.serviceId]));
  const cache = new Map<string, string | undefined>();
  return (description) => {
    const key = descKey(description);
    if (cache.has(key)) return cache.get(key);
    const found = byKey.get(key) ?? ruleFor(description, catalog.services)?.service.id;
    cache.set(key, found);
    return found;
  };
}
