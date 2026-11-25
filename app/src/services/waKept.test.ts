import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WaChat, WaStatus } from '../domain/whatsapp';

/*
 * The chats' list kept on this device (v0.88, the owner: «нужно чтобы контакты в кеше сохранились локально, а то каждый
 * раз замечаю, как они перезагружаются»): read once from the server, kept; the app started again shows them at once —
 * not as read now (the server is asked again); another device's keeping is not shown; WhatsApp unlinked — forgotten.
 * The server's part is played through `fetch` (not the test transport: with it nothing is kept).
 */

const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  get length() {
    return mem.size;
  },
} as Storage;

const status = (over: Partial<WaStatus> = {}): WaStatus => ({ available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '2.3000', error: '', chats: 2, unread: 0, ...over });
const chat = (id: string, name: string): WaChat => ({ id, name, group: false, phone: '', unread: 0, t: 1000, archived: false, pinned: false, muted: false, self: false, last: null });
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
let phase: WaStatus['phase'] = 'ready';

beforeAll(async () => {
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('fetch', async (url: string) => {
    const p = new URL(url).pathname;
    if (p === '/api/wa/status') return json(status(phase === 'off' ? { phase: 'off', linked: false } : {}));
    if (p === '/api/wa/chats') return json({ chats: [chat('a@lid', 'Ali'), chat('b@lid', 'Bader')], total: 2, unread: 0 });
    return new Response('{}', { status: 404 });
  });
  const { setSyncConfig } = await import('./sync/config');
  setSyncConfig({ url: 'https://garage.example', token: 'tok', deviceId: 'dev-1', deviceName: 'Phone', pairedAt: '2026-11-25T00:00:00.000Z' });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('v0.88: the chats kept on this device', () => {
  it('read once — kept; started again — shown at once, as kept (asked again); WhatsApp unlinked — forgotten', async () => {
    const wa = await import('./whatsapp');
    expect(wa.waStore().chats).toEqual([]);
    await wa.refreshWa();
    await wa.loadChats(true);
    expect(wa.waStore().chats.map((c) => c.id)).toEqual(['a@lid', 'b@lid']);
    // Kept a moment later (a busy account changes the list every few seconds: written once for them all).
    await new Promise((r) => setTimeout(r, 2200));
    const kept = JSON.parse(mem.get('mygarage.wa.list') ?? 'null') as { device: string; chats: WaChat[] } | null;
    expect(kept?.device).toBe('dev-1');
    expect(kept?.chats.map((c) => c.name)).toEqual(['Ali', 'Bader']);

    // The app started again: the list at once, marked as kept — not as read now.
    vi.resetModules();
    const again = await import('./whatsapp');
    expect(again.waStore().chats.map((c) => c.id)).toEqual(['a@lid', 'b@lid']);
    expect(again.waStore().chatsKept).toBeGreaterThan(0);
    expect(again.waStore().chatsAt).toBe(0);
    // Read from the server again: no longer «kept».
    await again.refreshWa();
    await again.loadChats(true);
    expect(again.waStore().chatsKept).toBeUndefined();
    expect(again.waStore().chatsAt).toBeGreaterThan(0);

    // Another device's keeping (paired again as another): not shown.
    const { setSyncConfig, syncConfig } = await import('./sync/config');
    const mine = syncConfig()!;
    setSyncConfig({ ...mine, deviceId: 'dev-2' });
    vi.resetModules();
    expect((await import('./whatsapp')).waStore().chats).toEqual([]);
    setSyncConfig(mine);

    // WhatsApp unlinked on the server: nothing of it stays on this device.
    vi.resetModules();
    const last = await import('./whatsapp');
    expect(last.waStore().chats).toHaveLength(2);
    phase = 'off';
    await last.refreshWa();
    expect(mem.has('mygarage.wa.list')).toBe(false);
    expect(last.waStore().chats).toEqual([]);
  });
});
