import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { lineName } from '../domain/items';
import { descKey, mergeCatalog, type Catalog } from '../domain/serviceCatalog';
import type { Service, ServiceCategory } from '../domain/types';
import { AppError } from './errors';

/*
 * The catalogue of standard services (v0.46, Settings → Services): what each line of an invoice is — its service and its
 * category — in a customer's report (the Excel: Work Details, Services, Overview). It comes with the app
 * (domain/serviceCatalogSeed.ts); what the garage edits is kept as its own record over it (`services`,
 * `serviceCategories` — the same id), a description given its service by hand — `serviceMap`. A line's service is worked
 * out when the line is read: an edit here holds for every line at once, and no invoice changes. Nothing is deleted: a
 * service or a category taken out (`archivedAt`) comes back with «Отменить».
 */

/** The catalogue: the app's with the garage's edits over it. */
export async function loadCatalog(): Promise<Catalog> {
  const [categories, services, map] = await Promise.all([db.serviceCategories.toArray(), db.services.toArray(), db.serviceMap.toArray()]);
  return mergeCatalog({ categories, services, map });
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
/** Keywords in upper case (lines are), each once. */
const words = (list: string[]) => [...new Set(list.map((k) => clean(k).toUpperCase()).filter(Boolean))];
const without = <T extends { archivedAt?: string }>(x: T): T => {
  const { archivedAt: _, ...rest } = x;
  return rest as T;
};

/** A service as edited: its name (one there must be), category, keywords. */
export async function saveService(s: Service): Promise<void> {
  const name = clean(s.name);
  if (!name) throw new AppError('err.nameRequired');
  await db.services.put({ ...s, name, keywords: words(s.keywords) });
}

/**
 * A service of the garage's own, last in the list; its name is its first keyword (a line with these words is it). One of
 * that name already there is the one — taken out, it comes back.
 */
export async function addService(name: string, categoryId: string): Promise<Service> {
  const n = clean(name);
  if (!n) throw new AppError('err.nameRequired');
  const { services } = await loadCatalog();
  const had = services.find((s) => s.name.toLowerCase() === n.toLowerCase());
  if (had) {
    if (!had.archivedAt) return had;
    const back = without(had);
    await db.services.put(back);
    return back;
  }
  const s: Service = { id: `svc-${uid()}`, name: n, categoryId, keywords: words([n]), position: Math.max(0, ...services.map((x) => x.position)) + 1 };
  await db.services.put(s);
  return s;
}

/** Taken out of the catalogue: its lines wait in «Проверить» again (unless another service fits). Returns it for «Отменить». */
export async function removeService(id: string): Promise<Service> {
  const s = (await loadCatalog()).services.find((x) => x.id === id);
  if (!s) throw new AppError('err.notFound');
  await db.services.put({ ...s, archivedAt: nowIso() });
  return s;
}

/** «Отменить» of `removeService`. */
export async function restoreService(s: Service): Promise<void> {
  await db.services.put(without(s));
}

/** A category as edited. */
export async function saveCategory(c: ServiceCategory): Promise<void> {
  const name = clean(c.name);
  if (!name) throw new AppError('err.nameRequired');
  await db.serviceCategories.put({ ...c, name });
}

/** A category of the garage's own, last; one of that name already there is the one. */
export async function addCategory(name: string): Promise<ServiceCategory> {
  const n = clean(name);
  if (!n) throw new AppError('err.nameRequired');
  const { categories } = await loadCatalog();
  const had = categories.find((c) => c.name.toLowerCase() === n.toLowerCase());
  if (had) {
    if (!had.archivedAt) return had;
    const back = without(had);
    await db.serviceCategories.put(back);
    return back;
  }
  const c: ServiceCategory = { id: `cat-${uid()}`, name: n, position: Math.max(0, ...categories.map((x) => x.position)) + 1 };
  await db.serviceCategories.put(c);
  return c;
}

/** Taken out — only an empty one (its services elsewhere or taken out first). Returns it for «Отменить». */
export async function removeCategory(id: string): Promise<ServiceCategory> {
  const { categories, services } = await loadCatalog();
  const c = categories.find((x) => x.id === id);
  if (!c) throw new AppError('err.notFound');
  if (services.some((s) => s.categoryId === id && !s.archivedAt)) throw new AppError('err.categoryNotEmpty');
  await db.serviceCategories.put({ ...c, archivedAt: nowIso() });
  return c;
}

/** «Отменить» of `removeCategory`. */
export async function restoreCategory(c: ServiceCategory): Promise<void> {
  await db.serviceCategories.put(without(c));
}

/** A description given its service by hand (it holds over every rule); `null` — back to the rules. */
export async function assignDescription(description: string, serviceId: string | null): Promise<void> {
  const id = descKey(description);
  if (!id) return;
  if (serviceId === null) await db.serviceMap.delete(id);
  else await db.serviceMap.put({ id, description: clean(description), serviceId, by: 'hand', at: nowIso() });
}

export interface DescriptionUse {
  key: string;
  /** As printed (the first line met). */
  description: string;
  lines: number;
}

/**
 * The descriptions of the lines that go into customers' reports — the invoices from before the app and this app's issued
 * invoices of companies — with how many lines each, the most used first.
 */
export async function descriptionUses(): Promise<DescriptionUse[]> {
  const uses = new Map<string, DescriptionUse>();
  const add = (d: string) => {
    const key = descKey(d);
    if (!key) return;
    const u = uses.get(key);
    if (u) u.lines++;
    else uses.set(key, { key, description: clean(d), lines: 1 });
  };
  for (const h of await db.historyInvoices.toArray()) for (const l of h.lines) add(l.description);
  const companies = (await db.customers.toArray()).filter((c) => c.type === 'company').map((c) => c.id);
  const orders = companies.length ? await db.orders.where('customerId').anyOf(companies).primaryKeys() : [];
  if (orders.length)
    for (const inv of await db.invoices.where('orderId').anyOf(orders).toArray())
      if (inv.type !== 'credit_note' && inv.status === 'issued') for (const l of inv.lines) add(lineName(l.description, l.kind));
  return [...uses.values()].sort((a, b) => b.lines - a.lines || a.key.localeCompare(b.key));
}
