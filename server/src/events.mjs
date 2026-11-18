/*
 * Changes, as they happen (v0.41.2, the user: «данные передавались моментально»): each device keeps one stream open
 * (`GET /api/sync/events`, server-sent events); when another device's changes are kept here, every other device is
 * told at once and takes them (a pull) — no waiting for the minute's check.
 *
 * `text/event-stream` exactly: the Cloudflare tunnel passes such a response on as each piece is written (anything else
 * it may hold). A comment every 15 s keeps an idle stream from being cut and shows the device a dead one.
 */

export function createEvents({ pingMs = 15_000 } = {}) {
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
    /** Changes kept (number `rev`) from device `by`: every other device is told. */
    changed(rev, by) {
      const line = `data: ${JSON.stringify({ rev })}\n\n`;
      for (const s of [...streams]) if (s.deviceId !== by) send(s, line);
    },
    /** A device cut off (or leaving): its streams end. */
    drop(deviceId) {
      for (const s of [...streams]) if (s.deviceId === deviceId) close(s);
    },
    /** Devices listening now. */
    live: () => new Set([...streams].map((s) => s.deviceId)),
    closeAll() {
      for (const s of [...streams]) close(s);
    },
  };
}
