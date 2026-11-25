import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHearing, HEAR_GRACE, PAGE_HEARS, TIE_GRACE, TOLD_KINDS } from '../whatsapp/hearing.mjs';

/* v0.87 — is the bridge hearing WhatsApp Web? (25/11: ready, and twenty minutes of nothing heard; the old check said all was well) */

const READY = 1_000_000_000;
/** The page as it answers (`PAGE_HEARS`): marked or not, its age, its newest message (WhatsApp's seconds). */
const page = (tied, ageMs, newestMs = 0) => ({ tied, age: ageMs, newest: Math.floor(newestMs / 1000) });

describe('whatsapp: is the bridge hearing (v0.87)', () => {
  it('a page the library has not finished tying: waits a while after ready, then deaf', () => {
    const h = createHearing();
    // The page there since ready.
    assert.equal(h.judge(page(false, 30_000), { readyAt: READY, now: READY + 30_000 }).verdict, 'wait');
    const late = h.judge(page(false, TIE_GRACE + 10_000), { readyAt: READY, now: READY + TIE_GRACE + 10_000 });
    assert.equal(late.verdict, 'deaf');
    assert.equal(late.why, 'not tied');
  });

  it('a page that loaded itself again: unmarked until tied again — given its own while, and said', () => {
    const h = createHearing();
    assert.equal(h.judge(page(true, 600_000), { readyAt: READY, now: READY + 600_000 }).verdict, 'ok');
    // Ten minutes on, the page is new (20 s old) and not marked yet.
    const now = READY + 620_000;
    const fresh = h.judge(page(false, 20_000), { readyAt: READY, now });
    assert.equal(fresh.verdict, 'wait');
    assert.equal(fresh.reloaded, true);
    assert.equal(h.judge(page(false, 20_000 + TIE_GRACE), { readyAt: READY, now: now + TIE_GRACE }).verdict, 'deaf');
  });

  it('tied, and every message heard: all well', () => {
    const h = createHearing();
    const msg = READY + 60_000;
    h.heard(msg / 1000, msg + 1000);
    assert.equal(h.judge(page(true, 200_000, msg), { readyAt: READY, now: msg + 120_000 }).verdict, 'ok');
  });

  it('tied, and a message on the page never heard: twice running — deaf; once — not sure yet', () => {
    const h = createHearing();
    const heard = READY + 30_000;
    h.heard(heard / 1000, heard);
    const unheard = READY + 90_000;
    const at = unheard + HEAR_GRACE + 5_000;
    assert.equal(h.judge(page(true, 300_000, unheard), { readyAt: READY, now: at }).verdict, 'wait');
    const second = h.judge(page(true, 330_000, unheard), { readyAt: READY, now: at + 30_000 });
    assert.equal(second.verdict, 'deaf');
    assert.equal(second.why, 'not heard');
  });

  it('a message just come is given its moment; one from before ready (or before this page) does not count', () => {
    const h = createHearing();
    const now = READY + 300_000;
    // Ten seconds old: the event may still be on its way.
    assert.equal(h.judge(page(true, 300_000, now - 10_000), { readyAt: READY, now }).verdict, 'ok');
    assert.equal(h.judge(page(true, 300_000, now - 10_000), { readyAt: READY, now: now + 1000 }).verdict, 'ok');
    // Older than ready.
    assert.equal(h.judge(page(true, 600_000, READY - 5_000), { readyAt: READY, now }).verdict, 'ok');
    assert.equal(h.judge(page(true, 600_000, READY - 5_000), { readyAt: READY, now: now + 30_000 }).verdict, 'ok');
    // Older than the page (it loaded again since): this page could not have heard it.
    assert.equal(h.judge(page(true, 60_000, now - 120_000), { readyAt: READY, now }).verdict, 'ok');
    assert.equal(h.judge(page(true, 90_000, now - 120_000), { readyAt: READY, now: now + 30_000 }).verdict, 'ok');
  });

  it('heard between two looks: the strike is forgotten', () => {
    const h = createHearing();
    const unheard = READY + 90_000;
    const at = unheard + HEAR_GRACE + 5_000;
    assert.equal(h.judge(page(true, 300_000, unheard), { readyAt: READY, now: at }).verdict, 'wait');
    h.heard(unheard / 1000, at + 1000);
    assert.equal(h.judge(page(true, 330_000, unheard), { readyAt: READY, now: at + 30_000 }).verdict, 'ok');
  });

  it('started again for deafness: at once the first time, then less and less often; anything heard — at once again', () => {
    const h = createHearing();
    const waits = [h.again(), h.again(), h.again(), h.again(), h.again(), h.again()];
    assert.ok(waits[0] <= 5_000);
    for (let i = 1; i < waits.length; i++) assert.ok(waits[i] >= waits[i - 1]);
    assert.ok(waits.at(-1) >= 15 * 60_000);
    h.heard(READY / 1000, READY);
    assert.ok(h.again() <= 5_000);
  });

  it('a new WhatsApp Web forgets what the last one heard', () => {
    const h = createHearing();
    const msg = READY + 60_000;
    h.heard(msg / 1000, msg);
    h.fresh();
    const ready2 = msg + 10_000;
    const unheard = ready2 + 30_000;
    // The message heard by the last one is not this one's.
    assert.equal(h.judge(page(true, 100_000, unheard), { readyAt: ready2, now: unheard + HEAR_GRACE + 5_000 }).verdict, 'wait');
  });

  it("the page's own answer: only messages added as new, of kinds the library tells of, in the garage's chats", () => {
    const models = (list) => ({ getModelsArray: () => list });
    const chat = (id, t, msgs) => ({ id: { _serialized: id }, t, msgs: models(msgs) });
    const globals = {
      __mgTied: true,
      require: () => ({
        Chat: models([
          chat('971501234567@c.us', 2000, [
            { t: 1990, isNewMsg: true, type: 'chat' },
            // a group's notice and a message read from the past: not counted
            { t: 1999, isNewMsg: true, type: 'gp2' },
            { t: 1998, isNewMsg: false, type: 'chat' },
          ]),
          chat('120363000000000001@g.us', 2100, [{ t: 2050, isNewMsg: true, type: 'image' }]),
          // the status feed is not a chat of the garage's
          chat('status@broadcast', 3000, [{ t: 3000, isNewMsg: true, type: 'image' }]),
          // a chat quiet since before `since`
          chat('971509999999@c.us', 100, [{ t: 100, isNewMsg: true, type: 'chat' }]),
        ]),
      }),
    };
    const was = { window: globalThis.window };
    globalThis.window = globals;
    try {
      const out = PAGE_HEARS(1000, TOLD_KINDS);
      assert.equal(out.tied, true);
      assert.equal(out.newest, 2050);
      assert.equal(typeof out.age, 'number');
      assert.equal(out.error, undefined);
      globals.__mgTied = undefined;
      assert.equal(PAGE_HEARS(1000, TOLD_KINDS).tied, false);
    } finally {
      globalThis.window = was.window;
    }
  });
});
