import fs from 'node:fs';
import path from 'node:path';

/*
 * The chats' older messages fetched from the garage's phone by this server itself (v0.91.3, the owner: «не получается всю
 * историю загрузить — загрузи сам в сервер… а Gemini остаётся уже работать с готовыми данными»). The garage's WhatsApp Web
 * (the bridge, on this computer) is a linked device: it holds a chat's messages since it was linked; the older ones are on
 * the phone, which sends them when asked — WhatsApp Web's own «get older messages from your phone» (bridge.mjs
 * `PAGE_HISTORY_SYNC`) — only with WhatsApp open on it and only if it lets this device have them (the phone: Linked devices
 * → this device → Chat history → «All chat history»). What comes is kept by WhatsApp Web itself, on this computer; the
 * app reads it from there (it is told which chat — `{ t: 'history', chat }`) and its rules and the AI work on it.
 *
 * Here, without the app:
 *  - every chat whose older messages WhatsApp says are on the phone (`end` 0 — there; 2 — not given to this device) is asked
 *    for them, one after another (the bridge: one ask every 3 s, its answer waited for up to 40 s);
 *  - a chat that answers with older messages — asked again while more comes (a few times), the devices told;
 *  - the phone that answers without giving them (`end` 2 stays) — this device has no access: the pass stops, said so;
 *  - three chats running without an answer — the phone is not answering (WhatsApp closed on it): the pass stops;
 *  - a pass every 15 minutes, a minute after WhatsApp is ready, and a few seconds after the garage writes from the phone
 *    (then WhatsApp is open on it) — at most once in 3 minutes; «Загрузить сейчас» in the app — at once;
 *  - v0.91.7 (the owner: «на ватсапе уведомления не прекращаются… начата синх, потом финиш синх, и так постоянно»): every ask
 *    is a «sync started / sync finished» on the phone, given or not. By itself the phone is asked only while its last word
 *    is that it gives them (`gives`); a phone that was silent, gave nothing or was never asked — only by «Загрузить сейчас».
 * What is kept (`Служебное/whatsapp/history.json`): per chat its `end` and the asks' answers — never a message.
 */

const MIN = 60_000;
const DEFAULTS = { every: 15 * MIN, afterReady: MIN, nudgeGap: 3 * MIN, nudgeDelay: 5000, rounds: 5, silentStop: 3, retryChat: 30 * MIN };

export function createHistoryLoader({ file, bridge, ready, tell = () => {}, log = () => {}, now = () => Date.now(), timing = {} }) {
  const T = { ...DEFAULTS, ...timing };
  let state = read();
  let running = null;
  let progress = { done: 0, total: 0 };
  let timer = null;
  let lastNudge = 0;
  let stopped = false;

  function read() {
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (s && typeof s === 'object' && s.chats && typeof s.chats === 'object') return { chats: s.chats, phone: s.phone ?? {}, passAt: s.passAt ?? 0 };
    } catch {
      // nothing kept yet
    }
    return { chats: {}, phone: {}, passAt: 0 };
  }
  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state));
    } catch (e) {
      log(`history: not kept: ${e.message}`);
    }
  }

  const more = (end) => end === 0 || end === 2;

  /** Where it stands, for the app: what is left on the phone, what came, whether the phone answers. */
  function summary() {
    const list = Object.values(state.chats);
    const p = state.phone;
    // The phone's last word: gave older messages; answered without them (no access); did not answer or said it could not.
    const last = Math.max(p.okAt ?? 0, p.noAccessAt ?? 0, p.silentAt ?? 0, p.failedAt ?? 0);
    const phone = !last ? 'unknown' : last === p.okAt ? 'gives' : last === p.noAccessAt ? 'noAccess' : 'silent';
    return {
      more: list.filter((c) => more(c.end)).length,
      noAccess: list.filter((c) => c.end === 2).length,
      chats: list.length,
      came: list.filter((c) => c.came).length,
      asks: list.reduce((n, c) => n + (c.asks ?? 0), 0),
      phone,
      okAt: p.okAt ?? 0,
      passAt: state.passAt ?? 0,
      running: !!running,
      done: progress.done,
      total: progress.total,
    };
  }

  /** May the phone be asked without the person (v0.91.7): only while its last word is that it gives older messages. */
  const byItself = () => summary().phone === 'gives';

  /** One pass over the chats with more on the phone (`hand` — asked by the person, or the phone just woke: each is asked). */
  function pass(why = 'time') {
    if (running) return running;
    if (why !== 'hand' && !byItself()) return Promise.resolve(summary());
    running = (async () => {
      try {
        if (!ready()) return summary();
        const got = await bridge.json('/history-state');
        const t0 = now();
        for (const c of got?.chats ?? []) {
          const had = state.chats[c.id] ?? {};
          state.chats[c.id] = { ...had, end: c.end };
        }
        const fresh = why !== 'time';
        // Never asked first, then the longest ago; a chat asked without an answer lately — later (unless asked by hand).
        const todo = Object.entries(state.chats)
          .filter(([, c]) => more(c.end) && (fresh || !c.lastAt || t0 - c.lastAt > T.retryChat || c.result === 'ok'))
          .sort((a, b) => (a[1].lastAt ?? 0) - (b[1].lastAt ?? 0))
          .map(([id]) => id);
        progress = { done: 0, total: todo.length };
        tell({ t: 'historyState', state: summary() });
        let silent = 0;
        for (const id of todo) {
          if (stopped || !ready()) break;
          let stop = false;
          for (let round = 0; round < T.rounds; round++) {
            let r;
            try {
              r = await bridge.json('/history-sync', { method: 'POST', body: { chat: id } });
            } catch (e) {
              log(`history: ask: ${e.message}`);
              stop = true;
              break;
            }
            const c = state.chats[id];
            if (r?.paused) {
              state.phone.pausedAt = now();
              stop = true;
              break;
            }
            if (!r?.asked) {
              c.end = r?.end ?? c.end;
              break;
            }
            c.asks = (c.asks ?? 0) + 1;
            c.lastAt = now();
            c.result = r.result;
            if (typeof r.endNow === 'number' || r.endNow === null) c.end = r.endNow;
            if (r.result === 'ok') {
              silent = 0;
              if (r.older) {
                c.came = (c.came ?? 0) + 1;
                state.phone.okAt = now();
                tell({ t: 'history', chat: id });
                if (more(c.end)) continue;
                break;
              }
              // It answered and gave nothing: no access for this device (2), or nothing older (0).
              if (c.end === 2) {
                state.phone.noAccessAt = now();
                stop = true;
              }
              break;
            }
            if (r.result === 'failed') state.phone.failedAt = now();
            else silent++;
            break;
          }
          progress = { done: progress.done + 1, total: progress.total };
          if (progress.done % 5 === 0) {
            save();
            tell({ t: 'historyState', state: summary() });
          }
          if (stop) break;
          if (silent >= T.silentStop) {
            state.phone.silentAt = now();
            break;
          }
        }
        state.passAt = now();
        save();
        const s = summary();
        log(`history: pass (${why}): ${progress.done} of ${progress.total} chats asked; phone ${s.phone}; ${s.more} chats with more on it`);
        return s;
      } catch (e) {
        log(`history: ${e.message}`);
        return summary();
      } finally {
        running = null;
        progress = { done: 0, total: 0 };
        tell({ t: 'historyState', state: summary() });
      }
    })();
    return running;
  }

  return {
    summary,
    pass,
    /** «Загрузить сейчас»: a pass at once, every chat with more asked. */
    run: () => {
      void pass('hand');
      return summary();
    },
    /** The garage wrote from the phone (WhatsApp is open on it): a pass in a few seconds, at most once in 3 minutes. */
    nudge() {
      if (stopped || now() - lastNudge < T.nudgeGap) return;
      lastNudge = now();
      setTimeout(() => void pass('phone'), T.nudgeDelay).unref?.();
    },
    /** With the server: a pass every 15 minutes (each looks whether WhatsApp is ready first). */
    start() {
      stopped = false;
      clearInterval(timer);
      timer = setInterval(() => void pass('time'), T.every);
      timer.unref?.();
    },
    /** WhatsApp has just become ready: a pass a minute later. */
    ready() {
      if (!stopped) setTimeout(() => void pass('time'), T.afterReady).unref?.();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
