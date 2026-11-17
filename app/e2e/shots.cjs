const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
// Design review: screenshots of the main screens on a phone (light and dark) and on a PC.
// Usage: start the dev server (npm run dev -- --port 5173), then: node e2e/shots.cjs [outDir]
// SHOTS_CLOCK=2026-11-18T09:30:00+04:00 — the page's date stays at that moment (timers run as usual): two runs draw the same
// times and durations, so their pictures can be compared pixel by pixel (the phone before and after a PC change).
const OUT = process.argv[2] || path.join(__dirname, '..', 'test-results', 'design');
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const CLOCK = process.env.SHOTS_CLOCK ? new Date(process.env.SHOTS_CLOCK) : undefined;
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'ru-RU' });
  if (CLOCK) await ctx.clock.setFixedTime(CLOCK);
  await ctx.addInitScript(() => localStorage.getItem('mygarage.feedback') ?? localStorage.setItem('mygarage.feedback', '0'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 300)));

  const settle = async (ms = 900) => page.waitForTimeout(ms);
  const shot = async (name, opts = {}) => {
    if (opts.scroll !== undefined) {
      // Phone screens scroll themselves (the document does not).
      await page.evaluate((y) => (document.querySelector('.screen[data-role="top"] .screen-scroll') || document.scrollingElement).scrollTo(0, y), opts.scroll);
      await settle(350);
    }
    // Screens slide in (View Transitions): wait for that and any other animation before the picture.
    // Only animations that run in time: one tied to a scroll (the glow under the title) never finishes.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.timeline === document.timeline).map((a) => a.finished.catch(() => undefined)))).catch(() => undefined);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!opts.full });
    console.log('shot', name);
  };
  const go = async (hash, ms) => {
    await page.goto(BASE + hash);
    await settle(ms);
  };
  // A card slip drawn in the page and kept with the newest movement of the cash box.
  const addSlip = async () => {
    const { cashState } = await import('/src/services/money.ts');
    const { loadLedger } = await import('/src/services/ledger.ts');
    const { withEntries } = await import('/src/domain/ledger.ts');
    const { addProofs } = await import('/src/services/proofs.ts');
    const lines = withEntries((await cashState()).lines, (await loadLedger()).entries);
    const c = Object.assign(document.createElement('canvas'), { width: 480, height: 720 });
    const g = c.getContext('2d');
    g.fillStyle = '#f6f3ec';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#2b2b2b';
    g.font = 'bold 36px monospace';
    g.fillText('CARD SLIP', 40, 90);
    g.font = '26px monospace';
    ['MERCHANT  GARAGE', 'AMOUNT    AED 246.75', 'APPROVED  000123'].forEach((s, i) => g.fillText(s, 40, 180 + i * 52));
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    await addProofs(lines[lines.length - 1].entry, [blob]);
  };

  await go('#/settings?tab=data');
  await page.getByRole('button', { name: 'Загрузить демо-данные' }).click();
  await page.getByText('Демо-данные загружены').first().waitFor({ timeout: 20000 });
  await settle(1500);
  // The "demo data loaded" banner would sit over every picture (the mouse of the test pauses it).
  await page.addStyleTag({ content: '.mantine-Notifications-root { display: none !important; }' });

  // v0.20: an expense taken on credit and a part of it paid — "Company debts" has a line to show.
  const addCredit = async () => {
    const { addExpense } = await import('/src/services/money.ts');
    const { payCredit } = await import('/src/services/debts.ts');
    const { db } = await import('/src/db/db.ts');
    const { dubaiDate } = await import('/src/domain/dates.ts');
    const cat = (await db.expenseCategories.toArray()).find((c) => c.code === 'parts');
    const e = await addExpense({ date: dubaiDate(), categoryId: cat.id, amountFils: 100000, vatFils: 0, vendor: 'Al Futtaim Parts', method: 'credit' });
    await payCredit(e.id, { amountFils: 30000, method: 'cash' });
  };

  const tour = async (prefix) => {
    await go('#/');
    await shot(`${prefix}-01-board`);
    await shot(`${prefix}-01b-board-scrolled`, { scroll: 520 });
    // v0.20: "Debts" beside "Archive" — one card per customer.
    await page.locator('.screen[data-role="top"] [role="tab"]').filter({ hasText: /Долги|Debts/ }).click();
    await settle(600);
    await shot(`${prefix}-01c-board-debts`);
    // v0.22: the archive — small rows with their date.
    await page.locator('.screen[data-role="top"] [role="tab"]').filter({ hasText: /Архив|Archive/ }).click();
    await settle(700);
    await shot(`${prefix}-01d-board-archive`);
    await page.locator('.screen[data-role="top"] [role="tab"]').filter({ hasText: /^(Все|All)/ }).click();
    // v0.22: «Вид» — the sheet, and the board in «Компактно» (then back to large cards for the rest of the tour).
    await page.locator('.screen[data-role="top"]').getByRole('button', { name: /^(Вид|View)$/ }).click();
    await settle(700);
    await shot(`${prefix}-01e-board-view`);
    await page.getByRole('dialog').locator('.mantine-SegmentedControl-label', { hasText: /Компактно|Compact/ }).click();
    await page.locator('.mantine-Modal-close').first().click();
    await settle(600);
    await shot(`${prefix}-01f-board-compact`);
    // (A hash of the same page is no reload: the view in memory would stay.)
    await page.evaluate(() => localStorage.removeItem('mygarage.board'));
    await page.reload();
    await settle(900);
    // A job with lines (not an appointment): its screen, its sheets.
    await page.locator('.screen[data-role="top"] .job-row').filter({ hasText: /Цена|Ждём|В работе|Price|Waiting|In work/ }).first().click();
    await settle(900);
    const order = await page.evaluate(() => location.hash);
    await shot(`${prefix}-02-job`);
    await shot(`${prefix}-02b-job-scrolled`, { scroll: 380 });
    // The job's "…" sheet, a line of it, and adding a part.
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await settle(600);
    await shot(`${prefix}-02c-job-more`);
    const closeSheet = async () => {
      await page.locator('.mantine-Modal-close').first().click();
      await settle(500);
    };
    await closeSheet();
    await page.locator('.screen[data-role="top"] .list-row.clickable').first().click();
    await settle(700);
    await shot(`${prefix}-02d-job-line`);
    await closeSheet();
    await page.locator('.screen[data-role="top"]').getByRole('button', { name: 'Запчасть', exact: true }).click();
    await settle(700);
    await shot(`${prefix}-02e-job-part`);
    await closeSheet();
    // The job card: the car's outline; a tap — a damage point with its kind (the first tour only: it writes).
    await page.locator('.screen[data-role="top"]').getByRole('button', { name: 'Job card', exact: true }).click();
    await settle(700);
    if (prefix === 'phone-light') {
      // The 3D car (or the drawing without WebGL): a tap on its middle — a point.
      const area = await page.getByRole('dialog').locator('canvas.car3d-canvas, svg[role="img"]').first().boundingBox();
      if (area) await page.mouse.click(area.x + area.width * 0.5, area.y + area.height * 0.55);
      await settle(600);
    }
    await shot(`${prefix}-02g-job-card`);
    await closeSheet();
    // Jobs on the other steps: waiting for the customer's answer, in work.
    for (const [k, step] of [[1, /Ждём|Waiting/], [2, /В работе|In work/]]) {
      await go('#/');
      await page.locator('.screen[data-role="top"] .job-row').filter({ hasText: step }).first().click();
      await settle(900);
      await shot(`${prefix}-02f-job-${k}`);
    }
    await go('#/orders/new');
    await shot(`${prefix}-04-new-order`);
    await go('#/search?q=' + encodeURIComponent('масло'));
    await shot(`${prefix}-05-search`);
    await go('#/money');
    await shot(`${prefix}-06-money`);
    if (prefix === 'phone-light') await page.evaluate(addCredit);
    await go('#/money?tab=debts');
    await shot(`${prefix}-06e-debts`);
    await go('#/money?tab=cash');
    await shot(`${prefix}-06b-cash`);
    // A movement opens as its line of the book (the job's payment here), with its photos: a card slip kept with it
    // (added once) puts a paperclip on its line.
    if (prefix === 'phone-light') await page.evaluate(addSlip);
    await settle(400);
    await shot(`${prefix}-06c-cash-photo`, { scroll: 520 });
    await page.locator('.screen[data-role="top"] .list-row.clickable').first().click();
    await settle(700);
    await shot(`${prefix}-06d-cash-entry`);
    await closeSheet();
    await go('#/reports');
    await shot(`${prefix}-06f-reports`);
    await shot(`${prefix}-06g-reports-scrolled`, { scroll: 600 });
    await go('#/more');
    await shot(`${prefix}-07-more`);
    // v0.22: the workshop's own notes (one written in the first tour).
    if (prefix === 'phone-light') {
      await page.evaluate(async () => {
        const { addNote, GARAGE_NOTES } = await import('/src/services/notes.ts');
        await addNote(GARAGE_NOTES, { text: 'Купить бумагу для принтера' });
        await addNote(GARAGE_NOTES, { text: 'Поменять лампочку в офисе' });
      });
    }
    await go('#/notes', 900);
    await shot(`${prefix}-07b-notes`);
    await go('#/settings');
    await shot(`${prefix}-08-settings`);
    // v0.22: Data — what deletes everything folded under «Сброс».
    await go('#/settings?tab=data');
    await shot(`${prefix}-08b-settings-data`, { scroll: 4000 });
    await page.locator('.screen[data-role="top"] .list-row').filter({ hasText: /^(Сброс|Reset)$/ }).click();
    await settle(600);
    await shot(`${prefix}-08c-settings-reset`, { scroll: 4000 });
    await go('#/customers');
    await shot(`${prefix}-09-customers`);

    await go('#/money?tab=expenses&add=1', 1200);
    await shot(`${prefix}-12-sheet`);
  };

  await tour('phone-light');
  await go('#/more');
  await page.locator('.screen[data-role="top"]').getByText(/^(Тёмная|Dark)$/).click();
  await settle(400);
  await tour('phone-dark');
  await go('#/more');
  await page.locator('.screen[data-role="top"]').getByText(/^(Светлая|Light)$/).click();

  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU' });
  if (CLOCK) await desk.clock.setFixedTime(CLOCK);
  await desk.addInitScript(() => localStorage.getItem('mygarage.feedback') ?? localStorage.setItem('mygarage.feedback', '0'));
  const dp = await desk.newPage();
  // The computer's browser has its own (empty) storage: the demo first, as on the phone.
  await dp.goto(BASE + '#/settings?tab=data');
  await dp.getByRole('button', { name: 'Загрузить демо-данные' }).click();
  await dp.getByText('Демо-данные загружены').first().waitFor({ timeout: 20000 });
  await dp.goto(BASE + '#/');
  await dp.waitForTimeout(1200);
  await dp.screenshot({ path: `${OUT}/desktop-01-board.png` });
  // v0.22: the board compact («Вид»), then back as it was.
  await dp.getByRole('button', { name: /^(Вид|View)$/ }).click();
  await dp.waitForTimeout(700);
  await dp.screenshot({ path: `${OUT}/desktop-01b-board-view.png` });
  await dp.getByRole('dialog').locator('.mantine-SegmentedControl-label', { hasText: /Компактно|Compact/ }).click();
  await dp.locator('.mantine-Modal-close').first().click();
  await dp.waitForTimeout(700);
  await dp.screenshot({ path: `${OUT}/desktop-01c-board-compact.png` });
  await dp.evaluate(() => localStorage.removeItem('mygarage.board'));
  await dp.reload();
  await dp.waitForTimeout(900);
  await dp.getByRole('button', { name: /^Архив/ }).click();
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: `${OUT}/desktop-01d-board-archive.png` });
  await dp.goto(BASE + '#/money');
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: `${OUT}/desktop-02-money.png` });
  await dp.goto(BASE + '#/reports');
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: `${OUT}/desktop-06-reports.png` });
  await dp.evaluate(async () => {
    const { addNote, GARAGE_NOTES } = await import('/src/services/notes.ts');
    await addNote(GARAGE_NOTES, { text: 'Купить бумагу для принтера' });
  });
  await dp.goto(BASE + '#/notes');
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: `${OUT}/desktop-07-notes.png` });
  await dp.goto(BASE + '#/settings?tab=data');
  await dp.waitForTimeout(900);
  await dp.locator('.list-row').filter({ hasText: /^Сброс$/ }).click();
  await dp.waitForTimeout(600);
  await dp.screenshot({ path: `${OUT}/desktop-08-settings-reset.png`, fullPage: true });
  // A movement of the cash box, opened.
  await dp.goto(BASE + '#/money?tab=cash');
  await dp.waitForTimeout(900);
  await dp.locator('.list-row.clickable').first().click();
  await dp.waitForTimeout(700);
  await dp.screenshot({ path: `${OUT}/desktop-03-cash-entry.png` });
  // v0.20: the board's "Debts" (a button in the header beside "Archive") and Money → Debts.
  await dp.keyboard.press('Escape');
  await dp.goto(BASE + '#/');
  await dp.waitForTimeout(900);
  await dp.getByRole('button', { name: /^Долги/ }).click();
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: `${OUT}/desktop-04-board-debts.png` });
  await dp.evaluate(addCredit);
  await dp.goto(BASE + '#/money?tab=debts');
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: `${OUT}/desktop-05-money-debts.png` });

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch((e) => {
  console.error('SHOTS FAILED:', String((e && e.message) || e).split('\n')[0]);
  process.exit(1);
});
