import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { eaglecartNumbered, FIRST_OWN, fromEaglecart, invoiceNumbers, planRenumber } from './numbers.mjs';

/*
 * Everything the garage has, in one folder on this computer:
 *
 *   Служебное/garage.db        — every record of the app (jobs, customers, money, invoices…), SQLite
 *   Фото и видео/2026-11/…      — photos, videos, voice notes, signatures, by month
 *   Документы/Инвойсы/2026-11/… — PDFs as the app made them: invoices, quotations, check-in acts, receipts, debts
 *   Резервные копии/…           — a copy of the database every day (the last 30 kept)
 *   Служебное/Превью, Файлы     — small previews, the PDFs' own copies
 *
 * Records are kept as the app has them (JSON), each with the server's running number (`rev`): a device asks for what
 * changed after the last number it saw. The last write wins; a job's numbers (`counters`) only go up.
 */

export const DIRS = {
  service: 'Служебное',
  media: 'Фото и видео',
  docs: 'Документы',
  backups: 'Резервные копии',
  previews: path.join('Служебное', 'Превью'),
  files: path.join('Служебное', 'Файлы'),
  tmp: path.join('Служебное', 'tmp'),
};

/** The folder of a PDF by what it belongs to. */
const DOC_FOLDERS = {
  invoice: 'Инвойсы',
  version: 'Сметы',
  inspection: 'Акты',
  payment: 'Чеки',
  debt: 'Долги',
};

const EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
};

export const extOf = (type) => EXT[(type || '').split(';')[0].trim().toLowerCase()] || 'bin';

/** A file name Windows accepts: no reserved characters, not too long. */
export function safeName(name) {
  const clean = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (clean || 'file').slice(0, 150);
}

const TABLE = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const MAX_RECORD = 8 * 1024 * 1024;

export function openStore(dataDir, { keepBackups = 30, log = () => {} } = {}) {
  for (const d of Object.values(DIRS)) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
  writeReadme(dataDir);
  const db = new DatabaseSync(path.join(dataDir, DIRS.service, 'garage.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS records (
      tbl TEXT NOT NULL, id TEXT NOT NULL, data TEXT, deleted INTEGER NOT NULL DEFAULT 0,
      rev INTEGER NOT NULL, device TEXT, at TEXT NOT NULL, PRIMARY KEY (tbl, id)
    );
    CREATE INDEX IF NOT EXISTS records_rev ON records (rev);
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, name TEXT, token_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL,
      last_seen TEXT, revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT NOT NULL, variant TEXT NOT NULL, path TEXT NOT NULL, size INTEGER, type TEXT, sha256 TEXT,
      at TEXT NOT NULL, PRIMARY KEY (id, variant)
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS ai_cache (k TEXT PRIMARY KEY, kind TEXT NOT NULL, at INTEGER NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reserved (number INTEGER PRIMARY KEY, device TEXT NOT NULL, at TEXT NOT NULL);
  `);
  // v0.41.2: the app's own install number on each device (the same app connected again is the same device).
  if (!db.prepare('PRAGMA table_info(devices)').all().some((c) => c.name === 'install')) db.exec('ALTER TABLE devices ADD COLUMN install TEXT');
  let rev = Number(db.prepare('SELECT COALESCE(MAX(rev), 0) AS r FROM records').get().r);
  const now = () => new Date().toISOString();

  const getRecord = db.prepare('SELECT data, deleted FROM records WHERE tbl = ? AND id = ?');
  const putRecord = db.prepare(
    `INSERT INTO records (tbl, id, data, deleted, rev, device, at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tbl, id) DO UPDATE SET data = excluded.data, deleted = excluded.deleted, rev = excluded.rev,
       device = excluded.device, at = excluded.at`,
  );
  const pullRows = db.prepare('SELECT rev, tbl, id, data, deleted FROM records WHERE rev > ? AND (device IS NULL OR device <> ?) ORDER BY rev LIMIT ?');
  // Job numbers (v0.42.3, numbers.mjs): which job has a number, the highest one, a job's invoices.
  const orderByNumber = db.prepare("SELECT id FROM records WHERE tbl = 'orders' AND deleted = 0 AND id <> ? AND json_extract(data, '$.number') = ? LIMIT 1");
  const topNumber = db.prepare("SELECT MAX(json_extract(data, '$.number')) AS n FROM records WHERE tbl = 'orders' AND deleted = 0");
  const invoicesOf = db.prepare("SELECT id, data FROM records WHERE tbl = 'invoices' AND deleted = 0 AND json_extract(data, '$.orderId') = ?");
  const liveRows = db.prepare('SELECT id, data FROM records WHERE tbl = ? AND deleted = 0');
  // Job numbers kept for a device (v0.84.2): its jobs made without the server take them — nobody else's.
  const reservedBy = db.prepare('SELECT device FROM reserved WHERE number = ?');
  const reservedOf = db.prepare('SELECT number FROM reserved WHERE device = ? ORDER BY number');
  const topReserved = db.prepare('SELECT MAX(number) AS n FROM reserved');
  const unreserve = db.prepare('DELETE FROM reserved WHERE number = ?');
  const reserve = db.prepare('INSERT INTO reserved (number, device, at) VALUES (?, ?, ?)');

  function record(tbl, id) {
    const row = getRecord.get(tbl, id);
    return row && !row.deleted ? JSON.parse(row.data) : undefined;
  }

  /** The next free job number (≥ 350, past every number kept for a device): the counter moves to it, every device is told. */
  function nextJobNumber(at) {
    const n = Math.max(FIRST_OWN - 1, Number(record('counters', 'order')?.value) || 0, Number(topNumber.get().n) || 0, Number(topReserved.get().n) || 0) + 1;
    putRecord.run('counters', 'order', JSON.stringify({ name: 'order', value: n }), 0, ++rev, null, at);
    return n;
  }

  /** A job's invoices numbered as its own (v0.42.3): those that differ are written so, and every device is told. */
  function numberInvoices(orderId, at) {
    const order = record('orders', orderId);
    if (!order || !Number.isFinite(Number(order.number))) return;
    const list = invoicesOf.all(orderId).map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
    const want = invoiceNumbers(Number(order.number), list);
    for (const i of list) {
      if (want.get(i.id) === i.number) continue;
      const { id, ...data } = i;
      putRecord.run('invoices', id, JSON.stringify({ ...data, number: want.get(id) }), 0, ++rev, null, at);
    }
  }

  /**
   * A device's changes: `{t, k, d}` (`d` null — deleted). Returns the number of the last one kept. `server`: the
   * server's own (a job numbered once more): every device takes them, as they are.
   */
  function push(deviceId, changes, { server = false } = {}) {
    if (!Array.isArray(changes)) throw httpError(400, 'changes');
    const at = now();
    const touchedMedia = [];
    const jobs = new Set();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const c of changes) {
        const tbl = String(c?.t ?? '');
        const id = String(c?.k ?? '');
        if (!TABLE.test(tbl) || !id || id.length > 300) throw httpError(400, `bad change ${tbl}/${id.slice(0, 40)}`);
        // A copy (v0.41.2): a record the device had from the server and never changed since. Sent at a first
        // connection — kept only if the server has nothing for it; never over a newer one or over its deletion.
        if (c.c && getRecord.get(tbl, id)) continue;
        if (c.d === null || c.d === undefined) {
          putRecord.run(tbl, id, null, 1, ++rev, deviceId, at);
          continue;
        }
        if (typeof c.d !== 'object') throw httpError(400, `bad record ${tbl}/${id}`);
        let data = c.d;
        let by = server ? null : deviceId;
        // A job's numbers only go up: a device behind gets the higher one back (it is sent to it too).
        if (tbl === 'counters') {
          const have = record(tbl, id);
          if (have && Number(have.value) > Number(data.value)) {
            data = have;
            by = null;
          }
        }
        // Job numbers (v0.42.3): a job's stays what the server has; a new one taken already — or made here and below
        // 350 — gets the next free one. The device gets it back (`by` none: every device takes it).
        if (tbl === 'orders' && !server) {
          const have = record(tbl, id);
          const n = Number(data.number);
          if (have) {
            if (n !== Number(have.number)) {
              data = { ...data, number: have.number };
              by = null;
            }
          } else if (!Number.isFinite(n) || orderByNumber.get(id, n) || (!fromEaglecart(data) && !eaglecartNumbered(data) && n < FIRST_OWN) || keptForAnother(n, deviceId)) {
            data = { ...data, number: nextJobNumber(at) };
            by = null;
          } else if (Number.isFinite(n)) {
            // A number kept for this device, now its job's: no longer kept.
            unreserve.run(n);
          }
          jobs.add(id);
        }
        if (tbl === 'invoices' && !server && data.orderId) jobs.add(String(data.orderId));
        const json = JSON.stringify(data);
        if (json.length > MAX_RECORD) throw httpError(413, `record too large ${tbl}/${id}`);
        putRecord.run(tbl, id, json, 0, ++rev, by, at);
        if (tbl === 'media') touchedMedia.push(id);
      }
      // An invoice's number is its job's (v0.42.3).
      for (const orderId of jobs) numberInvoices(orderId, at);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      rev = Number(db.prepare('SELECT COALESCE(MAX(rev), 0) AS r FROM records').get().r);
      throw e;
    }
    // A PDF whose record came after its file: it goes into «Документы» now.
    for (const id of touchedMedia) {
      try {
        mirrorDocument(id);
      } catch (e) {
        log(`mirror ${id}: ${e.message}`);
      }
    }
    return rev;
  }

  /** A number kept for another device (v0.84.2): a job of this one does not take it. */
  function keptForAnother(n, deviceId) {
    const by = reservedBy.get(n)?.device;
    return !!by && by !== deviceId;
  }

  /**
   * Job numbers kept for a device (v0.84.2, audit 25/11: the phone and the computer without the server each gave a job
   * the next number after the last they knew — two customers got INV-2026-360, and the server renumbered one after the
   * paper was out). Topped up to `want`: each the next free number, the counter past it (every device is told — none
   * of them takes it while it is in touch). A job of this device made without the server, or invoiced before the server
   * had it, takes one; nobody else ever does. Returns this device's numbers not yet taken.
   */
  function reserveNumbers(deviceId, want = 3) {
    const at = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const mine = [];
      for (const r of reservedOf.all(deviceId)) {
        const n = Number(r.number);
        // Taken by a job meanwhile (the device's own, kept under it): no longer kept.
        if (orderByNumber.get('', n)) unreserve.run(n);
        else mine.push(n);
      }
      while (mine.length < want) {
        const n = nextJobNumber(at);
        reserve.run(n, deviceId, at);
        mine.push(n);
      }
      db.exec('COMMIT');
      return mine;
    } catch (e) {
      db.exec('ROLLBACK');
      rev = Number(db.prepare('SELECT COALESCE(MAX(rev), 0) AS r FROM records').get().r);
      throw e;
    }
  }

  /**
   * The main device's data becomes the garage's (v0.41.1, the user's rule: «the phone is the main source»): every
   * record it does not have is deleted here — and so on the other devices; its job numbers are taken as they are, a
   * lower one too (`reset`: the devices take it although numbers only go up otherwise). `keys`: `{table: [id…]}`.
   */
  function replace(deviceId, keys, counters) {
    if (!keys || typeof keys !== 'object') throw httpError(400, 'keys');
    const have = new Map(Object.entries(keys).map(([t, ids]) => [t, new Set(Array.isArray(ids) ? ids.map(String) : [])]));
    const given = new Map();
    for (const c of Array.isArray(counters) ? counters : []) {
      if (c && typeof c.name === 'string' && Number.isFinite(Number(c.value))) given.set(c.name, Number(c.value));
    }
    const at = now();
    let removed = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const r of db.prepare('SELECT tbl, id FROM records WHERE deleted = 0').all()) {
        if (have.get(r.tbl)?.has(r.id) || (r.tbl === 'counters' && given.has(r.id))) continue;
        putRecord.run(r.tbl, r.id, null, 1, ++rev, deviceId, at);
        removed++;
      }
      for (const [name, value] of given) putRecord.run('counters', name, JSON.stringify({ name, value, reset: true }), 0, ++rev, deviceId, at);
      // The numbers kept for devices (v0.84.2) went with the data they were kept past: kept again from the main's.
      db.exec('DELETE FROM reserved');
      db.prepare("INSERT INTO meta (key, value) VALUES ('mainDevice', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(deviceId);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      rev = Number(db.prepare('SELECT COALESCE(MAX(rev), 0) AS r FROM records').get().r);
      throw e;
    }
    return { rev, removed };
  }

  /** The device whose data is the garage's (none yet, or it was cut off: none). */
  function mainDevice() {
    const id = db.prepare("SELECT value FROM meta WHERE key = 'mainDevice'").get()?.value;
    const d = id ? db.prepare('SELECT id, name, revoked FROM devices WHERE id = ?').get(id) : undefined;
    return d && !d.revoked ? { id: d.id, name: d.name } : null;
  }

  /** What changed after `since` (other devices' changes), oldest first. */
  function pull(deviceId, since, limit = 500) {
    const rows = pullRows.all(Number(since) || 0, deviceId, Math.min(Math.max(Number(limit) || 500, 1), 2000));
    const changes = rows.map((r) => ({ r: Number(r.rev), t: r.tbl, k: r.id, d: r.deleted ? null : JSON.parse(r.data) }));
    const more = rows.length === Math.min(Math.max(Number(limit) || 500, 1), 2000);
    // Nothing more: the device is up to date with everything, its own changes included.
    return { changes, cursor: more ? changes[changes.length - 1].r : rev, more };
  }

  /**
   * Every job numbered once more (v0.42.3, numbers.mjs `planRenumber`): `fixed` — jobs made here that are Eaglecart
   * jobs (id → Eaglecart's number). Without `apply` only says what would change.
   */
  function renumber({ fixed = {}, floor = FIRST_OWN, apply = false } = {}) {
    const orders = liveRows.all('orders').map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
    const invoices = liveRows.all('invoices').map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
    const plan = planRenumber(orders, invoices, { floor, fixed });
    let last = rev;
    if (apply) {
      const byId = (list) => new Map(list.map((x) => [x.id, x]));
      const o = byId(orders);
      const inv = byId(invoices);
      // The record whole, its id in it (v0.45: without it a device cannot put it — it takes a record by its own id).
      const changes = [
        ...plan.orders.map((c) => ({ t: 'orders', k: c.id, d: { ...o.get(c.id), id: c.id, number: c.to, ...(c.eaglecart ? { eaglecartNo: c.to } : {}) } })),
        ...plan.invoices.map((c) => ({ t: 'invoices', k: c.id, d: { ...inv.get(c.id), id: c.id, number: c.to } })),
      ];
      last = push(null, changes, { server: true });
      // The job counter: the highest number now (it only goes up).
      if (plan.counter > (Number(record('counters', 'order')?.value) || 0)) putRecord.run('counters', 'order', JSON.stringify({ name: 'order', value: plan.counter }), 0, ++rev, null, now());
      // Numbers kept for devices (v0.84.2) may be jobs' now: kept anew past them (a device skips one a job has).
      db.exec('DELETE FROM reserved');
      last = rev;
    }
    return { orders: plan.orders, invoices: plan.invoices, counter: plan.counter, rev: last };
  }

  function counts() {
    const recs = db.prepare('SELECT tbl, COUNT(*) AS n FROM records WHERE deleted = 0 GROUP BY tbl').all();
    const files = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM files WHERE variant = 'blob'").get();
    const byTable = Object.fromEntries(recs.map((r) => [r.tbl, Number(r.n)]));
    return { records: recs.reduce((s, r) => s + Number(r.n), 0), byTable, files: Number(files.n), bytes: Number(files.bytes), rev };
  }

  /* ---------- Devices ---------- */

  const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
  /**
   * A new device — or the same app paired again (its `install`, v0.41.2): then its old key stops working and it stays
   * what it was (the main device stays the main one). Returns whether it came back.
   */
  function addDevice(name, install) {
    const token = crypto.randomBytes(32).toString('base64url');
    const id = crypto.randomUUID();
    const inst = typeof install === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(install) ? install : null;
    const before = inst ? db.prepare('SELECT id FROM devices WHERE install = ? AND revoked = 0').all(inst) : [];
    const main = db.prepare("SELECT value FROM meta WHERE key = 'mainDevice'").get()?.value;
    db.prepare('INSERT INTO devices (id, name, token_hash, created_at, last_seen, install) VALUES (?, ?, ?, ?, ?, ?)').run(id, String(name || 'device').slice(0, 80), hash(token), now(), now(), inst);
    for (const d of before) {
      db.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run(d.id);
      if (d.id === main) db.prepare("UPDATE meta SET value = ? WHERE key = 'mainDevice'").run(id);
    }
    return { id, token, rejoined: before.length > 0, was: before.map((d) => d.id) };
  }
  const deviceByHash = db.prepare('SELECT id, name, revoked FROM devices WHERE token_hash = ?');
  const seen = db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?');
  const lastSeen = new Map();
  function deviceOf(token) {
    if (!token) return undefined;
    const d = deviceByHash.get(hash(token));
    if (!d || d.revoked) return undefined;
    const t = Date.now();
    if ((lastSeen.get(d.id) ?? 0) < t - 60_000) {
      lastSeen.set(d.id, t);
      seen.run(now(), d.id);
    }
    return { id: d.id, name: d.name };
  }
  const devices = () => db.prepare('SELECT id, name, created_at, last_seen, revoked FROM devices ORDER BY created_at').all();
  /** The hashes of the paired devices' keys: their channels on the relay (relay.mjs, v0.42.2). */
  const relayDevices = () => db.prepare('SELECT token_hash FROM devices WHERE revoked = 0').all().map((d) => d.token_hash);
  const revoke = (id) => db.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run(id);

  /* ---------- Files ---------- */

  const getFile = db.prepare('SELECT path, size, type, sha256 FROM files WHERE id = ? AND variant = ?');
  const putFile = db.prepare(
    `INSERT INTO files (id, variant, path, size, type, sha256, at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id, variant) DO UPDATE SET path = excluded.path, size = excluded.size, type = excluded.type,
       sha256 = excluded.sha256, at = excluded.at`,
  );

  /** Where a file of a photo (or PDF…) lives in the folder. */
  function placeFor(id, variant, type) {
    const media = record('media', id);
    const month = (media?.createdAt || now()).slice(0, 7);
    const ext = extOf(type || media?.mime);
    if (variant !== 'blob') return path.join(DIRS.previews, `${id}.${variant}.${ext === 'bin' ? 'jpg' : ext}`);
    if (ext === 'pdf' || media?.kind === 'pdf') return path.join(DIRS.files, `${id}.pdf`);
    return path.join(DIRS.media, month, `${id}.${ext}`);
  }

  /** Keep a file that came in (already written to `tmpPath`): moved to its place, indexed. */
  function keepFile(id, variant, type, tmpPath, size, sha256) {
    const rel = placeFor(id, variant, type);
    const abs = path.join(dataDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.renameSync(tmpPath, abs);
    const old = getFile.get(id, variant);
    if (old && old.path !== rel) fs.rmSync(path.join(dataDir, old.path), { force: true });
    putFile.run(id, variant, rel, size, type, sha256, now());
    if (variant === 'blob') mirrorDocument(id);
    return rel;
  }

  /** JPEG photos kept here with no card yet (v0.41.3) — for this computer to make them. */
  function photosWithoutCard(limit = 40) {
    const rows = db
      .prepare(
        "SELECT f.id, f.path FROM files f WHERE f.variant = 'blob' AND f.type = 'image/jpeg' AND NOT EXISTS (SELECT 1 FROM files c WHERE c.id = f.id AND c.variant = 'card') ORDER BY f.at DESC LIMIT ?",
      )
      .all(limit);
    return rows.map((r) => ({ id: r.id, abs: path.join(dataDir, r.path) })).filter((r) => fs.existsSync(r.abs));
  }

  /**
   * A device's key for its pictures and videos only (v0.41.3): a picture or a video element loads by an address, it
   * cannot send the device's own key — this one reads files and nothing else.
   */
  function mediaKey(deviceId) {
    let secret = db.prepare("SELECT value FROM meta WHERE key = 'mediaSecret'").get()?.value;
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      db.prepare("INSERT INTO meta (key, value) VALUES ('mediaSecret', ?) ON CONFLICT (key) DO NOTHING").run(secret);
      secret = db.prepare("SELECT value FROM meta WHERE key = 'mediaSecret'").get().value;
    }
    return crypto.createHmac('sha256', secret).update(String(deviceId)).digest('base64url').slice(0, 32);
  }
  /** The device of a file address (its id and media key), if it is still connected. */
  function mediaDevice(deviceId, key) {
    if (!deviceId || !key) return undefined;
    const d = db.prepare('SELECT id, name, revoked FROM devices WHERE id = ?').get(String(deviceId));
    if (!d || d.revoked) return undefined;
    const want = Buffer.from(mediaKey(d.id));
    const got = Buffer.from(String(key));
    return want.length === got.length && crypto.timingSafeEqual(want, got) ? { id: d.id, name: d.name } : undefined;
  }

  function file(id, variant) {
    const f = getFile.get(id, variant);
    if (!f) return undefined;
    const abs = path.join(dataDir, f.path);
    return fs.existsSync(abs) ? { ...f, abs } : undefined;
  }

  /** A PDF the app made (an invoice, a quotation…): a copy under «Документы», by kind and month, by its own name. */
  function mirrorDocument(id) {
    const media = record('media', id);
    const f = getFile.get(id, 'blob');
    if (!media || !f || (media.kind !== 'pdf' && extOf(f.type) !== 'pdf')) return;
    if (getFile.get(id, 'doc')) return;
    const folder = DOC_FOLDERS[media.ownerType] || 'Прочее';
    const month = (media.createdAt || now()).slice(0, 7);
    const base = safeName((media.name || `${id}.pdf`).replace(/\.pdf$/i, ''));
    let rel = path.join(DIRS.docs, folder, month, `${base}.pdf`);
    for (let n = 2; fs.existsSync(path.join(dataDir, rel)); n++) rel = path.join(DIRS.docs, folder, month, `${base} (${n}).pdf`);
    fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
    fs.copyFileSync(path.join(dataDir, f.path), path.join(dataDir, rel));
    putFile.run(id, 'doc', rel, f.size, f.type, f.sha256, now());
  }

  /* ---------- Daily copies of the database ---------- */

  function backup() {
    // By this computer's clock (Dubai): the copy of the day is the day here.
    const day = new Date().toLocaleDateString('sv');
    const dir = path.join(dataDir, DIRS.backups);
    const target = path.join(dir, `garage-${day}.db`);
    if (fs.existsSync(target)) return false;
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const old = fs
      .readdirSync(dir)
      .filter((f) => /^garage-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort();
    for (const f of old.slice(0, Math.max(0, old.length - keepBackups))) fs.rmSync(path.join(dir, f), { force: true });
    return true;
  }

  const metaGet = (k) => db.prepare('SELECT value FROM meta WHERE key = ?').get(k)?.value;
  const metaSet = (k, v) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(k, v);

  /*
   * The AI's answers (v0.49, ai.mjs): a VIN decoded, a name put right, a number found — kept here so a restart loses
   * none and every device gets the same answer for no tokens. A year's worth; the AI decides how long each serves.
   */
  const aiCacheGet = (k) => {
    const row = db.prepare('SELECT at, value FROM ai_cache WHERE k = ?').get(k);
    if (!row) return undefined;
    try {
      return { at: Number(row.at), value: JSON.parse(row.value) };
    } catch {
      return undefined;
    }
  };
  const aiCachePut = (k, kind, at, value) => db.prepare('INSERT INTO ai_cache (k, kind, at, value) VALUES (?, ?, ?, ?) ON CONFLICT (k) DO UPDATE SET kind = excluded.kind, at = excluded.at, value = excluded.value').run(k, String(kind), Number(at), JSON.stringify(value));
  const aiCachePrune = (olderThan) => db.prepare('DELETE FROM ai_cache WHERE at < ?').run(Number(olderThan)).changes;
  const aiCacheCount = () => Number(db.prepare('SELECT COUNT(*) AS n FROM ai_cache').get().n);

  return { dataDir, push, pull, replace, reserveNumbers, renumber, mainDevice, photosWithoutCard, mediaKey, mediaDevice, counts, lastRev: () => rev, record, addDevice, deviceOf, devices, relayDevices, revoke, keepFile, file, backup, metaGet, metaSet, aiCacheGet, aiCachePut, aiCachePrune, aiCacheCount, close: () => db.close() };
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function writeReadme(dataDir) {
  const p = path.join(dataDir, 'ПРОЧТИ.txt');
  if (fs.existsSync(p)) return;
  fs.writeFileSync(
    p,
    [
      'MyGarage — данные мастерской на этом компьютере.',
      '',
      'Служебное\\garage.db   — все записи приложения (заказы, клиенты, деньги, инвойсы…), база SQLite.',
      'Фото и видео\\ГГГГ-ММ   — фото, видео, голосовые и подписи, по месяцам.',
      'Документы\\…            — PDF, как их сделало приложение: инвойсы, сметы, акты, чеки, долги.',
      'Резервные копии\\       — копия базы каждый день (хранятся последние 30).',
      '',
      'Не переименовывайте и не удаляйте файлы в «Служебное» — сервер по ним находит фото.',
      'Копию всей мастерской даёт копия этой папки целиком.',
      '',
    ].join('\r\n'),
    'utf8',
  );
}
