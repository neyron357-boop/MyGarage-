import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { addItem } from './estimate';
import { approveAll } from './flow';
import { issueCreditNote, quickInvoice } from './money';
import { checkIn } from './orders';
import { ensureSeed } from './seed';

/*
 * Job and invoice numbers (v0.42.3, the user: «job номер и инвойс номер одинаковые … формат простой: INV-2026-319 …
 * новые заказы — от 350 и выше»).
 */

const job = () =>
  checkIn({ plate: { emirate: 'DXB', code: 'N', number: String(Math.floor(Math.random() * 90000) + 10000) }, make: 'Nissan', model: 'Sunny', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('numbers', () => {
  it('the garage’s own jobs go from 350 — never below it, one after another', async () => {
    expect((await job()).number).toBe(350);
    expect((await job()).number).toBe(351);
    // A device whose counter was behind (Eaglecart's numbers): still from 350 on.
    await db.counters.put({ name: 'order', value: 312 });
    expect((await job()).number).toBe(350);
    await db.counters.put({ name: 'order', value: 377 });
    expect((await job()).number).toBe(378);
  });

  it('the invoice is numbered as its job; corrected — the new one keeps the number, the cancelled one «-1», a credit note «CN-»', async () => {
    const o = await job();
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Oil change', unitPriceFils: 10000 });
    await approveAll(o.id);
    const year = new Date().getFullYear();
    const first = await quickInvoice(o.id);
    expect(first.number).toBe(`INV-${year}-${o.number}`);
    const cn = await issueCreditNote(first.id, 'name');
    expect(cn.number).toBe(`CN-${year}-${o.number}`);
    const second = await quickInvoice(o.id);
    expect(second.number).toBe(`INV-${year}-${o.number}`);
    expect((await db.invoices.get(first.id))!.number).toBe(`INV-${year}-${o.number}-1`);
    await issueCreditNote(second.id, 'again');
    expect((await db.invoices.get(second.id))!.number).toBe(`INV-${year}-${o.number}-2`);
    expect((await db.invoices.where('orderId').equals(o.id).filter((i) => i.type === 'credit_note').toArray()).map((i) => i.number).sort()).toEqual([`CN-${year}-${o.number}`, `CN-${year}-${o.number}-2`]);
  });
});
