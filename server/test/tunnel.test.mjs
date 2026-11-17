import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTunnel, tunnelAddress } from '../src/tunnel.mjs';

describe('the Cloudflare tunnel', () => {
  it('reads its address from cloudflared’s output', () => {
    const line = '2026-11-18T00:40:00Z INF |  https://quiet-river-lamp-abc.trycloudflare.com                                   |';
    assert.equal(tunnelAddress(line), 'https://quiet-river-lamp-abc.trycloudflare.com');
    assert.equal(tunnelAddress('INF Requesting new quick Tunnel on trycloudflare.com...'), '');
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
