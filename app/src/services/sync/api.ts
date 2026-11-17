import type { SyncConfig } from './config';

/*
 * Calls to the garage's server (server/src/api.mjs): JSON with the device's key, files as they are. Every call has
 * its time limit — a phone on a weak network waits, then tries again later, it never hangs.
 */

export class SyncError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/** The address as typed or pasted: a host, an https://… address, or the server page's link with its code. */
export function parseAddress(input: string): { url: string; code?: string } {
  let s = input.trim();
  const code = /#pair=(\d{6})/.exec(s)?.[1];
  s = s.replace(/#.*$/, '').trim();
  if (!s) return { url: '' };
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return { url: `${u.protocol}//${u.host}`, code };
  } catch {
    return { url: '' };
  }
}

/** An address a page of this app may call: https, or this computer's own server while developing. */
export function addressAllowed(url: string): boolean {
  return /^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
}

async function timed(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, cache: 'no-store' });
  } catch (e) {
    throw new SyncError(0, (e as Error)?.name === 'AbortError' ? 'timeout' : 'offline');
  } finally {
    clearTimeout(t);
  }
}

async function failure(res: Response): Promise<SyncError> {
  let msg = res.statusText;
  try {
    msg = ((await res.json()) as { error?: string }).error ?? msg;
  } catch {
    // not JSON
  }
  return new SyncError(res.status, msg);
}

export async function callJson<T>(cfg: Pick<SyncConfig, 'url' | 'token'>, path: string, init: { method?: string; body?: unknown; timeout?: number } = {}): Promise<T> {
  const res = await timed(
    cfg.url + path,
    {
      method: init.method ?? 'GET',
      headers: { ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}), ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    },
    init.timeout ?? 30_000,
  );
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

/** A file sent; the server says how much came — anything else is a failure (the file stays here). */
export async function putFile(cfg: SyncConfig, id: string, variant: 'blob' | 'thumb', blob: Blob): Promise<void> {
  const res = await timed(
    `${cfg.url}/api/media/${encodeURIComponent(id)}/${variant}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': blob.type || 'application/octet-stream', 'X-Size': String(blob.size) }, body: blob },
    Math.max(60_000, blob.size / 50),
  );
  if (!res.ok) throw await failure(res);
  const got = (await res.json()) as { size?: number };
  if (got.size !== blob.size) throw new SyncError(500, `size ${got.size} ≠ ${blob.size}`);
}

/** A file back from the server (none — not there). */
export async function getFile(cfg: SyncConfig, id: string, variant: 'blob' | 'thumb'): Promise<Blob | undefined> {
  const res = await timed(`${cfg.url}/api/media/${encodeURIComponent(id)}/${variant}`, { headers: { Authorization: `Bearer ${cfg.token}` } }, 120_000);
  if (res.status === 404) return undefined;
  if (!res.ok) throw await failure(res);
  return res.blob();
}
