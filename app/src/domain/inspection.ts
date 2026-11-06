import type { DamageMark, Inspection } from './types';

export const REQUIRED_SLOTS = ['front', 'front_right', 'right', 'rear_right', 'rear', 'rear_left', 'left', 'front_left'] as const;
export const EXTRA_SLOTS = ['wheels', 'roof', 'windshield', 'interior', 'extra'] as const;
export const WARNING_LIGHTS = ['check_engine', 'abs', 'airbag', 'oil', 'battery', 'coolant', 'brake', 'tpms', 'other'] as const;
export const FUNCTION_CHECKS = [
  'ac',
  'windows',
  'central_lock',
  'radio',
  'headlights',
  'indicators',
  'brake_lights',
  'wipers',
  'alarm',
  'rear_camera',
] as const;
export const QC_CHECKS = [
  'no_leaks',
  'wheels_torqued',
  'fluids',
  'no_new_codes',
  'codes_cleared',
  'interior_clean',
  'belongings_ok',
] as const;
export const FUEL_LEVELS = [0, 25, 50, 75, 100] as const;

export type MissingKey =
  | 'photos'
  | 'damage'
  | 'mileage'
  | 'fuel'
  | 'obd'
  | 'complaint'
  | 'policeReport'
  | 'conditions'
  | 'signer';

/** What is still missing before an inspection act can be signed. */
export function validateInspection(
  insp: Inspection,
  photoSlots: Set<string>,
  marks: DamageMark[],
  opts: { signerName?: string; policePhoto?: boolean } = {},
): MissingKey[] {
  const missing: MissingKey[] = [];
  if (REQUIRED_SLOTS.some((s) => !photoSlots.has(s) && !insp.skippedPhotos[s]?.trim())) missing.push('photos');
  if (insp.mileageKm === undefined || insp.mileageKm < 0) missing.push('mileage');
  if (insp.fuelLevel === undefined) missing.push('fuel');
  if (insp.kind === 'intake') {
    if (!insp.noDamage && marks.length === 0) missing.push('damage');
    if (!insp.obdNoCodes && insp.obdCodes.length === 0 && !insp.obdSkipReason?.trim()) missing.push('obd');
    if (!insp.complaint?.trim()) missing.push('complaint');
    if (insp.accidentRepair && (!insp.policeReportNo?.trim() || !opts.policePhoto)) missing.push('policeReport');
    if (!insp.conditions) missing.push('conditions');
  }
  if (opts.signerName !== undefined && !opts.signerName.trim()) missing.push('signer');
  return missing;
}
