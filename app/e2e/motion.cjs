const { chromium } = require('playwright');
// Behaviour checks of the navigation stack on a phone: the screen slides (a View Transition runs),
// the back swipe from the left edge goes back, and the new-order screen opens at the top.
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

(async () => {
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 300)));
  const results = {};

  await page.goto(BASE + '#/settings?tab=data');
  await page.getByRole('button', { name: 'Загрузить демо-данные' }).click();
  await page.waitForTimeout(2500);
  await page.goto(BASE + '#/');
  await page.waitForTimeout(1200);
  results.visible = await page.evaluate(() => document.visibilityState);
  results.viewTransitions = await page.evaluate(() => typeof document.startViewTransition);

  // 1. Push: tap a job card and look for the running view-transition animations.
  await page.locator('.surface.tap').first().click();
  results.push = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const seen = { nav: null, pseudos: new Set() };
        const start = performance.now();
        const tick = () => {
          const nav = document.documentElement.dataset.nav;
          if (nav) seen.nav = nav;
          for (const a of document.getAnimations()) {
            const p = a.effect && a.effect.pseudoElement;
            if (p && p.startsWith('::view-transition')) seen.pseudos.add(p + ' ' + (a.animationName || ''));
          }
          if (performance.now() - start < 700) requestAnimationFrame(tick);
          else resolve({ nav: seen.nav, pseudos: [...seen.pseudos], hash: location.hash });
        };
        tick();
      }),
  );
  await page.waitForTimeout(600);
  const orderHash = await page.evaluate(() => location.hash);

  // 2. Back swipe from the left edge: the screen follows the finger, then the previous screen returns.
  results.swipe = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const el = document.querySelector('.page-shell');
        const touch = (type, x, y, id = 1) => {
          const t = new Touch({ identifier: id, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
          el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
        };
        touch('touchstart', 8, 400);
        let x = 8;
        const during = {};
        const step = () => {
          x += 30;
          touch('touchmove', x, 402);
          if (x === 128) during.transform = el.style.transform;
          if (x < 220) requestAnimationFrame(step);
          else {
            touch('touchend', x, 402);
            setTimeout(() => resolve({ during, afterHash: location.hash, transformAfter: el.style.transform, swiping: el.classList.contains('swiping') }), 900);
          }
        };
        requestAnimationFrame(step);
      }),
  );

  // 3. A short swipe springs back and stays on the screen.
  await page.goto(BASE + orderHash);
  await page.waitForTimeout(900);
  results.shortSwipe = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const el = document.querySelector('.page-shell');
        const touch = (type, x, y) => {
          const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
          el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
        };
        touch('touchstart', 6, 400);
        touch('touchmove', 20, 401);
        touch('touchmove', 60, 402);
        touch('touchend', 60, 402);
        setTimeout(() => resolve({ hash: location.hash, transform: el.style.transform, swiping: el.classList.contains('swiping') }), 700);
      }),
  );

  // 4. The new-order screen opens at the top with its large title in place.
  await page.goto(BASE + '#/orders/new');
  await page.waitForTimeout(900);
  results.newOrder = await page.evaluate(() => ({
    scrollY: window.scrollY,
    titleOpacity: getComputedStyle(document.querySelector('.large-title')).opacity,
    compact: document.querySelector('.nav-bar').dataset.compact,
    focused: document.activeElement && document.activeElement.tagName,
  }));

  // 5. Tab switch is a cross-fade (data-nav = tab), not a push.
  await page.goto(BASE + '#/');
  await page.waitForTimeout(800);
  await page.locator('.tab-bar a', { hasText: 'Деньги' }).click();
  results.tab = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let nav = null;
        const start = performance.now();
        const tick = () => {
          nav = document.documentElement.dataset.nav || nav;
          if (performance.now() - start < 400) requestAnimationFrame(tick);
          else resolve({ nav, hash: location.hash });
        };
        tick();
      }),
  );

  console.log(JSON.stringify(results, null, 2));
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => {
  console.error('MOTION FAILED:', String((e && e.message) || e).split('\n')[0]);
  process.exit(1);
});
