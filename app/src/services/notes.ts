import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import type { JobNote, Media, MediaBlob } from '../domain/types';
import { AppError } from './errors';
import { addMedia } from './media';

/**
 * A job's notes: what the mechanic found, what was checked, what the customer was promised — a few
 * words, a photo or a voice message. They are the manager's own: not on any document, can be removed.
 */
export async function addNote(orderId: string, input: { text?: string; photo?: Blob; voice?: Blob; seconds?: number }): Promise<JobNote> {
  const text = input.text?.trim();
  if (!text && !input.photo && !input.voice) throw new AppError('err.emptyNote');
  const id = uid();
  const note: JobNote = { id, orderId, kind: input.voice ? 'voice' : input.photo ? 'photo' : 'text', text: text || undefined, createdAt: nowIso() };
  if (input.voice) {
    note.mediaId = (await addMedia({ ownerType: 'note', ownerId: id, slot: 'voice', file: input.voice, kind: 'audio' })).id;
    note.seconds = input.seconds ? Math.round(input.seconds) : undefined;
  } else if (input.photo) note.mediaId = (await addMedia({ ownerType: 'note', ownerId: id, slot: 'photo', file: input.photo })).id;
  await db.transaction('rw', db.notes, db.orders, async () => {
    await db.notes.add(note);
    await db.orders.update(orderId, { updatedAt: note.createdAt });
  });
  return note;
}

/** Everything a removed note took with it, to put it back ("Undo"). */
export interface RemovedNote {
  note: JobNote;
  media?: Media;
  blob?: MediaBlob;
}

export async function removeNote(id: string): Promise<RemovedNote | undefined> {
  const note = await db.notes.get(id);
  if (!note) return undefined;
  return db.transaction('rw', db.notes, db.media, db.mediaBlobs, async () => {
    const media = note.mediaId ? await db.media.get(note.mediaId) : undefined;
    const blob = note.mediaId ? await db.mediaBlobs.get(note.mediaId) : undefined;
    if (note.mediaId) {
      await db.media.delete(note.mediaId);
      await db.mediaBlobs.delete(note.mediaId);
    }
    await db.notes.delete(id);
    return { note, media, blob };
  });
}

export async function restoreNote(r: RemovedNote): Promise<void> {
  await db.transaction('rw', db.notes, db.media, db.mediaBlobs, async () => {
    if (r.media) await db.media.put(r.media);
    if (r.blob) await db.mediaBlobs.put(r.blob);
    await db.notes.put(r.note);
  });
}
