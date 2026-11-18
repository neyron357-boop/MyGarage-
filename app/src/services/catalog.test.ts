import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { lineServices } from '../domain/serviceCatalog';
import type { HistoryInvoice } from '../domain/types';
import { addCategory, addService, assignDescription, descriptionUses, loadCatalog, removeCategory, removeService, restoreService, saveService } from './catalog';
import { createCustomer } from './customers';
import { ensureSeed } from './seed';

/*
 * The catalogue of standard services (v0.46): it comes with the app; what the garage edits is its own record over it;
 * a description given its service by hand holds over every rule; nothing is deleted — taken out, it comes back. The
 * descriptions of the report lines, the most used first, are what «Проверить» looks through. Made-up data.
 */

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

const of = async (description: string) => lineServices(await loadCatalog())(description);

describe('the catalogue of standard services (v0.46)', () => {
  it('comes with the app: nothing written until something is edited', async () => {
    const c = await loadCatalog();
    expect(c.categories).toHaveLength(16);
    expect(c.services.length).toBeGreaterThan(60);
    expect(await db.services.count()).toBe(0);
    expect((await of('CHANGE OIL FILTER 10K KILOMETERS')).service?.id).toBe('svc-oil-change');
  });

  it('a description by hand holds over the rules; back to the rules — by them again', async () => {
    await assignDescription('Change oil / filter', 'svc-labour');
    expect(await of('CHANGE OIL FILTER')).toMatchObject({ service: { id: 'svc-labour' }, by: 'hand' });
    expect((await db.serviceMap.toArray()).map((e) => [e.id, e.by])).toEqual([['CHANGE OIL FILTER', 'hand']]);
    await assignDescription('CHANGE OIL FILTER', null);
    expect(await of('CHANGE OIL FILTER')).toMatchObject({ service: { id: 'svc-oil-change' }, by: 'rule' });
  });

  it('a service edited is its record of the same id; taken out and back with «Отменить»', async () => {
    const oil = (await loadCatalog()).services.find((s) => s.id === 'svc-oil-change')!;
    await saveService({ ...oil, keywords: [...oil.keywords, ' oil  service '] });
    expect((await db.services.get('svc-oil-change'))?.keywords).toContain('OIL SERVICE');
    expect((await of('OIL SERVICE 5000 KM')).service?.id).toBe('svc-oil-change');
    await expect(saveService({ ...oil, name: '  ' })).rejects.toThrow('err.nameRequired');

    const was = await removeService('svc-car-wash');
    expect((await of('FULL CAR WASH')).service).toBeUndefined();
    expect(await db.services.get('svc-car-wash')).toMatchObject({ archivedAt: expect.any(String) });
    await restoreService(was);
    expect((await of('FULL CAR WASH')).service?.id).toBe('svc-car-wash');
    expect((await db.services.get('svc-car-wash'))?.archivedAt).toBeUndefined();
  });

  it('a service and a category of the garage’s own; one of the same name is the one; a category with services stays', async () => {
    const cat = await addCategory('Fleet extras');
    const gps = await addService(' GPS  tracker ', cat.id);
    expect(gps).toMatchObject({ name: 'GPS tracker', keywords: ['GPS TRACKER'], categoryId: cat.id });
    expect(await of('GPS TRACKER INSTALLATION')).toMatchObject({ service: { id: gps.id }, category: { name: 'Fleet extras' } });
    expect((await addService('gps tracker', cat.id)).id).toBe(gps.id);
    expect((await addCategory('fleet EXTRAS')).id).toBe(cat.id);
    await expect(removeCategory(cat.id)).rejects.toThrow('err.categoryNotEmpty');
    await removeService(gps.id);
    await removeCategory(cat.id);
    expect((await loadCatalog()).categories.find((c) => c.id === cat.id)?.archivedAt).toBeTruthy();
  });

  it('the descriptions of the lines that go into reports, the most used first', async () => {
    const c = await createCustomer({ name: 'ACME CONTRACTING LLC', phone: '', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'company' });
    const inv = (id: string, lines: string[]): HistoryInvoice => ({
      id,
      customerId: c.id,
      vehicleId: 'v',
      template: 'B',
      numberKind: 'job',
      number: id,
      date: '2026-07-01',
      plateRaw: 'W 1',
      plate: 'W-1',
      vehicleText: 'Nissan Urvan',
      lines: lines.map((description) => ({ description, qty: 1, unitNetFils: 100, netFils: 100, vatFils: 5, grossFils: 105 })),
      netFils: lines.length * 100,
      vatFils: lines.length * 5,
      totalFils: lines.length * 105,
      source: { file: 'x.pdf', sha256: 'x', page: 1 },
      importedAt: '',
    });
    await db.historyInvoices.bulkPut([inv('1', ['CHANGE OIL', 'Magic smoke removal']), inv('2', ['change  oil'])]);
    expect(await descriptionUses()).toEqual([
      { key: 'CHANGE OIL', description: 'CHANGE OIL', lines: 2 },
      { key: 'MAGIC SMOKE REMOVAL', description: 'Magic smoke removal', lines: 1 },
    ]);
  });
});
