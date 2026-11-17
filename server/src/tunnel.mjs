import { spawn } from 'node:child_process';
import fs from 'node:fs';

/*
 * Access from any network through Cloudflare's free quick tunnel (cloudflared, no account): turned on by the owner on
 * this computer's page, then kept on — started again with the server. Its address (https://….trycloudflare.com) is
 * read from cloudflared's own output; it changes when the tunnel starts again (a reboot), and the page shows the new one.
 * A permanent address: Tailscale Funnel (README).
 */

const ADDRESS = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** The tunnel's address in a line of cloudflared's output, if there is one. */
export function tunnelAddress(text) {
  return ADDRESS.exec(String(text))?.[0] ?? '';
}

export function createTunnel({ exe, port, log = () => {}, onUrl = () => {} }) {
  let proc = null;
  let url = '';
  let wanted = false;
  let timer = null;
  let tries = 0;

  function start() {
    wanted = true;
    if (proc || !fs.existsSync(exe)) return;
    proc = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const read = (buf) => {
      const found = tunnelAddress(buf);
      if (found && found !== url) {
        url = found;
        tries = 0;
        log(`tunnel: ${url}`);
        onUrl(url);
      }
    };
    proc.stdout.on('data', read);
    proc.stderr.on('data', read);
    proc.on('error', (e) => log(`tunnel failed: ${e.message}`));
    proc.on('exit', (code) => {
      proc = null;
      if (url) onUrl('');
      url = '';
      if (!wanted) return;
      // Gone (no network, a crash): started again, less often each time.
      tries++;
      log(`tunnel stopped (${code}), again in a moment`);
      timer = setTimeout(start, Math.min(60_000, 2000 * 2 ** Math.min(tries, 5)));
    });
  }

  function stop() {
    wanted = false;
    if (timer) clearTimeout(timer);
    timer = null;
    proc?.kill();
    proc = null;
    if (url) onUrl('');
    url = '';
  }

  return { start, stop, url: () => url, on: () => wanted, available: () => fs.existsSync(exe) };
}
