import crypto from 'node:crypto';

/*
 * Changes, as they happen (v0.41.2, the user: «данные передавались моментально»): each device keeps one stream open
 * (`GET /api/sync/events`, server-sent events); when another device's changes are kept here, every other device is
 * told at once and takes them (a pull) — no waiting for the minute's check. A comment every 15 s keeps an idle stream
 * from being cut and shows the device a dead one.
 *
 * Asked for (v0.88, the owner: «отправленное сообщение висит с часиками, в настоящем WhatsApp оно давно отправлено»):
 * the address the garage's devices use is a Cloudflare quick tunnel, and a quick tunnel never passes a stream on (its
 * documentation: «Quick Tunnels do not support Server-Sent Events»; measured 25/11: through it 0 of 5 events in 70 s,
 * straight all of them at once) — the phone heard nothing live: neither WhatsApp nor the other devices' changes. So
 * what is said is also kept here a few minutes, numbered, and a device asks for what came after its number
 * (`GET /api/sync/poll?after=N&boot=…`): answered the moment there is something (a burst together), else in 25 s
 * with nothing — and asks again. An ordinary answer: every tunnel passes it on.
 */

export function createEvents({ pingMs = 15_000, holdMs = 25_000, gatherMs = 40, keepMs = 5 * 60_000, keepMost = 3000, now = () => Date.now() } = {}) {
  /** Open streams: the device and its response. */
  const streams = new Set();

  function send(s, line) {
    try {
      s.res.write(line);
    } catch {
      close(s);
    }
  }
  function close(s) {
    if (!streams.has(s)) return;
    streams.delete(s);
    clearInterval(s.ping);
    try {
      s.res.end();
    } catch {
      // gone already
    }
  }

  /* ---------- Asked for (v0.88) ---------- */

  /** This run of the server: a device's number from another run means nothing here. */
  const boot = crypto.randomBytes(6).toString('hex');
  let seq = 0;
  /** What was said lately, in order: its number, when, what, and the device it is not for (its own change). */
  const kept = [];
  /** The devices' asks waiting for something to be said. */
  const asking = new Set();
  /** When each device asked last (it is listening while it keeps asking). */
  const askedAt = new Map();

  const newer = (a) => kept.filter((k) => k.seq > a.after && k.except !== a.deviceId).map((k) => k.said);
  function answer(a, events) {
    if (!asking.has(a)) return;
    asking.delete(a);
    clearTimeout(a.timer);
    clearTimeout(a.gather);
    try {
      a.answer({ boot, seq, events });
    } catch {
      // gone meanwhile
    }
  }
  /** Something for it: answered a moment later, with whatever else is said in that moment. */
  function wake(a) {
    if (a.gather || !newer(a).length) return;
    a.gather = setTimeout(() => answer(a, newer(a)), gatherMs);
    a.gather.unref?.();
  }
  function keep(said, except) {
    seq++;
    const t = now();
    kept.push({ seq, at: t, said, except });
    while (kept.length > keepMost || (kept.length && t - kept[0].at > keepMs)) kept.shift();
    for (const a of [...asking]) wake(a);
  }

  return {
    /** A device listens: told the server's last change number now, then each one other devices make. */
    open(req, res, deviceId, rev) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });
      res.flushHeaders?.();
      req.socket?.setNoDelay?.(true);
      req.socket?.setKeepAlive?.(true, 10_000);
      const s = { res, deviceId, ping: null };
      s.ping = setInterval(() => send(s, ': ping\n\n'), pingMs);
      s.ping.unref?.();
      streams.add(s);
      send(s, `retry: 2000\ndata: ${JSON.stringify({ rev })}\n\n`);
      req.on('close', () => close(s));
      res.on('error', () => close(s));
    },
    /**
     * A device asks what was said after its number (v0.88): `{ boot, seq, events }` — `seq` the number to ask after
     * next. Its first ask, or one this run cannot answer (the server started again, or more went by than is kept): the
     * data's number now and `gap` — the device reads again what it shows.
     */
    poll(res, deviceId, rev, { after, boot: theirs } = {}, reply) {
      askedAt.set(deviceId, now());
      const n = after === null || after === undefined || after === '' ? NaN : Number(after);
      const first = !Number.isInteger(n);
      // (What is kept runs without holes up to `seq`: an ask older than its first was missed some.)
      const lost = !first && (theirs !== boot || n > seq || n < seq - kept.length);
      if (first || lost) return reply({ boot, seq, events: [{ rev }], ...(lost ? { gap: true } : {}) });
      const a = { deviceId, after: n, answer: reply, timer: null, gather: null };
      asking.add(a);
      a.timer = setTimeout(() => answer(a, []), holdMs);
      a.timer.unref?.();
      res.on('close', () => {
        asking.delete(a);
        clearTimeout(a.timer);
        clearTimeout(a.gather);
      });
      wake(a);
    },
    /** Changes kept (number `rev`) from device `by`: every other device is told. */
    changed(rev, by) {
      const line = `data: ${JSON.stringify({ rev })}\n\n`;
      for (const s of [...streams]) if (s.deviceId !== by) send(s, line);
      keep({ rev }, by);
    },
    /**
     * Something other than a change of the data, said to every device at once (v0.78: WhatsApp — a message, its ticks,
     * the state): `data: {"wa": …}`. An app that does not know the word passes it by (it reads `rev` only).
     */
    tell(payload) {
      const line = `data: ${JSON.stringify(payload)}\n\n`;
      for (const s of [...streams]) send(s, line);
      keep(payload);
    },
    /** A device cut off (or leaving): its streams end, its ask is answered (with nothing). */
    drop(deviceId) {
      for (const s of [...streams]) if (s.deviceId === deviceId) close(s);
      for (const a of [...asking]) if (a.deviceId === deviceId) answer(a, []);
      askedAt.delete(deviceId);
    },
    /** Devices listening now: a stream open, or asking (an ask lasts 25 s — one within 40 s is a device still there). */
    live() {
      const t = now();
      const out = new Set([...streams].map((s) => s.deviceId));
      for (const a of asking) out.add(a.deviceId);
      for (const [d, at] of askedAt) if (t - at < holdMs + 15_000) out.add(d);
      return out;
    },
    closeAll() {
      for (const s of [...streams]) close(s);
      for (const a of [...asking]) answer(a, []);
    },
  };
}
