import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  `);
  let rev = Number(db.prepare('SELECT COALESCE(MAX(rev), 0) AS r FROM records').get().r);
  const now = () => new Date().toISOString();

  const getRecord = db.prepare('SELECT data, deleted FROM records WHERE tbl = ? AND id = ?');
  const putRecord = db.prepare(
    `INSERT INTO records (tbl, id, data, deleted, rev, device, at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tbl, id) DO UPDATE SET data = excluded.data, deleted = excluded.deleted, rev = excluded.rev,
       device = excluded.device, at = excluded.at`,
  );
  const pullRows = db.prepare('SELECT rev, tbl, id, data, deleted FROM records WHERE rev > ? AND (device IS NULL OR device <> ?) ORDER BY rev LIMIT ?');

  function record(tbl, id) {
    const row = getRecord.get(tbl, id);
    return row && !row.deleted ? JSON.parse(row.data) : undefined;
  }

  /** A device's changes: `{t, k, d}` (`d` null — deleted). Returns the number of the last one kept. */
  function push(deviceId, changes) {
    if (!Array.isArray(changes)) throw httpError(400, 'changes');
    const at = now();
    const touchedMedia = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const c of changes) {
        const tbl = String(c?.t ?? '');
        const id = String(c?.k ?? '');
        if (!TABLE.test(tbl) || !id || id.length > 300) throw httpError(400, `bad change ${tbl}/${id.slice(0, 40)}`);
        if (c.d === null || c.d === undefined) {
          putRecord.run(tbl, id, null, 1, ++rev, deviceId, at);
          continue;
        }
        if (typeof c.d !== 'object') throw httpError(400, `bad record ${tbl}/${id}`);
        let data = c.d;
        let by = deviceId;
        // A job's numbers only go up: a device behind gets the higher one back (it is sent to it too).
        if (tbl === 'counters') {
          const have = record(tbl, id);
          if (have && Number(have.value) > Number(data.value)) {
            data = have;
            by = null;
          }
        }
        const json = JSON.stringify(data);
        if (json.length > MAX_RECORD) throw httpError(413, `record too large ${tbl}/${id}`);
        putRecord.run(tbl, id, json, 0, ++rev, by, at);
        if (tbl === 'media') touchedMedia.push(id);
      }
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

  /** What changed after `since` (other devices' changes), oldest first. */
  function pull(deviceId, since, limit = 500) {
    const rows = pullRows.all(Number(since) || 0, deviceId, Math.min(Math.max(Number(limit) || 500, 1), 2000));
    const changes = rows.map((r) => ({ r: Number(r.rev), t: r.tbl, k: r.id, d: r.deleted ? null : JSON.parse(r.data) }));
    const more = rows.length === Math.min(Math.max(Number(limit) || 500, 1), 2000);
    // Nothing more: the device is up to date with everything, its own changes included.
    return { changes, cursor: more ? changes[changes.length - 1].r : rev, more };
  }

  function counts() {
    const recs = db.prepare('SELECT tbl, COUNT(*) AS n FROM records WHERE deleted = 0 GROUP BY tbl').all();
    const files = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM files WHERE variant = 'blob'").get();
    const byTable = Object.fromEntries(recs.map((r) => [r.tbl, Number(r.n)]));
    return { records: recs.reduce((s, r) => s + Number(r.n), 0), byTable, files: Number(files.n), bytes: Number(files.bytes), rev };
  }

  /* ---------- Devices ---------- */

  const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
  function addDevice(name) {
    const token = crypto.randomBytes(32).toString('base64url');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO devices (id, name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(id, String(name || 'device').slice(0, 80), hash(token), now(), now());
    return { id, token };
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

  return { dataDir, push, pull, counts, record, addDevice, deviceOf, devices, revoke, keepFile, file, backup, metaGet, metaSet, close: () => db.close() };
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
