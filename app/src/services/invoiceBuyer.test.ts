import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { invoiceBuyer } from '../domain/invoice';
import { createCustomer, updateCustomer } from './customers';
import { invoicePdf } from './documents';
import { addItem } from './estimate';
import { quickInvoice } from './money';
import { checkIn, loadOrderBundle, setJobCustomer } from './orders';
import { ensureSeed } from './seed';

// In the app the fonts are bundled files (Vite "?url"); here they are read from disk.
const fontDir = decodeURIComponent(new URL('../pdf/fonts/', import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
vi.mock('../pdf/fonts/Tinos-Regular.ttf?url', () => ({ default: fontDir + 'Tinos-Regular.ttf' }));
vi.mock('../pdf/fonts/Tinos-Bold.ttf?url', () => ({ default: fontDir + 'Tinos-Bold.ttf' }));
vi.mock('../pdf/fonts/MarkaziText-Regular.ttf?url', () => ({ default: fontDir + 'MarkaziText-Regular.ttf' }));
vi.mock('../pdf/fonts/MarkaziText-Bold.ttf?url', () => ({ default: fontDir + 'MarkaziText-Bold.ttf' }));

/** The text of a PDF, as one string (pdf.js, its Node build). */
async function pdfText(blob: Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const doc = await task.promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) for (const it of (await (await doc.getPage(p)).getTextContent()).items) if ('str' in it) parts.push(it.str);
  await task.destroy();
  return parts.join(' ');
}

/** A car taken in with no name and no phone, one line, the invoice out. */
async function invoicedWithNoName() {
  const o = await checkIn({ plate: { emirate: 'DXB', code: 'K', number: String(10000 + Math.floor(Math.random() * 89999)) }, make: 'Nissan', model: 'Patrol', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
  await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'OIL CHANGE', qty: 1, unitPriceFils: 10000 });
  return { order: o, invoice: await quickInvoice(o.id) };
}

beforeEach(async () => {
  db.close();
  setDb(new GarageDB('test-' + uid()));
  await ensureSeed();
});

describe('a customer added on the job after the invoice', () => {
  it('is on the invoice and its PDF; the invoice itself does not change', async () => {
    const { order, invoice } = await invoicedWithNoName();
    // The PDF given out then (kept): no name on it.
    const before = await pdfText((await invoicePdf(invoice.id)).blob);
    expect(before).not.toMatch(/SERGEY IVANOV/);
    // The name and the phone typed on the job (the empty customer made at check-in gets them).
    const b = (await loadOrderBundle(order.id))!;
    await updateCustomer(b.customer.id, { name: 'SERGEY IVANOV', phone: '050 123 4567' });
    const after = await loadOrderBundle(order.id);
    const inv = after!.invoices.find((i) => i.id === invoice.id)!;
    // Issued invoices never change: the record keeps what it was issued with.
    expect(inv.buyer).toEqual(invoice.buyer);
    expect(inv.buyer.name).toBe('');
    // Shown and printed — the customer now.
    expect(invoiceBuyer(inv.buyer, after!.customer)).toMatchObject({ name: 'SERGEY IVANOV', phone: '+971501234567' });
    const text = await pdfText((await invoicePdf(invoice.id)).blob);
    expect(text).toMatch(/SERGEY IVANOV/);
    expect(text).toMatch(/\+971 50 123 4567/);
    // The PDF kept before stays as it was (locked); a name typed better later is printed as it is then.
    await updateCustomer(b.customer.id, { name: 'SERGEY IVANOV JR' });
    expect(await pdfText((await invoicePdf(invoice.id)).blob)).toMatch(/SERGEY IVANOV JR/);
    expect(await db.media.filter((m) => m.ownerId === invoice.id && m.slot === 'document_pdf').count()).toBe(1);
  }, 60_000);

  it('picked from the base: the invoice prints them; an invoice with a buyer keeps it', async () => {
    const { order, invoice } = await invoicedWithNoName();
    const known = await createCustomer({ name: 'RASHID AL MANSOORI', phone: '+971555550101', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
    await setJobCustomer(order.id, known.id);
    expect((await db.invoices.get(invoice.id))!.buyer.name).toBe('');
    expect(await pdfText((await invoicePdf(invoice.id)).blob)).toMatch(/RASHID AL MANSOORI/);
    // The job given to someone else after an invoice to a named buyer: the invoice still bills that buyer,
    // and its PDF is the one kept.
    const named = await checkIn({ plate: { emirate: 'DXB', code: 'Q', number: '24680' }, make: 'Toyota', model: 'Camry', name: 'MUSA KHAN', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    await addItem(named.id, { kind: 'labor', block: 'A', titleEn: 'WASH', qty: 1, unitPriceFils: 5000 });
    const musa = await quickInvoice(named.id);
    const first = await invoicePdf(musa.id);
    await setJobCustomer(named.id, known.id);
    const again = await invoicePdf(musa.id);
    expect(await again.blob.text()).toBe(await first.blob.text());
    const text = await pdfText(again.blob);
    expect(text).toMatch(/MUSA KHAN/);
    expect(text).not.toMatch(/RASHID/);
  }, 60_000);
});
