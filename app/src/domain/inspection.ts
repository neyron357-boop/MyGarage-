import type { DamageMark, Inspection } from './types';

export const REQUIRED_SLOTS = ['front', 'front_right', 'right', 'rear_right', 'rear', 'rear_left', 'left', 'front_left'] as const;
/** The registration card has two sides: both are shot at check-in. */
export const MULKIYA_SLOTS = ['mulkiya', 'mulkiya_back'];
export const EXTRA_SLOTS = ['wheels', 'roof', 'windshield', 'interior', 'extra'] as const;
/*
 * Warning lights and function checks are the words of the garage's lists (domain/quickLists.ts,
 * Settings → Lists). Reports made before the lists keep built-in codes — check_engine, abs, airbag,
 * oil, battery, coolant, brake, tpms, other; ac, windows, central_lock, radio, headlights, indicators,
 * brake_lights, wipers, alarm, rear_camera — still said in words by the `light.*` / `check.*` texts.
 */
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

/**
 * What is still missing before an act can be signed.
 * Intake (fast check-in): nothing is mandatory — old cars are often taken in with no photos at all.
 * Handover keeps its rules: eight photos (or a reason), mileage, fuel and the signer's name.
 */
export function validateInspection(
  insp: Inspection,
  photoSlots: Set<string>,
  _marks: DamageMark[],
  opts: { signerName?: string; policePhoto?: boolean } = {},
): MissingKey[] {
  if (insp.kind === 'intake') return [];
  const missing: MissingKey[] = [];
  if (REQUIRED_SLOTS.some((s) => !photoSlots.has(s) && !insp.skippedPhotos[s]?.trim())) missing.push('photos');
  if (insp.mileageKm === undefined || insp.mileageKm < 0) missing.push('mileage');
  if (insp.fuelLevel === undefined) missing.push('fuel');
  if (opts.signerName !== undefined && !opts.signerName.trim()) missing.push('signer');
  return missing;
}
