import { describe, expect, it } from 'vitest';
import { backedRole, chatMakes, chatSigns, hasPrice, makesInText, mergeSigns, mergeTurns, rateSeen, saysNotAvailable, seenOf, signsKey, turnsOf, wordsForAi, type Turn } from './chatStudy';

/* Made-up chats: the garage («me») and a supplier. */
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 9, 1, 6, 0);
const me = (min: number, text: string, type = 'chat') => ({ t: T0 + min * MIN, me: true, type, text });
const they = (min: number, text: string, type = 'chat') => ({ t: T0 + min * MIN, me: false, type, text });

describe('makesInText', () => {
  it('finds makes, models and VINs, each once', () => {
    expect(makesInText('*Toyota Land Cruiser 2019* front bumper')).toEqual(['Toyota']);
    expect(makesInText('Prado 2015 headlight, also Patrol')).toEqual(['Toyota', 'Nissan']);
    expect(makesInText('benz c200 brake pads')).toEqual(['Mercedes-Benz']);
    expect(makesInText('range rover sport 2018')).toEqual(['Land Rover']);
    expect(makesInText('LC200 radiator')).toEqual(['Toyota']);
    // a Toyota's VIN (made up, of a Toyota maker's code)
    expect(makesInText('VIN: JTDKT923365012345')).toEqual(['Toyota']);
  });
  it('does not take everyday words for models', () => {
    expect(makesInText('spark plug and oil seal, crown wheel, battery charger')).toEqual([]);
    expect(makesInText('fuel tank')).toEqual([]);
  });
});

describe('hasPrice', () => {
  it('sees a price', () => {
    for (const s of ['350', 'org 450 dup 220', 'Price: 1,200', '50+50=100', '350x2', '75 aed', 'AED 90', 'total 1250.50']) expect(hasPrice(s), s).toBe(true);
  });
  it('is not fooled by a year, a size, a phone, a part number, a day or a time', () => {
    for (const s of ['Camry 2015', '2 pcs', '5 litre', '0501234567', '+971 50 123 4567', '90919-01253', 'come 28/11', 'at 10:30', '10 am', 'No', 'ok', 'A4 2019', '3 days']) expect(hasPrice(s), s).toBe(false);
  });
});

describe('saysNotAvailable', () => {
  it('reads «not available» and a plain no', () => {
    for (const s of ['NA', 'n/a', 'not available', 'no have', 'out of stock', 'No', 'sorry dont have', 'غير متوفر']) expect(saysNotAvailable(s), s).toBe(true);
    for (const s of ['350', 'ok', 'checking', 'Normal price 300']) expect(saysNotAvailable(s), s).toBe(false);
  });
});

describe('turnsOf', () => {
  it('a request, its answer, its time, its price and its car', () => {
    const turns = turnsOf([me(0, '*Toyota Camry 2018*\n1. FRONT BUMPER'), they(12, 'org 950 dup 400'), me(15, 'ok send'), they(16, 'ok')]);
    expect(turns).toEqual([{ t: T0, r: 12 * 60, p: 1, mk: ['Toyota'] }]);
  });
  it('«not available» and no answer at all', () => {
    const turns = turnsOf([me(0, 'Nissan Patrol 2016 gearbox mounting price?'), they(5, 'NA'), me(3 * DAY / MIN, 'Patrol 2016 engine mounting available?')]);
    expect(turns).toEqual([
      { t: T0, r: 300, na: 1, mk: ['Nissan'] },
      { t: T0 + 3 * DAY, mk: ['Nissan'] },
    ]);
  });
  it('a greeting is no request; what follows is', () => {
    const turns = turnsOf([me(0, 'Salam'), they(1, 'Walaikum salam'), me(2, 'Lexus LX570 brake pads available?'), they(30, '280')]);
    expect(turns).toEqual([{ t: T0 + 2 * MIN, r: 28 * 60, p: 1, mk: ['Lexus'] }]);
  });
  it('a photo is a request; «thanks» is not', () => {
    expect(turnsOf([me(0, '', 'image'), they(60, 'available 120')])).toEqual([{ t: T0, r: 3600, p: 1 }]);
    expect(turnsOf([me(0, 'thanks'), they(1, 'welcome')])).toEqual([]);
  });
  it('a second message of the garage before any answer is the same request', () => {
    const turns = turnsOf([me(0, 'Hilux 2020 shock absorber'), me(90, '??'), they(100, '350')]);
    expect(turns).toEqual([{ t: T0, r: 100 * 60, p: 1, mk: ['Toyota'] }]);
  });
});

describe('seenOf, rateSeen, chatMakes', () => {
  const now = T0 + 30 * DAY;
  const good: Turn[] = Array.from({ length: 8 }, (_, k) => ({ t: T0 + k * DAY, r: 600, p: 1 as const, mk: ['Toyota'] }));
  const silent: Turn[] = Array.from({ length: 6 }, (_, k) => ({ t: T0 + k * DAY, ...(k === 0 ? { r: 40_000, na: 1 as const } : {}), mk: ['Nissan'] }));
  it('counts decided requests; an open one waits', () => {
    const s = seenOf([...good, { t: now - 60 * MIN }], now);
    expect(s).toMatchObject({ turns: 8, answered: 8, priced: 8, na: 0, open: 1, replyMin: 10, makes: { Toyota: 8 } });
  });
  it('rates the one that answers fast with prices over the silent one', () => {
    const a = rateSeen(seenOf(good, now))!;
    const b = rateSeen(seenOf(silent, now))!;
    expect(a.score).toBeGreaterThan(15);
    expect(a.stars).toBeGreaterThanOrEqual(4);
    expect(b.score).toBeLessThan(-10);
    expect(b.stars).toBeLessThanOrEqual(2);
    expect(rateSeen(seenOf(good.slice(0, 1), now))).toBeUndefined();
  });
  it('«not available» again and again — lower than prices', () => {
    const na: Turn[] = Array.from({ length: 8 }, (_, k) => ({ t: T0 + k * DAY, r: 600, ...(k < 6 ? { na: 1 as const } : { p: 1 as const }) }));
    expect(rateSeen(seenOf(na, now))!.score).toBeLessThan(rateSeen(seenOf(good, now))!.score - 15);
  });
  it('makes: by hand first and alone; else answered for, then the AI', () => {
    const seen = seenOf(good, now);
    expect(chatMakes({ hand: ['nissan'], seen, ai: ['Lexus'] })).toEqual([{ make: 'Nissan', by: 'hand' }]);
    expect(chatMakes({ seen, ai: ['Lexus', 'toyota'] })).toEqual([
      { make: 'Toyota', by: 'seen', n: 8 },
      { make: 'Lexus', by: 'ai' },
    ]);
  });
  it('kept requests stay when the chat is read again', () => {
    const kept: Turn[] = [{ t: T0 }, { t: T0 + DAY }];
    expect(mergeTurns(kept, [{ t: T0 + DAY, r: 60 }, { t: T0 + 2 * DAY }], T0 + DAY - MIN)).toEqual([{ t: T0 }, { t: T0 + DAY, r: 60 }, { t: T0 + 2 * DAY }]);
  });
});

describe('v0.91.2: who a chat is — only as far as its own words show', () => {
  it('signs: a car talked about; parts priced or a request answered with a price', () => {
    expect(chatSigns([me(0, 'Did you eat?'), they(1, 'yes mom')])).toEqual({});
    expect(chatSigns([they(0, 'My Nissan Patrol making noise, can I bring tomorrow?')])).toEqual({ car: 1 });
    expect(chatSigns([they(0, 'org 950 dup 400 for the bumper')])).toEqual({ car: 1, parts: 1 });
    expect(chatSigns([they(0, 'can you send me 500 dirham')])).toEqual({});
    expect(chatSigns([], [{ t: T0, r: 60, p: 1 }])).toEqual({ parts: 1 });
  });
  it('the AI said customer or supplier — kept only when the words back it', () => {
    expect(backedRole('customer', {}, 'Hamad')).toBe('other');
    expect(backedRole('customer', { car: 1 }, 'Khalid')).toBe('customer');
    expect(backedRole('supplier', { car: 1 }, 'Max Garage Al Quoz')).toBe('other');
    expect(backedRole('supplier', {}, 'Al Noor Auto Spare Parts')).toBe('supplier');
    expect(backedRole('supplier', { parts: 1 }, 'Mohammed')).toBe('supplier');
    expect(mergeSigns({ car: 1 }, { parts: 1 })).toEqual({ car: 1, parts: 1 });
    expect(signsKey({ parts: 1 })).toBe('p');
  });
  it('the AI is shown who wrote each line, the telling ones first, in their order', () => {
    const words = wordsForAi([me(0, 'salam'), they(1, 'walaikum salam'), me(2, 'Camry 2018 bumper price?'), they(3, '950'), they(4, 'ok'), me(5, 'thanks')]);
    expect(words).toEqual(['G: Camry 2018 bumper price?', 'T: 950', 'T: ok', 'G: thanks']);
  });
});
