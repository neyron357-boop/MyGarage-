import assert from 'node:assert/strict';
import fs from 'node:fs';
import http, { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApi, createPairing } from '../src/api.mjs';
import { loadConfig } from '../src/config.mjs';
import { createEvents } from '../src/events.mjs';
import { createRelay } from '../src/relay.mjs';
import { openStore } from '../src/store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-server-'));
const config = loadConfig({ DATA_DIR: dir, ALLOWED_ORIGINS: 'https://app.example' });
const store = openStore(dir, { keepBackups: 2 });
const pairing = createPairing();
const events = createEvents({ pingMs: 200, holdMs: 300 });
// Where the address is left (v0.42.2): nothing goes out of this test.
const relay = createRelay({ store, base: 'http://127.0.0.1:9/relay', fetchImpl: async () => new Response('{}') });
let base = '';
let server;

before(async () => {
  server = createServer(createApi({ store, config, pairing, log: () => {}, onSeen: () => {}, events, relay }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  relay.stop();
  events.closeAll();
  server.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = (p, { token, method = 'GET', body, headers = {} } = {}) =>
  fetch(base + p, {
    method,
    headers: { 'X-Sync': '2', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });

async function pair(name) {
  const { code } = pairing.issue();
  const r = await call('/api/pair', { method: 'POST', body: { code, name, install: `install-${name.replace(/W/g, '')}-${Math.random().toString(36).slice(2, 10)}` } });
  assert.equal(r.status, 200);
  return (await r.json()).token;
}

describe('MyGarage server', () => {
  let a;
  let b;

  it('answers health without a key, everything else only with one', async () => {
    assert.equal((await call('/api/health')).status, 200);
    assert.equal((await call('/api/status')).status, 401);
    assert.equal((await call('/api/status', { token: 'nope' })).status, 401);
  });

  it('pairs with the code shown on the computer — once; a wrong code is refused', async () => {
    pairing.issue();
    assert.equal((await call('/api/pair', { method: 'POST', body: { code: '000000x', name: 'x' } })).status, 403);
    a = await pair('iPhone');
    b = await pair('PC');
    const { code } = pairing.issue();
    await call('/api/pair', { method: 'POST', body: { code, name: 'c' } });
    assert.equal((await call('/api/pair', { method: 'POST', body: { code, name: 'again' } })).status, 403);
    assert.equal((await call('/api/status', { token: a })).status, 200);
  });

  it('one device’s changes reach the other; its own do not come back to it', async () => {
    const r = await call('/api/sync/push', {
      token: a,
      method: 'POST',
      body: {
        changes: [
          { t: 'orders', k: 'o1', d: { id: 'o1', number: 1001, stage: 'diagnosis' } },
          { t: 'customers', k: 'c1', d: { id: 'c1', name: 'Ahmed' } },
        ],
      },
    });
    assert.equal(r.status, 200);
    const pb = await (await call('/api/sync/pull?since=0', { token: b })).json();
    assert.deepEqual(
      pb.changes.map((c) => [c.t, c.k]),
      [
        ['orders', 'o1'],
        ['customers', 'c1'],
      ],
    );
    assert.equal(pb.more, false);
    const pa = await (await call('/api/sync/pull?since=0', { token: a })).json();
    assert.equal(pa.changes.length, 0);
    assert.equal(pa.cursor, pb.cursor);
  });

  it('a deletion goes as a tombstone; the last write wins', async () => {
    const since = (await (await call('/api/sync/pull?since=0', { token: b })).json()).cursor;
    await call('/api/sync/push', { token: b, method: 'POST', body: { changes: [{ t: 'orders', k: 'o1', d: { id: 'o1', number: 1001, stage: 'work' } }] } });
    await call('/api/sync/push', { token: a, method: 'POST', body: { changes: [{ t: 'customers', k: 'c1', d: null }] } });
    const pb = await (await call(`/api/sync/pull?since=${since}`, { token: b })).json();
    assert.deepEqual(pb.changes, [{ r: pb.changes[0].r, t: 'customers', k: 'c1', d: null }]);
    assert.equal(store.record('orders', 'o1').stage, 'work');
    assert.equal(store.record('customers', 'c1'), undefined);
  });

  it('v0.98: a piece of work goes to the first device that claims it; asked again — still that one’s', async () => {
    const claim = async (token, key) => (await call('/api/claim', { token, method: 'POST', body: { key } })).json();
    assert.deepEqual(await claim(a, 'request:chat-1:msg-1'), { ok: true, mine: true });
    assert.deepEqual(await claim(b, 'request:chat-1:msg-1'), { ok: true, mine: false });
    assert.deepEqual(await claim(a, 'request:chat-1:msg-1'), { ok: true, mine: true });
    assert.deepEqual(await claim(b, 'request:chat-1:msg-2'), { ok: true, mine: true });
    assert.equal((await call('/api/claim', { token: a, method: 'POST', body: {} })).status, 400);
    assert.equal((await call('/api/claim', { method: 'POST', body: { key: 'x' } })).status, 401);
  });

  it('a job’s number only goes up — a device behind gets the higher one', async () => {
    await call('/api/sync/push', { token: a, method: 'POST', body: { changes: [{ t: 'counters', k: 'invoice', d: { name: 'invoice', value: 12 } }] } });
    const since = (await (await call('/api/sync/pull?since=0', { token: b })).json()).cursor;
    await call('/api/sync/push', { token: b, method: 'POST', body: { changes: [{ t: 'counters', k: 'invoice', d: { name: 'invoice', value: 7 } }] } });
    assert.equal(store.record('counters', 'invoice').value, 12);
    const pb = await (await call(`/api/sync/pull?since=${since}`, { token: b })).json();
    assert.equal(pb.changes.find((c) => c.t === 'counters')?.d.value, 12);
  });

  it('pulls in pages', async () => {
    const changes = Array.from({ length: 30 }, (_, i) => ({ t: 'events', k: `e${i}`, d: { id: `e${i}` } }));
    await call('/api/sync/push', { token: a, method: 'POST', body: { changes } });
    const first = await (await call('/api/sync/pull?since=0&limit=10', { token: b })).json();
    assert.equal(first.changes.length, 10);
    assert.equal(first.more, true);
    const next = await (await call(`/api/sync/pull?since=${first.cursor}&limit=1000`, { token: b })).json();
    assert.ok(next.changes.every((c) => c.r > first.cursor));
  });

  it('keeps a photo’s files and gives them back; a size that does not match is refused', async () => {
    await call('/api/sync/push', { token: a, method: 'POST', body: { changes: [{ t: 'media', k: 'm1', d: { id: 'm1', kind: 'photo', mime: 'image/jpeg', createdAt: '2026-11-17T10:00:00.000Z' } }] } });
    const bytes = new Uint8Array([255, 216, 255, 1, 2, 3, 4]);
    const put = await call('/api/media/m1/blob', { token: a, method: 'PUT', body: bytes, headers: { 'Content-Type': 'image/jpeg', 'X-Size': '7' } });
    assert.equal(put.status, 200);
    const info = await put.json();
    assert.equal(info.size, 7);
    assert.ok(fs.existsSync(path.join(dir, 'Фото и видео', '2026-11', 'm1.jpg')));
    const got = new Uint8Array(await (await call('/api/media/m1/blob', { token: b })).arrayBuffer());
    assert.deepEqual([...got], [...bytes]);
    assert.equal((await call('/api/media/m1/blob', { token: a, method: 'PUT', body: bytes, headers: { 'Content-Type': 'image/jpeg', 'X-Size': '99' } })).status, 400);
    assert.equal((await call('/api/media/zz/blob', { token: a })).status, 404);
    assert.equal((await call('/api/media/m1/blob')).status, 401);
  });

  it('an invoice’s PDF is also kept under «Документы/Инвойсы/<month>» by its own name', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4 test');
    await call('/api/media/p1/blob', { token: a, method: 'PUT', body: pdf, headers: { 'Content-Type': 'application/pdf', 'X-Size': String(pdf.length) } });
    await call('/api/sync/push', {
      token: a,
      method: 'POST',
      body: { changes: [{ t: 'media', k: 'p1', d: { id: 'p1', kind: 'pdf', mime: 'application/pdf', ownerType: 'invoice', name: 'INV-2026-00001 - Toyota Camry - Dubai Q 52594.pdf', createdAt: '2026-11-17T10:00:00.000Z' } }] },
    });
    assert.ok(fs.existsSync(path.join(dir, 'Документы', 'Инвойсы', '2026-11', 'INV-2026-00001 - Toyota Camry - Dubai Q 52594.pdf')));
  });

  it('answers the app’s own address only (CORS)', async () => {
    const ok = await fetch(`${base}/api/status`, { method: 'OPTIONS', headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example');
    const no = await fetch(`${base}/api/status`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(no.status, 403);
  });

  it('copies the database once a day, keeping the last ones', () => {
    assert.equal(store.backup(), true);
    assert.equal(store.backup(), false);
    assert.equal(fs.readdirSync(path.join(dir, 'Резервные копии')).length, 1);
  });

  it('a device listening is told at once when another device’s changes are kept — not of its own', async () => {
    const listen = async (token) => {
      const ctl = new AbortController();
      const res = await fetch(base + '/api/sync/events', { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /^text\/event-stream/);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const got = [];
      const pump = (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const data = block.split('\n').find((l) => l.startsWith('data:'));
              got.push(data ? JSON.parse(data.slice(5)) : { ping: true });
            }
          }
        } catch {
          // closed
        }
      })();
      return { got, stop: () => (ctl.abort(), pump) };
    };
    const one = await pair('Listener A');
    const two = await pair('Listener B');
    const a1 = await listen(one);
    const b1 = await listen(two);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(typeof a1.got[0].rev, 'number');
    const t0 = Date.now();
    const pushed = await (await call('/api/sync/push', { token: two, method: 'POST', body: { changes: [{ t: 'orders', k: 'live-1', d: { id: 'live-1' } }] } })).json();
    while (!a1.got.some((e) => e.rev === pushed.rev) && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 5));
    assert.ok(a1.got.some((e) => e.rev === pushed.rev), 'the other device was told');
    assert.ok(Date.now() - t0 < 500, `told in ${Date.now() - t0} ms`);
    assert.ok(!b1.got.some((e) => e.rev === pushed.rev), 'not told of its own');
    // An idle stream is kept alive (comments).
    await new Promise((r) => setTimeout(r, 450));
    assert.ok(a1.got.some((e) => e.ping));
    // A device cut off: its stream ends.
    store.revoke(store.devices().find((d) => d.name === 'Listener A').id);
    events.drop(store.devices().find((d) => d.name === 'Listener A').id);
    assert.equal(events.live().size, 1);
    await a1.stop();
    await b1.stop();
  });

  it('v0.88: a device that cannot keep a stream (a Cloudflare quick tunnel) asks — answered the moment something is said', async () => {
    const one = await pair('Asker A');
    const two = await pair('Asker B');
    const ask = async (token, q = '') => {
      const t0 = Date.now();
      const res = await call(`/api/sync/poll${q}`, { token });
      assert.equal(res.status, 200);
      return { ...(await res.json()), ms: Date.now() - t0 };
    };
    // The first ask: answered at once with the data's number, and what to ask after next.
    const first = await ask(one);
    assert.equal(typeof first.events[0].rev, 'number');
    assert.ok(first.boot && Number.isInteger(first.seq));
    assert.ok(!first.gap);
    // Asked after it: nothing yet — waits; another device's change — answered at once (not to the device that made it).
    const waiting = ask(one, `?after=${first.seq}&boot=${first.boot}`);
    const own = ask(two, `?after=${first.seq}&boot=${first.boot}`);
    await new Promise((r) => setTimeout(r, 30));
    const pushed = await (await call('/api/sync/push', { token: two, method: 'POST', body: { changes: [{ t: 'orders', k: 'ask-1', d: { id: 'ask-1' } }] } })).json();
    const told = await waiting;
    assert.deepEqual(told.events, [{ rev: pushed.rev }]);
    assert.ok(told.ms < 250, `answered in ${told.ms} ms`);
    // Its own change is not said to it: its ask ends in its time with nothing.
    const quiet = await own;
    assert.deepEqual(quiet.events, []);
    // Said while nobody asked: given at the next ask, a burst together.
    events.tell({ wa: { t: 'ack', id: 'x', ack: 1 } });
    events.tell({ wa: { t: 'ack', id: 'x', ack: 2 } });
    const later = await ask(one, `?after=${told.seq}&boot=${told.boot}`);
    assert.deepEqual(later.events, [{ wa: { t: 'ack', id: 'x', ack: 1 } }, { wa: { t: 'ack', id: 'x', ack: 2 } }]);
    // Another run of the server (or more went by than is kept): the data's number, and the device reads again.
    const lost = await ask(one, `?after=${later.seq}&boot=other`);
    assert.equal(lost.gap, true);
    assert.equal(typeof lost.events[0].rev, 'number');
    // Asking — it is listening.
    assert.ok(events.live().has(store.devices().find((d) => d.name === 'Asker A').id));
  });

  it('the main device’s data becomes the garage’s: what it lacks is deleted for everyone, its numbers taken as they are', async () => {
    const pc = await pair('PC demo');
    await call('/api/sync/push', { token: pc, method: 'POST', body: { changes: [{ t: 'orders', k: 'demo-1', d: { id: 'demo-1', number: 1001 } }, { t: 'counters', k: 'order', d: { name: 'order', value: 1008 } }] } });
    const phone = await pair('iPhone 2');
    // Its jobs: its own (from 350, v0.42.3) and one that is an Eaglecart job, with Eaglecart's number.
    await call('/api/sync/push', { token: phone, method: 'POST', body: { changes: [{ t: 'orders', k: 'real-1', d: { id: 'real-1', number: 357 } }, { t: 'orders', k: 'real-2', d: { id: 'real-2', number: 302, eaglecartNo: 302 } }] } });
    const keys = { orders: ['real-1', 'real-2'] };
    const r = await call('/api/sync/replace', { token: phone, method: 'POST', body: { keys, counters: [{ name: 'order', value: 357 }] } });
    assert.equal(r.status, 200);
    assert.equal(store.record('orders', 'demo-1'), undefined);
    assert.equal(store.record('orders', 'real-1').number, 357);
    assert.equal(store.record('orders', 'real-2').number, 302);
    assert.equal(store.record('counters', 'order').value, 357);
    assert.equal(store.mainDevice().name, 'iPhone 2');
    // The other device is told: the demo order goes, the lower number comes (marked to be taken).
    const got = await (await call('/api/sync/pull?since=0', { token: pc })).json();
    assert.deepEqual(got.changes.find((c) => c.k === 'demo-1').d, null);
    assert.deepEqual(got.changes.find((c) => c.t === 'counters' && c.k === 'order').d, { name: 'order', value: 357, reset: true });
    assert.equal(got.main.name, 'iPhone 2');
    // Only the main device may do it again.
    assert.equal((await call('/api/sync/replace', { token: pc, method: 'POST', body: { keys: {} } })).status, 409);
    assert.equal((await (await call('/api/status', { token: pc })).json()).main.name, 'iPhone 2');
    // A device that leaves: its key no longer works; the main one gone — no main device.
    assert.equal((await call('/api/forget', { token: phone, method: 'POST' })).status, 200);
    assert.equal((await call('/api/status', { token: phone })).status, 401);
    assert.equal(store.mainDevice(), null);
  });

  it('a copy (taken from the server, never changed) never brings back a deletion or overrides; a new one is kept', async () => {
    const x = await pair('Copy A');
    const y = await pair('Copy B');
    await call('/api/sync/push', { token: x, method: 'POST', body: { changes: [{ t: 'orders', k: 'cp-1', d: { id: 'cp-1', v: 1 } }] } });
    await call('/api/sync/push', { token: x, method: 'POST', body: { changes: [{ t: 'orders', k: 'cp-1', d: null }, { t: 'orders', k: 'cp-2', d: { id: 'cp-2', v: 2 } }] } });
    await call('/api/sync/push', {
      token: y,
      method: 'POST',
      body: { changes: [{ t: 'orders', k: 'cp-1', d: { id: 'cp-1', v: 1 }, c: 1 }, { t: 'orders', k: 'cp-2', d: { id: 'cp-2', v: 1 }, c: 1 }, { t: 'orders', k: 'cp-3', d: { id: 'cp-3', v: 1 }, c: 1 }] },
    });
    assert.equal(store.record('orders', 'cp-1'), undefined);
    assert.equal(store.record('orders', 'cp-2').v, 2);
    assert.equal(store.record('orders', 'cp-3').v, 1);
  });

  it('the same app paired again is the same device: its old key stops, the main one stays the main one', async () => {
    const { code } = pairing.issue();
    const first = await (await call('/api/pair', { method: 'POST', body: { code, name: 'iPhone R', install: 'install-0123456789ab' } })).json();
    assert.equal(first.rejoined, false);
    await call('/api/sync/replace', { token: first.token, method: 'POST', body: { keys: {} } });
    assert.equal(store.mainDevice().id, first.deviceId);
    const again = pairing.issue();
    const second = await (await call('/api/pair', { method: 'POST', body: { code: again.code, name: 'iPhone R', install: 'install-0123456789ab' } })).json();
    assert.equal(second.rejoined, true);
    assert.equal(second.main.id, second.deviceId);
    assert.equal((await call('/api/status', { token: first.token })).status, 401);
    assert.equal((await call('/api/status', { token: second.token })).status, 200);
    // Another app is not taken for it.
    const other = pairing.issue();
    const third = await (await call('/api/pair', { method: 'POST', body: { code: other.code, name: 'iPhone R', install: 'install-ffffffffffff' } })).json();
    assert.equal(third.rejoined, false);
    assert.equal(store.mainDevice().id, second.deviceId);
  });

  it('a photo’s card is kept beside it; a file is given in parts; a picture’s own address (media key) reads files only', async () => {
    const { code } = pairing.issue();
    const paired = await (await call('/api/pair', { method: 'POST', body: { code, name: 'Viewer', install: 'install-viewer-123456' } })).json();
    const t = paired.token;
    assert.equal(typeof paired.mediaKey, 'string');
    const bytes = new Uint8Array(5000).map((_, i) => i % 251);
    await call('/api/sync/push', { token: t, method: 'POST', body: { changes: [{ t: 'media', k: 'pic-1', d: { id: 'pic-1', kind: 'photo', mime: 'image/jpeg', createdAt: '2026-11-18T06:00:00.000Z' } }] } });
    for (const v of ['blob', 'card']) {
      const r = await call(`/api/media/pic-1/${v}`, { token: t, method: 'PUT', body: v === 'card' ? bytes.slice(0, 1200) : bytes, headers: { 'Content-Type': 'image/jpeg', 'X-Size': String(v === 'card' ? 1200 : 5000) } });
      assert.equal(r.status, 200);
    }
    assert.equal((await (await call('/api/media/pic-1/card', { token: t })).arrayBuffer()).byteLength, 1200);
    // In parts: the first 100 bytes, the last 10, an address past the end.
    const part = await call('/api/media/pic-1/blob', { token: t, headers: { Range: 'bytes=0-99' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 0-99/5000');
    assert.deepEqual(new Uint8Array(await part.arrayBuffer()), bytes.slice(0, 100));
    const tail = await call('/api/media/pic-1/blob', { token: t, headers: { Range: 'bytes=-10' } });
    assert.deepEqual(new Uint8Array(await tail.arrayBuffer()), bytes.slice(4990));
    assert.equal((await call('/api/media/pic-1/blob', { token: t, headers: { Range: 'bytes=9000-' } })).status, 416);
    // By the address with the media key (no device key): files only, and only while the device is connected.
    const own = `/api/media/pic-1/blob?d=${paired.deviceId}&k=${paired.mediaKey}`;
    const r = await fetch(base + own);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('accept-ranges'), 'bytes');
    assert.equal((await r.arrayBuffer()).byteLength, 5000);
    assert.equal((await fetch(base + `/api/media/pic-1/blob?d=${paired.deviceId}&k=wrong`)).status, 401);
    assert.equal((await fetch(base + `/api/status?d=${paired.deviceId}&k=${paired.mediaKey}`)).status, 401);
    store.revoke(paired.deviceId);
    assert.equal((await fetch(base + own)).status, 401);
  });

  it('a device that stops listening mid-file does not stop the server (v0.42.1)', async () => {
    const { code } = pairing.issue();
    const paired = await (await call('/api/pair', { method: 'POST', body: { code, name: 'Leaver', install: 'install-leaver-123456' } })).json();
    const t = paired.token;
    // A video's size: more than the connection holds, so the server is still sending when the device goes.
    const big = new Uint8Array(24 * 1024 * 1024).fill(7);
    await call('/api/sync/push', { token: t, method: 'POST', body: { changes: [{ t: 'media', k: 'vid-1', d: { id: 'vid-1', kind: 'video', mime: 'video/mp4', createdAt: '2026-11-18T07:00:00.000Z' } }] } });
    assert.equal((await call('/api/media/vid-1/blob', { token: t, method: 'PUT', body: big, headers: { 'Content-Type': 'video/mp4', 'X-Size': String(big.length) } })).status, 200);
    const stray = [];
    const onStray = (e) => stray.push(e);
    process.on('unhandledRejection', onStray);
    try {
      // Whole, and in parts (a video element): the first piece read, then the device gone.
      for (const range of [undefined, 'bytes=0-']) {
        await new Promise((resolve) => {
          const req = http.get(`${base}/api/media/vid-1/blob?d=${paired.deviceId}&k=${paired.mediaKey}`, { headers: range ? { Range: range } : {} }, (res) => {
            res.once('data', () => {
              req.destroy();
              resolve();
            });
          });
          req.on('error', () => resolve());
        });
      }
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      process.off('unhandledRejection', onStray);
    }
    assert.deepEqual(stray.map((e) => String(e?.code ?? e)), []);
    assert.equal((await call('/api/health')).status, 200);
    const again = await call('/api/media/vid-1/blob', { token: t, headers: { Range: 'bytes=0-9' } });
    assert.equal(again.status, 206);
  });

  it('pairing, the status and each sync tell the device where the server leaves its address (v0.42.2)', async () => {
    const { code } = pairing.issue();
    const paired = await (await call('/api/pair', { method: 'POST', body: { code, name: 'Finder', install: 'install-finder-123456' } })).json();
    assert.deepEqual(paired.relay, { url: 'http://127.0.0.1:9/relay' });
    assert.deepEqual((await (await call('/api/status', { token: paired.token })).json()).relay, relay.info());
    assert.deepEqual((await (await call('/api/sync/pull?since=0', { token: paired.token })).json()).relay, relay.info());
  });

  it('an older app is told to update: it may not connect or send', async () => {
    const { code } = pairing.issue();
    const pairOld = await call('/api/pair', { method: 'POST', body: { code, name: 'old' }, headers: { 'X-Sync': '' } });
    assert.equal(pairOld.status, 426);
    assert.match((await pairOld.json()).error, /Обновите приложение/);
    const t = await pair('New app');
    const pushOld = await call('/api/sync/push', { token: t, method: 'POST', body: { changes: [] }, headers: { 'X-Sync': '' } });
    assert.equal(pushOld.status, 426);
    assert.equal((await call('/api/sync/push', { token: t, method: 'POST', body: { changes: [] } })).status, 200);
  });

  it('a device cut off on the computer is refused', async () => {
    const id = store.devices().find((d) => d.name === 'PC').id;
    store.revoke(id);
    assert.equal((await call('/api/status', { token: b })).status, 401);
  });
});
