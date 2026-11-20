import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createTunnel, tunnelAddress } from '../src/tunnel.mjs';

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
  const until = async (ok) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  };
  const ADDRESS_LINE = 'INF |  https://late-bay-pen-solo.trycloudflare.com    |\n';

  it('keeps a running tunnel whose address the server before had stopped waiting for (v0.59.4)', async () => {
    const dir = folder({ pid: 4242, url: '' }, `INF Requesting new quick Tunnel on trycloudflare.com...\n${ADDRESS_LINE}`);
    const got = [];
    const t = createTunnel({ exe: path.join(dir, 'cloudflared.exe'), port: 1, dir, alive: (pid) => pid === 4242, reach: async () => true, onUrl: (u) => got.push(u), every: 20 });
    t.start();
    await until(() => t.url());
    t.detach();
    assert.equal(t.url(), 'https://late-bay-pen-solo.trycloudflare.com');
    assert.deepEqual(got, ['https://late-bay-pen-solo.trycloudflare.com']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tunnel.json'), 'utf8')), { pid: 4242, url: 'https://late-bay-pen-solo.trycloudflare.com' });
  });

  it('reads the address whenever cloudflared writes it — after a reboot it took 85 s (v0.59.4)', async () => {
    const dir = folder({ pid: 4242, url: '' }, 'INF Requesting new quick Tunnel on trycloudflare.com...\n');
    const got = [];
    const t = createTunnel({ exe: path.join(dir, 'cloudflared.exe'), port: 1, dir, alive: (pid) => pid === 4242, reach: async () => true, onUrl: (u) => got.push(u), every: 20 });
    t.start();
    await new Promise((r) => setTimeout(r, 80));
    // Still starting: kept, not a second tunnel.
    assert.equal(t.url(), '');
    fs.appendFileSync(path.join(dir, 'cloudflared.log'), ADDRESS_LINE);
    await until(() => t.url());
    t.detach();
    assert.equal(t.url(), 'https://late-bay-pen-solo.trycloudflare.com');
    assert.deepEqual(got, ['https://late-bay-pen-solo.trycloudflare.com']);
  });

  it('is not offered, and does not start, without the program', () => {
    const t = createTunnel({ exe: 'C:\\nowhere\\cloudflared.exe', port: 1 });
    assert.equal(t.available(), false);
    t.start();
    assert.equal(t.url(), '');
    t.stop();
    assert.equal(t.on(), false);
  });
});
