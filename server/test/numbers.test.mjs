import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { invoiceNumbers, planRenumber } from '../src/numbers.mjs';
import { openStore } from '../src/store.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-numbers-'));
const store = openStore(dir, { keepBackups: 1 });
after(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ec = (id, n) => ({ id, number: n, createdAt: '2026-10-01T08:00:00.000Z', imported: { system: 'eaglecart', jobNo: String(n) } });
const own = (id, n, at) => ({ id, number: n, createdAt: at });
const inv = (id, orderId, number, issuedAt, type = 'tax_invoice') => ({ id, orderId, number, issuedAt, type });

describe('job and invoice numbers (v0.42.3)', () => {
  it('the invoice in force is numbered as its job; those a credit note cancelled «-1», «-2»; credit notes «CN-»; the year each was issued', () => {
    const credited = (x) => ({ ...x, status: 'credited' });
    const want = invoiceNumbers(302, [
      credited(inv('a', 'o', 'INV-2026-00004', '2026-11-12T10:00:00.000Z')),
      inv('c', 'o', 'CN-2026-00001', '2026-11-13T10:00:00.000Z', 'credit_note'),
      credited(inv('b', 'o', 'INV-2026-00013', '2026-11-13T10:01:00.000Z')),
      inv('e', 'o', 'CN-2026-00006', '2026-12-31T20:59:00.000Z', 'credit_note'),
      inv('d', 'o', 'INV-2026-00019', '2026-12-31T21:00:00.000Z'),
    ]);
    assert.deepEqual(Object.fromEntries(want), { a: 'INV-2026-302-1', b: 'INV-2026-302-2', d: 'INV-2027-302', c: 'CN-2026-302', e: 'CN-2027-302-2' });
    // All cancelled (a credit note, no new invoice yet): none has the job's own number until the next one.
    assert.deepEqual(Object.fromEntries(invoiceNumbers(5, [credited(inv('x', 'o', 'n', '2026-11-12T10:00:00.000Z'))])), { x: 'INV-2026-5-1' });
  });

  it('all jobs once more: Eaglecart keeps its numbers, an Eaglecart job made here takes its number, the rest go on from 350 as they were made', () => {
    const orders = [ec('ec-1', 271), ec('ec-2', 274), own('m1', 276, '2026-11-11T10:00:00.000Z'), own('m2', 281, '2026-11-12T10:00:00.000Z'), own('m3', 280, '2026-11-12T09:00:00.000Z'), own('m4', 302, '2026-11-17T10:00:00.000Z')];
    const invoices = [inv('i1', 'm2', 'INV-2026-00004', '2026-11-12T11:00:00.000Z'), inv('i2', 'm4', 'INV-2026-00007', '2026-11-17T11:00:00.000Z'), inv('i3', 'ec-1', 'INV-2026-00001', '2026-11-11T11:00:00.000Z')];
    const plan = planRenumber(orders, invoices, { fixed: { m2: 302 } });
    assert.deepEqual(Object.fromEntries(plan.numbers), { 'ec-1': 271, 'ec-2': 274, m2: 302, m1: 350, m3: 351, m4: 352 });
    assert.deepEqual(plan.orders.map((c) => `${c.from}→${c.to}`), ['276→350', '281→302', '280→351', '302→352']);
    assert.deepEqual(plan.orders.filter((c) => c.eaglecart).map((c) => c.id), ['m2']);
    assert.deepEqual(plan.invoices.map((c) => c.to).sort(), ['INV-2026-271', 'INV-2026-302', 'INV-2026-352']);
    assert.equal(plan.counter, 352);
    assert.throws(() => planRenumber(orders, invoices, { fixed: { m2: 271 } }), /twice/);
  });

  it('on the server: a new job with a number taken, or made here below 350, gets the next one — the device gets it back', () => {
    store.push('pc', [{ t: 'orders', k: 'ec-o-9', d: { id: 'ec-o-9', number: 302, imported: { system: 'eaglecart', jobNo: '302' } } }]);
    store.push('pc', [{ t: 'orders', k: 'a', d: { id: 'a', number: 350, createdAt: '2026-11-18T08:00:00.000Z' } }]);
    assert.equal(store.record('orders', 'a').number, 350);
    // The phone, behind, made one with the same number, and one with an old low number.
    const since = store.lastRev();
    store.push('phone', [
      { t: 'orders', k: 'b', d: { id: 'b', number: 350, createdAt: '2026-11-18T08:01:00.000Z' } },
      { t: 'orders', k: 'c', d: { id: 'c', number: 313, createdAt: '2026-11-18T08:02:00.000Z' } },
      { t: 'invoices', k: 'ib', d: { id: 'ib', orderId: 'b', number: 'INV-2026-350', issuedAt: '2026-11-18T08:05:00.000Z', type: 'tax_invoice' } },
    ]);
    assert.equal(store.record('orders', 'b').number, 351);
    assert.equal(store.record('orders', 'c').number, 352);
    assert.equal(store.record('invoices', 'ib').number, 'INV-2026-351');
    assert.equal(store.record('counters', 'order').value, 352);
    // The phone takes the numbers it did not have.
    const back = store.pull('phone', since).changes.filter((c) => c.d);
    assert.deepEqual(back.filter((c) => c.t === 'orders').map((c) => `${c.k}:${c.d.number}`).sort(), ['b:351', 'c:352']);
    assert.equal(back.find((c) => c.t === 'invoices').d.number, 'INV-2026-351');
    assert.equal(back.find((c) => c.t === 'counters').d.value, 352);
    // A job from Eaglecart keeps its number while it is free.
    store.push('pc', [{ t: 'orders', k: 'ec-o-10', d: { id: 'ec-o-10', number: 305, imported: { system: 'eaglecart', jobNo: '305' } } }]);
    assert.equal(store.record('orders', 'ec-o-10').number, 305);
  });

  it('a device behind cannot bring a job’s old number back; an old invoice number becomes its job’s', () => {
    const since = store.lastRev();
    store.push('old-pc', [
      { t: 'orders', k: 'b', d: { id: 'b', number: 350, stage: 'ready', createdAt: '2026-11-18T08:01:00.000Z' } },
      { t: 'invoices', k: 'ib2', d: { id: 'ib2', orderId: 'b', number: 'INV-2026-00035', issuedAt: '2026-11-18T09:00:00.000Z', type: 'tax_invoice' } },
    ]);
    assert.equal(store.record('orders', 'b').number, 351);
    assert.equal(store.record('orders', 'b').stage, 'ready');
    // Two in force (one would be cancelled by now): the latest has the job's number.
    assert.equal(store.record('invoices', 'ib2').number, 'INV-2026-351');
    assert.equal(store.record('invoices', 'ib').number, 'INV-2026-351-1');
    const back = store.pull('old-pc', since).changes.filter((c) => c.d);
    assert.equal(back.find((c) => c.k === 'b').d.number, 351);
  });

  it('numbers all jobs once more — said first, then done; every device takes it', () => {
    const before = store.lastRev();
    const dry = store.renumber({ fixed: {} });
    assert.equal(store.lastRev(), before);
    assert.ok(dry.orders.length >= 0);
    store.push('phone', [{ t: 'orders', k: 'old', d: { id: 'old', number: 351, createdAt: '2026-11-11T08:00:00.000Z' } }]);
    const r = store.renumber({ apply: true });
    const nums = ['a', 'b', 'c', 'old'].map((id) => store.record('orders', id).number);
    assert.equal(new Set(nums).size, 4);
    assert.ok(nums.every((n) => n >= 350));
    assert.equal(store.record('orders', 'old').number, 350);
    assert.ok(store.pull('phone', r.rev - r.orders.length - r.invoices.length - 1).changes.some((c) => c.k === 'old'));
  });
});
