const { chromium } = require('playwright');

/*
 * The installed iPhone app's own history (v0.83, ui/virtualHistory.ts — the owner: «заблокировать браузерный свайп всей
 * страницы, чтобы не было как в веб-сайтах»): turned on here by `mygarage.vhistory = 1` in Chrome made a phone. The app
 * goes everywhere as before — screens, a sheet and Back, a tab, the swipe from the edge, a reload — while the browser's own
 * history never gets one page more (WebKit then has nowhere to swipe to).
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/vhistory.cjs (BASE_URL to aim elsewhere).
 */
const BASE = process.env.BASE_URL || 'http://localhost:5173/';

async function launch() {
  for (const channel of [process.env.E2E_BROWSER, undefined, 'chrome', 'msedge'].filter((x, i) => x || i === 1)) {
    try {
      return await chromium.launch(channel ? { channel } : {});
    } catch {
      // next
    }
  }
  throw new Error('no browser');
}

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await ctx.addInitScript(() => {
    localStorage.setItem('mygarage.feedback', '0');
    localStorage.setItem('mygarage.vhistory', '1');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);
  const top = (sel) => page.locator(`.screen[data-role="top"] ${sel}`);
  const check = (ok, what) => {
    if (!ok) throw new Error('vhistory e2e: ' + what);
    console.log('OK  ', what);
  };
  const real = () => page.evaluate(() => Object.getOwnPropertyDescriptor(History.prototype, 'length').get.call(history));
  const settle = (ms = 500) => page.waitForTimeout(ms);

  await page.goto(BASE + '#/settings?tab=data');
  await page.getByRole('button', { name: 'Загрузить демо-данные' }).click();
  await settle(300);
  await page.waitForFunction(() => !document.querySelector('button[data-loading]'), null, { timeout: 120000 });
  // A fresh page: the app as it starts from the Home Screen.
  const fresh = await ctx.newPage();
  await page.close();
  const p = fresh;
  p.on('pageerror', (e) => errors.push(e.message));
  const cdp2 = await ctx.newCDPSession(p);
  const T = (sel) => p.locator(`.screen[data-role="top"] ${sel}`);
  const realLen = () => p.evaluate(() => Object.getOwnPropertyDescriptor(History.prototype, 'length').get.call(history));
  const wait = (ms = 500) => p.waitForTimeout(ms);
  await p.goto(BASE + '#/');
  await T('.job-row').first().waitFor({ timeout: 60000 });
  await wait(1200);
  check(await p.evaluate(() => 'vhistory' in document.documentElement.dataset), 'the app keeps its own history (forced on)');
  const start = await realLen();

  // A job: one step of the app's, none of the browser's.
  await T('.job-row').filter({ hasText: 'Nissan Patrol' }).first().tap();
  await T('.list-row').first().waitFor();
  await wait(900);
  check((await p.evaluate(() => history.length)) === 2 && (await realLen()) === start, 'a screen opened: a step of the app, the browser stays at one page');
  check(/#\/orders\//.test(p.url()), 'the address follows the screen');

  // A sheet: Back closes it, not the job.
  await T('button.add-extra[aria-label="Поставщики"]').tap();
  await p.locator('.ask-sheet').waitFor();
  await wait(600);
  check(await p.evaluate(() => !!history.state?.mgSheet), 'an open sheet is a step of its own');
  await p.evaluate(() => history.back());
  await p.locator('.ask-sheet').waitFor({ state: 'detached' });
  await wait(600);
  check(/#\/orders\//.test(p.url()) && (await T('.list-row').count()) > 0, 'Back closes the sheet, the job stays');
  // Closed by its ×: its step goes too.
  await T('button.add-extra[aria-label="Поставщики"]').tap();
  await p.locator('.ask-sheet').waitFor();
  await wait(600);
  await p.locator('.mantine-Modal-close').first().tap();
  await p.locator('.ask-sheet').waitFor({ state: 'detached' });
  await wait(700);
  check(!(await p.evaluate(() => !!history.state?.mgSheet)) && /#\/orders\//.test(p.url()), 'closed by ×: no step of it left, the job in front');

  // «‹» — the board.
  await T('.nav-back').tap();
  await T('.job-row').first().waitFor();
  await wait(900);
  check(new URL(p.url()).hash === '#/' || new URL(p.url()).hash === '', 'the back button leads to the board');

  // Tabs.
  await p.locator('.tab-bar button', { hasText: 'Деньги' }).tap();
  await T('.tab-panel').waitFor();
  await wait(600);
  await p.locator('.tab-bar button', { hasText: 'Доска' }).tap();
  await T('.job-row').first().waitFor();
  await wait(600);
  check((await realLen()) === start, 'tabs switched: the browser still at one page');

  // The swipe from the left edge: the app's own — back to the board.
  await T('.job-row').filter({ hasText: 'Nissan Patrol' }).first().tap();
  await T('.list-row').first().waitFor();
  await wait(900);
  const y = 420;
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 6, y }] });
  for (let x = 20; x <= 320; x += 25) {
    await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await p.waitForTimeout(16);
  }
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await T('.job-row').first().waitFor({ timeout: 5000 });
  await wait(900);
  check((await T('.list-row').count()) === 0 && (await realLen()) === start, 'the swipe from the edge goes back (the app\'s own), the browser at one page');

  // Forward and back by the history itself (what the router does with its steps).
  await p.evaluate(() => history.forward());
  await T('.list-row').first().waitFor({ timeout: 5000 });
  await wait(700);
  check(/#\/orders\//.test(p.url()), 'forward comes back to the job');

  // A reload opens the same screen; «‹» then leads to the board (nothing behind it in the browser).
  await p.reload();
  await T('.list-row').first().waitFor({ timeout: 60000 });
  await wait(1200);
  check(/#\/orders\//.test(p.url()) && (await p.evaluate(() => history.length)) === 1 && (await p.evaluate(() => history.state?.idx)) === 0, 'a reload: the same screen, the app\'s history starts at it');
  await T('.nav-back').tap();
  await T('.job-row').first().waitFor({ timeout: 5000 });
  check(true, '«‹» after a reload leads to the board');

  check(!errors.length, 'no errors in the console' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log('VHISTORY E2E OK');
})().catch((e) => {
  console.error(String(e?.message || e).slice(0, 1500));
  process.exit(1);
});
