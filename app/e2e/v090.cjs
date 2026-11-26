const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/*
 * v0.90, as the owner sees it (phone 390×844, PC 1440×900), all names and numbers made up:
 * - «GEAR OIL -- 450» in the quick sheet: the line and its sale price at once (#73);
 * - the job's first part brings its labour charge — last of the lines, named by the part, priced by the garage's history
 *   («по истории») (#70);
 * - «Варианты»: two options of the quote (original / copy), each its lines and total, its PDF in the app's own viewer, one
 *   message for both, «Выбрать» (#72);
 * - a PDF in the app's own viewer: pages, zoom (PC: + and the capsule), «Назад» closes it (the owner's request);
 * - a job made of a WhatsApp request: in «Заявки», its card with «Отменить» (#69 — the AI's answer played).
 * Screenshots — test-results/v090/.
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/v090.cjs (BASE_URL to aim elsewhere).
 */
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = path.join(__dirname, '..', 'test-results', 'v090');
fs.mkdirSync(OUT, { recursive: true });

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
  const errors = [];
  const check = (ok, what) => {
    if (!ok) throw new Error('v0.90 e2e: ' + what);
    console.log('ok', what);
  };
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  };

  /* ---------- The phone ---------- */
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await phoneCtx.addInitScript(() => localStorage.setItem('mygarage.feedback', '0'));
  const page = await phoneCtx.newPage();
  watch(page);
  const top = (sel) => page.locator(`.screen[data-role="top"] ${sel}`);
  const settle = (ms = 500) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
  await page.goto(BASE + '#/');
  await settle(1500);

  // The garage's history: an engine mount changed on another Altima for 300 + VAT; this car's job — new. Prices typed
  // with VAT, as the owner's (his screenshots: 504 + 315 = 819, VAT 39).
  const jobId = await page.evaluate(async () => {
    const { saveSettings } = await import('/src/services/settings.ts');
    await saveSettings({ pricesIncludeVat: true });
    const { checkIn } = await import('/src/services/orders.ts');
    const { addItem } = await import('/src/services/estimate.ts');
    const plate = (n) => ({ emirate: 'DXB', code: 'K', number: String(n) });
    const past = await checkIn({ plate: plate(40000 + Math.floor(Math.random() * 9000)), make: 'Nissan', model: 'Altima', name: 'Past Customer', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    await addItem(past.id, { kind: 'part', block: 'A', titleEn: 'ENGINE MOUNT', unitPriceFils: 40_000 });
    await addItem(past.id, { kind: 'labor', block: 'A', titleEn: 'LABOUR CHARGES', unitPriceFils: 30_000, unitGrossFils: 31_500 });
    const o = await checkIn({ plate: plate(50000 + Math.floor(Math.random() * 9000)), make: 'Nissan', model: 'Altima', name: 'Sam Test', phone: '', docLanguage: 'en', complaint: 'Engine mount', arrivedNow: true });
    return o.id;
  });
  await page.goto(BASE + `#/orders/${jobId}`);
  await top('[data-add-line]').first().waitFor();
  await settle(800);

  // #73: «-- 450» — the sale price at once.
  await top('[data-add-line]').first().click();
  const qa = page.locator('.mantine-Modal-content').filter({ has: page.locator('.qa-field') });
  await qa.waitFor();
  await qa.getByRole('radio', { name: 'Запчасть' }).click();
  await qa.locator('.qa-field input').fill('ENGINE MOUNT ORIGINAL -- 504');
  await qa.locator('[data-typed-price]').first().waitFor();
  check((await qa.locator('.qa-new [data-typed-price]').innerText()).includes('504'), '#73: «-- 504» — the price shown on the line to add');
  await shot('phone-01-quick-price');
  await qa.locator('.qa-field input').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.mantine-Modal-content .qa-added-name').length >= 1);
  await qa.locator('.qa-field input').fill('ENGINE MOUNT AFTERMARKET -- 300');
  await qa.locator('.qa-field input').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.mantine-Modal-content .qa-added-name').length >= 2);
  await qa.locator('.mantine-Modal-close').click();
  await qa.waitFor({ state: 'detached' });
  await settle(900);
  const lines = await page.evaluate(async (id) => {
    const { db } = await import('/src/db/db.ts');
    const { byPosition } = await import('/src/domain/items.ts');
    return (await db.items.where('orderId').equals(id).toArray()).sort(byPosition).map((i) => ({ t: i.titleEn, p: i.unitPriceFils, g: i.unitGrossFils, auto: !!i.autoLabour, guess: i.labourGuess?.basis }));
  }, jobId);
  check(lines.length === 3 && lines[0].t === 'ENGINE MOUNT ORIGINAL' && lines[1].t === 'ENGINE MOUNT AFTERMARKET', '#73: both lines named as typed before «--»: ' + JSON.stringify(lines));
  check(lines[0].g === 50_400 && lines[0].p === 48_000, '#73: … the original at 504 with VAT (as the garage types its prices)');
  // #70: the labour charge by itself — last, named by the part (one part: original and copy), the history's price.
  check(lines[2].auto && lines[2].t === 'LABOUR CHARGES: ENGINE MOUNT', '#70: the labour charge came by itself, last, named by the part: ' + lines[2].t);
  check(lines[2].p === 30_000 && lines[2].g === 31_500 && lines[2].guess === 'same', '#70: … priced as the same work before (300 + VAT)');
  await top('[data-labour-guess]').first().waitFor();
  await shot('phone-02-labour-by-history');

  // #72: «Варианты» — two options: the original, the copy.
  await top('button.add-extra[aria-label="Варианты сметы"]').click();
  const qo = page.locator('.mantine-Modal-content').filter({ has: page.locator('[data-qo-add]') });
  await qo.waitFor();
  await settle(400);
  await shot('phone-03-options-empty');
  await qo.locator('[data-qo-add]').click();
  await qo.locator('.qo-card[data-qo="2"]').waitFor();
  const lineIds = await page.evaluate(async (id) => {
    const { db } = await import('/src/db/db.ts');
    const { byPosition } = await import('/src/domain/items.ts');
    return (await db.items.where('orderId').equals(id).toArray()).sort(byPosition).map((i) => i.id);
  }, jobId);
  await qo.locator(`.qo-card[data-qo="1"] [data-qo-line="${lineIds[1]}"]`).click();
  await qo.locator(`.qo-card[data-qo="1"] [data-qo-line="${lineIds[1]}"][aria-pressed="false"]`).waitFor();
  await qo.locator(`.qo-card[data-qo="2"] [data-qo-line="${lineIds[0]}"]`).click();
  await qo.locator(`.qo-card[data-qo="2"] [data-qo-line="${lineIds[0]}"][aria-pressed="false"]`).waitFor();
  await qo.locator('.qo-card[data-qo="1"] .qo-name input').fill('Оригинал');
  await qo.locator('.qo-card[data-qo="1"] .qo-name input').press('Enter');
  await qo.locator('.qo-card[data-qo="2"] .qo-name input').fill('Копия');
  await qo.locator('.qo-card[data-qo="2"] .qo-name input').press('Enter');
  await settle(700);
  const totals = await qo.locator('.qo-head').allInnerTexts();
  check(totals.length === 2 && /819/.test(totals[0]) && /615/.test(totals[1]), '#72: each option its total — 504 + 315, 300 + 315: ' + totals.join(' | '));
  await shot('phone-04-options');

  // Its PDF in the app's own viewer.
  await qo.locator('.qo-card[data-qo="2"] [data-qo-pdf]').click();
  await page.locator('[data-pdf-viewer] .pdfv-page canvas').first().waitFor({ timeout: 60000 });
  const pdfTitle = await page.locator('[data-pdf-viewer] .cam-title-main').innerText();
  check(/-2 · Копия/.test(pdfTitle) && (await page.locator('[data-pdf-viewer] .pdfv-page').count()) === 1, '#72: the option’s PDF — one page, in the app’s own viewer: ' + pdfTitle);
  await settle(400);
  await shot('phone-05-option-pdf');
  await page.goBack();
  await page.locator('[data-pdf-viewer]').waitFor({ state: 'detached' });
  check(await qo.isVisible(), 'the viewer closed by «Назад» — the options sheet under it stays');

  // Both to the customer: one message.
  await qo.locator('[data-qo-send]').click();
  const send = page.locator('.mantine-Modal-content').filter({ has: page.locator('textarea') }).last();
  await send.waitFor({ timeout: 15000 });
  const text = await send.locator('textarea').first().inputValue();
  // (The customer's documents are in English: the message too.)
  check(/\*1\. Оригинал\*/.test(text) && /\*2\. Копия\*/.test(text) && /number of the option/.test(text) && /819/.test(text) && /615/.test(text), '#72: one message — each option, its lines and total: ' + text);
  await settle(400);
  await shot('phone-06-options-send');
  await page.keyboard.press('Escape');
  await settle(600);
  // The customer chose the copy.
  await top('button.add-extra[aria-label="Варианты сметы"]').click();
  await qo.waitFor();
  await qo.locator('.qo-card[data-qo="2"] [data-qo-choose]').click();
  await qo.locator('.qo-card[data-qo="2"] [data-qo-chosen]').waitFor();
  await page.keyboard.press('Escape');
  await settle(700);
  const after = await page.evaluate(async (id) => {
    const { db } = await import('/src/db/db.ts');
    const { byPosition } = await import('/src/domain/items.ts');
    return (await db.items.where('orderId').equals(id).toArray()).sort(byPosition).map((i) => [i.titleEn, !!i.unconfirmed]);
  }, jobId);
  check(after[0][1] === true && after[1][1] === false && after[2][1] === false, '#72: «Выбрать» — the copy and the labour on the job, the original not confirmed: ' + JSON.stringify(after));
  await top('.line-unconfirmed').first().waitFor();
  await shot('phone-07-chosen');

  // The quote's PDF from «…»: pages in the viewer, two fingers' zoom is the phone's (a double tap here).
  await top('button[aria-label="Ещё"]').first().click();
  await page.getByRole('dialog').locator('.action-tile').first().waitFor();
  await page.getByRole('dialog').locator('.action-tile', { hasText: 'Смета' }).first().click();
  await page.locator('[data-pdf-viewer] .pdfv-page canvas').first().waitFor({ timeout: 60000 });
  await settle(500);
  await shot('phone-08-quote-pdf');
  const w0 = await page.locator('[data-pdf-viewer] .pdfv-page').first().evaluate((e) => e.offsetWidth);
  await page.locator('[data-pdf-viewer] .pdfv-scroll').dblclick({ position: { x: 180, y: 300 } });
  await settle(600);
  const w1 = await page.locator('[data-pdf-viewer] .pdfv-page').first().evaluate((e) => e.offsetWidth);
  check(w1 > w0 * 1.5, `the viewer: a double tap — closer (${w0} → ${w1})`);
  await page.locator('[data-pdf-close]').click();
  await page.locator('[data-pdf-viewer]').waitFor({ state: 'detached' });

  // #69: a request in WhatsApp — the job in «Заявки» and its card (the AI's answer played; made by the main device).
  const req = await page.evaluate(async () => {
    const { requestPlan } = await import('/src/domain/waRequest.ts');
    const { makeRequestJob } = await import('/src/services/waRequest.ts');
    const { notifyAi } = await import('/src/services/ai.ts');
    const { deleteJob } = await import('/src/services/orders.ts');
    const plan = requestPlan({ isRequest: true, car: { make: 'Toyota', model: 'Camry', year: 2019, plate: { emirate: 'DXB', code: 'Q', number: String(60000 + Math.floor(Math.random() * 9000)) } }, items: [{ name: 'front brake pads', kind: 'part', both: true }], owner: 'Rami Test', confidence: 0.9 });
    const made = await makeRequestJob(plan, { id: '971500000777@c.us', name: 'Test Relay', phone: '971500000777' }, true, 'Front brake pads, original or copy?', 'false_test_1');
    notifyAi({ kind: 'request', orderId: made.orderId, number: made.number, car: 'Toyota Camry 2019', undo: async () => void (await deleteJob(made.orderId, { withRecords: true })) });
    return made;
  });
  await page.locator('[data-ai-notice="request"]').waitFor();
  await settle(400);
  await shot('phone-09-request-card');
  await page.locator(`[data-ai-request="${req.orderId}"]`).click();
  await page.waitForURL(new RegExp(`orders/${req.orderId}`));
  await top('.list-row').filter({ hasText: 'FRONT BRAKE PADS ORIGINAL' }).first().waitFor();
  await settle(700);
  await shot('phone-10-request-job');
  // Its options are there before the car comes: the prices go to the customer from the booked job.
  await top('button.add-extra[aria-label="Варианты сметы"]').click();
  await qo.locator('.qo-card[data-qo="2"]').waitFor();
  const names = await qo.locator('.qo-name input').evaluateAll((els) => els.map((e) => e.value));
  check(names.join('|') === 'Original|Aftermarket', '#69: the request’s options — original and copy: ' + names.join(' | '));
  await settle(400);
  await shot('phone-11-request-options');
  check(await qo.locator('[data-qo-send]').isDisabled(), '#72: options with a line still to price — not sent (no «0.00» to the customer)');
  await page.keyboard.press('Escape');
  await settle(500);
  const order = await page.evaluate(async (id) => (await (await import('/src/db/db.ts')).db.orders.get(id)), req.orderId);
  check(order.boardTab === 'request' && order.stage === 'booked' && order.quoteOptions?.length === 2, '#69: the request — a booked job in «Заявки» with two options');

  /* ---------- The PC ---------- */
  const pcCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await pcCtx.addInitScript(() => localStorage.setItem('mygarage.feedback', '0'));
  const p = await pcCtx.newPage();
  watch(p);
  await p.goto(BASE + '#/');
  await p.waitForTimeout(1500);
  const pcJob = await p.evaluate(async () => {
    const { checkIn } = await import('/src/services/orders.ts');
    const { addItem } = await import('/src/services/estimate.ts');
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'P', number: String(70000 + Math.floor(Math.random() * 9000)) }, make: 'Nissan', model: 'Patrol', name: 'Desk Test', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'RADIATOR', unitPriceFils: 90_000 });
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'LABOUR CHARGES', unitPriceFils: 20_000 });
    return o.id;
  });
  await p.goto(BASE + `#/orders/${pcJob}`);
  await p.locator('.action-tile', { hasText: 'Смета' }).first().click();
  await p.locator('[data-pdf-viewer] .pdfv-page canvas').first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/pc-01-pdf.png` });
  check(await p.locator('.pdfv-zoom').isVisible(), 'PC: the viewer’s zoom capsule');
  await p.keyboard.press('+');
  await p.waitForTimeout(700);
  check(/125/.test(await p.locator('.pdfv-zoom-n').innerText()), 'PC: «+» — 125 %');
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/pc-02-pdf-zoom.png` });
  await p.keyboard.press('Escape');
  await p.locator('[data-pdf-viewer]').waitFor({ state: 'detached' });
  check(p.url().includes(`/orders/${pcJob}`), 'PC: Escape closes the viewer only');

  if (errors.length) throw new Error('console errors: ' + errors.join(' | '));
  console.log('ERRORS: none');
  await browser.close();
})().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
