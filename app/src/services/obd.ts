import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { odometerKm, parseObdReport, type ObdReport, type TextItem } from '../domain/obdReport';
import type { ObdScan, Vehicle } from '../domain/types';
import { AppError } from './errors';
import { addMedia } from './media';
import { logEvent } from './orders';

/*
 * A scanner's report (PDF) read into a job: the fault codes with what they mean, the odometer and the
 * car's data. The job keeps the report (codes + the PDF); the car gets what its card is missing (VIN,
 * year, engine, make, model — never overwriting what is there); a check-in act still open gets the codes
 * and the mileage. Nothing that was signed changes.
 */

export interface ObdImport {
  scan: ObdScan;
  /** Car fields filled from the report. */
  filled: (keyof Vehicle)[];
  /** The report's VIN differs from the one on the car (kept as it was). */
  vinMismatch?: string;
}

export async function importObdReport(orderId: string, pdf: Blob, items: TextItem[]): Promise<ObdImport> {
  const report: ObdReport = parseObdReport(items);
  if (!report.codes.length && !report.vehicle.vin) throw new AppError('obd.badFile');
  const order = await db.orders.get(orderId);
  if (!order) throw new AppError('err.notFound');
  const vehicle = await db.vehicles.get(order.vehicleId);
  if (!vehicle) throw new AppError('err.notFound');

  const media = await addMedia({ ownerType: 'order', ownerId: orderId, slot: 'obd_report', file: pdf, kind: 'pdf', name: 'OBD report.pdf' });
  const scan: ObdScan = {
    id: uid(),
    importedAt: nowIso(),
    testedAt: report.testedAt,
    tool: report.tool,
    codes: report.codes,
    odometer: report.vehicle.odometer,
    vin: report.vehicle.vin,
    mediaId: media.id,
  };

  // The car's card: only what it is missing.
  const v = report.vehicle;
  const patch: Partial<Vehicle> = {};
  if (v.vin && !vehicle.vin) patch.vin = v.vin;
  if (v.year && !vehicle.year) patch.year = v.year;
  if (v.engine && !vehicle.engine) patch.engine = v.engine;
  if (v.make && !vehicle.make) patch.make = v.make;
  if (v.model && !vehicle.model) patch.model = v.model;
  const vinMismatch = v.vin && vehicle.vin && v.vin !== vehicle.vin.toUpperCase() ? v.vin : undefined;

  // A check-in act still open: the codes and the mileage go into it.
  const intake = await db.inspections.where('orderId').equals(orderId).filter((i) => i.kind === 'intake' && !i.locked).first();
  const km = odometerKm(v.odometer);

  await db.transaction('rw', [db.orders, db.vehicles, db.inspections, db.events], async () => {
    await db.orders.update(orderId, { obdScans: [...(order.obdScans ?? []), scan], updatedAt: nowIso() });
    if (Object.keys(patch).length) await db.vehicles.update(vehicle.id, patch);
    if (intake) {
      const codes = [...new Set([...intake.obdCodes, ...report.codes.map((c) => c.code)])];
      await db.inspections.update(intake.id, {
        obdCodes: codes,
        obdNoCodes: codes.length ? false : intake.obdNoCodes,
        ...(km !== undefined && intake.mileageKm === undefined ? { mileageKm: km } : {}),
      });
    }
    await logEvent(orderId, 'obd_imported', { codes: report.codes.map((c) => c.code).join(', '), filled: Object.keys(patch).join(', ') });
  });
  return { scan, filled: Object.keys(patch) as (keyof Vehicle)[], vinMismatch };
}
