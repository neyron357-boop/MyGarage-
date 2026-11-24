import fs from 'node:fs';
import path from 'node:path';

/*
 * A fix of the library kept as a patch (patches/<package>+<version>+<what>.diff) and put on after `npm install`
 * (apply-patches.mjs): the library on disk is the published one plus what is written here, read line by line before it
 * was taken. No `patch` program is needed (Windows has none): a unified diff is small enough to apply by hand.
 *
 * A hunk is put where its «before» lines stand (the place nearest to where the diff says); already there — left;
 * neither — said, and the file is not touched at all (a half-applied fix is worse than none).
 */

/** The files of a unified diff: each with its hunks — the lines before and after. */
export function parseDiff(diff) {
  const files = [];
  let file = null;
  let hunk = null;
  for (const line of String(diff).replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = null;
      hunk = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const name = line.slice(4).trim().replace(/^b\//, '');
      file = { path: name, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (line.startsWith('--- ') && !hunk) continue;
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (head && file) {
      hunk = { at: Number(head[1]), before: [], after: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('+')) hunk.after.push(line.slice(1));
    else if (line.startsWith('-')) hunk.before.push(line.slice(1));
    else if (line.startsWith(' ') || line === '') {
      // (a blank context line may have lost its leading space)
      hunk.before.push(line.slice(1));
      hunk.after.push(line.slice(1));
    }
  }
  // The diff's own last line break is not a line of the file.
  for (const f of files)
    for (const h of f.hunks) {
      while (h.before.length && h.after.length && h.before[h.before.length - 1] === '' && h.after[h.after.length - 1] === '') {
        h.before.pop();
        h.after.pop();
      }
    }
  return files.filter((f) => f.hunks.length && f.path !== '/dev/null');
}

/** Where `block` stands in `lines` — every place. */
function places(lines, block) {
  const out = [];
  if (!block.length) return out;
  for (let i = 0; i + block.length <= lines.length; i++) {
    let same = true;
    for (let k = 0; k < block.length; k++)
      if (lines[i + k] !== block[k]) {
        same = false;
        break;
      }
    if (same) out.push(i);
  }
  return out;
}

/**
 * A file's text with the hunks put on: `{ text, applied, already, failed }`. With any hunk that found no place the
 * text comes back as it was.
 */
export function applyHunks(text, hunks) {
  const crlf = /\r\n/.test(text);
  let lines = text.replace(/\r\n/g, '\n').split('\n');
  let applied = 0;
  let already = 0;
  let failed = 0;
  let shift = 0;
  for (const h of hunks) {
    const want = h.at - 1 + shift;
    const nearest = (list) => list.reduce((best, i) => (best === -1 || Math.abs(i - want) < Math.abs(best - want) ? i : best), -1);
    const before = nearest(places(lines, h.before));
    const after = nearest(places(lines, h.after));
    // Already there — and not merely the «before» lines being part of the «after» ones.
    if (after !== -1 && (before === -1 || Math.abs(after - want) <= Math.abs(before - want))) {
      already++;
      continue;
    }
    if (before === -1) {
      failed++;
      continue;
    }
    lines = [...lines.slice(0, before), ...h.after, ...lines.slice(before + h.before.length)];
    shift += h.after.length - h.before.length;
    applied++;
  }
  if (failed) return { text, applied: 0, already, failed };
  return { text: lines.join(crlf ? '\r\n' : '\n'), applied, already, failed };
}

/** `whatsapp-web.js+1.34.8+pr201990-login-route.diff` → the package, its version, what it is. */
export function patchName(file) {
  const m = /^(.+?)\+(\d+\.\d+\.\d+[^+]*)\+(.+)\.diff$/.exec(path.basename(file));
  return m ? { pkg: m[1].replace(/__/g, '/'), version: m[2], what: m[3] } : null;
}

/** Every patch of `patchesDir` put on the packages of `modulesDir`: what happened to each, in words. */
export function applyPatches(patchesDir, modulesDir) {
  const out = [];
  if (!fs.existsSync(patchesDir)) return out;
  for (const name of fs.readdirSync(patchesDir).sort()) {
    const p = patchName(name);
    if (!p) continue;
    const pkgDir = path.join(modulesDir, ...p.pkg.split('/'));
    let version = '';
    try {
      version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
    } catch {
      out.push({ name, state: 'missing', note: `${p.pkg} is not installed` });
      continue;
    }
    // A patch is for the version it was read against: a newer library has its own fix, or other lines.
    if (version !== p.version) {
      out.push({ name, state: 'skipped', note: `${p.pkg} is ${version}, the patch is for ${p.version}` });
      continue;
    }
    const files = parseDiff(fs.readFileSync(path.join(patchesDir, name), 'utf8'));
    const done = [];
    let failed = 0;
    let applied = 0;
    for (const f of files) {
      const abs = path.join(pkgDir, f.path);
      // Only inside the package.
      if (!abs.startsWith(pkgDir + path.sep) || !fs.existsSync(abs)) {
        failed++;
        continue;
      }
      const r = applyHunks(fs.readFileSync(abs, 'utf8'), f.hunks);
      failed += r.failed;
      applied += r.applied;
      if (!r.failed && r.applied) done.push([abs, r.text]);
    }
    if (failed) {
      out.push({ name, state: 'failed', note: `${failed} part(s) found no place in ${p.pkg} ${version} — nothing written` });
      continue;
    }
    for (const [abs, text] of done) fs.writeFileSync(abs, text);
    out.push({ name, state: applied ? 'applied' : 'already', note: applied ? `${applied} part(s) put on ${p.pkg} ${version}` : `${p.pkg} ${version} has it already` });
  }
  return out;
}
