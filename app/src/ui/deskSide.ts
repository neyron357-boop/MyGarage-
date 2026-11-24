import { useSyncExternalStore } from 'react';

/*
 * The PC's side menu put away on WhatsApp's screens (v0.80, the owner: «когда открываю ватсап в этом приложении, эту
 * панель можно было скрывать»): the chats and the open chat get the whole window. On this computer (not the garage's
 * data); the other screens keep their menu.
 */

const KEY = 'mygarage.deskSide';
const subs = new Set<() => void>();
let hidden = read();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'wa-hidden';
  } catch {
    return false;
  }
}

export function setWaSideHidden(v: boolean) {
  hidden = v;
  try {
    if (v) localStorage.setItem(KEY, 'wa-hidden');
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: for this window only.
  }
  subs.forEach((fn) => fn());
}

/** Is the side menu put away on WhatsApp's screens. */
export function useWaSideHidden(): boolean {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => hidden,
  );
}
