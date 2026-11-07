/**
 * Built-in list of car makes and models seen in UAE workshops, so check-in is a tap instead of typing.
 * Free text is still accepted: a car that is not in the list is saved as typed.
 */
export const CAR_CATALOG: Record<string, string[]> = {
  Toyota: [
    'Land Cruiser', 'Land Cruiser Prado', 'Land Cruiser 70', 'Camry', 'Corolla', 'Corolla Cross', 'Yaris', 'Yaris Cross', 'RAV4', 'Fortuner', 'Hilux',
    'Hiace', 'Coaster', 'Avalon', 'Rush', 'Raize', 'Innova', 'Sequoia', 'Tundra', 'Tacoma', '4Runner', 'FJ Cruiser', 'Highlander', 'Granvia',
    'C-HR', 'Crown', 'Supra', 'GR86', '86', 'Previa', 'Avanza', 'Veloz', 'Urban Cruiser', 'bZ4X', 'Echo',
  ],
  Nissan: [
    'Patrol', 'Patrol Safari', 'Patrol Pickup', 'Sunny', 'Altima', 'Maxima', 'Sentra', 'Kicks', 'X-Trail', 'Pathfinder', 'Armada', 'Navara',
    'Juke', 'Qashqai', 'Magnite', 'Tiida', 'Micra', 'Murano', 'Xterra', 'Urvan', '370Z', 'Z', 'GT-R',
  ],
  Lexus: [
    'LX', 'LX 570', 'LX 600', 'GX', 'GX 460', 'GX 550', 'RX', 'RX 350', 'RX 500h', 'NX', 'NX 350', 'UX', 'ES', 'ES 250', 'ES 350', 'IS',
    'IS 300', 'LS', 'LS 500', 'GS', 'RC', 'LC', 'LM', 'TX', 'LBX',
  ],
  Mitsubishi: ['Pajero', 'Pajero Sport', 'Montero', 'L200', 'Triton', 'Lancer', 'Lancer EX', 'Attrage', 'Mirage', 'ASX', 'Outlander', 'Eclipse Cross', 'Xpander', 'Galant', 'Canter'],
  Hyundai: [
    'Accent', 'Elantra', 'Sonata', 'Azera', 'Grandeur', 'Tucson', 'Santa Fe', 'Creta', 'Kona', 'Venue', 'Palisade', 'i10', 'Grand i10', 'i20',
    'i30', 'Veloster', 'H-1', 'Staria', 'Ioniq 5', 'Ioniq 6',
  ],
  Kia: [
    'Picanto', 'Pegas', 'Rio', 'Cerato', 'K5', 'Optima', 'Cadenza', 'K8', 'Soul', 'Seltos', 'Sonet', 'Sportage', 'Sorento', 'Telluride', 'Carnival',
    'Carens', 'Mohave', 'EV6', 'EV9',
  ],
  Honda: ['Civic', 'Accord', 'City', 'Jazz', 'HR-V', 'CR-V', 'ZR-V', 'Pilot', 'Passport', 'Odyssey'],
  Mazda: ['Mazda2', 'Mazda3', 'Mazda6', 'CX-3', 'CX-30', 'CX-5', 'CX-60', 'CX-9', 'CX-90', 'MX-5', 'BT-50'],
  Ford: [
    'F-150', 'F-150 Raptor', 'F-250', 'Ranger', 'Ranger Raptor', 'Explorer', 'Expedition', 'Edge', 'Escape', 'Territory', 'Everest', 'Bronco',
    'Mustang', 'Taurus', 'Fusion', 'Focus', 'Fiesta', 'Figo', 'EcoSport', 'Transit',
  ],
  Chevrolet: [
    'Tahoe', 'Suburban', 'Silverado', 'Colorado', 'Traverse', 'Blazer', 'Equinox', 'Captiva', 'Trailblazer', 'Groove', 'Spark', 'Aveo', 'Cruze',
    'Malibu', 'Impala', 'Caprice', 'Lumina', 'Camaro', 'Corvette', 'Express',
  ],
  GMC: ['Yukon', 'Yukon XL', 'Sierra', 'Canyon', 'Acadia', 'Terrain', 'Savana', 'Hummer EV'],
  Cadillac: ['Escalade', 'XT4', 'XT5', 'XT6', 'CT4', 'CT5', 'CTS', 'ATS', 'SRX', 'Lyriq'],
  Dodge: ['Charger', 'Challenger', 'Durango', 'Journey', 'Caliber', 'Neon', 'Ram'],
  RAM: ['1500', '1500 TRX', '2500', '3500'],
  Jeep: ['Wrangler', 'Grand Cherokee', 'Grand Cherokee L', 'Cherokee', 'Compass', 'Renegade', 'Gladiator', 'Wagoneer', 'Grand Wagoneer'],
  Chrysler: ['300', '300C', 'Pacifica'],
  Lincoln: ['Navigator', 'Aviator', 'Nautilus', 'Corsair', 'MKZ', 'MKX'],
  Hummer: ['H1', 'H2', 'H3'],
  'Mercedes-Benz': [
    'A-Class', 'C-Class', 'E-Class', 'S-Class', 'CLA', 'CLS', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'G-Class', 'G 63 AMG', 'AMG GT', 'SL', 'V-Class',
    'Vito', 'Sprinter', 'Maybach S-Class', 'EQE', 'EQS',
  ],
  BMW: [
    '1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '7 Series', '8 Series', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'XM', 'Z4', 'M3',
    'M4', 'M5', 'i4', 'i7', 'iX',
  ],
  Audi: ['A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'RS6', 'RS Q8', 'TT', 'R8', 'e-tron', 'e-tron GT'],
  Volkswagen: ['Golf', 'Golf GTI', 'Jetta', 'Passat', 'Polo', 'Tiguan', 'Touareg', 'Teramont', 'T-Roc', 'Arteon', 'Amarok', 'Transporter', 'Beetle', 'ID.4'],
  Porsche: ['Cayenne', 'Cayenne Coupe', 'Macan', 'Panamera', '911', 'Taycan', 'Cayman', 'Boxster', '718'],
  'Land Rover': ['Range Rover', 'Range Rover Sport', 'Range Rover Velar', 'Range Rover Evoque', 'Defender', 'Discovery', 'Discovery Sport', 'LR4'],
  Jaguar: ['F-Pace', 'E-Pace', 'I-Pace', 'XF', 'XE', 'XJ', 'F-Type'],
  Mini: ['Cooper', 'Cooper S', 'Countryman', 'Clubman', 'Paceman'],
  Volvo: ['XC40', 'XC60', 'XC90', 'S60', 'S90', 'V60', 'EX30'],
  Peugeot: ['208', '301', '308', '408', '508', '2008', '3008', '5008', 'Partner', 'Expert', 'Boxer', 'Landtrek'],
  Renault: ['Duster', 'Symbol', 'Logan', 'Megane', 'Koleos', 'Captur', 'Talisman', 'Kwid', 'Dokker', 'Master'],
  Citroen: ['C3', 'C4', 'C5', 'C5 Aircross', 'Berlingo', 'Jumpy'],
  Infiniti: ['QX80', 'QX60', 'QX56', 'QX55', 'QX50', 'QX70', 'FX35', 'Q50', 'Q60', 'Q70'],
  Acura: ['MDX', 'RDX', 'TLX', 'ZDX'],
  Suzuki: ['Swift', 'Dzire', 'Ciaz', 'Baleno', 'Ertiga', 'Vitara', 'Grand Vitara', 'Jimny', 'Fronx', 'Celerio', 'Alto', 'S-Presso', 'APV'],
  Subaru: ['Forester', 'Outback', 'XV', 'Crosstrek', 'Impreza', 'Legacy', 'WRX', 'BRZ', 'Ascent'],
  Isuzu: ['D-Max', 'MU-X', 'NPR', 'NQR', 'ELF'],
  MG: ['MG3', 'MG4', 'MG5', 'MG6', 'MG7', 'ZS', 'ZS EV', 'HS', 'RX5', 'RX8', 'GT', 'One', 'Whale'],
  Geely: ['Coolray', 'Emgrand', 'Tugella', 'Monjaro', 'Okavango', 'Azkarra', 'Starray', 'Preface', 'Geometry C'],
  Chery: ['Tiggo 2', 'Tiggo 4', 'Tiggo 4 Pro', 'Tiggo 7', 'Tiggo 7 Pro', 'Tiggo 8', 'Tiggo 8 Pro', 'Arrizo 5', 'Arrizo 6', 'Arrizo 8'],
  Omoda: ['C5', 'E5'],
  Jaecoo: ['J7', 'J8'],
  Haval: ['H6', 'H6 GT', 'Jolion', 'Dargo', 'H9', 'H2'],
  GWM: ['Wingle', 'Poer', 'Cannon'],
  Tank: ['300', '500'],
  Changan: ['Alsvin', 'Eado', 'CS35', 'CS35 Plus', 'CS55', 'CS75', 'CS85', 'CS95', 'UNI-K', 'UNI-T', 'UNI-V', 'Hunter'],
  JAC: ['J7', 'JS3', 'JS4', 'JS6', 'S3', 'T8'],
  Jetour: ['X70', 'X70 Plus', 'X90', 'Dashing', 'T1', 'T2'],
  Exeed: ['LX', 'TXL', 'VX', 'RX'],
  Hongqi: ['H5', 'H9', 'HS5', 'HS7', 'E-HS9'],
  GAC: ['GS3', 'GS4', 'GS8', 'GA4', 'GA6', 'GA8', 'Emkoo', 'Empow', 'M8'],
  BAIC: ['X35', 'X55', 'X7', 'BJ40', 'BJ60'],
  Bestune: ['T77', 'T99', 'B70'],
  BYD: ['Atto 3', 'Seal', 'Han', 'Tang', 'Song Plus', 'Dolphin', 'Qin Plus', 'Shark'],
  Zeekr: ['001', '007', 'X'],
  'Lynk & Co': ['01', '03', '05', '09'],
  Tesla: ['Model 3', 'Model Y', 'Model S', 'Model X', 'Cybertruck'],
  Polestar: ['2', '3', '4'],
  Genesis: ['G70', 'G80', 'G90', 'GV60', 'GV70', 'GV80'],
  Bentley: ['Bentayga', 'Continental GT', 'Flying Spur', 'Mulsanne'],
  'Rolls-Royce': ['Cullinan', 'Ghost', 'Phantom', 'Wraith', 'Dawn', 'Spectre'],
  Lamborghini: ['Urus', 'Huracan', 'Aventador', 'Revuelto'],
  Ferrari: ['Roma', 'Portofino', 'Purosangue', '296 GTB', 'F8 Tributo', 'SF90', '812', '488'],
  Maserati: ['Levante', 'Ghibli', 'Quattroporte', 'Grecale', 'MC20'],
  'Aston Martin': ['DBX', 'DB11', 'DB12', 'Vantage', 'DBS'],
  McLaren: ['720S', '750S', 'Artura', 'GT', '570S'],
  'Alfa Romeo': ['Giulia', 'Stelvio', 'Tonale'],
  Fiat: ['500', 'Tipo', 'Doblo', 'Fiorino', 'Ducato'],
  Opel: ['Corsa', 'Astra', 'Insignia', 'Mokka', 'Crossland', 'Grandland'],
  Skoda: ['Octavia', 'Superb', 'Kodiaq', 'Karoq', 'Kamiq', 'Rapid', 'Fabia'],
  Fuso: ['Canter', 'Rosa'],
  Hino: ['300', '500'],
};

/** Most common makes in UAE garages: the one-tap chips before anything is typed. */
export const POPULAR_MAKES = ['Toyota', 'Nissan', 'Lexus', 'Mitsubishi', 'Hyundai', 'Kia', 'Honda', 'Ford', 'Chevrolet', 'Mercedes-Benz', 'BMW', 'GMC'];

export const CAR_MAKES: string[] = Object.keys(CAR_CATALOG).sort((a, b) => a.localeCompare(b, 'en'));

const key = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, '');

/** The catalogue spelling of a make typed in any case ("mercedes benz" → "Mercedes-Benz"), or the text as typed. */
export function canonicalMake(input: string): string {
  const k = key(input);
  if (!k) return '';
  return CAR_MAKES.find((m) => key(m) === k) ?? input.trim();
}

/** Models of a make from the catalogue (empty for an unknown make). */
export function modelsFor(make: string): string[] {
  const m = canonicalMake(make);
  return CAR_CATALOG[m] ?? [];
}

/** The catalogue spelling of a model of this make, or the text as typed. */
export function canonicalModel(make: string, input: string): string {
  const k = key(input);
  if (!k) return '';
  return modelsFor(make).find((m) => key(m) === k) ?? input.trim();
}
