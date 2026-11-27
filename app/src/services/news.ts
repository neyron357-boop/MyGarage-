import { notifyOf, type NewsKind } from '../domain/notify';
import { getSettings } from './settings';
import { callJson } from './sync/api';
import { syncConfig } from './sync/config';

/*
 * News (v0.97, the owner: «99 % этих уведомлений практически не замечаю… однотипные, скучные и не несут пользы»): what
 * happened and needs the manager now — the customer answered the quote, a supplier gave prices, a payment came, a request
 * came in WhatsApp — said at once with what happened in it («✅ Ahmed согласен · Camry Q 12345», «“ok go ahead” · 1 250
 * AED»). The device that saw it tells the garage's server (server/src/push.mjs `news`), which says it to the other
 * devices — the same key once, however many devices saw it; outside the hours it waits for the morning. On this device,
 * when its screen is on, it is shown inside the app instead (`onNewsHere`).
 */

export interface NewsItem {
  /** What it is about, once (the message's id): `answer:<msg>`, `prices:<msg>`, `payment:<msg>`, `request:<job>`. */
  key: string;
  title: string;
  body?: string;
  /** The app's own place (`#/orders/…`). */
  url?: string;
}

type Transport = (item: NewsItem & { except: boolean }) => Promise<void>;
let transport: Transport | undefined;
/** The server played by a test (and by the browser scenario). */
export function setNewsTransport(t: Transport | undefined) {
  transport = t;
  told.clear();
}

const here = new Set<(item: NewsItem) => void>();
/** News seen by this device while its screen is on — shown in the app (it is not pushed back to it). */
export function onNewsHere(fn: (item: NewsItem) => void): () => void {
  here.add(fn);
  return () => void here.delete(fn);
}

/** Told already from this device (the same message looked at again). */
const told = new Set<string>();

/** One piece of news: said if the manager wants this kind said; true — shown here or gone to the server. */
export async function tellNews(kind: NewsKind, item: NewsItem): Promise<boolean> {
  if (told.has(item.key)) return false;
  const s = notifyOf((await getSettings()).notify);
  if (!s.on || !s.news[kind]) return false;
  told.add(item.key);
  const visible = typeof document !== 'undefined' && document.visibilityState === 'visible';
  if (visible) here.forEach((f) => f(item));
  const body = { ...item, url: item.url ?? '#/', except: visible };
  try {
    if (transport) await transport(body);
    else {
      const cfg = syncConfig();
      if (!cfg) return visible;
      await callJson(cfg, '/api/push/news', { method: 'POST', body, timeout: 20_000 });
    }
    return true;
  } catch {
    // No server now (or one before v0.97): said here only.
    return visible;
  }
}
