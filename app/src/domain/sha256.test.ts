import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { uid } from '../db/db';
import { sha256Bytes, toHex } from './sha256';

const enc = (s: string) => new TextEncoder().encode(s);
const nodeHash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('sha256 fallback (for http:// on the local network)', () => {
  it('matches known vectors', () => {
    expect(toHex(sha256Bytes(enc('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256Bytes(enc('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches Node crypto on block boundaries and binary data', () => {
    for (const n of [55, 56, 63, 64, 65, 119, 120, 1000, 70_001]) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
      expect(toHex(sha256Bytes(b))).toBe(nodeHash(b));
    }
  });
});

describe('uid', () => {
  it('builds RFC 4122 v4 ids even without crypto.randomUUID', () => {
    const original = globalThis.crypto.randomUUID;
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
      const ids = new Set(Array.from({ length: 200 }, () => uid()));
      expect(ids.size).toBe(200);
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
