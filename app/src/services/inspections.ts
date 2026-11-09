import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { validateInspection } from '../domain/inspection';
import { quickList } from '../domain/quickLists';
import type { DamageMark, Inspection } from '../domain/types';
import { AppError } from './errors';
import { addMedia, deleteMedia, lockMediaOf } from './media';
import { bundleAmountDue, loadOrderBundle, logEvent, tryStage } from './orders';


export async function getOrCreateInspection(orderId: string, kind: Inspection['kind']): Promise<Inspection> {
  const find = () => db.inspections.where('orderId').equals(orderId).filter((i) => i.kind === kind).first();
  const existing = await find();
  if (existing) return existing;
  const order = await db.orders.get(orderId);
  if (!order) throw new AppError('err.notFound');
  const intake = kind === 'handover' ? await db.inspections.where('orderId').equals(orderId).filter((i) => i.kind === 'intake').first() : undefined;
  // What gets checked: the garage's list from Settings → Lists (the handover repeats the check-in's list).
  const checks = intake && Object.keys(intake.functionChecks).length ? Object.keys(intake.functionChecks) : quickList(await db.settings.get('main'), 'functionChecks');
  const draft: Inspection = {
    id: uid(),
    orderId,
    kind,
    step: 0,
    warningLights: [],
    obdCodes: [],
    functionChecks: Object.fromEntries(checks.map((c) => [c, 'unchecked'])),
    skippedPhotos: {},
    complaint: kind === 'intake' ? order.complaint : undefined,
    keysCount: intake?.keysCount,
    // Fast check-in asks only for the test drive; no-call limit, parking and diagnostics fees are gone.
    conditions: kind === 'intake' ? { testDriveAllowed: true } : undefined,
    language: order.docLanguage,
    locked: false,
    createdAt: nowIso(),
  };
  // Check-and-create in one read-write transaction: two screens opening at once must not create two acts.
  return db.transaction('rw', db.inspections, async () => {
    const again = await find();
    if (again) return again;
    await db.inspections.add(draft);
    return draft;
  });
}

async function getUnlocked(id: string): Promise<Inspection> {
  const insp = await db.inspections.get(id);
  if (!insp) throw new AppError('err.notFound');
  if (insp.locked) throw new AppError('err.signedLocked');
  return insp;
}

export async function updateInspection(id: string, patch: Partial<Inspection>): Promise<void> {
  await getUnlocked(id);
  await db.inspections.update(id, patch);
}

/**
 * Add a photo to an open act. `replace`: a retake — the photos already in this slot are deleted only
 * after the new one is stored, so a failed save never leaves the slot empty.
 */
export async function addInspectionPhoto(inspectionId: string, slot: string, file: Blob, opts: { thumb?: Blob; replace?: boolean } = {}) {
  await getUnlocked(inspectionId);
  const old = opts.replace ? await db.media.where('ownerId').equals(inspectionId).filter((m) => m.slot === slot && m.kind === 'photo').toArray() : [];
  const media = await addMedia({ ownerType: 'inspection', ownerId: inspectionId, slot, file, thumb: opts.thumb });
  for (const m of old) await deleteMedia(m.id);
  const insp = await db.inspections.get(inspectionId);
  if (insp?.skippedPhotos[slot]) {
    const skipped = { ...insp.skippedPhotos };
    delete skipped[slot];
    await db.inspections.update(inspectionId, { skippedPhotos: skipped });
  }
  return media;
}

export async function addDamageMark(inspectionId: string, mark: Omit<DamageMark, 'id' | 'inspectionId'>): Promise<DamageMark> {
  await getUnlocked(inspectionId);
  const m: DamageMark = { ...mark, id: uid(), inspectionId };
  await db.damageMarks.add(m);
  await db.inspections.update(inspectionId, { noDamage: false });
  return m;
}

export async function updateDamageMark(id: string, patch: Partial<DamageMark>): Promise<void> {
  const m = await db.damageMarks.get(id);
  if (!m) return;
  await getUnlocked(m.inspectionId);
  await db.damageMarks.update(id, patch);
}

export async function removeDamageMark(id: string): Promise<void> {
  const m = await db.damageMarks.get(id);
  if (!m) return;
  await getUnlocked(m.inspectionId);
  await db.damageMarks.delete(id);
}

export async function inspectionState(id: string) {
  const insp = await db.inspections.get(id);
  if (!insp) throw new AppError('err.notFound');
  const [media, marks] = await Promise.all([
    db.media.where('ownerId').equals(id).toArray(),
    db.damageMarks.where('inspectionId').equals(id).toArray(),
  ]);
  const slots = new Set(media.filter((m) => m.kind === 'photo' || m.kind === 'video').map((m) => m.slot));
  return { insp, media, marks, slots, policePhoto: media.some((m) => m.slot === 'police_report') };
}

/** The car is in: move a booked job to intake and on to diagnostics (the act is done). */
async function intakeDoneMoves(orderId: string) {
  const order = await db.orders.get(orderId);
  if (order?.stage === 'booked') await tryStage(orderId, 'intake');
  await tryStage(orderId, 'diagnostics');
}

/**
 * Save the intake without the customer's signature: everything filled stays, nothing is required,
 * the job moves on. The act stays editable and can still be signed later.
 */
export async function completeInspection(id: string): Promise<Inspection> {
  const insp = await getUnlocked(id);
  if (insp.kind !== 'intake') throw new AppError('stageErr.notAllowed');
  if (!insp.completedAt) {
    await db.inspections.update(id, { completedAt: nowIso() });
    await logEvent(insp.orderId, 'intake_saved');
  }
  await intakeDoneMoves(insp.orderId);
  return (await db.inspections.get(id))!;
}

/** Sign and freeze the act: server-side time (device time in local mode), signature, all photos locked. */
export async function signInspection(id: string, signerName: string, signature: Blob): Promise<Inspection> {
  const { insp, marks, slots, policePhoto } = await inspectionState(id);
  if (insp.locked) throw new AppError('err.signedLocked');
  const missing = validateInspection(insp, slots, marks, { signerName, policePhoto });
  if (missing.length) throw new AppError('err.inspectionIncomplete', { missing });
  if (insp.kind === 'handover') {
    const b = await loadOrderBundle(insp.orderId);
    if (!b) throw new AppError('err.notFound');
    if (b.order.stage !== 'ready') throw new AppError('stageErr.notReady');
    if (bundleAmountDue(b) > 0 && !b.debts.some((d) => d.status === 'open')) throw new AppError('stageErr.unpaid');
  }
  const sig = await addMedia({ ownerType: 'inspection', ownerId: id, slot: 'signature', file: signature, kind: 'signature', compress: false });
  await lockMediaOf([id]);
  const signedAt = nowIso();
  await db.inspections.update(id, { signerName: signerName.trim(), signatureMediaId: sig.id, signedAt, completedAt: insp.completedAt ?? signedAt, locked: true });
  await logEvent(insp.orderId, insp.kind === 'intake' ? 'intake_signed' : 'handover_signed', { signerName });
  if (insp.kind === 'intake') {
    await intakeDoneMoves(insp.orderId);
  } else {
    await tryStage(insp.orderId, 'delivered');
    await tryStage(insp.orderId, 'closed');
  }
  return (await db.inspections.get(id))!;
}

export async function addAddendum(inspectionId: string, text: string): Promise<void> {
  const insp = await db.inspections.get(inspectionId);
  if (!insp) throw new AppError('err.notFound');
  if (!text.trim()) throw new AppError('err.textRequired');
  await db.addenda.add({ id: uid(), inspectionId, text: text.trim(), createdAt: nowIso() });
  await logEvent(insp.orderId, 'addendum', { kind: insp.kind });
}
