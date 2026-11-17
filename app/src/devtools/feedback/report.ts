import type { FbStrings } from './strings';
import type { FbMark, FbNote } from './types';

/*
 * What the export says, for an AI agent: TASKS.md — one task per note, numbered as the note, with the owner's words
 * as typed (nothing made up), where it was, what was picked, the marks and the screenshot's file; annotations.json —
 * the same with all the technical detail. Pure: the notes and their pictures' sizes in, text out.
 */

export interface ExportItem {
  note: FbNote;
  /** The annotated screenshot's file in the archive, and its size (px). */
  shot?: { file: string; width: number; height: number };
}

export interface ExportMeta {
  version: string;
  /** When it was collected, as shown (Dubai time). */
  at: string;
  /** ISO time. */
  iso: string;
}

export const shotFile = (n: number) => `screenshots/${String(n).padStart(3, '0')}.png`;

const quote = (s: string) => s.replace(/\r?\n+/g, ' / ').trim();

function marksText(marks: FbMark[], s: FbStrings): string[] {
  return marks
    .filter((m) => m.comment?.trim() || !m.auto)
    .map((m) => `  ${m.n}. ${s.tools[m.kind]}${m.auto ? ` (${s.md.picked})` : ''}${m.comment?.trim() ? ` — «${quote(m.comment)}»` : ''}`);
}

export function tasksMarkdown(items: ExportItem[], meta: ExportMeta, s: FbStrings): string {
  const md = s.md;
  const out: string[] = [`# ${md.title}`, '', md.made(meta.at, items.length, meta.version), '', ...md.rules.map((r) => `- ${r}`), ''];
  for (const { note, shot } of items) {
    const p = note.page;
    const page = [p.name, p.title && p.title !== p.name ? p.title : ''].filter(Boolean).join(' — ');
    const marks = marksText(note.marks, s);
    out.push('---', '', md.task(note.n), '');
    out.push(`- **${md.page}:** ${page} (\`${p.route}\`)`);
    if (p.sheet) out.push(`- **${md.sheet}:** ${p.sheet}`);
    out.push(`- **${md.element}:** ${note.element ? note.element.description : md.noElement}`);
    out.push(`- **${md.problem}:** ${note.comment.trim() ? quote(note.comment) : md.noComment}`);
    if (marks.length) out.push(`- **${md.marks}:**`, ...marks);
    out.push(`- **${md.shot}:** ${shot ? `\`${shot.file}\`` : md.noShot}`);
    if (note.element) out.push(`- **${md.where}:** \`${note.element.selector}\`${note.element.components?.length ? ` · ${note.element.components.join(' ← ')}` : ''}`);
    out.push(`- **${md.requirement}:** ${md.requirementText}`, '');
  }
  return out.join('\n');
}

const px = (v: number) => Math.round(v * 10) / 10;

/** A mark in the screenshot's px (and its fractions, as kept). */
function markJson(m: FbMark, w: number | undefined, h: number | undefined) {
  const at = (x: number, y: number) => (w && h ? { x: px(x * w), y: px(y * h) } : undefined);
  const base = { n: m.n, kind: m.kind, comment: m.comment?.trim() || null, byTool: !!m.auto, fractions: { x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 } };
  if (m.kind === 'rect' && w && h)
    return { ...base, box: { x: px(Math.min(m.x1, m.x2) * w), y: px(Math.min(m.y1, m.y2) * h), width: px(Math.abs(m.x2 - m.x1) * w), height: px(Math.abs(m.y2 - m.y1) * h) } };
  if (m.kind === 'arrow') return { ...base, from: at(m.x1, m.y1), to: at(m.x2, m.y2) };
  return { ...base, at: at(m.x1, m.y1) };
}

export function annotationsJson(items: ExportItem[], meta: ExportMeta) {
  return {
    app: 'MyGarage',
    version: meta.version,
    exportedAt: meta.iso,
    timezone: 'Asia/Dubai',
    note: 'Coordinates: element.rect — CSS px on the screen; marks — px of the screenshot file (and fractions of it).',
    tasks: items.map(({ note, shot }) => ({
      n: note.n,
      id: note.id,
      kind: note.kind,
      status: note.status,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      comment: note.comment,
      page: note.page,
      element: note.element ?? null,
      viewport: note.viewport,
      screenshot: shot ? { file: shot.file, width: shot.width, height: shot.height } : null,
      marks: note.marks.map((m) => markJson(m, shot?.width, shot?.height)),
      appVersion: note.appVersion,
    })),
  };
}
