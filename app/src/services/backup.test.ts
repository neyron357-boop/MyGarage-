import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { createCustomer, createVehicle } from './customers';
import { AppError } from './errors';
import { exportBackup, importBackup } from './backup';
import { addMedia } from './media';
import { createOrder } from './orders';
import { ensureSeed } from './seed';

const blobToDataUrlNode = async (b: Blob) => `data:${b.type};base64,${Buffer.from(await b.arrayBuffer()).toString('base64')}`;

const bytes = (n: number, seed: number) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * seed + 11) & 0xff;
  return b;
};

async function sampleData() {
  const c = await createCustomer({ name: 'Иван Петров', phone: '055 987 6543', preferredChannel: 'telegram', docLanguage: 'ru', type: 'individual' });
  const v = await createVehicle(c.id, { plate: { emirate: 'SHJ', code: '3', number: '45678' }, make: 'Nissan', model: 'Patrol' });
  const o = await createOrder({ customerId: c.id, vehicleId: v.id, complaint: 'ТО 60 000 км', arrivedNow: true });
  const photo = await addMedia({ ownerType: 'order', ownerId: o.id, slot: 'problem', file: new Blob([bytes(70_000, 7)], { type: 'image/jpeg' }), compress: false });
  const pdf = await addMedia({ ownerType: 'order', ownerId: o.id, slot: 'document_pdf', kind: 'pdf', file: new Blob([bytes(5_000, 3)], { type: 'application/pdf' }), compress: false });
  return { c, o, photo, pdf };
}

async function reopen() {
  const name = db.name;
  setDb(new GarageDB(name));
  await db.open();
}

beforeEach(async () => {
  db.close();
  setDb(new GarageDB(`backup-${uid()}`));
  await ensureSeed();
});

describe('backup', () => {
  it('v2: restores every table and file byte for byte', async () => {
    const { c, o, photo, pdf } = await sampleData();
    const file = await exportBackup();
    expect(await file.slice(0, 6).text()).toBe('MGBK2\n');

    // Change the data, then restore: everything must be as it was at export time.
    await db.customers.update(c.id, { name: 'Changed' });
    await importBackup(file);
    await reopen();

    expect((await db.customers.get(c.id))?.name).toBe('Иван Петров');
    expect((await db.orders.get(o.id))?.complaint).toBe('ТО 60 000 км');
    expect(await db.jobTemplates.count()).toBeGreaterThan(5);
    for (const [m, n, seed] of [[photo, 70_000, 7], [pdf, 5_000, 3]] as const) {
      const row = await db.mediaBlobs.get(m.id);
      expect(row?.blob.size).toBe(n);
      expect(new Uint8Array(await row!.blob.arrayBuffer())).toEqual(bytes(n, seed));
      expect((await db.media.get(m.id))?.sha256).toBe(m.sha256);
    }
  });

  it('still restores old v1 JSON backups', async () => {
    const { c, photo } = await sampleData();
    const tables: Record<string, unknown[]> = {};
    for (const t of db.tables) if (t.name !== 'mediaBlobs') tables[t.name] = await t.toArray();
    const blobs = [];
    for (const b of await db.mediaBlobs.toArray()) blobs.push({ id: b.id, blob: await blobToDataUrlNode(b.blob) });
    const v1 = new Blob([JSON.stringify({ format: 'mygarage-backup', version: 1, exportedAt: new Date().toISOString(), tables, blobs })], { type: 'application/json' });

    await db.customers.clear();
    await importBackup(v1);
    await reopen();
    expect((await db.customers.get(c.id))?.phone).toBe('+971559876543');
    expect((await db.mediaBlobs.get(photo.id))?.blob.size).toBe(70_000);
  });

  it('rejects other files without touching the data', async () => {
    const { c } = await sampleData();
    await expect(importBackup(new Blob(['hello'], { type: 'text/plain' }))).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === 'err.notBackup');
    const broken = await exportBackup();
    await expect(importBackup(broken.slice(0, broken.size - 100))).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === 'err.backupDamaged');
    expect((await db.customers.get(c.id))?.name).toBe('Иван Петров');
  });
});
