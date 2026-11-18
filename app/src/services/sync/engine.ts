import Dexie, { type Table } from 'dexie';
import { db } from '../../db/db';
import { LOCAL_TABLES, markRemote, nextStamp, onLocalChange, STAMP } from '../../db/syncHooks';
import { nowIso } from '../../domain/dates';
import { cardOf } from '../photoSize';
import { addressAllowed, callJson, getFile, parseAddress, putFile, SyncError } from './api';
import { readRelay, RELAY } from './relay';
import { installId, offloadOn, resetSyncState, setSyncConfig, setSyncState, syncConfig, syncState, type SyncConfig } from './config';

/*
 * Syncing with the garage's server (v0.40): the app keeps working on its own data; in the background it sends what
 * changed here (records stamped since the last push, deletions, new photos' files) and takes what changed on the other
 * devices. The last write wins (on the server, by arrival); a record changed here and not yet sent is not overwritten
 * by the server's (it goes up next and wins); a job's numbers (`counters`) only go up.
 *
 * Photos and PDFs, once the server has them, leave the phone (`offloadOn`): their small previews (and a card's photo)
 * stay, the original is fetched from the server when it is opened (`remoteMedia`). Signatures and small files stay.
 *
 * The main device (v0.41.1, the user's rule: «the iPhone's data is the main source; at the first sync what is on the
 * phone shows on the other devices, and nothing of theirs comes into it»): a phone with data, connecting, makes its
 * data the garage's — sent whole, then everything it does not have is deleted on the server and so on every other
 * device (`makeMain`, `/api/sync/replace`). Nothing is synced until the device's choice is made (`finishPairing`);
 * two sets of data are never mixed at a first connection: one replaces the other. After that, both ways.
 */

type Row = Record<string, unknown>;
export interface Change {
  t: string;
  k: string;
  d: Row | null;
  r?: number;
  /** A copy (v0.41.2): taken from the server and never changed here — kept there only if the server has nothing for it. */
  c?: 1;
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

/** Photos whose own files are not on the server yet (sent first, then the photo's record — `held`). */
async function filesWaiting(ids: string[]): Promise<Set<string>> {
  const rows = await db.mediaBlobs.bulkGet(ids);
  // A photo goes once its preview and card are there (`ready`, v0.41.3): its original follows.
  return new Set(ids.filter((_, i) => rows[i] && rows[i]!.up !== 1 && rows[i]!.ready !== 1));
}

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
  // A photo's record goes once its files are there (v0.41.2): another device shows it at once, never an empty frame.
  const held = new Set(st.held ?? []);
  const sent = new Set<string>();
  for (const table of synced()) {
    const rows = (st.initialDone ? await table.where(STAMP).above(st.pushedT).toArray() : await table.toArray()) as Row[];
    const waiting = table.name === 'media' ? await filesWaiting(rows.map((r) => keyOf(table, r))) : undefined;
    for (const row of rows) {
      const k = keyOf(table, row);
      if (waiting?.has(k)) {
        held.add(k);
        continue;
      }
      if (table.name === 'media') sent.add(k);
      // Everything at a first connection: what came from the server and was not changed here goes as a copy — it
      // never brings back what was deleted there since, or overrides a newer version.
      if (!st.initialDone && row[STAMP] === 0) changes.push({ t: table.name, k, d: strip(row), c: 1 });
      else changes.push({ t: table.name, k, d: strip(row) });
    }
  }
  if (held.size) {
    const still = await filesWaiting([...held]);
    for (const k of [...held]) {
      if (still.has(k)) continue;
      held.delete(k);
      const row = (await db.media.get(k)) as Row | undefined;
      if (row && !sent.has(k)) changes.push({ t: 'media', k, d: strip(row) });
    }
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
  setSyncState({ pushedT: Math.max(st.pushedT, mark), initialDone: true, held: [...held] });
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
      if (c.t === 'counters') {
        // Numbers only go up — unless the main device's own are given (`reset`): taken as they are.
        const { reset, ...counter } = c.d;
        if (local && Number(local.value) > Number(counter.value) && !reset) continue;
        await table.put({ ...counter, [STAMP]: 0 });
        continue;
      }
      await table.put({ ...c.d, [STAMP]: 0 });
    }
  });
}

/** The tables added in v0.43 — the first version that keeps the list of tables it took (`SyncState.tables`). */
const ADDED_IN_V043 = ['drivers'];

/**
 * A table this version has and the one before it did not (v0.43: `drivers`): what the server had of it came while
 * this device skipped it (`applyChanges` has nowhere to put it) and its cursor went past — taken once, from the start,
 * that table only. Without a cursor yet (pairing) everything comes anyway.
 */
async function catchUp(cfg: SyncConfig): Promise<void> {
  const now = synced().map((t) => t.name);
  const st = syncState();
  const known = st.tables ?? now.filter((n) => !ADDED_IN_V043.includes(n));
  const fresh = now.filter((n) => !known.includes(n));
  if (fresh.length && st.cursor > 0) {
    const end = st.cursor;
    let since = 0;
    for (;;) {
      const res = await callJson<{ changes: Change[]; cursor: number; more: boolean }>(cfg, `/api/sync/pull?since=${since}&limit=1000`, { timeout: 90_000 });
      const theirs = res.changes.filter((c) => fresh.includes(c.t) && (c.r ?? 0) <= end);
      if (theirs.length) await applyChanges(theirs);
      since = res.cursor;
      if (!res.more || since >= end) break;
    }
  }
  if (!st.tables || now.some((n) => !st.tables!.includes(n))) setSyncState({ tables: now });
}

async function pullRecords(cfg: SyncConfig): Promise<number> {
  await catchUp(cfg);
  let cursor = syncState().cursor;
  let n = 0;
  for (;;) {
    const res = await callJson<{ changes: Change[]; cursor: number; more: boolean; main?: MainDevice | null; mediaKey?: string; relay?: { url: string } }>(cfg, `/api/sync/pull?since=${cursor}&limit=1000`, { timeout: 90_000 });
    if (res.changes.length) await applyChanges(res.changes);
    if (res.main !== undefined) setSyncState({ main: res.main });
    // This device's key for its pictures and videos (given since v0.41.3) and where the server leaves its address
    // (v0.42.2): kept with the connection.
    const now = syncConfig();
    if (now && now.token === cfg.token) {
      const patch: Partial<SyncConfig> = {};
      if (res.mediaKey && now.mediaKey !== res.mediaKey) patch.mediaKey = res.mediaKey;
      if (res.relay?.url && now.relayUrl !== res.relay.url) patch.relayUrl = res.relay.url;
      if (Object.keys(patch).length) setSyncConfig({ ...now, ...patch });
    }
    const photos = res.changes.filter((c) => c.t === 'media' && c.d && c.d.kind === 'photo');
    if (photos.length) arrived?.(photos.map((c) => ({ id: c.k, card: isCover(String(c.d!.slot ?? '')) })));
    n += res.changes.length;
    cursor = res.cursor;
    setSyncState({ cursor });
    if (!res.more) return n;
  }
}

/** Another device is the main one: this one may not replace the garage's data (nothing is sent — nothing is mixed). */
async function mayBeMain(cfg: SyncConfig): Promise<void> {
  const st = await callJson<{ main?: MainDevice | null }>(cfg, '/api/status', { timeout: 30_000 });
  setSyncState({ main: st.main ?? null });
  if (st.main && st.main.id !== cfg.deviceId) throw new SyncError(409, 'main');
}

/** The main device's data becomes the garage's: what it does not have is deleted on the server (and the others). */
async function replaceServer(cfg: SyncConfig): Promise<void> {
  const keys: Record<string, string[]> = {};
  let counters: { name: string; value: number }[] = [];
  for (const table of synced()) {
    keys[table.name] = (await table.toCollection().primaryKeys()).map(String);
    // Its own numbers are taken as they are; one it only had from the server stays the server's.
    if (table.name === 'counters')
      counters = ((await table.toArray()) as { name: string; value: number; _t?: number }[]).filter((c) => c._t !== 0).map((c) => ({ name: c.name, value: c.value }));
  }
  await callJson(cfg, '/api/sync/replace', { method: 'POST', body: { keys, counters }, timeout: 90_000 });
  setSyncState({ replacing: false, main: { id: cfg.deviceId, name: cfg.deviceName } });
}

/* ---------- Photos and files ---------- */

/** Photo slots that may be a car's main photo (services/cover.ts): their cards are brought ahead. */
const COVERS = new Set(['cover', 'front_left', 'front_right', 'front', 'rear_left', 'rear_right', 'left', 'right', 'rear']);
const isCover = (slot: string) => COVERS.has(slot);

type Arrived = (list: { id: string; card: boolean }[]) => void;
let arrived: Arrived | null = null;
/** Told of the photos that came from other devices (services/media.ts brings their previews ahead). */
export function onMediaArrived(fn: Arrived) {
  arrived = fn;
}

/** Sends the photos' files; true when a photo whose record was held can go now (its record is sent at once). */
async function pushMedia(server: SyncConfig): Promise<boolean> {
  // Files to this computer's own server when it is the one (v0.42.3).
  const cfg = { ...server, url: filesBase(server) };
  if (!syncState().mediaScanned) {
    // Photos from before syncing: each one waits to be sent.
    await db.mediaBlobs.filter((r) => r.up === undefined).modify({ up: 0 });
    setSyncState({ mediaScanned: true });
  }
  const ids = await db.mediaBlobs.where('up').equals(0).primaryKeys();
  let released = false;
  for (const id of ids) {
    const row = await db.mediaBlobs.get(id);
    if (!row || row.up) continue;
    const media = await db.media.get(id);
    if (media) {
      // The small ones first (v0.41.3): the preview, and a photo's card — the photo can show on the other devices
      // (its record goes now), while its original is still on its way.
      if (row.thumb) await putFile(cfg, id, 'thumb', row.thumb);
      if (media.kind === 'photo' && row.blob) {
        const card = row.card ?? (await cardOf(row.blob));
        if (card) {
          await putFile(cfg, id, 'card', card);
          if (!row.card) await db.mediaBlobs.update(id, { card });
        }
        await db.mediaBlobs.update(id, { ready: 1 });
        if (syncState().held?.includes(id)) {
          released = true;
          void syncRecords();
        }
      }
      if (row.blob) await putFile(cfg, id, 'blob', row.blob);
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
    const s = syncState();
    setSyncState({ uploaded: (s.uploaded ?? 0) + 1, freedBytes: (s.freedBytes ?? 0) + (off ? row.blob!.size : 0) });
    // Its record waited for it: it goes now, while the next photos are still being sent.
    if (s.held?.includes(id)) {
      released = true;
      void syncRecords();
    }
  }
  return released;
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
export function remoteMedia(id: string, variant: 'blob' | 'thumb' | 'card'): Promise<Blob | undefined> {
  const cfg = syncConfig();
  if (!cfg) return Promise.resolve(undefined);
  const key = `${id}:${variant}`;
  let p = inflight.get(key);
  if (!p) {
    // By the file's own address (v0.42.3), kept by the browser: what a picture or the viewer has loaded already is
    // not downloaded a second time (to share, to save).
    const src = remoteMediaSrc(id, variant);
    p = (src ? cachedFile(src) : getFile({ ...cfg, url: filesBase(cfg) }, id, variant))
      .catch(() => undefined)
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** A file by its own address, from the browser's cache when it is there (the server marks files as never changing). */
async function cachedFile(src: string): Promise<Blob | undefined> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120_000);
  try {
    const res = await fetch(src, { signal: ctl.signal, cache: 'force-cache' });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new SyncError(res.status, res.statusText);
    return await res.blob();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- This computer's own server (v0.42.3) ---------- */

const NEAR = 'http://127.0.0.1:8787';
let near: { token: string; ok: boolean; at: number } | undefined;
const phoneLike = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

/**
 * On the computer the garage's server runs on (v0.42.3, the user: «на десктопной версии фотографии и видео открываются
 * очень [медленно]»): photos and videos come straight from it — not out through the tunnel and back (≈1 s a file and the
 * garage's upload speed: a 12 MB video 8.6 s, straight 0.2 s). Checked once: this device's own key must work there (the
 * same server). Anywhere else — or if the browser does not allow it — through the tunnel, as before.
 */
export async function findNearServer(): Promise<boolean> {
  const cfg = syncConfig();
  if (!cfg || phoneLike() || typeof fetch === 'undefined' || cfg.url === NEAR) return false;
  if (near?.token === cfg.token && (near.ok || Date.now() - near.at < 10 * 60_000)) return near.ok;
  near = { token: cfg.token, ok: false, at: Date.now() };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2000);
  try {
    // `targetAddressSpace`: Chrome's own words for a page asking this computer (Local Network Access).
    const init = { headers: { Authorization: `Bearer ${cfg.token}`, 'X-Sync': '2' }, signal: ctl.signal, cache: 'no-store', targetAddressSpace: 'loopback' } as RequestInit;
    const res = await fetch(`${NEAR}/api/status`, init);
    if (res.ok && syncConfig()?.token === cfg.token) near = { token: cfg.token, ok: true, at: Date.now() };
  } catch {
    // not this computer, or not allowed: the tunnel
  } finally {
    clearTimeout(timer);
  }
  return near.ok;
}

/** Where this device's files come from and go to: this computer's own server when it is here, else its address. */
export function filesBase(cfg: SyncConfig): string {
  return near?.ok && near.token === cfg.token ? NEAR : cfg.url;
}

/**
 * A file's own address on the server (v0.41.3): a picture or a video element loads it by itself — streamed, shown as it
 * comes, kept by the browser. None without this device's media key (connected before it was given: the next sync).
 */
export function remoteMediaSrc(id: string, variant: 'blob' | 'thumb' | 'card' = 'blob'): string | undefined {
  const cfg = syncConfig();
  if (!cfg?.mediaKey) return undefined;
  return `${filesBase(cfg)}/api/media/${encodeURIComponent(id)}/${variant}?d=${encodeURIComponent(cfg.deviceId)}&k=${encodeURIComponent(cfg.mediaKey)}`;
}

/** A card made here from the server's original: the server keeps it too (best effort). */
export function sendCard(id: string, card: Blob) {
  const cfg = syncConfig();
  if (cfg) void putFile({ ...cfg, url: filesBase(cfg) }, id, 'card', card).catch(() => undefined);
}

/* ---------- Running ---------- */

/*
 * Two lanes (v0.41.2, the user: «данные передавались моментально»): records — sent an eighth of a second after a
 * change, taken the moment the server says another device changed something (`listen`); files — the photos' and
 * PDFs' files, sent on their own, so a photo being sent never holds up a job, a payment, a note.
 */

let recRun: Promise<void> | null = null;
let recAgain = false;
let fileRun: Promise<void> | null = null;
let fileAgain = false;
let failures = 0;

async function pendingCount(): Promise<number> {
  const st = syncState();
  let n = (await db.syncTombs.count()) + (await db.mediaBlobs.where('up').equals(0).count());
  for (const table of synced()) n += await table.where(STAMP).above(st.pushedT).count();
  return n;
}

/**
 * What only the person can put right (v0.42.1, the user: «пишет нет связи с сервером — исправь, чтобы не было никогда
 * таких сообщений»): this device cut off on the server, an app too old for it, another device the main one. Anything
 * else — no network, the server starting again, the tunnel's moment, the app just back from the background — is not
 * a message: it is tried again, quietly, in seconds (what waits stays here and goes then).
 */
export function lastingError(e: unknown): 'revoked' | 'update' | 'main' | undefined {
  if (!(e instanceof SyncError)) return undefined;
  return e.status === 401 ? 'revoked' : e.status === 426 ? 'update' : e.status === 409 ? 'main' : undefined;
}

function failed(e: unknown) {
  failures++;
  const err = lastingError(e);
  setSyncState({ lastError: err, busy: false });
  void pendingCount().then((pending) => setSyncState({ pending }, false), () => undefined);
  // Tried again soon, a little less often each time (2, 4, 8 … at most every 30 s) — the server started again is
  // found in seconds.
  if (err !== 'revoked') scheduleSync(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
  // Not reached at all: its address may be new (the computer restarted) — looked up where the server leaves it.
  if (!err) void findServer();
}

let finding: Promise<boolean> | null = null;
let lookedAt = 0;

/**
 * The server not reached: its address may have changed — the computer started again, and its free tunnel with a new
 * address (v0.42.2). The address the server left on the relay is read; if it is another one and this device's own key
 * works there (the same server — another would not know it), syncing goes on there. At most every 30 s (`now`: at
 * once); quiet either way.
 */
export function findServer(now = false): Promise<boolean> {
  if (finding) return finding;
  const cfg = syncConfig();
  if (!cfg || (!now && Date.now() - lookedAt < 30_000)) return Promise.resolve(false);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(false);
  lookedAt = Date.now();
  finding = (async () => {
    try {
      const relay = cfg.relayUrl ?? RELAY;
      if (!addressAllowed(relay)) return false;
      const left = await readRelay(relay, cfg.token);
      const url = left ? parseAddress(left.u).url : '';
      if (!url || url === cfg.url || !addressAllowed(url)) return false;
      await callJson({ url, token: cfg.token }, '/api/status', { timeout: 15_000 });
      const here = syncConfig();
      if (!here || here.token !== cfg.token) return false;
      setSyncConfig({ ...here, url });
      relisten();
      scheduleSync(0);
      return true;
    } catch {
      return false;
    } finally {
      finding = null;
    }
  })();
  return finding;
}

/** Records: send, take — once at a time (asked again meanwhile: once more after). */
function syncRecords(): Promise<void> {
  if (recRun) {
    recAgain = true;
    return recRun;
  }
  const cfg = syncConfig();
  // Not connected: nothing to do (checked before the run is set — a run that ended at once would leave it set).
  if (!cfg) return Promise.resolve();
  recRun = (async () => {
    setSyncState({ busy: true }, false);
    try {
      do {
        recAgain = false;
        const replacing = syncState().replacing;
        if (replacing) await mayBeMain(cfg);
        await pushRecords(cfg);
        if (replacing) await replaceServer(cfg);
        await pullRecords(cfg);
      } while (recAgain);
      failures = 0;
      setSyncState({ lastAt: nowIso(), lastError: undefined, busy: false });
    } catch (e) {
      failed(e);
    } finally {
      recRun = null;
    }
  })();
  return recRun;
}

/** Files: the photos' (PDFs'…) files sent, and those the server has leave this device. */
function syncFiles(): Promise<void> {
  if (fileRun) {
    fileAgain = true;
    return fileRun;
  }
  const cfg = syncConfig();
  if (!cfg) return Promise.resolve();
  fileRun = (async () => {
    try {
      let released = false;
      do {
        fileAgain = false;
        if (await pushMedia(cfg)) released = true;
        await offloadSent();
      } while (fileAgain);
      // The photos' records that waited for their files: sent (the last of them is in by the time this ends).
      if (released) await syncRecords();
      setSyncState({ pending: await pendingCount() }, false);
    } catch (e) {
      failed(e);
    } finally {
      fileRun = null;
    }
  })();
  return fileRun;
}

/** Everything: the records, then the files. */
export async function syncNow(): Promise<void> {
  await syncRecords();
  await syncFiles();
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleSync(ms = 3000) {
  if (!syncConfig()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

/* ---------- Told at once (v0.41.2) ---------- */

let stream: AbortController | null = null;
let streamTries = 0;
let heard = 0;
let reopen: ReturnType<typeof setTimeout> | undefined;

/** The number of the server's change in an event (`data: {"rev": N}`); a comment (`: ping`) — none. */
export function eventRev(block: string): number | undefined {
  const data = block
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('');
  if (!data) return undefined;
  try {
    const rev = Number((JSON.parse(data) as { rev?: unknown }).rev);
    return Number.isFinite(rev) ? rev : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One stream open to the server: each time another device's changes are kept there, this device takes them at once.
 * Gone (no network, the app in the background, the server restarted): opened again; the minute's check stays as the net.
 */
function listen() {
  const cfg = syncConfig();
  if (!started || !cfg || stream) return;
  clearTimeout(reopen);
  const ctl = new AbortController();
  stream = ctl;
  let reconnect = true;
  void (async () => {
    try {
      const res = await fetch(`${cfg.url}/api/sync/events`, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: ctl.signal, cache: 'no-store' });
      if (res.status === 401) {
        reconnect = false;
        setSyncState({ lastError: 'revoked' });
        return;
      }
      if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
      heard = Date.now();
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      // «На связи» once the server's first event has come through: a tunnel that held the stream back is not live (the
      // 20-second check stays on).
      let through = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        heard = Date.now();
        buf += dec.decode(value, { stream: true }).replace(/\r/g, '');
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const rev = eventRev(buf.slice(0, i));
          buf = buf.slice(i + 2);
          if (!through) {
            through = true;
            streamTries = 0;
          }
          // Said again with each event and ping (15 s), should anything have put it out meanwhile.
          if (!syncState().live) setSyncState({ live: true }, false);
          // Another device's changes (or ones missed while the stream was closed): taken now.
          if (rev !== undefined && rev > syncState().cursor) void syncRecords();
        }
      }
    } catch {
      // closed, or no network
    } finally {
      if (stream === ctl) stream = null;
      setSyncState({ live: false }, false);
      if (reconnect && !ctl.signal.aborted && syncConfig()?.token === cfg.token) {
        streamTries++;
        // Again in 2, 4, then every 5 s: the server back (it starts again in two seconds) is heard at once.
        reopen = setTimeout(listen, Math.min(5_000, 1000 * 2 ** Math.min(streamTries, 3)));
      }
    }
  })();
}

/** The stream opened anew (back in the app, online again, a new address or connection), or closed when disconnected. */
function relisten() {
  void findNearServer();
  stream?.abort();
  stream = null;
  streamTries = 0;
  clearTimeout(reopen);
  if (started) setSyncState({ live: false }, false);
  listen();
}

let started = false;
/** Once, at the app's start: syncing runs by itself — at once after a change, at once when told, on coming back. */
export function startSync() {
  if (started || typeof document === 'undefined') return;
  started = true;
  // The computer with the server: its files straight from it (v0.42.3).
  void findNearServer();
  // A change here: sent an eighth of a second later (one action's several writes go together).
  onLocalChange(() => scheduleSync(120));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Back in the app: the stream iOS cut in the background opened anew, and what changed meanwhile taken.
    relisten();
    scheduleSync(0);
  });
  window.addEventListener('online', () => {
    relisten();
    scheduleSync(0);
  });
  let ticks = 0;
  setInterval(() => {
    // A stream silent for long (its pings stopped) is a dead one.
    if (stream && Date.now() - heard > 45_000) relisten();
    if (document.visibilityState !== 'visible') return;
    // The net under the stream: every 20 s without it, every minute with it.
    ticks++;
    if (!syncState().live || ticks % 3 === 0) scheduleSync(0);
  }, 20_000);
  listen();
  scheduleSync(800);
}

/* ---------- Pairing ---------- */

export interface MainDevice {
  id: string;
  name: string;
}
/** A device paired, its choice not made yet: nothing is kept or synced until `finishPairing`. */
export interface Pairing {
  config: SyncConfig;
  /** The server's jobs (none — an empty server). */
  server: number;
  /** This device's jobs. */
  local: number;
  /** The device whose data is the garage's, if there is one. */
  main: MainDevice | null;
  /** The same app connected again (its install): it stays what it was — its data and the server's are put together. */
  rejoined: boolean;
}

/** This device paired with the server (the code shown on the computer): how much each side has; nothing synced yet. */
export async function pairDevice(address: string, code: string, name: string): Promise<Pairing> {
  const parsed = parseAddress(address);
  const pin = (code || parsed.code || '').replace(/\D/g, '');
  if (!parsed.url || !addressAllowed(parsed.url)) throw new SyncError(0, 'address');
  if (pin.length !== 6) throw new SyncError(0, 'code');
  const res = await callJson<{ token: string; deviceId: string; mediaKey?: string; relay?: { url: string }; records: number; byTable?: Record<string, number>; main?: MainDevice | null; rejoined?: boolean }>(
    { url: parsed.url, token: '' },
    '/api/pair',
    { method: 'POST', body: { code: pin, name, install: installId() } },
  );
  return {
    config: { url: parsed.url, token: res.token, deviceId: res.deviceId, deviceName: name, pairedAt: nowIso(), mediaKey: res.mediaKey, relayUrl: res.relay?.url },
    server: res.byTable?.orders ?? (res.records ? 1 : 0),
    local: await db.orders.count(),
    main: res.main ?? null,
    rejoined: !!res.rejoined,
  };
}

/**
 * The choice made: «send» — this device's data goes to the (empty) server; «main» — it becomes the garage's, replacing
 * the server's; «take» — the server's replaces this device's.
 */
export async function finishPairing(p: Pairing, how: 'send' | 'main' | 'take'): Promise<void> {
  setSyncConfig(p.config);
  relisten();
  if (how === 'take') return takeServerData();
  if (how === 'main') return makeMain();
  return sendLocalData();
}

/** Not connected after all: the server forgets this device (it never sent anything). */
export function cancelPairing(p: Pairing) {
  void callJson(p.config, '/api/forget', { method: 'POST', timeout: 10_000 }).catch(() => undefined);
}

/** This device's data becomes the garage's: sent whole; what it does not have goes from the server and the others. */
export async function makeMain(): Promise<void> {
  resetSyncState({ replacing: true });
  await syncNow();
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
  relisten();
  scheduleSync(0);
}

/** Disconnected: the data here stays; it is not sent any more (the server forgets this device). */
export function forgetSync() {
  const cfg = syncConfig();
  if (cfg) void callJson(cfg, '/api/forget', { method: 'POST', timeout: 10_000 }).catch(() => undefined);
  setSyncConfig(null);
  resetSyncState();
  relisten();
}
