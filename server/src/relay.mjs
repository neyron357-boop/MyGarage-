import crypto from 'node:crypto';

/*
 * The server's address, for the devices to find by themselves (v0.42.2, the user: «сделай, чтобы iPhone сам находил
 * новый адрес после перезагрузки ПК»). Cloudflare's free tunnel gets a new address each time it starts (a reboot); the
 * devices only know the old one. So the server leaves its address with a free public relay (ntfy.sh, no account) for
 * each paired device: under a topic and sealed (AES-256-GCM) with a key both made from that device's own key — which
 * only the device has (the server keeps its hash; both start from the hash). The relay sees only the sealed text, under
 * names that mean nothing; a device that cannot reach the server reads its own, opens it, checks its key there
 * (`/api/status`) and goes on at the new address. A device cut off is no longer told.
 *
 * Sent when the address is known or changes, to a device just paired, and again every 6 hours (the relay keeps a
 * message for 12).
 */

export const DEFAULT_RELAY = 'https://ntfy.sh';
const EVERY = 6 * 60 * 60_000;

/** The hash the server keeps of a device's key (store.mjs). */
export const keyHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** A device's own topic and key on the relay, from the hash of its key (the app makes the same: services/sync/relay.ts). */
export function channelOf(tokenHash) {
  const k = Buffer.from(String(tokenHash), 'utf8');
  return {
    topic: crypto.createHmac('sha256', k).update('mygarage relay topic').digest('base64url').slice(0, 24),
    key: crypto.createHmac('sha256', k).update('mygarage relay key').digest('base64url'),
  };
}

/** The address sealed for the topic: `mg1.<iv>.<ciphertext and tag>` (base64url). The topic is checked with it. */
export function sealAddress(key, topic, url, t = Date.now()) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), iv);
  c.setAAD(Buffer.from(topic, 'utf8'));
  const body = Buffer.concat([c.update(JSON.stringify({ u: url, t }), 'utf8'), c.final(), c.getAuthTag()]);
  return `mg1.${iv.toString('base64url')}.${body.toString('base64url')}`;
}

/** The address back (or nothing: another key, another topic, changed on the way). */
export function openAddress(key, topic, text) {
  try {
    const [v, iv, body] = String(text).split('.');
    if (v !== 'mg1' || !iv || !body) return undefined;
    const raw = Buffer.from(body, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(topic, 'utf8'));
    d.setAuthTag(raw.subarray(raw.length - 16));
    const out = JSON.parse(Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString('utf8'));
    return typeof out?.u === 'string' && Number.isFinite(out?.t) ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The relay: the address sent to every paired device's channel when it is known or changes and every 6 hours, to a
 * device's when it pairs; a failed send is tried again later (it never stops the server). `base` empty: off.
 */
export function createRelay({ store, base = DEFAULT_RELAY, log = () => {}, fetchImpl = globalThis.fetch, every = EVERY } = {}) {
  base = String(base || '').replace(/\/+$/, '');
  if (!base) return null;
  let current = '';
  let timer = null;
  let tries = 0;
  let sending = null;
  const state = { at: '', error: '', devices: 0 };

  const later = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => void send(), ms);
    timer.unref?.();
  };

  /** One device's channel: the address left there. */
  async function leave(hash, url) {
    const { topic, key } = channelOf(hash);
    const r = await fetchImpl(`${base}/${topic}`, {
      method: 'POST',
      // Not passed on to phones' push services: kept on the relay only.
      headers: { Firebase: 'no', 'Content-Type': 'text/plain' },
      body: sealAddress(key, topic, url),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`relay answered ${r.status}`);
  }

  async function send() {
    if (!current) return;
    if (sending) return sending;
    const url = current;
    sending = (async () => {
      let failed = '';
      const hashes = store.relayDevices();
      for (const h of hashes) {
        try {
          await leave(h, url);
        } catch (e) {
          failed = String(e?.message || e);
        }
      }
      if (!failed) {
        tries = 0;
        state.at = new Date().toISOString();
        state.error = '';
        state.devices = hashes.length;
        later(url === current ? every : 0);
      } else {
        tries++;
        state.error = failed;
        // Again in 30 s, a minute … at most every half hour.
        later(Math.min(30 * 60_000, 15_000 * 2 ** Math.min(tries, 7)));
      }
      sending = null;
    })();
    return sending;
  }

  return {
    /** For the devices (given at pairing and with each sync): where to look — their channel they make themselves. */
    info: () => ({ url: base }),
    /** The address the devices use now: sent at once if it is new (and from then on every 6 hours). */
    publish(url) {
      url = String(url || '').replace(/\/+$/, '');
      if (!url || url === current) return;
      // A local address is no use to a phone: it never goes to the public relay.
      if (base === DEFAULT_RELAY && !/^https:\/\//.test(url)) return;
      current = url;
      log(`address for the devices: ${url}`);
      tries = 0;
      void send();
    },
    /** A device just paired (its key): its channel gets the address now. */
    paired(token) {
      if (current) void leave(keyHash(token), current).catch(() => undefined);
    },
    /** For this computer's page: when the address was last sent, and why not, if it was not. */
    status: () => ({ url: current, at: state.at, error: state.error, devices: state.devices }),
    /** Sent now (tests). */
    flush: () => send(),
    stop() {
      clearTimeout(timer);
    },
  };
}
