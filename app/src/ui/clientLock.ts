import { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/*
 * The job shown to its customer (v0.67, the owner's note: «кнопка замка для клиента, чтобы он при показе из приложения
 * случайно не открыл детали и не посмотрел стоимость закупки… иногда я показываю клиенту, если рядом, прямо из
 * приложения»): one job locked on screen. The job shows only what is the customer's (features/job/ClientView.tsx); the
 * app around it — the tab bar, the side menu, «Назад», the PC's keys — is gone, and any other address leads back to the
 * job. Unlocked only by holding the lock. Kept on the device (a reload stays locked), never in the data.
 */

const KEY = 'mygarage.clientLock';
const EVENT = 'mygarage:clientLock';

function read(): string | null {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return memory;
  }
}
/** Without storage (a private window): kept for this visit. */
let memory: string | null = null;

/** The job locked for its customer now (none — the app as usual). */
export const clientLocked = (): string | null => read();

function set(orderId: string | null) {
  memory = orderId;
  try {
    if (orderId) localStorage.setItem(KEY, orderId);
    else localStorage.removeItem(KEY);
  } catch {
    // private mode: for this visit
  }
  window.dispatchEvent(new Event(EVENT));
}

export const lockForClient = (orderId: string) => set(orderId);
export const unlockClient = () => set(null);

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};

export function useClientLock(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

/**
 * While a job is locked: the page knows it (`html[data-client-lock]` — the styles hide the app's chrome), and any other
 * address — a Back, a swipe from the edge, a key — leads back to the job.
 */
export function useClientLockGuard() {
  const locked = useClientLock();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const html = document.documentElement;
    if (locked) html.setAttribute('data-client-lock', '');
    else html.removeAttribute('data-client-lock');
  }, [locked]);
  useEffect(() => {
    if (locked && pathname !== `/orders/${locked}`) navigate(`/orders/${locked}`, { replace: true });
  }, [locked, pathname, navigate]);
}
