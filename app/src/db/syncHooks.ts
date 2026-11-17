import type Dexie from 'dexie';

/*
 * What syncing with the garage's server (v0.40, services/sync) needs from the database itself: every record written on
 * this device is stamped with when (`_t`, a clock that only goes up), so the changes since the last push are found by
 * an index; a deletion leaves a tombstone (`syncTombs`); a photo's files wait to be sent (`mediaBlobs.up = 0`).
 * Changes that come from the server are written in a transaction marked as such: no stamp, no tombstone, and the
 * guards of signed records stand aside (the record was already signed — elsewhere).
 */

/** The field each synced record carries: when it last changed on this device (0 — as it came from the server). */
export const STAMP = '_t';
/** Tables that stay on this device. */
export const LOCAL_TABLES = new Set(['mediaBlobs', 'syncTombs']);

const CLOCK_KEY = 'mygarage.sync.clock';
let last = 0;
function readClock(): number {
  try {
    return Number(globalThis.localStorage?.getItem(CLOCK_KEY)) || 0;
  } catch {
    return 0;
  }
}
/** A stamp later than any given before on this device (the clock may go back: the stamps do not). */
export function nextStamp(): number {
  if (!last) last = readClock();
  last = Math.max(Date.now(), last + 1);
  try {
    globalThis.localStorage?.setItem(CLOCK_KEY, String(last));
  } catch {
    // kept in memory for this visit
  }
  return last;
}

type Marked = { __mgRemote?: boolean; parent?: Marked | null };
/** The transaction writes what came from the server. */
export function markRemote(trans: unknown) {
  if (trans) (trans as Marked).__mgRemote = true;
}
export function isRemote(trans: unknown): boolean {
  for (let t = trans as Marked | null | undefined; t; t = t.parent) if (t.__mgRemote) return true;
  return false;
}

type Listener = () => void;
let onChange: Listener | null = null;
/** Told of every change made here (to push it soon). */
export function onLocalChange(fn: Listener | null) {
  onChange = fn;
}

export function installSyncHooks(db: Dexie) {
  for (const table of db.tables) {
    if (LOCAL_TABLES.has(table.name)) continue;
    const name = table.name;
    table.hook('creating', function (_key, obj, trans) {
      if (isRemote(trans)) return;
      (obj as Record<string, unknown>)[STAMP] = nextStamp();
      onChange?.();
    });
    table.hook('updating', function (mods, _key, _obj, trans) {
      if (isRemote(trans)) return;
      const keys = Object.keys(mods as object);
      if (keys.length === 1 && keys[0] === STAMP) return;
      onChange?.();
      return { [STAMP]: nextStamp() };
    });
    table.hook('deleting', function (key, _obj, trans) {
      if (isRemote(trans)) return;
      trans.on('complete', () => {
        void db
          .table('syncTombs')
          .add({ t: name, k: String(key) })
          .then(() => onChange?.())
          .catch(() => undefined);
      });
    });
  }
  // A photo's files wait to be sent to the server — unless they came from it.
  db.table('mediaBlobs').hook('creating', function (_key, obj, trans) {
    const o = obj as { up?: number };
    if (o.up === undefined) o.up = isRemote(trans) ? 1 : 0;
    if (!o.up) onChange?.();
  });
}
