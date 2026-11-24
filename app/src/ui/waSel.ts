import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { refreshWa, subscribeWa, waCan, waStore, type WaStore } from '../services/whatsapp';
import { useScreen } from './stack';

/*
 * The garage's WhatsApp, as a screen sees it (v0.80.2, the owner: «после интеграции ватсапа приложение начало тормозить»).
 * A busy account says something every few seconds — a message in some group, a tick, an unread count — and the store
 * changes each time. A screen that read the whole store drew itself again at each of them: the tab bar, every job in the
 * phone's stack, «Ещё»… (300 events — 3.3 s of the phone's main thread at ×4, 34 long tasks). Here a screen takes its own
 * part and draws again only when that part changes; under another screen it does not draw at all, and catches up once
 * back in front.
 */

/** Two selections the same: the same value, or objects of the same keys with the same values. */
export function shallow<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a as object);
  if (ka.length !== Object.keys(b as object).length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function useWaSel<T>(select: (s: WaStore) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const screen = useScreen();
  const pick = useRef(select);
  pick.current = select;
  const last = useRef<{ v: T } | null>(null);
  const subscribe = useCallback(
    (changed: () => void) => {
      const off = subscribeWa(changed);
      // Back in front: what changed meanwhile is taken then.
      const woke = screen?.watch(changed);
      return () => {
        off();
        woke?.();
      };
    },
    [screen],
  );
  const get = (): T => {
    const had = last.current;
    // Under another screen: what it showed stands (nobody sees it draw).
    if (had && screen && !screen.front()) return had.v;
    const v = pick.current(waStore());
    if (had && equal(had.v, v)) return had.v;
    last.current = { v };
    return v;
  };
  return useSyncExternalStore(subscribe, get, get);
}

const whole = (s: WaStore) => s;

/** The state while a screen that shows it is open: asked at once, and every two seconds while it is on its way. */
export function useWaStatus(): WaStore {
  // (Under another screen it rests: `useWaSel`.)
  const s = useWaSel(whole);
  const moving = s.status ? ['starting', 'qr', 'loading', 'offline'].includes(s.status.phase) && s.status.on : false;
  // Asked when the screen opens — and again once there is a server to ask (connected while this screen was open).
  const can = waCan();
  const known = !!s.status || s.old;
  useEffect(() => {
    void refreshWa();
  }, []);
  useEffect(() => {
    if (can && !known) void refreshWa();
  }, [can, known]);
  useEffect(() => {
    // On its way (a QR that changes, a loading that ends): the stream says it too — this is the net under it.
    const timer = setInterval(() => void refreshWa(), moving ? 2500 : 60_000);
    const back = () => document.visibilityState === 'visible' && void refreshWa();
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', back);
    };
  }, [moving]);
  return s;
}
