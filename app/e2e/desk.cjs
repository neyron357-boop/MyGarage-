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
  // What the PC layout must be, checked on the way (the first size and theme): a failure is an error, not a picture.
  const fails = [];
  const check = (what, ok, info) => {
    console.log(ok ? 'ok  ' : 'FAIL', what, ok ? '' : JSON.stringify(info ?? ''));
    if (!ok) fails.push(what);
  };
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
      const first = width === SIZES[0] && scheme === SCHEMES[0];
      if (first) {
        // The lanes fill the window (the page does not scroll), each with its count; all of them in sight.
        const lanes = await p.evaluate(() => {
          const k = document.querySelector('.kanban');
          return {
            docScroll: document.scrollingElement.scrollHeight - innerHeight,
            heads: document.querySelectorAll('.kanban-head .kanban-count').length,
            cols: document.querySelectorAll('.kanban-col').length,
            bottom: Math.round(k.getBoundingClientRect().bottom),
            overflowX: k.scrollWidth - k.clientWidth,
          };
        });
        check('board: lanes the height of the window, a head with its count each, no sideways scroll', lanes.docScroll <= 1 && lanes.heads === lanes.cols && lanes.cols > 0 && Math.abs(lanes.bottom - height) <= 2 && lanes.overflowX <= 1, lanes);
      }
      // A right click on a card: its menu where the mouse is.
      const card = p.locator('.job-card').first();
      const cb = await card.boundingBox();
      await card.click({ button: 'right', position: { x: 60, y: 40 } });
      await settle(500);
      await shot('01b-board-menu');
      if (first) {
        const menu = await p.locator('.mantine-Menu-dropdown').boundingBox();
        const items = await p.locator('.mantine-Menu-dropdown .mantine-Menu-item').allInnerTexts();
        check("board: a right click opens the card's menu at the mouse", !!menu && Math.abs(menu.x - (cb.x + 60)) < 30 && Math.abs(menu.y - (cb.y + 40)) < 30 && items.includes('Открыть') && items.includes('Удалить заказ'), { menu, items });
      }
      await p.keyboard.press('Escape');
      await settle(300);
      // «?» — the keys.
      await p.keyboard.press('Shift+Slash');
      await settle(500);
      await shot('01c-keys');
      if (first) check('keys: «?» shows the list of keys', await p.getByRole('dialog').getByText('Новый заказ').isVisible());
      await p.keyboard.press('Escape');
      await settle(400);
      if (first) {
        // N — a new job, from the board.
        await p.keyboard.press('KeyN');
        await settle(700);
        check('keys: N opens a new job', (await p.evaluate(() => location.hash)).startsWith('#/orders/new'));
        await go('#/', 700);
      }
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
        if (first && k === 'a') {
          // Two columns: the lines on the left, the car and the job's tiles on the right, level at the top.
          const cols = await p.evaluate(() => {
            const r = (q) => document.querySelector(q)?.getBoundingClientRect();
            const main = r('.job-desk-main');
            const aside = r('.job-desk-aside');
            const more = document.querySelector('.job-more-btn');
            return main && aside && more ? { mainRight: Math.round(main.right), asideLeft: Math.round(aside.left), top: Math.round(Math.abs(main.top - aside.top)), tiles: document.querySelectorAll('.job-desk-actions .action-tile').length, more: getComputedStyle(more).display } : null;
          });
          check('job: lines and the car side by side, the "…" tiles beside them', !!cols && cols.mainRight < cols.asideLeft && cols.top < 12 && cols.tiles > 3 && cols.more === 'none', cols);
          // 2 — a part's sheet; Escape closes it.
          await p.keyboard.press('2');
          await settle(700);
          check('keys: 2 on a job adds a part', await p.getByRole('dialog').getByText('Добавить запчасть').isVisible());
          const sheet = await p.locator('.mantine-Modal-content').last().boundingBox();
          check('sheets: 520 px wide on a PC', !!sheet && Math.abs(sheet.width - 520) <= 2, sheet);
          await p.keyboard.press('Escape');
          await settle(500);
        }
        if (k === 'b') {
          // A line under the mouse: its swipes as buttons at its end.
          const line = p.locator('.job-desk-main .list-row.swipe-row').first();
          await line.hover({ position: { x: 120, y: 20 } });
          await settle(400);
          await shot('03b2-job-line-hover');
          if (first) {
            const btns = await line.locator('.row-hover-btn').allInnerTexts();
            const shown = await line.locator('.row-hover').evaluate((el) => getComputedStyle(el).opacity);
            check("job: a line's swipes are buttons under the mouse", btns.length > 0 && shown === '1', { btns, shown });
          }
          await p.mouse.move(5, 5);
        }
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
      if (first) {
        // The car makes run past the edge: the mouse's wheel brings them in.
        const row = p.locator('.chip-row:not(.wrap)').filter({ hasText: 'Toyota' }).first();
        const rb = await row.boundingBox();
        await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
        await p.mouse.wheel(0, 300);
        await settle(300);
        const left = await row.evaluate((el) => el.scrollLeft);
        check('wheel: a sideways row of chips scrolls with the mouse wheel', left > 100, { left });
        await p.mouse.move(5, 5);
      }
      await go('#/search?q=' + encodeURIComponent('масло'), 1200);
      await shot('05-search');
      await go('#/customers', 900);
      await shot('06-customers');
      if (first) {
        // A click on a head sorts by it (the most visits first), once more — the other way.
        const visits = () => p.evaluate(() => [...document.querySelectorAll('.dt tbody tr[data-row]')].map((tr) => Number(tr.children[3].textContent)));
        await p.locator('.dt th').filter({ hasText: 'Визиты' }).locator('button').click();
        await settle(300);
        const down = await visits();
        await p.locator('.dt th').filter({ hasText: 'Визиты' }).locator('button').click();
        await settle(300);
        const up = await visits();
        const sorted = (a, d) => a.every((v, i) => !i || (d ? a[i - 1] >= v : a[i - 1] <= v));
        check('customers: a table sorted by a click on a head', down.length > 1 && sorted(down, true) && sorted(up, false), { down, up });
        await p.evaluate(() => localStorage.removeItem('mygarage.sort.customers'));
        await go('#/customers', 700);
      }
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
  console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'all checks passed');
  await browser.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => {
  console.error('DESK SHOTS FAILED:', String((e && e.message) || e).split('\n')[0]);
  process.exit(1);
});
