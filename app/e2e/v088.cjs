const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/*
 * v0.88 on the job screen, as the owner sees it (phone 390×844 and a PC 1440×900):
 * - a draft marked «не подтверждена» (its sheet's chip): pale, «?» and its word; out of «Клиенту · сумма»; «Согласен» and
 *   «Готово» leave it — the dialog says it will not be on the invoice; the invoice is without it, the line stays;
 * - over the car's name: the job's number and the day the car came;
 * - the car's photo keeps the moment it was taken (its own Exif), shown in its viewer.
 * Screenshots — test-results/v088/.
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/v088.cjs (BASE_URL to aim elsewhere).
 */
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = path.join(__dirname, '..', 'test-results', 'v088');
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

/** The fixture photo with an Exif saying it was taken on 20/11/2026 at 09:15 (UAE): an APP1 put right after its SOI. */
function photoTaken() {
  const jpg = fs.readFileSync(path.join(__dirname, 'fixtures', 'car.jpg'));
  const u16 = (v) => [v & 255, (v >> 8) & 255];
  const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const date = [...'2026:11:20 09:15:00'].map((c) => c.charCodeAt(0)).concat([0]);
  const exifIfd = 8 + 2 + 12 + 4;
  const strings = exifIfd + 2 + 12 + 4;
  const tiff = [0x49, 0x49, ...u16(42), ...u32(8), ...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfd), ...u32(0), ...u16(1), ...u16(0x9003), ...u16(2), ...u32(date.length), ...u32(strings), ...u32(0), ...date];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return Buffer.concat([jpg.subarray(0, 2), Buffer.from([0xff, 0xe1, (len >> 8) & 255, len & 255, ...app1]), jpg.subarray(2)]).toString('base64');
}

(async () => {
  const browser = await launch();
  const errors = [];
  const check = (ok, what) => {
    if (!ok) throw new Error('v0.88 e2e: ' + what);
    console.log('ok', what);
  };
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await phoneCtx.addInitScript(() => localStorage.setItem('mygarage.feedback', '0'));
  const page = await phoneCtx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  const top = (sel) => page.locator(`.screen[data-role="top"] ${sel}`);
  const settle = (ms = 500) => page.waitForTimeout(ms);
  await page.goto(BASE + '#/');
  await settle(1500);

  // A job: work and two parts, all priced; the car's photo taken on 20/11 (its Exif).
  const job = await page.evaluate(async (b64) => {
    const { checkIn } = await import('/src/services/orders.ts');
    const { addItem } = await import('/src/services/estimate.ts');
    const { syncStage } = await import('/src/services/flow.ts');
    const { setCover } = await import('/src/services/cover.ts');
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'Q', number: String(20000 + Math.floor(Math.random() * 70000)) }, make: 'Toyota', model: 'Veloz', name: 'Test owner', phone: '', docLanguage: 'en', complaint: 'Noise front', arrivedNow: true });
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Alignment', unitPriceFils: 10000 });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Steering boot', unitPriceFils: 7000 });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front wheel bearing', unitPriceFils: 25000 });
    await syncStage(o.id);
    await setCover(o.vehicleId, new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }));
    return { id: o.id, number: o.number };
  }, photoTaken());
  await page.goto(BASE + `#/orders/${job.id}`);
  await top('.large-title').first().waitFor({ timeout: 30000 });
  await settle(800);

  // The day the car came, over its name.
  const eyebrow = await top('.page-eyebrow').first().innerText();
  check(new RegExp(`№${job.number} · \\d{2}/\\d{2}/\\d{4}`).test(eyebrow), `the job's number and the day the car came over its name («${eyebrow}»)`);

  // «Клиенту · сумма» before: all three lines (105 + 73.50 + 262.50 = 441.00).
  const sendBtn = () => page.locator('button:visible', { hasText: /Клиенту ·/ }).last();
  await page.screenshot({ path: path.join(OUT, 'phone-00-job.png') });
  const before = await page.locator('button:visible').allInnerTexts();
  check(before.some((x) => /Клиенту ·[\s\S]*441[.,]00/.test(x)), `before: the quote counts every line (${before.filter((x) => /·/.test(x)).join(' | ')})`);

  // The bearing: its sheet, «Не подтверждена».
  // (Its own row: the nearest row around its name.)
  const bearing = () => top('.list-row').filter({ has: page.getByText('FRONT WHEEL BEARING', { exact: true }) }).last();
  await page.getByText('FRONT WHEEL BEARING', { exact: true }).first().click();
  await page.locator('[data-line-unconfirmed]').waitFor({ timeout: 10000 });
  await settle(700);
  await page.locator('[data-line-unconfirmed]').scrollIntoViewIfNeeded();
  await page.locator('[data-line-unconfirmed]').click();
  await page.waitForFunction(() => document.querySelector('[data-line-unconfirmed]')?.getAttribute('aria-pressed') === 'true');
  await settle(300);
  await page.screenshot({ path: path.join(OUT, 'phone-01-line-sheet.png') });
  await page.keyboard.press('Escape');
  await settle(700);
  check((await bearing().locator('.line-unconfirmed').count()) === 1 && (await top('.line-unconfirmed').count()) === 1, 'the line says it is not confirmed (it alone)');
  await page.screenshot({ path: path.join(OUT, 'phone-02-unconfirmed.png') });
  const after = (await page.locator('button:visible').allInnerTexts()).filter((x) => /·/.test(x));
  check(after.some((x) => /Клиенту ·[\s\S]*178[.,]50/.test(x)), `its sum is out of «Клиенту · сумма» (441.00 − 262.50 = 178.50: ${after.join(' | ')})`);

  // «Согласен», then «Готово»: the dialog says one line will not be on the invoice; the invoice is without it.
  await page.locator('button:visible', { hasText: 'Согласен' }).last().click();
  await page.locator('button:visible', { hasText: /^Готово ·/ }).last().waitFor({ timeout: 10000 });
  await page.locator('button:visible', { hasText: /^Готово ·/ }).last().click();
  await page.locator('[data-unconfirmed-out]').waitFor({ timeout: 10000 });
  check(/1 строка не подтверждена/.test(await page.locator('[data-unconfirmed-out]').innerText()), '«Готово» says the line will not be on the invoice');
  await settle(800);
  await page.screenshot({ path: path.join(OUT, 'phone-03-done-dialog.png') });
  await page.getByRole('button', { name: 'Выписать инвойс' }).click();
  await settle(1500);
  const inv = await page.evaluate(async (id) => {
    const { db } = await import('/src/db/db.ts');
    const invs = await db.invoices.where('orderId').equals(id).toArray();
    const items = await db.items.where('orderId').equals(id).toArray();
    return { total: invs[0]?.totalFils, lines: invs[0]?.lines.map((l) => l.description), bearing: items.find((i) => /BEARING/.test(i.titleEn ?? ''))?.approvalState };
  }, job.id);
  check(inv.total === 17850 && inv.lines.length === 2 && inv.bearing === 'draft', `the invoice without it, the line stays (${JSON.stringify(inv)})`);
  await page.screenshot({ path: path.join(OUT, 'phone-04-invoiced.png') });

  // The car's photo: when it was taken (its Exif), in its viewer.
  await top('.job-cover').first().click();
  await page.locator('[data-photo-moment]').waitFor({ timeout: 10000 });
  const moment = await page.locator('[data-photo-moment]').innerText();
  check(/20\/11\/2026 09:15/.test(moment), `the photo's own moment in its viewer («${moment}»)`);
  await settle(800);
  await page.screenshot({ path: path.join(OUT, 'phone-05-photo-moment.png') });
  await page.keyboard.press('Escape');

  // The owner's check: one page — this job, and one of fourteen lines.
  const pdfs = await page.evaluate(async (id) => {
    const { ownerCheckFile } = await import('/src/services/ownerCheck.ts');
    const { checkIn } = await import('/src/services/orders.ts');
    const { addItem } = await import('/src/services/estimate.ts');
    const big = await checkIn({ plate: { emirate: 'DXB', code: 'Q', number: String(20000 + Math.floor(Math.random() * 70000)) }, make: 'Nissan', model: 'Patrol', name: 'Fleet Co', phone: '', docLanguage: 'en', complaint: 'Service', arrivedNow: true });
    for (let k = 1; k <= 10; k++) await addItem(big.id, { kind: 'part', block: 'A', titleEn: `Part number ${k} for the front suspension`, unitPriceFils: 5000 + k * 1000, costPriceFils: 3000 + k * 800 });
    for (let k = 1; k <= 4; k++) await addItem(big.id, { kind: 'labor', block: 'A', titleEn: `Labour charge ${k}`, unitPriceFils: 10000 });
    const pages = async (orderId) => {
      const m = await ownerCheckFile(orderId, 'ru');
      const bytes = new Uint8Array(await m.pdf.blob.arrayBuffer());
      let b64 = '';
      for (let i = 0; i < bytes.length; i += 32768) b64 += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return { pages: (new TextDecoder('latin1').decode(bytes).match(/\/Type\s*\/Page[^s]/g) || []).length, b64: btoa(b64) };
    };
    return { small: await pages(id), big: await pages(big.id) };
  }, job.id);
  fs.writeFileSync(path.join(OUT, 'owner-check-3-lines.pdf'), Buffer.from(pdfs.small.b64, 'base64'));
  fs.writeFileSync(path.join(OUT, 'owner-check-14-lines.pdf'), Buffer.from(pdfs.big.b64, 'base64'));
  check(pdfs.small.pages === 1 && pdfs.big.pages === 1, `the owner's check is one page — 3 lines and 14 (${pdfs.small.pages}, ${pdfs.big.pages})`);

  // The same job on a PC.
  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await deskCtx.addInitScript(() => localStorage.setItem('mygarage.feedback', '0'));
  const desk = await deskCtx.newPage();
  desk.on('pageerror', (e) => errors.push(e.message));
  // (The PC's own database: the job is made there too.)
  await desk.goto(BASE + '#/');
  await desk.waitForTimeout(1500);
  const deskJob = await desk.evaluate(async () => {
    const { checkIn } = await import('/src/services/orders.ts');
    const { addItem } = await import('/src/services/estimate.ts');
    const { setUnconfirmed, syncStage } = await import('/src/services/flow.ts');
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'Q', number: String(20000 + Math.floor(Math.random() * 70000)) }, make: 'Toyota', model: 'Veloz', name: 'Test owner', phone: '', docLanguage: 'en', complaint: 'Noise front', arrivedNow: true });
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Alignment', unitPriceFils: 10000 });
    const b = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Front wheel bearing', unitPriceFils: 25000 });
    await setUnconfirmed([b.id], true);
    await syncStage(o.id);
    return o.id;
  });
  await desk.goto(BASE + `#/orders/${deskJob}`);
  await desk.locator('.line-unconfirmed').first().waitFor({ timeout: 30000 });
  await desk.waitForTimeout(800);
  await desk.screenshot({ path: path.join(OUT, 'desk-01-unconfirmed.png') });
  check(true, 'PC: the unconfirmed line on the job');

  check(errors.length === 0, `no errors in the browser (${errors.join(' | ')})`);
  console.log('V088 E2E OK');
  await browser.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
