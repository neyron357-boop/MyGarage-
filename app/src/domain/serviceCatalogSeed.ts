import type { Service, ServiceCategory } from './types';

/*
 * The catalogue of standard services as it comes (v0.46): 16 categories, the services of a workshop's invoices for a
 * fleet — each with the words its lines are written in, typos included (BRAKD PAD, LABOUER, ALINMENT). The garage edits
 * it in the app (Settings → Services): what is edited is kept as a record of its own (`services`, the same id) and wins
 * over what is here; a service added there is a record only.
 */

const c = (id: string, name: string, position: number): ServiceCategory => ({ id: `cat-${id}`, name, position });

export const SEED_CATEGORIES: ServiceCategory[] = [
  c('oil', 'Oil & filters', 1),
  c('brakes', 'Brakes', 2),
  c('tyres', 'Tyres & wheels', 3),
  c('electrical', 'Battery & electrical', 4),
  c('lights', 'Lights', 5),
  c('ac', 'Air conditioning', 6),
  c('cooling', 'Cooling system', 7),
  c('engine', 'Engine', 8),
  c('ignition', 'Ignition & sensors', 9),
  c('transmission', 'Transmission & clutch', 10),
  c('steering', 'Steering & suspension', 11),
  c('belts', 'Belts & pulleys', 12),
  c('body', 'Body & paint', 13),
  c('wash', 'Car wash', 14),
  c('labour', 'Labour', 15),
  c('other', 'Recovery & other', 16),
];

let order = 0;
const s = (id: string, name: string, category: string, keywords: string[], kind?: Service['kind']): Service => ({
  id: `svc-${id}`,
  name,
  categoryId: `cat-${category}`,
  keywords,
  ...(kind ? { kind } : {}),
  position: ++order,
});

export const SEED_SERVICES: Service[] = [
  // Oil & filters
  s('oil-change', 'Oil change (engine oil + filter)', 'oil', ['CHANGE OIL', 'OIL CHANGE', 'OIL AND FILTER'], 'oil'),
  s('engine-oil', 'Engine oil (supply)', 'oil', ['ENGINE OIL', 'ENOC', '5W40', '5W30', '10W40', '15W40', '20W50']),
  s('oil-top-up', 'Oil top-up', 'oil', ['OIL TOP UP', 'TOP UP', 'OIL TOPUP']),
  s('air-filter', 'Air filter', 'oil', ['AIR FILTER']),
  s('fuel-filter', 'Fuel / diesel filter', 'oil', ['DIESEL FILTER', 'DIESEL OIL FILTER', 'FUEL FILTER']),
  // Brakes
  s('brake-pads', 'Brake pads', 'brakes', ['BRAKE PAD', 'BREAK PAD', 'BRAKD PAD', 'BRAKE SHOE', 'BRAKE']),
  s('brake-discs', 'Brake discs', 'brakes', ['BRAKE DISC', 'DISC ORIGINAL', 'DISC ROTOR', 'FRONT DISC', 'REAR DISC']),
  s('disc-skimming', 'Disc skimming', 'brakes', ['DISC SKIMMING', 'SKIMMING', 'DRUM SKIMMING']),
  s('brake-cleaning', 'Brake cleaning', 'brakes', ['BRAKE CLEANING', 'BRAKE SERVICE']),
  s('brake-fluid', 'Brake fluid', 'brakes', ['BRAKE FLUID', 'BRAKE OIL']),
  // Tyres & wheels
  s('tyres', 'Tyres', 'tyres', ['TIRE', 'TYRE', 'TIRES', 'TYRES', 'MATRAX', 'MAXTRAX', 'YOKOHAMA', 'DUNLOP', 'MRF']),
  s('puncture', 'Puncture repair', 'tyres', ['TIRE PUNCTURE', 'TYRE PUNCTURE', 'PUNCTURE']),
  s('alignment', 'Wheel alignment & balancing', 'tyres', ['ALIGNMENT', 'ALINMENT', 'BALANCING', 'WHEEL BALANCING']),
  s('wheel-bearing', 'Wheel bearing', 'tyres', ['WHEEL BEARING', 'HUB BEARING']),
  s('rim-repair', 'Rim repair', 'tyres', ['RIM REPAIR', 'RIM STRAIGHTENING', 'ALLOY RIM']),
  // Battery & electrical
  s('battery', 'Battery', 'electrical', ['BATTERY', 'AMARON']),
  s('battery-terminal', 'Battery terminal & clamp', 'electrical', ['BATTERY CLAMP', 'BATTERY TERMINAL', 'FUSE LINK']),
  s('alternator', 'Alternator', 'electrical', ['ALTERNATOR', 'DYNAMO']),
  s('starter', 'Starter motor', 'electrical', ['STARTER', 'SELF MOTOR']),
  s('switches', 'Switches & horn', 'electrical', ['SWITCH', 'HORN', 'REVERSE HORN']),
  s('wiper', 'Wiper blades', 'electrical', ['WIPER']),
  // Lights
  s('bulbs', 'Bulbs', 'lights', ['BULB', 'HEAD LIGHT BULB', 'HEADLIGHT BULB', 'BRAKE LIGHT BULB']),
  s('lamps', 'Headlights & lamps', 'lights', ['HEAD LIGHT', 'HEADLIGHT', 'FOG LIGHT', 'TAIL LIGHT', 'TAIL LAMP', 'STOP LIGHT', 'STOP LAMP', 'BRAKE LIGHT', 'REAR LIGHT', 'INDICATOR']),
  // Air conditioning
  s('ac-service', 'AC service (gas + vacuum)', 'ac', ['AC SERVICE', 'A C SERVICE', 'AC CHECK', 'A C CHECK']),
  s('ac-gas', 'AC gas refill', 'ac', ['AC GAS', 'A C GAS', 'FREON', 'GAS REFILL', 'REFRIGERANT', 'RECHARGE']),
  s('ac-compressor', 'AC compressor', 'ac', ['AC COMPRESSOR', 'COMPRESSOR']),
  s('ac-condenser', 'AC condenser', 'ac', ['AC CONDENSER', 'CONDENSER']),
  s('ac-fan', 'AC / condenser fan motor', 'ac', ['FAN MOTOR', 'CONDENSER FAN', 'AC FAN']),
  s('ac-blower', 'AC blower', 'ac', ['AC BLOWER', 'AC B LOWER', 'BLOWER']),
  s('ac-filter', 'AC filter', 'ac', ['AC FILTER', 'CABIN FILTER']),
  s('ac-valves', 'AC drier & valves', 'ac', ['AC FILTER DRIER', 'FILTER DRIER', 'EXPANSION VALVE', 'AC VALVE']),
  s('ac-pipes', 'AC pipes & cleaning', 'ac', ['AC PIPE', 'PIPE ORING', 'VACUUM PIPE', 'PIPE VACUUM']),
  s('ac-evaporator', 'AC evaporator', 'ac', ['EVAPORATOR']),
  // Cooling system
  s('coolant', 'Coolant', 'cooling', ['COOLANT', 'ANTIFREEZE']),
  s('radiator', 'Radiator', 'cooling', ['RADIATOR', 'RADIATOR TANK']),
  s('radiator-parts', 'Radiator cap & bottle', 'cooling', ['RADIATOR CAP', 'RADIATOR BOTTLE', 'EXPANSION TANK']),
  s('cooling-hoses', 'Cooling hoses & pipes', 'cooling', ['RADIATOR HOSE', 'COOLANT PIPE', 'WATER PIPE', 'WATER OUTLET', 'HOSE CLAMP', 'HOSE CLIP', 'WATER HOSE']),
  s('thermostat', 'Thermostat', 'cooling', ['THERMOSTAT']),
  s('radiator-flush', 'Radiator flush', 'cooling', ['RADIATOR FLUSH', 'RADIATOR FLASH', 'FLUSHING']),
  // Engine
  s('engine-replacement', 'Engine replacement', 'engine', ['COMPLETE ENGINE', 'ENGINE USED', 'ENGINE ASSY']),
  s('engine-mounts', 'Engine mounts', 'engine', ['ENGINE MOUNTING', 'ENGINE MOUNT']),
  s('gaskets', 'Gaskets & seals', 'engine', ['GASKET', 'SEAL', 'SEAL HEAD', 'O RING', 'ORING']),
  s('oil-cooler', 'Oil cooler', 'engine', ['OIL COOLER', 'ENGINE OIL COOLER']),
  s('engine-cleaning', 'Catalytic & throttle cleaning', 'engine', ['CATALYTIC', 'THROTTLE', 'TROTTLE', 'PVC VALVE', 'PCV VALVE']),
  // Ignition & sensors
  s('spark-plugs', 'Spark plugs', 'ignition', ['SPARK PLUG', 'SPARKPLUG']),
  s('ignition-coil', 'Ignition coil', 'ignition', ['IGNITION COIL']),
  s('sensors', 'Sensors', 'ignition', ['SENSOR', 'MAF']),
  // Transmission & clutch
  s('clutch-kit', 'Clutch kit', 'transmission', ['CLUTCH FULL SET', 'CLUTCH PLATE', 'CLUTHC PLATE', 'FULL SET CLUTCH', 'CLUTCH KIT']),
  s('clutch-parts', 'Clutch cylinder & damper', 'transmission', ['CLUTCH CYLINDER', 'DUMPER ASSY CLUTCH', 'CLUTCH DAMPER', 'CLUTCH']),
  s('flywheel', 'Flywheel', 'transmission', ['FLYWHEEL']),
  s('gear-oil', 'Gear oil / ATF', 'transmission', ['GEAR OIL', 'ATF', 'DIFFERENTIAL OIL', 'DEFERENTIAL OIL', 'DIFF OIL']),
  s('gear-filter', 'Gearbox filter', 'transmission', ['GEAR FILTER', 'GEARBOX FILTER']),
  s('gear-mounts', 'Gearbox mounts', 'transmission', ['GEAR MOUNT', 'GEARBOX MOUNT']),
  s('gearbox-repair', 'Gearbox repair', 'transmission', ['GEAR LEAKING', 'GEARBOX', 'GEAR SHIFT']),
  s('axle', 'Axle & boots', 'transmission', ['AXLE', 'CV JOINT']),
  s('differential', 'Differential', 'transmission', ['DIFFERENTIAL', 'DEFERENTIAL']),
  // Steering & suspension
  s('steering-repair', 'Steering repair', 'steering', ['STEERING ROCK', 'STEERING RACK', 'POWER STEERING', 'STEERING PIPE', 'STEERING RUBBER']),
  s('steering-oil', 'Steering oil', 'steering', ['STEERING OIL', 'STEEERING OIL']),
  s('tie-rods', 'Tie rods & links', 'steering', ['TIE ROD', 'LINK ROD', 'DRAE LINK', 'DRAG LINK', 'STABILIZER LINK']),
  s('shock-absorbers', 'Shock absorbers', 'steering', ['SHOCK ABSORBER', 'SHOCK']),
  s('bushings', 'Bushings & arms', 'steering', ['BUSHING', 'UPPER ARM', 'LOWER ARM', 'CONTROL ARM']),
  // Belts & pulleys
  s('drive-belt', 'Drive belt', 'belts', ['ENGINE BELT', 'TENSIONER BELT', 'DRIVE BELT', 'FAN BELT']),
  s('tensioner', 'Tensioner & pulleys', 'belts', ['TENSIONER', 'PULLEY']),
  // Body & paint
  s('bumper', 'Bumper', 'body', ['BUMPER NEW', 'BUMPER']),
  s('denting-painting', 'Denting & painting', 'body', ['PAINTING', 'DENTING']),
  s('body-repair', 'Body repair & welding', 'body', ['DENTING AND WELDING', 'WELDING', 'BUMBER REAR REPAIR']),
  s('door-lock', 'Door & lock repair', 'body', ['DOOR HANDLE', 'DOOR LOCK', 'DOOR REPAIR']),
  s('fender-liner', 'Fender liner & mud guards', 'body', ['FENDER LINER', 'MUD GUARD', 'MUDGUARD', 'MUD FLAP']),
  // Car wash — every *WASH*
  s('car-wash', 'Car wash', 'wash', ['WASH']),
  // Labour
  s('labour', 'Labour charges', 'labour', ['LABOUR', 'LABOUER', 'LABOUT', 'LABOR'], 'labour'),
  // Recovery & other
  s('recovery', 'Recovery', 'other', ['RECOVERY', 'TOWING']),
  s('consumables', 'Consumables', 'other', ['CONSUMABLES']),
];
