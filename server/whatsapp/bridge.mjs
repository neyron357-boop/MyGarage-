/*
 * The garage's WhatsApp, as one linked device of its account (v0.78, the user: «не через API, а через браузерный
 * метод, как связанные устройства»; «полная интеграция, профессиональная панель»): WhatsApp Web itself, run by
 * whatsapp-web.js in this computer's own Chrome without a window. A process of its own beside the server (the server
 * stays without dependencies): the server starts it (src/whatsapp.mjs), asks it over 127.0.0.1 with a secret only the
 * two know, and passes the app's calls on after checking the device's key. Nothing here is reachable from outside.
 *
 * What is kept on this computer (`<data>/Служебное/whatsapp`): the session (the whole account — never in the repo, the
 * app's data or a backup that leaves the computer), files the app opened (30 days) and contacts' pictures. Chats and
 * messages are not copied anywhere: they are read from WhatsApp Web when the app asks.
 *
 *   GET  /status                      — where it stands: off · starting · qr · loading · ready · offline
 *   POST /start · /restart · /logout  — begin linking (a QR appears), start again, unlink this computer
 *   POST /code {phone}                — link by a code typed on the phone instead of the QR
 *   GET  /chats?limit=                — the chats, the newest first
 *   GET  /messages?chat=&limit=       — a chat's last messages
 *   GET  /media?id=                   — a message's file (in parts when asked: a video plays as it comes)
 *   GET  /avatar?id=                  — a chat's picture
 *   POST /send {chat, text, quote}    — a text
 *   POST /file?chat=&name=&caption=&doc=&quote=&voice= — a file (the body is its bytes); voice=1 — a recording, sent as
 *        WhatsApp's own voice message (Opus in Ogg — voice.mjs)
 *   POST /seen {chat}                 — the chat is read
 *   GET  /number?phone=               — is this number on WhatsApp, and its chat
 *   GET  /events                      — a stream: a message, its ticks, a chat's unread, the state
 *
 * It writes only when the app asks: no bulk, nothing by itself (and no more than 25 sends a minute — an unofficial
 * client that floods is what WhatsApp bans).
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import QRCode from 'qrcode';
import wweb from 'whatsapp-web.js';
import { findBrowser } from './browser.mjs';
import { CHAT_ID, chatRow, lastRow, MESSAGE_ID, messageRow, phoneOf, sortChats } from './rows.mjs';
import { oggOpus, PAGE_OPUS } from './voice.mjs';

const { Client, LocalAuth, MessageMedia } = wweb;

const PORT = Number(process.env.WA_PORT) || 8790;
const SECRET = process.env.WA_SECRET || '';
const DATA = process.env.WA_DATA || path.join(process.env.DATA_DIR || (process.platform === 'win32' ? 'C:\\MyGarage' : '/data'), 'Служебное', 'whatsapp');
const SESSION = path.join(DATA, 'session-garage');
const MARK = path.join(DATA, 'linked.json');
const MEDIA = path.join(DATA, 'media');
const AVATARS = path.join(DATA, 'avatars');
const MAX_FILE = 50 * 1024 * 1024;

const browser = findBrowser();

for (const d of [DATA, MEDIA, AVATARS]) fs.mkdirSync(d, { recursive: true });

// No message's words and no number is ever written to the log.
const log = (...a) => console.log(a.join(' '));
const httpError = (status, message) => Object.assign(new Error(message), { status });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${ms / 1000} s`)), ms).unref())]);

/* ---------- The state ---------- */

const readMark = () => {
  try {
    return JSON.parse(fs.readFileSync(MARK, 'utf8'));
  } catch {
    return null;
  }
};
const state = {
  phase: 'off',
  /** This computer is a linked device of the account (it was linked and not unlinked since). */
  linked: !!readMark(),
  qr: '',
  qrAt: 0,
  /** The code to type on the phone (linking without the QR). */
  code: '',
  loading: 0,
  me: readMark()?.me ?? null,
  platform: '',
  web: '',
  browser: browser ? path.basename(browser) : '',
  error: browser ? '' : 'no browser',
  since: Date.now(),
  readyAt: 0,
  chats: 0,
  unread: 0,
};
const publicState = () => ({ ...state });

const streams = new Set();
function emit(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of [...streams]) {
    try {
      res.write(line);
    } catch {
      streams.delete(res);
    }
  }
}
function set(phase, extra = {}) {
  const was = state.phase;
  Object.assign(state, extra, { phase });
  if (was !== phase) {
    state.since = Date.now();
    log(`state: ${phase}${extra.error ? ` (${extra.error})` : ''}`);
  }
  emit({ t: 'state', state: publicState() });
}
function mark(me) {
  state.linked = true;
  state.me = me;
  try {
    fs.writeFileSync(MARK, JSON.stringify({ me, at: new Date().toISOString() }));
  } catch {
    // said again at the next start
  }
}
function unmark() {
  state.linked = false;
  state.me = null;
  fs.rmSync(MARK, { force: true });
}

/* ---------- The client ---------- */

let client = null;
let retry = null;
let tries = 0;
let meId = '';

/** A Chrome left behind by a bridge that was ended, still holding the session's folder: a new one could not open it. */
function endStrays() {
  if (process.platform !== 'win32') return Promise.resolve();
  const like = SESSION.replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${like}') -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  return new Promise((done) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 20_000 }, () => done()));
}

async function drop(c) {
  if (client === c) client = null;
  index.clear();
  count();
  try {
    await within(c.destroy(), 15_000, 'close');
  } catch {
    // a browser that would not close is ended at the next start (endStrays)
  }
}

function again(why) {
  clearTimeout(retry);
  tries++;
  // 10 s, 20 s, 40 s … up to 5 minutes: WhatsApp or the network back — the bridge is too.
  const ms = Math.min(5 * 60_000, 10_000 * 2 ** Math.min(tries - 1, 5));
  log(`again in ${Math.round(ms / 1000)} s (${why})`);
  retry = setTimeout(() => void start(), ms);
  retry.unref?.();
}

async function start() {
  if (client || !browser) return;
  clearTimeout(retry);
  set('starting', { error: '', qr: '', code: '', loading: 0 });
  await endStrays();
  if (client) return;
  const c = new Client({
    authStrategy: new LocalAuth({ dataPath: DATA, clientId: 'garage' }),
    webVersionCache: { type: 'local', path: path.join(DATA, 'web-cache') },
    puppeteer: { executablePath: browser, headless: true, args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'] },
    deviceName: 'MyGarage',
    browserName: 'Chrome',
    // Not linked and nobody scans: the QR is renewed some three minutes, then the browser is closed.
    qrMaxRetries: 8,
  });
  client = c;
  wire(c);
  c.initialize().catch(async (e) => {
    if (client !== c) return;
    const error = String(e?.message || e).slice(0, 200);
    log(`start failed: ${error}`);
    await drop(c);
    // Linked: tried again by itself. Not linked: it waits to be asked.
    if (state.linked) {
      set('offline', { error });
      again('start failed');
    } else set('off', { error });
  });
}

function wire(c) {
  const mine = (fn) => (...a) => {
    if (client !== c) return undefined;
    try {
      const r = fn(...a);
      if (r && typeof r.catch === 'function') r.catch((e) => log(`event: ${e?.message || e}`));
      return r;
    } catch (e) {
      log(`event: ${e?.message || e}`);
      return undefined;
    }
  };
  c.on(
    'qr',
    mine(async (qr) => {
      // Asked for a QR though it was linked: unlinked on the phone while this computer was off.
      if (state.linked) unmark();
      const picture = await QRCode.toDataURL(qr, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
      set('qr', { qr: picture, qrAt: Date.now(), error: '' });
    }),
  );
  c.on(
    'code',
    mine((code) => {
      state.code = String(code || '');
      emit({ t: 'state', state: publicState() });
    }),
  );
  c.on(
    'authenticated',
    mine(() => {
      if (state.phase !== 'ready') set('loading', { qr: '', code: '' });
    }),
  );
  c.on(
    'loading_screen',
    mine((percent) => {
      // (WhatsApp Web says «loading» once more after it is ready: it stays ready.)
      if (state.phase === 'ready') return;
      set('loading', { loading: Number(percent) || 0, qr: '', code: '' });
    }),
  );
  c.on(
    'ready',
    mine(async () => {
      tries = 0;
      meId = c.info?.wid?._serialized || '';
      const me = { id: meId, phone: c.info?.wid?.user || '', name: c.info?.pushname || '' };
      let web = '';
      try {
        web = await within(c.getWWebVersion(), 10_000, 'version');
      } catch {
        // not said: nothing depends on it
      }
      mark(me);
      set('ready', { qr: '', code: '', error: '', loading: 100, readyAt: Date.now(), web, platform: c.info?.platform || '' });
      void loadIndex();
      void ensureEvents(c);
      // How the page stands at this moment, for the log: what a later WhatsApp Web changes is seen against it.
      c.pupPage
        .evaluate(PAGE_STANDS)
        .then((seen) => log(`page: ${JSON.stringify(seen)}`))
        .catch(() => undefined);
    }),
  );
  c.on(
    'auth_failure',
    mine(async (m) => {
      unmark();
      await drop(c);
      set('off', { error: String(m || 'auth failure').slice(0, 200) });
    }),
  );
  c.on(
    'disconnected',
    mine(async (reason) => {
      const why = String(reason || '');
      log(`disconnected: ${why}`);
      await drop(c);
      if (why === 'LOGOUT') {
        // Unlinked on the phone («Связанные устройства» → выйти).
        unmark();
        set('off', { error: '', qr: '', code: '' });
      } else if (!state.linked) {
        // Nobody scanned the QR in time.
        set('off', { error: '', qr: '', code: '' });
      } else {
        set('offline', { error: why.slice(0, 200) });
        again('disconnected');
      }
    }),
  );
  c.on('message_create', mine((m) => onMessage(m)));
  c.on(
    'message_ack',
    mine((m, ack) => {
      const id = m?.id?._serialized;
      if (!id) return;
      const chat = typeof m.id.remote === 'string' ? m.id.remote : m.id.remote?._serialized;
      const row = index.get(chat);
      if (row?.last?.id === id) row.last.ack = Number(ack) || 0;
      emit({ t: 'ack', chat, id, ack: Number(ack) || 0 });
    }),
  );
  c.on(
    'message_revoke_everyone',
    mine((after) => {
      const row = messageRow(after?._data, { me: meId });
      if (row) emit({ t: 'msg', msg: row, chat: index.get(row.chat) ?? null, was: true });
    }),
  );
  c.on(
    'message_edit',
    mine((m) => {
      const row = messageRow(m?._data, { me: meId });
      if (row) emit({ t: 'msg', msg: row, chat: index.get(row.chat) ?? null, was: true });
    }),
  );
  c.on(
    'unread_count',
    mine((chat) => {
      const id = chat?.id?._serialized;
      const row = index.get(id);
      if (!row) return;
      row.unread = Math.max(0, Number(chat.unreadCount) || 0);
      count();
      emit({ t: 'chat', chat: row, unread: state.unread });
    }),
  );
}

/** Is WhatsApp Web still there? (It can stay «connected» and do nothing — then it is started again.) */
let silent = 0;
setInterval(async () => {
  const c = client;
  if (!c || state.phase !== 'ready') return;
  let ok = false;
  try {
    ok = (await within(c.getState(), 20_000, 'state')) === 'CONNECTED';
  } catch {
    ok = false;
  }
  if (client !== c) return;
  silent = ok ? 0 : silent + 1;
  if (silent >= 3) {
    silent = 0;
    log('no answer from WhatsApp Web: started again');
    await drop(c);
    set('offline', { error: 'no answer' });
    void start();
  }
}, 60_000).unref();

/**
 * WhatsApp Web is in, and the library has not heard of it: it waits for one event of the page, and a session that is
 * restored fast (or a WhatsApp Web newer than the library) is ready before the library listens — the bridge would stay
 * at «loading» for ever (seen on the garage's computer the first day). So the page itself is asked where it stands;
 * ready — the library is told so (its own «it has synced» call); still not ready after two and a half minutes — WhatsApp
 * Web is started again. What is written to the log is the page's state only.
 */
const PAGE_STANDS = () => {
  let bus = null;
  let sock = null;
  try {
    bus = window.require('WAWebBackendEventBus').BackendEventBus;
  } catch {
    bus = null;
  }
  try {
    sock = window.require('WAWebSocketModel').Socket;
  } catch {
    sock = null;
  }
  // Only a plain «true» counts (were one of these a function some day, it would not say «ready» by merely being there).
  const busReady = !!bus && bus.isMainStreamReadyMd === true;
  const sockSynced = !!sock && sock.hasSynced === true;
  return {
    version: (window.Debug && window.Debug.VERSION) || '',
    path: location.pathname,
    bus: bus ? String(bus.socketState) : 'none',
    busReady,
    sock: sock ? String(sock.state) : 'none',
    sockSynced,
    kinds: `${bus ? typeof bus.isMainStreamReadyMd : '-'}/${sock ? typeof sock.hasSynced : '-'}`,
    ready: busReady || sockSynced,
    canTell: typeof window.onAppStateHasSyncedEvent === 'function',
  };
};
let told = 0;
let stood = '';
setInterval(async () => {
  const c = client;
  if (!c || !c.pupPage || (state.phase !== 'loading' && state.phase !== 'starting')) return;
  const waited = Date.now() - state.since;
  // (The library's own way takes a second or two: only after eight is the page asked.)
  if (waited < 8000) return;
  try {
    const seen = await within(c.pupPage.evaluate(PAGE_STANDS), 10_000, 'page');
    if (client !== c || state.phase === 'ready') return;
    // Written once for each way the page stands, not every five seconds.
    const now = JSON.stringify(seen);
    if (now !== stood) log(`still ${state.phase} after ${Math.round(waited / 1000)} s: ${now}`);
    stood = now;
    if (seen.ready && seen.canTell && Date.now() - told > 60_000) {
      told = Date.now();
      log('WhatsApp Web is ready: the library is told');
      await within(
        c.pupPage.evaluate(() => window.onAppStateHasSyncedEvent()),
        120_000,
        'ready',
      );
      return;
    }
  } catch (e) {
    log(`still ${state.phase}: ${e?.message || e}`);
  }
  if (client === c && state.phase !== 'ready' && waited > 150_000) {
    log('WhatsApp Web did not get ready: started again');
    await drop(c);
    set('offline', { error: 'not ready' });
    again('not ready');
  }
}, 5000).unref();

/**
 * WhatsApp's own events on the page (v0.80.3, the owner: «список чатов нормально не обновляется»; seen live: ready, and
 * not one message, tick or unread heard). The library ties them on in the same call that loads its helpers into the page —
 * and skips that when its helpers are there already: ready by the watchdog (above), it was ready and deaf. After ready,
 * and every minute while ready, the page is asked whether its hooks are there; none — they are tied on now.
 */
async function ensureEvents(c) {
  try {
    const has = await within(c.pupPage.evaluate(() => typeof window.onAddMessageEvent === 'function' && typeof window.onMessageAckEvent === 'function'), 10_000, 'events');
    if (has || client !== c) return;
    log('events: not tied on — tied on now');
    await within(c.attachEventListeners(), 60_000, 'events');
  } catch (e) {
    log(`events: ${e?.message || e}`);
  }
}
setInterval(() => {
  const c = client;
  if (c?.pupPage && state.phase === 'ready') void ensureEvents(c);
}, 60_000).unref();

/* ---------- The chats ---------- */

/** id → the chat's row. Read from WhatsApp Web when it is ready and every ten minutes; kept right by the events. */
const index = new Map();
let indexing = null;

function count() {
  let unread = 0;
  for (const r of index.values()) if (!r.archived && !r.muted) unread += r.unread;
  state.unread = unread;
  state.chats = index.size;
}

/**
 * The chats, read on the page — lightly: a group's members are not asked for (the library's own `getChats` asks
 * WhatsApp about every group), one chat that cannot be read does not lose the list.
 */
const PAGE_CHATS = async (previews) => {
  const C = window.require('WAWebCollections');
  const ser = (x) => (x && (x._serialized || x.$1)) || (typeof x === 'string' ? x : '');
  let toPn = null;
  try {
    toPn = window.require('WAWebLidMigrationUtils').toPn;
  } catch {
    // an older WhatsApp Web: numbers are in the ids
  }
  const out = [];
  for (const chat of C.Chat.getModelsArray()) {
    try {
      const id = ser(chat.id);
      if (!id || !/@(c\.us|g\.us|lid)$/.test(id) || !chat.t) continue;
      let phone = '';
      if (chat.id.server === 'c.us') phone = chat.id.user;
      else if (chat.id.server === 'lid' && toPn) {
        try {
          phone = toPn(chat.id)?.user || '';
        } catch {
          phone = '';
        }
      }
      let last = null;
      try {
        const list = chat.msgs.getModelsArray();
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].isNotification) continue;
          last = window.WWebJS.getMessageModel(list[i]);
          // (a file's preview picture is not needed in the list)
          if (last.type !== 'chat') last.body = '';
          delete last.mediaData;
          break;
        }
      } catch {
        last = null;
      }
      out.push({
        id,
        name: chat.formattedTitle || chat.name || '',
        group: !!chat.groupMetadata || chat.id.server === 'g.us',
        unread: chat.unreadCount > 0 ? chat.unreadCount : 0,
        t: chat.t,
        archived: !!chat.archive,
        pinned: !!chat.pin,
        muted: !!chat.mute && chat.mute.expiration !== 0 && chat.mute.expiration !== undefined,
        phone,
        last,
      });
    } catch {
      // this chat is not in the list this time
    }
  }
  // The newest chats' last message, where WhatsApp Web has not read it into memory yet (it does as a chat scrolls into
  // sight): asked of its own store by the message's key — the first `previews` chats, the rest show their time only.
  out.sort((a, b) => b.t - a.t);
  let asked = 0;
  for (const row of out) {
    if (row.last || asked >= previews) continue;
    asked++;
    try {
      const chat = C.Chat.get(row.id);
      const key = ser(chat && chat.lastReceivedKey);
      if (!key) continue;
      const m = C.Msg.get(key) || ((await C.Msg.getMessagesById([key])) || {}).messages?.[0];
      if (!m || m.isNotification) continue;
      const last = window.WWebJS.getMessageModel(m);
      if (last.type !== 'chat') last.body = '';
      delete last.mediaData;
      row.last = last;
    } catch {
      // no preview for this one
    }
  }
  return out;
};

const PAGE_MESSAGES = async (chatId, limit) => {
  const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
  if (!chat) return null;
  const ok = (m) => !m.isNotification;
  let msgs = chat.msgs.getModelsArray().filter(ok);
  let more = true;
  let rounds = 0;
  while (msgs.length < limit && rounds++ < 40) {
    const loaded = await window.require('WAWebChatLoadMessages').loadEarlierMsgs({ chat });
    if (!loaded || !loaded.length) {
      more = false;
      break;
    }
    msgs = [...loaded.filter(ok), ...msgs];
  }
  // (messages of the same second keep the order WhatsApp has them in)
  msgs.sort((a, b) => a.t - b.t);
  if (msgs.length > limit) msgs = msgs.slice(msgs.length - limit);
  return { more, rows: msgs.map((m) => window.WWebJS.getMessageModel(m)) };
};

function loadIndex() {
  if (indexing) return indexing;
  const c = client;
  if (!c || state.phase !== 'ready') return Promise.resolve();
  indexing = (async () => {
    try {
      const raw = await within(c.pupPage.evaluate(PAGE_CHATS, 150), 90_000, 'chats');
      if (client !== c) return;
      const seen = new Set();
      for (const one of raw) {
        const row = chatRow(one, { me: meId });
        if (!row) continue;
        seen.add(row.id);
        index.set(row.id, row);
      }
      for (const id of [...index.keys()]) if (!seen.has(id)) index.delete(id);
      count();
      emit({ t: 'chats', n: index.size, unread: state.unread });
    } catch (e) {
      log(`chats: ${e?.message || e}`);
    } finally {
      indexing = null;
    }
  })();
  return indexing;
}
setInterval(() => void loadIndex(), 10 * 60_000).unref();

let soon = null;
function loadIndexSoon() {
  clearTimeout(soon);
  soon = setTimeout(() => void loadIndex(), 4000);
  soon.unref?.();
}

function onMessage(m) {
  const row = messageRow(m?._data, { me: meId });
  if (!row) return;
  let chat = index.get(row.chat);
  if (!chat) {
    // A chat that was not in the list: shown at once by what the message says, named properly a moment later.
    const phone = phoneOf(row.chat);
    chat = { id: row.chat, name: (!row.me && m._data?.notifyName) || (phone ? `+${phone}` : ''), group: row.chat.endsWith('@g.us'), phone, unread: 0, t: 0, archived: false, pinned: false, muted: false, self: false, last: null };
    index.set(row.chat, chat);
    loadIndexSoon();
  }
  if (row.t >= chat.t) {
    chat.t = row.t;
    chat.last = lastRow(row);
  }
  count();
  emit({ t: 'msg', msg: row, chat });
}

/* ---------- Files ---------- */

const keyOf = (id) => crypto.createHash('sha1').update(id).digest('hex');
const fetching = new Map();

/** A message's file, brought from WhatsApp once and kept here (30 days): `{ abs, mime, name, size }` — none when WhatsApp no longer has it. */
function mediaOf(id) {
  const key = keyOf(id);
  const abs = path.join(MEDIA, key);
  try {
    const meta = JSON.parse(fs.readFileSync(`${abs}.json`, 'utf8'));
    if (fs.existsSync(abs)) return Promise.resolve({ abs, ...meta });
  } catch {
    // not here yet
  }
  if (fetching.has(key)) return fetching.get(key);
  const c = need();
  const p = (async () => {
    const m = await within(c.getMessageById(id), 30_000, 'message');
    if (!m || !m.hasMedia) return null;
    const media = await within(m.downloadMedia(), 180_000, 'file');
    if (!media?.data) return null;
    const bytes = Buffer.from(media.data, 'base64');
    const meta = { mime: String(media.mimetype || 'application/octet-stream').split(';')[0], name: media.filename || m._data?.filename || '', size: bytes.length };
    fs.writeFileSync(abs, bytes);
    fs.writeFileSync(`${abs}.json`, JSON.stringify(meta));
    return { abs, ...meta };
  })().finally(() => fetching.delete(key));
  fetching.set(key, p);
  return p;
}

/** Files opened long ago leave this computer (WhatsApp and the phone still have them). */
function prune() {
  const old = Date.now() - 30 * 24 * 60 * 60_000;
  for (const dir of [MEDIA, AVATARS]) {
    try {
      for (const f of fs.readdirSync(dir)) {
        const abs = path.join(dir, f);
        if (fs.statSync(abs).mtimeMs < old) fs.rmSync(abs, { force: true });
      }
    } catch {
      // next time
    }
  }
}
prune();
setInterval(prune, 12 * 60 * 60_000).unref();

/** One at a time, a pause between: contacts' pictures are asked for as a person scrolling the list would see them. */
let avatarLine = Promise.resolve();
const avatarAsked = new Map();
function avatarOf(id) {
  const abs = path.join(AVATARS, `${keyOf(id)}.jpg`);
  try {
    const st = fs.statSync(abs);
    if (Date.now() - st.mtimeMs < 7 * 24 * 60 * 60_000) return Promise.resolve(st.size ? abs : null);
  } catch {
    // not asked yet
  }
  if (avatarAsked.has(id)) return avatarAsked.get(id);
  const c = need();
  const p = (avatarLine = avatarLine
    .catch(() => undefined)
    .then(async () => {
      let url = '';
      try {
        url = await within(c.getProfilePicUrl(id), 15_000, 'picture');
      } catch {
        url = '';
      }
      // Only WhatsApp's own picture servers.
      if (!url || !/^https:\/\/[a-z0-9.-]+\.(whatsapp\.net|whatsapp\.com)\//i.test(url)) {
        fs.writeFileSync(abs, '');
        return null;
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        fs.writeFileSync(abs, '');
        return null;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > 2 * 1024 * 1024) return null;
      fs.writeFileSync(abs, bytes);
      await sleep(150);
      return abs;
    })
    .catch(() => null)
    .finally(() => avatarAsked.delete(id)));
  avatarAsked.set(id, p);
  return p;
}

/* ---------- Sending ---------- */

const sent = [];
/** No more than 25 a minute: the app sends what a person sends — a flood is a fault somewhere, and WhatsApp bans it. */
function allow() {
  const now = Date.now();
  while (sent.length && sent[0] < now - 60_000) sent.shift();
  if (sent.length >= 25) throw httpError(429, 'too many messages a minute');
  sent.push(now);
}

function need() {
  if (!client || state.phase !== 'ready') throw httpError(409, 'whatsapp is not ready');
  return client;
}
const chatParam = (v) => {
  const id = String(v || '');
  if (!CHAT_ID.test(id)) throw httpError(400, 'bad chat');
  return id;
};
const quoteOpt = (v) => (v && MESSAGE_ID.test(String(v)) ? { quotedMessageId: String(v) } : {});

async function sendText(body) {
  const c = need();
  const chat = chatParam(body.chat);
  const text = String(body.text ?? '');
  if (!text.trim()) throw httpError(400, 'nothing to send');
  if (text.length > 20_000) throw httpError(413, 'too long');
  allow();
  const m = await within(c.sendMessage(chat, text, quoteOpt(body.quote)), 60_000, 'send');
  const row = messageRow(m?._data, { me: meId });
  if (!row) throw httpError(502, 'not sent');
  return { ok: true, msg: row };
}

/**
 * A message of ours taken back for everyone (v0.83, the owner: «добавить возможность удалять у всех сообщения»): WhatsApp's
 * own «Удалить у всех» — only our own, only while WhatsApp still allows it. The library would quietly delete it «for me»
 * (on every device of the account) once that time is over: asked first, and said no to instead.
 */
async function deleteMessage(body) {
  const c = need();
  const id = String(body.id ?? '');
  if (!MESSAGE_ID.test(id)) throw httpError(400, 'bad message');
  const m = await within(c.getMessageById(id), 20_000, 'message');
  if (!m) throw httpError(404, 'no message');
  if (!m.fromMe) throw httpError(403, 'not ours');
  const can = await within(
    c.pupPage.evaluate((mid) => {
      const msg = window.Store?.Msg?.get?.(mid);
      const checks = window.Store?.MsgActionChecks;
      if (!msg || !checks) return null;
      return !!(checks.canSenderRevokeMsg?.(msg) || checks.canAdminRevokeMsg?.(msg));
    }, id),
    15_000,
    'check',
  );
  if (can === null) throw httpError(409, 'cannot check');
  if (!can) throw httpError(409, 'too late');
  allow();
  await within(m.delete(true), 30_000, 'delete');
  const after = await within(c.getMessageById(id), 20_000, 'message').catch(() => null);
  return { ok: true, msg: messageRow((after ?? m)?._data, { me: meId }) };
}

/** A message of a chat forwarded to another (v0.80.3): WhatsApp's own forwarding — its file goes with it, marked so. */
async function forwardMessage(body) {
  const c = need();
  const id = String(body.id ?? '');
  if (!MESSAGE_ID.test(id)) throw httpError(400, 'bad message');
  const to = chatParam(body.to);
  allow();
  const m = await within(c.getMessageById(id), 20_000, 'message');
  if (!m) throw httpError(404, 'no message');
  try {
    await within(m.forward(to), 60_000, 'forward');
    return { ok: true, how: 'forward' };
  } catch (e) {
    // The library's own forwarding does not find WhatsApp Web's (2.3000.105606…, «forwardMessages» of undefined): the
    // same content sent anew — its words, its file with its caption — only WhatsApp's «Пересланное» is not on it.
    log(`forward: ${String(e?.message || e).slice(0, 120)} — sent anew`);
  }
  if (m.hasMedia) {
    const media = await within(m.downloadMedia(), 120_000, 'media');
    if (!media) throw httpError(410, 'the file is no longer on WhatsApp');
    const caption = String(m.body || '').slice(0, 4000);
    await within(c.sendMessage(to, media, { ...(caption ? { caption } : {}), ...(m.type === 'document' ? { sendMediaAsDocument: true } : {}) }), 300_000, 'send');
  } else {
    const text = String(m.body || '').trim();
    if (!text) throw httpError(422, 'nothing to forward');
    await within(c.sendMessage(to, text), 60_000, 'send');
  }
  return { ok: true, how: 'anew' };
}

/** A recording as WhatsApp's voice message: Opus packets from this Chrome (WebCodecs), put in Ogg here. */
async function toVoice(c, bytes) {
  const r = await within(c.pupPage.evaluate(PAGE_OPUS, bytes.toString('base64')), 60_000, 'voice');
  return oggOpus(r.packets.map((p) => Buffer.from(p, 'base64')), { samples: r.samples });
}

async function sendFile(url, bytes, type) {
  const c = need();
  const chat = chatParam(url.searchParams.get('chat'));
  if (!bytes.length) throw httpError(400, 'empty file');
  const mime = String(type || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const name = String(url.searchParams.get('name') || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'file';
  const caption = String(url.searchParams.get('caption') || '').slice(0, 4000);
  // A picture or an mp4 goes as WhatsApp shows them; anything else — and what is asked so — as a document.
  const shown = /^image\/(jpeg|png|webp)$/.test(mime) || mime === 'video/mp4' || /^audio\//.test(mime);
  const doc = url.searchParams.get('doc') === '1' || !shown;
  allow();
  let media = new MessageMedia(mime, bytes.toString('base64'), name, bytes.length);
  // A voice message (v0.81): Opus in Ogg, as WhatsApp records them (voice.mjs) — not made so, it goes as a sound file.
  const voice = url.searchParams.get('voice') === '1' && /^audio\//.test(mime);
  let asVoice = false;
  if (voice) {
    try {
      const ogg = /ogg/.test(mime) ? bytes : await toVoice(c, bytes);
      media = new MessageMedia('audio/ogg; codecs=opus', ogg.toString('base64'), 'voice.ogg', ogg.length);
      asVoice = true;
    } catch (e) {
      log('voice: sent as a sound file —', e?.message ?? e);
    }
  }
  const m = await within(c.sendMessage(chat, media, { ...(caption ? { caption } : {}), sendMediaAsDocument: doc && !asVoice, ...(asVoice ? { sendAudioAsVoice: true } : {}), ...quoteOpt(url.searchParams.get('quote')) }), 300_000, 'send');
  const row = messageRow(m?._data, { me: meId });
  if (!row) throw httpError(502, 'not sent');
  // What was just sent is its own file here: the app shows it without asking WhatsApp for it back.
  try {
    const abs = path.join(MEDIA, keyOf(row.id));
    fs.writeFileSync(abs, bytes);
    fs.writeFileSync(`${abs}.json`, JSON.stringify({ mime, name, size: bytes.length }));
  } catch {
    // asked from WhatsApp then
  }
  return { ok: true, msg: row };
}

/* ---------- The door ---------- */

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readBody(req, max) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw httpError(413, 'too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  try {
    return JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}');
  } catch (e) {
    if (e.status) throw e;
    throw httpError(400, 'bad json');
  }
}
/** A file whole, or the part asked for (`Range`): a video starts as its first part is in. */
function sendBytes(req, res, f) {
  const size = fs.statSync(f.abs).size;
  const head = { 'Content-Type': f.mime || 'application/octet-stream', 'Cache-Control': 'private, max-age=2592000, immutable', 'Accept-Ranges': 'bytes' };
  if (f.name) head['X-File-Name'] = encodeURIComponent(f.name);
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  const pour = (rs) => pipeline(rs, res).catch(() => undefined);
  if (m && (m[1] !== '' || m[2] !== '')) {
    const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (!(start <= end) || start >= size) {
      res.writeHead(416, { ...head, 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...head, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
    return pour(fs.createReadStream(f.abs, { start, end }));
  }
  res.writeHead(200, { ...head, 'Content-Length': size });
  return pour(fs.createReadStream(f.abs));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    // Only the garage's server has the secret (given to this process when it was started).
    const given = Buffer.from(String(req.headers['x-bridge'] || ''));
    const want = Buffer.from(SECRET);
    if (!SECRET || given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw httpError(403, 'forbidden');
    const p = url.pathname;
    if (req.method === 'GET') {
      if (p === '/status') return sendJson(res, 200, publicState());
      if (p === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ t: 'state', state: publicState() })}\n\n`);
        streams.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
        req.on('close', () => {
          clearInterval(ping);
          streams.delete(res);
        });
        return undefined;
      }
      if (p === '/chats') {
        need();
        if (!index.size) await loadIndex();
        const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit')) || 400));
        const rows = sortChats([...index.values()]);
        return sendJson(res, 200, { chats: rows.slice(0, limit), total: rows.length, unread: state.unread });
      }
      if (p === '/messages') {
        const c = need();
        const chat = chatParam(url.searchParams.get('chat'));
        const limit = Math.min(400, Math.max(1, Number(url.searchParams.get('limit')) || 40));
        const got = await within(c.pupPage.evaluate(PAGE_MESSAGES, chat, limit), 90_000, 'messages');
        if (!got) return sendJson(res, 200, { messages: [], more: false });
        const messages = got.rows.map((d) => messageRow(d, { me: meId })).filter(Boolean);
        return sendJson(res, 200, { messages, more: got.more });
      }
      if (p === '/media') {
        const id = String(url.searchParams.get('id') || '');
        if (!MESSAGE_ID.test(id)) throw httpError(400, 'bad message');
        const f = await mediaOf(id);
        if (!f) throw httpError(404, 'the file is no longer on WhatsApp');
        return sendBytes(req, res, f);
      }
      if (p === '/avatar') {
        const abs = await avatarOf(chatParam(url.searchParams.get('id')));
        if (!abs) throw httpError(404, 'no picture');
        return sendBytes(req, res, { abs, mime: 'image/jpeg' });
      }
      if (p === '/number') {
        const c = need();
        const digits = String(url.searchParams.get('phone') || '').replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) throw httpError(400, 'bad number');
        const id = await within(c.getNumberId(digits), 30_000, 'number');
        // The chat already in the list (WhatsApp keeps a person's chat under an id that hides the number): that one.
        const known = [...index.values()].find((r) => !r.group && r.phone === digits);
        return sendJson(res, 200, { ok: !!id || !!known, chat: known?.id || id?._serialized || '' });
      }
    }
    if (req.method === 'POST') {
      if (p === '/start') {
        if (!browser) throw httpError(409, 'no browser');
        void start();
        return sendJson(res, 200, publicState());
      }
      if (p === '/restart') {
        const c = client;
        if (c) await drop(c);
        tries = 0;
        void start();
        return sendJson(res, 200, publicState());
      }
      if (p === '/logout') {
        const c = client;
        clearTimeout(retry);
        if (c) {
          client = null;
          index.clear();
          try {
            // Said to WhatsApp: the phone's «Связанные устройства» no longer lists this computer.
            if (state.phase === 'ready') await within(c.logout(), 30_000, 'logout');
            else await within(c.destroy(), 15_000, 'close');
          } catch (e) {
            log(`logout: ${e?.message || e}`);
            try {
              await within(c.destroy(), 15_000, 'close');
            } catch {
              // ended at the next start
            }
          }
        }
        unmark();
        await endStrays();
        // The session's folder goes with the link (the library removes it at a logout; here — whatever is left).
        fs.rmSync(SESSION, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        count();
        set('off', { qr: '', code: '', error: '', chats: 0, unread: 0 });
        return sendJson(res, 200, publicState());
      }
      if (p === '/code') {
        const body = await readJson(req);
        const c = client;
        if (!c || state.phase !== 'qr') throw httpError(409, 'not waiting to be linked');
        const digits = String(body.phone || '').replace(/\D/g, '');
        if (digits.length < 8 || digits.length > 15) throw httpError(400, 'bad number');
        const code = await within(c.requestPairingCode(digits, true), 60_000, 'code');
        state.code = String(code || '');
        emit({ t: 'state', state: publicState() });
        return sendJson(res, 200, publicState());
      }
      if (p === '/send') return sendJson(res, 200, await sendText(await readJson(req)));
      if (p === '/forward') return sendJson(res, 200, await forwardMessage(await readJson(req)));
      if (p === '/delete') return sendJson(res, 200, await deleteMessage(await readJson(req)));
      if (p === '/file') return sendJson(res, 200, await sendFile(url, await readBody(req, MAX_FILE), req.headers['content-type']));
      if (p === '/seen') {
        const c = need();
        const chat = chatParam((await readJson(req)).chat);
        await within(c.sendSeen(chat), 30_000, 'seen');
        const row = index.get(chat);
        if (row && row.unread) {
          row.unread = 0;
          count();
          emit({ t: 'chat', chat: row, unread: state.unread });
        }
        return sendJson(res, 200, { ok: true, unread: state.unread });
      }
    }
    throw httpError(404, 'not found');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) log(`error ${req.method} ${url.pathname}: ${e?.message || e}`);
    if (!res.headersSent) sendJson(res, status, { ok: false, error: String(e?.message || e).slice(0, 300) });
    else res.destroy();
    return undefined;
  }
});
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;
server.listen(PORT, '127.0.0.1', () => {
  log(`bridge on 127.0.0.1:${PORT}, browser ${state.browser || 'none'}, ${state.linked ? 'linked' : 'not linked'}`);
  // Linked before: back by itself. Not linked: it waits to be asked (a QR nobody looks at is not made).
  if (state.linked) void start();
});

/* ---------- The end ---------- */

let ending = false;
async function stop(why) {
  if (ending) return;
  ending = true;
  log(`stopping (${why}): the link stays`);
  clearTimeout(retry);
  server.close();
  for (const res of streams) res.end();
  const c = client;
  client = null;
  if (c) {
    try {
      await within(c.destroy(), 10_000, 'close');
    } catch {
      // the next start ends what is left
    }
  }
  process.exit(0);
}
process.on('SIGINT', () => void stop('asked'));
process.on('SIGTERM', () => void stop('asked'));
// Started by the server: gone with it (a server ended by force says nothing — its end of the pipe closes).
if (process.env.WA_PARENT === '1') {
  process.stdin.on('end', () => void stop('the server is gone'));
  process.stdin.on('close', () => void stop('the server is gone'));
  process.stdin.resume();
}
process.on('unhandledRejection', (e) => log(`unhandled: ${e?.message || e}`));
process.on('uncaughtException', (e) => {
  log(`stopped by an error: ${e?.stack || e}`);
  process.exit(1);
});
