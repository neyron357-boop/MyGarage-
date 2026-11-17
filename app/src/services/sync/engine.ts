import Dexie, { type Table } from 'dexie';
import { db } from '../../db/db';
import { LOCAL_TABLES, markRemote, nextStamp, onLocalChange, STAMP } from '../../db/syncHooks';
import { nowIso } from '../../domain/dates';
import { addressAllowed, callJson, getFile, parseAddress, putFile, SyncError } from './api';
import { offloadOn, resetSyncState, setSyncConfig, setSyncState, syncConfig, syncState, type SyncConfig } from './config';

/*
 * Syncing with the garage's server (v0.40): the app keeps working on its own data; in the background it sends what
 * changed here (records stamped since the last push, deletions, new photos' files) and takes what changed on the other
 * devices. The last write wins (on the server, by arrival); a record changed here and not yet sent is not overwritten
 * by the server's (it goes up next and wins); a job's numbers (`counters`) only go up.
 *
 * Photos and PDFs, once the server has them, leave the phone (`offloadOn`): their small previews (and a card's photo)
 * stay, the original is fetched from the server when it is opened (`remoteMedia`). Signatures and small files stay.
 */

type Row = Record<string, unknown>;
export interface Change {
  t: string;
  k: string;
  d: Row | null;
  r?: number;
}

/** A file this size and up leaves the phone once the server has it (a signature, a logo stay). */
const OFFLOAD_MIN = 48 * 1024;

const synced = (): Table[] => db.tables.filter((t) => !LOCAL_TABLES.has(t.name));
const tableOf = (name: string): Table | undefined => (LOCAL_TABLES.has(name) ? undefined : db.tables.find((t) => t.name === name));
const keyOf = (table: Table, row: Row) => String(row[table.schema.primKey.keyPath as string]);
function strip(row: Row): Row {
  const { [STAMP]: _stamp, ...rest } = row;
  return rest;
}

/* ---------- Records ---------- */

/** What changed here since the last push (everything, the first time), sent in parts. */
async function pushRecords(cfg: SyncConfig): Promise<number> {
  const st = syncState();
  // Changes after this moment are left for the next push (they get later stamps).
  const mark = nextStamp();
  const changes: Change[] = [];
  const tombs = await db.syncTombs.toArray();
  for (const tomb of tombs) {
    const table = tableOf(tomb.t);
    // Brought back since («Отменить»): sent as it is now, not as deleted.
    if (!table || (await table.get(tomb.k))) continue;
    changes.push({ t: tomb.t, k: tomb.k, d: null });
  }
  for (const table of synced()) {
    const rows = (st.initialDone ? await table.where(STAMP).above(st.pushedT).toArray() : await table.toArray()) as Row[];
    for (const row of rows) changes.push({ t: table.name, k: keyOf(table, row), d: strip(row) });
  }
  let batch: Change[] = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    await callJson(cfg, '/api/sync/push', { method: 'POST', body: { changes: batch }, timeout: 90_000 });
    batch = [];
    size = 0;
  };
  for (const c of changes) {
    const s = c.d ? JSON.stringify(c.d).length : 8;
    if (batch.length && (batch.length >= 400 || size + s > 1_500_000)) await flush();
    batch.push(c);
    size += s;
  }
  await flush();
  if (tombs.length) await db.syncTombs.bulkDelete(tombs.map((t) => t.n!));
  setSyncState({ pushedT: Math.max(st.pushedT, mark), initialDone: true });
  return changes.length;
}

/** The server's changes written here — as they are, in one transaction marked as the server's (db/syncHooks). */
export async function applyChanges(changes: Change[]): Promise<void> {
  const pushedT = syncState().pushedT;
  const tables = [...new Set(changes.map((c) => c.t))].map(tableOf).filter((t): t is Table => !!t);
  if (!tables.length) return;
  await db.transaction('rw', tables, async () => {
    markRemote(Dexie.currentTransaction);
    for (const c of changes) {
      const table = tableOf(c.t);
      if (!table) continue;
      const local = (await table.get(c.k)) as Row | undefined;
      // Changed here and not sent yet: this device's goes up next (and wins).
      if (local && Number(local[STAMP] ?? 0) > pushedT) continue;
      if (c.d === null) {
        if (local) await table.delete(c.k);
        continue;
      }
      if (c.t === 'counters' && local && Number(local.value) > Number(c.d.value)) continue;
      await table.put({ ...c.d, [STAMP]: 0 });
    }
  });
}

async function pullRecords(cfg: SyncConfig): Promise<number> {
  let cursor = syncState().cursor;
  let n = 0;
  for (;;) {
    const res = await callJson<{ changes: Change[]; cursor: number; more: boolean }>(cfg, `/api/sync/pull?since=${cursor}&limit=1000`, { timeout: 90_000 });
    if (res.changes.length) await applyChanges(res.changes);
    n += res.changes.length;
    cursor = res.cursor;
    setSyncState({ cursor });
    if (!res.more) return n;
  }
}

/* ---------- Photos and files ---------- */

async function pushMedia(cfg: SyncConfig): Promise<number> {
  if (!syncState().mediaScanned) {
    // Photos from before syncing: each one waits to be sent.
    await db.mediaBlobs.filter((r) => r.up === undefined).modify({ up: 0 });
    setSyncState({ mediaScanned: true });
  }
  const ids = await db.mediaBlobs.where('up').equals(0).primaryKeys();
  let sent = 0;
  for (const id of ids) {
    const row = await db.mediaBlobs.get(id);
    if (!row || row.up) continue;
    const media = await db.media.get(id);
    if (media) {
      if (row.blob) await putFile(cfg, id, 'blob', row.blob);
      if (row.thumb) await putFile(cfg, id, 'thumb', row.thumb);
    }
    const off = !!media && offloadOn() && !!row.blob && row.blob.size >= OFFLOAD_MIN && media.kind !== 'signature';
    await db.mediaBlobs
      .where('id')
      .equals(id)
      .modify((r) => {
        r.up = 1;
        // A file never changes (a turned photo is a new one): the one sent is the one here.
        if (off) delete r.blob;
      });
    if (!media) continue;
    sent++;
    const s = syncState();
    setSyncState({ uploaded: (s.uploaded ?? 0) + 1, freedBytes: (s.freedBytes ?? 0) + (off ? row.blob!.size : 0) });
  }
  return sent;
}

/** Turned on later: files the server already has leave the phone now. */
async function offloadSent(): Promise<void> {
  if (!offloadOn() || syncState().offloadSwept) return;
  let freed = 0;
  const kinds = new Map((await db.media.toArray()).map((m) => [m.id, m.kind]));
  await db.mediaBlobs
    .where('up')
    .equals(1)
    .modify((r) => {
      if (r.blob && r.blob.size >= OFFLOAD_MIN && kinds.get(r.id) && kinds.get(r.id) !== 'signature') {
        freed += r.blob.size;
        delete r.blob;
      }
    });
  setSyncState({ offloadSwept: true, freedBytes: (syncState().freedBytes ?? 0) + freed });
}

const inflight = new Map<string, Promise<Blob | undefined>>();
/** A photo's (PDF's…) file from the server, when it is not on this device (none — no server, offline, not there). */
export function remoteMedia(id: string, variant: 'blob' | 'thumb'): Promise<Blob | undefined> {
  const cfg = syncConfig();
  if (!cfg) return Promise.resolve(undefined);
  const key = `${id}:${variant}`;
  let p = inflight.get(key);
  if (!p) {
    p = getFile(cfg, id, variant)
      .catch(() => undefined)
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/* ---------- Running ---------- */

let running: Promise<void> | null = null;
let again = false;
let failures = 0;

async function pendingCount(): Promise<number> {
  const st = syncState();
  let n = (await db.syncTombs.count()) + (await db.mediaBlobs.where('up').equals(0).count());
  for (const table of synced()) n += await table.where(STAMP).above(st.pushedT).count();
  return n;
}

/** Send, take, send the photos — once at a time (asked again meanwhile: once more after). */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    const cfg = syncConfig();
    if (!cfg) return;
    setSyncState({ busy: true }, false);
    try {
      do {
        again = false;
        await pushRecords(cfg);
        await pullRecords(cfg);
        await pushMedia(cfg);
        await offloadSent();
      } while (again);
      failures = 0;
      setSyncState({ lastAt: nowIso(), lastError: undefined, busy: false, pending: await pendingCount() });
    } catch (e) {
      failures++;
      const err = e instanceof SyncError ? (e.status === 401 ? 'revoked' : e.status === 0 ? 'offline' : e.message) : String((e as Error)?.message ?? e);
      setSyncState({ lastError: err, busy: false, pending: await pendingCount().catch(() => undefined) });
      // Tried again later, less often each time it fails (at most every 10 minutes).
      if (err !== 'revoked') scheduleSync(Math.min(10 * 60_000, 15_000 * 2 ** Math.min(failures, 6)));
    } finally {
      running = null;
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleSync(ms = 3000) {
  if (!syncConfig()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

let started = false;
/** Once, at the app's start: syncing runs by itself — after changes, on coming back to the app, online, every minute. */
export function startSync() {
  if (started || typeof document === 'undefined') return;
  started = true;
  onLocalChange(() => scheduleSync(4000));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(400);
  });
  window.addEventListener('online', () => scheduleSync(400));
  setInterval(() => {
    if (document.visibilityState === 'visible') scheduleSync(0);
  }, 60_000);
  scheduleSync(1500);
}

/* ---------- Pairing ---------- */

/** This device paired with the server (the code shown on the computer). Returns how much each side has. */
export async function pairDevice(address: string, code: string, name: string): Promise<{ server: number; local: number }> {
  const parsed = parseAddress(address);
  const pin = (code || parsed.code || '').replace(/\D/g, '');
  if (!parsed.url || !addressAllowed(parsed.url)) throw new SyncError(0, 'address');
  if (pin.length !== 6) throw new SyncError(0, 'code');
  const res = await callJson<{ token: string; deviceId: string; records: number; byTable?: Record<string, number> }>({ url: parsed.url, token: '' }, '/api/pair', { method: 'POST', body: { code: pin, name } });
  setSyncConfig({ url: parsed.url, token: res.token, deviceId: res.deviceId, deviceName: name, pairedAt: nowIso() });
  resetSyncState();
  return { server: res.byTable?.orders ?? (res.records ? 1 : 0), local: await db.orders.count() };
}

/** The first device: everything here goes to the server. */
export async function sendLocalData(): Promise<void> {
  resetSyncState();
  await syncNow();
}

/** Another device: what is here is replaced by the garage's data from the server. */
export async function takeServerData(): Promise<void> {
  const tables = [...synced(), db.mediaBlobs, db.syncTombs];
  await db.transaction('rw', tables, async () => {
    markRemote(Dexie.currentTransaction);
    for (const t of tables) await t.clear();
  });
  resetSyncState({ initialDone: true, pushedT: nextStamp(), mediaScanned: true, offloadSwept: true });
  await syncNow();
}

/**
 * The same server at a new address (its tunnel started again after a reboot; moved to Docker and Tailscale): this
 * device keeps its key — checked at the new address before it is kept.
 */
export async function changeServerAddress(address: string): Promise<void> {
  const cfg = syncConfig();
  const parsed = parseAddress(address);
  if (!cfg) throw new SyncError(0, 'address');
  if (!parsed.url || !addressAllowed(parsed.url)) throw new SyncError(0, 'address');
  await callJson({ url: parsed.url, token: cfg.token }, '/api/status', { timeout: 15_000 });
  setSyncConfig({ ...cfg, url: parsed.url });
  scheduleSync(0);
}

/** Disconnected: the data here stays; it is not sent any more. */
export function forgetSync() {
  setSyncConfig(null);
  resetSyncState();
}
