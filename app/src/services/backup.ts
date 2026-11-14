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

type Restorable = { exportedAt?: string; tables: Record<string, unknown[]>; blobs: { id: string; blob: Blob; thumb?: Blob }[] };

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
    return { exportedAt: manifest.exportedAt, tables: manifest.tables, blobs: (manifest.blobs ?? []).map((b) => ({ id: b.id, blob: at(b.blob), thumb: b.thumb ? at(b.thumb) : undefined })) };
  }
  // v1: one JSON document with files as data URLs.
  let data: { format?: string; exportedAt?: string; tables?: Record<string, unknown[]>; blobs?: { id: string; blob: string; thumb?: string }[] };
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new AppError('err.notBackup');
  }
  if (data?.format !== FORMAT || !data.tables) throw new AppError('err.notBackup');
  return {
    exportedAt: data.exportedAt,
    tables: data.tables,
    blobs: (data.blobs ?? []).map((b) => ({ id: b.id, blob: dataUrlToBlob(b.blob), thumb: b.thumb ? dataUrlToBlob(b.thumb) : undefined })),
  };
}

/** What a backup file holds, read from its manifest before anything is replaced (shown on the confirmation). */
export interface BackupSummary {
  exportedAt?: string;
  orders: number;
  customers: number;
  /** Photos, voice notes, PDFs and signatures in the file. */
  files: number;
}

export async function backupSummary(file: Blob): Promise<BackupSummary> {
  const data = await readBackup(file);
  const count = (t: string) => data.tables[t]?.length ?? 0;
  return { exportedAt: data.exportedAt, orders: count('orders'), customers: count('customers'), files: data.blobs.length };
}

export interface RestoreResult {
  orders: number;
  /** Files (photos, voice notes, PDFs) restored. */
  files: number;
  /** Files the device would not take (each was tried on its own). */
  lost: number;
}

/**
 * A stored file as a copy of its own bytes. A piece of the picked backup file (`slice`) is only a window on
 * that file: Safari on the iPhone does not keep it in the database (it fails, or stays a link to a temporary
 * file that is gone after the reload — the data came back without its photos).
 */
async function ownCopy(b: Blob): Promise<Blob> {
  return new Blob([await b.arrayBuffer()], { type: b.type });
}

/**
 * Replace all local data with a backup file (v2 or the older v1 JSON). The whole file is checked
 * before anything on the device is deleted. The files (photos, voice notes, PDFs) follow the tables a
 * few at a time, each read out of the backup into memory first; one the device refuses does not stop the
 * others — it is counted. `onProgress` hears the files as they go. The page reloads afterwards.
 */
export async function importBackup(file: Blob, onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  const data = await readBackup(file);
  const name = db.name;
  db.close();
  await GarageDB.delete(name);
  const fresh = new GarageDB(name);
  await fresh.open();
  const total = data.blobs.length;
  let lost = 0;
  try {
    await fresh.transaction('rw', fresh.tables, async () => {
      for (const [tableName, rows] of Object.entries(data.tables)) {
        const table = fresh.tables.find((t) => t.name === tableName);
        if (table && table.name !== 'mediaBlobs' && rows.length) await table.bulkAdd(rows);
      }
    });
    onProgress?.(0, total);
    for (let i = 0; i < total; i += 12) {
      const batch = (
        await Promise.all(
          data.blobs.slice(i, i + 12).map(async (b) => {
            try {
              return { id: b.id, blob: await ownCopy(b.blob), thumb: b.thumb ? await ownCopy(b.thumb) : undefined };
            } catch {
              lost++;
              return null;
            }
          }),
        )
      ).filter((x): x is { id: string; blob: Blob; thumb: Blob | undefined } => !!x);
      try {
        await fresh.mediaBlobs.bulkPut(batch);
      } catch {
        // One by one: only the file the device refuses is left out.
        for (const row of batch) await fresh.mediaBlobs.put(row).catch(() => void lost++);
      }
      onProgress?.(Math.min(total, i + 12), total);
    }
  } finally {
    fresh.close();
  }
  return { orders: data.tables.orders?.length ?? 0, files: total - lost, lost };
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
