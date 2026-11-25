/*
 * Is the bridge hearing WhatsApp? (v0.87, the owner: «ватсап тут какой-то не живой — сообщение не отображается, придётся
 * каждый раз обновлять приложение»).
 *
 * Seen on the garage's computer 25/11: WhatsApp Web ready, and for twenty minutes not one message, tick or unread heard.
 * The library ties its listeners on the page in one call (`attachEventListeners`): it puts the page's functions there one
 * by one, then — last — the listeners themselves. That call stopped after 11 of its 17 functions: the first one
 * (`onAddMessageEvent`) was there, so the bridge's old check (is that function on the page?) said «tied», and nothing was
 * ever heard. (The functions stay on a page even when it loads again; the listeners do not.)
 *
 * So the bridge now asks two things a minute, and believes neither function's mere presence:
 *  1. Did the library's call end on this very page? The bridge marks the page when it has (`MARK_TIED`); a page that
 *     loaded again has no mark until it is tied again.
 *  2. Does the page have a message the bridge never heard? The newest message WhatsApp Web added as new (since ready,
 *     of a kind the library tells of) against the newest one heard: newer by more than the grace twice running — deaf.
 * Deaf: WhatsApp Web is started again (a clean page, tied in one go) — at once the first time, then less and less often
 * should it keep happening (a WhatsApp Web the library no longer understands is not started again every minute).
 * Pure: the bridge gives it the page's answer and the time; it says what to do. No message's words or numbers here.
 */

/** The page, marked once the library's listeners are on it (its own call ended). */
export const MARK_TIED = () => {
  window.__mgTied = true;
};

/**
 * Kinds the library tells of as a message, whatever happens to them after: not its group notices (it says those
 * otherwise), not a ciphertext (told once readable), not one taken back (one taken back before it was readable is never
 * told).
 */
const TOLD = ['chat', 'image', 'video', 'ptt', 'audio', 'document', 'sticker', 'location', 'vcard', 'multi_vcard', 'poll_creation', 'list', 'list_response', 'buttons_response', 'template_button_reply'];

/**
 * What the page says of itself (run in WhatsApp Web): marked or not, how long this page has been there, and the time
 * (WhatsApp's seconds) of the newest message it added as new in a chat active since `since` (seconds).
 */
export const PAGE_HEARS = (since, told) => {
  const out = { tied: window.__mgTied === true, age: Math.round(performance.now()), newest: 0 };
  try {
    const kinds = new Set(told);
    const C = window.require('WAWebCollections');
    for (const chat of C.Chat.getModelsArray()) {
      if (!chat.t || chat.t < since) continue;
      const id = (chat.id && (chat.id._serialized || chat.id.$1)) || '';
      if (!/@(c\.us|g\.us|lid)$/.test(id)) continue;
      const list = chat.msgs.getModelsArray();
      for (let i = list.length - 1, seen = 0; i >= 0 && seen < 4; i--, seen++) {
        const m = list[i];
        if (!m || !m.isNewMsg || m.isNotification || !kinds.has(m.type)) continue;
        if (m.t > out.newest) out.newest = m.t;
      }
    }
  } catch (e) {
    out.error = String((e && e.message) || e).slice(0, 80);
  }
  return out;
};
export const TOLD_KINDS = TOLD;

/** How long a page may stay unmarked after ready, a message unheard, and how long between starts that keep failing. */
export const TIE_GRACE = 75_000;
export const HEAR_GRACE = 40_000;
const AGAIN = [2_000, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];

export function createHearing() {
  /** The newest message heard (ms, WhatsApp's time), since this WhatsApp Web was started. */
  let heardT = 0;
  /** When something was last heard (this computer's time). */
  let heardAt = 0;
  let strikes = 0;
  let lastAge = -1;
  /** WhatsApp Web started again for deafness, running, with nothing heard since. */
  let deafRuns = 0;
  return {
    /** A message heard (the library's `message_create`): its time in WhatsApp's seconds. */
    heard(tSeconds, now = Date.now()) {
      const t = Number(tSeconds) * 1000;
      if (Number.isFinite(t) && t > heardT) heardT = t;
      heardAt = now;
      // Heard: whatever started it again did its job.
      deafRuns = 0;
    },
    /** A new WhatsApp Web (started, or started again): what was heard of the last one does not count. */
    fresh() {
      heardT = 0;
      strikes = 0;
      lastAge = -1;
    },
    get heardAt() {
      return heardAt;
    },
    /** The `since` for the page (seconds): chats active from a minute before ready. */
    since(readyAt) {
      return Math.floor((readyAt - 60_000) / 1000);
    },
    /**
     * The page's answer (`PAGE_HEARS`) judged: `ok`, `wait` (not sure yet) or `deaf` (with why). `reloaded`: the page is
     * a new one since the last look (WhatsApp Web loaded itself again) — said for the log.
     */
    judge(seen, { readyAt, now = Date.now() }) {
      const reloaded = lastAge >= 0 && seen.age + 1000 < lastAge;
      lastAge = seen.age;
      if (reloaded) strikes = 0;
      const pageFrom = now - seen.age;
      if (!seen.tied) {
        strikes = 0;
        return { verdict: now - Math.max(readyAt, pageFrom) > TIE_GRACE ? 'deaf' : 'wait', why: 'not tied', reloaded };
      }
      const newest = Number(seen.newest) * 1000;
      const unheard = newest > heardT + 1000 && newest > readyAt && newest > pageFrom && now - newest > HEAR_GRACE;
      if (!unheard) {
        strikes = 0;
        return { verdict: 'ok', why: '', reloaded };
      }
      strikes++;
      return { verdict: strikes >= 2 ? 'deaf' : 'wait', why: 'not heard', reloaded };
    },
    /** Deaf: how long until WhatsApp Web is started again (the first time at once, then less and less often). */
    again() {
      const ms = AGAIN[Math.min(deafRuns, AGAIN.length - 1)];
      deafRuns++;
      strikes = 0;
      return ms;
    },
  };
}
