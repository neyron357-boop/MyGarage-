import { describe, expect, it } from 'vitest';
import { focusIndexes, namesLine, partWordsIn, readThreads, vinIn, type ThreadAsk, type ThreadJob, type ThreadMsg } from './supplierThread';

/*
 * A supplier's chat read as a conversation (v1.04). The shapes are the garage's own (28/11/2026: the main supplier asked
 * for several cars an hour, the manager asking in the same chat by hand); every car, VIN, part and word here is made up.
 */

const M = 60_000;
const T0 = Date.parse('2026-11-26T09:00:00Z');
const VIN_A = 'JTDBR32E000000001';
const VIN_B = 'JN8AY2NY000000002';
const VIN_C = '2T2BZMCA000000003';
const VIN_GONE = 'WDB2110420A000004';

const jobs: ThreadJob[] = [
  { orderId: 'A', vin: VIN_A, make: 'Toyota', model: 'Corolla', lines: [{ id: 'cap', name: 'RADIATOR CAP', open: true }, { id: 'bottle', name: 'RADIATOR BOTTLE', open: true }] },
  { orderId: 'B', vin: VIN_B, make: 'Nissan', model: 'Patrol', lines: [{ id: 'arm', name: 'LOWER ARM COMPLETE FRONT LEFT AND RIGHT', open: true }] },
  // A job this supplier was never asked about through the app.
  { orderId: 'C', vin: VIN_C, make: 'Lexus', model: 'RX', lines: [{ id: 'pads', name: 'FRONT BRAKE PADS', open: true }, { id: 'disc', name: 'FRONT BRAKE DISCS', open: true }] },
];
const reqA = `*Toyota Corolla 2018*\nVIN: ${VIN_A}\n\n1. RADIATOR CAP\n2. RADIATOR BOTTLE\n\nPrice and availability, please: original / aftermarket?`;
const reqB = `*Nissan Patrol 2010*\nVIN: ${VIN_B}\n\n1. LOWER ARM COMPLETE FRONT LEFT AND RIGHT × 2\n\nPrice and availability, please: original / aftermarket?`;
const asks: ThreadAsk[] = [
  { id: 'a', orderId: 'A', at: T0, text: reqA, items: ['cap', 'bottle'] },
  { id: 'b', orderId: 'B', at: T0 + 30 * M, text: reqB, items: ['arm'] },
];

let n = 0;
const we = (t: number, text: string, quote?: ThreadMsg['quote']): ThreadMsg => ({ id: `true_c@c.us_W${++n}`, t: T0 + t * M, me: true, text, quote });
const they = (t: number, text: string, quote?: ThreadMsg['quote']): ThreadMsg => ({ id: `false_c@c.us_S${++n}`, t: T0 + t * M, me: false, text, quote });
const key = (id: string) => ({ id: id.split('_')[2] });

describe('which request a supplier’s message is about', () => {
  it('the request, what quotes it, what the talk after it names — and a car’s photo with «clamp» is about nothing of ours', () => {
    const rA = we(0, reqA);
    const rB = we(30, reqB);
    const cap = we(40, 'Here cap coming');
    const capPrice = they(43, '20+TAX DUP', key(cap.id));
    const bush = they(45, 'ONLY BUSH', key(rB.id));
    const photo = we(60, `Lexus RX 2016\nVIN ${VIN_C}`);
    const clamp = we(61, 'Check plz same clamp need', key(photo.id));
    const nudge = we(90, 'Brother ?');
    const notAvl = they(92, 'not avl');
    const bottle = we(120, 'Brother check radiator bottle');
    const bottleNa = they(125, 'NOT AVL');
    const msgs = [rA, rB, cap, capPrice, bush, photo, clamp, nudge, notAvl, bottle, bottleNa];
    const th = readThreads(msgs, asks, jobs);
    const of = (m: ThreadMsg) => th.get(m.id)!;
    expect([of(rA).ask, of(rB).ask]).toEqual(['a', 'b']);
    // «Here cap coming» names one line of the first request: the price quoting it is the cap's.
    expect([of(cap).ask, of(cap).focus]).toEqual(['a', ['cap']]);
    expect([of(capPrice).ask, focusIndexes(of(capPrice), asks[0].items)]).toEqual(['a', [0]]);
    // An answer quoting a request is that request's, whatever part it names.
    expect(of(bush).ask).toBe('b');
    // Our photo of another car, then a part nobody asked for: their «not avl» after it is put nowhere.
    expect([of(photo).ask, of(clamp).ask, of(nudge).ask, of(notAvl).ask, of(notAvl).chat]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    // Our words naming a line of a request bring the talk back to it.
    expect([of(bottle).ask, of(bottle).focus, of(bottleNa).ask, of(bottleNa).focus]).toEqual(['a', ['bottle'], 'a', ['bottle']]);
  });

  it('asked by hand: our list for a car of an open job — that job’s lines; their answer goes there', () => {
    const list = we(0, `Lexus RX 2016\nVIN ${VIN_C}\n\n1. FRONT BRAKE PADS`);
    const price = they(5, '180 org');
    const th = readThreads([list, price], asks, jobs);
    expect(th.get(list.id)!.chat).toMatchObject({ orderId: 'C', items: ['pads'], msg: list.id });
    expect(th.get(price.id)!.chat?.msg).toBe(list.id);
  });

  it('a car of no open job, parts of no request, a long quiet: nowhere', () => {
    const echo = they(10, `*Mercedes C200*\nVIN: ${VIN_GONE}\n\n1. ENGINE MOUNT 150`);
    const hand = we(20, 'Gear filter\nGear oil');
    const answer = they(25, 'Gear oil ----240+\nGear filter----NA');
    const th = readThreads([we(0, reqA), echo, hand, answer], asks, jobs);
    expect([th.get(echo.id)!.ask, th.get(hand.id)!.ask, th.get(answer.id)!.ask, th.get(answer.id)!.chat]).toEqual([undefined, undefined, undefined, undefined]);
    // Four days of silence after a request: a bare price is not its answer.
    const late = they(4 * 24 * 60, '95');
    expect(readThreads([we(0, reqA), late], asks, jobs).get(late.id)!.ask).toBeUndefined();
  });

  it('the request found by its words (sent again, quoted by text), its VIN in an answer; the talk before it goes on', () => {
    const again = we(50, reqA);
    expect(readThreads([again], asks, jobs).get(again.id)!.ask).toBe('a');
    const byText = they(55, '180', { text: '*Toyota Corolla 2018*\nVIN: ' + VIN_A });
    const echo = they(56, `VIN: ${VIN_B}\n1. LOWER ARM COMPLETE FRONT LEFT AND RIGHT × 2 ---- 185x2`);
    const bare = they(57, 'available');
    const th = readThreads([we(31, 'Ok'), byText, echo, bare], asks, jobs);
    expect([th.get(byText.id)!.ask, th.get(echo.id)!.ask, th.get(bare.id)!.ask]).toEqual(['a', 'b', 'b']);
    // Nothing read before it in the chat's window: the last request sent before the window.
    const first = they(35, '185x2');
    expect(readThreads([first], asks, jobs).get(first.id)!.ask).toBe('b');
  });
});

describe('the words', () => {
  it('a line named: what the part is, not a place it is not', () => {
    expect(namesLine('FR SHOCK 210X2 KYB', 'FRONT SHOCK ABSORBER LEFT & RIGHT KYB')).toBe(true);
    expect(namesLine('FR SHOCK 210X2 KYB', 'REAR SHOCK ABSORBERS LEFT AND RIGHT')).toBe(false);
    expect(namesLine('Here cap coming', 'RADIATOR CAP')).toBe(true);
    expect(namesLine('Which oil ? Ns 3 ?', 'GEAR OIL NISSAN NS-3 4LTR')).toBe(true);
    expect(namesLine('Gear oil', 'TRANSMISSION OIL COOLER')).toBe(false);
    expect(namesLine('ok brother', 'RADIATOR CAP')).toBe(false);
  });
  it('part words; a VIN is letters and digits, a long number is not one', () => {
    expect(partWordsIn('Check plz same clamp need')).toEqual(['CLAMP']);
    expect(partWordsIn('Brother ?')).toEqual([]);
    expect(vinIn(`VIN: ${VIN_A.toLowerCase()}`)).toBe(VIN_A);
    expect(vinIn('ACCOUNT NO: 12345678901234567')).toBeUndefined();
  });
});
