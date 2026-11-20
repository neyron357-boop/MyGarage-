import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, GarageDB, setDb, uid } from '../db/db';
import { cachedMediaSrc, mediaSrc } from './media';
import { setSyncConfig, type SyncConfig } from './sync/config';

const cfg: SyncConfig = { url: 'https://old-tunnel.trycloudflare.com', token: 't', deviceId: 'dev', deviceName: 'iPhone', pairedAt: '2026-11-20T00:00:00Z', mediaKey: 'key' };

beforeEach(() => {
  db.close();
  setDb(new GarageDB(`test-${uid()}`));
});
afterEach(() => setSyncConfig(null));

describe('a photo whose original is on the server only (v0.59.4)', () => {
  it('is loaded from the server’s address of now — not one kept from before the computer started again', async () => {
    setSyncConfig(cfg);
    // The original sent and gone from the phone: only its preview here.
    await db.mediaBlobs.put({ id: 'p1', thumb: new Blob(['x'], { type: 'image/jpeg' }), up: 1 });
    expect(await mediaSrc('p1')).toBe('https://old-tunnel.trycloudflare.com/api/media/p1/blob?d=dev&k=key');
    // A new tunnel: the app, open all along, learns the new address.
    setSyncConfig({ ...cfg, url: 'https://new-tunnel.trycloudflare.com' });
    expect(cachedMediaSrc('p1')).toBe('https://new-tunnel.trycloudflare.com/api/media/p1/blob?d=dev&k=key');
    expect(await mediaSrc('p1')).toBe('https://new-tunnel.trycloudflare.com/api/media/p1/blob?d=dev&k=key');
  });

  it('is not given an address made up for a photo that is here', async () => {
    setSyncConfig(cfg);
    expect(cachedMediaSrc('p2')).toBeUndefined();
  });
});
