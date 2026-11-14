const { chromium } = require('playwright');
// Behaviour checks of the phone navigation stack: push slides the new screen in over the old one,
// "Back" and the edge swipe return to the very same previous screen (state and scroll kept), a short
// swipe springs back, tab switches cross-fade, the tab bar never moves, the keyboard hides it, and
// the document itself never scrolls.
// Usage: start the dev server (npm run dev -- --port 5173), then: node e2e/motion.cjs
const BASE = process.env.BASE_URL || 'http://localhost:5173/';

async function launchBrowser() {
  for (const channel of ['chromium', 'chrome', 'msedge']) {
    try {
      return await chromium.launch(channel === 'chromium' ? {} : { channel });
    } catch {
      // next
    }
  }
  throw new Error('no browser');
}

const fails = [];
const check = (name, ok, detail) => {
  console.log(ok ? 'OK  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail));
  if (!ok) fails.push(name);
};

(async () => {
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 300)));

  await page.goto(BASE + '#/settings?tab=data');
  await page.getByRole('button', { name: 'Загрузить демо-данные' }).click();
  await page.waitForTimeout(2000);
  // The board is one compact row per car: a few more cars make it longer than the screen.
  await page.evaluate(async () => {
    const { checkIn } = await import('/src/services/orders.ts');
    for (let k = 0; k < 9; k++) await checkIn({ plate: { emirate: 'DXB', code: 'M', number: String(40000 + k) }, make: 'Toyota', model: 'Yaris', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
  });
  await page.goto(BASE + '#/');
  await page.waitForTimeout(1200);

  const screens = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.stack > .screen')].map((s) => ({
        role: s.dataset.role,
        title: s.querySelector('.large-title')?.textContent?.trim().slice(0, 24),
        x: Math.round(s.getBoundingClientRect().left),
        vis: getComputedStyle(s).visibility,
      })),
    );
  const tabBarY = () => page.evaluate(() => Math.round(document.querySelector('.tab-bar-wrap').getBoundingClientRect().top));
  const docScroll = () => page.evaluate(() => ({ y: window.scrollY, h: document.scrollingElement.scrollHeight, vh: innerHeight }));

  // 1. Board scrolled down, then open a job: the new screen slides in from the right.
  await page.evaluate(() => document.querySelector('.screen[data-role="top"] .screen-scroll').scrollTo(0, 420));
  await page.waitForTimeout(200);
  const barBefore = await tabBarY();
  await page.locator('.screen[data-role="top"] .job-row').last().click();
  const mid = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const xs = [];
        const t0 = performance.now();
        const tick = () => {
          const top = document.querySelector('.stack > .screen[data-role="top"]');
          xs.push(Math.round(top.getBoundingClientRect().left));
          if (performance.now() - t0 < 900) requestAnimationFrame(tick);
          else resolve(xs);
        };
        tick();
      }),
  );
  check('push: new screen slides in from the right', mid.some((x) => x > 100) && mid[mid.length - 1] === 0, mid);
  await page.waitForTimeout(200);
  // Where the board was when the job opened (Playwright scrolls the card into view before tapping it).
  const boardScroll = await page.evaluate(() => Math.round(document.querySelector('.stack > .screen[data-role="below"] .screen-scroll').scrollTop));
  const afterPush = await screens();
  check('push: board stays mounted underneath, hidden', afterPush.length === 2 && afterPush[0].role === 'below' && afterPush[0].vis === 'hidden' && afterPush[1].role === 'top', afterPush);
  check('push: tab bar did not move', (await tabBarY()) === barBefore, { barBefore, now: await tabBarY() });

  // 2. Back button: the board returns at the same scroll position, without reloading.
  await page.locator('.screen[data-role="top"] .nav-back').click();
  await page.waitForTimeout(700);
  const back = await page.evaluate(() => ({
    hash: location.hash,
    scroll: Math.round(document.querySelector('.screen[data-role="top"] .screen-scroll').scrollTop),
    title: document.querySelector('.screen[data-role="top"] .large-title')?.textContent,
    leaving: document.querySelectorAll('.stack > .screen[data-role="out"]').length,
  }));
  // (Scroll anchoring may shift it a little when a card above changed meanwhile: the same cards stay in view.)
  check('back: board again, scroll position kept', back.hash === '#/' && back.title === 'Мастерская' && back.leaving === 0 && boardScroll > 50 && Math.abs(back.scroll - boardScroll) < 40, { ...back, boardScroll });

  // 3. Edge swipe: the previous screen is visible under the finger and becomes the screen.
  await page.locator('.screen[data-role="top"] .job-row').first().click();
  await page.waitForTimeout(800);
  const swipe = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const root = document.querySelector('.stack');
        const touch = (type, x, y) => {
          const t = new Touch({ identifier: 7, target: root, clientX: x, clientY: y, pageX: x, pageY: y });
          root.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
        };
        touch('touchstart', 6, 420);
        let x = 6;
        const during = {};
        const step = () => {
          x += 30;
          touch('touchmove', x, 421);
          if (x >= 156 && !during.prev) {
            const prev = document.querySelector('.stack > .screen[data-role="below"]');
            const top = document.querySelector('.stack > .screen[data-role="top"]');
            during.prev = { vis: getComputedStyle(prev).visibility, left: Math.round(prev.getBoundingClientRect().left), title: prev.querySelector('.large-title')?.textContent };
            during.top = Math.round(top.getBoundingClientRect().left);
          }
          if (x < 230) requestAnimationFrame(step);
          else {
            touch('touchend', x, 421);
            setTimeout(
              () =>
                resolve({
                  during,
                  hash: location.hash,
                  title: document.querySelector('.stack > .screen[data-role="top"] .large-title')?.textContent,
                  leaving: document.querySelectorAll('.stack > .screen[data-role="out"]').length,
                }),
              900,
            );
          }
        };
        requestAnimationFrame(step);
      }),
  );
  check('swipe: previous screen shows under the finger', swipe.during.prev && swipe.during.prev.vis === 'visible' && swipe.during.prev.left < 0 && swipe.during.top > 100, swipe.during);
  check('swipe: lands on the board', swipe.hash === '#/' && swipe.title === 'Мастерская' && swipe.leaving === 0, swipe);

  // 4. A short swipe springs back.
  await page.locator('.screen[data-role="top"] .job-row').first().click();
  await page.waitForTimeout(800);
  const orderHash = await page.evaluate(() => location.hash);
  const short = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const root = document.querySelector('.stack');
        const touch = (type, x, y) => {
          const t = new Touch({ identifier: 8, target: root, clientX: x, clientY: y, pageX: x, pageY: y });
          root.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
        };
        touch('touchstart', 6, 400);
        setTimeout(() => touch('touchmove', 30, 401), 60);
        setTimeout(() => touch('touchmove', 70, 402), 160);
        setTimeout(() => touch('touchend', 70, 402), 400);
        setTimeout(() => {
          const top = document.querySelector('.stack > .screen[data-role="top"]');
          const prev = document.querySelector('.stack > .screen[data-role="below"]');
          resolve({ hash: location.hash, left: Math.round(top.getBoundingClientRect().left), prevVis: prev && getComputedStyle(prev).visibility });
        }, 1100);
      }),
  );
  check('short swipe: springs back, stays', short.hash === orderHash && short.left === 0 && short.prevVis === 'hidden', short);

  // 5. Tab switch: a cross-fade, a fresh stack.
  await page.locator('.tab-bar button', { hasText: 'Деньги' }).click();
  await page.waitForTimeout(500);
  const tab = await page.evaluate(() => ({ hash: location.hash, screens: document.querySelectorAll('.stack > .screen').length }));
  check('tab: money, one screen', tab.hash.startsWith('#/money') && tab.screens === 1, tab);

  // 6. New job: presented from the bottom, the tab bar steps away, the keyboard field is focused.
  await page.locator('.tab-plus').click();
  const present = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const ys = [];
        const t0 = performance.now();
        const tick = () => {
          const top = document.querySelector('.stack > .screen[data-role="top"]');
          ys.push(Math.round(top.getBoundingClientRect().top));
          if (performance.now() - t0 < 700) requestAnimationFrame(tick);
          else resolve(ys);
        };
        tick();
      }),
  );
  check('new job: rises from the bottom', present.some((y) => y > 200) && present[present.length - 1] === 0, present);
  await page.waitForTimeout(300);
  const barHidden = await page.evaluate(() => getComputedStyle(document.querySelector('.tab-bar-wrap')).transform !== 'none');
  check('new job: tab bar steps away', barHidden, {});

  // 7. The round "×" of "New job": dismissed down to money.
  await page.locator('.screen[data-role="top"] .nav-close').click();
  await page.waitForTimeout(700);
  check('new job: dismissed back to money', (await page.evaluate(() => location.hash)).startsWith('#/money'), {});

  // 8. The document never scrolls; the board scrolls inside its screen.
  await page.locator('.tab-bar button', { hasText: 'Доска' }).click();
  await page.waitForTimeout(500);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(400);
  const ds = await docScroll();
  check('document never scrolls', ds.y === 0, ds);
  check('tab bar at the bottom edge', (await tabBarY()) >= 844 - 50 - 40, { y: await tabBarY() });

  // 9. Deep link: "Back" with nothing behind goes to the board (as a pop).
  await page.goto(BASE + orderHash);
  await page.waitForTimeout(1000);
  await page.locator('.screen[data-role="top"] .nav-back').click();
  await page.waitForTimeout(700);
  check('deep link back: board', (await page.evaluate(() => location.hash)) === '#/', {});

  // 10. Horizontal overflow: nothing wider than the screen on the main screens.
  const wide = [];
  for (const h of ['#/', '#/search?q=' + encodeURIComponent('масло'), '#/money', '#/more', '#/customers', '#/settings', '#/orders/new', orderHash, orderHash + '?tab=work']) {
    await page.goto(BASE + h);
    await page.waitForTimeout(700);
    const w = await page.evaluate(() => {
      const s = document.querySelector('.screen[data-role="top"] .screen-scroll');
      return { sw: s.scrollWidth, cw: s.clientWidth, doc: document.documentElement.scrollWidth, vw: innerWidth };
    });
    if (w.sw > w.cw + 1 || w.doc > w.vw + 1) wide.push({ h, ...w });
  }
  check('no horizontal overflow', wide.length === 0, wide);

  // 12. The tab bar under the finger (real touches through CDP, as a finger does them): the lens is
  //     under the finger at every move — slow, a pause, back again; only the tab where the finger lets
  //     go opens, once; a fast sweep opens only its last tab; a cancelled or abandoned slide opens
  //     nothing; a press catches the lens mid-flight; a tap is still a tap.
  await page.goto(BASE + '#/');
  await page.waitForTimeout(900);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }] });
  const lensX = () => page.evaluate(() => { const r = document.querySelector('.tab-lens').getBoundingClientRect(); return Math.round(r.left + r.width / 2); });
  const [tBoard, tSearch, tMoney, tMore] = await page.evaluate(() => [...document.querySelectorAll('.tab-bar button[data-href]')].map((b) => { const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }));
  const ty = tBoard.y;
  await page.evaluate(() => {
    window.__routes = [];
    const push = history.pushState.bind(history);
    history.pushState = (a, b, c) => { push(a, b, c); window.__routes.push(location.hash); };
    addEventListener('pointerdown', () => { const r = document.querySelector('.tab-lens').getBoundingClientRect(); window.__atPress = Math.round(r.left + r.width / 2); }, { capture: true });
  });
  const routes = async () => page.evaluate(() => window.__routes.splice(0));
  /** Slide in small steps; after the 8 px slop, how far the lens was from the finger at worst. */
  const glide = async (from, to, ms, y = ty) => {
    const steps = Math.max(2, Math.round(ms / 16));
    let worst = 0;
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(from + ((to - from) * i) / steps);
      await touch('touchMove', x, y);
      await page.waitForTimeout(ms / steps);
      worst = Math.max(worst, Math.abs((await lensX()) - x));
    }
    return worst;
  };
  await touch('touchStart', tBoard.x, ty);
  await touch('touchMove', tBoard.x + 10, ty);
  // The 8 px the finger moved before it was a slide melt away in ~200 ms; from then on the lens is the finger.
  const catchUp = await glide(tBoard.x + 10, tBoard.x + 30, 250);
  const slowGap = await glide(tBoard.x + 30, tMoney.x, 800);
  const between = Math.round((tSearch.x + tMoney.x) / 2);
  const backGap = await glide(tMoney.x, between, 250);
  await page.waitForTimeout(450);
  const pauseGap = Math.abs((await lensX()) - between);
  const reverseGap = await glide(between, tSearch.x, 300);
  const midRoutes = await routes();
  await touch('touchEnd');
  await page.waitForTimeout(800);
  const slow = { catchUp, slowGap, backGap, pauseGap, reverseGap, midRoutes, routes: await routes(), lens: await lensX(), search: tSearch.x };
  check('tab bar: lens under the finger (slow, pause, back), nothing opens mid-slide', catchUp <= 12 && slowGap <= 1 && backGap <= 1 && pauseGap <= 1 && reverseGap <= 1 && midRoutes.length === 0, slow);
  check('tab bar: release opens only that tab, once; lens settles on it', slow.routes.join() === '#/search' && Math.abs(slow.lens - tSearch.x) <= 1, slow);

  await touch('touchStart', tSearch.x, ty);
  await glide(tSearch.x, tMore.x, 120);
  await glide(tMore.x, tMoney.x, 80);
  await touch('touchEnd');
  await page.waitForTimeout(800);
  const fast = { routes: await routes(), lens: await lensX(), money: tMoney.x };
  check('tab bar: a fast sweep opens only the tab of release', fast.routes.join() === '#/money' && Math.abs(fast.lens - tMoney.x) <= 1, fast);

  await touch('touchStart', tMoney.x, ty);
  await glide(tMoney.x, tBoard.x, 300);
  await touch('touchCancel');
  await page.waitForTimeout(800);
  const cancelled = { routes: await routes(), lens: await lensX(), hash: await page.evaluate(() => location.hash) };
  check('tab bar: a cancelled slide opens nothing, the lens goes home', cancelled.routes.length === 0 && cancelled.hash === '#/money' && Math.abs(cancelled.lens - tMoney.x) <= 1, cancelled);

  await touch('touchStart', tMoney.x, ty);
  await glide(tMoney.x, tBoard.x, 250);
  await glide(tBoard.x, tBoard.x, 32, ty - 170);
  await touch('touchEnd');
  await page.waitForTimeout(800);
  const abandoned = { routes: await routes(), lens: await lensX() };
  check('tab bar: let go far off the bar — nothing opens', abandoned.routes.length === 0 && Math.abs(abandoned.lens - tMoney.x) <= 1, abandoned);

  await touch('touchStart', tBoard.x, ty);
  await touch('touchEnd');
  await page.waitForTimeout(50);
  const flying = await lensX();
  await touch('touchStart', flying, ty);
  await page.waitForTimeout(60);
  const caught = { flying, atPress: await page.evaluate(() => window.__atPress), held: await lensX() };
  await page.waitForTimeout(120);
  caught.stillHeld = await lensX();
  await glide(flying, tMore.x, 300);
  caught.endGap = Math.abs((await lensX()) - tMore.x);
  await touch('touchEnd');
  await page.waitForTimeout(800);
  Object.assign(caught, { offset: caught.atPress - flying, routes: await routes(), lens: await lensX() });
  // Motion fixes the lens at its own frame time: at most a frame of travel (a few px) past where the finger met it.
  check('tab bar: a press catches the lens mid-flight and holds it', flying > tBoard.x + 10 && flying < tMoney.x - 10 && Math.abs(caught.held - caught.atPress) <= 4 && Math.abs(caught.stillHeld - caught.held) <= 0.5, caught);
  check('tab bar: the caught lens comes under the finger and follows; the release tab opens', caught.endGap <= 1 && caught.routes.join() === '#/,#/more' && Math.abs(caught.lens - tMore.x) <= 1, caught);

  await touch('touchStart', tSearch.x, ty);
  await touch('touchMove', tSearch.x + 4, ty);
  await touch('touchEnd');
  await page.waitForTimeout(700);
  const tap = { routes: await routes(), lens: await lensX() };
  check('tab bar: a tap (under the slop) still opens its tab', tap.routes.join() === '#/search' && Math.abs(tap.lens - tSearch.x) <= 1, tap);

  // A quick flick, then a tap at once: Chrome must not take the flick for a fling and swallow the tap.
  await touch('touchStart', tSearch.x, ty);
  for (const x of [tSearch.x - 25, tSearch.x - 50, tBoard.x]) {
    await touch('touchMove', x, ty);
    await page.waitForTimeout(8);
  }
  await touch('touchEnd');
  await page.waitForTimeout(200);
  await touch('touchStart', tMoney.x, ty);
  await touch('touchEnd');
  await page.waitForTimeout(600);
  const flickTap = { routes: await routes() };
  check('tab bar: a tap right after a quick flick is not swallowed', flickTap.routes.join() === '#/,#/money', flickTap);

  // Pressed on the lens but off its centre, then a slow slide: it centres under the finger (the tint,
  // the lens and the tab that opens agree).
  const lensNow = await lensX();
  await touch('touchStart', lensNow + 30, ty);
  const offCentreCatch = await glide(lensNow + 30, lensNow + 10, 220);
  const offCentre = { catch: offCentreCatch, gap: await glide(lensNow + 10, tBoard.x, 500) };
  offCentre.tinted = await page.evaluate(() => document.querySelector('.tab-bar button[data-hover]')?.dataset.href);
  await touch('touchEnd');
  await page.waitForTimeout(800);
  Object.assign(offCentre, { routes: await routes(), lens: await lensX() });
  check('tab bar: pressed off the lens centre — it comes under the finger, the tab under both opens', offCentre.gap <= 1 && offCentre.tinted === '/' && offCentre.routes.join() === '#/' && Math.abs(offCentre.lens - tBoard.x) <= 1, offCentre);

  // Pressed on another tab (not the lens), then a slide: the lens comes to the finger and stays under it.
  await touch('touchStart', tMore.x, ty);
  await glide(tMore.x, tMore.x - 40, 220);
  const offLens = { gap: await glide(tMore.x - 40, tSearch.x, 500) };
  await touch('touchEnd');
  await page.waitForTimeout(800);
  Object.assign(offLens, { routes: await routes(), lens: await lensX() });
  check('tab bar: pressed off the lens — it comes under the finger and follows', offLens.gap <= 1 && offLens.routes.join() === '#/search' && Math.abs(offLens.lens - tSearch.x) <= 1, offLens);

  // A form with unsaved edits: a slide to another tab asks first, as a tapped tab does; nothing opens until "Leave".
  await page.evaluate(() => (location.hash = '#/settings'));
  await page.waitForTimeout(900);
  await page.locator('.screen[data-role="top"] input:not([type]), .screen[data-role="top"] input[type="text"]').first().fill('Garage edited');
  await page.waitForTimeout(300);
  await routes();
  await touch('touchStart', tMore.x, ty);
  await glide(tMore.x, tMoney.x, 400);
  await touch('touchEnd');
  await page.waitForTimeout(700);
  const unsaved = { asked: await page.getByText('Уйти без сохранения?').isVisible(), routes: (await routes()).filter((r) => !r.startsWith('#/settings')), lens: await lensX(), hash: await page.evaluate(() => location.hash) };
  check('tab bar: a slide with unsaved edits asks first, opens nothing', unsaved.asked && unsaved.routes.length === 0 && unsaved.hash.startsWith('#/settings') && Math.abs(unsaved.lens - tMore.x) <= 1, unsaved);
  await page.getByRole('button', { name: 'Уйти', exact: true }).click();
  await page.waitForTimeout(700);
  const left = { routes: await routes(), lens: await lensX() };
  check('tab bar: "Leave" then opens the tab of the slide', left.routes.join() === '#/money' && Math.abs(left.lens - tMoney.x) <= 1, left);

  // Reduce Motion: no spring, no swell — a short plain settle (≤150 ms); the finger still drags the lens 1:1.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await touch('touchStart', tSearch.x, ty);
  await touch('touchEnd');
  await page.waitForTimeout(250);
  const rm = { tapLens: await lensX() };
  await touch('touchStart', tSearch.x, ty);
  await glide(tSearch.x, tSearch.x + 30, 250);
  rm.gap = await glide(tSearch.x + 30, tMoney.x, 400);
  rm.scale = await page.evaluate(() => { const r = document.querySelector('.tab-lens').getBoundingClientRect(); const b = document.querySelector('.tab-bar').getBoundingClientRect(); return Math.round((r.height / (b.height - 4)) * 100) / 100; });
  await touch('touchEnd');
  await page.waitForTimeout(250);
  Object.assign(rm, { releaseLens: await lensX(), routes: await routes() });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('tab bar: Reduce Motion — short settle, no swell, still follows the finger', Math.abs(rm.tapLens - tSearch.x) <= 1 && rm.scale === 1 && rm.gap <= 1 && Math.abs(rm.releaseLens - tMoney.x) <= 1 && rm.routes.join() === '#/search,#/money', rm);

  // A second tap while the lens is still flying bends its path at the speed it has (no stop-and-go): a frame or
  // two after the new aim it moves at least as fast as before it (a stop would start again from ~0 px a frame).
  await touch('touchStart', tBoard.x, ty);
  await touch('touchEnd');
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__track = [];
    const l = document.querySelector('.tab-lens');
    const t0 = performance.now();
    const tick = () => {
      const r = l.getBoundingClientRect();
      window.__track.push([performance.now() - t0, r.left + r.width / 2]);
      if (performance.now() - t0 < 900) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    addEventListener('pointerdown', () => (window.__second = performance.now() - t0), { capture: true });
  });
  await touch('touchStart', tSearch.x, ty);
  await touch('touchEnd');
  await page.waitForTimeout(90);
  await page.evaluate(() => (window.__second = undefined));
  await touch('touchStart', tMore.x, ty);
  await touch('touchEnd');
  await page.waitForTimeout(900);
  const bend = await page.evaluate(() => {
    const at = window.__second;
    const after = window.__track.filter(([t]) => t >= at).slice(0, 6);
    const steps = after.slice(1).map(([, x], k) => Math.round((x - after[k][1]) * 10) / 10);
    return { at: Math.round(at), steps, end: Math.round(window.__track[window.__track.length - 1][1]) };
  });
  await routes();
  check('tab bar: a second tap mid-flight keeps the lens moving (no stop-and-go)', bend.steps.length >= 5 && (bend.steps[2] + bend.steps[3] + bend.steps[4]) / 3 >= 0.8 * bend.steps[0] && Math.abs(bend.end - tMore.x) <= 1, bend);

  // A sloppy tap (a few px of slide that never left the tab) on the lit tab from a deeper screen: back to the
  // tab's first screen, as a clean tap does.
  await touch('touchStart', tBoard.x, ty);
  await touch('touchEnd');
  await page.waitForTimeout(900);
  await page.locator('.screen[data-role="top"] .job-row').first().click();
  await page.waitForTimeout(900);
  const deeper = await page.evaluate(() => location.hash);
  await touch('touchStart', tBoard.x - 8, ty);
  await glide(tBoard.x - 8, tBoard.x + 8, 120);
  await touch('touchEnd');
  await page.waitForTimeout(800);
  const sloppy = { deeper, hash: await page.evaluate(() => location.hash) };
  await routes();
  check('tab bar: a sloppy tap on the lit tab goes back to its first screen', sloppy.deeper.startsWith('#/orders/') && sloppy.hash === '#/', sloppy);

  // 13. One action per confirmation: two taps on "Accept" before the screen re-renders make one job.
  await page.goto(BASE + '#/orders/new');
  await page.waitForTimeout(800);
  await page.locator('.screen[data-role="top"]').getByLabel('Номер').fill('86420');
  const jobsBefore = await page.evaluate(async () => (await import('/src/db/db.ts')).db.orders.count());
  await page.evaluate(() => {
    const accept = [...document.querySelectorAll('.screen[data-role="top"] button')].find((b) => b.textContent.trim() === 'Принять');
    accept.click();
    accept.click();
  });
  await page.waitForTimeout(1200);
  const twice = { added: (await page.evaluate(async () => (await import('/src/db/db.ts')).db.orders.count())) - jobsBefore, hash: await page.evaluate(() => location.hash) };
  check('double tap on Accept: one job', twice.added === 1 && twice.hash.startsWith('#/orders/'), twice);

  // 11. Safari in a tab (not installed): the edge swipe is Safari's own, and going back after it
  //     does not play a second animation.
  const iphone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'ru-RU',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  });
  const sp = await iphone.newPage();
  sp.on('pageerror', (e) => errors.push('pageerror (iphone): ' + e.message));
  await sp.goto(BASE + '#/settings?tab=data');
  await sp.getByRole('button', { name: 'Загрузить демо-данные' }).click();
  await sp.waitForTimeout(1500);
  await sp.goto(BASE + '#/');
  await sp.waitForTimeout(1000);
  await sp.locator('.screen[data-role="top"] .job-row').first().click();
  await sp.waitForTimeout(800);
  const safari = await sp.evaluate(
    () =>
      new Promise((resolve) => {
        const ios = document.documentElement.classList.contains('ios') && !document.documentElement.classList.contains('standalone');
        const root = document.querySelector('.stack');
        const touch = (type, x, y) => {
          const t = new Touch({ identifier: 9, target: root, clientX: x, clientY: y, pageX: x, pageY: y });
          root.dispatchEvent(new TouchEvent(type, { touches: type === 'touchmove' || type === 'touchstart' ? [t] : [], changedTouches: [t], bubbles: true, cancelable: true }));
        };
        touch('touchstart', 6, 420);
        touch('touchmove', 60, 421);
        touch('touchmove', 120, 422);
        const top = document.querySelector('.stack > .screen[data-role="top"]');
        const moved = Math.round(top.getBoundingClientRect().left);
        // Safari's gesture takes the touch and goes back itself.
        touch('touchcancel', 120, 422);
        history.back();
        setTimeout(() => {
          const leaving = document.querySelector('.stack > .screen[data-role="out"]');
          resolve({ ios, moved, hash: location.hash, animating: !!leaving && leaving.getAnimations().length > 0 });
        }, 120);
      }),
  );
  check('safari tab: edge swipe left to Safari, no second animation', safari.ios && safari.moved === 0 && safari.hash === '#/' && !safari.animating, safari);
  await iphone.close();

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => {
  console.error('MOTION FAILED:', String((e && e.message) || e).split('\n')[0]);
  process.exit(1);
});
