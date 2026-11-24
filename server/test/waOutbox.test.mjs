import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { cleanItem, createOutbox } from '../src/waOutbox.mjs';

/*
 * What goes by itself (v0.79): reports and requests kept on this computer and sent when WhatsApp answers — once, in
 * order, unhurried. The bridge is played here; nothing reaches WhatsApp.
 */

const fast = { message: [0, 0], chats: [0, 0] };

function setup({ media, waitMedia = 50 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-outbox-'));
  const said = [];
  const told = [];
  let up = true;
  let failWith = 0;
  const bridge = {
    async json(p, init = {}) {
      if (failWith) throw Object.assign(new Error('bridge says no'), { status: failWith });
      said.push({ p, body: init.body });
      if (p.startsWith('/number')) return p.includes('971500009999') ? { ok: false, chat: '' } : { ok: true, chat: '55512345678901@lid' };
      return { ok: true };
    },
    async file(x) {
      if (failWith) throw Object.assign(new Error('bridge says no'), { status: failWith });
      said.push({ p: '/file', name: x.name, caption: x.caption, mime: x.mime, doc: x.doc, size: x.bytes.length, chat: x.chat });
      return { ok: true };
    },
  };
  const store = { file: (id, variant) => (media?.[`${id}:${variant}`] ? { abs: media[`${id}:${variant}`], type: 'image/jpeg' } : undefined) };
  const box = createOutbox({ dir, store, bridge, ready: () => up, tell: (e) => told.push(e), pace: fast, waitMedia });
  /** The waiting item made due now (its «later» passed). */
  const due = () => {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'sent.json')) {
      const it = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      fs.writeFileSync(path.join(dir, f), JSON.stringify({ ...it, next: 0 }));
    }
  };
  return { dir, box, said, told, due, setUp: (v) => (up = v), failWith: (s) => (failWith = s), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('whatsapp outbox', () => {
  it('an item is checked: a key, a chat or a number, parts', () => {
    assert.throws(() => cleanItem({ key: 'x', chat: 'a@c.us', parts: [{ text: 'hi' }] }), /bad key/);
    assert.throws(() => cleanItem({ key: 'boss:1', parts: [{ text: 'hi' }] }), /no chat/);
    assert.throws(() => cleanItem({ key: 'boss:1', chat: 'not a chat', parts: [{ text: 'hi' }] }), /bad chat/);
    assert.throws(() => cleanItem({ key: 'boss:1', chat: '971500000001@c.us', parts: [] }), /bad parts/);
    assert.deepEqual(cleanItem({ key: 'boss:1', phone: '+971 50 000 0001', parts: [{ text: ' hi ' }], extra: 1 }), { key: 'boss:1', chat: '', phone: '971500000001', parts: [{ text: 'hi' }], gap: 0, title: '' });
  });

  it('sent once, in order, and never again under the same key — over a restart too', async () => {
    const t = setup();
    try {
      const pdf = Buffer.from('%PDF-1.4').toString('base64');
      const first = t.box.put({ key: 'boss:invoice:INV1', chat: '971500000001@c.us', parts: [{ text: 'Invoice INV-2026-351' }, { data: pdf, name: 'INV-2026-351.pdf', mime: 'application/pdf', doc: true, caption: 'PDF' }], title: 'Инвойс' }, 'iPhone');
      assert.equal(first.state, 'queued');
      assert.equal(t.box.put({ key: 'boss:invoice:INV1', chat: '971500000001@c.us', parts: [{ text: 'again' }] }).state, 'queued');
      await t.box.tick();
      assert.deepEqual(
        t.said.map((x) => x.p),
        ['/send', '/file'],
      );
      assert.deepEqual([t.said[1].name, t.said[1].doc, t.said[1].mime], ['INV-2026-351.pdf', true, 'application/pdf']);
      assert.equal(t.box.put({ key: 'boss:invoice:INV1', chat: '971500000001@c.us', parts: [{ text: 'again' }] }).state, 'sent');
      assert.equal(t.box.list(['boss:invoice:INV1'])[0].state, 'sent');
      assert.equal(t.told.at(-1).item.state, 'sent');
      assert.deepEqual(t.box.counts(), { queued: 0, failed: 0, sent: 1 });
      const again = createOutbox({ dir: t.dir, store: null, bridge: {}, ready: () => true, pace: fast });
      assert.equal(again.put({ key: 'boss:invoice:INV1', chat: '971500000001@c.us', parts: [{ text: 'x' }] }).state, 'sent');
    } finally {
      t.done();
    }
  });

  it("a number is found its chat first; one not on WhatsApp is said so and not tried again; retried and dropped by hand", async () => {
    const t = setup();
    try {
      t.box.put({ key: 'ask:job1:sup1:1', phone: '971507776655', parts: [{ text: '1. BRAKE PADS' }], gap: 0 });
      t.box.put({ key: 'ask:job1:sup2:1', phone: '971500009999', parts: [{ text: '1. BRAKE PADS' }] });
      await t.box.tick();
      await t.box.tick();
      assert.equal(t.said.find((x) => x.p === '/send').body.chat, '55512345678901@lid');
      const [a, b] = t.box.list(['ask:job1:sup1:1', 'ask:job1:sup2:1']);
      assert.equal(a.state, 'sent');
      assert.deepEqual([b.state, b.error], ['failed', 'the number is not on WhatsApp']);
      assert.equal(t.box.retry('ask:job1:sup2:1').state, 'queued');
      assert.equal(t.box.drop('ask:job1:sup2:1').state, 'dropped');
      assert.equal(t.box.list(['ask:job1:sup2:1'])[0].state, 'none');
    } finally {
      t.done();
    }
  });

  it('WhatsApp not answering: it waits and it is not a try; the item refused: failed', async () => {
    const t = setup();
    try {
      t.setUp(false);
      t.box.put({ key: 'wash:job1', chat: '120363000000000001@g.us', parts: [{ text: 'CAR WASH' }] });
      await t.box.tick();
      assert.equal(t.said.length, 0);
      t.setUp(true);
      t.failWith(503);
      await t.box.tick();
      let it = t.box.list(['wash:job1'])[0];
      assert.deepEqual([it.state, it.tries], ['queued', 0]);
      t.failWith(400);
      t.due();
      await new Promise((r) => setTimeout(r, 5));
      await t.box.tick();
      it = t.box.list(['wash:job1'])[0];
      assert.equal(it.state, 'failed');
      assert.deepEqual(t.box.counts(), { queued: 0, failed: 1, sent: 0 });
    } finally {
      t.done();
    }
  });

  it('a photo the server keeps goes as a picture; one still on the phone is waited for, then its words go', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-outbox-media-'));
    const jpg = path.join(dir, 'car.jpg');
    fs.writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    // (the wait for a photo is long enough here for the first picture to be read and sent on a slow disk)
    const t = setup({ media: { 'car1:card': jpg }, waitMedia: 1500 });
    try {
      t.box.put({ key: 'work:checkin:job1', chat: '120363000000000002@g.us', parts: [{ media: 'car1', caption: 'Toyota Camry · DXB A 12345' }] });
      t.box.put({ key: 'work:checkin:job2', chat: '120363000000000002@g.us', parts: [{ media: 'notHere', caption: 'Nissan Patrol', fallback: 'Nissan Patrol (no photo)' }] });
      await t.box.tick();
      assert.deepEqual([t.said[0].p, t.said[0].caption, t.said[0].size], ['/file', 'Toyota Camry · DXB A 12345', 7]);
      await t.box.tick();
      assert.equal(t.box.list(['work:checkin:job2'])[0].error, 'waiting for the photo');
      await new Promise((r) => setTimeout(r, 1600));
      t.due();
      await t.box.tick();
      assert.equal(t.said.at(-1).body.text, 'Nissan Patrol (no photo)');
      assert.equal(t.box.list(['work:checkin:job2'])[0].state, 'sent');
    } finally {
      t.done();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an item left half-sent by a stopped server goes on from the part it reached', async () => {
    const t = setup();
    try {
      t.box.put({ key: 'client:job1', chat: '120363000000000003@g.us', parts: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] });
      const f = fs.readdirSync(t.dir).find((x) => x.endsWith('.json') && x !== 'sent.json');
      const it = JSON.parse(fs.readFileSync(path.join(t.dir, f), 'utf8'));
      fs.writeFileSync(path.join(t.dir, f), JSON.stringify({ ...it, state: 'sending', done: 2 }));
      const box = createOutbox({ dir: t.dir, store: null, bridge: { json: async (p, init) => (t.said.push({ p, body: init?.body }), { ok: true }) }, ready: () => true, pace: fast });
      await box.tick();
      assert.deepEqual(
        t.said.map((x) => x.body?.text),
        ['three'],
      );
    } finally {
      t.done();
    }
  });
});
