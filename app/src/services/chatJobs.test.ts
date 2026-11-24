import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { jobDocs } from '../features/job/jobDocs';
import { chatJobs, customerOfGroup, findJobs } from './chatJobs';
import { forwardNote } from '../features/whatsapp/forwardNote';
import { saveWaAuto } from './waAuto';
import { createCustomer } from './customers';
import { addItem, sendVersion } from './estimate';
import { approveAll } from './flow';
import { quickInvoice } from './money';
import { checkIn, loadOrderBundle } from './orders';
import { ensureSeed } from './seed';
import { setCustomerGroup } from './waAuto';

/*
 * A chat's «＋» for its customer (v0.80): which of their jobs a document can go from, and what each sends — the same
 * messages as the job's own buttons.
 */

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

const customer = () => createCustomer({ name: 'Ahmed', phone: '050 123 4567', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
const job = (customerId: string, number: string) =>
  checkIn({ customerId, plate: { emirate: 'DXB', code: 'K', number }, make: 'Toyota', model: 'Camry', name: 'Ahmed', phone: '050 123 4567', docLanguage: 'en', complaint: '', arrivedNow: true });
const priced = (orderId: string) => addItem(orderId, { kind: 'labor', block: 'A', titleEn: 'Brake pads front', unitPriceFils: 45_000, vatRateBp: 500 });

describe('chatJobs (v0.80)', () => {
  it('the open jobs, the newest first; a job closed with nothing owed is not offered', async () => {
    const c = await customer();
    const a = await job(c.id, '11111');
    await priced(a.id);
    await new Promise((r) => setTimeout(r, 5));
    const b = await job(c.id, '22222');
    await priced(b.id);
    const done = await job(c.id, '33333');
    // Closed, nothing owed (how it closed is not what is tested here).
    await db.orders.update(done.id, { stage: 'closed' });
    const r = await chatJobs(c.id);
    expect(r.customer?.id).toBe(c.id);
    expect(r.jobs.map((x) => x.order.id)).toEqual([b.id, a.id]);
    expect(r.owesFils).toBe(0);
  });

  it('the job the chat is on comes first, whatever its age; no customer — no jobs', async () => {
    const c = await customer();
    const a = await job(c.id, '11111');
    await new Promise((r) => setTimeout(r, 5));
    const b = await job(c.id, '22222');
    expect((await chatJobs(c.id, a.id)).jobs.map((x) => x.order.id)).toEqual([a.id, b.id]);
    expect((await chatJobs(undefined, b.id)).jobs[0].order.id).toBe(b.id);
    expect((await chatJobs(undefined)).jobs).toEqual([]);
  });

  it('a company’s own group is found by its chat', async () => {
    const c = await customer();
    await setCustomerGroup(c.id, { chat: '120363000000000003@g.us', name: 'ABC — cars' });
    expect((await customerOfGroup('120363000000000003@g.us'))?.id).toBe(c.id);
    expect(await customerOfGroup('120363000000000009@g.us')).toBeUndefined();
  });
});

describe('findJobs — any job’s documents for a chat that is not its customer’s (v0.80.3)', () => {
  it('by the job’s number, by a plate or a name; nothing typed — the jobs on the board', async () => {
    const c = await customer();
    const a = await job(c.id, '11111');
    const b = await job(c.id, '22222');
    await db.orders.update(b.id, { stage: 'closed' });
    expect((await findJobs(String(a.number))).map((x) => x.order.id)).toEqual([a.id]);
    expect((await findJobs(`№${b.number}`)).map((x) => x.order.id)).toEqual([b.id]);
    expect((await findJobs('22222')).map((x) => x.order.id)).toEqual([b.id]);
    expect((await findJobs('ahmed')).map((x) => x.order.id).sort()).toEqual([a.id, b.id].sort());
    expect((await findJobs('')).map((x) => x.order.id)).toEqual([a.id]);
    expect(await findJobs('nobody here')).toEqual([]);
  });
});

describe('forwardNote — whose a customer’s message forwarded is (v0.80.3)', () => {
  it('in the language of the garage’s own reports; not a customer — no line', async () => {
    expect(await forwardNote({ name: 'Jun', phone: '971544441554' })).toBe('From customer Jun (+971 54 444 1554):');
    expect(await forwardNote({ name: 'Jun' })).toBe('From customer Jun:');
    await saveWaAuto('boss', { lang: 'ru' });
    expect(await forwardNote({ name: 'Jun', phone: '+971544441554' })).toBe('От клиента Jun (+971 54 444 1554):');
    expect(await forwardNote(undefined)).toBeUndefined();
  });
});

describe('jobDocs (v0.80)', () => {
  it('priced drafts: a new estimate, frozen only once it goes; no invoice yet', async () => {
    const c = await customer();
    const o = await job(c.id, '11111');
    await priced(o.id);
    const d = jobDocs((await loadOrderBundle(o.id))!);
    expect(d.estimate?.fresh).toBe(true);
    expect(d.invoice).toBeUndefined();
    expect(d.qtyAsk).toBe(false);
    const req = await d.estimate!.make();
    expect(req.text).toMatch(/BRAKE PADS FRONT/i);
    expect(await db.versions.where('orderId').equals(o.id).count()).toBe(0);
    await req.onConfirm!();
    expect(await db.versions.where('orderId').equals(o.id).count()).toBe(1);
  });

  it('a line short of its name is asked about before a new estimate goes', async () => {
    const c = await customer();
    const o = await job(c.id, '11111');
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front brake discs left and right', unitPriceFils: 30_000, vatRateBp: 500 });
    expect(jobDocs((await loadOrderBundle(o.id))!).qtyAsk).toBe(true);
  });

  it('the estimate waiting for the answer goes again as it was; the invoice once it is out', async () => {
    const c = await customer();
    const o = await job(c.id, '11111');
    await priced(o.id);
    const v = await sendVersion(o.id, { via: 'whatsapp' });
    const waiting = jobDocs((await loadOrderBundle(o.id))!);
    expect(waiting.estimate?.fresh).toBe(false);
    expect((await waiting.estimate!.make()).text).toMatch(/BRAKE PADS FRONT/i);
    expect(waiting.invoice).toBeUndefined();
    await approveAll(o.id);
    await quickInvoice(o.id);
    const out = jobDocs((await loadOrderBundle(o.id))!);
    const inv = out.invoice!();
    expect(inv.template).toBe('carReady');
    expect(inv.text).toMatch(/472[.,]50/);
    expect(out.estimate?.fresh).toBe(false);
    expect(v.number).toBe(1);
  });
});
