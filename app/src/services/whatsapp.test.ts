import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import type { WaChat, WaMessage, WaStatus } from '../domain/whatsapp';
import { createCustomer } from './customers';
import { AppError } from './errors';
import { ensureSeed } from './seed';
import { SyncError } from './sync/api';
import { tellSaid } from './sync/engine';
import {
  canRetryWa,
  chatOfPhone,
  dropFailed,
  flushWa,
  retryWa,
  setWaDraft,
  setWaReply,
  waDraft,
  waReplyOf,
  linkWa,
  loadChats,
  loadMessages,
  loadPeople,
  moreMessages,
  numberOnWa,
  refreshWa,
  seenWa,
  sendWaFile,
  sendWaText,
  setWaTransport,
  unlinkWa,
  waFileSrc,
  waReady,
  waStore,
  waUnread,
  type WaCallInit,
} from './whatsapp';

/*
 * The garage's WhatsApp on a device, with the server's part played here: the state said, linked and unlinked, the
 * chats and a chat's messages read, a text and a file sent (shown at once, then as WhatsApp has them — or as not
 * sent), what the server says on the stream put into the lists.
 */

const ALI = '55512345678901@lid';
const status = (over: Partial<WaStatus> = {}): WaStatus => ({ available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '2.3000', error: '', chats: 2, unread: 3, ...over });
const chat = (id: string, over: Partial<WaChat> = {}): WaChat => ({ id, name: 'Ali wa', group: false, phone: '971501234567', unread: 0, t: 1000, archived: false, pinned: false, muted: false, self: false, last: null, ...over });
const msg = (id: string, over: Partial<WaMessage> = {}): WaMessage => ({ id, chat: ALI, t: 1000, me: false, type: 'chat', text: 'hi', ack: 0, ...over });
const ticks = () => new Promise((r) => setTimeout(r, 0));

interface Server {
  status: WaStatus;
  chats: WaChat[];
  messages: WaMessage[];
  asked: { path: string; init: WaCallInit }[];
  fail?: SyncError;
  hold?: Promise<void>;
  /** The send's own answer, played by a test. */
  onSend?: () => Promise<unknown>;
}
let server: Server;

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
  server = { status: status(), chats: [chat(ALI, { unread: 2, t: 2000 }), chat('120363000000000001@g.us', { name: 'Garage team', group: true, phone: '', unread: 1, muted: true })], messages: [msg('m1'), msg('m2', { t: 1100 })], asked: [] };
  setWaTransport(
    async (path, init) => {
      server.asked.push({ path, init });
      await server.hold;
      if (server.fail) throw server.fail;
      if (path === 'status') return server.status;
      if (path === 'link') return (server.status = status({ phase: 'qr', linked: false, qr: 'data:image/png;base64,AAAA', me: null }));
      if (path === 'logout') return (server.status = status({ phase: 'off', linked: false, on: false, me: null }));
      if (path === 'chats') return { chats: server.chats, total: server.chats.length, unread: 2 };
      if (path === 'messages') return { messages: server.messages.slice(-Number(init.query?.limit ?? 40)), more: true };
      if (path === 'send' && server.onSend) return server.onSend();
      if (path === 'send') return { ok: true, msg: msg('sent1', { me: true, t: Date.now(), text: (init.body as { text: string }).text, ack: 1 }) };
      if (path === 'file') return { ok: true, msg: msg('sent2', { me: true, t: Date.now(), type: 'document', text: init.query?.caption ?? '', ack: 1, file: { name: init.query?.name, size: init.file?.size, here: true } }) };
      if (path === 'seen') return { ok: true, unread: 0 };
      if (path === 'number') return { ok: init.query?.phone !== '971500009999', chat: `${init.query?.phone}@c.us` };
      throw new SyncError(404, 'not found');
    },
    (kind, id) => `test://${kind}/${id}`,
  );
});

describe('the state', () => {
  it('ready: the chats are read at once; the badge counts what waits, without the muted', async () => {
    await refreshWa();
    await loadChats();
    expect(waReady()).toBe(true);
    expect(waStore().chats.map((c) => c.id)).toEqual([ALI, '120363000000000001@g.us']);
    expect(waUnread()).toBe(2);
  });

  it('a server older than WhatsApp in it says so; a server out of reach is only away', async () => {
    server.fail = new SyncError(404, 'not found');
    expect((await refreshWa()).old).toBe(true);
    server.fail = new SyncError(0, 'offline');
    const s = await refreshWa();
    expect(s.away).toBe(true);
    expect(waReady()).toBe(false);
  });

  it('linked: a QR to scan; unlinked: the chats are gone from here', async () => {
    await refreshWa();
    await loadChats();
    await unlinkWa();
    expect(waStore().status?.phase).toBe('off');
    expect(waStore().chats).toEqual([]);
    await linkWa();
    expect(waStore().status?.phase).toBe('qr');
    expect(waStore().status?.qr).toMatch(/^data:image/);
  });

  it('what the server says of itself on the stream is the state at once', async () => {
    await refreshWa();
    tellSaid(`data: ${JSON.stringify({ wa: { t: 'state', state: status({ phase: 'offline', error: 'no answer' }) } })}`);
    expect(waStore().status?.phase).toBe('offline');
    expect(waStore().chats).toEqual([]);
    // (the data's own events are not WhatsApp's)
    tellSaid('data: {"rev": 7}');
    tellSaid(': ping');
    expect(waStore().status?.phase).toBe('offline');
  });
});

describe('a chat', () => {
  beforeEach(async () => {
    await refreshWa();
    await loadChats();
  });

  it('its messages; older ones as it is scrolled up', async () => {
    await loadMessages(ALI);
    expect(waStore().messages[ALI].map((m) => m.id)).toEqual(['m1', 'm2']);
    await moreMessages(ALI);
    expect(server.asked.at(-1)?.init.query).toEqual({ chat: ALI, limit: '120' });
  });

  it('a text: shown as on its way at once, then as WhatsApp has it — once', async () => {
    await loadMessages(ALI);
    let free = () => {};
    server.hold = new Promise((r) => (free = r));
    const going = sendWaText(ALI, '  Car is ready  ');
    await Promise.resolve();
    const waiting = waStore().messages[ALI].at(-1)!;
    expect([waiting.pending, waiting.text, waiting.me]).toEqual([true, 'Car is ready', true]);
    free();
    server.hold = undefined;
    const sent = await going;
    expect(sent.id).toBe('sent1');
    // The stream says the same message too: it is not there twice.
    tellSaid(`data: ${JSON.stringify({ wa: { t: 'msg', msg: sent, chat: chat(ALI, { t: sent.t, last: { id: sent.id, t: sent.t, me: true, type: 'chat', text: sent.text, ack: 1 } }) } })}`);
    expect(waStore().messages[ALI].map((m) => m.id)).toEqual(['m1', 'm2', 'sent1']);
    expect(waStore().messages[ALI].some((m) => m.pending)).toBe(false);
    expect(waStore().chats[0].last?.id).toBe('sent1');
    expect(server.asked.find((a) => a.path === 'send')?.init.body).toEqual({ chat: ALI, text: 'Car is ready', quote: undefined, key: expect.stringMatching(/^p:/) });
  });

  it('v0.80: WhatsApp’s tick on the stream before the send’s own answer — the tick stays (no clock on a sent message)', async () => {
    await loadMessages(ALI);
    let free = () => {};
    const hold = new Promise<void>((r) => (free = r));
    const real = msg(`true_${ALI}_3EB0AA11`, { me: true, t: Date.now(), text: 'Hi', ack: 0 });
    // The send's own answer comes late, and says what WhatsApp said at once: not yet sent (ack 0).
    server.onSend = async () => (await hold, { ok: true, msg: real });
    const going = sendWaText(ALI, 'Hi');
    await Promise.resolve();
    // The message is on WhatsApp — its tick, then its own event — while the send's answer is still on its way.
    tellSaid(`data: ${JSON.stringify({ wa: { t: 'ack', chat: ALI, id: real.id, ack: 1 } })}`);
    tellSaid(`data: ${JSON.stringify({ wa: { t: 'msg', msg: real, chat: null } })}`);
    expect(waStore().messages[ALI].at(-1)).toMatchObject({ id: real.id, ack: 1 });
    expect(waStore().messages[ALI].some((m) => m.pending)).toBe(false);
    tellSaid(`data: ${JSON.stringify({ wa: { t: 'ack', chat: ALI, id: real.id, ack: 2 } })}`);
    free();
    await going;
    const last = waStore().messages[ALI].at(-1)!;
    expect([last.id, last.ack, last.pending]).toEqual([real.id, 2, undefined]);
    expect(waStore().messages[ALI].filter((m) => m.text === 'Hi')).toHaveLength(1);
  });

  it('v0.80: a tick that comes before anything of its message is kept for it', async () => {
    await loadMessages(ALI);
    const real = msg(`true_${ALI}_3EB0BB22`, { me: true, t: Date.now(), text: 'Ok', ack: 0 });
    server.onSend = async () => {
      // WhatsApp's tick reaches the stream while the server is still answering the send.
      tellSaid(`data: ${JSON.stringify({ wa: { t: 'ack', chat: ALI, id: real.id, ack: 1 } })}`);
      return { ok: true, msg: real };
    };
    await sendWaText(ALI, 'Ok');
    expect(waStore().messages[ALI].at(-1)).toMatchObject({ id: real.id, ack: 1 });
  });

  it('a text that did not go stays, marked — and says why', async () => {
    await loadMessages(ALI);
    server.fail = new SyncError(429, 'too many messages a minute');
    await expect(sendWaText(ALI, 'again')).rejects.toMatchObject({ code: 'wa.err.tooMany' });
    const last = waStore().messages[ALI].at(-1)!;
    expect([last.failed, last.text]).toEqual([true, 'again']);
    dropFailed(ALI, last.id);
    expect(waStore().messages[ALI].map((m) => m.id)).toEqual(['m1', 'm2']);
    server.fail = new SyncError(0, 'offline');
    await expect(sendWaText(ALI, 'x')).rejects.toMatchObject({ code: 'wa.err.offline' });
    await expect(sendWaText(ALI, '   ')).rejects.toBeInstanceOf(AppError);
  });

  it('a PDF goes as a document with its name and caption; too large — not at all', async () => {
    await loadMessages(ALI);
    const pdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    const sent = await sendWaFile(ALI, pdf, { name: 'INV-2026-319.pdf', caption: 'Invoice' });
    expect(sent.type).toBe('document');
    const asked = server.asked.find((a) => a.path === 'file')!;
    expect(asked.init.query).toEqual({ chat: ALI, name: 'INV-2026-319.pdf', caption: 'Invoice', doc: '1', key: expect.stringMatching(/^p:/) });
    expect(asked.init.file).toBe(pdf);
    expect(waStore().messages[ALI].at(-1)?.id).toBe('sent2');
    const huge = { size: 60 * 1024 * 1024, type: 'video/mp4' } as Blob;
    await expect(sendWaFile(ALI, huge, { name: 'big.mp4' })).rejects.toMatchObject({ code: 'wa.err.tooBig' });
  });

  it('v0.84: no network — «В очереди», nothing thrown; back — it goes once, under the same key', async () => {
    await loadMessages(ALI);
    server.fail = new SyncError(0, 'offline');
    let done = false;
    const going = sendWaText(ALI, 'On my way', undefined, { queue: true }).then(() => (done = true));
    await ticks();
    const waiting = waStore().messages[ALI].at(-1)!;
    expect([waiting.pending, waiting.queued, !!waiting.failed, waiting.text]).toEqual([true, true, false, 'On my way']);
    expect(done).toBe(false);
    server.fail = undefined;
    await flushWa();
    await going;
    const sends = server.asked.filter((a) => a.path === 'send');
    expect(sends).toHaveLength(2);
    expect((sends[0].init.body as { key: string }).key).toBe((sends[1].init.body as { key: string }).key);
    expect(waStore().messages[ALI].filter((m) => m.text === 'On my way')).toHaveLength(1);
    expect(waStore().messages[ALI].some((m) => m.pending)).toBe(false);
  });

  it('v0.84: WhatsApp not ready — it waits too; a message that cannot go at all is said not sent, with why', async () => {
    await loadMessages(ALI);
    server.fail = new SyncError(409, 'whatsapp is not ready');
    void sendWaText(ALI, 'Later', undefined, { queue: true }).catch(() => undefined);
    await ticks();
    expect(waStore().messages[ALI].at(-1)?.queued).toBe(true);
    server.fail = new SyncError(413, 'too large');
    await flushWa();
    const last = waStore().messages[ALI].at(-1)!;
    expect([last.failed, last.err]).toEqual([true, 'wa.err.tooBig']);
    dropFailed(ALI, last.id);
    expect(waStore().messages[ALI].map((m) => m.id)).toEqual(['m1', 'm2']);
    server.fail = undefined;
  });

  it('v0.84: «Повторить» — the same message under the same key; after it went, nothing is left to send again', async () => {
    await loadMessages(ALI);
    server.fail = new SyncError(502, 'bad gateway');
    await expect(sendWaText(ALI, 'Again?')).rejects.toBeInstanceOf(AppError);
    const failed = waStore().messages[ALI].at(-1)!;
    expect([failed.failed, canRetryWa(failed.id)]).toEqual([true, true]);
    server.fail = undefined;
    await retryWa(ALI, failed.id);
    const sends = server.asked.filter((a) => a.path === 'send');
    expect((sends.at(-1)!.init.body as { key: string }).key).toBe(failed.id);
    expect((sends.at(-2)!.init.body as { key: string }).key).toBe(failed.id);
    expect(canRetryWa(failed.id)).toBe(false);
    expect(waStore().messages[ALI].some((m) => m.failed || m.pending)).toBe(false);
  });

  it('v0.84: a file waits for the network as well; «Удалить» takes it out — it is not sent later', async () => {
    await loadMessages(ALI);
    server.fail = new SyncError(0, 'offline');
    const photo = new Blob(['jpeg'], { type: 'image/jpeg' });
    void sendWaFile(ALI, photo, { name: 'car.jpg', queue: true }).catch(() => undefined);
    await ticks();
    const waiting = waStore().messages[ALI].at(-1)!;
    expect([waiting.type, waiting.queued]).toEqual(['image', true]);
    dropFailed(ALI, waiting.id);
    server.fail = undefined;
    await flushWa();
    expect(server.asked.filter((a) => a.path === 'file')).toHaveLength(1);
    expect(waStore().messages[ALI].map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('v0.84: a draft and the message answered stay with their own chat', () => {
    setWaDraft(ALI, 'half typed');
    setWaDraft('971500000002@c.us', 'another');
    expect(waDraft(ALI)).toBe('half typed');
    setWaDraft(ALI, '');
    expect(waDraft(ALI)).toBe('');
    expect(waDraft('971500000002@c.us')).toBe('another');
    setWaReply(ALI, msg('m1'));
    expect(waReplyOf(ALI)?.id).toBe('m1');
    expect(waReplyOf('971500000002@c.us')).toBeNull();
    setWaReply(ALI, null);
    expect(waReplyOf(ALI)).toBeNull();
  });

  it('opened: read — here at once, and on WhatsApp', async () => {
    await seenWa(ALI);
    expect(waStore().chats[0].unread).toBe(0);
    expect(server.asked.at(-1)).toMatchObject({ path: 'seen', init: { body: { chat: ALI } } });
    const n = server.asked.length;
    await seenWa(ALI);
    expect(server.asked.length).toBe(n);
  });

  it('a message from WhatsApp: into the open chat, and the chat’s line; its ticks after', async () => {
    await loadMessages(ALI);
    const got = msg('in9', { t: 5000, text: 'Yes, do it' });
    tellSaid(`data: ${JSON.stringify({ wa: { t: 'msg', msg: got, chat: chat(ALI, { t: 5000, unread: 3, last: { id: 'in9', t: 5000, me: false, type: 'chat', text: 'Yes, do it', ack: 0 } }) } })}`);
    expect(waStore().messages[ALI].at(-1)?.text).toBe('Yes, do it');
    expect(waStore().chats[0].unread).toBe(3);
    const mine = msg('out1', { me: true, t: 6000, ack: 1 });
    tellSaid(`data: ${JSON.stringify({ wa: { t: 'msg', msg: mine, chat: null } })}`);
    tellSaid(`data: ${JSON.stringify({ wa: { t: 'ack', chat: ALI, id: 'out1', ack: 3 } })}`);
    expect(waStore().messages[ALI].at(-1)?.ack).toBe(3);
  });
});

describe('whose chat', () => {
  it("a customer's chat by the number, though WhatsApp hides the number in the chat's id", async () => {
    const c = await createCustomer({ name: 'Ali Hassan', phone: '050 123 4567', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
    await refreshWa();
    await loadChats();
    expect(chatOfPhone('+971 50 123 4567')?.id).toBe(ALI);
    expect(chatOfPhone('')).toBeUndefined();
    const people = await loadPeople();
    expect(people.get('971501234567')).toEqual({ kind: 'customer', id: c.id, name: 'Ali Hassan' });
    // A number with a chat already: that chat, no question to the server. Another: asked.
    const n = server.asked.length;
    expect(await numberOnWa('0501234567')).toEqual({ ok: true, chat: ALI });
    expect(server.asked.length).toBe(n);
    expect(await numberOnWa('+971507776655')).toEqual({ ok: true, chat: '971507776655@c.us' });
    expect(await numberOnWa('+971500009999')).toEqual({ ok: false, chat: '971500009999@c.us' });
    expect(await numberOnWa('not a number')).toEqual({ ok: false, chat: '' });
  });

  it("a file's address; none for a message not on WhatsApp yet", () => {
    expect(waFileSrc('false_x_AA1')).toBe('test://media/false_x_AA1');
    expect(waFileSrc('p:123')).toBeUndefined();
  });
});
