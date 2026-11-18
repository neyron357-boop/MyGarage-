import type { Service, ServiceCategory, ServiceMapEntry } from './types';

/*
 * The standard services (v0.45): what a line of an invoice is, whatever its words — «CHANGE OIL / FILTER», «OIL CHANGE
 * 10K KM» are both «Oil change (engine oil + filter)». A description is its service by the catalogue's entry for it
 * (seeded from the customer's report, or set by hand), else by a rule: a service's keywords — the line whose words hold
 * one is that service, the longest keyword that fits winning («*WASH*» — any word with WASH in it). None — the line
 * waits in «Проверить». Pure.
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

/** The keyword of a service that fits a description best (the longest), with its service; none — none fits. */
export function ruleFor(description: string, services: Service[]): { service: Service; keyword: string } | undefined {
  const key = ` ${descKey(description)} `;
  let best: { service: Service; keyword: string } | undefined;
  for (const s of services) {
    if (s.archivedAt) continue;
    for (const k of s.keywords) {
      const kk = descKey(k);
      if (!kk || !key.includes(kk)) continue;
      if (!best || kk.length > descKey(best.keyword).length || (kk.length === descKey(best.keyword).length && s.position < best.service.position)) best = { service: s, keyword: k };
    }
  }
  return best;
}

/** A description's service: the catalogue's entry for it, else a rule's; none — to be looked at. */
export function serviceFor(description: string, catalog: Pick<Catalog, 'services' | 'map'>): { serviceId: string; by: ServiceMapEntry['by'] } | undefined {
  const key = descKey(description);
  const entry = catalog.map.find((e) => e.id === key);
  if (entry && catalog.services.some((s) => s.id === entry.serviceId && !s.archivedAt)) return { serviceId: entry.serviceId, by: entry.by };
  const rule = ruleFor(description, catalog.services);
  return rule ? { serviceId: rule.service.id, by: 'rule' } : undefined;
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
