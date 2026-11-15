const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
/*
 * The same finger gestures on a phone-sized screen (iPhone 13, touch), recorded frame by frame (the browser's
 * screencast, the finger drawn as a circle) and measured — to compare a build before and after a change
 * (AGENTS.md, "Стандарт качества MyGarage"). No ffmpeg needed: `node e2e/gesture-player.cjs` turns the frames of
 * two builds into one page that plays the same gestures side by side.
 * Usage: start the dev server (npm run dev -- --port 5173), then: node e2e/gestures.cjs <outDir> [label]
 * (GESTURES=board-return,tabbar-slow — only those).
 * Writes <label>-<gesture>.frames.json and <label>-gestures.json (where the tab bar's lens was under the finger,
 * which tabs opened).
 */
const OUT = process.argv[2] || path.join(__dirname, '..', 'test-results', 'gestures');
const LABEL = process.argv[3] || 'now';
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const ONLY = process.env.GESTURES ? process.env.GESTURES.split(',') : null;
fs.mkdirSync(OUT, { recursive: true });

async function launch() {
  for (const channel of process.env.E2E_BROWSER ? [process.env.E2E_BROWSER] : ['chromium', 'chrome', 'msedge']) {
    try {
      return await chromium.launch(channel === 'chromium' ? {} : { channel });
    } catch {
      /* next */
    }
  }
  throw new Error('no browser');
}

(async () => {
  const browser = await launch();
  const results = {};
  const errors = [];
  // A fresh context per gesture: one recording each.
  async function gesture(name, fn) {
    if (ONLY && !ONLY.includes(name)) return;
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      locale: 'ru-RU',
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
    await page.goto(BASE + '#/settings?tab=data');
    await page.getByRole('button', { name: 'Загрузить демо-данные' }).click();
    await page.getByText('Демо-данные загружены').first().waitFor({ timeout: 20000 });
    await page.goto(BASE + '#/');
    await page.locator('.tab-bar').waitFor();
    await page.waitForTimeout(800);
    const cdp = await ctx.newCDPSession(page);
    // The finger, drawn: a soft circle where the touch is (pointer-events: none — it takes nothing).
    await page.evaluate(() => {
      const dot = document.createElement('div');
      dot.style.cssText = 'position:fixed;z-index:99999;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,59,48,.28);box-shadow:0 0 0 2px rgba(255,59,48,.75);pointer-events:none;opacity:0;left:0;top:0';
      document.body.appendChild(dot);
      const at = (e) => {
        const t = e.touches[0];
        if (!t) return;
        dot.style.left = t.clientX + 'px';
        dot.style.top = t.clientY + 'px';
        dot.style.opacity = '1';
      };
      const off = () => (dot.style.opacity = '0');
      addEventListener('touchstart', at, { capture: true, passive: true });
      addEventListener('touchmove', at, { capture: true, passive: true });
      // How far the lens is from the finger at every move (pointer events are handled before touch events).
      addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        const lens = document.querySelector('.tab-lens');
        if (!t || !lens || !window.__gaps) return;
        const x = t.clientX;
        // Measured in the frame the move is drawn in (after the app's own frame callbacks), not before it.
        requestAnimationFrame(() => {
          const r = lens.getBoundingClientRect();
          window.__gaps.push(Math.round(Math.abs(r.left + r.width / 2 - x)));
        });
      }, { capture: true, passive: true });
      addEventListener('touchend', off, { capture: true, passive: true });
      addEventListener('touchcancel', off, { capture: true, passive: true });
    });
    const frames = [];
    cdp.on('Page.screencastFrame', (f) => {
      frames.push({ t: f.metadata.timestamp, data: f.data });
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 50, maxWidth: 300, maxHeight: 650, everyNthFrame: 2 });
    await page.waitForTimeout(300);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }] });
    // Where the tabs are; the lens and the open tab sampled every frame; every navigation counted.
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.tab-bar button[data-href]')].map((b) => { const r = b.getBoundingClientRect(); return { href: b.dataset.href, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }));
    await page.evaluate(() => {
      // Every route change counted (HashRouter moves by pushState, which fires no hashchange).
      window.__nav = [];
      window.__gaps = [];
      for (const k of ['pushState', 'replaceState']) {
        const orig = history[k].bind(history);
        history[k] = (st, title, url) => {
          orig(st, title, url);
          window.__nav.push((k === 'pushState' ? 'push ' : 'replace ') + location.hash);
        };
      }
      window.addEventListener('popstate', () => window.__nav.push('pop ' + location.hash));
      window.__lens = [];
      const lens = document.querySelector('.tab-lens');
      const t0 = performance.now();
      const tick = () => {
        const r = lens.getBoundingClientRect();
        window.__lens.push([Math.round(performance.now() - t0), Math.round(r.left + r.width / 2)]);
        if (window.__lens.length < 2400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const res = await fn({ page, touch, tabs });
    res.navigations = await page.evaluate(() => window.__nav);
    res.hash = await page.evaluate(() => location.hash);
    // (A gesture away from the tab bar turns the lens measure off: window.__gaps = null.)
    const gaps = ((await page.evaluate(() => window.__gaps)) || []).slice().sort((x, y) => x - y);
    if (gaps.length) res.lensFromFinger = { moves: gaps.length, median: gaps[gaps.length >> 1], max: gaps[gaps.length - 1] };
    results[name] = res;
    await page.waitForTimeout(600);
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    const t0 = frames.length ? frames[0].t : 0;
    fs.writeFileSync(path.join(OUT, `${LABEL}-${name}.frames.json`), JSON.stringify(frames.map((f) => ({ ms: Math.round((f.t - t0) * 1000), data: f.data }))));
    await ctx.close();
  }
  const lensAt = (page) => page.evaluate(() => { const r = document.querySelector('.tab-lens').getBoundingClientRect(); return Math.round(r.left + r.width / 2); });
  const slide = async (touch, page, y, from, to, ms) => {
    const steps = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', from + ((to - from) * i) / steps, y);
      await page.waitForTimeout(ms / steps);
    }
  };

  // 1. Press "Board", lead slowly to "Money", hold between them, come back, let go on "Search".
  await gesture('tabbar-slow', async ({ page, touch, tabs }) => {
    const [board, search, money] = tabs;
    const y = board.y;
    const out = { underFinger: [] };
    await touch('touchStart', board.x, y);
    await page.waitForTimeout(120);
    await slide(touch, page, y, board.x, money.x, 900);
    out.underFinger.push({ finger: Math.round(money.x), lens: await lensAt(page) });
    const between = (search.x + money.x) / 2;
    await slide(touch, page, y, money.x, between, 300);
    await page.waitForTimeout(500);
    out.underFinger.push({ finger: Math.round(between), lens: await lensAt(page), held: true });
    await slide(touch, page, y, between, search.x, 400);
    out.underFinger.push({ finger: Math.round(search.x), lens: await lensAt(page) });
    await touch('touchEnd');
    await page.waitForTimeout(700);
    out.lensAfter = await lensAt(page);
    out.expectTab = search.href;
    return out;
  });

  // 2. A fast sweep across every tab and back to "Money": only "Money" opens.
  await gesture('tabbar-fast', async ({ page, touch, tabs }) => {
    const [board, , money, more] = tabs;
    const y = board.y;
    await touch('touchStart', board.x, y);
    await slide(touch, page, y, board.x, more.x, 160);
    await slide(touch, page, y, more.x, money.x, 100);
    await touch('touchEnd');
    await page.waitForTimeout(700);
    return { expectTab: money.href, lensAfter: await lensAt(page), moneyX: Math.round(money.x) };
  });

  // 3. A drag the system takes over (touchcancel): nothing opens, the lens goes home.
  await gesture('tabbar-cancel', async ({ page, touch, tabs }) => {
    const [board, , money] = tabs;
    const y = board.y;
    await touch('touchStart', board.x, y);
    await slide(touch, page, y, board.x, money.x, 400);
    await touch('touchCancel');
    await page.waitForTimeout(700);
    return { expectTab: board.href, lensAfter: await lensAt(page), boardX: Math.round(board.x) };
  });

  // 4. A tap on "More", then — while the lens is still on its way — a press and a drag back to "Search".
  await gesture('tabbar-interrupt', async ({ page, touch, tabs }) => {
    const [board, search, , more] = tabs;
    const y = board.y;
    // Where the lens is at the very moment of a press (before the app handles it).
    await page.evaluate(() => addEventListener('pointerdown', () => { const r = document.querySelector('.tab-lens').getBoundingClientRect(); window.__atPress = Math.round(r.left + r.width / 2); }, { capture: true }));
    await touch('touchStart', more.x, y);
    await touch('touchEnd');
    await page.waitForTimeout(120);
    const mid = await lensAt(page);
    await touch('touchStart', mid, y);
    await page.waitForTimeout(40);
    const atPress = await page.evaluate(() => window.__atPress);
    const grabbed = await lensAt(page);
    await slide(touch, page, y, mid, search.x, 400);
    const followed = await lensAt(page);
    await touch('touchEnd');
    await page.waitForTimeout(700);
    return { expectTab: search.href, lensMidFlight: mid, lensAtPress: atPress, lensHeld40ms: grabbed, lensFollowed: followed, searchX: Math.round(search.x), lensAfter: await lensAt(page) };
  });

  // 5. A press on another tab (not on the lens) and a slow slide: the lens comes under the finger and stays there.
  await gesture('tabbar-offlens', async ({ page, touch, tabs }) => {
    const [board, search, , more] = tabs;
    const y = board.y;
    await touch('touchStart', more.x, y);
    await page.waitForTimeout(120);
    await slide(touch, page, y, more.x, search.x, 900);
    const under = { finger: Math.round(search.x), lens: await lensAt(page) };
    await touch('touchEnd');
    await page.waitForTimeout(700);
    return { expectTab: search.href, under, lensAfter: await lensAt(page) };
  });

  // 6. Deep down the board: a job opened and closed with « ‹ » (only a look), then another one changed and closed
  // with the edge swipe. The board stays where it was: a look changes nothing, a changed job goes on top without
  // pulling the scroll after it. Needs the dev server (the cars are checked in through the app's own modules).
  await gesture('board-return', async ({ page, touch }) => {
    await page.evaluate(async () => {
      window.__gaps = null;
      const { checkIn } = await import('/src/services/orders.ts');
      for (let k = 0; k < 24; k++) await checkIn({ plate: { emirate: 'DXB', code: 'M', number: String(40000 + k) }, make: 'Toyota', model: 'Yaris', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    });
    await page.waitForTimeout(900);
    const scrollTop = () => page.evaluate(() => Math.round(document.querySelector('.stack > .screen[data-role="top"] .screen-scroll').scrollTop));
    const cardMid = () =>
      page.evaluate(() => {
        const c = [...document.querySelectorAll('.stack > .screen[data-role="top"] .job-row')].find((e) => { const r = e.getBoundingClientRect(); return r.top > 300 && r.bottom < 640; });
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), plate: (c.querySelector('[class*="plate"]')?.textContent || '').trim() };
      });
    const tap = async (x, y) => { await touch('touchStart', x, y); await page.waitForTimeout(60); await touch('touchEnd'); };
    const first = () => page.evaluate(() => (document.querySelector('.stack > .screen[data-role="top"] .job-row [class*="plate"]')?.textContent || '').trim());
    await page.evaluate(() => document.querySelector('.stack > .screen[data-role="top"] .screen-scroll').scrollTo(0, 2000));
    await page.waitForTimeout(500);
    // A look: open, « ‹ ».
    const look = { before: await scrollTop() };
    const a = await cardMid();
    look.opened = a.plate;
    await tap(a.x, a.y);
    await page.waitForTimeout(900);
    const back = await page.evaluate(() => { const r = document.querySelector('.stack > .screen[data-role="top"] .nav-back').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
    await tap(back.x, back.y);
    await page.waitForTimeout(1100);
    look.after = await scrollTop();
    look.onTop = await first();
    // A change: open another, the job changes (the complaint is written), the edge swipe back.
    const change = { before: await scrollTop() };
    const b = await cardMid();
    change.opened = b.plate;
    await tap(b.x, b.y);
    await page.waitForTimeout(900);
    await page.evaluate(async () => {
      const id = location.hash.match(/orders\/([^/?]+)/)[1];
      const { updateOrder } = await import('/src/services/orders.ts');
      await updateOrder(id, { complaint: 'Knock from the front left' });
    });
    await page.waitForTimeout(500);
    await touch('touchStart', 6, 420);
    await slide(touch, page, 421, 6, 300, 320);
    await touch('touchEnd');
    await page.waitForTimeout(1100);
    change.after = await scrollTop();
    change.onTop = await first();
    return { look, change };
  });

  // 7. The job's two tabs as pages: a slow drag to the left with a pause (the page under the finger), let go —
  // the notes come in beside it; a fling back to the job; a short drag let go — back home. Measured: where the
  // page was against the finger on every move, which tabs opened. (Works on a build too: no app modules.)
  await gesture('job-tabs', async ({ page, touch }) => {
    await page.evaluate(() => (window.__gaps = null));
    await page.locator('.stack > .screen[data-role="top"] .job-row').filter({ hasText: '45678' }).first().click();
    await page.waitForTimeout(1100);
    const card = await page.evaluate(() => {
      const r = document.querySelector('.stack > .screen[data-role="top"] .job-body .surface').getBoundingClientRect();
      return Math.round(r.top + Math.min(260, r.height - 40));
    });
    const pageX = () =>
      page.evaluate(() => {
        const el = document.querySelector('.stack > .screen[data-role="top"] .job-panel') || document.querySelector('.stack > .screen[data-role="top"] .job-body .surface');
        const p = el.offsetParent;
        return Math.round(el.getBoundingClientRect().left - (p.getBoundingClientRect().left + p.clientLeft + el.offsetLeft));
      });
    const tabNow = () => page.evaluate(() => (location.hash.includes('tab=notes') ? 'notes' : 'main'));
    const follow = [];
    const drag = async (from, to, ms, pauseAt) => {
      const steps = Math.max(2, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        const x = from + ((to - from) * i) / steps;
        await touch('touchMove', x, card);
        await page.waitForTimeout(16);
        if (i % 4 === 0) follow.push([Math.round(x - 300), await pageX()]);
        if (pauseAt && i === Math.round(steps / 2)) await page.waitForTimeout(pauseAt);
      }
    };
    await touch('touchStart', 300, card);
    await drag(300, 110, 900, 350);
    await touch('touchEnd');
    await page.waitForTimeout(900);
    const afterSlow = await tabNow();
    await touch('touchStart', 80, card);
    for (let i = 1; i <= 5; i++) { await touch('touchMove', 80 + i * 22, card); await page.waitForTimeout(10); }
    await touch('touchEnd');
    await page.waitForTimeout(900);
    const afterFling = await tabNow();
    await touch('touchStart', 300, card);
    await drag(300, 250, 400);
    await page.waitForTimeout(200);
    await touch('touchEnd');
    await page.waitForTimeout(900);
    return { follow, afterSlow, afterFling, afterShort: await tabNow() };
  });

  fs.writeFileSync(path.join(OUT, `${LABEL}-gestures.json`), JSON.stringify({ results, errors }, null, 1));
  console.log(JSON.stringify({ results, errors }, null, 1));
  await browser.close();
})();
