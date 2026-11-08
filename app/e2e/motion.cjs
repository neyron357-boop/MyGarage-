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
  await page.locator('.screen[data-role="top"] .surface.tap').last().click();
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
  await page.locator('.screen[data-role="top"] .surface.tap').first().click();
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
  await page.locator('.screen[data-role="top"] .surface.tap').first().click();
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

  // 7. Back from "New job": dismissed down to money.
  await page.locator('.screen[data-role="top"] .nav-back').click();
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

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => {
  console.error('MOTION FAILED:', String((e && e.message) || e).split('\n')[0]);
  process.exit(1);
});
