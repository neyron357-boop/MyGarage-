import { useEffect, useSyncExternalStore } from 'react';
import { callJson, SyncError } from './sync/api';
import { syncConfig } from './sync/config';
import { openRoute } from '../ui/openRoute';

/*
 * This device takes notifications (v0.74): the browser's push subscription, kept on the garage's server
 * (server/src/push.mjs), which sends. An iPhone gives a web app notifications only when it is on the Home Screen
 * (iOS 16.4+), and asks the person once — in answer to a tap: `enablePush` is called straight from the button.
 *
 * What stands in the way is said as a state, not an error: no server connected, a server not updated yet (it has no
 * /api/push), an iPhone's app opened in Safari and not from the Home Screen, permission refused in the phone's settings.
 */

export interface PushState {
  /** The browser can take notifications at all (a service worker, Push, Notification). */
  can: boolean;
  /** An iPhone or iPad with the app open in Safari: «На экран Домой» first. */
  needsInstall: boolean;
  /** The app's service worker is there (not while developing: `npm run dev` has none). */
  worker: boolean;
  permission: NotificationPermission;
  /** Connected to the garage's server. */
  server: boolean;
  /** The server can send (false — an older server: update it; undefined — not asked yet, or out of reach). */
  serverReady?: boolean;
  /** This device is subscribed, and the server has its subscription. */
  subscribed: boolean;
  busy: boolean;
}

const ios = () => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const standalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
const capable = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let state: PushState = { can: false, needsInstall: false, worker: false, permission: 'default', server: false, subscribed: false, busy: false };
const subs = new Set<() => void>();
function set(patch: Partial<PushState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

const bytes = (b64u: string) => {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const sameKey = (sub: PushSubscription, key: Uint8Array) => {
  const have = sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : undefined;
  return !!have && have.length === key.length && have.every((v, i) => v === key[i]);
};
const registration = () => (capable() ? navigator.serviceWorker.getRegistration() : Promise.resolve(undefined));

/** Where things stand: read from the browser and asked of the server. With `renew` — a subscription the phone already has is told to the server again (it may have forgotten it: the device paired anew). */
export async function refreshPush(renew = false): Promise<PushState> {
  const cfg = syncConfig();
  const can = capable();
  const base: Partial<PushState> = { can, needsInstall: ios() && !standalone(), server: !!cfg, permission: can ? Notification.permission : 'default' };
  if (!can) return set({ ...base, worker: false, subscribed: false }), state;
  const reg = await registration().catch(() => undefined);
  let sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  let serverReady = state.serverReady;
  let known = false;
  if (cfg) {
    try {
      const r = await callJson<{ key: string; subscribed: boolean }>(cfg, '/api/push/key', { timeout: 15_000 });
      serverReady = true;
      known = r.subscribed;
      // The server's key is another (its database new): the old subscription is of no use to it.
      if (sub && !sameKey(sub, bytes(r.key))) {
        await sub.unsubscribe().catch(() => false);
        sub = null;
      }
      if (sub && Notification.permission === 'granted' && (renew || !known)) {
        await callJson(cfg, '/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() }, timeout: 15_000 });
        known = true;
      }
    } catch (e) {
      // 404: a server from before v0.74. Anything else (no network): not known now.
      if (e instanceof SyncError && e.status === 404) serverReady = false;
    }
  }
  set({ ...base, worker: !!reg, serverReady, subscribed: !!sub && known && Notification.permission === 'granted' });
  return state;
}

/**
 * «Включить» — straight from the tap (an iPhone asks for permission only then): permission, the subscription, the
 * server told. Returns the state: `permission` 'denied' — refused (to be allowed in the phone's settings).
 */
export async function enablePush(): Promise<PushState> {
  const cfg = syncConfig();
  if (!capable() || !cfg) return refreshPush();
  set({ busy: true });
  try {
    // First, with nothing awaited before it: the tap's permission to ask.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return set({ permission, subscribed: false }), state;
    const reg = await registration();
    if (!reg) return set({ permission, worker: false }), state;
    const { key } = await callJson<{ key: string }>(cfg, '/api/push/key', { timeout: 15_000 });
    const appKey = bytes(key);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, appKey)) {
      await sub.unsubscribe().catch(() => false);
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    await callJson(cfg, '/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() }, timeout: 15_000 });
    set({ permission, worker: true, serverReady: true, subscribed: true });
  } catch (e) {
    if (e instanceof SyncError && e.status === 404) set({ serverReady: false });
    else throw e;
  } finally {
    set({ busy: false });
  }
  return state;
}

/** No more notifications on this device (the others keep theirs). */
export async function disablePush(): Promise<void> {
  const cfg = syncConfig();
  set({ busy: true });
  try {
    const sub = await (await registration())?.pushManager.getSubscription();
    await sub?.unsubscribe().catch(() => false);
    if (cfg) await callJson(cfg, '/api/push/unsubscribe', { method: 'POST', body: {}, timeout: 15_000 }).catch(() => undefined);
    set({ subscribed: false });
  } finally {
    set({ busy: false });
  }
}

/** «Проверить»: one notification to this device now. False — the server could not send it (the reason in `error`). */
export async function testPush(title: string, body: string): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  const cfg = syncConfig();
  if (!cfg) return { ok: false };
  const r = await callJson<{ ok: boolean; status: number; gone?: boolean; error?: string }>(cfg, '/api/push/test', { method: 'POST', body: { title, body }, timeout: 30_000 });
  if (r.gone) await refreshPush();
  return r;
}

/** This device's notifications, as a screen shows them; read anew when the screen opens. */
export function usePush(): PushState {
  const s = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    void refreshPush().catch(() => undefined);
  }, []);
  return s;
}

/**
 * How many things wait, on the app's icon (the iPhone's badge; v0.74) — set while the app is open from «Сегодня», and
 * by each notification while it is closed (public/push-sw.js).
 */
export function setBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) void nav.setAppBadge?.(n)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    // not a browser that has it
  }
}

/**
 * A notification tapped while the app is open: the service worker says where it leads (public/push-sw.js) — the app
 * goes there. Once, at the app's start; a subscription this device already has is told to the server again.
 */
export function startPush() {
  if (!capable()) return;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; url?: string } | undefined;
    if (d?.type === 'mg-open' && typeof d.url === 'string' && d.url.startsWith('#/')) openRoute(d.url);
  });
  window.setTimeout(() => void refreshPush(true).catch(() => undefined), 4000);
}
