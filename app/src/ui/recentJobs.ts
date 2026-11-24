/*
 * Jobs opened lately on this device (v0.81, the user's brief: «поднимать недавно открытые или изменённые заказы»): the
 * board puts a job opened a moment ago on top as it does one changed. Kept like the board's view — on the device only,
 * not the garage's data (opening a job still writes nothing to it, and other devices do not see what was opened here).
 */

const KEY = 'mygarage.recentJobs';
const KEEP = 200;

let cache: Record<string, string> | undefined;

function read(): Record<string, string> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    cache = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** The job was opened now. */
export function markJobOpened(id: string, at = new Date().toISOString()): void {
  const all = { ...read(), [id]: at };
  const kept = Object.entries(all)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, KEEP);
  cache = Object.fromEntries(kept);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // private mode: remembered while the app is open
  }
}

/** When the job was last opened on this device. */
export function jobOpenedAt(id: string): string | undefined {
  return read()[id];
}
