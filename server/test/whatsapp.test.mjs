import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApi, createPairing } from '../src/api.mjs';
import { loadConfig } from '../src/config.mjs';
import { createEvents } from '../src/events.mjs';
import { openStore } from '../src/store.mjs';
import { createWhatsApp } from '../src/whatsapp.mjs';
import { applyHunks, applyPatches, parseDiff, patchName } from '../whatsapp/patch.mjs';
import { chatRow, lastRow, messageRow, phoneOf, sortChats } from '../whatsapp/rows.mjs';

/* ---------- What the bridge says of chats and messages ---------- */

const id = (fromMe, remote, key) => ({ fromMe, remote, id: key, _serialized: `${fromMe}_${remote}_${key}` });
const THUMB = `/9j/${'A'.repeat(400)}`;

describe('whatsapp rows', () => {
  it('a text', () => {
    const r = messageRow({ id: id(false, '971501234567@c.us', 'AA1'), type: 'chat', body: 'Hello', t: 1_700_000_000, ack: 1 });
    assert.deepEqual(r, { id: 'false_971501234567@c.us_AA1', chat: '971501234567@c.us', t: 1_700_000_000_000, me: false, type: 'chat', text: 'Hello', ack: 1 });
  });

  it('a photo: its caption is the words, its small preview comes with it — the file does not', () => {
    const r = messageRow({ id: id(true, '971501234567@c.us', 'AA2'), type: 'image', body: THUMB, caption: 'Brake pads', mimetype: 'image/jpeg', size: 120_000, width: 1280, height: 960, directPath: '/v/x', t: 1, ack: 3, mediaKey: 'secret' });
    assert.equal(r.text, 'Brake pads');
    assert.deepEqual(r.file, { mime: 'image/jpeg', name: undefined, size: 120_000, sec: undefined, w: 1280, h: 960, thumb: THUMB, here: true });
    assert.equal(JSON.stringify(r).includes('secret'), false);
  });

  it('a preview that is not a JPEG is not passed on', () => {
    const r = messageRow({ id: id(false, '971501234567@c.us', 'AA3'), type: 'image', body: '<script>', directPath: '/v/x', t: 1 });
    assert.equal(r.file.thumb, undefined);
  });

  it('a document: its name once, not as its words too; an old file is said to be gone from WhatsApp', () => {
    const r = messageRow({ id: id(false, '971501234567@c.us', 'AA4'), type: 'document', caption: 'INV-2026-319.pdf', filename: 'INV-2026-319.pdf', mimetype: 'application/pdf', size: 90_000, t: 1 });
    assert.equal(r.text, '');
    assert.equal(r.file.name, 'INV-2026-319.pdf');
    assert.equal(r.file.here, false);
  });

  it('a voice message: how long', () => {
    const r = messageRow({ id: id(false, '971501234567@c.us', 'AA5'), type: 'ptt', duration: '12', mimetype: 'audio/ogg; codecs=opus', directPath: '/v/x', t: 1 });
    assert.equal(r.file.sec, 12);
  });

  it('in a group: who wrote it; the number only where WhatsApp shows it', () => {
    const a = messageRow({ id: id(false, '120363000000000001@g.us', 'AA6'), type: 'chat', body: 'ok', t: 1, author: { _serialized: '971509998877@c.us' }, notifyName: 'Ahmed' });
    assert.deepEqual(a.from, { id: '971509998877@c.us', name: 'Ahmed', phone: '971509998877' });
    const b = messageRow({ id: id(false, '120363000000000001@g.us', 'AA7'), type: 'chat', body: 'ok', t: 1, author: '55512345678901@lid', notifyName: 'Sam' });
    assert.deepEqual(b.from, { id: '55512345678901@lid', name: 'Sam', phone: undefined });
  });

  it('an answer: the message answered, and whose it was', () => {
    const r = messageRow(
      { id: id(false, '971501234567@c.us', 'AA8'), type: 'chat', body: 'Yes, do it', t: 1, quotedStanzaID: 'QQ1', quotedParticipant: { _serialized: '971500000001@c.us' }, quotedMsg: { type: 'chat', body: 'Brake pads — 450 AED' } },
      { me: '971500000001@c.us' },
    );
    assert.deepEqual(r.quote, { id: 'QQ1', type: 'chat', text: 'Brake pads — 450 AED', me: true, thumb: undefined });
  });

  it('a contact card and a place', () => {
    const card = messageRow({ id: id(false, '971501234567@c.us', 'AA9'), type: 'vcard', t: 1, vcardFormattedName: 'Parts Shop', body: 'BEGIN:VCARD\nFN:Parts Shop\nTEL;type=CELL;waid=971507776655:+971 50 777 6655\nEND:VCARD' });
    assert.deepEqual(card.card, { name: 'Parts Shop', phone: '971507776655' });
    const place = messageRow({ id: id(false, '971501234567@c.us', 'AB1'), type: 'location', t: 1, lat: 25.2, lng: 55.3, loc: 'Al Quoz' });
    assert.deepEqual(place.place, { lat: 25.2, lng: 55.3 });
    assert.equal(place.text, 'Al Quoz');
  });

  it("WhatsApp's own notices and the status feed are not messages", () => {
    assert.equal(messageRow({ id: id(false, '971501234567@c.us', 'AB2'), type: 'e2e_notification', t: 1 }), null);
    assert.equal(messageRow({ id: id(false, '971501234567@c.us', 'AB3'), type: 'gp2', t: 1 }), null);
    assert.equal(messageRow({ id: id(false, 'status@broadcast', 'AB4'), type: 'chat', body: 'x', t: 1 }), null);
    assert.equal(messageRow(null), null);
  });

  it('an id WhatsApp now writes as `$1` reads the same', () => {
    const r = messageRow({ id: { fromMe: true, remote: { $1: '971501234567@c.us' }, $1: 'true_971501234567@c.us_AB5' }, type: 'chat', body: 'x', t: 1 });
    assert.equal(r.id, 'true_971501234567@c.us_AB5');
    assert.equal(r.chat, '971501234567@c.us');
  });

  it('a chat of the list: its number, its unread, its last message in a few words', () => {
    const c = chatRow(
      { id: { _serialized: '971501234567@c.us' }, name: ' Ali ', unread: 2, t: 1_700_000_100, pinned: 1, last: { id: id(false, '971501234567@c.us', 'AC1'), type: 'image', body: '', caption: 'look', directPath: '/v', t: 1_700_000_100 } },
      { me: '971500000001@c.us' },
    );
    assert.equal(c.name, 'Ali');
    assert.equal(c.phone, '971501234567');
    assert.equal(c.unread, 2);
    assert.equal(c.t, 1_700_000_100_000);
    assert.equal(c.pinned, true);
    assert.equal(c.self, false);
    assert.deepEqual(c.last, { id: 'false_971501234567@c.us_AC1', t: 1_700_000_100_000, me: false, type: 'image', text: 'look', ack: 0, name: undefined, sec: undefined, from: undefined });
    assert.equal(chatRow({ id: 'status@broadcast', t: 1 }), null);
    assert.equal(chatRow({ id: '120363000000000001@g.us', t: 1, phone: '123' }).phone, '');
    assert.equal(chatRow({ id: '971500000001@c.us', t: 1 }, { me: '971500000001@c.us' }).self, true);
    // A person whose number WhatsApp hides in the id: the number the page found.
    assert.equal(chatRow({ id: '55512345678901@lid', t: 1, phone: '971 50 111 2233' }).phone, '971501112233');
  });

  it('the newest chat first', () => {
    const rows = sortChats([{ id: 'a@c.us', t: 1 }, { id: 'b@c.us', t: 3 }, { id: 'c@c.us', t: 2 }]);
    assert.deepEqual(rows.map((r) => r.id), ['b@c.us', 'c@c.us', 'a@c.us']);
    assert.equal(phoneOf('120363000000000001@g.us'), '');
    assert.equal(lastRow(null), null);
  });
});

/* ---------- The library's fix, kept as a patch ---------- */

const DIFF = `diff --git a/src/Client.js b/src/Client.js
index 62de539..fd8e316 100644
--- a/src/Client.js
+++ b/src/Client.js
@@ -2,5 +2,5 @@ class Client {
   start() {
     const a = 1;
-    const state = old();
+    const state = fresh();
     return state;
   }
@@ -9,4 +9,5 @@ class Client {
   stop() {
     const b = 2;
+    extra();
     return b;
`;
const FILE = ['class Client {', '  start() {', '    const a = 1;', '    const state = old();', '    return state;', '  }', '', '  stop() {', '    const b = 2;', '    return b;', '  }', '}', ''].join('\n');

describe('whatsapp patch', () => {
  it('a diff put on, part by part', () => {
    const [f] = parseDiff(DIFF);
    assert.equal(f.path, 'src/Client.js');
    assert.equal(f.hunks.length, 2);
    const r = applyHunks(FILE, f.hunks);
    assert.deepEqual([r.applied, r.already, r.failed], [2, 0, 0]);
    assert.match(r.text, /const state = fresh\(\);/);
    assert.match(r.text, /const b = 2;\n {4}extra\(\);\n {4}return b;/);
    // Put on again: nothing changes.
    const again = applyHunks(r.text, f.hunks);
    assert.deepEqual([again.applied, again.already, again.failed], [0, 2, 0]);
    assert.equal(again.text, r.text);
  });

  it('Windows line ends stay', () => {
    const [f] = parseDiff(DIFF);
    const r = applyHunks(FILE.replace(/\n/g, '\r\n'), f.hunks);
    assert.equal(r.failed, 0);
    assert.equal(r.text.includes('fresh();\r\n'), true);
    assert.equal(/[^\r]\n/.test(r.text), false);
  });

  it('a part that finds no place: the file is left as it was', () => {
    const [f] = parseDiff(DIFF);
    const other = FILE.replace('const b = 2;', 'const b = 3;');
    const r = applyHunks(other, f.hunks);
    assert.equal(r.failed, 1);
    assert.equal(r.text, other);
  });

  it('only on the version it was read against, only inside the package', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-wa-patch-'));
    try {
      const pkg = path.join(dir, 'node_modules', 'lib');
      fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'patches'));
      fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: '1.0.0' }));
      fs.writeFileSync(path.join(pkg, 'src', 'Client.js'), FILE);
      fs.writeFileSync(path.join(dir, 'patches', 'lib+1.0.0+fix.diff'), DIFF);
      fs.writeFileSync(path.join(dir, 'patches', 'lib+2.0.0+other.diff'), DIFF);
      fs.writeFileSync(path.join(dir, 'patches', 'lib+1.0.0+out.diff'), DIFF.replace(/src\/Client\.js/g, '../../outside.js'));
      assert.deepEqual(patchName('lib+1.0.0+fix.diff'), { pkg: 'lib', version: '1.0.0', what: 'fix' });
      const done = applyPatches(path.join(dir, 'patches'), path.join(dir, 'node_modules'));
      assert.deepEqual(done.map((d) => [d.name, d.state]), [['lib+1.0.0+fix.diff', 'applied'], ['lib+1.0.0+out.diff', 'failed'], ['lib+2.0.0+other.diff', 'skipped']]);
      assert.match(fs.readFileSync(path.join(pkg, 'src', 'Client.js'), 'utf8'), /fresh\(\)/);
      assert.equal(applyPatches(path.join(dir, 'patches'), path.join(dir, 'node_modules'))[0].state, 'already');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ---------- The server between the app and the bridge ---------- */

describe('whatsapp through the server', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-wa-'));
  const config = loadConfig({ DATA_DIR: dir, ALLOWED_ORIGINS: 'https://app.example' });
  const store = openStore(dir, { keepBackups: 2 });
  const pairing = createPairing();
  const events = createEvents({ pingMs: 200 });
  const SECRET = 'bridge-secret';
  const FILE_BYTES = Buffer.from('0123456789');
  /** What the bridge was asked (a test's bridge: it plays WhatsApp Web). */
  const asked = [];
  let bridgeStreams = [];
  let state = { phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '2.3000', error: '', chats: 2, unread: 1 };
  let bridge;
  let server;
  let wa;
  let base = '';
  let token = '';
  let device = '';
  let mediaKey = '';

  before(async () => {
    bridge = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://local');
      if (req.headers['x-bridge'] !== SECRET) {
        res.writeHead(403);
        return res.end('{}');
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      asked.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), type: req.headers['content-type'], range: req.headers.range, body });
      const json = (b, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(b));
      };
      if (url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ t: 'state', state })}\n\n`);
        bridgeStreams.push(res);
        return undefined;
      }
      if (url.pathname === '/status' || url.pathname === '/start' || url.pathname === '/restart') return json(state);
      if (url.pathname === '/logout') {
        state = { ...state, phase: 'off', linked: false, me: null };
        return json(state);
      }
      if (url.pathname === '/chats') return json({ chats: [{ id: '971501234567@c.us', name: 'Ali' }], total: 1, unread: 1 });
      if (url.pathname === '/messages') return json({ messages: [{ id: 'false_971501234567@c.us_AA1', text: 'Hello' }], more: false });
      if (url.pathname === '/send') return json({ ok: true, msg: { id: 'true_971501234567@c.us_BB1', text: JSON.parse(body).text } });
      if (url.pathname === '/file') return json({ ok: true, msg: { id: 'true_971501234567@c.us_BB2' }, size: body.length });
      if (url.pathname === '/number') return json({ ok: true, chat: '971501234567@c.us' });
      if (url.pathname === '/media') {
        if (url.searchParams.get('id') === 'gone') return json({ ok: false, error: 'the file is no longer on WhatsApp' }, 404);
        const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
        if (m) {
          res.writeHead(206, { 'Content-Type': 'image/jpeg', 'Content-Range': `bytes ${m[1]}-${m[2]}/${FILE_BYTES.length}`, 'Content-Length': Number(m[2]) - Number(m[1]) + 1, 'Accept-Ranges': 'bytes' });
          return res.end(FILE_BYTES.subarray(Number(m[1]), Number(m[2]) + 1));
        }
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': FILE_BYTES.length, 'X-File-Name': 'photo.jpg' });
        return res.end(FILE_BYTES);
      }
      return json({ ok: false, error: 'not found' }, 404);
    });
    await new Promise((r) => bridge.listen(0, '127.0.0.1', r));
    wa = createWhatsApp({ config, store, events, bridge: { url: `http://127.0.0.1:${bridge.address().port}`, secret: SECRET } });
    wa.start();
    server = createServer(createApi({ store, config, pairing, log: () => {}, onSeen: () => {}, events, wa }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    const code = pairing.issue().code;
    const paired = await (await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'X-Sync': '2', 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: 'Test phone', install: 'i1' }) })).json();
    token = paired.token;
    device = paired.deviceId;
    mediaKey = paired.mediaKey;
  });
  after(() => {
    wa.stop();
    for (const s of bridgeStreams) s.destroy();
    events.closeAll();
    server.close();
    bridge.closeAllConnections?.();
    bridge.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const call = (p, { method = 'GET', body, headers = {}, auth = true } = {}) =>
    fetch(base + p, {
      method,
      headers: { 'X-Sync': '2', ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
    });

  it('only a paired device asks', async () => {
    assert.equal((await call('/api/wa/status', { auth: false })).status, 401);
    assert.equal((await call('/api/wa/chats', { auth: false })).status, 401);
  });

  it('not linked: the state is said, nothing else is answered', async () => {
    const s = await (await call('/api/wa/status')).json();
    assert.equal(s.available, true);
    assert.equal(s.on, false);
    const r = await call('/api/wa/chats');
    assert.equal(r.status, 409);
  });

  it('linked: the bridge is asked with the secret, the answer comes back', async () => {
    const s = await (await call('/api/wa/link', { method: 'POST' })).json();
    assert.equal(s.on, true);
    assert.equal(s.phase, 'ready');
    assert.equal(s.me.phone, '971500000001');
    assert.equal(store.metaGet('whatsapp'), 'on');
    const chats = await (await call('/api/wa/chats?limit=50&x=1')).json();
    assert.equal(chats.chats[0].name, 'Ali');
    // Only the words the bridge knows go through.
    assert.deepEqual(asked.at(-1).query, { limit: '50' });
    const msgs = await (await call(`/api/wa/messages?chat=${encodeURIComponent('971501234567@c.us')}&limit=40`)).json();
    assert.equal(msgs.messages[0].text, 'Hello');
    assert.deepEqual(asked.at(-1).query, { chat: '971501234567@c.us', limit: '40' });
  });

  it('a text and a file are sent', async () => {
    const sent = await (await call('/api/wa/send', { method: 'POST', body: { chat: '971501234567@c.us', text: 'Ready', extra: 'no' } })).json();
    assert.equal(sent.msg.text, 'Ready');
    assert.deepEqual(JSON.parse(asked.at(-1).body), { chat: '971501234567@c.us', text: 'Ready' });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const r = await call(`/api/wa/file?chat=${encodeURIComponent('971501234567@c.us')}&name=${encodeURIComponent('INV 319.pdf')}&caption=${encodeURIComponent('Invoice')}`, { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/pdf' } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).size, 5);
    const last = asked.at(-1);
    assert.equal(last.type, 'application/pdf');
    assert.deepEqual(last.query, { chat: '971501234567@c.us', name: 'INV 319.pdf', caption: 'Invoice' });
    assert.deepEqual([...last.body], [1, 2, 3, 4, 5]);
  });

  it("a message's file: by the device's key, or by its media key for a picture element — in parts when asked", async () => {
    const whole = await call('/api/wa/media?id=x1');
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-type'), 'image/jpeg');
    assert.equal(whole.headers.get('x-file-name'), 'photo.jpg');
    assert.equal(Buffer.from(await whole.arrayBuffer()).toString(), '0123456789');
    const part = await fetch(`${base}/api/wa/media?id=x1&d=${device}&k=${mediaKey}`, { headers: { Range: 'bytes=2-5' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(part.headers.get('access-control-allow-origin'), '*');
    assert.equal(Buffer.from(await part.arrayBuffer()).toString(), '2345');
    assert.equal((await fetch(`${base}/api/wa/media?id=x1&d=${device}&k=wrong`)).status, 401);
    const gone = await call('/api/wa/media?id=gone');
    assert.equal(gone.status, 404);
  });

  it('what WhatsApp says reaches the device on its open stream', async () => {
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/sync/events`, { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const next = async (want) => {
      for (;;) {
        const i = buf.indexOf('\n\n');
        if (i >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (data) {
            const j = JSON.parse(data);
            if (want(j)) return j;
          }
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        buf += dec.decode(value, { stream: true });
      }
    };
    // (the server's own first word: the data's last change)
    await next((j) => 'rev' in j);
    for (const s of bridgeStreams) s.write(`data: ${JSON.stringify({ t: 'msg', msg: { id: 'false_971501234567@c.us_CC1', chat: '971501234567@c.us', text: 'Hi' }, chat: { id: '971501234567@c.us', unread: 1 } })}\n\n`);
    const got = await next((j) => j.wa?.t === 'msg');
    assert.equal(got.wa.msg.text, 'Hi');
    assert.equal(got.rev, undefined);
    ctl.abort();
  });

  it('unlinked: off again, and nothing more is answered', async () => {
    const s = await (await call('/api/wa/logout', { method: 'POST' })).json();
    assert.equal(s.on, false);
    assert.equal(store.metaGet('whatsapp'), 'off');
    assert.equal((await call('/api/wa/chats')).status, 409);
    assert.equal((await fetch(`${base}/api/wa/media?id=x1&d=${device}&k=${mediaKey}`)).status, 503);
  });

  it('a server without the bridge installed says so', async () => {
    const none = createWhatsApp({ config, store, events, dir: path.join(dir, 'nowhere') });
    assert.equal(none.status().installed, false);
    assert.equal(none.status().available, false);
    assert.equal(none.status().phase, 'off');
    none.stop();
  });
});
