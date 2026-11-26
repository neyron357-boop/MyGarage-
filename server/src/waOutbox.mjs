import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/*
 * What the garage sends through WhatsApp by itself (v0.79): reports to the work group, a company's group, the boss and
 * the wash; parts requests to the suppliers the manager picked. The app hands each message over here once; this server
 * keeps it (one file each in `Служебное/whatsapp/outbox`) and sends it when WhatsApp is linked and answering — the app
 * may be closed by then, the phone offline, the server restarted in between: nothing is lost and nothing goes twice.
 *
 * An item: `{ key, chat | phone, parts: [{ text } | { media: id, caption } | { data, name, mime, caption, doc }], gap }`.
 * Its key is the app's own (`boss:invoice:<id>`, `ask:<job>:<supplier>:<n>`…): an item whose key was sent or is waiting
 * is not taken again (`sent.json`, kept 120 days). `media` — a photo the garage's server keeps (its card, else the
 * photo): a photo taken on the phone and not here yet is waited for (two hours), then the item goes without it.
 *
 * Unhurried, as a person would send (an unofficial client that floods is what WhatsApp bans): a pause after every
 * message, a longer one between chats (`gap`, the manager's setting for suppliers), never two items at once.
 *
 * Later (v0.91.7, task #76, the owner: «если нажать и удержать — окно с установкой таймера отправки, чтобы вставить время,
 * когда сообщение должно отправиться автоматически»): `after` — not before this moment (ms; up to a week ahead); the item
 * waits here, the app may be closed by then. Its three days to go count from that moment.
 */

const DAY = 24 * 60 * 60_000;
const KEY = /^[A-Za-z0-9:._@-]{3,200}$/;
const CHAT = /^[0-9A-Za-z._-]{3,80}@(c\.us|g\.us|lid)$/;
const MAX_ITEM = 24 * 1024 * 1024;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => a + Math.random() * (b - a);

/** An item as the app hands it over: checked, nothing else kept. */
export function cleanItem(x) {
  if (!x || typeof x !== 'object') throw httpError(400, 'bad item');
  const key = String(x.key ?? '');
  if (!KEY.test(key)) throw httpError(400, 'bad key');
  const chat = x.chat ? String(x.chat) : '';
  const phone = String(x.phone ?? '').replace(/\D/g, '');
  if (chat && !CHAT.test(chat)) throw httpError(400, 'bad chat');
  if (!chat && (phone.length < 8 || phone.length > 15)) throw httpError(400, 'no chat');
  if (!Array.isArray(x.parts) || !x.parts.length || x.parts.length > 12) throw httpError(400, 'bad parts');
  const parts = x.parts.map((p) => {
    if (typeof p?.text === 'string') {
      const text = p.text.trim();
      if (!text || text.length > 20_000) throw httpError(400, 'bad text');
      return { text };
    }
    const caption = typeof p?.caption === 'string' ? p.caption.slice(0, 4000) : undefined;
    if (typeof p?.media === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(p.media)) return { media: p.media, caption, fallback: typeof p.fallback === 'string' ? p.fallback.slice(0, 4000) : undefined };
    if (typeof p?.data === 'string' && p.data.length) {
      const mime = String(p.mime || 'application/octet-stream').split(';')[0].slice(0, 100);
      const name = String(p.name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
      return { data: p.data, mime, name, caption, doc: !!p.doc };
    }
    throw httpError(400, 'bad part');
  });
  const size = parts.reduce((n, p) => n + (p.data?.length ?? 0), 0);
  if (size > MAX_ITEM) throw httpError(413, 'item too large');
  const gap = Math.min(120, Math.max(0, Number(x.gap) || 0));
  const title = typeof x.title === 'string' ? x.title.slice(0, 120) : '';
  const after = Number(x.after) || 0;
  if (after && (!Number.isFinite(after) || after > Date.now() + 7 * DAY)) throw httpError(400, 'bad time');
  return { key, chat, phone, parts, gap, title, ...(after > Date.now() ? { after } : {}) };
}

export function createOutbox({ dir, store, bridge, ready, tell = () => {}, log = () => {}, now = () => Date.now(), pace = { message: [1200, 2200], chats: [4000, 8000] }, waitMedia = 2 * 60 * 60_000 }) {
  fs.mkdirSync(dir, { recursive: true });
  const sentFile = path.join(dir, 'sent.json');
  const fileOf = (key) => path.join(dir, `${crypto.createHash('sha1').update(key).digest('hex')}.json`);
  const read = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };
  let sent = read(sentFile) ?? {};
  const keepSent = () => {
    const old = now() - 120 * DAY;
    for (const [k, v] of Object.entries(sent)) if (!v || v.at < old) delete sent[k];
    fs.writeFileSync(sentFile, JSON.stringify(sent));
  };
  const save = (item) => {
    const tmp = `${fileOf(item.key)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(item));
    fs.renameSync(tmp, fileOf(item.key));
  };
  const items = () =>
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json') && f !== 'sent.json')
      .map((f) => read(path.join(dir, f)))
      .filter(Boolean)
      .sort((a, b) => a.at - b.at);

  /** What an item is now, for the app (no message's words beyond its title). */
  const face = (it) => ({ key: it.key, state: it.state, at: it.at, after: it.after || undefined, title: it.title, chat: it.chat || undefined, error: it.error || undefined, tries: it.tries || 0, parts: it.parts.length, done: it.done || 0 });

  function put(raw, by) {
    const x = cleanItem(raw);
    if (sent[x.key]) return { key: x.key, state: 'sent', at: sent[x.key].at };
    const have = read(fileOf(x.key));
    if (have) return { key: x.key, state: have.state, at: have.at };
    const item = { ...x, at: now(), state: 'queued', tries: 0, done: 0, next: x.after || 0, by: by || '' };
    save(item);
    tell({ t: 'outbox', item: face(item) });
    return { key: item.key, state: 'queued', at: item.at, ...(item.after ? { after: item.after } : {}) };
  }

  function list(keys) {
    const all = items();
    if (keys?.length) {
      const by = new Map(all.map((it) => [it.key, it]));
      return keys.map((k) => (by.has(k) ? face(by.get(k)) : sent[k] ? { key: k, state: 'sent', at: sent[k].at, chat: sent[k].chat } : { key: k, state: 'none' }));
    }
    const recent = Object.entries(sent)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 40)
      .map(([k, v]) => ({ key: k, state: 'sent', at: v.at, title: v.title, chat: v.chat }));
    return [...all.map(face), ...recent];
  }

  function retry(key) {
    const it = read(fileOf(String(key)));
    if (!it) throw httpError(404, 'no such item');
    Object.assign(it, { state: 'queued', tries: 0, next: it.after && it.after > now() ? it.after : 0, error: '' });
    save(it);
    tell({ t: 'outbox', item: face(it) });
    return face(it);
  }

  function drop(key) {
    const file = fileOf(String(key));
    const it = read(file);
    if (!it) throw httpError(404, 'no such item');
    if (it.state === 'sending') throw httpError(409, 'sending now');
    fs.rmSync(file, { force: true });
    tell({ t: 'outbox', item: { key: it.key, state: 'dropped' } });
    return { key: it.key, state: 'dropped' };
  }

  /* ---------- Sending ---------- */

  let busy = false;
  /** Not before this moment: the pause after the last item. */
  let calm = 0;
  let lastChat = '';

  function fail(it, error, { final = false, wait = 0 } = {}) {
    it.error = String(error).slice(0, 200);
    if (final) it.state = 'failed';
    else {
      it.state = 'queued';
      it.next = now() + wait;
    }
    save(it);
    log(`outbox: ${it.key} ${it.state} — ${it.error}`);
    tell({ t: 'outbox', item: face(it) });
  }

  async function sendOne(it) {
    let chat = it.chat;
    if (!chat) {
      const r = await bridge.json(`/number?phone=${it.phone}`);
      if (!r.ok || !r.chat) return fail(it, 'the number is not on WhatsApp', { final: true });
      chat = it.chat = r.chat;
      save(it);
    }
    // A pause before another chat: a person goes from one to the next.
    if (lastChat && lastChat !== chat) await sleep(Math.max(0, it.gap ? it.gap * 1000 * jitter(0.85, 1.25) : jitter(...pace.chats)));
    for (let i = it.done || 0; i < it.parts.length; i++) {
      const p = it.parts[i];
      if (p.text) await bridge.json('/send', { method: 'POST', body: { chat, text: p.text } });
      else if (p.media) {
        const f = store?.file(p.media, 'card') || store?.file(p.media, 'blob');
        if (!f) {
          // The photo is still on the phone: waited for, then the item goes on without it (its words, if it has some).
          if (now() - it.at < waitMedia) return fail(it, 'waiting for the photo', { wait: 60_000 });
          if (p.caption || p.fallback) await bridge.json('/send', { method: 'POST', body: { chat, text: p.fallback || p.caption } });
        } else {
          const bytes = fs.readFileSync(f.abs);
          await bridge.file({ chat, name: `${p.media}.jpg`, caption: p.caption, mime: f.type || 'image/jpeg', bytes });
        }
      } else if (p.data) {
        await bridge.file({ chat, name: p.name, caption: p.caption, mime: p.mime, doc: p.doc, bytes: Buffer.from(p.data, 'base64') });
      }
      it.done = i + 1;
      save(it);
      lastChat = chat;
      if (i < it.parts.length - 1) await sleep(jitter(...pace.message));
    }
    fs.rmSync(fileOf(it.key), { force: true });
    sent[it.key] = { at: now(), chat, title: it.title || undefined };
    keepSent();
    log(`outbox: ${it.key} sent (${it.parts.length})`);
    tell({ t: 'outbox', item: { key: it.key, state: 'sent', at: sent[it.key].at, chat, title: it.title } });
  }

  async function tick() {
    if (busy || !ready() || now() < calm) return;
    const due = items().filter((it) => it.state === 'queued' && (it.next || 0) <= now());
    // Waited three days and still not gone (WhatsApp unlinked meanwhile): said so, not sent late.
    for (const it of due) if (now() - Math.max(it.at, it.after || 0) > 3 * DAY) fail(it, 'expired', { final: true });
    const it = due.find((x) => x.state === 'queued');
    if (!it) return;
    busy = true;
    it.state = 'sending';
    save(it);
    try {
      await sendOne(it);
    } catch (e) {
      const status = e?.status || 0;
      it.tries = (it.tries || 0) + 1;
      // Not ready, too many a minute, the network: later, without counting it as a try of the item.
      if (status === 409 || status === 503 || status === 429 || status === 0) {
        it.tries -= 1;
        fail(it, e.message || 'later', { wait: status === 429 ? 60_000 : 30_000 });
      } else if (status >= 400 && status < 500) fail(it, e.message, { final: true });
      else if (it.tries >= 6) fail(it, e.message || 'failed', { final: true });
      else fail(it, e.message || 'failed', { wait: 30_000 * it.tries });
    } finally {
      busy = false;
      calm = now() + jitter(...pace.message);
    }
  }

  // An item left «sending» by a server that stopped mid-way: queued again (it goes on from the part it reached).
  for (const it of items()) if (it.state === 'sending') save({ ...it, state: 'queued' });

  let timer = null;
  return {
    put,
    list,
    retry,
    drop,
    tick,
    /** How many wait and how many did not go (this computer's page). */
    counts() {
      const all = items();
      return { queued: all.filter((x) => x.state !== 'failed').length, failed: all.filter((x) => x.state === 'failed').length, sent: Object.keys(sent).length };
    },
    start(ms = 3000) {
      timer ??= setInterval(() => void tick(), ms);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
