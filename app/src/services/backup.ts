import { db, GarageDB } from '../db/db';
import { nowIso } from '../domain/dates';
import { blobToDataUrl, dataUrlToBlob } from './media';

const FORMAT = 'mygarage-backup';

/** Full export: every table plus all photos/PDFs as data URLs. */
export async function exportBackup(): Promise<Blob> {
  const tables: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    if (table.name === 'mediaBlobs') continue;
    tables[table.name] = await table.toArray();
  }
  const blobs: { id: string; blob: string; thumb?: string }[] = [];
  for (const b of await db.mediaBlobs.toArray()) {
    blobs.push({ id: b.id, blob: await blobToDataUrl(b.blob), thumb: b.thumb ? await blobToDataUrl(b.thumb) : undefined });
  }
  const json = JSON.stringify({ format: FORMAT, version: 1, exportedAt: nowIso(), tables, blobs });
  return new Blob([json], { type: 'application/json' });
}

/** Replace all local data with a backup file. The page reloads afterwards. */
export async function importBackup(file: Blob): Promise<void> {
  const data = JSON.parse(await file.text());
  if (data?.format !== FORMAT) throw new Error('not_a_backup');
  const name = db.name;
  db.close();
  await GarageDB.delete(name);
  const fresh = new GarageDB(name);
  await fresh.open();
  await fresh.transaction('rw', fresh.tables, async () => {
    for (const [tableName, rows] of Object.entries(data.tables as Record<string, unknown[]>)) {
      const table = fresh.tables.find((t) => t.name === tableName);
      if (table && rows.length) await table.bulkAdd(rows);
    }
    const blobs = data.blobs as { id: string; blob: string; thumb?: string }[];
    if (blobs.length) {
      await fresh.mediaBlobs.bulkAdd(blobs.map((b) => ({ id: b.id, blob: dataUrlToBlob(b.blob), thumb: b.thumb ? dataUrlToBlob(b.thumb) : undefined })));
    }
  });
  fresh.close();
}

export async function wipeAll(): Promise<void> {
  const name = db.name;
  db.close();
  await GarageDB.delete(name);
}

type DownloadsApi = { save: (r: { filename: string; data: Blob }) => Promise<unknown> };
type ClaudeHost = { use?: (name: string) => Promise<DownloadsApi | null> };

/**
 * Save a file for the user. Inside the claude.ai preview the page cannot download by itself, so the
 * viewer's "downloads" capability asks the user to confirm; everywhere else a normal download is used.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const host = typeof window !== 'undefined' ? (window as unknown as { claude?: ClaudeHost }).claude : undefined;
  if (host?.use) {
    const downloads = await host.use('downloads').catch(() => null);
    if (downloads) {
      await downloads.save({ filename, data: blob });
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** CSV with BOM so Excel opens UTF-8 (Cyrillic) correctly. */
export function toCsv(rows: (string | number | undefined)[][]): Blob {
  const esc = (v: string | number | undefined) => {
    const s = v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
}
