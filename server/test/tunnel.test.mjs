import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createTunnel, tunnelAddress, tunnelsOf } from '../src/tunnel.mjs';

describe('the Cloudflare tunnel', () => {
  it('reads its address from cloudflared’s output', () => {
    const line = '2026-11-18T00:40:00Z INF |  https://quiet-river-lamp-abc.trycloudflare.com                                   |';
    assert.equal(tunnelAddress(line), 'https://quiet-river-lamp-abc.trycloudflare.com');
    assert.equal(tunnelAddress('INF Requesting new quick Tunnel on trycloudflare.com...'), '');
  });

  /** A folder as the server keeps it: the program, the tunnel's state and its output. */
  const folder = (state, output) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-tunnel-'));
    fs.writeFileSync(path.join(dir, 'cloudflared.exe'), '');
    fs.writeFileSync(path.join(dir, 'tunnel.json'), JSON.stringify(state));
    fs.writeFileSync(path.join(dir, 'cloudflared.log'), output);
    return dir;
  };
  const until = async (ok, ms = 3000) => {
    for (let i = 0; i < ms / 10 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ADDRESS_LINE = 'INF |  https://late-bay-pen-solo.trycloudflare.com    |\n';
  const NEW_LINE = 'INF |  https://fresh-hill-cup-wren.trycloudflare.com    |\n';

  /**
   * This computer's processes as the tunnel sees them: the cloudflared ones running (`table`), what was stopped and
   * started, in order. A started one writes its address into its output at once.
   */
  const computer = (pids, { line = NEW_LINE } = {}) => {
    const table = new Set(pids);
    const done = [];
    let next = 9000;
    return {
      table,
      done,
      running: async () => [...table],
      alive: (pid) => table.has(pid),
      end: (pid) => {
        done.push(`end ${pid}`);
        table.delete(pid);
      },
      launch: (args, out) => {
        const pid = next++;
        done.push(`launch ${pid}`);
        table.add(pid);
        fs.writeSync(out, `INF Requesting new quick Tunnel on trycloudflare.com...\n${line}`);
        return { pid, on() {}, unref() {} };
      },
    };
  };
  const tunnelIn = (dir, pc, more = {}) => {
    const logged = [];
    const got = [];
    const t = createTunnel({
      exe: path.join(dir, 'cloudflared.exe'),
      port: 1,
      dir,
      reach: async () => true,
      onUrl: (u) => got.push(u),
      log: (s) => logged.push(s),
      every: 20,
      pause: () => 30,
      ...pc,
      ...more,
    });
    return { t, got, logged };
  };

  it('keeps a running tunnel whose address the server before had stopped waiting for (v0.59.4)', async () => {
    const dir = folder({ pid: 4242, url: '' }, `INF Requesting new quick Tunnel on trycloudflare.com...\n${ADDRESS_LINE}`);
    const pc = computer([4242]);
    const { t, got } = tunnelIn(dir, pc);
    t.start();
    await until(() => t.url());
    t.detach();
    assert.equal(t.url(), 'https://late-bay-pen-solo.trycloudflare.com');
    assert.deepEqual(got, ['https://late-bay-pen-solo.trycloudflare.com']);
    assert.deepEqual(pc.done, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tunnel.json'), 'utf8')), { pid: 4242, url: 'https://late-bay-pen-solo.trycloudflare.com' });
  });

  it('reads the address whenever cloudflared writes it — after a reboot it took 85 s (v0.59.4)', async () => {
    const dir = folder({ pid: 4242, url: '' }, 'INF Requesting new quick Tunnel on trycloudflare.com...\n');
    const pc = computer([4242]);
    const { t, got } = tunnelIn(dir, pc);
    t.start();
    await wait(80);
    // Still starting: kept, not a second tunnel.
    assert.equal(t.url(), '');
    fs.appendFileSync(path.join(dir, 'cloudflared.log'), ADDRESS_LINE);
    await until(() => t.url());
    t.detach();
    assert.equal(t.url(), 'https://late-bay-pen-solo.trycloudflare.com');
    assert.deepEqual(got, ['https://late-bay-pen-solo.trycloudflare.com']);
    assert.deepEqual(pc.done, []);
  });

  it('starts no second tunnel when the check of the running one cannot tell (v0.62.3: 24 at once)', async () => {
    const dir = folder({ pid: 4242, url: 'https://late-bay-pen-solo.trycloudflare.com' }, ADDRESS_LINE);
    const pc = computer([4242]);
    // The old check (tasklist, 5 s) on a busy computer: «not running» of a tunnel that runs.
    const { t, got, logged } = tunnelIn(dir, pc, { alive: () => false });
    t.start();
    await until(() => t.url());
    await wait(300); // fifteen looks at it
    t.detach();
    assert.deepEqual(pc.done, []);
    assert.deepEqual([...pc.table], [4242]);
    // The address never changes: it does not go away and come back.
    assert.deepEqual(got, ['https://late-bay-pen-solo.trycloudflare.com']);
    assert.ok(!logged.some((s) => /stopped/.test(s)), logged.join('\n'));
  });

  it('keeps the one tunnel it had and stops the others left running', async () => {
    const dir = folder({ pid: 4242, url: 'https://late-bay-pen-solo.trycloudflare.com' }, ADDRESS_LINE);
    const pc = computer([8132, 4242, 15620]);
    const { t, got } = tunnelIn(dir, pc);
    t.start();
    await until(() => t.url());
    t.detach();
    assert.deepEqual(pc.done.sort(), ['end 15620', 'end 8132']);
    assert.deepEqual([...pc.table], [4242]);
    assert.deepEqual(got, ['https://late-bay-pen-solo.trycloudflare.com']);
  });

  it('starts a new tunnel only when none is running — the ones left are stopped first', async () => {
    // Its tunnel does not answer, and two more of the same program run beside it.
    const dir = folder({ pid: 4242, url: 'https://late-bay-pen-solo.trycloudflare.com' }, ADDRESS_LINE);
    const pc = computer([4242, 5000, 5001]);
    const { t, got } = tunnelIn(dir, pc, { reach: async () => false });
    t.start();
    await until(() => t.url());
    t.detach();
    assert.deepEqual(pc.done.slice(0, 3).sort(), ['end 4242', 'end 5000', 'end 5001']);
    assert.deepEqual(pc.done.slice(3), ['launch 9000']);
    assert.deepEqual([...pc.table], [9000]);
    assert.equal(t.url(), 'https://fresh-hill-cup-wren.trycloudflare.com');
    assert.deepEqual(got, ['https://fresh-hill-cup-wren.trycloudflare.com']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tunnel.json'), 'utf8')), { pid: 9000, url: 'https://fresh-hill-cup-wren.trycloudflare.com' });
  });

  it('a tunnel that stopped is replaced by one — once', async () => {
    const dir = folder({ pid: 4242, url: 'https://late-bay-pen-solo.trycloudflare.com' }, ADDRESS_LINE);
    const pc = computer([4242]);
    const { t, got } = tunnelIn(dir, pc);
    t.start();
    await until(() => t.url());
    pc.table.delete(4242); // cloudflared ended (no network, a crash)
    await until(() => t.url() === 'https://fresh-hill-cup-wren.trycloudflare.com');
    await wait(300);
    t.detach();
    assert.deepEqual(pc.done, ['launch 9000']);
    assert.deepEqual(got, ['https://late-bay-pen-solo.trycloudflare.com', '', 'https://fresh-hill-cup-wren.trycloudflare.com']);
  });

  it('turned off: no tunnel of the program goes on', async () => {
    const dir = folder({ pid: 4242, url: 'https://late-bay-pen-solo.trycloudflare.com' }, ADDRESS_LINE);
    const pc = computer([4242]);
    const { t } = tunnelIn(dir, pc);
    t.start();
    await until(() => t.url());
    pc.table.add(7777); // started beside it by something else in this folder
    t.stop();
    await until(() => pc.table.size === 0);
    assert.deepEqual([...pc.table], []);
    assert.equal(t.url(), '');
    assert.equal(fs.existsSync(path.join(dir, 'tunnel.json')), false);
  });

  it('is not offered, and does not start, without the program', () => {
    const t = createTunnel({ exe: 'C:\\nowhere\\cloudflared.exe', port: 1 });
    assert.equal(t.available(), false);
    t.start();
    assert.equal(t.url(), '');
    t.stop();
    assert.equal(t.on(), false);
  });

  it('sees only the cloudflared started from its own program', async () => {
    // Nothing runs from a folder just made: an empty list, not «could not be seen».
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-tunnel-Служебное-'));
    assert.deepEqual(await tunnelsOf(path.join(dir, 'cloudflared.exe')), []);
  });
});
