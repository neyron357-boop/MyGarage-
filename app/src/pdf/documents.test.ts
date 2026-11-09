import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { formatDocDate } from '../domain/dates';
import { DEFAULT_SETTINGS, GARAGE_IDENTITY, withGarageIdentity } from '../services/settings';
import { barRuns, code128, qrModules } from './codes';

// In the app the fonts are bundled files (Vite "?url"); here they are read from disk.
const fontDir = decodeURIComponent(new URL('./fonts/', import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
vi.mock('./fonts/Tinos-Regular.ttf?url', () => ({ default: fontDir + 'Tinos-Regular.ttf' }));
vi.mock('./fonts/Tinos-Bold.ttf?url', () => ({ default: fontDir + 'Tinos-Bold.ttf' }));
vi.mock('./fonts/MarkaziText-Regular.ttf?url', () => ({ default: fontDir + 'MarkaziText-Regular.ttf' }));
vi.mock('./fonts/MarkaziText-Bold.ttf?url', () => ({ default: fontDir + 'MarkaziText-Bold.ttf' }));

describe('document helpers', () => {
  it('writes dates as on the garage documents (Dubai time, GST)', () => {
    expect(formatDocDate('2026-11-08T05:30:00.000Z')).toBe('8 Nov 2026, 9:30:00 AM · GST');
    expect(formatDocDate('2026-11-08T11:25:00.000Z')).toBe('8 Nov 2026, 3:25:00 PM · GST');
  });

  it('encodes Code 128 and QR', () => {
    const bits = code128('257');
    // start + 3 characters + check + stop = 6 × 11 modules + 2 for the stop bar
    expect(bits).toHaveLength(68);
    expect(bits.startsWith('11010010000')).toBe(true); // start code B
    expect(bits.endsWith('1100011101011')).toBe(true); // stop
    expect(barRuns('0110111').map((r) => [r.x, r.w])).toEqual([[1, 2], [4, 3]]);
    const q = qrModules('RUKN ZAMZAM GARAGE LLC\nTRN 104547914200003');
    expect(q.size).toBeGreaterThanOrEqual(21);
    expect(q.dark).toHaveLength(q.size * q.size);
  });

  it("fills the garage's details into settings that still have the placeholder", () => {
    const old = { ...DEFAULT_SETTINGS, name: 'MyGarage', trn: '', nameAr: undefined, addressAr: undefined, docFooterAr: undefined, logoDataUrl: undefined, address: '', phone: '', email: '', docFooter: { ru: 'x', en: 'Thank you for choosing us!' } };
    const patch = withGarageIdentity(old)!;
    expect(patch).toMatchObject({ name: GARAGE_IDENTITY.name, trn: '104547914200003', nameAr: GARAGE_IDENTITY.nameAr, addressAr: GARAGE_IDENTITY.addressAr, phone: '+971547888330' });
    expect(patch.logoDataUrl?.startsWith('data:image/png;base64,')).toBe(true);
    expect(patch.docFooter?.en).toBe('Thank you for your business. Standard terms apply.');
    // A garage that typed its own details keeps them.
    const own = { ...DEFAULT_SETTINGS, name: 'Other Garage', trn: '100000000000003', nameAr: undefined, addressAr: undefined };
    expect(withGarageIdentity(own)?.name).toBeUndefined();
    expect(withGarageIdentity({ ...DEFAULT_SETTINGS })).toBeNull();
  });
});

describe('documents', () => {
  it('render the tax invoice, quotation, receipt and check-in report', async () => {
    const dbm = await import('../db/db');
    const { ensureSeed } = await import('../services/seed');
    const { createCustomer, createVehicle } = await import('../services/customers');
    const { createOrder } = await import('../services/orders');
    const { addItem } = await import('../services/estimate');
    const { quickInvoice, addPayment, discountIssuedInvoice } = await import('../services/money');
    const { setDiscount } = await import('../services/discount');
    const { getOrCreateInspection } = await import('../services/inspections');
    const docs = await import('./documents');
    dbm.db.close();
    dbm.setDb(new dbm.GarageDB(`pdf-${dbm.uid()}`));
    await ensureSeed();
    const c = await createCustomer({ name: 'MUSA KHAN', phone: '', email: 'musa@example.com', preferredChannel: 'whatsapp', docLanguage: 'en', type: 'individual' });
    const v = await createVehicle(c.id, { plate: { emirate: 'AUH', code: '5', number: '87920' }, make: 'Toyota', model: 'Corolla', vin: 'JTDBR42E39J016456' });
    const o = await createOrder({ customerId: c.id, vehicleId: v.id, complaint: '', arrivedNow: true });
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'LABOR CHARGE', qty: 1, unitPriceFils: 57143 });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'ALTERNATOR USED', qty: 2, unitPriceFils: 33000 });
    const pdfOk = async (b: Blob) => {
      expect(b.size).toBeGreaterThan(20_000);
      expect(new TextDecoder().decode((await b.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
    };
    // Lines with a discount (a minus line) on the quotation, the invoice and its credit note.
    await setDiscount(o.id, { pctBp: 1000 });
    await pdfOk(await docs.renderQuotation(o.id));
    const first = await quickInvoice(o.id);
    const { credit, invoice: inv } = await discountIssuedInvoice(o.id, { grossFils: 10000 });
    // 600.00 + 2 × 346.50 = 1 293.00 AED: −10 % → 1 163.70, then 100 AED off instead → 1 193.00.
    expect(first.totalFils).toBe(116370);
    expect(inv.totalFils).toBe(119300);
    await pdfOk(await docs.renderInvoice(credit.id));
    await addPayment(o.id, { kind: 'payment', method: 'cash', amountFils: inv.totalFils, reference: '' });
    await pdfOk(await docs.renderInvoice(inv.id));
    await pdfOk(await docs.renderReceipt((await dbm.db.payments.toArray())[0].id));
    await pdfOk(await docs.renderInspection((await getOrCreateInspection(o.id, 'intake')).id));
  }, 60_000);
});
