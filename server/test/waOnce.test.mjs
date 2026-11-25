import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createOnce, SEND_KEY } from '../whatsapp/once.mjs';

describe('whatsapp: one message for one key (v0.84)', () => {
  it('the same key again — the same answer, the send done once', async () => {
    const once = createOnce();
    let sent = 0;
    let release;
    const slow = () => new Promise((r) => (release = () => r({ id: `m${++sent}` })));
    const a = once('p:abc123', slow);
    // Asked again while the first is on its way (the network dropped its answer): waits for it, sends nothing.
    const b = once('p:abc123', slow);
    await new Promise((r) => setImmediate(r));
    release();
    assert.deepEqual(await a, { id: 'm1' });
    assert.deepEqual(await b, { id: 'm1' });
    // And after it went.
    assert.deepEqual(await once('p:abc123', slow), { id: 'm1' });
    assert.equal(sent, 1);
  });

  it('a send that failed forgets its key: sent again, it goes', async () => {
    const once = createOnce();
    let n = 0;
    await assert.rejects(once('p:fail01', async () => {
      n++;
      throw new Error('not ready');
    }));
    assert.deepEqual(await once('p:fail01', async () => ({ id: `ok${++n}` })), { id: 'ok2' });
  });

  it('no key or a bad one — every time, as before', async () => {
    const once = createOnce();
    let n = 0;
    const go = async () => ++n;
    await once(undefined, go);
    await once('', go);
    await once('bad key with spaces', go);
    await once('../../etc', go);
    assert.equal(n, 4);
    assert.ok(SEND_KEY.test('p:3f2a-9b_cc'));
  });

  it('kept half an hour', async () => {
    let t = 0;
    const once = createOnce({ now: () => t });
    let n = 0;
    const go = async () => ++n;
    await once('p:keep01', go);
    t = 29 * 60_000;
    await once('p:keep01', go);
    assert.equal(n, 1);
    t = 31 * 60_000;
    await once('p:keep01', go);
    assert.equal(n, 2);
  });
});
