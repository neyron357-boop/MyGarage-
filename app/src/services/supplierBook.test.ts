import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { readSupplierBook, supplierChatLink } from '../domain/supplierBook';
import { unzip } from '../domain/zip';
import { importSuppliers, saveSupplier } from './parts';
import { ensureSeed } from './seed';
import { exportSupplierBook, importSupplierBook } from './supplierBook';

// The garage's own supplier base (in the repository, data/UAE_Contacts.xlsx).
const original = () => new Uint8Array(readFileSync(fileURLToPath(new URL('../../../data/UAE_Contacts.xlsx', import.meta.url))));
const bytesOf = async (f: File) => new Uint8Array(await f.arrayBuffer());
const dec = new TextDecoder();

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
  await ensureSeed();
});

describe('the supplier base workbook (UAE_Contacts.xlsx)', () => {
  it('reads every supplier with its row on each sheet', async () => {
    const rows = (await readSupplierBook(original()))!;
    expect(rows).toHaveLength(270);
    const maroof = rows.find((r) => r.book.id === 'CT-0067')!;
    expect(maroof.name).toBe('Al Maroof Auto Spare Parts Trading LLC');
    expect(maroof.phone).toBe('+971552212546');
    expect(maroof.makes).toEqual(expect.arrayContaining(['Mazda', 'Nissan', 'Toyota']));
    expect(maroof.locationUrl).toMatch(/^https:\/\/www\.google\.com\/maps/);
    expect(maroof.book.contact?.['Email']?.v).toBe('almaroofautospareparts@gmail.com');
    expect(maroof.service).toBeUndefined();
    // A workshop is a contractor; the contractors' sheet and the nearby sheet come along with their rows.
    expect(rows.find((r) => r.book.id === 'CT-0029')!.service).toBe(true);
    expect(rows.filter((r) => r.book.service)).toHaveLength(44);
    expect(rows.filter((r) => r.book.nearby)).toHaveLength(136);
    // A WhatsApp number of its own (not the main phone) is the one a chat opens.
    const own = rows.find((r) => r.book.service && r.book.id === 'CT-0242')!;
    expect(own.phone).toBe('+97165612799');
    expect(supplierChatLink(own)).toBe('https://wa.me/971542576771');
  });

  it('brings the base in once and gives it back as it was', async () => {
    const first = await importSuppliers(new File([original()], 'UAE_Contacts.xlsx'));
    expect(first).toEqual({ added: 270, updated: 0, skipped: 0 });
    // Brought in again: nothing new, nothing changed.
    expect(await importSupplierBook(original())).toEqual({ added: 0, updated: 0, same: 270 });
    expect(await db.suppliers.count()).toBe(270);

    const out = await bytesOf(await exportSupplierBook());
    const back = (await readSupplierBook(out))!;
    const was = (await readSupplierBook(original()))!;
    expect(back.map((r) => r.book.id)).toEqual(was.map((r) => r.book.id));
    // Every column of every row, as it came (a phone the app writes as E.164 aside).
    const norm = (c?: { v: string; link?: string }) => `${(c?.v ?? '').trim()}|${c?.link ?? ''}`;
    const diffs: string[] = [];
    was.forEach((w, i) => {
      for (const [k, c] of Object.entries(w.book.contact ?? {})) {
        if (k === 'Основной телефон') continue;
        if (norm(c) !== norm(back[i].book.contact?.[k])) diffs.push(`${w.book.id} ${k}: ${norm(c)} → ${norm(back[i].book.contact?.[k])}`);
      }
      for (const sheet of ['service', 'nearby'] as const)
        for (const [k, c] of Object.entries(w.book[sheet] ?? {})) if (k !== 'Телефон' && norm(c) !== norm(back[i].book[sheet]?.[k])) diffs.push(`${w.book.id} ${sheet}.${k}: ${norm(c)} → ${norm(back[i].book[sheet]?.[k])}`);
      expect(back[i].phone?.replace(/\D/g, '').slice(-9)).toBe(w.phone?.replace(/\D/g, '').slice(-9));
    });
    expect(diffs).toEqual([]);

    // The sheets the app does not hold — the photo log, the questions — go back out as they were; the guide counts anew.
    const a = await unzip(original());
    const b = await unzip(out);
    for (const part of ['xl/worksheets/sheet4.xml', 'xl/worksheets/sheet5.xml', 'xl/styles.xml', 'xl/tables/table3.xml'])
      expect(dec.decode(b.get(part)), part).toBe(dec.decode(a.get(part)));
    expect(dec.decode(b.get('xl/tables/table1.xml'))).toContain('ref="A1:T271"');
    expect(dec.decode(b.get('xl/worksheets/sheet1.xml'))).toMatch(/<c r="A5"[^>]*><v>270<\/v><\/c>/);
    // The index of makes, one row per make and supplier, as many as before.
    const makes = dec.decode(b.get('xl/worksheets/sheet3.xml'));
    expect((makes.match(/<row /g) ?? []).length).toBe((dec.decode(a.get('xl/worksheets/sheet3.xml')).match(/<row /g) ?? []).length);
  });

  it('takes what the app changed and what it added out with the base, and back in to the same suppliers', async () => {
    await importSupplierBook(original());
    const maroof = (await db.suppliers.toArray()).find((s) => s.book?.id === 'CT-0067')!;
    await saveSupplier({ ...maroof, phone: '+971500000001', notes: 'Ask for Imran' });
    await saveSupplier({ name: 'New Parts Trading', phone: '+971501112233', makes: ['Toyota', 'Hyundai'] });
    await saveSupplier({ name: 'Al Noor Paint', phone: '+97165550000', service: true, parts: 'Paint' });

    const out = await bytesOf(await exportSupplierBook());
    const back = (await readSupplierBook(out))!;
    const m = back.find((r) => r.book.id === 'CT-0067')!;
    expect([m.phone, m.notes, m.book.contact?.['Email']?.v]).toEqual(['+971500000001', 'Ask for Imran', 'almaroofautospareparts@gmail.com']);
    // The chat follows the phone it was the chat of.
    expect(m.book.contact?.['WhatsApp']?.link).toBe('https://wa.me/971500000001');
    const ids = back.map((r) => +r.book.id.slice(3));
    const added = back.find((r) => r.name === 'New Parts Trading')!;
    expect(+added.book.id.slice(3)).toBe(Math.max(...ids.filter((n) => n !== +added.book.id.slice(3) && n !== +back.find((r) => r.name === 'Al Noor Paint')!.book.id.slice(3))) + 1);
    expect(added.book.contact?.['Группа марок']?.v).toBe('Японские · Корейские');
    expect(added.book.contact?.['WhatsApp']?.link).toBe('https://wa.me/971501112233');
    const paint = back.find((r) => r.name === 'Al Noor Paint')!;
    expect(paint.book.contact?.['WhatsApp']?.link).toBeUndefined(); // a landline: no chat
    expect(paint.book.service?.['Мастерская / служба']?.v).toBe('Al Noor Paint');

    // Back in: the same suppliers (the new ones found by phone), nothing doubled.
    const before = await db.suppliers.count();
    const again = await importSupplierBook(out);
    expect(again!.added).toBe(0);
    expect(await db.suppliers.count()).toBe(before);
    expect((await db.suppliers.toArray()).find((s) => s.name === 'New Parts Trading')!.book?.id).toBe(added.book.id);
  });

  it('builds the workbook from the garage’s look when none was brought in', async () => {
    await saveSupplier({ name: 'Gulf Spares', phone: '+971551234567', makes: ['Nissan'], condition: 'used', parts: 'Engines' });
    await saveSupplier({ name: 'Quick Tow', phone: '+971509998877', service: true });
    const out = await bytesOf(await exportSupplierBook());
    const files = await unzip(out);
    const wb = dec.decode(files.get('xl/workbook.xml'));
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(['Как пользоваться', 'Контакты', 'Индекс марок', 'Услуги для гаража']);
    const back = (await readSupplierBook(out))!;
    expect(back.map((r) => [r.book.id, r.name, r.phone, r.makes, r.condition, r.parts, r.service ?? false])).toEqual([
      ['CT-0001', 'Gulf Spares', '+971551234567', ['Nissan'], 'used', 'Engines', false],
      ['CT-0002', 'Quick Tow', '+971509998877', undefined, undefined, undefined, true],
    ]);
    expect(dec.decode(files.get('xl/worksheets/sheet1.xml'))).toContain('Поставщики автозапчастей и услуг');
  });
});
