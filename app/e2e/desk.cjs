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
      // v0.75 (the owner on the board before it: «пересобрать этот экран полностью»): one bar — the steps that have cars,
      // «Долги», «Архив», how to see the cars — and the cars in one grid, every card one size whatever the window.
      const board = async () =>
        p.evaluate(() => {
          const cards = [...document.querySelectorAll('.dboard-grid > .dcard')];
          const r = cards.map((c) => c.getBoundingClientRect());
          return {
            cards: cards.length,
            steps: document.querySelectorAll('[data-board-steps] .dboard-tab[data-step]').length,
            tabs: document.querySelectorAll('[data-board-steps] .dboard-tab').length,
            shown: [...new Set(cards.map((c) => c.getAttribute('data-step')))],
            widest: Math.round(Math.max(...r.map((x) => x.width))),
            narrowest: Math.round(Math.min(...r.map((x) => x.width))),
            heights: new Set(r.map((x) => Math.round(x.height))).size,
            // A card: its photo 16 : 9 and its four lines of facts (116 px).
            shape: r.length ? Math.round(r[0].height - (r[0].width * 9) / 16) : 0,
            overflowX: document.scrollingElement.scrollWidth - innerWidth,
          };
        });
      {
        const b = await board();
        check(`board ${width}: one grid, every card one size (240–340 px), a tab a busy step with «Все», «Долги», «Архив», no sideways scroll`, b.cards > 2 && b.heights === 1 && b.widest <= 340 && b.narrowest >= 240 && Math.abs(b.shape - 116) <= 2 && b.steps >= 2 && b.tabs === b.steps + 3 && b.overflowX <= 1, b);
      }
      if (first) {
        // One step picked: only its cars, as large as before; what they come to beside the strip.
        const before = await board();
        await p.locator('.dboard-tab[data-step="work"]').click();
        await settle(500);
        const one = await board();
        check('board: one step picked — its cars alone, the cards keep their size', one.cards > 0 && one.cards < before.cards && one.shown.join() === 'work' && one.widest === before.widest && (await p.locator('[data-board-sum]').innerText()).includes('В работе'), one);
        await p.locator('.dboard-tab').filter({ hasText: 'Все' }).click();
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
      const card = p.locator('.dcard').first();
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
        // v0.67 / v0.75: an important card — a star and a warm line, first in its step, no larger than the others; a pinned
        // one — first on the board.
        const firstCard = p.locator('.dboard-grid > .dcard').first();
        const stepOfFirst = await firstCard.getAttribute('data-step');
        const second = p.locator(`.dboard-grid > .dcard[data-step="${stepOfFirst}"]`).nth(1);
        const secondId = (await second.count()) ? await second.getAttribute('data-card') : await firstCard.getAttribute('data-card');
        const marked = p.locator(`.dboard-grid > .dcard[data-card="${secondId}"]`);
        await marked.hover();
        await marked.locator('[data-tool="important"]').click();
        await settle(600);
        const imp = await p.evaluate((id) => {
          const it = document.querySelector(`.dcard[data-card="${id}"]`);
          const other = document.querySelector('.dboard-grid > .dcard:not([data-important])');
          const sameStep = [...document.querySelectorAll(`.dboard-grid > .dcard[data-step="${it.getAttribute('data-step')}"]`)];
          return { on: it.hasAttribute('data-important'), w: Math.round(it.getBoundingClientRect().width), other: Math.round(other.getBoundingClientRect().width), ring: getComputedStyle(it).boxShadow !== getComputedStyle(other).boxShadow, firstOfStep: sameStep[0] === it, star: !!it.querySelector('[data-tool="important"][data-on]') };
        }, secondId);
        check('board: an important card — a star and a line of its own, first in its step, the size of the others', imp.on && imp.w === imp.other && imp.ring && imp.firstOfStep && imp.star, imp);
        const toPin = p.locator('.dboard-grid > .dcard:not([data-important])').last();
        const pinId = await toPin.getAttribute('data-card');
        await toPin.hover();
        await toPin.locator('[data-tool="pin"]').click();
        await settle(600);
        check('board: a pinned card — first on the board', (await p.locator('.dboard-grid > .dcard').first().getAttribute('data-card')) === pinId && (await p.locator('.dboard-grid > .dcard[data-pinned]').count()) === 1);
        await shot('01e-board-marks');
        // «Список»: the same cars as a table by step, the pinned one in a group of its own on top; a line opens its job.
        const cardsNow = await p.locator('.dboard-grid > .dcard').count();
        await p.locator('.dboard-tab[data-mode="list"]').click();
        await settle(600);
        const list = await p.evaluate(() => ({ rows: document.querySelectorAll('.dlist tr[data-row]').length, groups: [...document.querySelectorAll('.dlist .dlist-head')].map((h) => h.getAttribute('data-group')), overflowX: document.scrollingElement.scrollWidth - innerWidth }));
        check('board: «Список» — a line a car, a group a step, the pinned ones first', list.rows === cardsNow && list.groups[0] === 'pinned' && list.groups.length > 2 && list.overflowX <= 1, list);
        await shot('01g-board-list');
        await p.locator('.dlist tr[data-row]').nth(1).click();
        await settle(900);
        check('board: a line of the list opens its job', (await p.evaluate(() => location.hash)).startsWith('#/orders/'));
        await go('#/', 700);
        // The canvas: a card dragged anywhere stays there (and is not opened by the drag); its corner drawn out — larger.
        await p.locator('.dboard-tab[data-mode="canvas"]').click();
        await settle(900);
        // The leftmost card that is neither pinned nor important (room to its right to be dragged into).
        const candidates = p.locator('.desk-canvas-card:not([data-pinned]):not([data-important])');
        const xs = await candidates.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
        const moving = candidates.nth(xs.indexOf(Math.min(...xs)));
        check('canvas: every card within the canvas', await p.evaluate(() => { const c = document.querySelector('.desk-canvas').getBoundingClientRect(); return [...document.querySelectorAll('.desk-canvas-card')].every((e) => e.getBoundingClientRect().right <= c.right + 1); }));
        const id = await moving.getAttribute('data-card');
        // Measured on the canvas (the page may scroll to show a card).
        const onCanvas = async (q) => p.evaluate((sel) => { const c = document.querySelector('.desk-canvas').getBoundingClientRect(); const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x - c.x, y: r.y - c.y, width: r.width, height: r.height }; }, q);
        const at = await moving.boundingBox();
        await p.mouse.move(at.x + 70, at.y + 70);
        await p.mouse.down();
        await p.mouse.move(at.x + 170, at.y + 150, { steps: 6 });
        await p.mouse.move(at.x + 270, at.y + 230, { steps: 6 });
        await p.mouse.up();
        await settle(600);
        const moved = p.locator(`.desk-canvas-card[data-card="${id}"]`);
        const to = await moved.boundingBox();
        check('canvas: a card dragged anywhere stays there; the drag does not open it', Math.abs(to.x - at.x - 200) <= 12 && Math.abs(to.y - at.y - 160) <= 12 && (await p.evaluate(() => location.hash)) === '#/', { at, to });
        await moved.hover();
        const corner = await moved.locator('.desk-resize').boundingBox();
        await p.mouse.move(corner.x + 9, corner.y + 9);
        await p.mouse.down();
        await p.mouse.move(corner.x + 69, corner.y + 40, { steps: 5 });
        await p.mouse.move(corner.x + 129, corner.y + 70, { steps: 5 });
        await p.mouse.up();
        await settle(600);
        const big = await moved.boundingBox();
        const bigOn = await onCanvas(`.desk-canvas-card[data-card="${id}"]`);
        check('canvas: the corner drawn out — the card larger, its photo 16 : 9 and its facts still', big.width - to.width >= 110 && big.width - to.width <= 130 && Math.abs(big.height - (Math.round((big.width * 9) / 16) + 116)) <= 3, { to, big });
        await shot('01f-canvas');
        // Kept on this computer: a reload — the same canvas, the card where it was put.
        await p.reload();
        await settle(1500);
        const kept = await onCanvas(`.desk-canvas-card[data-card="${id}"]`);
        check('canvas: kept after a reload', Math.abs(kept.x - bigOn.x) <= 2 && Math.abs(kept.y - bigOn.y) <= 2 && Math.abs(kept.width - bigOn.width) <= 2, { bigOn, kept });
        check('canvas: the page never scrolls sideways', (await p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth)) <= 1);
        // A click (no drag) opens the job as before.
        await p.locator(`.desk-canvas-card[data-card="${id}"] .dcard-open`).click({ position: { x: 40, y: 60 } });
        await settle(900);
        check('canvas: a click opens the job', (await p.evaluate(() => location.hash)).startsWith('#/orders/'));
        // Back to the cards, the marks taken off (the other sizes' pictures as before).
        await p.evaluate(() => localStorage.removeItem('mygarage.deskBoard'));
        await go('#/', 300);
        await p.reload();
        await settle(1200);
      }
      await p.getByRole('button', { name: /^Архив/ }).click();
      await settle(900);
      await shot('02-archive');
      await p.getByRole('button', { name: /^Архив/ }).click();
      await settle(500);
      // A job with lines, waiting for the customer; one in work.
      for (const [k, step] of [['a', /Цена|Price/], ['b', /В работе|In work/]]) {
        await go('#/', 900);
        await p.locator('.dcard').filter({ hasText: step }).first().locator('.dcard-open').click();
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
          // 2 — the quick sheet on «Запчасть» (v0.81); Escape closes it.
          await p.keyboard.press('2');
          await settle(700);
          check('keys: 2 on a job adds a part', await p.getByRole('dialog').getByRole('radio', { name: 'Запчасть', checked: true }).isVisible());
          const sheet = await p.locator('.mantine-Modal-content').last().boundingBox();
          check('sheets: 520 px wide on a PC', !!sheet && Math.abs(sheet.width - 520) <= 2, sheet);
          await p.keyboard.press('Escape');
          await settle(500);
          // v0.67 (the owner's note): the job shown to its customer — the lock: no side menu, nothing opens, no keys, no
          // other screen; held, the lock opens.
          await p.locator('[data-client-lock-btn]').click();
          await settle(700);
          const lockedView = await p.evaluate(() => ({
            view: !!document.querySelector('[data-client-view]'),
            side: getComputedStyle(document.querySelector('.desk-side')).display,
            clickable: document.querySelectorAll('[data-client-view] .list-row.clickable, [data-client-view] .action-tile').length,
            rows: document.querySelectorAll('[data-client-view] .list-row').length,
          }));
          check('client lock: the job alone, nothing to open, no side menu', lockedView.view && lockedView.side === 'none' && lockedView.clickable === 0 && lockedView.rows > 1, lockedView);
          await shot('03c-client-lock');
          const jobHash = await p.evaluate(() => location.hash);
          await p.keyboard.press('KeyN');
          await settle(600);
          await p.evaluate(() => (location.hash = '#/money'));
          await settle(900);
          check('client lock: no keys, no other screen — back on the job', (await p.evaluate(() => location.hash)) === jobHash && (await p.locator('[data-client-view]').count()) === 1);
          // A click on the lock only says how; held, it opens.
          await p.locator('.client-unlock').click();
          await settle(500);
          check('client lock: a click does not open it', (await p.locator('[data-client-view]').count()) === 1);
          const lockBox = await p.locator('.client-unlock').boundingBox();
          await p.mouse.move(lockBox.x + lockBox.width / 2, lockBox.y + lockBox.height / 2);
          await p.mouse.down();
          await p.waitForTimeout(1500);
          await p.mouse.up();
          await settle(700);
          check('client lock: held — the job as before', (await p.locator('[data-client-view]').count()) === 0 && (await p.evaluate(() => getComputedStyle(document.querySelector('.desk-side')).display)) !== 'none');
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
            // v0.76 (the owner: «когда двигаю курсор, чтобы перетаскать позиции вверх-вниз, кнопка «Удалить» мешает»): the
            // grip ≡ stays clear of the row's buttons — under the mouse it is the grip, the buttons go — and a row is moved
            // by it with the mouse.
            const gripped = p.locator('.job-desk-main .list-row.swipe-row:has(> .sort-grip)');
            if ((await gripped.count()) >= 2) {
              const row0 = gripped.first();
              await row0.hover({ position: { x: 120, y: 20 } });
              await settle(300);
              const g = await row0.locator('.sort-grip').boundingBox();
              const clear = await p.evaluate(([x, y]) => {
                const el = document.elementFromPoint(x, y);
                const row = el?.closest('.list-row');
                const strip = row?.querySelector(':scope > .row-hover')?.getBoundingClientRect();
                return { onGrip: !!el?.closest('.sort-grip'), stripRight: strip ? Math.round(strip.right) : null, gripLeft: Math.round(row?.querySelector(':scope > .sort-grip')?.getBoundingClientRect().left ?? 0) };
              }, [g.x + g.width / 2, g.y + g.height / 2]);
              await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
              await settle(300);
              const onGrip = await row0.locator('.row-hover').evaluate((el) => getComputedStyle(el).opacity);
              check('job: the grip ≡ in the clear — the buttons end before it and go while the mouse is on it', clear.onGrip && clear.stripRight !== null && clear.stripRight <= clear.gripLeft + 1 && onGrip === '0', { ...clear, onGrip });
              await shot('03b4-job-line-grip');
              const titles = () => gripped.evaluateAll((rows) => rows.map((r) => r.querySelector('.title')?.textContent?.trim() ?? ''));
              const before = await titles();
              const r1 = await gripped.nth(1).boundingBox();
              await p.mouse.down();
              await p.mouse.move(g.x + g.width / 2, r1.y + r1.height / 2 + 6, { steps: 8 });
              await p.mouse.move(g.x + g.width / 2, r1.y + r1.height - 4, { steps: 4 });
              await p.mouse.up();
              await settle(900);
              const after = await titles();
              check('job: a line moved by its grip with the mouse, nothing deleted', after.length === before.length && after[0] === before[1] && after[1] === before[0], { before, after });
              // Back as it was (the pictures after this one).
              const g2 = await gripped.first().locator('.sort-grip').boundingBox();
              const b1 = await gripped.nth(1).boundingBox();
              await p.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
              await p.mouse.down();
              await p.mouse.move(g2.x + g2.width / 2, b1.y + b1.height / 2 + 6, { steps: 8 });
              await p.mouse.move(g2.x + g2.width / 2, b1.y + b1.height - 4, { steps: 4 });
              await p.mouse.up();
              await settle(900);
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
  console.error('DESK SHOTS FAILED:', String((e && e.message) || e).split('\n').slice(0, process.env.FULL_ERR ? 30 : 1).join('\n'));
  process.exit(1);
});
