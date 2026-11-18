/*
 * The server's address, found by itself (v0.42.2, the user: «сделай, чтобы iPhone сам находил новый адрес после
 * перезагрузки ПК»). The computer's free tunnel gets a new address when it starts again; the server leaves that address
 * on a public relay (ntfy.sh) for each paired device — under a topic, sealed with a key, both made from that device's
 * own key (server/src/relay.mjs: from its hash, which the server keeps). A device that cannot reach the server makes its
 * channel, reads it and opens it; the relay only ever sees sealed text under names that mean nothing. Nothing new has to
 * reach the device first: every device connected before finds the new address too.
 */

/** Where the server leaves it unless it says otherwise. */
export const RELAY = 'https://ntfy.sh';

export interface LeftAddress {
  /** The server's address. */
  u: string;
  /** When the server left it (its clock): the newest one is taken. */
  t: number;
}

const enc = new TextEncoder();

const bytes = (b64url: string): Uint8Array<ArrayBuffer> => {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** WebCrypto: on https (the app's own address) and on this computer while developing. */
const subtle = () => globalThis.crypto?.subtle;

async function hmac(key: Uint8Array<ArrayBuffer>, text: string): Promise<Uint8Array<ArrayBuffer>> {
  const k = await subtle()!.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle()!.sign('HMAC', k, enc.encode(text)));
}

/** This device's own topic and key on the relay, from its key (as the server makes them from the key's hash). */
export async function channelOf(token: string): Promise<{ topic: string; key: Uint8Array<ArrayBuffer> } | undefined> {
  if (!subtle() || !token) return undefined;
  const hash = enc.encode(hex(await subtle()!.digest('SHA-256', enc.encode(token))));
  return { topic: b64url(await hmac(hash, 'mygarage relay topic')).slice(0, 24), key: await hmac(hash, 'mygarage relay key') };
}

/** The address in a sealed text (`mg1.<iv>.<ciphertext and tag>`), or nothing: another key or topic, changed on the way. */
export async function openAddress(key: Uint8Array<ArrayBuffer>, topic: string, text: string): Promise<LeftAddress | undefined> {
  try {
    const [v, iv, body] = text.trim().split('.');
    if (!subtle() || v !== 'mg1' || !iv || !body) return undefined;
    const k = await subtle()!.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
    const plain = await subtle()!.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: enc.encode(topic) }, k, bytes(body));
    const out = JSON.parse(new TextDecoder().decode(plain)) as { u?: unknown; t?: unknown };
    return typeof out.u === 'string' && typeof out.t === 'number' && Number.isFinite(out.t) ? { u: out.u, t: out.t } : undefined;
  } catch {
    return undefined;
  }
}

/** The newest address the server left for this device (nothing there, or the relay out of reach: none). */
export async function readRelay(base: string, token: string): Promise<LeftAddress | undefined> {
  const ch = await channelOf(token);
  if (!ch) return undefined;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(`${base}/${ch.topic}/json?poll=1&since=all`, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return undefined;
    let best: LeftAddress | undefined;
    for (const line of (await res.text()).split('\n')) {
      if (!line.trim()) continue;
      let m: { event?: unknown; message?: unknown };
      try {
        m = JSON.parse(line) as typeof m;
      } catch {
        continue;
      }
      if (m.event !== 'message' || typeof m.message !== 'string') continue;
      const left = await openAddress(ch.key, ch.topic, m.message);
      if (left && (!best || left.t > best.t)) best = left;
    }
    return best;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
