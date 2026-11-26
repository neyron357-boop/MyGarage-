import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser } from '../whatsapp/browser.mjs';
import { liteRow } from '../whatsapp/rows.mjs';
import { DIRS, httpError } from './store.mjs';
import { createHistoryLoader } from './waHistory.mjs';
import { createOutbox } from './waOutbox.mjs';

/*
 * The garage's WhatsApp for the app (v0.78): this server starts the bridge (server/whatsapp/bridge.mjs — WhatsApp Web
 * as a linked device, a process of its own with its own dependencies; this server has none) and stands between it and
 * the app. The app's calls come here with the device's key, as every call does; the bridge listens on 127.0.0.1 only
 * and answers only to the secret made here at each start.
 *
 *   GET  /api/wa/status                         — where it stands (and the QR while waiting to be linked)
 *   POST /api/wa/link · /logout · /restart      — link this computer, unlink it, start WhatsApp Web again
 *   POST /api/wa/code {phone}                   — link by a code typed on the phone
 *   GET  /api/wa/chats · /messages?chat= · /number?phone=
 *   GET  /api/wa/history?chat=&limit=&before= — a chat's history, light, as deep as WhatsApp Web has it (v0.91.1)
 *   POST /api/wa/history-sync {chat}         — ask the phone for a chat's older messages (v0.91.1)
 *   GET  /api/wa/history-state · POST /api/wa/history-run — this server fetching the older messages by itself (v0.91.3,
 *        waHistory.mjs): where it stands; a pass now
 *   POST /api/wa/send {chat, text, quote} · /seen {chat} · /forward {id, to} (v0.80.3) · /delete {id} (v0.83: ours, for
 *        everyone — while WhatsApp allows it)
 *   POST /api/wa/file?chat=&name=&caption=      — a file (the body is its bytes)
 *        `key` on a send or a file (v0.84) — the app's own: the same key again is the same message, never a second one
 *   GET  /api/wa/media?id= · /avatar?id=        — a message's file, a chat's picture: by the device's key, or by
 *                                                 `?d=<device>&k=<media key>` (a picture element sends no key)
 *
 * What WhatsApp says (a message, its ticks, the state) goes to every device on its open stream (events.mjs `tell`).
 * Not installed (no `npm install` in server/whatsapp), no browser, Docker — said as a state, nothing is started.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_FILE = 50 * 1024 * 1024;

export function createWhatsApp({ config, store, log = () => {}, events, port = Number(process.env.WA_PORT) || 8790, bridge = null, dir = path.join(here, '..', 'whatsapp') }) {
  /** A test's own bridge (already running): nothing is started here. */
  const given = bridge;
  const base = given?.url ?? `http://127.0.0.1:${port}`;
  const secret = given?.secret ?? crypto.randomBytes(24).toString('hex');
  const installed = () => !!given || fs.existsSync(path.join(dir, 'node_modules', 'whatsapp-web.js', 'package.json'));
  const browser = given ? 'test' : findBrowser();
  const available = () => installed() && !!browser;
  const turnedOn = () => store.metaGet('whatsapp') === 'on';

  let child = null;
  let stopping = false;
  let respawn = null;
  let pause = 2000;
  /** What the bridge last said of itself. */
  let last = null;
  let listening = null;

  /* ----- The bridge's process ----- */

  function run() {
    if (given || child || stopping || !available()) return;
    const started = Date.now();
    child = spawn(process.execPath, ['bridge.mjs'], {
      cwd: dir,
      env: { ...process.env, WA_PORT: String(port), WA_SECRET: secret, WA_DATA: path.join(config.dataDir, DIRS.service, 'whatsapp'), WA_PARENT: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const said = (buf) => {
      for (const line of String(buf).split(/\r?\n/)) if (line.trim()) log(`wa: ${line.trim().slice(0, 400)}`);
    };
    child.stdout.on('data', said);
    child.stderr.on('data', said);
    child.stdin.on('error', () => undefined);
    const me = child;
    me.on('exit', (code) => {
      if (child === me) child = null;
      last = null;
      listening?.destroy();
      listening = null;
      if (stopping) return;
      log(`wa: the bridge ended (${code})`);
      tell({ t: 'state', state: status() });
      if (!turnedOn()) return;
      // Ran a while: again at once. Ended right away again and again: less often, up to a minute.
      pause = Date.now() - started > 60_000 ? 2000 : Math.min(60_000, pause * 2);
      respawn = setTimeout(run, pause);
      respawn.unref?.();
    });
    me.on('error', (e) => log(`wa: the bridge did not start: ${e.message}`));
    listen();
  }

  /** The bridge told to go: its end of the pipe closes — it closes the browser and ends; by force if it does not. */
  function end() {
    clearTimeout(respawn);
    const me = child;
    if (!me) return;
    try {
      me.stdin.end();
    } catch {
      // gone already
    }
    const force = setTimeout(() => me.exitCode === null && me.kill(), 12_000);
    force.unref?.();
  }

  /* ----- Asking the bridge ----- */

  async function call(pathname, { method = 'GET', body, timeout = 100_000 } = {}) {
    let res;
    try {
      res = await fetch(base + pathname, {
        method,
        headers: { 'X-Bridge': secret, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      // Not up yet (it starts in a second or two), or ended: the app asks again.
      throw httpError(503, 'whatsapp is starting');
    }
    let json = {};
    try {
      json = await res.json();
    } catch {
      json = {};
    }
    if (!res.ok) throw httpError(res.status, json.error || `whatsapp ${res.status}`);
    return json;
  }

  /** The bridge is up and answering (it takes a second after it is started). */
  async function up(ms = 15_000) {
    const until = Date.now() + ms;
    for (;;) {
      try {
        return await call('/status', { timeout: 3000 });
      } catch (e) {
        if (Date.now() > until) throw e;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  /** A file through: the app's request to the bridge, the bridge's answer back (in parts when asked). */
  function pipe(req, res, pathname, { headers = {}, body = false } = {}) {
    return new Promise((resolve) => {
      const out = http.request(
        base + pathname,
        {
          method: req.method,
          headers: {
            'X-Bridge': secret,
            ...(req.headers.range ? { Range: req.headers.range } : {}),
            ...(body && req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
            ...(body && req.headers['content-length'] ? { 'Content-Length': req.headers['content-length'] } : {}),
          },
        },
        (got) => {
          const pass = {};
          for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'x-file-name']) if (got.headers[h]) pass[h] = got.headers[h];
          res.writeHead(got.statusCode || 502, { ...pass, ...headers });
          got.pipe(res);
          got.on('end', resolve);
          got.on('error', () => {
            res.destroy();
            resolve();
          });
        },
      );
      out.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
          res.end(JSON.stringify({ ok: false, error: 'whatsapp is starting' }));
        } else res.destroy();
        resolve();
      });
      // The device went away mid-file: the bridge is not kept waiting.
      res.on('close', () => out.destroy());
      if (body) req.pipe(out);
      else out.end();
    });
  }

  /* ----- What the bridge says, to the devices ----- */

  function tell(event) {
    events?.tell?.({ wa: event });
  }

  /** The bridge's stream was closed (or went silent) and is open again: what it said meanwhile was not heard (v0.87). */
  let missed = false;
  function listen() {
    if (listening || stopping) return;
    // The bridge says something every 15 s at least: silent for 50 — a stream that is there and dead; opened anew.
    let heard = Date.now();
    const req = http.get(`${base}/events`, { headers: { 'X-Bridge': secret } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return;
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        heard = Date.now();
        if (missed) {
          // The devices read again what they show (v0.87): a message said while nobody listened is not lost.
          missed = false;
          tell({ t: 'gap' });
        }
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('');
          if (!data) continue;
          try {
            const ev = JSON.parse(data);
            if (ev.t === 'state') {
              const was = last?.phase;
              last = ev.state;
              tell({ t: 'state', state: status() });
              // Ready again (v0.91.3): the older messages fetched from the phone a minute later.
              if (ev.state?.phase === 'ready' && was !== 'ready') history.ready();
            } else {
              // The garage wrote from its phone: WhatsApp is open there — the phone may answer now (v0.91.3).
              if (ev.t === 'msg' && ev.msg?.me && !ev.was) history.nudge();
              // How many chats there are and how many messages wait: kept with the state (this computer's page shows them).
              if (last && ev.t === 'chats') last = { ...last, chats: ev.n, unread: ev.unread };
              if (last && ev.t === 'chat' && typeof ev.unread === 'number') last = { ...last, unread: ev.unread };
              // When WhatsApp was last heard (v0.87): this computer's page sees whether it is live.
              if (last && ev.t === 'msg' && !ev.was) last = { ...last, heardAt: Date.now() };
              tell(ev);
            }
          } catch {
            // not ours
          }
        }
      });
    });
    listening = req;
    const quiet = setInterval(() => {
      if (Date.now() - heard > 50_000) req.destroy();
    }, 10_000);
    quiet.unref?.();
    const closed = () => {
      clearInterval(quiet);
      if (listening !== req) return;
      listening = null;
      missed = true;
      // The bridge still there (or a test's): heard again in a moment.
      if (!stopping && (child || given)) setTimeout(listen, 1500).unref?.();
    };
    req.on('error', closed);
    req.on('close', closed);
  }

  /** Where it stands, for the app and this computer's page. */
  function status() {
    const off = { phase: 'off', linked: false, qr: '', qrAt: 0, code: '', loading: 0, me: null, platform: '', web: '', error: '', chats: 0, unread: 0 };
    return {
      ok: true,
      /** The bridge can run here: its packages are installed and there is a browser. */
      available: available(),
      installed: installed(),
      browser: !!browser,
      on: turnedOn(),
      ...(last ?? off),
      // What waits to go by itself, what did not go (v0.79).
      outbox: outbox.counts(),
      // Started and not heard yet: starting, not off.
      ...(!last && (child || given) && turnedOn() ? { phase: 'starting' } : {}),
    };
  }

  /* ----- What goes by itself (v0.79, waOutbox.mjs) ----- */

  const outbox = createOutbox({
    dir: path.join(config.dataDir, DIRS.service, 'whatsapp', 'outbox'),
    store,
    ready: () => available() && turnedOn() && last?.phase === 'ready',
    tell,
    log,
    bridge: {
      json: (p, init = {}) => call(p, { ...init, timeout: 90_000 }),
      async file({ chat, name, caption, mime, doc, bytes }) {
        const q = new URLSearchParams({ chat, name: name || 'file' });
        if (caption) q.set('caption', caption);
        if (doc) q.set('doc', '1');
        let res;
        try {
          res = await fetch(`${base}/file?${q}`, { method: 'POST', headers: { 'X-Bridge': secret, 'Content-Type': mime || 'application/octet-stream' }, body: bytes, signal: AbortSignal.timeout(300_000) });
        } catch {
          throw httpError(503, 'whatsapp is starting');
        }
        if (!res.ok) throw httpError(res.status, (await res.json().catch(() => ({}))).error || `whatsapp ${res.status}`);
        return res.json();
      },
    },
  });

  /* ----- The app's calls ----- */

  const query = (url, keys) => {
    const q = new URLSearchParams();
    for (const k of keys) if (url.searchParams.has(k)) q.set(k, url.searchParams.get(k));
    const s = q.toString();
    return s ? `?${s}` : '';
  };

  /**
   * `/api/wa/…` for a device already known (`send`, `readJson` — the API's own). True when the call was this module's.
   */
  async function api(req, res, { url, parts, send, readJson, device }) {
    if (parts[0] !== 'api' || parts[1] !== 'wa' || parts.length !== 3) return false;
    const what = parts[2];
    const get = req.method === 'GET' || req.method === 'HEAD';
    if (get && what === 'status') {
      // Fresh from the bridge when it is there (the stream may have missed a word).
      if (child || given) {
        try {
          last = await call('/status', { timeout: 4000 });
        } catch {
          // as last heard
        }
      }
      send(res, 200, status());
      return true;
    }
    if (!available()) throw httpError(503, installed() ? 'whatsapp: no browser on the server' : 'whatsapp is not installed on the server');

    // What goes by itself (v0.79): taken even while WhatsApp is not answering — it waits here.
    if (req.method === 'POST' && what === 'outbox') {
      const body = await readJson(req, 32 * 1024 * 1024);
      const list = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
      send(res, 200, { ok: true, items: list.map((x) => outbox.put(x, device?.name)) });
      return true;
    }
    if (get && what === 'outbox') {
      const keys = (url.searchParams.get('keys') || '').split(',').filter(Boolean).slice(0, 200);
      send(res, 200, { ok: true, items: outbox.list(keys), ...outbox.counts() });
      return true;
    }
    if (req.method === 'POST' && (what === 'outbox-retry' || what === 'outbox-drop')) {
      const body = await readJson(req, 4096);
      send(res, 200, { ok: true, item: what === 'outbox-retry' ? outbox.retry(body.key) : outbox.drop(body.key) });
      return true;
    }

    if (req.method === 'POST' && what === 'link') {
      store.metaSet('whatsapp', 'on');
      run();
      await up();
      last = await call('/start', { method: 'POST' });
      log(`wa: linking asked by ${device?.name ?? 'this computer'}`);
      send(res, 200, status());
      return true;
    }
    if (req.method === 'POST' && what === 'logout') {
      try {
        if (child || given) last = await call('/logout', { method: 'POST', timeout: 60_000 });
      } finally {
        // Unlinked: nothing runs until it is linked again.
        store.metaSet('whatsapp', 'off');
        end();
        last = null;
      }
      log(`wa: unlinked by ${device?.name ?? 'this computer'}`);
      tell({ t: 'state', state: status() });
      send(res, 200, status());
      return true;
    }
    if (req.method === 'POST' && what === 'restart') {
      if (!turnedOn()) throw httpError(409, 'whatsapp is off');
      run();
      await up();
      last = await call('/restart', { method: 'POST' });
      send(res, 200, status());
      return true;
    }
    if (!turnedOn()) throw httpError(409, 'whatsapp is off');

    if (req.method === 'POST' && what === 'code') {
      const body = await readJson(req, 4096);
      last = await call('/code', { method: 'POST', body: { phone: body.phone }, timeout: 70_000 });
      send(res, 200, status());
      return true;
    }
    if (get && what === 'chats') return send(res, 200, await call(`/chats${query(url, ['limit'])}`)), true;
    if (get && what === 'messages') {
      const got = await call(`/messages${query(url, ['chat', 'limit'])}`);
      // `lite` (v0.91): only who, when, the kind and the words — a chat studied by the app (services/chatStudy.ts).
      if (url.searchParams.get('lite') === '1' && Array.isArray(got?.messages)) got.messages = got.messages.map(liteRow).filter(Boolean);
      return send(res, 200, got), true;
    }
    if (get && what === 'number') return send(res, 200, await call(`/number${query(url, ['phone'])}`, { timeout: 40_000 })), true;
    // v0.91.1 (the owner: «чтобы ИИ посмотрел абсолютно все истории»): a chat read deep, and its older messages asked of the phone.
    if (get && what === 'history-state') return send(res, 200, history.summary()), true;
    if (req.method === 'POST' && what === 'history-run') return send(res, 200, history.run()), true;
    if (get && what === 'history') return send(res, 200, await call(`/history${query(url, ['chat', 'limit', 'before'])}`, { timeout: 160_000 })), true;
    if (req.method === 'POST' && what === 'history-sync') {
      const body = await readJson(req, 4096);
      send(res, 200, await call('/history-sync', { method: 'POST', body: { chat: body.chat }, timeout: 90_000 }));
      return true;
    }
    if (req.method === 'POST' && what === 'send') {
      const body = await readJson(req, 256 * 1024);
      // `key` (v0.84): the app's own key of this send — sent again under it, it is not sent twice (whatsapp/once.mjs).
      send(res, 200, await call('/send', { method: 'POST', body: { chat: body.chat, text: body.text, quote: body.quote, key: body.key }, timeout: 70_000 }));
      return true;
    }
    if (req.method === 'POST' && what === 'forward') {
      const body = await readJson(req, 4096);
      send(res, 200, await call('/forward', { method: 'POST', body: { id: body.id, to: body.to }, timeout: 90_000 }));
      return true;
    }
    if (req.method === 'POST' && what === 'delete') {
      const body = await readJson(req, 4096);
      send(res, 200, await call('/delete', { method: 'POST', body: { id: body.id }, timeout: 60_000 }));
      return true;
    }
    if (req.method === 'POST' && what === 'seen') {
      const body = await readJson(req, 4096);
      send(res, 200, await call('/seen', { method: 'POST', body: { chat: body.chat }, timeout: 40_000 }));
      return true;
    }
    if (req.method === 'POST' && what === 'file') {
      if (Number(req.headers['content-length']) > MAX_FILE) throw httpError(413, 'file too large');
      await pipe(req, res, `/file${query(url, ['chat', 'name', 'caption', 'doc', 'quote', 'voice', 'key'])}`, { body: true });
      return true;
    }
    if (get && (what === 'media' || what === 'avatar')) {
      await pipe(req, res, `/${what}${query(url, ['id'])}`);
      return true;
    }
    return false;
  }

  /* ----- The older messages, fetched from the phone by this server itself (v0.91.3, waHistory.mjs) ----- */

  const history = createHistoryLoader({
    file: path.join(config.dataDir, DIRS.service, 'whatsapp', 'history.json'),
    ready: () => available() && turnedOn() && last?.phase === 'ready',
    tell,
    log,
    bridge: { json: (p, init = {}) => call(p, { ...init, timeout: 90_000 }) },
  });

  /** A message's file or a chat's picture for an element of the page: the device's media key is the permission. */
  async function file(req, res, { url, parts }) {
    const what = parts[2];
    if (!available() || !turnedOn()) throw httpError(503, 'whatsapp is off');
    // Any page may read it with the key (as the garage's own photos): the browser keeps one answer for all.
    await pipe(req, res, `/${what}${query(url, ['id'])}`, { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  return {
    /** With the server: back, if it was on. */
    start() {
      if (turnedOn() && available()) run();
      if (given) listen();
      outbox.start();
      history.start();
    },
    stop() {
      stopping = true;
      outbox.stop();
      history.stop();
      clearTimeout(respawn);
      listening?.destroy();
      end();
    },
    status,
    available,
    api,
    outbox,
    history,
    file,
    /** This computer's page: link, unlink, start again — as the app does. */
    async admin(what) {
      const fake = { method: 'POST', headers: {} };
      let out = null;
      await api(fake, null, { url: new URL('http://local/'), parts: ['api', 'wa', what], send: (_res, _status, body) => (out = body), readJson: async () => ({}), device: null });
      return out ?? status();
    },
  };
}
