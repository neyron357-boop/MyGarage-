import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './store.mjs';

/*
 * The garage's copies (v1.06, the owner, 428 supplier invoices scanned in a day, «ещё 1000–2000»: «сделай так, чтобы данные
 * хранились надёжно, потому что эти данные нельзя потерять… пока не буду покупать платные серверы, пускай остаётся в этом
 * компьютере, но сделай понадёжнее, чтобы случайно не терялись»). The computer has one disk: the daily copy of the base (store
 * `backup`, 30 kept) lies on it, and the photos have none. Now:
 *  - every hour a copy of the base (`Резервные копии/Каждый час`, the last 48): a day's work is never more than an hour away;
 *  - a second copy of everything that matters — the base (its newest copy, as `garage.db`), its daily copies of the last week,
 *    the photos and videos, the documents — in each place it can go: a disk or a USB stick with a folder «MyGarage копия» at its
 *    root (found by itself, every hour), and the owner's OneDrive (only when turned on on this computer's page: it is a copy in
 *    Microsoft's cloud). New and changed files only; nothing is ever deleted there.
 *  - never «Служебное» (the WhatsApp session, the AI key, the tunnel: they are this computer's, not the garage's data).
 */

export const MIRROR_DIR = 'MyGarage копия';
const HOURS_KEPT = 48;
const DAYS_COPIED = 7;
const pad = (n) => String(n).padStart(2, '0');

/** The local hour as a file's name: «2026-11-28-22» (this computer's clock — Dubai). */
export function hourStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}`;
}

/** Copies a folder's files into another: new ones and those changed (size or newer time); returns how many were copied. */
export async function copyTree(from, to, { only } = {}) {
  let copied = 0;
  let seen = 0;
  const walk = async (src, dst) => {
    let list;
    try {
      list = await fs.promises.readdir(src, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      const a = path.join(src, e.name);
      const b = path.join(dst, e.name);
      if (e.isDirectory()) {
        await walk(a, b);
        continue;
      }
      if (!e.isFile() || (only && !only(e.name))) continue;
      // Not all at once: the server answers the phones meanwhile.
      if (++seen % 50 === 0) await new Promise((r) => setImmediate(r));
      const [sa, sb] = await Promise.all([fs.promises.stat(a), fs.promises.stat(b).catch(() => undefined)]);
      if (sb && sb.size === sa.size && sb.mtimeMs >= sa.mtimeMs - 2000) continue;
      await fs.promises.mkdir(dst, { recursive: true });
      // Written whole or not at all: a copy cut off (the stick pulled out) is not left as the file.
      const tmp = `${b}.part`;
      await fs.promises.copyFile(a, tmp);
      await fs.promises.rename(tmp, b);
      await fs.promises.utimes(b, sa.atime, sa.mtime).catch(() => undefined);
      copied++;
    }
  };
  await walk(from, to);
  return copied;
}

export function createMirror({ store, dataDir, log, oneDrive = process.env.OneDrive, drives = 'DEFGHIJKLMNOPQRSTUVWXYZ', places }) {
  let running = false;
  const state = { hourlyAt: '', hourly: '', targets: [] };

  /** The base copied this hour (once); the oldest beyond 48 go. */
  function hourly() {
    const dir = path.join(dataDir, DIRS.backups, 'Каждый час');
    fs.mkdirSync(dir, { recursive: true });
    const list = () =>
      fs
        .readdirSync(dir)
        .filter((f) => /^garage-\d{4}-\d{2}-\d{2}-\d{2}\.db$/.test(f))
        .sort();
    // Only when the base changed since the last copy (the owner: «не заполнится ли память ПК?»): a quiet night or a day off
    // takes no room, and the 48 kept reach further back.
    const rev = store.lastRev?.();
    const last = list().at(-1);
    if (last && rev !== undefined && String(rev) === store.metaGet('mirror.hourRev')) {
      state.hourly = path.join(dir, last);
      state.hourlyAt = fs.statSync(state.hourly).mtime.toISOString();
      return state.hourly;
    }
    const target = path.join(dir, `garage-${hourStamp()}.db`);
    if (!fs.existsSync(target)) store.snapshot(target);
    if (rev !== undefined) store.metaSet('mirror.hourRev', String(rev));
    const old = list();
    for (const f of old.slice(0, Math.max(0, old.length - HOURS_KEPT))) fs.rmSync(path.join(dir, f), { force: true });
    state.hourly = target;
    state.hourlyAt = new Date().toISOString();
    return target;
  }

  /** Where a second copy goes: a disk with «MyGarage копия» at its root; the OneDrive, when turned on. */
  function targets() {
    const out = [];
    if (oneDrive && fs.existsSync(oneDrive) && store.metaGet('mirror.onedrive') === 'on') out.push({ kind: 'onedrive', dir: path.join(oneDrive, MIRROR_DIR) });
    // (tests: the places given)
    if (places) for (const dir of places) if (fs.existsSync(dir)) out.push({ kind: 'drive', dir });
    if (!places && process.platform === 'win32')
      for (const letter of drives) {
        const dir = `${letter}:\\${MIRROR_DIR}`;
        try {
          if (fs.statSync(dir).isDirectory()) out.push({ kind: 'drive', dir });
        } catch {
          // no such disk, or no folder on it
        }
      }
    return out;
  }

  async function copyTo(t, snap) {
    const was = state.targets.find((x) => x.dir === t.dir);
    const res = { kind: t.kind, dir: t.dir, at: new Date().toISOString(), copied: 0, error: '', okAt: was?.okAt ?? '' };
    try {
      fs.mkdirSync(t.dir, { recursive: true });
      // The base: its newest copy, as a whole file.
      await fs.promises.copyFile(snap, path.join(t.dir, 'garage.db.part'));
      await fs.promises.rename(path.join(t.dir, 'garage.db.part'), path.join(t.dir, 'garage.db'));
      res.copied++;
      // Its daily copies of the last week.
      const days = new Set(
        fs
          .readdirSync(path.join(dataDir, DIRS.backups))
          .filter((f) => /^garage-\d{4}-\d{2}-\d{2}\.db$/.test(f))
          .sort()
          .slice(-DAYS_COPIED),
      );
      res.copied += await copyTree(path.join(dataDir, DIRS.backups), path.join(t.dir, DIRS.backups), { only: (n) => days.has(n) });
      res.copied += await copyTree(path.join(dataDir, DIRS.media), path.join(t.dir, DIRS.media));
      res.copied += await copyTree(path.join(dataDir, DIRS.docs), path.join(t.dir, DIRS.docs));
      fs.writeFileSync(path.join(t.dir, 'ПРОЧТИ.txt'), ['Копия данных MyGarage (обновляется сама каждый час, пока работает сервер).', '', 'garage.db — база (самая свежая копия); Резервные копии — копии базы за последние дни;', 'Фото и видео, Документы — как в C:\\MyGarage. Чтобы вернуть: скопировать обратно в C:\\MyGarage.', ''].join('\r\n'), 'utf8');
      res.okAt = res.at;
    } catch (e) {
      res.error = String(e?.code || e?.message || e);
      log(`copy to ${t.dir} failed: ${res.error}`);
    }
    return res;
  }

  /** The hour's copy, then the second copies. One at a time. */
  async function run() {
    if (running) return;
    running = true;
    try {
      const snap = hourly();
      const list = targets();
      const next = [];
      for (const t of list) next.push(await copyTo(t, snap));
      state.targets = next;
      const copied = next.reduce((a, x) => a + x.copied, 0);
      if (copied > 1) log(`copies: ${next.map((x) => `${x.kind} ${x.copied}${x.error ? ' (failed)' : ''}`).join(', ')}`);
    } catch (e) {
      log(`copies failed: ${e?.message || e}`);
    } finally {
      running = false;
    }
  }

  return {
    run,
    status: () => ({ hourlyAt: state.hourlyAt, hours: HOURS_KEPT, oneDrive: !!oneDrive && fs.existsSync(oneDrive), oneDriveOn: store.metaGet('mirror.onedrive') === 'on', folder: MIRROR_DIR, running, targets: state.targets }),
    setOneDrive(on) {
      store.metaSet('mirror.onedrive', on ? 'on' : 'off');
      if (on) setTimeout(() => void run(), 500);
    },
  };
}
