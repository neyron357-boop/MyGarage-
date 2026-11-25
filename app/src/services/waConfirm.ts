import { useSyncExternalStore } from 'react';
import { uid } from '../db/db';
import type { OutItem } from './waOutbox';

/*
 * Nothing goes to WhatsApp by itself (v0.85, the owner: «все автоотправки в ватсап должны быть с подтверждением и нажатием
 * кнопки с предварительным просмотром что отправляем»). What the app prepares — the work group's report, the customer's
 * group, the boss's, the wash, the suppliers' requests, a tile's report — waits here, on the device where it happened,
 * until the person sees it (to whom, the words, the photos and files) and taps «Отправить» (`WaConfirm`,
 * features/whatsapp/WaConfirm.tsx); «Не отправлять» drops it. Only then `queueWa(…, { confirmed: true })` hands it to the
 * garage's server. Kept in localStorage while the app is closed (the files of a large one — in memory only).
 */

export interface WaAsk {
  id: string;
  at: string;
  item: OutItem;
}

const KEY = 'mygarage.wa.confirm';
let list: WaAsk[] = read();
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());

function read(): WaAsk[] {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as WaAsk[];
  } catch {
    return [];
  }
}

function keep() {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Too large to keep (PDFs): what has files stays in memory only — the words are kept.
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(list.filter((a) => !a.item.parts.some((p) => p.data))));
    } catch {
      // nothing kept — it waits while the app is open
    }
  }
}

/** Prepared, to be seen and sent by hand. The same key again replaces what was waiting under it (the newer words). */
export function askToSend(items: OutItem[]): void {
  if (!items.length) return;
  const at = new Date().toISOString();
  const keys = new Set(items.map((i) => i.key));
  list = [...list.filter((a) => !keys.has(a.item.key)), ...items.map((item) => ({ id: uid(), at, item }))];
  keep();
  tell();
}

/** Seen: sent or dropped — off the list. */
export function forgetAsks(ids: string[]): void {
  const gone = new Set(ids);
  list = list.filter((a) => !gone.has(a.id));
  keep();
  tell();
}

/** The words of one changed before it goes. */
export function editAsk(id: string, item: OutItem): void {
  list = list.map((a) => (a.id === id ? { ...a, item } : a));
  keep();
  tell();
}

export function waAsks(): WaAsk[] {
  return list;
}

export function useWaAsks(): WaAsk[] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => list,
  );
}

/** Tests: start empty. */
export function resetWaAsks() {
  list = [];
  keep();
  tell();
}
