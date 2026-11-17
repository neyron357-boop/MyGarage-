import Dexie, { type Table } from 'dexie';
import { uid } from '../../db/db';
import { nowIso } from '../../domain/dates';
import type { FbNote, FbShot, Shot } from './types';

/*
 * The tool's own database, apart from the app's ('mygarage'): its notes and screenshots never touch the garage's data,
 * are not in its backups, and go with the tool. Opened only when the tool is first used (or counts its notes).
 */
class FeedbackDB extends Dexie {
  notes!: Table<FbNote, string>;
  shots!: Table<FbShot, string>;
  meta!: Table<{ id: string; value: number }, string>;
  constructor() {
    super('mygarage-feedback');
    this.version(1).stores({ notes: 'id, n, status', shots: 'id', meta: 'id' });
  }
}

let instance: FeedbackDB | undefined;
export function fbDb(): FeedbackDB {
  return (instance ??= new FeedbackDB());
}

export type NewNote = Omit<FbNote, 'id' | 'n' | 'createdAt' | 'updatedAt' | 'status' | 'shotId'>;

/** Keep a new note (and its screenshot): it gets the next number — never one given before. */
export async function addNote(note: NewNote, shot?: Shot, thumb?: Blob): Promise<FbNote> {
  const db = fbDb();
  return db.transaction('rw', db.notes, db.shots, db.meta, async () => {
    const n = ((await db.meta.get('n'))?.value ?? 0) + 1;
    await db.meta.put({ id: 'n', value: n });
    const now = nowIso();
    const shotId = shot ? uid() : undefined;
    if (shot) await db.shots.add({ id: shotId!, blob: shot.blob, width: shot.width, height: shot.height, source: shot.source, scale: shot.scale, thumb });
    const full: FbNote = { ...note, id: uid(), n, status: 'new', createdAt: now, updatedAt: now, shotId };
    await db.notes.add(full);
    return full;
  });
}

export async function updateNote(id: string, patch: Partial<Pick<FbNote, 'comment' | 'status' | 'marks' | 'exportedAt'>>, thumb?: Blob): Promise<void> {
  const db = fbDb();
  await db.transaction('rw', db.notes, db.shots, async () => {
    const note = await db.notes.get(id);
    if (!note) return;
    await db.notes.update(id, { ...patch, updatedAt: nowIso() });
    if (thumb && note.shotId) await db.shots.update(note.shotId, { thumb });
  });
}

/** A note's screenshot replaced (one from the phone's photos instead of the one taken). */
export async function replaceShot(id: string, shot: Shot, thumb: Blob | undefined, marks: FbNote['marks']): Promise<void> {
  const db = fbDb();
  await db.transaction('rw', db.notes, db.shots, async () => {
    const note = await db.notes.get(id);
    if (!note) return;
    if (note.shotId) await db.shots.delete(note.shotId);
    const shotId = uid();
    await db.shots.add({ id: shotId, blob: shot.blob, width: shot.width, height: shot.height, source: shot.source, scale: shot.scale, thumb });
    await db.notes.update(id, { shotId, marks, updatedAt: nowIso() });
  });
}

export async function deleteNotes(ids: string[]): Promise<void> {
  const db = fbDb();
  await db.transaction('rw', db.notes, db.shots, async () => {
    const notes = (await db.notes.bulkGet(ids)).filter((n): n is FbNote => !!n);
    await db.shots.bulkDelete(notes.map((n) => n.shotId).filter((x): x is string => !!x));
    await db.notes.bulkDelete(notes.map((n) => n.id));
  });
}

export async function markExported(ids: string[], at: string): Promise<void> {
  const db = fbDb();
  await db.transaction('rw', db.notes, async () => {
    for (const id of ids) await db.notes.update(id, { exportedAt: at });
  });
}
