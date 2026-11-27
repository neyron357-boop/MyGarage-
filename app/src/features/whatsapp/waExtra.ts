import { useSyncExternalStore } from 'react';
import type { Lang } from '../../domain/types';
import { aiTranslate, aiVoiceText } from '../../services/ai';

/*
 * A message's translation or a voice message's words (audit 27/11), asked of the garage's AI by a tap — and kept only in
 * memory while the app is open: the chat's words are never stored (v0.78), not here, not on the server.
 */

export interface WaExtra {
  kind: 'translate' | 'voice';
  state: 'busy' | 'done' | 'failed';
  /** The translation, or the voice message's words. */
  text?: string;
  /** A voice message in another language — the same in the manager's. */
  also?: string;
}

const extras = new Map<string, WaExtra>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  listeners.forEach((f) => f());
};
const set = (id: string, x: WaExtra) => {
  extras.set(id, x);
  changed();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** The message's extra, re-rendering only when extras change. */
export function useWaExtra(id: string): WaExtra | undefined {
  useSyncExternalStore(subscribe, () => version);
  return extras.get(id);
}

/** Arabic, Urdu, Hindi letters — a message worth translating for the manager. */
export const foreignScript = (text: string): boolean => /[؀-ۿݐ-ݿऀ-ॿ]/.test(text);

export async function translateMessage(id: string, text: string, to: Lang): Promise<void> {
  if (extras.get(id)?.state === 'busy') return;
  set(id, { kind: 'translate', state: 'busy' });
  const r = await aiTranslate(text, to);
  set(id, r && r.text ? { kind: 'translate', state: 'done', text: r.text } : { kind: 'translate', state: 'failed' });
}

export async function voiceMessageText(id: string, to: Lang): Promise<void> {
  if (extras.get(id)?.state === 'busy') return;
  set(id, { kind: 'voice', state: 'busy' });
  const r = await aiVoiceText(id);
  if (!r || !r.text) return set(id, { kind: 'voice', state: 'failed' });
  // The words as said; in the manager's language too when it was another (English is read by both).
  const other = r.from && r.from !== to && r.from !== 'en';
  set(id, { kind: 'voice', state: 'done', text: r.text, also: other && r.english ? r.english : undefined });
}
