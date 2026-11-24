import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ago, cleanPlan, createPush, dueNow, encrypt, inHours, localTime, newVapidKeys, pushService, vapidAuth } from '../src/push.mjs';
import { openStore } from '../src/store.mjs';

const from64 = (s) => Buffer.from(s, 'base64url');

/** What the phone does with a push message (RFC 8291, the receiving side): the text back, or a throw. */
function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const sealed = body.subarray(21 + idlen);
  const secret = ua.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'the last record ends with 0x02');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

describe('a push message sealed for the phone (RFC 8291)', () => {
  it('the RFC’s own example, byte for byte', () => {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(from64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'));
    assert.equal(ecdh.getPublicKey().toString('base64url'), 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    const body = encrypt(
      'When I grow up, I want to be a watermelon',
      { keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } },
      { salt: from64('DGv6ra1nlYgDCS1FRnbzlw'), ecdh },
    );
    assert.equal(
      body.toString('base64url'),
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('a message of its own (random salt and key) opens on the phone’s side — Russian words and all; another phone cannot open it', () => {
    const ua = crypto.createECDH('prime256v1');
    ua.generateKeys();
    const auth = crypto.randomBytes(16);
    const sub = { keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
    const msg = JSON.stringify({ title: 'Назвать цену · 3', body: 'Renault Kwid · 67445 · 2 ч\nHonda Civic · 38203' });
    const a = encrypt(msg, sub);
    const b = encrypt(msg, sub);
    assert.equal(decrypt(a, ua, auth), msg);
    assert.notDeepEqual(a, b, 'a new salt and key every message');
    const other = crypto.createECDH('prime256v1');
    other.generateKeys();
    assert.throws(() => decrypt(a, other, auth));
    assert.throws(() => encrypt('x', { keys: { p256dh: 'AAAA', auth: 'AAAA' } }), /bad subscription/);
  });
});

describe('who sends (VAPID, RFC 8292)', () => {
  it('a JWT signed ES256 with this server’s key: the push service’s origin, half a day, the contact; verified by the public key', () => {
    const keys = newVapidKeys();
    assert.equal(from64(keys.publicKey).length, 65);
    const h = vapidAuth('https://web.push.apple.com/QOx9abc', keys, 'https://neyron357-boop.github.io', 1_800_000_000);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h);
    assert.ok(m, h);
    assert.deepEqual(JSON.parse(from64(m[1])), { typ: 'JWT', alg: 'ES256' });
    assert.deepEqual(JSON.parse(from64(m[2])), { aud: 'https://web.push.apple.com', exp: 1_800_000_000 + 12 * 3600, sub: 'https://neyron357-boop.github.io' });
    assert.equal(m[4], keys.publicKey);
    const pub = from64(keys.publicKey);
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.equal(from64(m[3]).length, 64);
    assert.ok(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, from64(m[3])));
  });

  it('only the browsers’ push services are written to', () => {
    assert.ok(pushService('https://web.push.apple.com/QGk1abc'));
    assert.ok(pushService('https://fcm.googleapis.com/fcm/send/abc:def'));
    assert.ok(pushService('https://updates.push.services.mozilla.com/wpush/v2/abc'));
    assert.ok(pushService('https://wns2-par02p.notify.windows.com/w/?token=abc'));
    for (const bad of ['http://web.push.apple.com/x', 'https://push.apple.com.evil.example/x', 'https://127.0.0.1/x', 'https://evil.example/web.push.apple.com', 'https://user@web.push.apple.com/x', 'https://web.push.apple.com:8443/x', 'nonsense', '']) assert.equal(pushService(bad), false, bad);
  });
});

/* ---------- The clock ---------- */

// Dubai is UTC+4 all year: 2026-11-24 is a Tuesday.
const at = (hhmm, day = '2026-11-24') => Date.parse(`${day}T${hhmm}:00+04:00`);
const plan = (over = {}) =>
  cleanPlan({
    tz: 'Asia/Dubai',
    from: 8 * 60,
    to: 21 * 60,
    days: [0, 1, 2, 3, 4, 5, 6],
    units: { m: 'мин', h: 'ч', d: 'д' },
    groups: [
      {
        key: 'price',
        title: 'Назвать цену',
        many: 'Назвать цену · {n}',
        every: 60,
        url: '#/',
        members: [
          { id: 'price:a', label: 'Renault Kwid · 67445', url: '#/orders/a', start: new Date(at('10:00')).toISOString(), since: new Date(at('09:00')).toISOString() },
          { id: 'price:b', label: 'Honda Civic · 38203', url: '#/orders/b', start: new Date(at('11:30')).toISOString(), since: new Date(at('10:30')).toISOString() },
        ],
      },
    ],
    ...over,
  });
/** Run the clock over the given moments, taking every notification. */
function run(p, times, state = {}) {
  const out = [];
  for (const t of times) {
    const r = dueNow(p, state, t);
    state = { groups: { ...r.state.groups }, digest: r.state.digest };
    for (const s of r.sends) {
      Object.assign(state.groups, s.mark.groups);
      if (s.mark.digest) state.digest = s.mark.digest;
      out.push({ t: new Date(t + 4 * 3600_000).toISOString().slice(11, 16), key: s.key, title: s.title, body: s.body, url: s.url, badge: s.badge });
    }
  }
  return { out, state };
}

describe('what is due now', () => {
  it('the time of day, the weekday and the date are the garage’s (Dubai), whatever this computer’s clock', () => {
    assert.deepEqual(localTime(Date.parse('2026-11-23T20:30:00Z'), 'Asia/Dubai'), { minutes: 30, day: 2, date: '2026-11-24' });
    assert.deepEqual(localTime(Date.parse('2026-11-24T19:59:00Z'), 'Asia/Dubai'), { minutes: 23 * 60 + 59, day: 2, date: '2026-11-24' });
    assert.equal(localTime(0, 'No/Such_Zone').date, '1970-01-01');
  });

  it('a car without a price: said when its hour is up, then every hour; a second car joins — said at once, both in one notification', () => {
    const { out } = run(plan(), [at('09:59'), at('10:00'), at('10:30'), at('11:00'), at('11:30'), at('12:00'), at('12:30')]);
    assert.deepEqual(
      out.map((x) => [x.t, x.title, x.body, x.url]),
      [
        ['10:00', 'Назвать цену', 'Renault Kwid · 67445 · 1 ч', '#/orders/a'],
        ['11:00', 'Назвать цену', 'Renault Kwid · 67445 · 2 ч', '#/orders/a'],
        // The Civic's hour is up: at once (not at 12:00), the new one first.
        ['11:30', 'Назвать цену · 2', 'Honda Civic · 38203 · 1 ч\nRenault Kwid · 67445 · 3 ч', '#/'],
        // Said again an hour after it was last said — the one waiting longest first.
        ['12:30', 'Назвать цену · 2', 'Renault Kwid · 67445 · 4 ч\nHonda Civic · 38203 · 2 ч', '#/'],
      ],
    );
    assert.equal(out[2].badge, 2);
  });

  it('`every` 0 — once; a member gone and back with a new start is new; a group that left the plan is forgotten', () => {
    const once = plan();
    once.groups[0].every = 0;
    assert.equal(run(once, [at('10:00'), at('11:00'), at('12:00'), at('13:00')]).out.length, 2); // the Kwid, then the Civic joining
    // The price told (the car leaves the plan), then a new line — its hour starts again.
    const a = run(plan(), [at('10:00')]);
    const gone = cleanPlan({ ...plan(), groups: [{ key: 'answer', title: 'Ждём ответа', every: 0, members: [{ id: 'answer:a', label: 'Renault Kwid', start: new Date(at('10:05')).toISOString() }] }] });
    const b = run(gone, [at('10:10')], a.state);
    assert.deepEqual(Object.keys(b.state.groups), ['answer']);
    const back = plan();
    back.groups[0].members = [{ ...back.groups[0].members[0], start: new Date(at('14:00')).toISOString() }];
    assert.deepEqual(run(back, [at('13:59'), at('14:00'), at('14:30')], b.state).out.map((x) => x.t), ['14:00']);
  });

  it('nothing outside the manager’s hours and days; what came due in the night is said when the hours begin', () => {
    const p = plan();
    assert.equal(inHours(p, at('07:59')), false);
    assert.equal(inHours(p, at('08:00')), true);
    assert.equal(inHours(p, at('21:00')), false);
    const night = plan();
    night.groups[0].members[0].start = new Date(at('23:00', '2026-11-23')).toISOString();
    assert.deepEqual(run(night, [at('23:00', '2026-11-23'), at('03:00'), at('07:59'), at('08:00'), at('08:30')]).out.map((x) => x.t), ['08:00']);
    // Fridays off.
    const noFri = plan({ days: [0, 1, 2, 3, 4, 6] });
    assert.equal(inHours(noFri, at('12:00', '2026-11-27')), false);
    assert.equal(inHours(noFri, at('12:00', '2026-11-28')), true);
    // Hours over midnight (a night shift).
    const late = plan({ from: 20 * 60, to: 2 * 60 });
    assert.deepEqual([inHours(late, at('19:59')), inHours(late, at('23:00')), inHours(late, at('01:59')), inHours(late, at('02:00'))], [false, true, true, false]);
  });

  it('the morning’s summary: once a day at its time, a line a group; its groups are not said a second time a moment later; a reminder is its own', () => {
    const p = plan({ digest: { at: 9 * 60, title: 'Сегодня' } });
    p.groups[0].members.forEach((m, i) => {
      m.start = new Date(at('18:00', '2026-11-23')).toISOString();
      m.since = new Date(at(i ? '10:00' : '09:00', '2026-11-23')).toISOString();
    });
    p.groups.push(
      cleanPlan({ groups: [{ key: 'answer', title: 'Ждём ответа', many: 'Ждём ответа · {n}', every: 120, members: [{ id: 'answer:c', label: 'Nissan X-Trail', start: new Date(at('07:00')).toISOString() }] }] }).groups[0],
      cleanPlan({ groups: [{ key: 'rem:1', solo: true, title: 'Напоминание', every: 0, members: [{ id: 'rem:1', label: 'Позвонить Ахмеду', start: new Date(at('09:00')).toISOString() }] }] }).groups[0],
    );
    // The hours begin at 08:00 (the groups due since the night are said), the summary at 09:00.
    const { out } = run(p, [at('08:00'), at('08:30'), at('09:00'), at('09:01'), at('10:00'), at('10:05'), at('09:00', '2026-11-25')]);
    assert.deepEqual(
      out.map((x) => [x.t, x.key, x.title, x.body]),
      [
        ['08:00', 'price', 'Назвать цену · 2', 'Renault Kwid · 67445 · 23 ч\nHonda Civic · 38203 · 22 ч'],
        ['08:00', 'answer', 'Ждём ответа', 'Nissan X-Trail'],
        ['09:00', 'digest', 'Сегодня', 'Назвать цену · 2\nЖдём ответа · Nissan X-Trail'],
        ['09:00', 'rem:1', 'Напоминание', 'Позвонить Ахмеду'],
        // An hour after the summary, not after 08:00.
        ['10:00', 'price', 'Назвать цену · 2', 'Renault Kwid · 67445 · 25 ч\nHonda Civic · 38203 · 24 ч'],
        ['09:00', 'digest', 'Сегодня', 'Назвать цену · 2\nЖдём ответа · Nissan X-Trail'],
      ],
    );
    // A day with nothing to sum up: no summary, and none later that day either.
    const quiet = plan({ digest: { at: 9 * 60, title: 'Сегодня' } });
    quiet.groups[0].members.forEach((m) => (m.start = new Date(at('15:00')).toISOString()));
    const q = run(quiet, [at('09:00'), at('15:00'), at('15:01')]);
    assert.deepEqual(q.out.map((x) => x.key), ['price']);
    assert.equal(q.state.digest, '2026-11-24');
  });

  it('many cars: six lines and «+N»; how long ago in minutes, hours, days', () => {
    const big = plan();
    big.groups[0].members = Array.from({ length: 9 }, (_, i) => ({ id: `price:${i}`, label: `Car ${i}`, url: '', start: new Date(at('09:00')).toISOString() }));
    const { out } = run(big, [at('09:00')]);
    assert.equal(out[0].title, 'Назвать цену · 9');
    assert.equal(out[0].body.split('\n').length, 7);
    assert.equal(out[0].body.split('\n')[6], '+3');
    const u = { m: 'мин', h: 'ч', d: 'д' };
    assert.deepEqual([ago(20_000, u), ago(25 * 60_000, u), ago(3 * 3600_000, u), ago(47 * 3600_000, u), ago(72 * 3600_000, u)], ['1 мин', '25 мин', '3 ч', '47 ч', '3 д']);
  });

  it('a plan from the app is made safe: nonsense dropped, sizes bounded, the defaults where nothing is said', () => {
    const p = cleanPlan({ from: 'x', to: 99999, days: [1, 1, 9, 'a'], groups: [{ key: '', members: [{ id: 'a', start: 'now' }] }, { key: 'k', title: 'T'.repeat(500), every: -5, members: [{ id: 'a', start: 'no date' }, { id: 'b', label: 5, start: '2026-11-24T10:00:00Z' }] }] });
    assert.deepEqual([p.from, p.to, p.days, p.tz, p.units], [480, 1440, [1], 'Asia/Dubai', { m: 'min', h: 'h', d: 'd' }]);
    assert.equal(p.groups.length, 1);
    assert.deepEqual([p.groups[0].title.length, p.groups[0].every, p.groups[0].members], [80, 0, [{ id: 'b', label: '', url: '', start: '2026-11-24T10:00:00.000Z' }]]);
    assert.deepEqual(cleanPlan(null).groups, []);
  });
});

/* ---------- The service: subscriptions, the plan kept, sending ---------- */

describe('the notifications’ service', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-push-'));
  const store = openStore(dir, { keepBackups: 1 });
  after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const phone = store.addDevice('iPhone', 'install-phone-1');
  const pc = store.addDevice('PC', 'install-pc-000001');
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = (host = 'web.push.apple.com') => ({ endpoint: `https://${host}/token-${Math.random().toString(36).slice(2)}`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } });
  let clock = at('09:00');
  let answer = () => new Response(null, { status: 201 });
  const posted = [];
  const push = createPush({
    store,
    now: () => clock,
    fetchImpl: async (url, init) => {
      posted.push({ url, headers: init.headers, message: JSON.parse(decrypt(Buffer.from(init.body), ua, auth)) });
      return answer(url);
    },
  });

  it('its key pair is made once and kept; a subscription to anything but a push service is refused', () => {
    const key = push.publicKey();
    assert.equal(from64(key).length, 65);
    assert.equal(createPush({ store }).publicKey(), key);
    assert.throws(() => push.subscribe(phone.id, { endpoint: 'https://evil.example/x', keys: sub().keys }), /not a push service/);
    assert.throws(() => push.subscribe(phone.id, { endpoint: sub().endpoint, keys: { p256dh: 'AA', auth: 'AA' } }), /bad subscription/);
    assert.equal(push.subscribed(phone.id), false);
  });

  it('«Проверить»: one notification to this device, sealed and signed as the push service asks', async () => {
    const s = sub();
    push.subscribe(phone.id, s);
    assert.equal(push.subscribed(phone.id), true);
    const r = await push.test(phone.id, { title: 'MyGarage', body: 'Уведомления работают' });
    assert.deepEqual([r.ok, r.status, r.gone], [true, 201, false]);
    const p = posted.pop();
    assert.equal(p.url, s.endpoint);
    assert.deepEqual(p.message, { title: 'MyGarage', body: 'Уведомления работают', tag: 'test', url: '#/notify' });
    assert.match(p.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    assert.deepEqual([p.headers['Content-Encoding'], p.headers.TTL, p.headers.Urgency], ['aes128gcm', '120', 'high']);
    assert.match(p.headers.Topic, /^[\w-]{1,32}$/);
  });

  it('the plan’s due notifications go to every subscribed device; said once taken; not taken — tried again', async () => {
    push.subscribe(pc.id, sub('fcm.googleapis.com'));
    const made = push.setPlan(plan());
    assert.deepEqual(made, { groups: 1, members: 2 });
    posted.length = 0;
    clock = at('10:00');
    // No network: nothing is marked.
    answer = () => {
      throw new Error('offline');
    };
    assert.equal(await push.tick(), 0);
    assert.equal(posted.length, 2);
    posted.length = 0;
    answer = () => new Response(null, { status: 201 });
    clock = at('10:01');
    assert.equal(await push.tick(), 1);
    assert.deepEqual(posted.map((p) => new URL(p.url).hostname).sort(), ['fcm.googleapis.com', 'web.push.apple.com']);
    assert.deepEqual(posted[0].message, { title: 'Назвать цену', body: 'Renault Kwid · 67445 · 1 ч', tag: 'price', url: '#/orders/a', badge: 1 });
    posted.length = 0;
    // Half a minute later: said already.
    clock = at('10:02');
    assert.equal(await push.tick(), 0);
    assert.equal(posted.length, 0);
    clock = at('11:01');
    assert.equal(await push.tick(), 1);
    assert.equal(push.status().devices, 2);
  });

  it('a phone that no longer has the subscription (410) is forgotten; a device unpaired gets nothing more', async () => {
    posted.length = 0;
    answer = (url) => new Response('unsubscribed', { status: new URL(url).hostname === 'web.push.apple.com' ? 410 : 201 });
    clock = at('12:01');
    assert.equal(await push.tick(), 1);
    assert.equal(push.subscribed(phone.id), false);
    assert.equal(push.subscribed(pc.id), true);
    answer = () => new Response(null, { status: 201 });
    store.revoke(pc.id);
    posted.length = 0;
    clock = at('13:01');
    assert.equal(await push.tick(), 0);
    assert.equal(posted.length, 0);
    assert.equal(push.status().devices, 0);
  });
});

/* ---------- The API the app calls ---------- */

describe('the notifications’ API', async () => {
  const { createServer } = await import('node:http');
  const { createApi, createPairing } = await import('../src/api.mjs');
  const { loadConfig } = await import('../src/config.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-push-api-'));
  const store = openStore(dir, { keepBackups: 1 });
  const pairing = createPairing();
  const sent = [];
  const push = createPush({ store, fetchImpl: async (url) => (sent.push(url), new Response(null, { status: 201 })) });
  const server = createServer(createApi({ store, config: loadConfig({ DATA_DIR: dir }), pairing, log: () => {}, push }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  after(() => {
    server.close();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const call = (p, { token, body } = {}) => fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'X-Sync': '2', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

  it('a paired device takes the key, subscribes, leaves the plan, tests, and leaves; no key — nothing', async () => {
    assert.equal((await call('/api/push/key')).status, 401);
    const { code } = pairing.issue();
    const token = (await (await call('/api/pair', { body: { code, name: 'iPhone', install: 'install-api-000001' } })).json()).token;
    const key = await (await call('/api/push/key', { token })).json();
    assert.deepEqual([key.ok, key.subscribed, from64(key.key).length], [true, false, 65]);
    const ua = crypto.createECDH('prime256v1');
    ua.generateKeys();
    const subscription = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
    assert.equal((await call('/api/push/subscribe', { token, body: { subscription: { ...subscription, endpoint: 'https://evil.example/x' } } })).status, 400);
    assert.equal((await call('/api/push/subscribe', { token, body: { subscription } })).status, 200);
    assert.equal((await (await call('/api/push/key', { token })).json()).subscribed, true);
    assert.deepEqual(await (await call('/api/push/plan', { token, body: { plan: plan() } })).json(), { ok: true, groups: 1, members: 2 });
    assert.equal(push.plan().groups[0].key, 'price');
    assert.deepEqual(await (await call('/api/push/test', { token, body: { title: 'MyGarage', body: 'ok' } })).json(), { ok: true, status: 201, gone: false });
    assert.deepEqual(sent, ['https://web.push.apple.com/abc']);
    assert.deepEqual(await (await call('/api/push/unsubscribe', { token, body: {} })).json(), { ok: true, was: true });
    assert.equal(push.subscribed(store.devices()[0].id), false);
  });
});
