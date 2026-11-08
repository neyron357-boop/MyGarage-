const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Design review: screenshots of the main screens on a phone (light and dark) and on a PC.
// Usage: start the dev server (npm run dev -- --port 5173), then: node e2e/shots.cjs [outDir]
const OUT = process.argv[2] || path.join(__dirname, '..', 'test-results', 'design');
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
fs.mkdirSync(OUT, { recursive: true });

async function launchBrowser() {
  const forced = process.env.E2E_BROWSER;
  const channels = forced ? [forced] : ['chromium', 'chrome', 'msedge'];
  for (const channel of channels) {
    try {
      return await chromium.launch(channel === 'chromium' ? {} : { channel });
    } catch {
      // try the next one
    }
  }
  throw new Error('no browser: run "npx playwright install chromium" or install Google Chrome / Microsoft Edge');
}

(async () => {
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 300)));

  const settle = async (ms = 900) => page.waitForTimeout(ms);
  const shot = async (name, opts = {}) => {
    if (opts.scroll !== undefined) {
      await page.evaluate((y) => window.scrollTo(0, y), opts.scroll);
      await settle(350);
    }
    // Screens slide in (View Transitions): wait for that and any other animation before the picture.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))).catch(() => undefined);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!opts.full });
    console.log('shot', name);
  };
  const go = async (hash, ms) => {
    await page.goto(BASE + hash);
    await settle(ms);
  };

  await go('#/settings?tab=data');
  await page.getByRole('button', { name: 'Загрузить демо-данные' }).click();
  await settle(1500);

  const tour = async (prefix) => {
    await go('#/');
    await shot(`${prefix}-01-board`);
    await shot(`${prefix}-01b-board-scrolled`, { scroll: 520 });
    await page.locator('.surface.tap').first().click();
    await settle(900);
    const order = await page.evaluate(() => location.hash);
    await shot(`${prefix}-02-order`);
    await shot(`${prefix}-02b-order-scrolled`, { scroll: 380 });
    // The "…" menu and the stage sheet of the job.
    await page.locator('.nav-bar .mantine-ActionIcon-root').first().click();
    await settle(500);
    await shot(`${prefix}-02c-order-menu`);
    await page.keyboard.press('Escape');
    await settle(300);
    await page.locator('.stage-btn').first().click();
    await settle(700);
    await shot(`${prefix}-02d-stage-sheet`);
    await page.keyboard.press('Escape');
    await settle(400);
    await go(order + '?tab=work');
    await shot(`${prefix}-03-order-work`);
    await go('#/orders/new');
    await shot(`${prefix}-04-new-order`);
    await go('#/search?q=' + encodeURIComponent('масло'));
    await shot(`${prefix}-05-search`);
    await go('#/money');
    await shot(`${prefix}-06-money`);
    await go('#/money?tab=cash');
    await shot(`${prefix}-06b-cash`);
    await go('#/more');
    await shot(`${prefix}-07-more`);
    await go('#/settings');
    await shot(`${prefix}-08-settings`);
    await go('#/customers');
    await shot(`${prefix}-09-customers`);
    await go(order.replace('#', '#') + '/intake');
    await settle(600);
    await shot(`${prefix}-10-intake`);
    await go(order + '/invoice');
    await shot(`${prefix}-11-invoice`);
    await go('#/money?tab=expenses&add=1', 1200);
    await shot(`${prefix}-12-sheet`);
  };

  await tour('phone-light');
  await go('#/more');
  await page.getByText(/^(Тёмная|Dark)$/).click();
  await settle(400);
  await tour('phone-dark');
  await go('#/more');
  await page.getByText(/^(Светлая|Light)$/).click();

  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU' });
  const dp = await desk.newPage();
  await dp.goto(BASE + '#/');
  await dp.waitForTimeout(1200);
  await dp.screenshot({ path: `${OUT}/desktop-01-board.png` });
  await dp.goto(BASE + '#/money');
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: `${OUT}/desktop-02-money.png` });

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => {
  console.error('SHOTS FAILED:', String((e && e.message) || e).split('\n')[0]);
  process.exit(1);
});
