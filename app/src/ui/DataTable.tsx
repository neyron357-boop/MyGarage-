import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { useMoreRows } from './moreRows';

/*
 * A list of a PC as a table (v0.41): a row a line, the columns the facts of it, a click on a head sorts by it (once
 * more — the other way). Rows open with a click or Enter, ↑ ↓ walk them. Only on a computer (the phone keeps its
 * rows); its look is in desk.css («Tables»): a white group of the app, the head stuck under the bar.
 */

export interface Column<T> {
  key: string;
  /** One or two words. */
  label: ReactNode;
  cell: (row: T) => ReactNode;
  /** What the column sorts by; without it the head is not a button. */
  sort?: (row: T) => string | number;
  /** A first click sorts it down: the newest, the biggest first (dates, money, counts). */
  desc?: boolean;
  align?: 'left' | 'right' | 'center';
  /** A CSS width; '1%' — as narrow as what it holds. */
  width?: string | number;
  /** Quieter words (a phone number, a date). */
  muted?: boolean;
  /** One line, never wrapped (money, dates). */
  nowrap?: boolean;
}

export interface TableSection<T> {
  key: string;
  /** The group's head across the table (a day of the book): what and how much. */
  head: ReactNode;
  rows: T[];
}

type Sort = { key: string; dir: 1 | -1 } | null;

/** The sort picked on this device for this table (a per-viewer convenience: lost storage just means the default). */
function readSort(id: string | undefined, fallback: Sort): Sort {
  if (!id) return fallback;
  try {
    const v = JSON.parse(localStorage.getItem(`mygarage.sort.${id}`) ?? 'null') as Sort;
    return v && typeof v.key === 'string' && (v.dir === 1 || v.dir === -1) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writeSort(id: string | undefined, s: Sort) {
  if (!id) return;
  try {
    localStorage.setItem(`mygarage.sort.${id}`, JSON.stringify(s));
  } catch {
    // private mode: the sort lasts while the screen is open
  }
}

const compare = (a: string | number, b: string | number) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));

/** Moves the focus to the row above or below (the table's own ↑ ↓). */
function walk(e: KeyboardEvent<HTMLTableRowElement>, open: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    open();
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const rows = [...(e.currentTarget.closest('tbody')?.querySelectorAll<HTMLTableRowElement>('tr[data-row]') ?? [])];
  const at = rows.indexOf(e.currentTarget);
  rows[at + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
}

export function DataTable<T>({
  rows,
  sections,
  columns,
  rowKey,
  onRow,
  onRowMenu,
  rowRoute,
  rowDim,
  initialSort = null,
  sortId,
  empty,
  label,
  page,
}: {
  rows?: T[];
  /** Rows in groups, each under its own head (then no sorting: the groups keep their order). */
  sections?: TableSection<T>[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** A click (or Enter) on a row. */
  onRow?: (row: T) => void;
  /** A right click on a row: its menu where the mouse is. */
  onRowMenu?: (row: T, at: { x: number; y: number }) => void;
  /** The screen a row opens (v0.89): a right click, the wheel or Ctrl+click opens it in a new tab (App.tsx `DeskRouteMenu`). */
  rowRoute?: (row: T) => string | undefined;
  /** A row that steps back (done with, cancelled). */
  rowDim?: (row: T) => boolean;
  initialSort?: Sort;
  /** Remembers the sort on this device under this name. */
  sortId?: string;
  empty?: ReactNode;
  label?: string;
  /** A long list (v0.60.1): its rows drawn as it is scrolled, the first thirty at once. */
  page?: boolean;
}) {
  const [sort, setSort] = useState<Sort>(() => readSort(sortId, initialSort));
  const col = sort ? columns.find((c) => c.key === sort.key && c.sort) : undefined;
  const sorted = !sections && rows && col && sort ? [...rows].sort((a, b) => sort.dir * compare(col.sort!(a), col.sort!(b))) : rows;
  const shown = useMoreRows(page && sorted ? sorted.length : 0, `${rows?.length}|${sort?.key}|${sort?.dir}`);
  const drawn = page && sorted ? sorted.slice(0, shown.limit) : sorted;
  const pick = (c: Column<T>) => {
    const next: Sort = sort?.key === c.key ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.desc ? -1 : 1 };
    setSort(next);
    writeSort(sortId, next);
  };
  const row = (r: T) => {
    const k = rowKey(r);
    return (
      <tr
        key={k}
        data-row={onRow ? '' : undefined}
        data-route={rowRoute?.(r)}
        data-dim={rowDim?.(r) || undefined}
        tabIndex={onRow ? 0 : undefined}
        // (A name or a phone drawn over with the mouse to copy it is not a click on the row.)
        onClick={onRow ? () => !window.getSelection()?.toString() && onRow(r) : undefined}
        onKeyDown={onRow ? (e) => walk(e, () => onRow(r)) : undefined}
        onContextMenu={
          onRowMenu
            ? (e: MouseEvent) => {
                e.preventDefault();
                onRowMenu(r, { x: e.clientX, y: e.clientY });
              }
            : undefined
        }
      >
        {columns.map((c) => (
          <td key={c.key} data-align={c.align} data-muted={c.muted || undefined} data-nowrap={c.nowrap || undefined}>
            {c.cell(r)}
          </td>
        ))}
      </tr>
    );
  };
  const nothing = sections ? !sections.some((s) => s.rows.length) : !rows?.length;
  return (
    <div className="dt">
      <table aria-label={label}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width !== undefined ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => {
              const on = sort?.key === c.key && !!c.sort && !sections;
              return (
                <th key={c.key} data-align={c.align} aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined} scope="col">
                  {c.sort && !sections ? (
                    <button type="button" className="dt-sort" data-on={on || undefined} onClick={() => pick(c)}>
                      {c.align === 'right' && (on && sort!.dir === -1 ? <IconArrowDown size={13} stroke={2.4} aria-hidden /> : <IconArrowUp size={13} stroke={2.4} aria-hidden />)}
                      {c.label}
                      {c.align !== 'right' && (on && sort!.dir === -1 ? <IconArrowDown size={13} stroke={2.4} aria-hidden /> : <IconArrowUp size={13} stroke={2.4} aria-hidden />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sections
            ? sections.map((s) =>
                s.rows.length ? (
                  [
                    <tr key={`g-${s.key}`} className="dt-group">
                      <td colSpan={columns.length}>{s.head}</td>
                    </tr>,
                    ...s.rows.map(row),
                  ]
                ) : null,
              )
            : drawn?.map(row)}
          {page && !sections && shown.more('tr', columns.length)}
          {nothing && empty && (
            <tr>
              <td colSpan={columns.length} className="dt-empty">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
