import { formatDateTime, nowIso } from '../../domain/dates';
import { zipStore, type ZipFile } from '../../domain/zip';
import { canvasBlob, renderAnnotated } from './render';
import { annotationsJson, shotFile, tasksMarkdown, type ExportItem } from './report';
import { fbDb, markExported } from './store';
import type { FbStrings } from './strings';
import type { FbNote } from './types';

/*
 * «Экспорт для агента»: the notes chosen, in one ZIP made on the phone — TASKS.md, screenshots/<n>.png (each with its
 * marks drawn on), annotations.json. The notes stay (marked when they went out).
 */

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const text = (s: string) => new TextEncoder().encode(s);

export async function buildExport(ids: string[], s: FbStrings, onStep?: (done: number, of: number) => void): Promise<{ file: File; count: number }> {
  const db = fbDb();
  const notes = (await db.notes.bulkGet(ids)).filter((n): n is FbNote => !!n).sort((a, b) => a.n - b.n);
  const files: ZipFile[] = [];
  const items: ExportItem[] = [];
  for (const [i, note] of notes.entries()) {
    onStep?.(i, notes.length);
    const shot = note.shotId ? await db.shots.get(note.shotId) : undefined;
    if (shot) {
      const canvas = await renderAnnotated(shot, note.marks);
      const file = shotFile(note.n);
      const { width, height } = canvas;
      files.push({ name: file, data: await bytes(await canvasBlob(canvas, 'image/png')) });
      items.push({ note, shot: { file, width, height } });
    } else items.push({ note });
    // Let the progress paint between pictures.
    await new Promise((r) => window.setTimeout(r, 0));
  }
  onStep?.(notes.length, notes.length);
  const iso = nowIso();
  const meta = { version: __APP_VERSION__, at: formatDateTime(iso), iso };
  files.unshift({ name: 'TASKS.md', data: text(tasksMarkdown(items, meta, s)) }, { name: 'annotations.json', data: text(JSON.stringify(annotationsJson(items, meta), null, 2)) });
  // Its name by the Dubai clock: mygarage-feedback-2026-11-17-2140.zip
  const [d = '', t = ''] = meta.at.split(' ');
  const stamp = `${d.split('/').reverse().join('-')}-${t.replace(':', '')}`;
  const file = new File([zipStore(files).slice()], `mygarage-feedback-${stamp}.zip`, { type: 'application/zip' });
  await markExported(
    notes.map((n) => n.id),
    iso,
  );
  return { file, count: notes.length };
}
