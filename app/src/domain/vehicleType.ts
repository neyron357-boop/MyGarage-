import type { VehicleType } from './types';

/*
 * A car's body by its make and model (v0.45 — a fleet's reports: Pickup, Van / Minibus, Bus, Truck, SUV, MPV, Sedan).
 * Only a guess for a car brought in without one; the car's card keeps what is set by hand.
 */

const RULES: [VehicleType, RegExp][] = [
  ['bus', /\b(COASTER|ROSA|CIVILIAN|BUS)\b/],
  ['truck', /\b(CANTER|FUSO|ASHOK|LEYLAND|DYNA|NKR|NPR|NQR|ELF|ATEGO|ACTROS|TRUCK|TIPPER|PICK\s*UP\s*TRUCK)\b/],
  ['van', /\b(URVAN|HI\s*ACE|HIACE|SPRINTER|TRANSIT|H-?1|STAREX|NV350|CARAVAN|SUNRAY|VAN|MINIBUS)\b/],
  ['pickup', /\b(HIL+UX|L200|TRITON|NAVARA|RAM|D-?MAX|RANGER|F-?150|TACOMA|TUNDRA|SILVERADO|SIERRA|GLADIATOR|PICK\s*UP|PICKUP)\b/],
  ['mpv', /\b(ERTIGA|X?PANDER|EXPANDER|INNOVA|CARNIVAL|SIENNA|ODYSSEY|APV|SERENA)\b/],
  ['suv', /\b(PAJERO|PRADO|LAND\s*CRUISER|LC|FORTUNER|RAV\s*4|SPORTAGE|TUCSON|XTERRA|PATROL|RANGE\s*ROVER|LAND\s*ROVER|DISCOVERY|DEFENDER|X-?TRAIL|ASX|CROSS|JS3|S3|SUV|OUTLANDER|CRETA|DUSTER|EDGE|EXPLORER|TAHOE)\b/],
  ['sedan', /\b(A[3-8]|CAMRY|COROLLA|ACCORD|ALTIMA|SUNNY|YARIS|ELANTRA|ACCENT|CIVIC|SONATA|CERATO|SEDAN|CHARGER)\b/],
];

/** The body a car's make and model say (none — they do not say). */
export function vehicleTypeOf(make: string, model: string): VehicleType | undefined {
  const text = ` ${make} ${model} `.toUpperCase();
  return RULES.find(([, re]) => re.test(text))?.[0];
}

/** The order the bodies are listed in. */
export const VEHICLE_TYPES: VehicleType[] = ['pickup', 'van', 'bus', 'truck', 'suv', 'mpv', 'sedan'];

/** As a fleet's report names it. */
export const VEHICLE_TYPE_EN: Record<VehicleType, string> = { pickup: 'Pickup', van: 'Van / Minibus', bus: 'Bus', truck: 'Truck', suv: 'SUV', mpv: 'MPV', sedan: 'Sedan' };
