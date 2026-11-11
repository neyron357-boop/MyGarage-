import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { OBD_REPORT_ITEMS } from '../domain/obdReport.testdata';
import { getOrCreateInspection } from './inspections';
import { importObdReport } from './obd';
import { checkIn, loadOrderBundle } from './orders';
import { ensureSeed } from './seed';

const pdf = () => new Blob(['%PDF-1.4 report'], { type: 'application/pdf' });

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('a scanner report read into a job', () => {
  it('keeps the codes and the PDF, fills what the car card is missing and the open act', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'A', number: '55555' }, make: '', model: '', name: '', phone: '', docLanguage: 'en', complaint: 'Check engine', arrivedNow: true });
    await getOrCreateInspection(o.id, 'intake');
    const r = await importObdReport(o.id, pdf(), OBD_REPORT_ITEMS);
    expect(r.filled.sort()).toEqual(['engine', 'make', 'model', 'vin', 'year']);
    const b = (await loadOrderBundle(o.id))!;
    expect(b.vehicle).toMatchObject({ vin: '1GKFLTE30BX000001', year: 2011, make: 'GM', model: 'Terrain' });
    expect(b.order.obdScans).toHaveLength(1);
    expect(b.order.obdScans![0].codes.map((c) => c.code)).toEqual(['P0430', 'P0700', 'P0872', 'P0877', 'P0989', 'P182E', 'U0073', 'C056D']);
    expect((await db.media.get(b.order.obdScans![0].mediaId!))!.kind).toBe('pdf');
    expect(b.intake!.obdCodes).toContain('P0430');
    expect(b.intake!.mileageKm).toBe(243951);

    // The car's VIN already there and different: kept, and said.
    await db.vehicles.update(b.vehicle.id, { vin: 'JTDBR32E720012345' });
    const again = await importObdReport(o.id, pdf(), OBD_REPORT_ITEMS);
    expect(again.vinMismatch).toBe('1GKFLTE30BX000001');
    expect((await db.vehicles.get(b.vehicle.id))!.vin).toBe('JTDBR32E720012345');
    expect((await db.orders.get(o.id))!.obdScans).toHaveLength(2);
  });

  it('refuses a PDF that is not a scanner report', async () => {
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'A', number: '66666' }, make: 'Kia', model: 'Rio', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    await expect(importObdReport(o.id, pdf(), [{ page: 1, x: 10, y: 700, str: 'Tax Invoice' }])).rejects.toThrow();
  });
});
