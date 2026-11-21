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
      // v0.42: a section per busy step, every step in the strip on top, the cards the size of a phone's whatever the
      // window — one busy step no longer stretches its cars over the screen (the user's 1920 window: one car to a screen).
      const board = async () =>
        p.evaluate(() => {
          const w = [...document.querySelectorAll('.desk-grid.board-cards > .job-card')].map((c) => c.getBoundingClientRect().width);
          return {
            sections: document.querySelectorAll('.desk-lane').length,
            heads: document.querySelectorAll('.desk-lane-head .desk-lane-count').length,
            steps: document.querySelectorAll('.desk-steps .desk-step').length,
            widest: Math.round(Math.max(...w)),
            narrowest: Math.round(Math.min(...w)),
            overflowX: document.scrollingElement.scrollWidth - innerWidth,
          };
        });
      {
        const b = await board();
        check(`board ${width}: a section per busy step, every step in the strip, cards 260–440 px, no sideways scroll`, b.sections > 0 && b.heads === b.sections && b.steps === 8 && b.widest <= 440 && b.narrowest >= 260 && b.overflowX <= 1, b);
      }
      if (first) {
        // One step picked: only its section, its cards as large as before.
        await p.locator('.desk-step').filter({ hasText: 'В работе' }).click();
        await settle(500);
        const one = await board();
        check('board: one step picked — its section alone, the cards keep their size', one.sections === 1 && one.widest <= 440, one);
        await p.locator('.desk-step').filter({ hasText: 'Все' }).click();
        await settle(400);
        // The appearance (language, theme, colour) behind one button at the sidebar's foot.
        await p.locator('.app-nav').getByRole('button', { name: 'Оформление' }).click();
        await settle(400);
        check('sidebar: «Оформление» shows the language, the theme and the colour', (await p.locator('.desk-appearance').getByText('English', { exact: true }).isVisible()) && (await p.locator('.desk-appearance').getByText('Тёмная', { exact: true }).isVisible()));
        await p.keyboard.press('Escape');
        await settle(400);
        check('sidebar: Esc closes «Оформление»', (await p.locator('.desk-appearance').count()) === 0);
        // Ctrl+K: the search over the window; a car in the garage opens its job.
        await p.keyboard.press('Control+KeyK');
        await settle(500);
        await p.keyboard.type('Nissan');
        await settle(900);
        const pal = await p.evaluate(() => ({ rows: document.querySelectorAll('.desk-pal-row').length, job: document.querySelector('.desk-pal-row[data-selected] .desk-pal-job')?.textContent ?? '' }));
        await shot('01d-search');
        await p.keyboard.press('Enter');
        await settle(900);
        check('search: Ctrl+K finds the car, Enter opens its job', pal.rows > 1 && /^№[0-9]+/.test(pal.job) && (await p.evaluate(() => location.hash)).startsWith('#/orders/'), pal);
        await go('#/', 700);
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
            // v0.63.3 (the owner: «часто случайно нажимаю и удаляется»): «Удалить» / «Убрать» asks once more — the first
            // click only turns it into «Удалить?»; the mouse leaving the row lets it go.
            const off = line.locator('.row-hover-btn').last();
            if (/^(Удалить|Убрать)$/.test((await off.innerText()).trim())) {
              const rows = await p.locator('.job-desk-main .list-row.swipe-row').count();
              await off.click();
              await settle(300);
              const asked = { armed: await off.getAttribute('data-armed'), text: (await off.innerText()).trim(), rows: await p.locator('.job-desk-main .list-row.swipe-row').count() };
              check('job: the first click on «Удалить» only asks (nothing deleted)', asked.armed !== null && /\?$/.test(asked.text) && asked.rows === rows, asked);
              await shot('03b3-job-line-delete-asks');
              await p.mouse.move(5, 5);
              await settle(300);
              check('job: the mouse leaving the row lets the question go', (await off.getAttribute('data-armed')) === null);
            }
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
        // Two columns: the car | the complaint and the customer; every emirate, make and complaint in sight (no row
        // that hides chips past its edge — a mouse has no sideways swipe).
        const form = await p.evaluate(() => {
          const r = (q) => document.querySelector(q)?.getBoundingClientRect();
          const side = r('.desk-form > .desk-split-side');
          const main = r('.desk-form > .desk-split-main');
          const hidden = [...document.querySelectorAll('.desk-form .chip-row')].map((el) => el.scrollWidth - el.clientWidth);
          return side && main ? { side: Math.round(side.right), main: Math.round(main.left), top: Math.round(Math.abs(side.top - main.top)), hidden: Math.max(0, ...hidden) } : null;
        });
        check('new job: the car beside the complaint and the customer, every chip in sight', !!form && form.side < form.main && form.top < 4 && form.hidden <= 1, form);
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
