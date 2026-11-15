const { chromium } = require('playwright');
const path = require('path');
/*
 * The job card's photo chips with a finger (v0.21): touches as a phone sends them (CDP), on VIN and Mulkiya —
 * a tap opens the camera; a still hold opens the phone's photos and nothing else; a hold that drifts off, or a scroll
 * that starts on a chip, opens nothing; a photo picked lands on the chip pressed and is still there after reopening;
 * a saved photo opens with a tap; a hold on a mechanic's chip opens their task, a tap still puts them on or off.
 * Needs the dev server: npm run dev -- --port 5173, then npm run e2e:photo.
 */
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const FIXTURE = path.join(__dirname, 'fixtures', 'car.jpg');

async function launch() {
  for (const channel of [process.env.E2E_BROWSER, 'chromium', 'chrome', 'msedge'].filter(Boolean)) {
    try {
      return await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), args: ['--enable-unsafe-swiftshader'] });
    } catch {
      // next
    }
  }
  throw new Error('no browser: npx playwright install chromium, or install Chrome / Edge');
}

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', hasTouch: true, isMobile: true });
  if (process.env.E2E_HAPTIC_LABELS === '1') await ctx.addInitScript(() => localStorage.setItem('mygarage.hapticLabels', '1'));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 300)));
  let failed = 0;
  const step = async (name, fn) => {
    try {
      await fn();
      console.log('OK  ', name);
    } catch (e) {
      failed++;
      console.log('FAIL', name, String(e.message).split('\n')[0]);
    }
  };
  const front = (sel) => page.locator(`.screen[data-role="top"] ${sel}`);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 3, radiusY: 3, force: 1 })) });
  const center = async (loc) => {
    const b = await loc.boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  // Which pickers a gesture opened, in order: 'camera' (capture) or 'photos'.
  const opened = [];
  const waiting = [];
  page.on('filechooser', async (fc) => {
    opened.push((await fc.element().getAttribute('capture')) ? 'camera' : 'photos');
    waiting.push(fc);
  });
  const gesture = async (fn, settle = 1200) => {
    opened.length = 0;
    waiting.length = 0;
    await fn();
    await page.waitForTimeout(settle);
    return [...opened];
  };
  const tap = async (loc) => {
    const at = await center(loc);
    await touch('touchStart', [at]);
    await page.waitForTimeout(70);
    await touch('touchEnd', []);
  };
  const hold = async (loc, { drift = 0, ms = 650 } = {}) => {
    const [x, y] = await center(loc);
    await touch('touchStart', [[x, y]]);
    await page.waitForTimeout(ms);
    for (let i = 1; i <= 4 && drift; i++) await touch('touchMove', [[x + (drift * i) / 4, y]]);
    await touch('touchEnd', []);
  };
  const scrollFrom = async (loc) => {
    const [x, y] = await center(loc);
    await touch('touchStart', [[x, y]]);
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', [[x, y - i * 14]]);
      await page.waitForTimeout(45);
    }
    await touch('touchEnd', []);
  };
  const expectOpened = (got, want, what) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: ${JSON.stringify(got)} instead of ${JSON.stringify(want)}`);
  };

  await page.goto(BASE);
  await page.getByText('Мастерская', { exact: true }).first().waitFor();
  const ids = await page.evaluate(async () => {
    const { db, uid } = await import('/src/db/db.ts');
    const { checkIn } = await import('/src/services/orders.ts');
    for (const name of ['Ravi', 'Sami']) await db.employees.add({ id: uid(), name, role: 'mechanic', monthlySalaryFils: 0, active: true });
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'P', number: String(Math.floor(Math.random() * 90000) + 10000) }, make: 'Nissan', model: 'Sunny', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    return { order: o.id, vehicle: o.vehicleId };
  });
  const docs = () =>
    page.evaluate(async (vehicleId) => {
      const { vinPhotoOf, mulkiyaOf } = await import('/src/services/cover.ts');
      const m = await mulkiyaOf(vehicleId);
      return { vin: await vinPhotoOf(vehicleId), front: m.mulkiya, back: m.mulkiya_back };
    }, ids.vehicle);
  await page.goto(BASE + '#/orders/' + ids.order);
  const vin = front('button.vin-chip[aria-label="Снять VIN"]');
  const mulkiya = front('button.vin-chip[aria-label="Снять Mulkiya"]');
  await vin.waitFor();
  await page.waitForTimeout(800);

  await step('empty VIN: a tap opens the camera', async () => {
    expectOpened(await gesture(() => tap(vin)), ['camera'], 'tap');
    await waiting[0].setFiles([]);
  });
  await step('empty VIN: a still hold opens the photos, and only them', async () => {
    const got = await gesture(() => hold(vin));
    expectOpened(got, ['photos'], 'hold');
    await waiting[0].setFiles([]);
  });
  await step('empty VIN: the thumb shifting a little as it lifts after the hold — still the photos', async () => {
    expectOpened(await gesture(() => hold(vin, { drift: 14 })), ['photos'], 'hold + 14 px');
    await waiting[0].setFiles([]);
  });
  await step('empty VIN: a hold that drifts away opens nothing', async () => {
    expectOpened(await gesture(() => hold(vin, { drift: 60 })), [], 'hold + 60 px');
  });
  await step('empty VIN and Mulkiya: a scroll that starts on the chip opens nothing', async () => {
    expectOpened(await gesture(() => scrollFrom(vin)), [], 'scroll from VIN');
    await front('.screen-scroll').first().evaluate((el) => el.scrollTo(0, 0));
    await page.waitForTimeout(300);
    expectOpened(await gesture(() => scrollFrom(mulkiya)), [], 'scroll from Mulkiya');
    await front('.screen-scroll').first().evaluate((el) => el.scrollTo(0, 0));
    await page.waitForTimeout(300);
  });
  await step('empty Mulkiya: a tap — the camera; a hold — the photos (both sides at once)', async () => {
    expectOpened(await gesture(() => tap(mulkiya)), ['camera'], 'tap');
    await waiting[0].setFiles([]);
    expectOpened(await gesture(() => hold(mulkiya)), ['photos'], 'hold');
    if ((await waiting[0].element().getAttribute('multiple')) === null) throw new Error('the Mulkiya from the photos must take several');
    await waiting[0].setFiles([]);
  });
  await step('photos from the phone go to the chip pressed: VIN to VIN, Mulkiya to its front', async () => {
    await gesture(() => hold(vin));
    await waiting[0].setFiles(FIXTURE);
    await front('button.vin-chip[aria-label="Фото VIN"] img').waitFor({ timeout: 15000 });
    await gesture(() => hold(mulkiya));
    await waiting[0].setFiles(FIXTURE);
    await front('button.vin-chip[aria-label="Mulkiya"] .vin-thumb').first().waitFor({ timeout: 15000 });
    const d = await docs();
    if (!d.vin || !d.front || d.back) throw new Error('documents: ' + JSON.stringify(d));
    if (d.vin === d.front) throw new Error('the VIN and the Mulkiya share one photo');
  });
  await step('a saved photo opens with a tap — VIN and Mulkiya ("1/2") — with camera and photos to replace it', async () => {
    for (const label of ['Фото VIN', 'Mulkiya']) {
      expectOpened(await gesture(() => tap(front(`button.vin-chip[aria-label="${label}"]`)), 900), [], 'tap on a saved ' + label);
      const view = page.locator('.viewer');
      await view.getByRole('button', { name: 'Переснять' }).waitFor();
      await view.getByRole('button', { name: 'Из фото' }).waitFor();
      if (label === 'Mulkiya') {
        // The missing back: a tap — the camera, a hold — the photos; it lands on the back.
        const addBack = view.getByRole('button', { name: 'Mulkiya, оборот' });
        expectOpened(await gesture(() => tap(addBack)), ['camera'], 'tap on "back"');
        await waiting[0].setFiles([]);
        expectOpened(await gesture(() => hold(addBack)), ['photos'], 'hold on "back"');
        await waiting[0].setFiles(FIXTURE);
        await front('button.vin-chip[aria-label="Mulkiya"] .vin-thumb').nth(1).waitFor({ timeout: 15000 });
        // The side just added is the one shown.
        await view.getByText('Mulkiya, оборот', { exact: true }).waitFor({ timeout: 5000 });
      }
      expectOpened(await gesture(() => view.getByRole('button', { name: 'Из фото' }).click()), ['photos'], 'replace from the photos');
      await waiting[0].setFiles([]);
      expectOpened(await gesture(() => view.getByRole('button', { name: 'Переснять' }).click()), ['camera'], 'retake');
      await waiting[0].setFiles([]);
      await page.keyboard.press('Escape');
      await view.waitFor({ state: 'detached' });
    }
  });
  await step('opened again: both documents\' photos are where they were put', async () => {
    const before = await docs();
    await page.reload();
    await front('button.vin-chip[aria-label="Фото VIN"] img').waitFor({ timeout: 15000 });
    await front('button.vin-chip[aria-label="Mulkiya"] .vin-thumb').nth(1).waitFor({ timeout: 15000 });
    const after = await docs();
    if (JSON.stringify(after) !== JSON.stringify(before) || !after.vin || !after.front || !after.back) throw new Error(JSON.stringify({ before, after }));
  });
  await step('another finger resting on the glass does not cancel a hold on the chip', async () => {
    const [x, y] = await center(front('button.vin-chip[aria-label="Фото VIN"]'));
    const rest = [8, 700];
    const got = await gesture(async () => {
      await touch('touchStart', [rest]);
      await touch('touchStart', [rest, [x, y]]);
      for (let i = 1; i <= 4; i++) {
        await page.waitForTimeout(150);
        // The holding finger trembles a pixel; the resting one stays.
        await touch('touchMove', [rest, [x + (i % 2), y]]);
      }
      await touch('touchEnd', [rest]);
      await touch('touchEnd', []);
    });
    expectOpened(got, ['photos'], 'hold beside a resting finger');
    await waiting[0].setFiles([]);
  });
  await step('a press that drifted, then held long — nothing opens', async () => {
    const [x, y] = await center(front('button.vin-chip[aria-label="Фото VIN"]'));
    const got = await gesture(async () => {
      await touch('touchStart', [[x, y]]);
      await touch('touchMove', [[x + 10, y]]);
      await page.waitForTimeout(1500);
      await touch('touchEnd', []);
    });
    expectOpened(got, [], 'drift then hold');
  });
  await step('two photos from the phone on a Mulkiya with one side: front, then back', async () => {
    const id = await page.evaluate(async () => {
      const { checkIn } = await import('/src/services/orders.ts');
      return (await checkIn({ plate: { emirate: 'DXB', code: 'Q', number: String(Math.floor(Math.random() * 90000) + 10000) }, make: 'Kia', model: 'Rio', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true })).id;
    });
    await page.goto(BASE + '#/orders/' + id);
    const chip = front('button.vin-chip[aria-label="Снять Mulkiya"]');
    await chip.waitFor();
    await page.waitForTimeout(500);
    await gesture(() => tap(chip));
    await waiting[0].setFiles({ name: 'first.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    const one = front('button.vin-chip[aria-label="Mulkiya"]');
    await one.getByText('1/2').waitFor({ timeout: 15000 });
    const sizes = async () =>
      page.evaluate(async () => {
        const { db } = await import('/src/db/db.ts');
        const { mulkiyaOf } = await import('/src/services/cover.ts');
        const o = await db.orders.get(location.hash.match(/orders\/([^/?]+)/)[1]);
        const m = await mulkiyaOf(o.vehicleId);
        const name = async (id) => (id ? (await db.media.get(id))?.fileName ?? (await db.media.get(id))?.name ?? id : null);
        return { front: await name(m.mulkiya), back: await name(m.mulkiya_back) };
      });
    const before = await sizes();
    expectOpened(await gesture(() => hold(one)), ['photos'], 'hold on "1/2"');
    await waiting[0].setFiles([{ name: 'car.jpg', mimeType: 'image/jpeg', buffer: require('fs').readFileSync(FIXTURE) }, { name: 'second.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }]);
    await one.locator('.vin-thumb').nth(1).waitFor({ timeout: 15000 });
    const after = await sizes();
    // Both sides replaced in order: the front by the first photo picked, the back by the second.
    if (!after.front || !after.back || after.front === before.front) throw new Error('two photos: ' + JSON.stringify({ before, after }));
    const order = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const { mulkiyaOf } = await import('/src/services/cover.ts');
      const o = await db.orders.get(location.hash.match(/orders\/([^/?]+)/)[1]);
      const m = await mulkiyaOf(o.vehicleId);
      const big = async (id) => (await db.mediaBlobs.get(id))?.blob?.size ?? 0;
      return { front: await big(m.mulkiya), back: await big(m.mulkiya_back) };
    });
    // The first photo (the car fixture) is the large one; the second is a 1×1 picture.
    if (!(order.front > order.back)) throw new Error('the sides were swapped: ' + JSON.stringify(order));
  });
  await page.goto(BASE + '#/orders/' + ids.order);
  // A fresh page: a tap during the screen's slide would miss the chip.
  await page.reload();
  await front('button.vin-chip[aria-label="Фото VIN"]').waitFor();
  await page.waitForTimeout(600);
  await step("a mechanic's chip: a tap puts them on; a hold opens the task and leaves the chip as it is", async () => {
    const chip = front('button.mechanic-chip').first();
    await tap(chip);
    await front('button.mechanic-chip[aria-pressed="true"]').first().waitFor();
    await hold(chip);
    const task = page.getByRole('dialog').filter({ hasText: /To do|Complaint|#\d+/ });
    await task.first().waitFor({ timeout: 5000 });
    if ((await front('button.mechanic-chip[aria-pressed="true"]').count()) !== 1) throw new Error('the hold changed the chip');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.waitForTimeout(400);
    await tap(chip);
    await front('button.mechanic-chip[aria-pressed="true"]').waitFor({ state: 'detached' });
  });

  console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED', e.message.split('\n')[0]);
  process.exit(1);
});
