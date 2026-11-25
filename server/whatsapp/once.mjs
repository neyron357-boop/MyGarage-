/*
 * One message for one tap (v0.84, the brief: «повтор не должен создавать дубли… после таймаута с неизвестным результатом
 * сначала сверяй отправку по идентификатору»): the app gives each send its own key and sends it again under the same key
 * when it does not know how the first ended (the network dropped, the answer never came). The same key here again — the
 * same message: still on its way, it is waited for; sent, its answer is given again. Nothing is sent twice.
 *
 * Kept while this process lives (half an hour a key). A send that failed forgets its key: sent again, it goes.
 * No dependency — the server's tests read it.
 */

/** A key the app makes: «p:» and its own id, or the same in other words — letters, digits, «:», «_», «-». */
export const SEND_KEY = /^[0-9A-Za-z:_-]{6,80}$/;
const KEEP_MS = 30 * 60_000;
const MOST = 2000;

export function createOnce({ now = () => Date.now() } = {}) {
  /** key → the send's promise and when it began (the map keeps the order they began in). */
  const sends = new Map();
  const tidy = () => {
    const t = now();
    for (const [k, v] of sends) {
      if (t - v.at <= KEEP_MS && sends.size <= MOST) break;
      sends.delete(k);
    }
  };
  /** `fn` once for the key; without a key (or a bad one) — every time, as before. */
  return function once(key, fn) {
    if (typeof key !== 'string' || !SEND_KEY.test(key)) return fn();
    tidy();
    const had = sends.get(key);
    if (had) return had.p;
    const p = Promise.resolve().then(fn);
    sends.set(key, { p, at: now() });
    p.catch(() => {
      if (sends.get(key)?.p === p) sends.delete(key);
    });
    return p;
  };
}
