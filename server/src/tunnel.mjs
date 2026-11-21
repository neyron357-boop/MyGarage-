import { execFile, spawn } from 'node:child_process';
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
 *
 * v0.62.3: one tunnel, ever. The check «is it still running» (tasklist, 5 s) said «no» of a tunnel that ran — on a busy
 * evening 23 times in two hours — and each «no» started one more cloudflared beside it: 24 at once, two addresses the
 * devices came through, the address in server.log flipping every minute. Now a tunnel is stopped only when the running
 * processes say so too, and before one is kept or started, every other cloudflared of this program is stopped.
 */

const ADDRESS = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** The tunnel's address in a line of cloudflared's output, if there is one. */
export function tunnelAddress(text) {
  return ADDRESS.exec(String(text))?.[0] ?? '';
}

/** Is a process with this number running? Only a clear «no such process» is no — a check that cannot tell is not. */
function exists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
}

/** The numbers in a program's output, one a line. */
const numbers = (out) =>
  String(out)
    .split(/\r?\n/)
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

/**
 * The cloudflared processes started from this program (its own path: a number reused after a reboot is someone else's,
 * and so is a cloudflared run from elsewhere), by number; null — they could not be seen.
 */
export function tunnelsOf(exe) {
  return new Promise((resolve) => {
    if (!exe) return resolve([]);
    if (process.platform === 'win32') {
      // The path goes in the script itself, sent as UTF-16 (the data folder's «Служебное» survives no code page).
      const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "$ProgressPreference = 'SilentlyContinue'",
        `$exe = ${quote(path.resolve(exe))}`,
        `Get-CimInstance Win32_Process -Filter ${quote(`Name='${path.basename(exe).replace(/'/g, "\\'")}'`)} | Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object { $_.ProcessId }`,
      ].join('; ');
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, timeout: 60_000 },
        (err, out) => resolve(err ? null : numbers(out)),
      );
      return;
    }
    execFile('ps', ['-eo', 'pid=,args='], { timeout: 30_000 }, (err, out) => {
      if (err) return resolve(null);
      const mine = [];
      for (const line of String(out).split('\n')) {
        const m = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (m && (m[2] === exe || m[2].startsWith(`${exe} `))) mine.push(Number(m[1]));
      }
      resolve(mine);
    });
  });
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * For the tests: `alive` — is a process with this number running; `running` — the tunnels of this program running now
 * (null — not seen); `end` — stop one; `launch` — start cloudflared with these arguments, its output to this file;
 * `reach` — does the address reach this server; `every` — how often the tunnel is looked at; `pause` — how long before
 * a tunnel that stopped is started again.
 */
export function createTunnel({
  exe,
  port,
  log = () => {},
  onUrl = () => {},
  dir = exe ? path.dirname(exe) : '',
  alive = exists,
  running = () => tunnelsOf(exe),
  end = (pid) => process.kill(pid),
  launch = (args, out) => spawn(exe, args, { detached: true, windowsHide: true, stdio: ['ignore', out, out] }),
  reach = answers,
  every = 15_000,
  pause = (tries) => Math.min(60_000, 2000 * 2 ** Math.min(tries, 5)),
}) {
  const stateFile = dir ? path.join(dir, 'tunnel.json') : '';
  const outFile = dir ? path.join(dir, 'cloudflared.log') : '';
  /** The address cloudflared has written in its output, if it has. */
  const written = () => {
    try {
      return tunnelAddress(fs.readFileSync(outFile, 'utf8'));
    } catch {
      return '';
    }
  };
  let pid = 0;
  let url = '';
  let wanted = false;
  let starting = false;
  let looking = false;
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

  /** These tunnels stopped, and gone before anything goes on (a few seconds at most). */
  async function stopAll(pids) {
    for (const p of pids) {
      try {
        end(p);
      } catch {
        // gone already
      }
    }
    for (let i = 0; i < 25 && pids.some(alive); i++) await sleep(200);
  }

  /** Started again in a while — less often each time; once, not again on every look. */
  function later() {
    if (again) return;
    tries++;
    again = setTimeout(() => {
      again = null;
      void start();
    }, pause(tries));
    again.unref?.();
  }

  /** Still there? Gone (no network, a crash): started again. */
  async function look() {
    if (!wanted || starting || looking) return;
    if (!pid) return later();
    looking = true;
    try {
      if (alive(pid)) {
        // Its address read whenever it is written (v0.59.4): after a reboot cloudflared took 85 s to give one, the
        // server had stopped waiting after 60 — and for 8 hours the phone did not learn where the server was.
        const found = url ? '' : written();
        if (found) {
          tries = 0;
          setUrl(found);
          writeState();
        }
        return;
      }
      // Stopped only when the running processes agree (v0.62.3): a check that could not tell had started 23 more.
      const seen = await running();
      if (!wanted || starting || !pid || seen?.includes(pid)) return;
      log('tunnel stopped, again in a moment');
      pid = 0;
      setUrl('');
      later();
    } finally {
      looking = false;
    }
  }

  function watching() {
    if (watch) return;
    watch = setInterval(() => void look(), every);
    watch.unref?.();
  }

  async function start() {
    wanted = true;
    if (starting || pid || !exe || !fs.existsSync(exe)) return;
    starting = true;
    clearTimeout(again);
    again = null;
    try {
      const saved = readState();
      // The tunnels of this program running now: one is kept at most, the others stopped (v0.62.3).
      const seen = await running();
      if (!wanted) return;
      if (!seen) log('tunnel: the running ones could not be seen');
      // Left running by this server before it was started again: kept, with its address.
      const left = saved?.pid && (seen ? seen.includes(saved.pid) : alive(saved.pid)) ? saved.pid : 0;
      let keep = 0;
      // Its address as kept, else from its own output (v0.59.4: the server before had stopped waiting for it).
      const was = left ? saved.url || written() : '';
      if (left && !was) keep = left; // still starting: its address is read as soon as it is written (`look`)
      else if (left && (await reach(was))) keep = left;
      else if (left) log(`tunnel ${was} does not answer: a new one`);
      else if (saved?.url) log(`tunnel ${saved.url} is not running any more: a new one`);
      if (!wanted) return;
      // Only the one kept goes on; one seen to run is stopped — never a second beside it.
      const others = (seen ?? []).filter((p) => p !== keep);
      if (others.length) {
        log(`tunnel: ${others.length} more running, stopped`);
        await stopAll(others);
      }
      if (keep) {
        pid = keep;
        if (was) {
          tries = 0;
          setUrl(was);
          if (was !== saved.url) writeState();
          log(`tunnel kept: ${was}`);
        } else log('tunnel kept, its address not written yet');
        watching();
        return;
      }
      if (!wanted) return;
      // The last tunnel's own output kept beside (v0.42.2): why it stopped, if it did.
      try {
        if (fs.existsSync(outFile)) fs.renameSync(outFile, `${outFile}.1`);
      } catch {
        // still held: written over
      }
      const out = fs.openSync(outFile, 'w');
      let child;
      try {
        child = launch(['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], out);
      } finally {
        fs.closeSync(out);
      }
      child.on?.('error', (e) => log(`tunnel failed: ${e.message}`));
      child.unref?.();
      pid = child.pid ?? 0;
      writeState();
      // Its address, from its output (in the file): looked for often for a minute, then by `look` until it is there.
      for (let i = 0; i < 120 && wanted && pid && pid === child.pid && alive(pid); i++) {
        await sleep(500);
        const found = written();
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

  /** Turned off by the owner: the tunnel stops — and any other of this program still running. */
  function stop() {
    wanted = false;
    clearInterval(watch);
    clearTimeout(again);
    watch = null;
    again = null;
    if (pid) {
      try {
        end(pid);
      } catch {
        // gone already
      }
    }
    pid = 0;
    if (exe && fs.existsSync(exe))
      void running().then((seen) => {
        if (!wanted && seen?.length) void stopAll(seen);
      });
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
    again = null;
  }

  return { start: () => void start(), stop, detach, url: () => url, on: () => wanted, available: () => !!exe && fs.existsSync(exe) };
}
