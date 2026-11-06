import { db, GarageDB } from '../db/db';
import { nowIso } from '../domain/dates';
import { AppError } from './errors';
import { dataUrlToBlob } from './media';

const FORMAT = 'mygarage-backup';
/** First bytes of a v2 backup file. */
const MAGIC = 'MGBK2\n';
const LEN_DIGITS = 16;

interface BlobRef {
  offset: number;
  size: number;
  type: string;
}
interface Manifest {
  format: typeof FORMAT;
  version: 2;
  exportedAt: string;
  tables: Record<string, unknown[]>;
  blobs: { id: string; blob: BlobRef; thumb?: BlobRef }[];
}

/**
 * Full export: every table plus all photos and PDFs.
 *
 * Format v2: `MGBK2\n` + manifest length (16 hex digits) + `\n` + manifest JSON + the raw files one
 * after another. The file is assembled from the stored blobs without copying them into one huge
 * string, so a backup with thousands of photos does not run the phone out of memory.
 */
export async function exportBackup(): Promise<Blob> {
  const tables: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    if (table.name === 'mediaBlobs') continue;
    tables[table.name] = await table.toArray();
  }
  const files: Blob[] = [];
  const blobs: Manifest['blobs'] = [];
  let offset = 0;
  const add = (b: Blob): BlobRef => {
    const ref = { offset, size: b.size, type: b.type };
    files.push(b);
    offset += b.size;
    return ref;
  };
  await db.mediaBlobs.each((row) => {
    blobs.push({ id: row.id, blob: add(row.blob), thumb: row.thumb ? add(row.thumb) : undefined });
  });
  const manifest: Manifest = { format: FORMAT, version: 2, exportedAt: nowIso(), tables, blobs };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const header = `${MAGIC}${json.length.toString(16).padStart(LEN_DIGITS, '0')}\n`;
  return new Blob([header, json, ...files], { type: 'application/octet-stream' });
}

type Restorable = { tables: Record<string, unknown[]>; blobs: { id: string; blob: Blob; thumb?: Blob }[] };

async function readBackup(file: Blob): Promise<Restorable> {
  const head = await file.slice(0, MAGIC.length).text();
  if (head === MAGIC) {
    const lenEnd = MAGIC.length + LEN_DIGITS;
    const len = parseInt(await file.slice(MAGIC.length, lenEnd).text(), 16);
    const start = lenEnd + 1;
    if (!Number.isFinite(len) || len <= 0 || start + len > file.size) throw new AppError('err.notBackup');
    const manifest = JSON.parse(await file.slice(start, start + len).text()) as Manifest;
    if (manifest?.format !== FORMAT || !manifest.tables) throw new AppError('err.notBackup');
    const base = start + len;
    const at = (r: BlobRef) => {
      if (r.offset < 0 || base + r.offset + r.size > file.size) throw new AppError('err.backupDamaged');
      return file.slice(base + r.offset, base + r.offset + r.size, r.type);
    };
    return { tables: manifest.tables, blobs: manifest.blobs.map((b) => ({ id: b.id, blob: at(b.blob), thumb: b.thumb ? at(b.thumb) : undefined })) };
  }
  // v1: one JSON document with files as data URLs.
  let data: { format?: string; tables?: Record<string, unknown[]>; blobs?: { id: string; blob: string; thumb?: string }[] };
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new AppError('err.notBackup');
  }
  if (data?.format !== FORMAT || !data.tables) throw new AppError('err.notBackup');
  return {
    tables: data.tables,
    blobs: (data.blobs ?? []).map((b) => ({ id: b.id, blob: dataUrlToBlob(b.blob), thumb: b.thumb ? dataUrlToBlob(b.thumb) : undefined })),
  };
}

/**
 * Replace all local data with a backup file (v2 or the older v1 JSON). The whole file is checked
 * before anything on the device is deleted. The page reloads afterwards.
 */
export async function importBackup(file: Blob): Promise<void> {
  const data = await readBackup(file);
  const name = db.name;
  db.close();
  await GarageDB.delete(name);
  const fresh = new GarageDB(name);
  await fresh.open();
  try {
    await fresh.transaction('rw', fresh.tables, async () => {
      for (const [tableName, rows] of Object.entries(data.tables)) {
        const table = fresh.tables.find((t) => t.name === tableName);
        if (table && table.name !== 'mediaBlobs' && rows.length) await table.bulkAdd(rows);
      }
    });
    // Files go in small batches: each batch is read from the backup file straight into the database.
    for (let i = 0; i < data.blobs.length; i += 40) {
      await fresh.mediaBlobs.bulkAdd(data.blobs.slice(i, i + 40));
    }
  } finally {
    fresh.close();
  }
}

export async function wipeAll(): Promise<void> {
  const name = db.name;
  db.close();
  await GarageDB.delete(name);
  forgetBackup();
}

/* ---------------- Backup reminder ---------------- */

const LAST_BACKUP_KEY = 'mygarage.lastBackupAt';
/** Remind to make a backup after this many days. */
export const BACKUP_EVERY_DAYS = 7;

export function lastBackupAt(): string | undefined {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function markBackupDone(at = nowIso()) {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, at);
    window.dispatchEvent(new Event('mygarage:backup'));
  } catch {
    // storage unavailable
  }
}

function forgetBackup() {
  try {
    localStorage.removeItem(LAST_BACKUP_KEY);
  } catch {
    // ignore
  }
}

/** Download a full backup and remember when it was made. */
export async function saveBackupFile(filename: string): Promise<void> {
  await downloadBlob(await exportBackup(), filename);
  markBackupDone();
}

/* ---------------- Files ---------------- */

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
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** CSV with BOM so Excel opens UTF-8 (Cyrillic) correctly. */
export function toCsv(rows: (string | number | undefined)[][]): Blob {
  const esc = (v: string | number | undefined) => {
    const s = v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
}
