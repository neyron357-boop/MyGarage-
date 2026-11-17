const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
/*
 * The computer's screens (v0.41): the main screens of the PC at 1440 × 900 and 1920 × 1080, light and dark, into
 * test-results/desk/ — to look at the desk layout. Usage: start the dev server (npm run dev -- --port 5173), then:
 * node e2e/desk.cjs [outDir]   (BASE_URL for another port; SIZES=1440 for one size; SCHEMES=light for one theme)
 */
const OUT = process.argv[2] || path.join(__dirname, '..', 'test-results', 'desk');
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const SIZES = (process.env.SIZES || '1440,1920').split(',').map(Number);
const SCHEMES = (process.env.SCHEMES || 'light,dark').split(',');
fs.mkdirSync(OUT, { recursive: true });

async function launchBrowser() {
  const forced = process.env.E2E_BROWSER;
  const channels = forced ? [forced] : ['chromium', 'chrome', 'msedge'];
  for (const channel of channels) {
    try {
      return await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), args: ['--enable-unsafe-swiftshader'] });
    } catch {
      // try the next one
    }
  }
  throw new Error('no browser: run "npx playwright install chromium" or install Google Chrome / Microsoft Edge');
}

(async () => {
  const browser = await launchBrowser();
  const errors = [];
  for (const width of SIZES) {
    const height = width >= 1900 ? 1080 : 900;
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'ru-RU' });
    await ctx.addInitScript(() => localStorage.getItem('mygarage.feedback') ?? localStorage.setItem('mygarage.feedback', '0'));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 300)));
    const settle = (ms = 800) => p.waitForTimeout(ms);
    const go = async (hash, ms) => {
      await p.goto(BASE + hash);
      await settle(ms);
    };
    const shot = async (name, opts = {}) => {
      await p.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.timeline === document.timeline).map((a) => a.finished.catch(() => undefined)))).catch(() => undefined);
      await p.screenshot({ path: `${OUT}/${width}-${scheme}-${name}.png`, fullPage: !!opts.full });
      console.log('shot', `${width}-${scheme}-${name}`);
    };
    let scheme = 'light';
    await go('#/settings?tab=data');
    await p.getByRole('button', { name: 'Загрузить демо-данные' }).click();
    await p.getByText('Демо-данные загружены').first().waitFor({ timeout: 20000 });
    await settle(1200);
    await p.addStyleTag({ content: '.mantine-Notifications-root { display: none !important; }' });
    for (scheme of SCHEMES) {
      await p.evaluate((s) => localStorage.setItem('mygarage.scheme', s), scheme);
      // (A hash of the same page is no reload: the scheme in memory would stay.)
      await go('#/', 200);
      await p.reload();
      await settle(1200);
      await p.addStyleTag({ content: '.mantine-Notifications-root { display: none !important; }' });
      await shot('01-board');
      // A right click on a card: its menu where the mouse is.
      await p.locator('.job-card').first().click({ button: 'right' });
      await settle(500);
      await shot('01b-board-menu');
      await p.keyboard.press('Escape');
      await settle(300);
      // «?» — the keys.
      await p.keyboard.press('Shift+Slash');
      await settle(500);
      await shot('01c-keys');
      await p.keyboard.press('Escape');
      await settle(400);
      await p.getByRole('button', { name: /^Архив/ }).click();
      await settle(900);
      await shot('02-archive');
      await p.getByRole('button', { name: /^Архив/ }).click();
      await settle(500);
      // A job with lines, waiting for the customer; one in work.
      for (const [k, step] of [['a', /Цена|Price/], ['b', /В работе|In work/]]) {
        await go('#/', 900);
        await p.locator('.job-row').filter({ hasText: step }).first().locator('.job-card-open').click();
        await settle(1100);
        await shot(`03${k}-job`);
      }
      await p.getByRole('button', { name: 'Запчасть', exact: true }).first().click();
      await settle(700);
      await shot('03c-job-part');
      await p.keyboard.press('Escape');
      await settle(500);
      // The job's notes in the wide column, the car beside them.
      await p.getByRole('tab', { name: /^Заметки/ }).click();
      await settle(700);
      await shot('03d-job-notes');
      await go('#/orders/new', 900);
      await shot('04-new-order');
      await go('#/search?q=' + encodeURIComponent('масло'), 1200);
      await shot('05-search');
      await go('#/customers', 900);
      await shot('06-customers');
      await p.locator('.list-row.clickable, tr[data-row]').first().click();
      await settle(900);
      await shot('06b-customer');
      await go('#/money', 900);
      await shot('07-money-book');
      await go('#/money?tab=cash', 900);
      await shot('07b-money-cash');
      await go('#/money?tab=expenses', 900);
      await shot('07c-money-expenses');
      await go('#/money?tab=debts', 900);
      await shot('07d-money-debts');
      await go('#/parts?tab=ordered', 900);
      await shot('08-parts');
      await go('#/parts?tab=suppliers', 900);
      await shot('08b-suppliers');
      await go('#/reports', 900);
      await shot('09-reports');
      await go('#/notes', 900);
      await shot('10-notes');
      await go('#/settings', 900);
      await shot('11-settings');
    }
    await p.evaluate(() => localStorage.removeItem('mygarage.scheme'));
    await ctx.close();
  }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => {
  console.error('DESK SHOTS FAILED:', String((e && e.message) || e).split('\n')[0]);
  process.exit(1);
});
