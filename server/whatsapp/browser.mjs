import fs from 'node:fs';

/*
 * The browser WhatsApp Web runs in: this computer's own Chrome (or Edge) — none is downloaded. `CHROME` names another.
 * Read by the bridge and by the server (which says «no browser» before starting a bridge that could not work).
 */
export function findBrowser(env = process.env) {
  const places = [
    env.CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return places.find((p) => fs.existsSync(p)) || '';
}
