import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { VERSION } from './config.mjs';
import { DIRS, httpError } from './store.mjs';

/*
 * The API the app calls (through the tunnel, from any network):
 *
 *   GET  /api/health                     — is it there (no sign-in)
 *   POST /api/pair    {code, name}       — a new device with the code shown on this computer → its key
 *   GET  /api/status                     — how much is kept here
 *   POST /api/sync/push {changes}        — the device's changes
 *   GET  /api/sync/pull?since=N          — other devices' changes after N
 *   GET  /api/sync/events                — a stream: told at once when other devices' changes are kept (v0.41.2)
 *   POST /api/sync/replace {keys, counters} — the main device's data becomes the garage's (what it lacks is deleted)
 *   POST /api/forget                     — this device leaves (its key no longer works)
 *   PUT  /api/media/:id/:variant         — a photo's (PDF's…) file: blob | thumb | card (1080 px, v0.41.3)
 *   GET  /api/media/:id/:variant         — the file back, in parts when asked (Range: a video plays as it comes);
 *                                          by the device's key, or by `?d=<device>&k=<media key>` — a picture or a
 *                                          video element's own address (it cannot send a key; this one reads files only)
 *
 * Every call but the first two needs the device's key (`Authorization: Bearer …`). Only the app's own address may call
 * it from a page (CORS).
 */

const VARIANTS = new Set(['blob', 'thumb', 'card']);
/**
 * The app's sync rules this server needs (v0.41.2): an older app (no `X-Sync: 2`) sends everything it has at
 * connecting, before the choice, and over newer records — it may not send or connect; it is told to update.
 */
const SYNC = 2;
const UPDATE = 'Обновите приложение: закройте его и откройте снова';
const ID = /^[A-Za-z0-9._-]{1,120}$/;

/** A file sent whole, or the part asked for (`Range: bytes=a-b`): a video starts as soon as its first part is in. */
function sendFile(req, res, f) {
  const head = {
    'Content-Type': f.type || 'application/octet-stream',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
  };
  const size = Number(f.size) || fs.statSync(f.abs).size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (!(start <= end) || start >= size) {
      res.writeHead(416, { ...head, 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    start = Math.max(0, start);
    res.writeHead(206, { ...head, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
    if (req.method === 'HEAD') return res.end();
    return pipeline(fs.createReadStream(f.abs, { start, end }), res);
  }
  res.writeHead(200, { ...head, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  return pipeline(fs.createReadStream(f.abs), res);
}

function send(res, status, body, headers = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json);
}

async function readJson(req, max = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw httpError(413, 'too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw httpError(400, 'bad json');
  }
}

/** Pairing codes: one at a time, for 15 minutes; wrong tries are counted (after 10 — no pairing for 10 minutes). */
export function createPairing() {
  let current = null;
  let fails = [];
  return {
    issue() {
      current = { code: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'), until: Date.now() + 15 * 60_000 };
      return current;
    },
    current: () => (current && current.until > Date.now() ? current : null),
    take(code) {
      const t = Date.now();
      fails = fails.filter((x) => x > t - 10 * 60_000);
      if (fails.length >= 10) throw httpError(429, 'too many tries, wait 10 minutes');
      const ok = current && current.until > t && typeof code === 'string' && code.replace(/\D/g, '') === current.code;
      if (!ok) {
        fails.push(t);
        throw httpError(403, 'wrong or expired code');
      }
      current = null;
    },
  };
}

export function createApi({ store, config, pairing, log, onSeen, events, cards }) {
  return async function api(req, res) {
    const origin = req.headers.origin;
    const allowed = origin && config.origins.includes(origin);
    const cors = allowed
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Size, X-Sync',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        }
      : {};
    if (req.method === 'OPTIONS') {
      res.writeHead(allowed ? 204 : 403, cors);
      return res.end();
    }
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://local');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      // The address the phone uses (seen once it comes through the tunnel): shown on this computer's page.
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (host && !/^(localhost|127\.|\[::1\])/.test(String(host))) onSeen?.(String(host));

      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, app: 'mygarage-server', version: VERSION });

      if ((req.method === 'GET' || req.method === 'HEAD') && parts[0] === 'api' && parts[1] === 'media' && parts.length === 4 && url.searchParams.has('k')) {
        const [, , id, variant] = parts;
        if (!ID.test(id) || !VARIANTS.has(variant)) throw httpError(400, 'bad media address');
        if (!store.mediaDevice(url.searchParams.get('d'), url.searchParams.get('k'))) throw httpError(401, 'not paired');
        const f = store.file(id, variant);
        if (!f) throw httpError(404, 'no such file');
        return sendFile(req, res, f);
      }

      const modern = Number(req.headers['x-sync']) >= SYNC;
      if (req.method === 'POST' && url.pathname === '/api/pair') {
        if (!modern) throw httpError(426, UPDATE);
        const body = await readJson(req, 4096);
        pairing.take(String(body.code ?? ''));
        const d = store.addDevice(body.name, body.install);
        for (const old of d.was) events?.drop(old);
        log(`paired: ${body.name ?? 'device'} (${d.id})${d.rejoined ? ` — the same app again (was ${d.was.join(', ')})` : ''}`);
        return send(res, 200, { token: d.token, deviceId: d.id, mediaKey: store.mediaKey(d.id), rejoined: d.rejoined, main: store.mainDevice(), ...store.counts() });
      }

      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const device = store.deviceOf(token);
      if (!device) throw httpError(401, 'not paired');

      if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, { ok: true, version: VERSION, device: device.name, mediaKey: store.mediaKey(device.id), main: store.mainDevice(), ...store.counts() });

      // The main device's data becomes the garage's: only it may do this (or any device, while there is none).
      if (req.method === 'POST' && url.pathname === '/api/sync/replace') {
        if (!modern) throw httpError(426, UPDATE);
        const main = store.mainDevice();
        if (main && main.id !== device.id) throw httpError(409, `the main device is ${main.name}`);
        const body = await readJson(req);
        const r = store.replace(device.id, body.keys, body.counters);
        events?.changed(r.rev, device.id);
        log(`main device: ${device.name} (${device.id}); ${r.removed} records it did not have deleted`);
        return send(res, 200, { ok: true, ...r });
      }

      if (req.method === 'POST' && url.pathname === '/api/forget') {
        store.revoke(device.id);
        events?.drop(device.id);
        log(`left: ${device.name} (${device.id})`);
        return send(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/sync/push') {
        if (!modern) throw httpError(426, UPDATE);
        const body = await readJson(req);
        const rev = store.push(device.id, body.changes);
        // The other devices are told at once: they take it now, not at the minute's check.
        if (body.changes.length) events?.changed(rev, device.id);
        return send(res, 200, { ok: true, rev, n: body.changes.length });
      }

      if (req.method === 'GET' && url.pathname === '/api/sync/events' && events) {
        events.open(req, res, device.id, store.lastRev());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/sync/pull') {
        return send(res, 200, { ...store.pull(device.id, url.searchParams.get('since'), url.searchParams.get('limit')), main: store.mainDevice(), mediaKey: store.mediaKey(device.id) });
      }

      if (parts[0] === 'api' && parts[1] === 'media' && parts.length === 4) {
        const [, , id, variant] = parts;
        if (!ID.test(id) || !VARIANTS.has(variant)) throw httpError(400, 'bad media address');
        if (req.method === 'PUT') {
          const type = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100);
          const expected = Number(req.headers['x-size']);
          const tmp = path.join(store.dataDir, DIRS.tmp, `${id}.${variant}.${crypto.randomBytes(4).toString('hex')}`);
          const h = crypto.createHash('sha256');
          let size = 0;
          try {
            await pipeline(
              req,
              async function* (source) {
                for await (const chunk of source) {
                  size += chunk.length;
                  if (size > config.maxFileBytes) throw httpError(413, 'file too large');
                  h.update(chunk);
                  yield chunk;
                }
              },
              fs.createWriteStream(tmp),
            );
            if (Number.isFinite(expected) && expected !== size) throw httpError(400, `size ${size} ≠ ${expected}`);
            const sha256 = h.digest('hex');
            const rel = store.keepFile(id, variant, type, tmp, size, sha256);
            // A photo sent without its card (an older app): this computer makes one.
            if (variant === 'blob' && /^image\/jpeg/.test(type) && !store.file(id, 'card')) cards?.later();
            return send(res, 200, { ok: true, size, sha256, path: rel });
          } finally {
            fs.rmSync(tmp, { force: true });
          }
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          const f = store.file(id, variant);
          if (!f) throw httpError(404, 'no such file');
          return sendFile(req, res, f);
        }
      }
      throw httpError(404, 'not found');
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) log(`error ${req.method} ${url.pathname}: ${e.stack || e.message}`);
      if (!res.headersSent) send(res, status, { ok: false, error: e.message });
      else res.destroy();
    }
  };
}
