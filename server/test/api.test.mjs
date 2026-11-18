import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApi, createPairing } from '../src/api.mjs';
import { loadConfig } from '../src/config.mjs';
import { openStore } from '../src/store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-server-'));
const config = loadConfig({ DATA_DIR: dir, ALLOWED_ORIGINS: 'https://app.example' });
const store = openStore(dir, { keepBackups: 2 });
const pairing = createPairing();
let base = '';
let server;

before(async () => {
  server = createServer(createApi({ store, config, pairing, log: () => {}, onSeen: () => {} }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = (p, { token, method = 'GET', body, headers = {} } = {}) =>
  fetch(base + p, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });

async function pair(name) {
  const { code } = pairing.issue();
  const r = await call('/api/pair', { method: 'POST', body: { code, name } });
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

  it('the main device’s data becomes the garage’s: what it lacks is deleted for everyone, its numbers taken as they are', async () => {
    const pc = await pair('PC demo');
    await call('/api/sync/push', { token: pc, method: 'POST', body: { changes: [{ t: 'orders', k: 'demo-1', d: { id: 'demo-1', number: 1001 } }, { t: 'counters', k: 'order', d: { name: 'order', value: 1008 } }] } });
    const phone = await pair('iPhone 2');
    await call('/api/sync/push', { token: phone, method: 'POST', body: { changes: [{ t: 'orders', k: 'real-1', d: { id: 'real-1', number: 307 } }] } });
    const keys = { orders: ['real-1'] };
    const r = await call('/api/sync/replace', { token: phone, method: 'POST', body: { keys, counters: [{ name: 'order', value: 307 }] } });
    assert.equal(r.status, 200);
    assert.equal(store.record('orders', 'demo-1'), undefined);
    assert.equal(store.record('orders', 'real-1').number, 307);
    assert.equal(store.record('counters', 'order').value, 307);
    assert.equal(store.mainDevice().name, 'iPhone 2');
    // The other device is told: the demo order goes, the lower number comes (marked to be taken).
    const got = await (await call('/api/sync/pull?since=0', { token: pc })).json();
    assert.deepEqual(got.changes.find((c) => c.k === 'demo-1').d, null);
    assert.deepEqual(got.changes.find((c) => c.t === 'counters' && c.k === 'order').d, { name: 'order', value: 307, reset: true });
    assert.equal(got.main.name, 'iPhone 2');
    // Only the main device may do it again.
    assert.equal((await call('/api/sync/replace', { token: pc, method: 'POST', body: { keys: {} } })).status, 409);
    assert.equal((await (await call('/api/status', { token: pc })).json()).main.name, 'iPhone 2');
    // A device that leaves: its key no longer works; the main one gone — no main device.
    assert.equal((await call('/api/forget', { token: phone, method: 'POST' })).status, 200);
    assert.equal((await call('/api/status', { token: phone })).status, 401);
    assert.equal(store.mainDevice(), null);
  });

  it('a device cut off on the computer is refused', async () => {
    const id = store.devices().find((d) => d.name === 'PC').id;
    store.revoke(id);
    assert.equal((await call('/api/status', { token: b })).status, 401);
  });
});
