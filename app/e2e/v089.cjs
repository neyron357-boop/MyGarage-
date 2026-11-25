const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/*
 * v0.89, as the owner sees it (phone 390×844, PC 1440×900), the garage's server and its AI played in the page:
 * - «Новый заказ»: the plate typed fast keeps every digit; the complaint is the owner's words only (no ready phrases);
 * - a new car's photo: its make and model put in by the AI («по фото»), the VIN after it says another car — the choice
 *   right there; on a job the same question under the car's name («Фото ≠ VIN»), one tap answers it;
 * - the PC's own tabs: a right click on a section — «Открыть в новой вкладке»; N in that tab opens there; the wheel on a
 *   job's card — a tab behind; × closes.
 * Screenshots — test-results/v089/.
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/v089.cjs (BASE_URL to aim elsewhere).
 */
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = path.join(__dirname, '..', 'test-results', 'v089');
fs.mkdirSync(OUT, { recursive: true });
// Made-up VINs: a Toyota built in Indonesia, and its maker's code alone for the form.
const VELOZ_VIN = 'MHFAB1BY4P3069309';

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
    if (!ok) throw new Error('v0.89 e2e: ' + what);
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
  await page.goto(BASE + '#/');
  await settle(1500);

  // The garage's AI played: the photo says a Nissan Patrol; the VIN's own decoder knows nothing more than its maker.
  const play = async (car) =>
    page.evaluate(async (car) => {
      const { setAiTransport } = await import('/src/services/ai.ts');
      const { setVinDecoder } = await import('/src/services/vinDecode.ts');
      window.__aiAsked = [];
      setAiTransport(async (p, body) => {
        window.__aiAsked.push(p);
        if (p === 'car') return { isCar: true, make: car.make, model: car.model, confidence: 0.8 };
        if (p === 'vin') return { vin: body.vin, make: 'Toyota', model: 'Veloz', year: 2023, confidence: 0.9 };
        throw new Error('not played');
      });
      setVinDecoder(async () => null);
    }, car);
  await play({ make: 'Nissan', model: 'Patrol' });

  // «Новый заказ»: no ready complaints; the plate typed fast.
  await page.goto(BASE + '#/orders/new');
  const number = top('input[inputmode="numeric"]').first();
  await number.waitFor();
  await settle(800);
  check((await top('.chip-row.wrap').count()) === 0 && (await top('textarea[aria-label="Жалоба клиента"]').count()) === 1, 'new job: the complaint is free words only — no ready phrases');
  await number.focus();
  const cdp = await phoneCtx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const digits = '48302';
  for (const d of digits) {
    await cdp.send('Input.insertText', { text: d });
    await page.waitForTimeout(45);
  }
  await settle(900);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  check((await number.inputValue()) === digits, `new job: the plate typed fast keeps every digit (${await number.inputValue()})`);

  // A new car's photo (held as «＋ → Фото номера» holds it, its plate read off the frames): the AI puts in the make.
  const plate = String(30000 + Math.floor(Math.random() * 60000));
  const photoId = await page.evaluate(
    async ({ plate, b64 }) => {
      const { holdCarShot } = await import('/src/features/orders/carShot.ts');
      const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' });
      return holdCarShot(new File([blob], 'car.jpg', { type: 'image/jpeg' }), { emirate: 'DXB', code: 'G', number: plate, sure: true, codeSure: true });
    },
    { plate, b64: fs.readFileSync(path.join(__dirname, 'fixtures', 'car.jpg')).toString('base64') },
  );
  // (From the board, as «＋ → Фото номера» opens it.)
  await page.goto(BASE + '#/');
  await settle(600);
  await page.goto(BASE + `#/orders/new?photo=${photoId}`);
  await top('[data-by-photo]').waitFor({ timeout: 15000 });
  await settle(400);
  const makeChip = await top('.chip[data-active="true"]').allInnerTexts();
  check(makeChip.includes('Nissan'), `new job: the make off the car's photo, said «по фото» (${makeChip.join(', ')})`);
  check((await page.evaluate(() => window.__aiAsked.filter((p) => p === 'car').length)) === 1, 'new job: the photo asked once');
  await page.screenshot({ path: `${OUT}/phone-01-by-photo.png` });
  // The VIN typed: its maker is Toyota — the person chooses.
  await top(`[aria-label="Ввести VIN"]`).click();
  await top('input[aria-label="VIN"]').fill(VELOZ_VIN);
  await top('[data-car-clash]').waitFor({ timeout: 10000 });
  await top('[data-car-clash]').scrollIntoViewIfNeeded();
  await settle(400);
  await page.screenshot({ path: `${OUT}/phone-02-clash.png` });
  check((await top('[data-car-clash] [data-car-pick="vin"]').innerText()).includes('Toyota'), 'new job: the photo and the VIN apart — both shown to choose from');
  await top('[data-car-clash] [data-car-pick="vin"]').click();
  await settle(400);
  check((await top('[data-car-clash]').count()) === 0 && (await top('.chip[data-active="true"]').allInnerTexts()).includes('Toyota'), 'new job: the VIN chosen — the make is the VIN’s');

  // On a job: the photo said a Land Cruiser, the VIN a Veloz — «Фото ≠ VIN» under the car's name; a tap answers it.
  const job = await page.evaluate(async (vin) => {
    const { checkIn } = await import('/src/services/orders.ts');
    const { takePhotoCar } = await import('/src/services/carPhoto.ts');
    const { updateVehicle } = await import('/src/services/customers.ts');
    const { db } = await import('/src/db/db.ts');
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'H', number: String(20000 + Math.floor(Math.random() * 9000)) }, make: '', model: '', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    await takePhotoCar(o.vehicleId, { make: 'Toyota', model: 'Land Cruiser' });
    await updateVehicle(o.vehicleId, { vin });
    for (let i = 0; i < 50 && !(await db.vehicles.get(o.vehicleId))?.carCheck; i++) await new Promise((r) => setTimeout(r, 50));
    return o.id;
  }, VELOZ_VIN);
  await page.goto(BASE + `#/orders/${job}`);
  await top('[data-car-check]').waitFor({ timeout: 15000 });
  await settle(600);
  await page.screenshot({ path: `${OUT}/phone-03-job-pill.png` });
  check((await top('.large-title').first().innerText()).includes('Land Cruiser'), 'job: the photo’s word stays in the card until a person chooses');
  await top('[data-car-check]').click();
  const sheet = page.getByRole('dialog', { name: 'Фото или VIN?' });
  await sheet.waitFor();
  await settle(500);
  await page.screenshot({ path: `${OUT}/phone-04-job-choice.png` });
  await sheet.locator('[data-car-pick="vin"]').click();
  await sheet.waitFor({ state: 'hidden' });
  await settle(600);
  check((await top('.large-title').first().innerText()).includes('Veloz') && (await top('[data-car-check]').count()) === 0, 'job: the VIN chosen — the card says Veloz, the question is gone');
  await phoneCtx.close();

  /* ---------- The PC: the app's own tabs ---------- */
  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU' });
  await deskCtx.addInitScript(() => localStorage.setItem('mygarage.feedback', '0'));
  const p = await deskCtx.newPage();
  watch(p);
  await p.goto(BASE + '#/');
  await p.waitForTimeout(1200);
  await p.evaluate(async () => (await import('/src/services/demo.ts')).loadDemoData());
  await p.goto(BASE + '#/settings');
  await p.goto(BASE + '#/');
  await p.locator('.dcard-open').first().waitFor({ timeout: 20000 });
  await p.waitForTimeout(600);
  check((await p.locator('.desk-tabs').count()) === 0, 'PC: one tab — no strip of tabs');
  await p.locator('.desk-nav-item', { hasText: 'Клиенты' }).click({ button: 'right' });
  await p.getByRole('menuitem', { name: 'Открыть в новой вкладке' }).click();
  await p.locator('.desk-tabs').waitFor();
  await p.waitForTimeout(700);
  const front = () => p.locator('.desk-tab:not([style*="none"])');
  check((await p.locator('.desk-tab-chip').count()) === 2 && (await front().getAttribute('data-tab')) !== 'main', 'PC: a section’s right click — «Открыть в новой вкладке»: two tabs, the new one in front');
  check((await front().locator('.desk-title').innerText()).includes('Клиенты') && (await p.evaluate(() => location.hash)) === '#/', 'PC: … the customers in it, the window’s own tab where it was');
  await p.keyboard.press('n');
  await front().locator('.desk-title', { hasText: 'Новый заказ' }).waitFor();
  check((await p.locator('.desk-tab-chip[data-active]').innerText()).includes('Новый заказ'), 'PC: N in that tab — the new job opens in it');
  await p.locator('[data-tab-chip="main"]').click();
  await p.waitForTimeout(500);
  const card = p.locator('.desk-tab[data-tab="main"] .dcard-open').first();
  await card.click({ button: 'middle' });
  await p.waitForTimeout(800);
  check((await p.locator('.desk-tab-chip').count()) === 3 && (await front().getAttribute('data-tab')) === 'main', 'PC: the wheel on a job’s card — a tab behind, the board stays in front');
  await p.screenshot({ path: `${OUT}/pc-01-tabs.png` });
  // A job's card's own menu says it too.
  await card.click({ button: 'right' });
  check(await p.getByRole('menuitem', { name: 'Открыть в новой вкладке' }).isVisible(), 'PC: a job card’s menu — «Открыть в новой вкладке»');
  await p.keyboard.press('Escape');
  // The sticky bar sits under the strip, nothing under it scrolls sideways.
  const under = await p.evaluate(() => {
    const strip = document.querySelector('.desk-tabs').getBoundingClientRect();
    const bar = document.querySelector('.desk-tab:not([style*="none"]) .desk-bar').getBoundingClientRect();
    return { strip: Math.round(strip.bottom), bar: Math.round(bar.top), wide: document.documentElement.scrollWidth <= window.innerWidth + 1 };
  });
  check(under.bar >= under.strip - 1 && under.wide, `PC: the screen’s bar under the tabs (${under.strip} / ${under.bar}), no sideways scroll`);
  while ((await p.locator('.desk-tab-chip').count()) > 1) {
    await p.locator('.desk-tab-chip').last().hover();
    await p.locator('.desk-tab-chip').last().locator('.desk-tab-x').click();
    await p.waitForTimeout(300);
  }
  check((await p.locator('.desk-tabs').count()) === 0, 'PC: the tabs closed — the strip goes');
  await deskCtx.close();

  await browser.close();
  if (errors.length) throw new Error('console errors: ' + errors.slice(0, 5).join(' | '));
  console.log('v0.89 e2e: all good');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
