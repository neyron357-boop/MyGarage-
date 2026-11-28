import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { copyTree, createMirror, hourStamp } from '../src/mirror.mjs';
import { DIRS } from '../src/store.mjs';

/* v1.06: the base every hour, a second copy of the garage's files — never the service folder. Made-up files only. */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mg-mirror-'));
const put = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

describe('the copies (mirror.mjs)', () => {
  it('copies new and changed files only, whole', async () => {
    const a = tmp();
    const b = tmp();
    put(path.join(a, 'x', '1.jpg'), 'one');
    put(path.join(a, '2.pdf'), 'two');
    assert.equal(await copyTree(a, b), 2);
    assert.equal(fs.readFileSync(path.join(b, 'x', '1.jpg'), 'utf8'), 'one');
    assert.equal(await copyTree(a, b), 0);
    put(path.join(a, '2.pdf'), 'two, longer');
    assert.equal(await copyTree(a, b), 1);
    assert.equal(fs.readFileSync(path.join(b, '2.pdf'), 'utf8'), 'two, longer');
    assert.ok(!fs.existsSync(path.join(b, '2.pdf.part')));
  });

  it('the base every hour (the last 48), and the second copy: the base, the week’s daily copies, photos, documents — not the service folder', async () => {
    const data = tmp();
    const stick = path.join(tmp(), 'MyGarage копия');
    fs.mkdirSync(stick);
    put(path.join(data, DIRS.service, 'garage.db'), 'BASE');
    put(path.join(data, DIRS.service, 'whatsapp', 'session'), 'SECRET');
    put(path.join(data, DIRS.media, '2026-11', 'p.jpg'), 'PHOTO');
    put(path.join(data, DIRS.docs, 'Инвойсы', 'i.pdf'), 'PDF');
    for (let d = 1; d <= 9; d++) put(path.join(data, DIRS.backups, `garage-2026-11-0${d}.db`), `DAY${d}`);
    // forty-nine hours already kept: the oldest goes
    for (let h = 0; h < 49; h++) put(path.join(data, DIRS.backups, 'Каждый час', `garage-2026-01-01-${String(h).padStart(2, '0')}.db`), 'H');
    const meta = new Map();
    const store = { snapshot: (to) => fs.copyFileSync(path.join(data, DIRS.service, 'garage.db'), to), metaGet: (k) => meta.get(k), metaSet: (k, v) => meta.set(k, v) };
    const m = createMirror({ store, dataDir: data, log: () => {}, oneDrive: '', places: [stick] });
    await m.run();
    const hours = fs.readdirSync(path.join(data, DIRS.backups, 'Каждый час'));
    assert.equal(hours.length, 48);
    assert.ok(hours.includes(`garage-${hourStamp()}.db`));
    assert.equal(fs.readFileSync(path.join(stick, 'garage.db'), 'utf8'), 'BASE');
    assert.equal(fs.readFileSync(path.join(stick, DIRS.media, '2026-11', 'p.jpg'), 'utf8'), 'PHOTO');
    assert.equal(fs.readFileSync(path.join(stick, DIRS.docs, 'Инвойсы', 'i.pdf'), 'utf8'), 'PDF');
    assert.deepEqual(fs.readdirSync(path.join(stick, DIRS.backups)).sort(), ['garage-2026-11-03.db', 'garage-2026-11-04.db', 'garage-2026-11-05.db', 'garage-2026-11-06.db', 'garage-2026-11-07.db', 'garage-2026-11-08.db', 'garage-2026-11-09.db']);
    assert.ok(!fs.existsSync(path.join(stick, DIRS.service)));
    const st = m.status();
    assert.equal(st.targets.length, 1);
    assert.equal(st.targets[0].error, '');
    assert.ok(st.targets[0].copied >= 10);
    // nothing changed since: no new copy of the base (a quiet night takes no room); changed — a new one
    let rev = 5;
    const quiet = createMirror({ store: { ...store, lastRev: () => rev }, dataDir: data, log: () => {}, oneDrive: '', places: [] });
    for (const f of fs.readdirSync(path.join(data, DIRS.backups, 'Каждый час'))) fs.rmSync(path.join(data, DIRS.backups, 'Каждый час', f));
    await quiet.run();
    const one = fs.readdirSync(path.join(data, DIRS.backups, 'Каждый час'));
    assert.equal(one.length, 1);
    fs.renameSync(path.join(data, DIRS.backups, 'Каждый час', one[0]), path.join(data, DIRS.backups, 'Каждый час', 'garage-2026-01-01-00.db'));
    await quiet.run();
    assert.deepEqual(fs.readdirSync(path.join(data, DIRS.backups, 'Каждый час')), ['garage-2026-01-01-00.db']);
    rev = 6;
    await quiet.run();
    assert.equal(fs.readdirSync(path.join(data, DIRS.backups, 'Каждый час')).length, 2);
    // the OneDrive only when turned on
    assert.equal(st.oneDriveOn, false);
    m.setOneDrive(false);
    assert.equal(meta.get('mirror.onedrive'), 'off');
  });
});
