import { useEffect } from 'react';
import { SyncError } from './sync/api';
import { keepOutbox, waCall, waCan, type OutboxFace } from './whatsapp';

/*
 * What goes to WhatsApp by itself (v0.79): handed to the garage's server once (server/src/waOutbox.mjs keeps it and
 * sends it when WhatsApp answers — the app may be closed by then). Not reached (no network, the server restarting): kept
 * on this device and handed over again a minute later, and at the next start. An item's key is its own: handed over
 * twice — from here, or from another device that saw the same thing happen — it goes once.
 */

export interface OutPart {
  text?: string;
  /** A photo the garage's server keeps (the car's): sent from there. */
  media?: string;
  caption?: string;
  /** Said instead when the photo never reached the server. */
  fallback?: string;
  /** A file made here (a PDF, a sheet of diagrams), base64. */
  data?: string;
  name?: string;
  mime?: string;
  doc?: boolean;
}

export interface OutItem {
  key: string;
  chat?: string;
  phone?: string;
  parts: OutPart[];
  title?: string;
  /** Seconds to pause before this chat (suppliers one after another). */
  gap?: number;
}

const PENDING = 'mygarage.wa.outbox';
const readPending = (): OutItem[] => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(PENDING) ?? '[]') as OutItem[];
  } catch {
    return [];
  }
};
const writePending = (list: OutItem[]) => {
  try {
    globalThis.localStorage?.setItem(PENDING, JSON.stringify(list));
  } catch {
    // too large for the device's storage: the files go, the words stay
    try {
      globalThis.localStorage?.setItem(PENDING, JSON.stringify(list.map((it) => ({ ...it, parts: it.parts.filter((p) => !p.data) })).filter((it) => it.parts.length)));
    } catch {
      // nothing more to do
    }
  }
};

/** A file as the server takes it. */
export async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Handed to the server: each item queued there (or sent already — its key known). Not reached: kept here to be handed
 * over again (`flushWaOutbox`) — the result says «local».
 */
export async function queueWa(items: OutItem[]): Promise<{ key: string; state: OutboxFace['state'] | 'local' }[]> {
  if (!items.length) return [];
  if (!waCan()) return items.map((it) => ({ key: it.key, state: 'none' as const }));
  try {
    const out: OutboxFace[] = [];
    // A few at a time: a request's sheets of diagrams make each item large.
    for (let i = 0; i < items.length; i += 8) {
      const r = await waCall<{ items: OutboxFace[] }>('outbox', { method: 'POST', body: { items: items.slice(i, i + 8) }, timeout: 120_000 });
      out.push(...(r.items ?? []));
    }
    keepOutbox(out);
    return out.map((x) => ({ key: x.key, state: x.state }));
  } catch (e) {
    // The server said no to the item itself (bad, too large): not kept to fail again.
    if (e instanceof SyncError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 409) throw e;
    const have = readPending();
    const keys = new Set(have.map((x) => x.key));
    writePending([...have, ...items.filter((x) => !keys.has(x.key))]);
    return items.map((it) => ({ key: it.key, state: 'local' as const }));
  }
}

let flushing = false;
/** What was kept here handed over again. */
export async function flushWaOutbox(): Promise<number> {
  if (flushing || !waCan()) return 0;
  const list = readPending();
  if (!list.length) return 0;
  flushing = true;
  try {
    const r = await waCall<{ items: OutboxFace[] }>('outbox', { method: 'POST', body: { items: list.slice(0, 20) }, timeout: 120_000 });
    keepOutbox(r.items ?? []);
    const done = new Set((r.items ?? []).map((x) => x.key));
    writePending(readPending().filter((x) => !done.has(x.key)));
    return done.size;
  } catch {
    return 0;
  } finally {
    flushing = false;
  }
}
export const pendingWaCount = (): number => readPending().length;

/** Where these items stand (sent, waiting, failed) — kept in the WhatsApp store too. */
export async function outboxStatus(keys?: string[]): Promise<{ items: OutboxFace[]; queued: number; failed: number; sent: number }> {
  const r = await waCall<{ items: OutboxFace[]; queued: number; failed: number; sent: number }>('outbox', { query: keys?.length ? { keys: keys.join(',') } : undefined, timeout: 20_000 });
  keepOutbox(r.items ?? []);
  return r;
}
export async function retryOutbox(key: string): Promise<void> {
  const r = await waCall<{ item: OutboxFace }>('outbox-retry', { method: 'POST', body: { key } });
  keepOutbox([r.item]);
}
export async function dropOutbox(key: string): Promise<void> {
  const r = await waCall<{ item: OutboxFace }>('outbox-drop', { method: 'POST', body: { key } });
  keepOutbox([r.item]);
}

let timer: ReturnType<typeof setInterval> | undefined;
/** Once, at the app's start: what waits here is handed over now and every minute. */
export function startWaOutbox() {
  if (timer || typeof window === 'undefined') return;
  void flushWaOutbox();
  timer = setInterval(() => void flushWaOutbox(), 60_000);
  window.addEventListener('online', () => void flushWaOutbox());
}

/** The items of these keys, read when the screen opens (and kept right by the stream after). */
export function useOutboxKeys(keys: string[]) {
  const k = keys.join(',');
  useEffect(() => {
    if (!k || !waCan()) return;
    void outboxStatus(k.split(',')).catch(() => undefined);
  }, [k]);
}
