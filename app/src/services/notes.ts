import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import type { JobNote, Media, MediaBlob } from '../domain/types';
import { AppError } from './errors';
import { addMedia } from './media';

/**
 * A job's notes, a chat with oneself: what the mechanic found, what was checked, what the customer was
 * promised — a few words, a photo, a video or a voice message. They are the manager's own: not on any
 * document, can be removed.
 *
 * The workshop's own notes (v0.22: a bulb to change in the office, paper for the printer) are the same notes
 * with no job — `orderId` is `GARAGE_NOTES` (''), still in the `orderId` index; no job ever has that id, so a
 * job's notes, its deletion and its board place never see them.
 */
export const GARAGE_NOTES = '';

/** The workshop's own notes, oldest first (`GarageNotesPage`). */
export const garageNotes = () => db.notes.where('orderId').equals(GARAGE_NOTES).sortBy('createdAt');

/** How many workshop notes there are (the «Заметки» row in «Ещё»). */
export const garageNoteCount = () => db.notes.where('orderId').equals(GARAGE_NOTES).count();

export async function addNote(orderId: string, input: { text?: string; photo?: Blob; video?: Blob; voice?: Blob; seconds?: number; peaks?: number[]; replyTo?: string }): Promise<JobNote> {
  const text = input.text?.trim();
  if (!text && !input.photo && !input.video && !input.voice) throw new AppError('err.emptyNote');
  const id = uid();
  const kind: JobNote['kind'] = input.voice ? 'voice' : input.video ? 'video' : input.photo ? 'photo' : 'text';
  const note: JobNote = { id, orderId, kind, text: text || undefined, createdAt: nowIso() };
  if (input.replyTo) note.replyTo = input.replyTo;
  if (input.voice) {
    note.mediaId = (await addMedia({ ownerType: 'note', ownerId: id, slot: 'voice', file: input.voice, kind: 'audio' })).id;
    note.seconds = input.seconds ? Math.round(input.seconds) : undefined;
    if (input.peaks?.length) note.peaks = input.peaks.map((p) => Math.round(Math.max(0, Math.min(1, p)) * 100) / 100);
  } else if (input.video) note.mediaId = (await addMedia({ ownerType: 'note', ownerId: id, slot: 'video', file: input.video, kind: 'video' })).id;
  else if (input.photo) note.mediaId = (await addMedia({ ownerType: 'note', ownerId: id, slot: 'photo', file: input.photo })).id;
  await db.transaction('rw', db.notes, db.orders, async () => {
    await db.notes.add(note);
    // A job's note puts the job first on the board; the workshop's has no job.
    if (orderId !== GARAGE_NOTES) await db.orders.update(orderId, { updatedAt: note.createdAt });
  });
  return note;
}

/** A voice note's bars, read from its recording after it was kept (domain/waveform.ts). */
export async function setNotePeaks(id: string, peaks: number[]): Promise<void> {
  const n = await db.notes.get(id);
  if (!n || n.kind !== 'voice' || !peaks.length) return;
  await db.notes.update(id, { peaks: peaks.map((p) => Math.round(Math.max(0, Math.min(1, p)) * 100) / 100) });
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
