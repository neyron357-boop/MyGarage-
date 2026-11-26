import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createHistoryLoader } from '../src/waHistory.mjs';

/* The older messages fetched from the phone by the server itself (v0.91.3) — the bridge played: made-up chats only. */

function setup(chats, answers) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mg-hist-')), 'history.json');
  const told = [];
  const asked = [];
  let t = 1_000_000;
  const bridge = {
    async json(p, init = {}) {
      if (p === '/history-state') return { chats: chats.map(({ id, end }) => ({ id, end })) };
      if (p === '/history-sync') {
        const id = init.body.chat;
        asked.push(id);
        const c = chats.find((x) => x.id === id);
        if (c.end !== 0 && c.end !== 2) return { asked: false, end: c.end };
        const next = (answers[id] ?? []).shift() ?? { result: 'none' };
        const end = c.end;
        if (next.endNow !== undefined) c.end = next.endNow;
        return { asked: true, end, result: next.result, endNow: c.end, older: next.older ?? null };
      }
      throw new Error('not played ' + p);
    },
  };
  const loader = createHistoryLoader({ file, bridge, ready: () => true, tell: (e) => told.push(e), now: () => (t += 1000) });
  return { loader, told, asked, file };
}

describe('the older messages fetched from the phone by the server (v0.91.3)', () => {
  it('asks each chat with more on the phone; one that gives — asked again while more comes, the devices told; kept', async () => {
    const chats = [
      { id: '971500000001@c.us', end: 0 },
      { id: '971500000002@c.us', end: 1 },
      { id: '971500000003@c.us', end: 0 },
    ];
    const { loader, told, asked, file } = setup(chats, {
      '971500000001@c.us': [{ result: 'ok', older: true }, { result: 'ok', older: true, endNow: 1 }],
      '971500000003@c.us': [{ result: 'ok', older: false, endNow: 1 }],
    });
    const s = await loader.pass('hand');
    assert.deepEqual(asked, ['971500000001@c.us', '971500000001@c.us', '971500000003@c.us']);
    assert.deepEqual(told.filter((e) => e.t === 'history').map((e) => e.chat), ['971500000001@c.us', '971500000001@c.us']);
    assert.equal(s.phone, 'gives');
    assert.equal(s.more, 0);
    assert.equal(s.came, 1);
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(kept.chats['971500000001@c.us'].came, 2);
    assert.ok(!JSON.stringify(kept).includes('text'));
  });

  it('the phone answers without them (no access for this device) — the pass stops and says so', async () => {
    const chats = [
      { id: '971500000011@c.us', end: 2 },
      { id: '971500000012@c.us', end: 2 },
    ];
    const { loader, asked } = setup(chats, { '971500000011@c.us': [{ result: 'ok', older: false }] });
    const s = await loader.pass('hand');
    assert.equal(asked.length, 1);
    assert.equal(s.phone, 'noAccess');
    assert.equal(s.noAccess, 2);
  });

  it('three chats without an answer — the phone is not answering: the pass stops; by itself never asked again (v0.91.7)', async () => {
    const chats = ['21', '22', '23', '24', '25'].map((n) => ({ id: `9715000000${n}@c.us`, end: 0 }));
    const { loader, asked } = setup(chats, {});
    const s = await loader.pass('hand');
    assert.equal(asked.length, 3);
    assert.equal(s.phone, 'silent');
    // Each ask is «sync started / finished» on the phone: by itself — every 15 minutes, after a message from the phone —
    // nothing is asked of a phone that does not give them.
    await loader.pass('time');
    await loader.pass('phone');
    assert.equal(asked.length, 3);
    // By hand — asked again: the three asked lately wait, the two not asked yet are asked.
    await loader.pass('hand');
    assert.ok(asked.length > 3);
  });

  it('v0.91.7: a phone never asked, or one that gave nothing — not asked by itself; one that gives — asked by itself', async () => {
    const chats = [
      { id: '971500000031@c.us', end: 0 },
      { id: '971500000032@c.us', end: 0 },
      { id: '971500000033@c.us', end: 2 },
    ];
    const { loader, asked } = setup(chats, {
      '971500000031@c.us': [{ result: 'ok', older: true, endNow: 1 }],
      '971500000033@c.us': [{ result: 'ok', older: false }],
    });
    // Never asked: by itself — nothing.
    assert.equal((await loader.pass('time')).phone, 'unknown');
    assert.equal(asked.length, 0);
    // By hand: the first gives (then nothing more on the phone), the second does not answer.
    await loader.pass('hand');
    assert.deepEqual(asked, ['971500000031@c.us', '971500000032@c.us', '971500000033@c.us']);
    // The third answered without giving (no access): its last word — by itself nothing more.
    assert.equal(loader.summary().phone, 'noAccess');
    await loader.pass('time');
    assert.equal(asked.length, 3);
  });

  it('v0.91.7: the phone gave older messages lately — asked by itself, as before', async () => {
    const chats = [
      { id: '971500000041@c.us', end: 0 },
      { id: '971500000042@c.us', end: 0 },
    ];
    const { loader, asked } = setup(chats, {
      '971500000041@c.us': [{ result: 'ok', older: true, endNow: 1 }],
      '971500000042@c.us': [{ result: 'ok', older: true, endNow: 1 }],
    });
    // The person asked once for one chat's worth: the phone gave.
    chats[1].end = 1;
    await loader.pass('hand');
    assert.equal(loader.summary().phone, 'gives');
    // More came on the phone for the second (as WhatsApp says): by itself — asked.
    chats[1].end = 0;
    await loader.pass('time');
    assert.deepEqual(asked, ['971500000041@c.us', '971500000042@c.us']);
  });
});
