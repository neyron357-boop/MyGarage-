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
 *   PUT  /api/media/:id/:variant         — a photo's (PDF's…) file: blob | thumb
 *   GET  /api/media/:id/:variant         — the file back
 *
 * Every call but the first two needs the device's key (`Authorization: Bearer …`). Only the app's own address may call
 * it from a page (CORS).
 */

const VARIANTS = new Set(['blob', 'thumb']);
const ID = /^[A-Za-z0-9._-]{1,120}$/;

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

export function createApi({ store, config, pairing, log, onSeen }) {
  return async function api(req, res) {
    const origin = req.headers.origin;
    const allowed = origin && config.origins.includes(origin);
    const cors = allowed
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Size',
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

      if (req.method === 'POST' && url.pathname === '/api/pair') {
        const body = await readJson(req, 4096);
        pairing.take(String(body.code ?? ''));
        const d = store.addDevice(body.name);
        log(`paired: ${body.name ?? 'device'} (${d.id})`);
        return send(res, 200, { token: d.token, deviceId: d.id, ...store.counts() });
      }

      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const device = store.deviceOf(token);
      if (!device) throw httpError(401, 'not paired');

      if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, { ok: true, version: VERSION, device: device.name, ...store.counts() });

      if (req.method === 'POST' && url.pathname === '/api/sync/push') {
        const body = await readJson(req);
        const rev = store.push(device.id, body.changes);
        return send(res, 200, { ok: true, rev, n: body.changes.length });
      }

      if (req.method === 'GET' && url.pathname === '/api/sync/pull') {
        return send(res, 200, store.pull(device.id, url.searchParams.get('since'), url.searchParams.get('limit')));
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
            return send(res, 200, { ok: true, size, sha256, path: rel });
          } finally {
            fs.rmSync(tmp, { force: true });
          }
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          const f = store.file(id, variant);
          if (!f) throw httpError(404, 'no such file');
          res.writeHead(200, { 'Content-Type': f.type || 'application/octet-stream', 'Content-Length': f.size, 'Cache-Control': 'private, max-age=31536000, immutable' });
          if (req.method === 'HEAD') return res.end();
          return pipeline(fs.createReadStream(f.abs), res);
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
