const { chromium } = require('playwright');

/*
 * A chat of the garage's WhatsApp under the finger (v0.84, the brief: «видимый отклик на тап ≤ 100 мс, поле ввода в уже
 * загруженном чате ≤ 300 мс, ≥ 95 % кадров в одном интервале, без зависаний ≥ 100 мс»): a phone (390 × 844, touch, DPR 3),
 * the CPU slowed (×4 by default), a server played in the page with a long chat — N messages: words, photos, voice
 * messages, documents, answers — and ~200 chats. Measured in the page (performance.now), five times each, p50 / p95:
 *   tap     — a finger on a chat's row → the next frame drawn (the visible answer);
 *   open    — the row tapped → the chat's field there to type in (the first time: the messages asked of the server);
 *   reopen  — the same, the chat read already (the brief's «уже загруженный чат»);
 *   type    — a letter typed → drawn (the field and the send button);
 *   scroll  — a finger scrolls the history up three times (older messages come as it goes) and down: frames drawn,
 *             the share within one refresh (≤ 16.7 ms × 1.2), the longest, and long tasks ≥ 100 ms;
 *   burst   — 40 messages arrive while the history is read higher up: the main thread's time and its long tasks.
 * Chrome's numbers: they compare builds (the iPhone's own are not these), as e2e/fps.cjs does.
 *
 *   npm run dev -- --port 5173   (afresh), then: node e2e/wachat.cjs [cpu=4] [messages=400]   (BASE_URL to aim elsewhere)
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const SLOW = Number(process.argv[2] || 4);
const N = Number(process.argv[3] || 400);
const TIMES = 5;

async function launchBrowser() {
  for (const channel of [undefined, 'chrome', 'msedge']) {
    try {
      return await chromium.launch(channel ? { channel } : {});
    } catch {
      // next
    }
  }
  throw new Error('no browser');
}

async function playServer(page, n) {
  await page.evaluate(async (n) => {
    const { setWaTransport } = await import('/src/services/whatsapp.ts');
    const { db } = await import('/src/db/db.ts');
    const { waDigits } = await import('/src/domain/whatsapp.ts');
    const now = Date.now();
    const cust = (await db.customers.toArray()).find((x) => waDigits(x.whatsapp || x.phone));
    const A = '55510000000001@lid';
    const pic = (w, h, q) => {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const g = cv.getContext('2d');
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#2a6f97');
      grad.addColorStop(1, '#1b1f5c');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.font = `bold ${Math.round(h / 6)}px sans-serif`;
      g.fillText('PHOTO', w * 0.2, h * 0.55);
      return cv.toDataURL('image/jpeg', q);
    };
    const photo = pic(800, 600, 0.8);
    const thumb = pic(32, 24, 0.5).split(',')[1];
    const messages = [];
    for (let i = 0; i < n; i++) {
      const t = now - (n - i) * 7 * 60_000;
      const me = i % 3 === 0;
      const id = `${me}_${A}_M${i}`;
      const k = i % 10;
      if (k === 4) messages.push({ id, chat: A, t, me, type: 'image', text: i % 20 === 4 ? 'Look at this part' : '', ack: 3, file: { mime: 'image/jpeg', w: 800, h: 600, here: true, thumb } });
      else if (k === 7) messages.push({ id, chat: A, t, me, type: 'ptt', text: '', ack: 3, file: { mime: 'audio/ogg', sec: 12, here: true } });
      else if (k === 9) messages.push({ id, chat: A, t, me, type: 'document', text: '', ack: 3, file: { mime: 'application/pdf', name: `INV-2026-${i}.pdf`, size: 120_000, here: true } });
      else messages.push({ id, chat: A, t, me, type: 'chat', text: `Message ${i}: ${'words of the message '.repeat(1 + (i % 9))}`.trim(), ack: me ? 3 : 0, ...(i % 15 === 0 && i > 0 ? { quote: { id: `M${i - 1}`, type: 'chat', text: 'the words answered', me: !me } } : {}) });
    }
    const last = (m) => ({ id: m.id, t: m.t, me: m.me, type: m.type, text: m.text.slice(0, 160), ack: m.ack });
    const chats = [{ id: A, name: cust.name, group: false, phone: waDigits(cust.whatsapp || cust.phone), unread: 0, t: now, archived: false, pinned: true, muted: false, self: false, last: last(messages.at(-1)) }];
    for (let i = 1; i < 200; i++) chats.push({ id: `5552${String(i).padStart(10, '0')}@lid`, name: `Chat ${i}`, group: false, phone: `97150${1000000 + i}`, unread: i % 5, t: now - i * 60_000, archived: false, pinned: false, muted: false, self: false, last: { id: `x${i}`, t: now - i * 60_000, me: false, type: 'chat', text: 'Some words', ack: 0 } });
    const files = {};
    for (const m of messages) if (m.type === 'image') files[m.id] = photo;
    const state = { phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '2.3000', error: '', chats: chats.length, unread: 0 };
    setWaTransport(
      async (path, init) => {
        await new Promise((r) => setTimeout(r, 60));
        if (path === 'status') return { ok: true, available: true, installed: true, browser: true, on: true, ...state };
        if (path === 'chats') return { chats, total: chats.length, unread: 0 };
        if (path === 'messages') {
          const lim = Number(init.query?.limit ?? 40);
          return { messages: init.query?.chat === A ? messages.slice(-lim) : [], more: init.query?.chat === A && messages.length > lim };
        }
        if (path === 'seen') return { ok: true, unread: 0 };
        if (path === 'number') return { ok: true, chat: A };
        if (path === 'send') {
          const m = { id: `true_${A}_S${Date.now()}`, chat: A, t: Date.now(), me: true, type: 'chat', text: init.body.text, ack: 1 };
          return { ok: true, msg: m };
        }
        throw new Error('not played: ' + path);
      },
      (kind, id) => (kind === 'media' ? (files[id] ?? '') : ''),
    );
    window.__A = A;
  }, n);
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]) : NaN;
};

(async () => {
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  await ctx.addInitScript(() => {
    localStorage.getItem('mygarage.feedback') ?? localStorage.setItem('mygarage.feedback', '0');
    // Long tasks, as they happen.
    window.__long = [];
    window.__ev = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__ev.push({ name: e.name, at: e.startTime, dur: e.duration }))).observe({ type: 'event', durationThreshold: 16, buffered: true });
    } catch {
      // not here
    }
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push({ at: e.startTime, ms: e.duration }))).observe({ type: 'longtask', buffered: true });
    } catch {
      // not here
    }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '#/');
  await page.waitForFunction(() => document.querySelector('.screen'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => (await import('/src/services/demo.ts')).loadDemoData());
  await page.waitForTimeout(800);
  await playServer(page, N);
  await page.evaluate(async () => (await import('/src/services/whatsapp.ts')).refreshWa());
  const cdp = await ctx.newCDPSession(page);
  const top = () => page.locator('.screen[data-role="top"]');
  const go = async (hash) => {
    await page.evaluate((h) => (window.location.hash = h), hash);
    await page.waitForTimeout(900);
  };
  await go('#/whatsapp');
  await top().locator('[data-wa-chat]').first().waitFor();
  await page.waitForTimeout(800);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });

  /**
   * A finger's tap on `sel` — down, held 90 ms as a finger is, up (the browser's own touch events) — timed in the page from
   * the events' own moments: the finger down → the frame after it (the visible answer: the row lit); the tap (its click) →
   * `until()` true and drawn.
   */
  const timed = async (sel, until) => {
    await page.evaluate((until) => {
      const check = new Function(`return (${until})()`);
      window.__timed = new Promise((res) => {
        let tap = 0;
        document.addEventListener('pointerdown', (e) => requestAnimationFrame(() => requestAnimationFrame(() => (tap = performance.now() - e.timeStamp))), { capture: true, once: true });
        document.addEventListener(
          'click',
          (e) => {
            const t0 = e.timeStamp;
            const tick = () => (check() && tap ? requestAnimationFrame(() => res({ tap, done: performance.now() - t0 })) : requestAnimationFrame(tick));
            tick();
          },
          { capture: true, once: true },
        );
      });
    }, until);
    const box = await page.locator(`.screen[data-role="top"] ${sel}`).first().boundingBox();
    const at = { x: Math.round(box.x + 60), y: Math.round(box.y + box.height / 2) };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await page.waitForTimeout(90);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return page.evaluate(() => window.__timed);
  };
  const fieldThere = `() => { const f = document.querySelector('.screen[data-role="top"] ~ * [data-wa-field], .screen[data-role="top"] [data-wa-field]'); return !!f && !!document.querySelector('.screen[data-role="top"] [data-wa-list]') && f.getBoundingClientRect().height > 0; }`;

  const taps = [];
  const opens = [];
  const reopens = [];
  for (let i = 0; i < TIMES; i++) {
    // The first time each round: the chat's messages forgotten — asked of the server again.
    await page.evaluate(async () => {
      const wa = await import('/src/services/whatsapp.ts');
      const s = wa.waStore();
      delete s.messages[window.__A];
      delete s.meta[window.__A];
    });
    const first = await timed('[data-wa-chat]', fieldThere);
    taps.push(first.tap);
    opens.push(first.done);
    await page.waitForTimeout(1500);
    await page.goBack();
    await top().locator('[data-wa-chat]').first().waitFor();
    await page.waitForTimeout(1200);
    const again = await timed('[data-wa-chat]', fieldThere);
    taps.push(again.tap);
    reopens.push(again.done);
    await page.waitForTimeout(1500);
    if (i < TIMES - 1) {
      await page.goBack();
      await top().locator('[data-wa-chat]').first().waitFor();
      await page.waitForTimeout(1200);
    }
  }

  // Typing: a key → the next frame drawn, as the browser's own Event Timing says it (≥ 16 ms are reported; the rest — 16).
  const field = page.locator('[data-wa-field]').first();
  await field.click();
  await page.waitForTimeout(400);
  const ev0 = await page.evaluate(() => window.__ev.length);
  for (let i = 0; i < TIMES * 2; i++) {
    await page.keyboard.type('a');
    await page.waitForTimeout(250);
  }
  const keyEntries = await page.evaluate((n) => window.__ev.slice(n).filter((e) => e.name === 'keydown').map((e) => e.dur), ev0);
  const types = [...keyEntries, ...Array.from({ length: Math.max(0, TIMES * 2 - keyEntries.length) }, () => 16)];
  await field.fill('');

  // Scrolling the history: frames and long tasks.
  const scrollRun = async () => {
    await page.evaluate(() => {
      window.__frames = [];
      window.__longFrom = performance.now();
      let last = performance.now();
      const tick = (t) => {
        window.__frames.push(t - last);
        last = t;
        if (window.__framing) requestAnimationFrame(tick);
      };
      window.__framing = true;
      requestAnimationFrame(tick);
    });
    const box = await page.locator('.screen[data-role="top"] .screen-scroll').boundingBox();
    for (let i = 0; i < 3; i++) {
      await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + 300), yDistance: 700, speed: 1400, gestureSourceType: 'touch', repeatCount: 1 });
      await page.waitForTimeout(600);
    }
    for (let i = 0; i < 3; i++) {
      await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + 600), yDistance: -700, speed: 1400, gestureSourceType: 'touch', repeatCount: 1 });
      await page.waitForTimeout(400);
    }
    return page.evaluate(() => {
      window.__framing = false;
      const f = window.__frames.slice(1);
      const long = window.__long.filter((l) => l.at >= window.__longFrom);
      return { frames: f.length, within: f.filter((d) => d <= 16.7 * 1.2).length / Math.max(1, f.length), worst: Math.round(Math.max(0, ...f)), long100: long.filter((l) => l.ms >= 100).length, longest: Math.round(Math.max(0, ...long.map((l) => l.ms))) };
    });
  };
  const scroll = await scrollRun();
  const rows = await page.locator('.screen[data-role="top"] .note-row').count();

  // Messages arriving while the history is read higher up.
  await page.evaluate(() => {
    const el = document.querySelector('.screen[data-role="top"] .screen-scroll');
    el.scrollTop = Math.max(0, el.scrollTop - 1500);
  });
  await page.waitForTimeout(500);
  const m0 = await cdp.send('Performance.enable').then(() => cdp.send('Performance.getMetrics'));
  const l0 = await page.evaluate(() => window.__long.length);
  await page.evaluate(async () => {
    const { waSaid } = await import('/src/services/whatsapp.ts');
    for (let i = 0; i < 40; i++) {
      waSaid({ t: 'msg', msg: { id: `false_${window.__A}_IN${i}`, chat: window.__A, t: Date.now(), me: false, type: 'chat', text: `Coming in ${i}`, ack: 0 }, chat: null });
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  await page.waitForTimeout(800);
  const m1 = await cdp.send('Performance.getMetrics');
  const metric = (m, k) => m.metrics.find((x) => x.name === k)?.value ?? 0;
  const burst = {
    taskMs: Math.round((metric(m1, 'TaskDuration') - metric(m0, 'TaskDuration')) * 1000),
    long: await page.evaluate((n) => window.__long.slice(n).filter((l) => l.ms >= 50).length, l0),
    jump: await page.locator('[data-wa-jump]').count(),
  };

  const out = {
    base: BASE,
    cpu: SLOW,
    messages: N,
    rowsDrawn: rows,
    tapMs: { p50: pct(taps, 50), p95: pct(taps, 95) },
    openMs: { p50: pct(opens, 50), p95: pct(opens, 95) },
    reopenMs: { p50: pct(reopens, 50), p95: pct(reopens, 95) },
    typeMs: { p50: pct(types, 50), p95: pct(types, 95) },
    scroll: { ...scroll, within: `${Math.round(scroll.within * 100)} %` },
    burst,
    errors,
  };
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
