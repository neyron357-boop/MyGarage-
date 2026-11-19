import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { actWithoutScan, odometerKm, parseObdReport, type ActObd, type ObdReport, type TextItem } from '../domain/obdReport';
import type { ObdScan, Vehicle } from '../domain/types';
import { aiReadVinLater } from './ai';
import { AppError } from './errors';
import { addMedia, putBackMedia, takeMedia, type RemovedMedia } from './media';
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

  if (intake) {
    // What goes into the act, kept on the scan: deleting the scan takes back just this.
    const fills = km !== undefined && intake.mileageKm === undefined;
    scan.intoAct = { id: intake.id, codes: [...new Set(report.codes.map((c) => c.code))].filter((c) => !intake.obdCodes.includes(c)) };
    if (fills) scan.intoAct.mileageKm = km;
    if (intake.obdNoCodes !== undefined) scan.intoAct.noCodesBefore = intake.obdNoCodes;
  }

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
  // The scanner gave the car its VIN: the garage's AI reads what car it is (v0.48), not waited for.
  if (patch.vin) aiReadVinLater(vehicle.id);
  return { scan, filled: Object.keys(patch) as (keyof Vehicle)[], vinMismatch };
}

/** A deleted scan with everything it took along — to put it back ("Undo"). */
export interface RemovedObdScan {
  orderId: string;
  scan: ObdScan;
  pdf?: RemovedMedia;
  /** The open check-in act before the delete and as the delete left it. */
  act?: { before: ActObd; after: Omit<ActObd, 'id'> };
}

/**
 * Deletes a scanner report from a job that is still open: the scan, its PDF and what it put into a
 * check-in act still open (`actWithoutScan`). A signed act keeps its own copy, the car's card keeps what it
 * got. Not in the journal: "Undo" puts it all back as it was (as a removed note or line).
 */
export async function removeObdScan(orderId: string, scanId: string): Promise<RemovedObdScan> {
  return db.transaction('rw', [db.orders, db.inspections, db.media, db.mediaBlobs], async () => {
    const order = await db.orders.get(orderId);
    const scan = order?.obdScans?.find((s) => s.id === scanId);
    if (!order || !scan) throw new AppError('err.notFound');
    if (order.stage === 'closed' || order.stage === 'cancelled') throw new AppError('stageErr.notAllowed');
    const rest = (order.obdScans ?? []).filter((s) => s.id !== scanId);
    const pdf = scan.mediaId ? await takeMedia(scan.mediaId) : undefined;
    // The act the import fills (above); a signed one is never written.
    const intake = await db.inspections.where('orderId').equals(orderId).filter((i) => i.kind === 'intake' && !i.locked).first();
    const before: ActObd | undefined = intake && { id: intake.id, obdCodes: intake.obdCodes, obdNoCodes: intake.obdNoCodes, mileageKm: intake.mileageKm };
    const after = before && actWithoutScan(before, scan, rest);
    if (before && after) await db.inspections.update(before.id, after);
    await db.orders.update(orderId, { obdScans: rest });
    return { orderId, scan, pdf, act: before && after ? { before, after } : undefined };
  });
}

/** "Undo" of `removeObdScan`: the scan in its place, its PDF, and the act as it was (codes added since stay). */
export async function restoreObdScan(r: RemovedObdScan): Promise<void> {
  await db.transaction('rw', [db.orders, db.inspections, db.media, db.mediaBlobs], async () => {
    const order = await db.orders.get(r.orderId);
    if (!order) return;
    if (r.pdf) await putBackMedia(r.pdf);
    const scans = order.obdScans ?? [];
    if (!scans.some((s) => s.id === r.scan.id)) {
      await db.orders.update(r.orderId, { obdScans: [...scans, r.scan].sort((a, b) => a.importedAt.localeCompare(b.importedAt)) });
    }
    const act = r.act && (await db.inspections.get(r.act.before.id));
    if (!r.act || !act || act.locked) return;
    const obdCodes = [...new Set([...r.act.before.obdCodes, ...act.obdCodes])];
    await db.inspections.update(act.id, {
      obdCodes,
      obdNoCodes: obdCodes.length ? (act.obdCodes.length ? act.obdNoCodes : r.act.before.obdNoCodes) : r.act.before.obdNoCodes,
      // The mileage back only if nobody wrote another since.
      mileageKm: act.mileageKm === r.act.after.mileageKm ? r.act.before.mileageKm : act.mileageKm,
    });
  });
}
