import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatches } from './patch.mjs';

/* After `npm install` (package.json `postinstall`), and by hand: `node apply-patches.mjs`. Never fails the install. */
const here = path.dirname(fileURLToPath(import.meta.url));
try {
  const done = applyPatches(path.join(here, 'patches'), path.join(here, 'node_modules'));
  for (const d of done) console.log(`patch ${d.name}: ${d.state} — ${d.note}`);
  if (!done.length) console.log('patches: none');
} catch (e) {
  console.log(`patches: ${e?.message || e}`);
}
