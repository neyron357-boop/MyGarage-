import 'fake-indexeddb/auto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
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
import { applyChanges, changeServerAddress, eventRev, finishPairing, makeMain, pairDevice, syncNow } from './engine';

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
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', main], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ADMIN_PORT: String(adminPort) },
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

  it('a device cut off on the server stops, and says why', async () => {
    as('pc');
    setSyncConfig({ ...syncConfig()!, token: 'wrong' });
    await syncNow();
    expect(syncState().lastError).toBe('revoked');
  });
});
