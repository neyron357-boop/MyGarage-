import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { channelOf, createRelay, DEFAULT_RELAY, keyHash, openAddress, sealAddress } from '../src/relay.mjs';
import { openStore } from '../src/store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-relay-'));
const store = openStore(dir, { keepBackups: 1 });
after(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the address left for the devices (v0.42.2)', () => {
  it('is sealed: only its key and topic open it, and a changed letter does not', () => {
    const key = Buffer.alloc(32, 7).toString('base64url');
    const sealed = sealAddress(key, 'topic-a', 'https://new-name.trycloudflare.com', 1000);
    assert.match(sealed, /^mg1\.[\w-]+\.[\w-]+$/);
    assert.ok(!sealed.includes('trycloudflare'));
    assert.deepEqual(openAddress(key, 'topic-a', sealed), { u: 'https://new-name.trycloudflare.com', t: 1000 });
    assert.equal(openAddress(Buffer.alloc(32, 8).toString('base64url'), 'topic-a', sealed), undefined);
    assert.equal(openAddress(key, 'topic-b', sealed), undefined);
    const last = sealed.at(-2) === 'A' ? 'B' : 'A';
    assert.equal(openAddress(key, 'topic-a', sealed.slice(0, -2) + last + sealed.at(-1)), undefined);
  });

  it('each device has its own channel, made from its own key — the same every time', () => {
    const a = channelOf(keyHash('token-a'));
    assert.deepEqual(channelOf(keyHash('token-a')), a);
    assert.match(a.topic, /^[\w-]{24}$/);
    assert.equal(Buffer.from(a.key, 'base64url').length, 32);
    const b = channelOf(keyHash('token-b'));
    assert.notEqual(a.topic, b.topic);
    assert.notEqual(a.key, b.key);
  });

  it('is sent to every paired device when the address is new — once, kept off push services; a device cut off is not told', async () => {
    const one = store.addDevice('iPhone', 'install-relay-one-1');
    const two = store.addDevice('PC', 'install-relay-two-2');
    const gone = store.addDevice('Old', 'install-relay-old-3');
    store.revoke(gone.id);
    const sent = [];
    const fetchImpl = async (url, init) => {
      sent.push({ url, init });
      return new Response('{}', { status: 200 });
    };
    const relay = createRelay({ store, base: 'http://127.0.0.1:9/relay', fetchImpl });
    assert.deepEqual(relay.info(), { url: 'http://127.0.0.1:9/relay' });
    relay.publish('https://one.trycloudflare.com/');
    // The send started by publish (`flush` waits for the one under way).
    await relay.flush();
    relay.publish('https://one.trycloudflare.com');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sent.length, 2);
    for (const d of [one, two]) {
      const { topic, key } = channelOf(keyHash(d.token));
      const to = sent.find((s) => s.url === `http://127.0.0.1:9/relay/${topic}`);
      assert.ok(to, 'sent to each paired device');
      assert.equal(to.init.method, 'POST');
      assert.equal(to.init.headers.Firebase, 'no');
      assert.equal(openAddress(key, topic, to.init.body).u, 'https://one.trycloudflare.com');
    }
    assert.ok(!sent.some((s) => s.url.endsWith(channelOf(keyHash(gone.token)).topic)));
    assert.equal(relay.status().devices, 2);
    // A new address: to both again. A device just paired: its own channel at once.
    relay.publish('https://two.trycloudflare.com');
    await relay.flush();
    assert.equal(sent.length, 4);
    const three = store.addDevice('iPad', 'install-relay-new-4');
    relay.paired(three.token);
    await new Promise((r) => setTimeout(r, 30));
    const own = channelOf(keyHash(three.token));
    assert.equal(openAddress(own.key, own.topic, sent.at(-1).init.body).u, 'https://two.trycloudflare.com');
    relay.stop();
    for (const d of [one, two, three]) store.revoke(d.id);
  });

  it('never leaves a local address on the public relay; a failed send is kept as an error, not thrown', async () => {
    const d = store.addDevice('iPhone', 'install-relay-fail-5');
    const sent = [];
    const relay = createRelay({
      store,
      base: DEFAULT_RELAY,
      fetchImpl: async (url, init) => {
        sent.push({ url, init });
        throw new TypeError('fetch failed');
      },
    });
    relay.publish('http://127.0.0.1:8787');
    await relay.flush();
    assert.equal(sent.length, 0);
    relay.publish('https://three.trycloudflare.com');
    await relay.flush();
    assert.equal(sent.length, 1);
    assert.match(relay.status().error, /fetch failed/);
    relay.stop();
    store.revoke(d.id);
    assert.equal(createRelay({ store, base: '' }), null);
  });
});
