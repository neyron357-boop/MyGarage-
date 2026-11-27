import { useSyncExternalStore } from 'react';

/*
 * «Пометить непрочитанным» (v0.99, audit W6): a chat opened for a second loses its unread, and with it the reminder «answer
 * later» — for a person with ADHD a task lost. The mark is the device's own (WhatsApp and the other devices are not told):
 * the chat shows as unread here, among «Новые», until it is opened again.
 */

const KEY = 'mygarage.wa.unreadMarks';
let marks: Set<string> = read();
const subs = new Set<() => void>();

function read(): Set<string> {
  try {
    return new Set(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function keep() {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify([...marks]));
  } catch {
    // kept while the app is open
  }
  subs.forEach((f) => f());
}

/** Marked unread, or the mark taken off (the chat opened, or the swipe once more). */
export function setUnreadMark(chat: string, on: boolean): void {
  if (on === marks.has(chat)) return;
  marks = new Set(marks);
  if (on) marks.add(chat);
  else marks.delete(chat);
  keep();
}

export const unreadMarks = (): Set<string> => marks;

export function useUnreadMarks(): Set<string> {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => marks,
  );
}
