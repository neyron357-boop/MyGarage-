import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  chatIdOf,
  chatTitle,
  clock,
  fileSize,
  filterChats,
  groupDays,
  kindOf,
  marks,
  mergeMessages,
  orderChats,
  peopleIndex,
  previewOf,
  sendKind,
  tabCounts,
  ticksOf,
  unreadTotal,
  waDigits,
  whoOf,
  type WaChat,
  type WaLists,
  type WaMessage,
} from './whatsapp';

const chat = (id: string, over: Partial<WaChat> = {}): WaChat => ({
  id,
  name: '',
  group: id.endsWith('@g.us'),
  phone: id.endsWith('@c.us') ? id.split('@')[0] : '',
  unread: 0,
  t: 1000,
  archived: false,
  pinned: false,
  muted: false,
  self: false,
  last: null,
  ...over,
});
const msg = (id: string, over: Partial<WaMessage> = {}): WaMessage => ({ id, chat: '971501234567@c.us', t: 1000, me: false, type: 'chat', text: 'hi', ack: 0, ...over });

const people = peopleIndex([
  { kind: 'supplier', id: 's1', name: 'Al Noor Parts', phones: ['050 777 6655'] },
  { kind: 'customer', id: 'c1', name: 'Ali Hassan', phones: ['+971501234567', undefined] },
  { kind: 'driver', id: 'd1', name: 'Driver of Ali', phones: ['+971501234567'] },
  { kind: 'employee', id: 'e1', name: 'Rashid', phones: ['0559990000'] },
  { kind: 'customer', id: 'c2', name: 'No phone', phones: [''] },
]);

describe('whose chat', () => {
  it('a number as WhatsApp has it, however it was typed', () => {
    expect(waDigits('050 123 4567')).toBe('971501234567');
    expect(waDigits('+971 50 123 4567')).toBe('971501234567');
    expect(waDigits('00971501234567')).toBe('971501234567');
    expect(waDigits('')).toBe('');
    expect(waDigits(undefined)).toBe('');
    expect(waDigits('800 4444')).toBe('');
    expect(chatIdOf('050 123 4567')).toBe('971501234567@c.us');
    expect(chatIdOf('nothing')).toBe('');
  });

  it("the garage's people by number: a customer before a driver with the same number", () => {
    expect(whoOf(chat('971501234567@c.us'), people)).toEqual({ kind: 'customer', id: 'c1', name: 'Ali Hassan' });
    expect(whoOf(chat('971507776655@c.us'), people)?.kind).toBe('supplier');
    expect(whoOf(chat('971559990000@c.us'), people)?.kind).toBe('employee');
    expect(whoOf(chat('971500000000@c.us'), people)).toBeUndefined();
    expect(whoOf(chat('120363000000000001@g.us', { phone: '971501234567' }), people)).toBeUndefined();
    // WhatsApp hides the number in the id (@lid): the number the server found is what counts.
    expect(whoOf(chat('55512345678901@lid', { phone: '971501234567' }), people)?.id).toBe('c1');
  });

  it("the garage's name first, then WhatsApp's, then the number", () => {
    const c = chat('971501234567@c.us', { name: 'Ali wa' });
    expect(chatTitle(c, whoOf(c, people))).toBe('Ali Hassan');
    expect(chatTitle(chat('971500000000@c.us', { name: 'Unknown shop' }))).toBe('Unknown shop');
    expect(chatTitle(chat('971500000000@c.us'))).toBe('+971500000000');
  });
});

describe('the list', () => {
  const chats = [
    chat('971501234567@c.us', { t: 5, unread: 2 }),
    chat('971507776655@c.us', { t: 9, name: 'Noor' }),
    chat('120363000000000001@g.us', { t: 7, name: 'Garage team', unread: 1, muted: true }),
    chat('971500000000@c.us', { t: 8, name: 'Old chat', archived: true, unread: 4 }),
    chat('971551112233@c.us', { t: 1, name: 'Pinned one', pinned: true }),
  ];

  it('pinned on top, then the newest', () => {
    expect(orderChats(chats).map((c) => c.t)).toEqual([1, 9, 8, 7, 5]);
  });

  it('tabs: all without the archived, unread, customers, suppliers, groups', () => {
    const ids = (tab: Parameters<typeof filterChats>[1]['tab'], query = '') => filterChats(chats, { tab, query, people }).map((c) => c.id.split('@')[0]);
    expect(ids('all')).toEqual(['971551112233', '971507776655', '120363000000000001', '971501234567']);
    expect(ids('unread')).toEqual(['120363000000000001', '971501234567']);
    expect(ids('customers')).toEqual(['971501234567']);
    expect(ids('suppliers')).toEqual(['971507776655']);
    expect(ids('groups')).toEqual(['120363000000000001']);
  });

  it("a search: by the garage's name, WhatsApp's name, the number as it is said — and finds the archived", () => {
    const ids = (query: string) => filterChats(chats, { tab: 'all', query, people }).map((c) => c.id.split('@')[0]);
    expect(ids('ali')).toEqual(['971501234567']);
    expect(ids('NOOR')).toEqual(['971507776655']);
    expect(ids('050 777')).toEqual(['971507776655']);
    expect(ids('old')).toEqual(['971500000000']);
    expect(ids('zzz')).toEqual([]);
  });

  it('what waits to be read: by tab, and the badge without the muted and the archived', () => {
    expect(tabCounts(chats, people)).toEqual({ all: 2, unread: 2, customers: 1, suppliers: 0, groups: 1 });
    expect(unreadTotal(chats)).toBe(2);
  });
});

describe('a message in a few words', () => {
  it('kinds', () => {
    expect(kindOf('chat')).toBe('text');
    expect(kindOf('image')).toBe('photo');
    expect(kindOf('ptt')).toBe('voice');
    expect(kindOf('document')).toBe('file');
    expect(kindOf('call_log')).toBe('call');
    expect(kindOf('revoked')).toBe('gone');
    expect(kindOf('something_new')).toBe('other');
  });

  it("a line of the list: the words, a file's name, a voice message's length", () => {
    expect(previewOf({ type: 'chat', text: 'Car is\nready' })).toEqual({ kind: 'text', words: 'Car is ready' });
    expect(previewOf({ type: 'image', text: '' })).toEqual({ kind: 'photo', words: '' });
    expect(previewOf({ type: 'image', text: 'look' })).toEqual({ kind: 'photo', words: 'look' });
    expect(previewOf({ type: 'document', text: '', name: 'INV-2026-319.pdf' })).toEqual({ kind: 'file', words: 'INV-2026-319.pdf' });
    expect(previewOf({ type: 'ptt', text: '', sec: 67 })).toEqual({ kind: 'voice', words: '1:07' });
    expect(clock(5)).toBe('0:05');
    expect(clock(undefined)).toBe('0:00');
  });

  it('ticks', () => {
    expect(ticksOf({ ack: 0, pending: true })).toBe('wait');
    expect(ticksOf({ ack: 0 })).toBe('wait');
    expect(ticksOf({ ack: 1 })).toBe('sent');
    expect(ticksOf({ ack: 2 })).toBe('got');
    expect(ticksOf({ ack: 3 })).toBe('read');
    expect(ticksOf({ ack: 4 })).toBe('read');
    expect(ticksOf({ ack: -1 })).toBe('failed');
    expect(ticksOf({ ack: 0, failed: true })).toBe('failed');
  });

  it("a file's size", () => {
    expect(fileSize(undefined)).toBeUndefined();
    expect(fileSize(300)).toEqual({ n: '1', unit: 'kb' });
    expect(fileSize(340 * 1024)).toEqual({ n: '340', unit: 'kb' });
    expect(fileSize(1.26 * 1024 * 1024)).toEqual({ n: '1.3', unit: 'mb' });
    expect(fileSize(48 * 1024 * 1024)).toEqual({ n: '48', unit: 'mb' });
  });

  it('by day, in Dubai', () => {
    // 20:30 UTC is 00:30 the next day in Dubai.
    const a = msg('a', { t: Date.parse('2026-11-23T10:00:00Z') });
    const b = msg('b', { t: Date.parse('2026-11-23T20:30:00Z') });
    const c = msg('c', { t: Date.parse('2026-11-24T05:00:00Z') });
    expect(groupDays([a, b, c]).map(([d, list]) => [d, list.map((m) => m.id)])).toEqual([
      ['2026-11-23', ['a']],
      ['2026-11-24', ['b', 'c']],
    ]);
  });

  it('how a file goes', () => {
    expect(sendKind({ type: 'image/jpeg', name: 'a.jpg' })).toBe('photo');
    expect(sendKind({ type: 'image/heic', name: 'a.heic' })).toBe('doc');
    expect(sendKind({ type: 'video/mp4', name: 'a.mp4' })).toBe('video');
    expect(sendKind({ type: 'video/quicktime', name: 'a.mov' })).toBe('doc');
    expect(sendKind({ type: 'application/pdf', name: 'a.pdf' })).toBe('doc');
    expect(sendKind({ type: 'audio/mp4', name: 'a.m4a' })).toBe('audio');
  });
});

describe("words with WhatsApp's marks", () => {
  it('bold, italic, struck, mono', () => {
    expect(marks('*Toyota Camry 2019*\nVIN: X')).toEqual([{ t: 'Toyota Camry 2019', b: true }, { t: '\nVIN: X' }]);
    expect(marks('price _with_ VAT, ~500~ 450 `AED`')).toEqual([{ t: 'price ' }, { t: 'with', i: true }, { t: ' VAT, ' }, { t: '500', s: true }, { t: ' 450 ' }, { t: 'AED', m: true }]);
  });

  it('a mark inside a word, or with a space inside, is only a sign', () => {
    expect(marks('5*4*3 = 60')).toEqual([{ t: '5*4*3 = 60' }]);
    expect(marks('a * b * c')).toEqual([{ t: 'a * b * c' }]);
    expect(marks('part_number_1')).toEqual([{ t: 'part_number_1' }]);
  });

  it('links, without the sentence’s full stop', () => {
    expect(marks('See https://maps.app.goo.gl/abc?x=1. Thanks')).toEqual([{ t: 'See ' }, { t: 'https://maps.app.goo.gl/abc?x=1', href: 'https://maps.app.goo.gl/abc?x=1' }, { t: '. Thanks' }]);
    expect(marks('www.example.com')).toEqual([{ t: 'www.example.com', href: 'https://www.example.com' }]);
    // Nothing is made of what looks like markup.
    expect(marks('<b>x</b> javascript:alert(1)')).toEqual([{ t: '<b>x</b> javascript:alert(1)' }]);
  });
});

describe('what WhatsApp says, into the lists', () => {
  const lists = (): WaLists => ({ chats: [chat('971501234567@c.us', { t: 1000, last: { id: 'm1', t: 1000, me: true, type: 'chat', text: 'hi', ack: 1 } })], messages: { '971501234567@c.us': [msg('m1', { me: true, ack: 1 })] } });

  it('a message: into its chat and into the chat’s line', () => {
    const row = chat('971501234567@c.us', { t: 2000, unread: 1, last: { id: 'm2', t: 2000, me: false, type: 'chat', text: 'ok', ack: 0 } });
    const next = applyEvent(lists(), { t: 'msg', msg: msg('m2', { t: 2000, text: 'ok' }), chat: row });
    expect(next.messages['971501234567@c.us'].map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(next.chats[0].unread).toBe(1);
    expect(next.chats[0].last?.id).toBe('m2');
  });

  it('a chat not opened here: only its line changes; a new chat goes on top', () => {
    const start = lists();
    const row = chat('971509990000@c.us', { t: 3000, unread: 1 });
    const next = applyEvent(start, { t: 'msg', msg: msg('x1', { chat: '971509990000@c.us', t: 3000 }), chat: row });
    expect(next.chats.map((c) => c.id)).toEqual(['971509990000@c.us', '971501234567@c.us']);
    expect(next.messages).toBe(start.messages);
  });

  it('what was written here and is now on WhatsApp replaces its waiting copy — the file stays in sight', () => {
    const start = lists();
    start.messages['971501234567@c.us'].push(msg('p:1', { me: true, t: 1500, text: 'Ready', pending: true }), msg('p:2', { me: true, t: 1600, text: '', type: 'image', pending: true, local: 'blob:x', file: { here: true } }));
    let next = applyEvent(start, { t: 'msg', msg: msg('m3', { me: true, t: 1700, text: 'Ready', ack: 1 }), chat: null });
    expect(next.messages['971501234567@c.us'].map((m) => m.id)).toEqual(['m1', 'p:2', 'm3']);
    expect(next.chats[0].last?.id).toBe('m3');
    next = applyEvent(next, { t: 'msg', msg: msg('m4', { me: true, t: 1800, text: '', type: 'image', ack: 1, file: { here: true } }), chat: null });
    expect(next.messages['971501234567@c.us'].map((m) => [m.id, m.local])).toEqual([['m1', undefined], ['m3', undefined], ['m4', 'blob:x']]);
  });

  it('the same message twice is one', () => {
    const one = msg('m5', { t: 2000 });
    const next = applyEvent(applyEvent(lists(), { t: 'msg', msg: one, chat: null }), { t: 'msg', msg: { ...one, ack: 2 }, chat: null });
    expect(next.messages['971501234567@c.us'].filter((m) => m.id === 'm5')).toEqual([{ ...one, ack: 2, pending: undefined, failed: undefined, local: undefined }]);
  });

  it('a message taken back does not become the last one', () => {
    const next = applyEvent(lists(), { t: 'msg', msg: msg('m1', { me: true, type: 'revoked', text: '', t: 1000 }), chat: null, was: true });
    expect(next.messages['971501234567@c.us'][0].type).toBe('revoked');
    expect(next.chats[0].last?.type).toBe('chat');
  });

  it('ticks: in the chat and in its line; nothing changed — the same lists', () => {
    const start = lists();
    const next = applyEvent(start, { t: 'ack', chat: '971501234567@c.us', id: 'm1', ack: 3 });
    expect(next.messages['971501234567@c.us'][0].ack).toBe(3);
    expect(next.chats[0].last?.ack).toBe(3);
    expect(applyEvent(next, { t: 'ack', chat: '971501234567@c.us', id: 'm1', ack: 3 })).toBe(next);
    expect(applyEvent(start, { t: 'ack', chat: 'other@c.us', id: 'zz', ack: 3 })).toBe(start);
  });

  it('v0.80: ticks only grow — a late smaller tick, a send’s answer read after its tick take none away', () => {
    const start = lists();
    const read = applyEvent(start, { t: 'ack', chat: '971501234567@c.us', id: 'm1', ack: 3 });
    expect(applyEvent(read, { t: 'ack', chat: '971501234567@c.us', id: 'm1', ack: 1 })).toBe(read);
    const again = applyEvent(read, { t: 'msg', msg: msg('m1', { me: true, ack: 1 }), chat: null });
    expect(again.messages['971501234567@c.us'][0].ack).toBe(3);
    expect(mergeMessages([msg('a', { ack: 2 })], [msg('a', { ack: 0 })])[0].ack).toBe(2);
  });

  it('v0.80: the chat read under its other id (a number’s, WhatsApp’s hidden @lid) — its tick, its message, its copy on the way', () => {
    const NUM = '971501234567@c.us';
    const LID = '55512345678901@lid';
    const start: WaLists = { chats: [chat(LID, { phone: '971501234567' })], messages: { [NUM]: [msg(`true_${NUM}_3EB0AA`, { chat: NUM, me: true, ack: 0 }), msg('p:1', { chat: NUM, me: true, text: 'Hi', t: 5000, pending: true })] } };
    // A tick said under the other id: the same message (its key).
    const ticked = applyEvent(start, { t: 'ack', chat: LID, id: `true_${LID}_3EB0AA`, ack: 1 });
    expect(ticked.messages[NUM][0].ack).toBe(1);
    // The message written here, now on WhatsApp under the other id: its waiting copy leaves, it is there once.
    const sent = applyEvent(ticked, { t: 'msg', msg: msg(`true_${LID}_3EB0BB`, { chat: LID, me: true, text: 'Hi', t: 5200, ack: 1 }), chat: chat(LID, { phone: '971501234567' }) });
    expect(sent.messages[NUM].map((m) => m.id)).toEqual([`true_${NUM}_3EB0AA`, `true_${LID}_3EB0BB`]);
    // An answer of the customer under the other id: into the chat as it is read here.
    const answer = applyEvent(sent, { t: 'msg', msg: msg(`false_${LID}_3EB0CC`, { chat: LID, text: 'Thanks', t: 6000 }), chat: chat(LID, { phone: '971501234567' }) });
    expect(answer.messages[NUM].at(-1)?.text).toBe('Thanks');
    expect(answer.messages[LID]).toBeUndefined();
  });

  it('v0.80: the same words in another person’s chat are not taken for its copy on the way', () => {
    const A = '971501234567@c.us';
    const B = '971509990000@c.us';
    const start: WaLists = { chats: [chat(A), chat(B, { phone: '971509990000' })], messages: { [A]: [msg('p:1', { chat: A, me: true, text: 'ok', t: 5000, pending: true })], [B]: [] } };
    const next = applyEvent(start, { t: 'msg', msg: msg('true_B_1', { chat: B, me: true, text: 'ok', t: 5100, ack: 1 }), chat: null });
    expect(next.messages[A].map((m) => m.id)).toEqual(['p:1']);
    expect(next.messages[B].map((m) => m.id)).toEqual(['true_B_1']);
  });

  it('a chat’s line: read on the phone', () => {
    const start = lists();
    start.chats[0].unread = 3;
    const next = applyEvent(start, { t: 'chat', chat: { ...start.chats[0], unread: 0 } });
    expect(next.chats[0].unread).toBe(0);
  });

  it('messages put together: by time, one of an id', () => {
    const out = mergeMessages([msg('b', { t: 2 }), msg('a', { t: 1 })], [msg('c', { t: 3 }), msg('a', { t: 1, ack: 3 })]);
    expect(out.map((m) => [m.id, m.ack])).toEqual([['a', 3], ['b', 0], ['c', 0]]);
    const same = [msg('a')];
    expect(mergeMessages(same, [])).toBe(same);
  });
});
