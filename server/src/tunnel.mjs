import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/*
 * Access from any network through Cloudflare's free quick tunnel (cloudflared, no account): turned on by the owner on
 * this computer's page, then kept on — started again with the server. Its address (https://….trycloudflare.com) is
 * read from cloudflared's own output; it changes when the tunnel starts again (a reboot), and the page shows the new one.
 * A permanent address: Tailscale Funnel (README).
 *
 * v0.41.1: cloudflared runs on its own, not as the server's child — the server stopped and started again (an update)
 * finds it still running and keeps it, so the address the phones have does not change; only a reboot changes it.
 */

const ADDRESS = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** The tunnel's address in a line of cloudflared's output, if there is one. */
export function tunnelAddress(text) {
  return ADDRESS.exec(String(text))?.[0] ?? '';
}

/** Is this process number cloudflared (a number reused after a reboot is someone else's)? */
function isTunnel(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code !== 'EPERM') return false;
  }
  if (process.platform !== 'win32') return true;
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    return /cloudflared/i.test(out);
  } catch {
    return false;
  }
}

/** Does the address reach this server (through the tunnel)? */
async function answers(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
      if (r.ok && (await r.json()).app === 'mygarage-server') return true;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export function createTunnel({ exe, port, log = () => {}, onUrl = () => {}, dir = exe ? path.dirname(exe) : '' }) {
  const stateFile = dir ? path.join(dir, 'tunnel.json') : '';
  const outFile = dir ? path.join(dir, 'cloudflared.log') : '';
  let pid = 0;
  let url = '';
  let wanted = false;
  let starting = false;
  let tries = 0;
  let watch = null;
  let again = null;

  const readState = () => {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      return null;
    }
  };
  const writeState = () => {
    try {
      fs.writeFileSync(stateFile, JSON.stringify({ pid, url }));
    } catch {
      // kept in memory only
    }
  };
  const setUrl = (u) => {
    if (u === url) return;
    url = u;
    if (u) log(`tunnel: ${u}`);
    onUrl(u);
  };

  /** Still there? Gone (no network, a crash): started again, less often each time. */
  function watching() {
    if (watch) return;
    watch = setInterval(() => {
      if (!wanted || starting || isTunnel(pid)) return;
      log('tunnel stopped, again in a moment');
      pid = 0;
      setUrl('');
      tries++;
      clearTimeout(again);
      again = setTimeout(() => void start(), Math.min(60_000, 2000 * 2 ** Math.min(tries, 5)));
    }, 15_000);
    watch.unref?.();
  }

  async function start() {
    wanted = true;
    if (starting || pid || !exe || !fs.existsSync(exe)) return;
    starting = true;
    try {
      // Left running by this server before it was started again: kept, with its address.
      const saved = readState();
      if (saved?.pid && saved.url) {
        if (isTunnel(saved.pid)) {
          if (await answers(saved.url)) {
            pid = saved.pid;
            tries = 0;
            setUrl(saved.url);
            log(`tunnel kept: ${saved.url}`);
            watching();
            return;
          }
          log(`tunnel ${saved.url} does not answer: a new one`);
          try {
            process.kill(saved.pid);
          } catch {
            // gone already
          }
        } else log(`tunnel ${saved.url} is not running any more: a new one`);
      }
      if (!wanted) return;
      // The last tunnel's own output kept beside (v0.42.2): why it stopped, if it did.
      try {
        if (fs.existsSync(outFile)) fs.renameSync(outFile, `${outFile}.1`);
      } catch {
        // still held: written over
      }
      const out = fs.openSync(outFile, 'w');
      const child = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { detached: true, windowsHide: true, stdio: ['ignore', out, out] });
      fs.closeSync(out);
      child.on('error', (e) => log(`tunnel failed: ${e.message}`));
      child.unref();
      pid = child.pid ?? 0;
      writeState();
      // Its address, from its output (in the file).
      for (let i = 0; i < 120 && wanted && pid === child.pid; i++) {
        await new Promise((r) => setTimeout(r, 500));
        let text = '';
        try {
          text = fs.readFileSync(outFile, 'utf8');
        } catch {
          // not written yet
        }
        const found = tunnelAddress(text);
        if (found) {
          tries = 0;
          setUrl(found);
          writeState();
          break;
        }
      }
      watching();
    } finally {
      starting = false;
    }
  }

  /** Turned off by the owner: the tunnel stops. */
  function stop() {
    wanted = false;
    clearInterval(watch);
    clearTimeout(again);
    watch = null;
    if (pid) {
      try {
        process.kill(pid);
      } catch {
        // gone already
      }
    }
    pid = 0;
    try {
      if (stateFile) fs.rmSync(stateFile, { force: true });
    } catch {
      // nothing to forget
    }
    setUrl('');
  }

  /** The server stops (an update, a restart): the tunnel goes on, for the server started next to keep. */
  function detach() {
    clearInterval(watch);
    clearTimeout(again);
    watch = null;
  }

  return { start: () => void start(), stop, detach, url: () => url, on: () => wanted, available: () => !!exe && fs.existsSync(exe) };
}
