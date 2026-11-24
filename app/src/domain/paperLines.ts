import type { Expense, PaperLine } from './types';

/*
 * A supplier's paper by its positions (v0.77, the owner: «если в инвойсе есть позиции — отображать их отдельным списком,
 * а не всё одной строкой в заметках»; «при отправке в WhatsApp — по списку, в правильном формате»). Since v0.77 an expense
 * keeps the positions read off its receipt by themselves (`Expense.lines`) and its note only what is not them (the
 * paper's number, what the manager types). A receipt recorded before kept them all in its note — «#98352 · SWITCH ON OFF
 * 3PIN D ×2 · RELAY» — and is read here the same way. Every one-line view (the book's row, the debts, the money sheet,
 * the accountant's CSV, search) shows the note with the positions after it, as it always did — `expenseNoteLine`.
 */

const MAX_LINES = 60;

/** «NAME ×2» — a position in one line (as the receipt's note wrote it before v0.77). */
export const paperLineText = (l: PaperLine): string => (l.qty !== 1 ? `${l.name} ×${l.qty}` : l.name);

/** Positions to keep: a name (at most 80 letters), how many (above 0, else 1); at most 60 of them. */
export function cleanPaperLines(lines?: readonly PaperLine[]): PaperLine[] | undefined {
  const out = (lines ?? [])
    .map((l) => ({ name: String(l?.name ?? '').trim().slice(0, 80), qty: Number(l?.qty) > 0 ? Math.round(Number(l.qty) * 1000) / 1000 : 1 }))
    .filter((l) => l.name)
    .slice(0, MAX_LINES);
  return out.length ? out : undefined;
}

/** A piece of an old receipt note: «NAME ×2» — the name and how many; no «×» — one. */
function lineOfPiece(piece: string): PaperLine {
  const m = piece.match(/^(.+?)\s×(\d+(?:[.,]\d+)?)$/);
  return m ? { name: m[1].trim(), qty: Number(m[2].replace(',', '.')) || 1 } : { name: piece, qty: 1 };
}

/**
 * An expense's positions and the note besides them. Kept by themselves (v0.77) — as they are. Before: read out of the
 * note of an expense with its receipt's photo, when the note is the one the receipt wrote — its pieces « · » apart, the
 * first the paper's number («#…», may be missing), each other in capitals (the garage's lines are named so); with no
 * number — two pieces at least. Anything else is a note as typed: no positions.
 */
export function paperOf(e: Pick<Expense, 'note' | 'lines' | 'receiptMediaId'>): { note?: string; lines: PaperLine[] } {
  const note = e.note?.trim() || undefined;
  if (e.lines?.length) return { note, lines: e.lines };
  if (!note || !e.receiptMediaId) return { note, lines: [] };
  const pieces = note.split(' · ').map((p) => p.trim());
  const no = /^#.{1,20}$/.test(pieces[0]) ? pieces.shift() : undefined;
  if (pieces.length < (no ? 1 : 2) || pieces.some((p) => !p || /\p{Ll}/u.test(p))) return { note, lines: [] };
  return { note: no, lines: pieces.map(lineOfPiece) };
}

/** The note and the positions after it, in one line — the book's row, the debts, the money sheet, the CSV, search. */
export function expenseNoteLine(e: Pick<Expense, 'note' | 'lines' | 'receiptMediaId'>): string | undefined {
  const p = paperOf(e);
  return [p.note, ...p.lines.map(paperLineText)].filter(Boolean).join(' · ') || undefined;
}

/** The positions as a numbered list, a line each — «1. SWITCH ON OFF 3PIN D × 2» (WhatsApp shows it as a list). */
export function paperListText(lines: readonly PaperLine[]): string[] {
  return lines.map((l, k) => `${k + 1}. ${l.name}${l.qty !== 1 ? ` × ${l.qty}` : ''}`);
}
