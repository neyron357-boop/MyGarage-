import { describe, expect, it } from 'vitest';
import { askFor, kindOnly, netUnit, parseReply, type AskLine, type ParsedReply } from './supplierReply';

/*
 * The suppliers' answers in the formats the garage's own suppliers use (read in its WhatsApp, v0.79) — every car,
 * VIN, part and price here is made up.
 */

const ask = (...names: [string, number?, string?][]): AskLine[] => names.map(([name, qty = 1, number]) => ({ name, qty, number }));
/** What each line got, short: index → "kind price xqty vat days note". */
const short = (r: ParsedReply) =>
  Object.fromEntries(
    r.lines.map((l) => [
      l.index,
      l.offers.map((o) =>
        [o.na ? 'NA' : o.pending ? 'WAIT' : `${o.kindSaid ? o.kind : `${o.kind}?`} ${o.unitFils !== undefined ? o.unitFils / 100 : '-'}${o.qty ? ` x${o.qty}` : ''} ${o.vat}`, o.days !== undefined ? `d${o.days}` : '', o.brand ? `[${o.brand}]` : '', o.note ? `«${o.note}»` : ''].filter(Boolean).join(' '),
      ),
    ]),
  );

describe('our list copied back, a price on each line', () => {
  it('«---» between the name and the price, «NA», «+TAX» for all, a delivery time', () => {
    const r = parseReply('WVWZZZ1KZ8W000001\n\n1. GEAR FILTER ---165  1  HOUR ORDER\n2. TRANSMISSION OIL COOLER --- NA\n     \n+TAX', ask(['GEAR FILTER'], ['TRANSMISSION OIL COOLER']));
    expect(short(r)).toEqual({ 0: ['aftermarket? 165 net d0 «1 HOUR ORDER»'], 1: ['NA'] });
    expect(r.vatAll).toBe('net');
    expect(r.unmatched).toEqual([]);
  });

  it('a size or an oil grade in the line is not a price; a missing price is no answer', () => {
    const r = parseReply(
      '*Kia Sorento 2018*\nVIN: KNAPM81ABJA000002\n\n1. GEAR OIL ATF 5LTR --- 120\n2. DIFFERENTIAL FRONT OIL ---  4 LITR 130\n3. TRANSFER CASE REAR OIL --- CHECKING\n4. BRAKE FLUID 4LTR --- DOT 3 TOYOTA 25*4\n5. STEERING POWER OIL ---  50\n+TAX',
      ask(['GEAR OIL ATF 5LTR'], ['DIFFERENTIAL FRONT OIL'], ['TRANSFER CASE REAR OIL'], ['BRAKE FLUID 4LTR', 4], ['STEERING POWER OIL']),
      { make: 'Kia' },
    );
    expect(short(r)).toEqual({
      0: ['aftermarket? 120 net'],
      1: ['aftermarket? 130 net'],
      2: ['WAIT'],
      3: ['aftermarket 25 x4 net [TOYOTA] «DOT»'],
      4: ['aftermarket? 50 net'],
    });
  });

  it('several kinds on a line: «org 295x1/dupl 155x1», «org 265+» (+ is VAT on top)', () => {
    const r = parseReply(
      '1. FRONT BRAKE PADS ORIGINAL  org 265+\n2. FRONT LOW ARM LEFT AND RIGHT  org 295x1/dupl 155x1\n3. FRONT LINK ROD LEFT & RIGHT  org 195x1/dupl 55x1\n4. FENDER COVER RIGHT AND LEFT  dupl 60x1',
      ask(['FRONT BRAKE PADS ORIGINAL'], ['FRONT LOW ARM LEFT AND RIGHT'], ['FRONT LINK ROD LEFT & RIGHT'], ['FENDER COVER RIGHT AND LEFT']),
    );
    expect(short(r)).toEqual({
      0: ['oem 265 net'],
      1: ['oem 295 x1 unsaid', 'aftermarket 155 x1 unsaid'],
      2: ['oem 195 x1 unsaid', 'aftermarket 55 x1 unsaid'],
      3: ['aftermarket 60 x1 unsaid'],
    });
  });

  it('price × quantity either way round; a brand is aftermarket; the requested quantity tells which side is which', () => {
    const r = parseReply(
      '*Hyundai Elantra 2017*\nVIN: KMHD84LF5HU000003\n\n1. SPARK PLUG ORIGINAL × 4  25x4 org  15x4  ngk\n2. IGNITION COIL  100x4 dupli\n\nPrice and availability, please: original / aftermarket?',
      ask(['SPARK PLUG ORIGINAL', 4], ['IGNITION COIL', 4]),
    );
    expect(short(r)).toEqual({ 0: ['oem 25 x4 unsaid', 'aftermarket 15 x4 unsaid [NGK]'], 1: ['aftermarket 100 x4 unsaid'] });
    const q = parseReply('1. SPARK PLUG ORIGINAL 4X20+VAT\n2. IGNITION COIL 4X360+VAT     4X130+VAT', ask(['SPARK PLUG ORIGINAL', 4], ['IGNITION COIL']));
    expect(short(q)).toEqual({ 0: ['oem? 20 x4 net'], 1: ['aftermarket? 360 x4 net', 'aftermarket? 130 x4 net'] });
  });

  it('our quantity and part number echoed are not prices', () => {
    const r = parseReply('1. FRONT LINK ROD LEFT & RIGHT × 2 (K0000001)  85x2 org\n2. VALVE COVER GASKET (P0000002)  60', ask(['FRONT LINK ROD LEFT & RIGHT', 2, 'K0000001'], ['VALVE COVER GASKET', 1, 'P0000002']));
    expect(short(r)).toEqual({ 0: ['oem 85 x2 unsaid'], 1: ['aftermarket? 60 unsaid'] });
  });

  it('a part number with «NA» after it', () => {
    const r = parseReply('21606-00X0B--------NA', ask(['TRANSMISSION COOLER']));
    expect(short(r)).toEqual({ 0: ['NA'] });
  });
});

describe('without the names', () => {
  it('the lines in order: «440+VAT ORG---DUP-295+VAT ⏎ 290+VAT ORG»', () => {
    const r = parseReply('440+VAT  ORG---DUP-295+VAT\n290+VAT  ORG', ask(['CLUTCH CYLINDER DOWNSIDE AND UP', 2], ['BRAKE FLUID 1LTR', 2]));
    expect(short(r)).toEqual({ 0: ['oem 440 net', 'aftermarket 295 net'], 1: ['oem 290 net'] });
  });

  it('a word of the part instead of its number: «gasket 85 ⏎ seal 55», then «original» for both', () => {
    const r = parseReply('gasket   85\nseal   55\noriginal', ask(['VALVE COVER GASKET'], ['AXLE SEAL ORIGINAL RIGHT SIDE']));
    expect(short(r)).toEqual({ 0: ['oem 85 unsaid'], 1: ['oem 55 unsaid'] });
    expect(r.kindAll).toBe('oem');
  });

  it('one part asked: a bare price, a price with its size, «50+50=100 ⏎ ORIGINAL»', () => {
    expect(short(parseReply('40', ask(['OIL FILTER'])))).toEqual({ 0: ['aftermarket? 40 unsaid'] });
    expect(short(parseReply('60   1 LITER', ask(['GEAR OIL'])))).toEqual({ 0: ['aftermarket? 60 unsaid'] });
    expect(short(parseReply('50+50=100\nORIGINAL', ask(['ENGINE BELT', 2])))).toEqual({ 0: ['oem 50 x2 unsaid'] });
  });

  it('«not available» to the whole request; «sorry, no have for this car»; «out of stock»', () => {
    expect(short(parseReply('NOT AVAILABLE', ask(['GEAR FILTER'], ['TRANSMISSION COOLER'])))).toEqual({ 0: ['NA'], 1: ['NA'] });
    expect(short(parseReply('soryy no have for this car', ask(['ENGINE BELT'])))).toEqual({ 0: ['NA «for this car»'] });
    expect(short(parseReply('Soryy out of stock', ask(['TRANSMISSION COOLER'])))).toEqual({ 0: ['NA'] });
    expect(short(parseReply('ONLY HONDA', ask(['TRANSMISSION COOLER'])))).toEqual({ 0: ['NA «ONLY HONDA»'] });
  });

  it('what cannot be told which part it is about is left as words', () => {
    const r = parseReply('80  4l', ask(['VALVE COVER GASKET'], ['AXLE SEAL']));
    expect(r.lines).toEqual([]);
    expect(r.unmatched).toEqual(['80  4l']);
    const set = parseReply('750+TAX SET', ask(['CLUTCH PLATE'], ['PRESSURE PLATE'], ['CLUTCH BEARING']));
    expect(set.lines).toEqual([]);
    expect(set.unmatched).toEqual(['750+TAX SET']);
  });

  it('a greeting or an «ok» is no answer', () => {
    expect(parseReply('OK', ask(['A'])).ack).toBe(true);
    expect(parseReply('Good day! Thank you for reaching out. My name is Sam, and I will be assisting you today.', ask(['A'], ['B'])).lines).toEqual([]);
  });
});

describe('words of the answer', () => {
  it('«with VAT» and «incl. VAT» are gross; the cost is kept without it', () => {
    const r = parseReply('105 incl vat', ask(['OIL FILTER']));
    expect(r.lines[0].offers[0].vat).toBe('gross');
    expect(netUnit(r.lines[0].offers[0], 'net', 500)).toBe(10000);
    expect(netUnit({ unitFils: 10000, vat: 'unsaid' }, 'net', 500)).toBe(10000);
    expect(netUnit({ unitFils: 10500, vat: 'unsaid' }, 'gross', 500)).toBe(10000);
  });

  it('thousands, a decimal, the currency', () => {
    expect(short(parseReply('1,250 AED', ask(['GEARBOX'])))).toEqual({ 0: ['aftermarket? 1250 unsaid'] });
    expect(short(parseReply('12.5 dhs each', ask(['BULB'])))).toEqual({ 0: ['aftermarket? 12.5 unsaid'] });
  });

  it('days: tomorrow, «2 days»', () => {
    expect(short(parseReply('320 org tomorrow', ask(['RADIATOR'])))).toEqual({ 0: ['oem 320 unsaid d1'] });
    expect(short(parseReply('320 dup 2 days', ask(['RADIATOR'])))).toEqual({ 0: ['aftermarket 320 unsaid d2'] });
  });

  it('the kind alone, in a message of its own', () => {
    expect(kindOnly('original')).toBe('oem');
    expect(kindOnly('Original better')).toBe('oem');
    expect(kindOnly('japan duplicate')).toBe('aftermarket');
    expect(kindOnly('Original 380')).toBeUndefined();
    expect(kindOnly('Is this price fair?')).toBeUndefined();
  });
});

describe('which request an answer is to', () => {
  const H = 3600_000;
  const asks = [
    { id: 'a1', at: 10 * H, text: '*Toyota Camry 2019*\nVIN: 4T1B11HK5KU000004\n\n1. BRAKE PADS' },
    { id: 'a2', at: 20 * H, text: '*Nissan Patrol 2020*\nVIN: JN8AY2NY5L9000005\n\n1. AIR FILTER' },
  ];
  it('the one it quotes, the one whose VIN it names, else the last one before it', () => {
    expect(askFor({ t: 30 * H, text: '1. BRAKE PADS 180', quote: '*Toyota Camry 2019* VIN: 4T1B11HK5KU000004  1. BRAKE' }, asks)?.id).toBe('a1');
    expect(askFor({ t: 30 * H, text: '4T1B11HK5KU000004\n1. BRAKE PADS 180' }, asks)?.id).toBe('a1');
    expect(askFor({ t: 30 * H, text: '95' }, asks)?.id).toBe('a2');
    expect(askFor({ t: 15 * H, text: '95' }, asks)?.id).toBe('a1');
    expect(askFor({ t: 5 * H, text: '95' }, asks)).toBeUndefined();
    expect(askFor({ t: 20 * H + 4 * 24 * H, text: '95' }, asks)).toBeUndefined();
  });
});

describe('what is not this request', () => {
  it('a list numbered past the request’s own parts answers another request', () => {
    const r = parseReply('1. FRONT BRAKE PADS  org 265+\n2. FRONT LOW ARM  dupl 155x1', ask(['OIL FILTER']));
    expect(r.other).toBe(true);
    expect(r.lines).toEqual([]);
  });
  it('«na» to the whole request is said so (for the parts not answered yet)', () => {
    const r = parseReply('na', ask(['A'], ['B'], ['C']));
    expect(r.naAll).toBe(true);
    expect(r.lines.map((l) => l.index)).toEqual([0, 1, 2]);
  });
});
