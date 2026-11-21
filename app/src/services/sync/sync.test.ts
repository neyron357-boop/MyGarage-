import 'fake-indexeddb/auto';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createServer as httpServer, type Server } from 'node:http';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../../db/db';
import { addItem } from '../estimate';
import { addMedia, mediaBlob } from '../media';
import { checkIn } from '../orders';
import { ensureSeed } from '../seed';
import { forgetSyncMemory, installId, resetSyncState, restoreInstallId, setSyncConfig, syncConfig, syncState, type SyncConfig, type SyncState } from './config';
import { SyncError } from './api';
import { applyChanges, changeServerAddress, eventRev, findServer, finishPairing, lastingError, makeMain, pairDevice, syncNow } from './engine';

/*
 * Two devices and the garage's own server (server/src/main.mjs, started here as it runs on the computer): what one
 * does reaches the other — records, deletions, photos (which leave the phone once the server has them and come back
 * from it when opened).
 */

const main = path.resolve(__dirname, '../../../../server/src/main.mjs');
let proc: ChildProcess | undefined;
let url = '';
let admin = '';
let dataDir = '';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

/** What the server keeps, read from its own database file. */
const store = {
  record(t: string, id: string): Record<string, unknown> | undefined {
    const d = new DatabaseSync(path.join(dataDir, 'Служебное', 'garage.db'), { readOnly: true });
    try {
      const row = d.prepare('SELECT data, deleted FROM records WHERE tbl = ? AND id = ?').get(t, id) as { data: string; deleted: number } | undefined;
      return row && !row.deleted ? (JSON.parse(row.data) as Record<string, unknown>) : undefined;
    } finally {
      d.close();
    }
  },
  file(id: string, variant: string): { size: number } | undefined {
    const d = new DatabaseSync(path.join(dataDir, 'Служебное', 'garage.db'), { readOnly: true });
    try {
      return d.prepare('SELECT size FROM files WHERE id = ? AND variant = ?').get(id, variant) as { size: number } | undefined;
    } finally {
      d.close();
    }
  },
};
/** A pairing code, as this computer's page gives it. */
/**
 * The relay where the server leaves its address (v0.42.2) — here, not ntfy.sh: what is posted to a topic, and its
 * messages read back the way ntfy gives them.
 */
let relayServer: Server | undefined;
let relayBase = '';
const relayTopics = new Map<string, string[]>();
const startRelay = async () => {
  relayServer = httpServer((req, res) => {
    const parts = new URL(req.url ?? '/', 'http://relay').pathname.split('/').filter(Boolean);
    const topic = parts[0] ?? '';
    if (req.method === 'POST' && parts.length === 1) {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString('utf8')));
      req.on('end', () => {
        relayTopics.set(topic, [...(relayTopics.get(topic) ?? []), body]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
      return;
    }
    if (req.method === 'GET' && parts[1] === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end((relayTopics.get(topic) ?? []).map((message, i) => `${JSON.stringify({ id: String(i), time: i, event: 'message', topic, message })}
`).join(''));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => relayServer!.listen(0, '127.0.0.1', () => r()));
  relayBase = `http://127.0.0.1:${(relayServer.address() as { port: number }).port}`;
};
/** A device's channel on the relay, as the server makes it from the hash of the device's key (server/src/relay.mjs). */
const channelOf = (token: string) => {
  const h = Buffer.from(crypto.createHash('sha256').update(token).digest('hex'), 'utf8');
  return {
    topic: crypto.createHmac('sha256', h).update('mygarage relay topic').digest('base64url').slice(0, 24),
    key: crypto.createHmac('sha256', h).update('mygarage relay key').digest('base64url'),
  };
};
/** An address sealed as the server seals it (server/src/relay.mjs). */
const seal = (key: string, topic: string, u: string, t: number) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), iv);
  c.setAAD(Buffer.from(topic, 'utf8'));
  const body = Buffer.concat([c.update(JSON.stringify({ u, t }), 'utf8'), c.final(), c.getAuthTag()]);
  return `mg1.${iv.toString('base64url')}.${body.toString('base64url')}`;
};

const newCode = async () => ((await (await fetch(`${admin}/code`, { method: 'POST' })).json()) as { code: string }).code;

interface Device {
  name: string;
  db: GarageDB;
  config: SyncConfig | null;
  state: SyncState;
  install?: string;
}
const devices: Record<string, Device> = {};
let current: Device | undefined;

/** This process acts as the device: its own database, its own pairing and sync state. */
function as(name: string): Device {
  if (current) {
    current.config = syncConfig();
    current.state = syncState();
    current.install = installId();
  }
  let d = devices[name];
  if (!d) d = devices[name] = { name, db: new GarageDB(`sync-${name}-${uid()}`), config: null, state: { cursor: 0, pushedT: 0, initialDone: false } };
  forgetSyncMemory();
  restoreInstallId(d.install);
  setDb(d.db);
  setSyncConfig(d.config);
  resetSyncState(d.state);
  current = d;
  return d;
}

const bytes = (n: number, seed: number) => new Uint8Array(Array.from({ length: n }, (_, i) => (i * seed) % 251));

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-sync-'));
  const [port, adminPort] = [await freePort(), await freePort()];
  url = `http://127.0.0.1:${port}`;
  admin = `http://127.0.0.1:${adminPort}`;
  await startRelay();
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main], {
    // Its address given (as with Tailscale) and left on the relay here.
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_PORT: String(adminPort), PUBLIC_URL: url, RELAY_URL: relayBase },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the server did not start');
}, 20_000);
afterAll(() => {
  proc?.kill();
  relayServer?.close();
  setTimeout(() => fs.rmSync(dataDir, { recursive: true, force: true }), 300);
});

describe('syncing with the garage’s server (v0.40)', () => {
  let orderId = '';
  let photoId = '';
  let demoId = '';

  it('a computer first: its data goes to the empty server — it does not become the main device', async () => {
    as('pc-demo');
    await ensureSeed();
    const demo = await checkIn({ plate: { emirate: 'DXB', code: 'A', number: '12345' }, make: 'Toyota', model: 'Camry', name: 'Demo customer', phone: '0501112233', docLanguage: 'en', complaint: 'Demo', arrivedNow: true });
    demoId = demo.id;
    await db.counters.put({ name: 'order', value: 1008 });
    const paired = await pairDevice(url, await newCode(), 'Windows PC');
    expect(paired.server).toBe(0);
    await finishPairing(paired, 'send');
    expect(syncState().lastError).toBeUndefined();
    expect(store.record('orders', demo.id)?.complaint).toBe('Demo');
    expect(syncState().main ?? null).toBeNull();
  });

  it('the phone with its data becomes the main device: the computer’s data leaves the server; nothing of it comes to the phone; its photo leaves it once the server has it', async () => {
    as('phone');
    await ensureSeed();
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'Q', number: '52594' }, make: 'Toyota', model: 'Camry', name: 'Ahmed', phone: '0507778899', docLanguage: 'en', complaint: 'Brake noise', arrivedNow: true });
    orderId = o.id;
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front brake pads', unitPriceFils: 25000 });
    const photo = await addMedia({ ownerType: 'order', ownerId: o.id, slot: 'car', file: new Blob([bytes(70_000, 7)], { type: 'image/jpeg' }), compress: false });
    photoId = photo.id;
    const ordersBefore = await db.orders.count();
    const counterBefore = (await db.counters.get('order'))!.value;
    const paired = await pairDevice(url, await newCode(), 'iPhone');
    expect(paired).toMatchObject({ server: 1, local: 1, main: null });
    // Nothing is synced until the choice is made.
    expect(syncConfig()).toBeNull();
    await syncNow();
    expect(store.record('orders', o.id)).toBeUndefined();
    await finishPairing(paired, 'main');
    expect(syncState().lastError).toBeUndefined();
    expect(syncState().main?.name).toBe('iPhone');
    expect(store.record('orders', o.id)?.complaint).toBe('Brake noise');
    expect(store.record('orders', demoId)).toBeUndefined();
    expect(store.record('counters', 'order')?.value).toBe(counterBefore);
    // The phone is as it was: nothing of the computer's came in, its numbers did not jump.
    expect(await db.orders.count()).toBe(ordersBefore);
    expect(await db.orders.get(demoId)).toBeUndefined();
    expect((await db.counters.get('order'))?.value).toBe(counterBefore);
    expect(store.record('orders', o.id)?.complaint).toBe('Brake noise');
    expect(store.record('orders', o.id)?._t).toBeUndefined();
    expect(store.file(photo.id, 'blob')?.size).toBe(70_000);
    const row = await db.mediaBlobs.get(photo.id);
    expect(row?.up).toBe(1);
    expect(row?.blob).toBeUndefined();
    expect(syncState().freedBytes).toBe(70_000);
    // Opened again: brought from the server.
    expect((await mediaBlob(photo.id))?.size).toBe(70_000);
  });

  it('the computer that was first now has the phone’s data: its own left, its numbers went back to the phone’s', async () => {
    as('pc-demo');
    await syncNow();
    expect(syncState().lastError).toBeUndefined();
    expect(await db.orders.get(demoId)).toBeUndefined();
    expect((await db.orders.get(orderId))?.complaint).toBe('Brake noise');
    expect((await db.counters.get('order'))?.value).toBe(store.record('counters', 'order')?.value);
    expect(syncState().main?.name).toBe('iPhone');
    // It may not make its own data the garage's: refused before anything is sent.
    await db.orders.update(orderId, { complaint: 'pc wants to win' });
    await makeMain();
    expect(syncState().lastError).toBe('main');
    expect(store.record('orders', orderId)?.complaint).toBe('Brake noise');
  });

  it('another device takes the garage’s data from the server — the photo too, when it is opened', async () => {
    as('pc');
    await ensureSeed();
    const paired = await pairDevice(`${url}/#pair=000000`, await newCode(), 'PC');
    expect(paired.server).toBe(1);
    expect(paired.main?.name).toBe('iPhone');
    await finishPairing(paired, 'take');
    expect((await db.orders.get(orderId))?.complaint).toBe('Brake noise');
    expect(await db.items.where('orderId').equals(orderId).count()).toBe(1);
    expect(await db.mediaBlobs.get(photoId)).toBeUndefined();
    const blob = await mediaBlob(photoId);
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(bytes(70_000, 7));
    expect(((await db.settings.get('main')) as { _t?: number } | undefined)?._t).toBe(0);
  });

  it('a change on one reaches the other; a deletion too', async () => {
    as('pc');
    await db.orders.update(orderId, { complaint: 'Brake noise, front left' });
    const item = (await db.items.where('orderId').equals(orderId).first())!;
    await db.items.delete(item.id);
    await new Promise((r) => setTimeout(r, 20));
    await syncNow();
    expect(syncState().lastError).toBeUndefined();
    as('phone');
    await syncNow();
    expect((await db.orders.get(orderId))?.complaint).toBe('Brake noise, front left');
    expect(await db.items.get(item.id)).toBeUndefined();
  });

  it('a table added by an update (v0.43: drivers): what the device skipped before it was updated comes once, by itself', async () => {
    as('pc');
    const driverId = uid();
    await db.drivers.add({ id: driverId, name: 'Muhammad', phone: '+971501112233', createdAt: '2026-11-18T10:00:00.000Z' });
    await db.orders.update(orderId, { driver: { id: driverId, name: 'Muhammad', phone: '+971501112233' } });
    await syncNow();
    as('phone');
    await syncNow();
    expect(await db.drivers.get(driverId)).toBeDefined();
    expect(syncState().tables).toContain('drivers');
    // As the phone was on v0.42: the record skipped (no table to put it in), its cursor past it, no list of tables
    // kept — but the job came whole, with its driver.
    await applyChanges([{ t: 'drivers', k: driverId, d: null }]);
    const { tables: _known, ...older } = syncState();
    resetSyncState(older);
    expect((await db.orders.get(orderId))?.driver?.name).toBe('Muhammad');
    await syncNow();
    expect((await db.drivers.get(driverId))?.name).toBe('Muhammad');
    expect(syncState().tables).toContain('drivers');
    // Once: nothing is taken again after that.
    await applyChanges([{ t: 'drivers', k: driverId, d: null }]);
    await syncNow();
    expect(await db.drivers.get(driverId)).toBeUndefined();
    await applyChanges([{ t: 'drivers', k: driverId, d: { id: driverId, name: 'Muhammad', phone: '+971501112233', createdAt: '2026-11-18T10:00:00.000Z' } }]);
  });

  it('what a device never took — an old version skipped it while its list of tables already says it took it (v0.62.1: the computer without the invoices from before the app) — comes once; nothing it has is overwritten', async () => {
    as('pc');
    const hist = (id: string, totalFils: number) => ({ id, customerId: 'c-company', vehicleId: 'v-1', template: 'B', numberKind: 'job', number: id, date: '2026-06-03', plateRaw: 'W 1', plate: 'W-1', vehicleText: 'Nissan Urvan', lines: [], netFils: totalFils, vatFils: 0, totalFils, source: { file: 'x.pdf', sha256: 'x', page: 1 }, importedAt: '' });
    await db.historyInvoices.bulkAdd([hist('hi-old-1', 30_000), hist('hi-old-2', 20_000)] as never);
    await syncNow();
    as('phone');
    await syncNow();
    expect(await db.historyInvoices.count()).toBe(2);
    expect(syncState().holes).toBe(1);
    // As the computer was: both skipped by its old version (nowhere to put them), the cursor past them, and the list of
    // tables taken as one that always had this table — `catchUp` does not see it as new.
    await applyChanges([
      { t: 'historyInvoices', k: 'hi-old-1', d: null },
      { t: 'historyInvoices', k: 'hi-old-2', d: null },
    ]);
    // A record it has, changed here and not sent: stays as it is.
    const before = (await db.orders.get(orderId))!;
    await db.orders.update(orderId, { complaint: 'typed on the phone' });
    const { holes: _h, ...older } = syncState();
    resetSyncState(older);
    expect(syncState().tables).toContain('historyInvoices');
    await syncNow();
    expect((await db.historyInvoices.toArray()).map((h) => h.id).sort()).toEqual(['hi-old-1', 'hi-old-2']);
    expect((await db.orders.get(orderId))?.complaint).toBe('typed on the phone');
    expect(syncState().holes).toBe(1);
    // Once: a record gone again is not taken again.
    await applyChanges([{ t: 'historyInvoices', k: 'hi-old-2', d: null }]);
    await syncNow();
    expect(await db.historyInvoices.get('hi-old-2')).toBeUndefined();
    await db.orders.update(orderId, { complaint: before.complaint });
    await syncNow();
  });

  it('a record that comes without its id inside (the server’s renumbering wrote them so, v0.42.3) is put under its key, and the changes after it come too', async () => {
    as('phone');
    const { id: _id, ...bare } = (await db.orders.get(orderId))!;
    await applyChanges([
      { t: 'orders', k: orderId, d: { ...bare, number: 361 } },
      { t: 'notes', k: 'n-after', d: { id: 'n-after', orderId: '', text: 'after it', createdAt: '2026-11-18T12:00:00.000Z' } },
    ]);
    expect((await db.orders.get(orderId))?.number).toBe(361);
    expect((await db.notes.get('n-after'))?.text).toBe('after it');
  });

  it('a record changed here and not sent yet is not overwritten — it goes up and wins', async () => {
    as('phone');
    await db.orders.update(orderId, { complaint: 'phone says' });
    as('pc');
    await db.orders.update(orderId, { complaint: 'pc says' });
    await syncNow();
    as('phone');
    await syncNow();
    expect((await db.orders.get(orderId))?.complaint).toBe('phone says');
    expect(store.record('orders', orderId)?.complaint).toBe('phone says');
    as('pc');
    await syncNow();
    expect((await db.orders.get(orderId))?.complaint).toBe('phone says');
  });

  it('a photo’s record goes only once its file is on the server — the rest does not wait for it', async () => {
    as('phone');
    const photo = await addMedia({ ownerType: 'order', ownerId: orderId, slot: 'car', file: new Blob([bytes(90_000, 3)], { type: 'image/jpeg' }), compress: false });
    await db.orders.update(orderId, { complaint: 'with a new photo' });
    // The files cannot be sent (no network for them): the job's change goes; the photo's record waits.
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => (String(input).includes('/api/media/') ? Promise.reject(new TypeError('offline')) : realFetch(input, init))) as typeof fetch;
    try {
      await syncNow();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(store.record('orders', orderId)?.complaint).toBe('with a new photo');
    expect(store.record('media', photo.id)).toBeUndefined();
    expect(syncState().held).toContain(photo.id);
    // The network back: the file goes, then its record at once.
    await syncNow();
    expect(store.file(photo.id, 'blob')?.size).toBe(90_000);
    expect(store.record('media', photo.id)?.id).toBe(photo.id);
    // Its card went with it (here the photo is small: its own card).
    expect(store.file(photo.id, 'card')?.size).toBe(90_000);
    expect(syncState().held).toEqual([]);
  });

  it('reads the server’s events: a change number, a ping', () => {
    expect(eventRev('retry: 2000\ndata: {"rev":42}')).toBe(42);
    expect(eventRev(': ping')).toBeUndefined();
    expect(eventRev('data: nonsense')).toBeUndefined();
  });

  it('the same app connected again stays the main one; what it only had from the server, deleted there since, does not come back', async () => {
    as('phone');
    const pc = devices.pc.config!;
    const push = (changes: unknown[]) => fetch(`${url}/api/sync/push`, { method: 'POST', headers: { Authorization: `Bearer ${pc.token}`, 'Content-Type': 'application/json', 'X-Sync': '2' }, body: JSON.stringify({ changes }) });
    // A job made on the computer, taken by the phone: a copy there (never changed on the phone).
    const made = { id: 'pc-made', number: 9001, complaint: 'made on the PC', customerId: 'c', vehicleId: 'v', stage: 'diagnostics', outcome: 'in_progress', createdAt: '2026-11-18T05:00:00.000Z' };
    await push([{ t: 'orders', k: 'pc-made', d: made }]);
    await syncNow();
    expect(((await db.orders.get('pc-made')) as { _t?: number } | undefined)?._t).toBe(0);
    const mainBefore = syncState().main?.id;
    expect(mainBefore).toBe(syncConfig()!.deviceId);
    // Disconnected here while the server could not be reached (its address had changed): the key just forgotten.
    setSyncConfig(null);
    resetSyncState();
    // Meanwhile the computer deletes that job, and makes another.
    await push([{ t: 'orders', k: 'pc-made', d: null }, { t: 'orders', k: 'pc-new', d: { ...made, id: 'pc-new', number: 9002, complaint: 'new on the PC' } }]);
    // The same app connected again: it is the main one still; its data and the garage's put together.
    const again = await pairDevice(url, await newCode(), 'iPhone');
    expect(again.rejoined).toBe(true);
    expect(again.main?.id).toBe(again.config.deviceId);
    await finishPairing(again, 'send');
    expect(syncState().lastError).toBeUndefined();
    expect(store.record('orders', 'pc-made')).toBeUndefined();
    expect(await db.orders.get('pc-made')).toBeUndefined();
    expect((await db.orders.get('pc-new'))?.complaint).toBe('new on the PC');
    expect(store.record('orders', orderId)).toBeDefined();
    // The old key works no more.
    const old = await fetch(`${url}/api/status`, { headers: { Authorization: `Bearer ${devices.phone.config?.token ?? ''}` } });
    expect(old.status === 401 || devices.phone.config === null).toBe(true);
  });

  it('a job’s number never goes back', async () => {
    as('pc');
    await db.counters.put({ name: 'order', value: 1500 });
    await applyChanges([{ t: 'counters', k: 'order', d: { name: 'order', value: 1001 } }]);
    expect((await db.counters.get('order'))?.value).toBe(1500);
  });

  it('the same server at a new address: the device keeps its key; a wrong address is not kept', async () => {
    as('phone');
    const before = syncConfig()!.url;
    await expect(changeServerAddress('http://127.0.0.1:1')).rejects.toThrow();
    expect(syncConfig()!.url).toBe(before);
    await changeServerAddress(before.replace('127.0.0.1', 'localhost'));
    expect(syncConfig()!.url).toBe(before.replace('127.0.0.1', 'localhost'));
    await syncNow();
    expect(syncState().lastError).toBeUndefined();
  });

  it('a server out of reach is not a message: tried again quietly, and found again by itself (v0.42.1)', async () => {
    as('pc');
    const here = syncConfig()!;
    // The server starting again, no network: nothing said — only what the person must put right is.
    setSyncConfig({ ...here, url: 'http://127.0.0.1:1' });
    await syncNow();
    expect(syncState().lastError).toBeUndefined();
    expect(lastingError(new SyncError(0, 'offline'))).toBeUndefined();
    expect(lastingError(new SyncError(502, 'Bad Gateway'))).toBeUndefined();
    expect(lastingError(new SyncError(426, 'update'))).toBe('update');
    expect(lastingError(new SyncError(409, 'main'))).toBe('main');
    expect(lastingError(new SyncError(401, 'not paired'))).toBe('revoked');
    // Back: it syncs as before.
    setSyncConfig(here);
    await syncNow();
    expect(syncState().lastError).toBeUndefined();
  });

  it('the server at a new address (the computer started again): found where it left it, by itself (v0.42.2)', async () => {
    as('pc');
    await syncNow();
    const here = syncConfig()!;
    expect(here.relayUrl).toBe(relayBase);
    // This device's own channel (made from its key): the server left its address there when it paired — sealed.
    const relay = channelOf(here.token);
    const left = [...(relayTopics.get(relay.topic) ?? [])];
    expect(left.length).toBeGreaterThan(0);
    expect(left.join('')).not.toContain('127.0.0.1');
    // Someone else's text there (not this device's key) is never taken, however new.
    relayTopics.get(relay.topic)!.push(seal(crypto.randomBytes(32).toString('base64url'), relay.topic, 'http://127.0.0.1:2', Date.now() + 60_000));
    // The address this device has is gone (a new tunnel): nothing said; the new one found.
    setSyncConfig({ ...here, url: 'http://127.0.0.1:1' });
    await syncNow();
    expect(syncState().lastError).toBeUndefined();
    await findServer(true);
    expect(syncConfig()!.url).toBe(here.url);
    expect(syncConfig()!.token).toBe(here.token);
    await syncNow();
    expect(syncState().lastError).toBeUndefined();
    // This device's key, but a server that does not know it: not taken either.
    relayTopics.get(relay.topic)!.push(seal(relay.key, relay.topic, admin, Date.now() + 120_000));
    setSyncConfig({ ...here, url: 'http://127.0.0.1:1' });
    expect(await findServer(true)).toBe(false);
    expect(syncConfig()!.url).toBe('http://127.0.0.1:1');
    relayTopics.set(relay.topic, left);
    setSyncConfig(here);
  });

  it('a device cut off on the server stops, and says why', async () => {
    as('pc');
    setSyncConfig({ ...syncConfig()!, token: 'wrong' });
    await syncNow();
    expect(syncState().lastError).toBe('revoked');
  });
});
