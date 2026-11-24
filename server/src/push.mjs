import crypto from 'node:crypto';

/*
 * Notifications on the phone while the app is closed (v0.74, the user: «поработать с уведомлениями на айфон, уведомлять
 * каждый 1 час, если заказ — список деталей без цен… настраивать уведомления под себя… напоминалки»).
 *
 * An iPhone shows a web app's notification only when a server pushes it (Web Push: the app added to the Home Screen
 * subscribes, the server sends through Apple's push service). This computer is that server: it is on while the garage
 * works, it has the garage's data, it reaches the internet by itself — the phone need not reach it.
 *
 * Who decides WHAT to say is the app (app/src/domain/notify.ts — the same facts as its «Сегодня»): after every change
 * it leaves here a PLAN — groups («Назвать цену»), each with its members (a car, since when) and how often to remind.
 * This file only keeps time: every half a minute it looks which groups are due — a member whose time has come and was
 * not said yet, or the group's interval gone by — inside the hours and days the manager set, and sends one notification
 * a group (three cars without a price are one notification, not three). A summary once a morning, when asked for.
 *
 * No dependency: the message is sealed and signed here with Node's own crypto, as the standards say —
 *   RFC 8291  the message sealed for the phone alone (ECDH P-256, HKDF, AES-128-GCM, `aes128gcm`)
 *   RFC 8292  VAPID: who sends (a key pair made here once, kept in the database's `meta`)
 * — checked in test/push.test.mjs against the RFC's own example.
 */

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const from64 = (s) => Buffer.from(String(s ?? ''), 'base64url');

/* ---------- VAPID: this server's own key pair ---------- */

/** A new key pair: the public one as the browsers take it (65 bytes, uncompressed), the private one as a JWK. */
export function newVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), from64(jwk.x), from64(jwk.y)])), privateKey: privateKey.export({ format: 'jwk' }) };
}

/** `Authorization: vapid t=<JWT signed ES256>, k=<public key>` for a push service (its origin is the audience). */
export function vapidAuth(endpoint, keys, contact, nowSec = Math.floor(Date.now() / 1000)) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: contact }));
  const key = crypto.createPrivateKey({ key: keys.privateKey, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

/* ---------- RFC 8291: the message sealed for one subscription ---------- */

/**
 * The body of the push request: `salt(16) | rs(4) | idlen(1) | the sender's public key(65) | ciphertext + tag`.
 * `salt` and `ecdh` are given only by the test (the RFC's example); else random, a new key every message.
 */
export function encrypt(plain, subscription, { salt = crypto.randomBytes(16), ecdh } = {}) {
  const ua = from64(subscription?.keys?.p256dh);
  const auth = from64(subscription?.keys?.auth);
  if (ua.length !== 65 || ua[0] !== 4 || auth.length < 16) throw new Error('bad subscription keys');
  const mine = ecdh ?? crypto.createECDH('prime256v1');
  if (!ecdh) mine.generateKeys();
  const pub = mine.getPublicKey();
  const secret = mine.computeSecret(ua);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, pub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // One record, the last: the text, then 0x02.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plain), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  Buffer.from(salt).copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head[20] = pub.length;
  return Buffer.concat([head, pub, sealed]);
}

/**
 * Only the browsers' own push services are written to (a subscription comes from a paired device, but an address is
 * still an address): Apple (iPhone, Mac), Google (Chrome, Android), Mozilla, Microsoft (Edge).
 */
const SERVICES = [/(^|\.)push\.apple\.com$/i, /^fcm\.googleapis\.com$/i, /^android\.googleapis\.com$/i, /(^|\.)push\.services\.mozilla\.com$/i, /(^|\.)notify\.windows\.com$/i];
export function pushService(endpoint) {
  try {
    const u = new URL(String(endpoint));
    return u.protocol === 'https:' && !u.username && !u.port && SERVICES.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/* ---------- The plan and its clock ---------- */

/** The time of day (minutes), the weekday (0 — Sunday) and the date in the plan's time zone. */
export function localTime(ms, tz = 'Asia/Dubai') {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
  } catch {
    return localTime(ms, 'Asia/Dubai');
  }
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** May a notification come now: the manager's hours (a span over midnight too) and days. */
export function inHours(plan, ms) {
  const t = localTime(ms, plan.tz);
  if (!plan.days.includes(t.day)) return false;
  return plan.from <= plan.to ? t.minutes >= plan.from && t.minutes < plan.to : t.minutes >= plan.from || t.minutes < plan.to;
}

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const whole = (v, lo, hi, def) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : def);

/**
 * The app's plan, made safe to keep and to run: sizes within bounds, numbers numbers, times times. What does not fit
 * is dropped, not guessed.
 */
export function cleanPlan(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const days = [...new Set((Array.isArray(r.days) ? r.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  const units = r.units && typeof r.units === 'object' ? r.units : {};
  const groups = [];
  for (const g of Array.isArray(r.groups) ? r.groups.slice(0, 300) : []) {
    const key = text(g?.key, 80);
    if (!key) continue;
    const members = [];
    for (const m of Array.isArray(g.members) ? g.members.slice(0, 400) : []) {
      const id = text(m?.id, 120);
      const start = Date.parse(m?.start);
      if (!id || !Number.isFinite(start)) continue;
      const since = Date.parse(m?.since);
      const notBefore = Date.parse(m?.notBefore);
      members.push({
        id,
        label: text(m.label, 160),
        url: text(m.url, 200),
        start: new Date(start).toISOString(),
        ...(Number.isFinite(notBefore) ? { notBefore: new Date(notBefore).toISOString() } : {}),
        ...(Number.isFinite(since) ? { since: new Date(since).toISOString() } : {}),
      });
    }
    if (!members.length) continue;
    groups.push({ key, title: text(g.title, 80), many: text(g.many, 80) || text(g.title, 80), every: whole(g.every, 0, 7 * 1440, 0), url: text(g.url, 200), members, ...(g.solo ? { solo: true } : {}) });
  }
  const digestAt = r.digest && Number.isFinite(Number(r.digest.at)) ? whole(r.digest.at, 0, 1439, 540) : undefined;
  return {
    v: 1,
    tz: text(r.tz, 60) || 'Asia/Dubai',
    from: whole(r.from, 0, 1439, 480),
    to: whole(r.to, 0, 1440, 1260),
    days: days.length ? days : [0, 1, 2, 3, 4, 5, 6],
    units: { m: text(units.m, 8) || 'min', h: text(units.h, 8) || 'h', d: text(units.d, 8) || 'd' },
    ...(digestAt !== undefined ? { digest: { at: digestAt, title: text(r.digest.title, 80) || 'MyGarage' } } : {}),
    groups,
    madeAt: new Date().toISOString(),
  };
}

/** How long ago, short: «25 мин», «3 ч», «2 д» (the units are the plan's own words). */
export function ago(ms, units) {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${Math.max(1, min)} ${units.m}`;
  if (min < 48 * 60) return `${Math.round(min / 60)} ${units.h}`;
  return `${Math.round(min / 1440)} ${units.d}`;
}

const LINES = 6;

/**
 * What to send now (pure: the plan, what was said before, the clock → the notifications and what is said now).
 *
 * A member's time has come at its `start` — and not before its `notBefore`, when it has one (the app lists it only
 * from then). A group is due when one of its members has come to its time and was not said yet (its `start` is new to
 * the group), or when the group repeats (`every` minutes) and that long has passed since it was last said. One
 * notification a group: one car — its own words and its job's address; several — «… · 3» and the cars a line each.
 * Outside the hours nothing is due; what came due in the night is said when the hours begin. The summary (`digest`)
 * is said once a day at its time: a line a group — and the groups in it count as said then (no second notification
 * for the same a moment later). A `solo` group (a reminder, a time promised) is never part of the summary.
 *
 * Returns `state` — what was said before, kept for the plan's own groups — and `sends`: each with its `mark`, what to
 * add to the state once the notification was really taken (not taken — nothing is marked, it is due again).
 */
export function dueNow(plan, state, nowMs) {
  const was = { groups: state?.groups ?? {}, digest: state?.digest ?? '' };
  if (!plan || !plan.groups?.length || !inHours(plan, nowMs)) return { sends: [], state: was };
  const t = localTime(nowMs, plan.tz);
  const next = { groups: {}, digest: was.digest };
  // (Only the plan's own groups are remembered: one that left the plan is forgotten — back again, it is new.)
  for (const g of plan.groups) if (was.groups[g.key]) next.groups[g.key] = was.groups[g.key];
  /** As the state will be once what is in `sends` so far is taken (the summary's groups are not said twice). */
  const seenNow = { ...next.groups };
  const come = (m) => Date.parse(m.start) <= nowMs && (!m.notBefore || Date.parse(m.notBefore) <= nowMs);
  const active = plan.groups.map((g) => ({ g, on: g.members.filter(come) })).filter((x) => x.on.length);
  const badge = new Set(active.filter((x) => !x.g.solo).flatMap((x) => x.on.map((m) => m.id))).size;
  const said = (on) => ({ at: nowMs, seen: Object.fromEntries(on.map((m) => [m.id, Date.parse(m.start)])) });
  const line = (m) => (m.since ? `${m.label} · ${ago(nowMs - Date.parse(m.since), plan.units)}` : m.label);
  const sends = [];

  if (plan.digest && was.digest !== t.date && t.minutes >= plan.digest.at) {
    const rows = active.filter((x) => !x.g.solo);
    if (rows.length) {
      const mark = { digest: t.date, groups: {} };
      for (const { g, on } of rows) mark.groups[g.key] = seenNow[g.key] = said(on);
      const body = rows.map(({ g, on }) => (on.length === 1 ? `${g.title} · ${on[0].label}` : g.many.replace('{n}', String(on.length))));
      sends.push({ key: 'digest', tag: 'digest', title: plan.digest.title, body: body.slice(0, 8).join('\n'), url: '#/', badge, mark });
    } else next.digest = t.date; // nothing to sum up today: the day is done with
  }
  for (const { g, on } of active) {
    const st = seenNow[g.key] ?? { at: 0, seen: {} };
    const fresh = on.filter((m) => st.seen[m.id] !== Date.parse(m.start));
    const again = g.every > 0 && st.at > 0 && nowMs - st.at >= g.every * 60_000;
    if (!fresh.length && !again) continue;
    // What is new first; then the ones waiting longest.
    const order = [...fresh, ...on.filter((m) => !fresh.includes(m))];
    const one = on.length === 1;
    sends.push({
      key: g.key,
      tag: g.key,
      title: one ? g.title : g.many.replace('{n}', String(on.length)),
      body: one ? line(on[0]) : [...order.slice(0, LINES).map(line), ...(on.length > LINES ? [`+${on.length - LINES}`] : [])].join('\n'),
      url: one ? on[0].url || g.url : g.url,
      badge,
      mark: { groups: { [g.key]: said(on) } },
    });
  }
  return { sends, state: next };
}

/* ---------- The service ---------- */

const KEYS = 'push.vapid';
const SUBS = 'push.subs';
const PLAN = 'push.plan';
const STATE = 'push.state';

export function createPush({ store, log = () => {}, contact = 'https://neyron357-boop.github.io', fetchImpl = fetch, now = () => Date.now() }) {
  const read = (k, def) => {
    try {
      const v = store.metaGet(k);
      return v ? JSON.parse(v) : def;
    } catch {
      return def;
    }
  };
  const write = (k, v) => store.metaSet(k, JSON.stringify(v));

  let keys = read(KEYS, null);
  function vapid() {
    if (!keys?.publicKey || !keys?.privateKey) {
      keys = newVapidKeys();
      write(KEYS, keys);
      log('push: a key pair made for notifications');
    }
    return keys;
  }

  /** deviceId → { subscription, at } */
  const subs = () => read(SUBS, {});
  let last = { at: 0, ok: 0, error: '' };

  function subscribe(deviceId, subscription) {
    if (!pushService(subscription?.endpoint)) throw Object.assign(new Error('not a push service'), { status: 400 });
    // (Checked now: a subscription that cannot be sealed for is not kept.)
    encrypt('{}', subscription);
    const all = subs();
    all[deviceId] = { subscription: { endpoint: String(subscription.endpoint), keys: { p256dh: String(subscription.keys.p256dh), auth: String(subscription.keys.auth) } }, at: new Date(now()).toISOString() };
    write(SUBS, all);
  }
  function unsubscribe(deviceId) {
    const all = subs();
    if (!all[deviceId]) return false;
    delete all[deviceId];
    write(SUBS, all);
    return true;
  }

  /** One message to one device. `gone` — the phone no longer has this subscription (the app removed, permission taken back). */
  async function sendTo(deviceId, message, { ttl = 3600, topic } = {}) {
    const sub = subs()[deviceId]?.subscription;
    if (!sub) return { ok: false, status: 0, gone: false };
    const body = encrypt(JSON.stringify(message), sub);
    const headers = {
      Authorization: vapidAuth(sub.endpoint, vapid(), contact, Math.floor(now() / 1000)),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'high',
      // The same thing said again replaces what the push service still holds for a phone that is off.
      ...(topic ? { Topic: crypto.createHash('sha256').update(topic).digest('base64url').slice(0, 32) } : {}),
    };
    let res;
    try {
      res = await fetchImpl(sub.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      return { ok: false, status: 0, gone: false, error: String(e?.message ?? e) };
    }
    const gone = res.status === 404 || res.status === 410;
    if (gone) unsubscribe(deviceId);
    let error = '';
    if (!res.ok) error = (await res.text().catch(() => '')).slice(0, 200);
    return { ok: res.ok, status: res.status, gone, error };
  }

  /** A message to every subscribed device that is still paired. True — at least one took it. */
  async function sendAll(message, opts) {
    const paired = new Set(store.devices().filter((d) => !d.revoked).map((d) => d.id));
    let ok = false;
    for (const id of Object.keys(subs())) {
      if (!paired.has(id)) {
        unsubscribe(id);
        continue;
      }
      const r = await sendTo(id, message, opts);
      if (r.ok) ok = true;
      else if (!r.gone) last = { ...last, error: `${r.status} ${r.error ?? ''}`.trim() };
      if (r.gone) log(`push: a device's subscription is gone (${id})`);
    }
    return ok;
  }

  function setPlan(raw) {
    const plan = cleanPlan(raw);
    write(PLAN, plan);
    return { groups: plan.groups.length, members: plan.groups.reduce((n, g) => n + g.members.length, 0) };
  }

  let busy = false;
  /** The clock's tick: what is due is sent; said only once it was taken (not taken — tried again at the next tick). */
  async function tick() {
    if (busy) return 0;
    busy = true;
    try {
      if (!Object.keys(subs()).length) return 0;
      const before = read(STATE, {});
      const r = dueNow(read(PLAN, null), before, now());
      const next = { groups: { ...r.state.groups }, digest: r.state.digest };
      let sent = 0;
      for (const s of r.sends) {
        // Not taken by any device (no network): nothing is marked — it is due again at the next tick.
        if (!(await sendAll({ title: s.title, body: s.body, tag: s.tag, url: s.url, badge: s.badge }, { topic: s.key }))) continue;
        sent++;
        Object.assign(next.groups, s.mark.groups);
        if (s.mark.digest) next.digest = s.mark.digest;
      }
      if (JSON.stringify(next) !== JSON.stringify({ groups: before.groups ?? {}, digest: before.digest ?? '' })) write(STATE, next);
      if (sent) {
        last = { at: now(), ok: last.ok + sent, error: '' };
        log(`push: ${sent} sent (${r.sends.map((s) => s.key).join(', ').slice(0, 160)})`);
      }
      return sent;
    } catch (e) {
      log(`push: ${e?.stack || e}`);
      return 0;
    } finally {
      busy = false;
    }
  }

  let timer = null;
  return {
    publicKey: () => vapid().publicKey,
    subscribed: (deviceId) => !!subs()[deviceId],
    subscribe,
    unsubscribe,
    setPlan,
    plan: () => read(PLAN, null),
    /** «Проверить»: one notification to this device now, whatever the hours. */
    test: (deviceId, message) => sendTo(deviceId, { title: text(message?.title, 80) || 'MyGarage', body: text(message?.body, 200), tag: 'test', url: '#/notify' }, { ttl: 120, topic: 'test' }),
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), 30_000);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** For this computer's page: how many devices take notifications, when the last one went, what went wrong. */
    status: () => ({ devices: Object.keys(subs()).length, groups: read(PLAN, null)?.groups?.length ?? 0, madeAt: read(PLAN, null)?.madeAt ?? '', lastAt: last.at ? new Date(last.at).toISOString() : '', sent: last.ok, error: last.error }),
  };
}
