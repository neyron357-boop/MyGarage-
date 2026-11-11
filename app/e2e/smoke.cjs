const { chromium } = require('playwright');
const fs = require('fs');
// Browser smoke test of the whole job flow on a phone-sized screen.
// Usage: start the dev server (npm run dev -- --port 5173), then: node e2e/smoke.cjs [outDir]
// Browser: Playwright's Chromium if installed (npx playwright install chromium), otherwise the
// installed Google Chrome or Microsoft Edge. E2E_BROWSER=chromium|chrome|msedge forces one.
const path = require('path');
const SP = process.argv[2] || path.join(__dirname, '..', 'test-results', 'e2e');
const FIXTURE = path.join(__dirname, 'fixtures', 'car.jpg');
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
fs.mkdirSync(`${SP}/shots`, { recursive: true });

async function launchBrowser() {
  const forced = process.env.E2E_BROWSER;
  const channels = forced ? [forced] : ['chromium', 'chrome', 'msedge'];
  const failures = [];
  for (const channel of channels) {
    try {
      const browser = await chromium.launch(channel === 'chromium' ? {} : { channel });
      console.log(`browser: ${channel} ${browser.version()}`);
      return browser;
    } catch (e) {
      failures.push(`${channel}: ${String(e.message).split('\n')[0]}`);
    }
  }
  throw new Error('no browser for e2e: run "npx playwright install chromium" or install Google Chrome / Microsoft Edge. ' + failures.join('; '));
}

(async () => {
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: false, locale: 'ru-RU' });
  // E2E_HAPTIC_LABELS=1: lay the iPhone's haptic labels over the controls (they must not get in the way).
  // A segment is covered by its haptic switch, as the finger will be: a click that Playwright refuses as
  // "covered" is repeated at the same point (the switch gets it and picks the segment, like a tap).
  if (process.env.E2E_HAPTIC_LABELS === '1') {
    await ctx.addInitScript(() => localStorage.setItem('mygarage.hapticLabels', '1'));
    const proto = Object.getPrototypeOf((await ctx.newPage()).locator('body'));
    const click = proto.click;
    proto.click = async function (opts = {}) {
      try {
        return await click.call(this, { timeout: 4000, ...opts });
      } catch (e) {
        if (!/intercepts pointer events|Timeout/.test(String(e))) throw e;
        return click.call(this, { ...opts, force: true });
      }
    };
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  // Phone: the screen under the one in front stays mounted (hidden) to come back instantly — text and
  // label lookups mean the visible screen. (Role lookups skip hidden elements by themselves.)
  // The screen in front, sheets and toasts (portals), the PC page.
  const visibleArea = () => page.locator('.screen[data-role="top"], .page-shell, [data-portal]');
  for (const m of ['getByText', 'getByLabel', 'getByPlaceholder']) {
    page[m] = (...a) => visibleArea()[m](...a).filter({ visible: true });
  }
  const front = (sel) => page.locator(`.screen[data-role="top"] ${sel}, .page-shell ${sel}`);
  // Screens slide in (View Transitions): wait for that and any other animation before the picture.
  const settled = () => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))).catch(() => undefined);
  const shot = async (n, full = false) => {
    await settled();
    await page.screenshot({ path: `${SP}/shots/${n}.png`, fullPage: full });
  };
  const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); await shot('fail-' + name.replace(/\W+/g, '_')); throw e; } };

  await step('board empty', async () => { await page.goto(BASE); await page.getByText('Мастерская', { exact: true }).first().waitFor(); await shot('01-board-empty'); });
  await step('load demo', async () => {
    await page.goto(BASE + '#/settings?tab=data');
    await page.getByRole('button', { name: 'Загрузить демо-данные' }).click();
    await page.waitForTimeout(1500);
    await page.goto(BASE + '#/');
    await page.getByText('Camry').first().waitFor();
    await shot('02-board-demo', true);
  });
  await step('search by works and parts', async () => {
    // A Russian word finds the jobs by their lines (the English title too), highlighted.
    await page.goto(BASE + '#/search');
    // On a phone the keyboard waits for a tap: opening Search does not focus the field.
    await page.getByPlaceholder('Номер, имя, работа, деталь…').waitFor();
    await page.waitForTimeout(300);
    if (await page.evaluate(() => document.activeElement?.tagName === 'INPUT')) throw new Error('search must not open the keyboard by itself');
    await page.getByPlaceholder('Номер, имя, работа, деталь…').fill('колодки');
    await page.getByRole('heading', { name: 'Заказы' }).waitFor();
    await page.locator('.search-mark', { hasText: 'Колодки' }).first().waitFor();
    await page.getByPlaceholder('Номер, имя, работа, деталь…').fill('масляный фильтр camry');
    await page.locator('.search-mark', { hasText: /фильтр/i }).first().waitFor();
    await shot('02b-search-jobs');
  });
  await step('new order', async () => {
    // Fast check-in: the plate first, make and model from chips, the customer is optional.
    await page.goto(BASE + '#/orders/new');
    await page.getByLabel('Код').fill('B');
    await page.getByLabel('Номер').fill('55555');
    await page.getByRole('button', { name: 'Lexus', exact: true }).click();
    await page.getByRole('button', { name: 'RX 350', exact: true }).click();
    await page.getByLabel('Телефон').fill('050 777 8899');
    await page.getByLabel('Имя').fill('Сергей Иванов');
    await page.getByPlaceholder('Словами клиента: что беспокоит').fill('Стук спереди справа на неровностях, не холодит кондиционер');
    await shot('03-new-order', true);
    // One button: the car is accepted and its job opens — findings, prices and answers happen there.
    await page.getByRole('button', { name: 'Принять' }).click();
    await page.getByRole('button', { name: 'Работа', exact: true }).waitFor();
    await page.getByText('Смотрим').first().waitFor();
    await shot('03b-job-accepted');
    // The intake act with photos is optional: "…" → "Фото".
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Фото' }).click();
    await page.getByText('Шаг 1 из 6').waitFor();
  });
  await step('intake photos', async () => {
    for (let i = 0; i < 8; i++) {
      await front('input[type=file][accept="image/*"]').nth(i).setInputFiles(FIXTURE);
      await page.getByText(`${i + 1} / 8`).waitFor({ timeout: 10000 });
    }
    // The Mulkiya has two sides: both are shot.
    await front('button[aria-label="Mulkiya, оборот"]').first().waitFor();
    await shot('04-intake-photos', true);
  });
  await step('intake damage', async () => {
    await page.getByRole('button', { name: 'Дальше' }).click();
    const svg = front('svg[role=img]').first();
    const box = await svg.boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.25);
    await page.getByRole('dialog').getByText('Вмятина').click();
    await page.waitForTimeout(300);
    await page.getByRole('dialog').getByRole('button', { name: 'Готово' }).click();
    await page.waitForTimeout(300);
    await shot('05-intake-damage', true);
  });
  await step('intake dashboard', async () => {
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.getByLabel('Пробег').fill('87450');
    await page.getByText('½').click();
    await page.getByText('Check Engine').click();
    await shot('06-intake-dashboard', true);
  });
  await step('intake obd/checks', async () => {
    await page.getByRole('button', { name: 'Дальше' }).click();
    const tags = page.locator('input[placeholder="P0300"]');
    await tags.fill('P0300');
    await tags.press('Enter');
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.getByText('Шаг 6 из 6').waitFor();
    await shot('07-intake-finish', true);
  });
  await step('intake sign', async () => {
    const canvas = front('canvas').first();
    await canvas.scrollIntoViewIfNeeded();
    const c = await canvas.boundingBox();
    await page.mouse.move(c.x + 30, c.y + 110);
    await page.mouse.down();
    for (let i = 0; i < 20; i++) await page.mouse.move(c.x + 30 + i * 12, c.y + 110 - Math.sin(i / 2) * 40);
    await page.mouse.up();
    await shot('08-intake-sign', true);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByText('Отправить клиенту').first().waitFor({ timeout: 15000 });
    await page.getByText('Открыть чат').waitFor();
    await shot('09-send-dialog');
    await page.locator('.mantine-Modal-close').first().click();
    await page.getByRole('link', { name: 'Открыть заказ' }).or(page.getByRole('button', { name: 'Открыть заказ' })).first().click();
    await page.getByText('Смотрим').first().waitFor();
    await shot('10-job-after-intake', true);
    // Everything about the job (stages by hand, photos, documents, journal) stays under "…" → "Подробно".
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Подробно' }).click();
    await page.getByText('Диагностика / оценка').first().waitFor();
    await shot('10b-order-details', true);
  });
  await step('estimate', async () => {
    await page.getByRole('button', { name: 'Подробная оценка' }).first().click();
    await page.getByRole('button', { name: 'Из шаблона' }).first().click();
    await page.getByRole('dialog').getByText('Замена передних колодок').click();
    await page.getByText('Обычно вместе с этим меняют').waitFor();
    await page.getByRole('button', { name: '+ в B' }).first().click();
    await page.waitForTimeout(500);
    await shot('11-estimate', true);
    await page.getByRole('button', { name: 'Отправить на согласование' }).click();
    await page.getByRole('dialog').getByText('Клиент рядом', { exact: true }).click();
    await page.getByRole('button', { name: 'Зафиксировать версию' }).click();
    await page.getByRole('button', { name: 'Клиент согласен на всё' }).click();
    await shot('12-decisions', true);
    await page.getByRole('dialog').getByRole('button', { name: /^Сохранить ответ/ }).click();
    await page.getByText('Открыть чат').waitFor();
    await shot('13-verbal-confirmation');
    await page.locator('.mantine-Modal-close').first().click();
  });
  await step('order work tab', async () => {
    const url = page.url().replace('/estimate', '/details');
    await page.goto(url.split('?')[0] + '?tab=work');
    await page.getByText('Ждём запчасть').first().waitFor();
    await shot('14-order-work', true);
    await page.goto(url.split('?')[0] + '?tab=approvals');
    await shot('15-order-approvals', true);
  });
  await step('pdfs', async () => {
    const out = await page.evaluate(async () => {
      const docs = await import('/src/services/documents.ts');
      const { db } = await import('/src/db/db.ts');
      const toB64 = async (b) => { const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s); };
      const insp = (await db.inspections.toArray()).find((i) => i.locked);
      const v = (await db.versions.toArray()).pop();
      const a = await docs.inspectionPdf(insp.id);
      const e = await docs.versionPdf(v.id);
      const e2 = await docs.versionPdf((await db.versions.toArray())[0].id);
      return { intake: await toB64(a.blob), estimate: await toB64(e.blob), estimate2: await toB64(e2.blob) };
    });
    for (const [k, v] of Object.entries(out)) fs.writeFileSync(`${SP}/shots/${k}.pdf`, Buffer.from(v, 'base64'));
  });

  const closeModal = () => page.locator('.mantine-Modal-close').first().click();
  let patrol;
  await step('work done, QC, ready', async () => {
    patrol = await page.evaluate(async () => { const { db } = await import('/src/db/db.ts'); const v = (await db.vehicles.toArray()).find((x) => x.model === 'Patrol'); return (await db.orders.where('vehicleId').equals(v.id).first()).id; });
    await page.goto(BASE + `#/orders/${patrol}/details?tab=work`);
    await page.getByText('Согласовано').first().waitFor();
    const todo = page.getByRole('button', { name: 'Готово', exact: true });
    while (await todo.count()) { await todo.first().click(); await page.waitForTimeout(400); }
    await page.getByRole('button', { name: 'Работы выполнены → проверка' }).first().click();
    await page.getByRole('button', { name: 'Контроль качества' }).first().click();
    const qc = page.getByRole('dialog').locator('.choice-card');
    await qc.first().waitFor();
    for (let i = 0; i < await qc.count(); i++) await qc.nth(i).click();
    await shot('18-qc');
    await page.getByRole('button', { name: 'Проверка пройдена → Готово' }).click();
    await page.getByRole('button', { name: 'Выдача машины' }).waitFor();
  });
  await step('handover with invoice and payment', async () => {
    await page.getByRole('button', { name: 'Выдача машины' }).click();
    await page.getByText('Шаг 1 из 5').waitFor();
    for (let i = 0; i < 8; i++) {
      await front('input[type=file][accept="image/*"]').nth(i).setInputFiles(FIXTURE);
      await page.getByText(`${i + 1} / 8`).waitFor({ timeout: 10000 });
    }
    await shot('19-handover-photos', true);
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.getByLabel('Пробег').fill('150020');
    await page.getByText('¾').click();
    await page.getByRole('button', { name: 'Дальше' }).click();
    await shot('20-handover-summary', true);
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.getByRole('button', { name: 'Выписать инвойс' }).click();
    await page.getByRole('dialog').getByText('Выписать инвойс?').waitFor();
    await shot('20b-invoice-confirm');
    await page.getByRole('dialog').getByRole('button', { name: 'Выписать инвойс' }).click();
    await page.getByText('Открыть чат').waitFor();
    await closeModal();
    await page.getByRole('button', { name: 'Принять оплату' }).click();
    await page.getByRole('dialog').getByText('Карта', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Провести' }).click();
    await page.getByText('Оплачено (или оформлен долг) — можно подписывать').waitFor();
    await shot('21-handover-payment', true);
    await page.getByRole('button', { name: 'К подписи' }).click();
    const canvas = front('canvas').first();
    await canvas.scrollIntoViewIfNeeded();
    const c = await canvas.boundingBox();
    await page.mouse.move(c.x + 30, c.y + 100); await page.mouse.down();
    for (let i = 0; i < 15; i++) await page.mouse.move(c.x + 30 + i * 15, c.y + 100 - Math.cos(i / 2) * 30);
    await page.mouse.up();
    await page.getByRole('button', { name: 'Подписать и сохранить' }).click();
    await page.getByText('Открыть чат').waitFor({ timeout: 15000 });
    await closeModal();
    await page.goto(BASE + `#/orders/${patrol}`);
    await page.getByText('Закрыт').first().waitFor();
    await shot('22-order-closed', true);
  });
  await step('quick lists', async () => {
    // Settings → Lists: a line added to the complaints is a chip in "New job" (English by default).
    await page.goto(BASE + '#/settings?tab=lists');
    // The lines are editable fields: the standard complaints are their values.
    await page.locator('input.quick-input[value="Scheduled service"]').first().waitFor();
    const add = page.getByPlaceholder('Новая строка (на английском)').first();
    await add.fill('Wheel balancing');
    await add.press('Enter');
    await page.waitForTimeout(400);
    await shot('34-settings-lists', true);
    await page.goto(BASE + '#/orders/new');
    await page.getByRole('button', { name: 'Wheel balancing' }).waitFor();
    await page.getByRole('button', { name: 'Brake noise' }).waitFor();
  });
  await step('delete job', async () => {
    // A job opened by mistake: "…" → "Delete job" takes it off the board; "Undo" brings it back.
    await page.goto(BASE + '#/orders/new');
    await page.getByLabel('Номер').fill('27182');
    await page.getByRole('button', { name: 'Принять' }).click();
    await page.getByRole('button', { name: 'Работа', exact: true }).waitFor();
    const orderHash = await page.evaluate(() => location.hash);
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить заказ' }).click();
    await page.getByText(/удалён/).first().waitFor();
    await page.waitForTimeout(400);
    const gone = await page.evaluate((id) => new Promise((resolve) => {
      const open = indexedDB.open('mygarage');
      open.onsuccess = () => {
        const req = open.result.transaction('orders').objectStore('orders').get(id);
        req.onsuccess = () => { resolve(!req.result); open.result.close(); };
      };
    }), orderHash.split('/').pop());
    if (!gone) throw new Error('the job is still there');
    await page.getByRole('button', { name: 'Отменить' }).last().click();
    await page.waitForTimeout(600);
    await page.goto(BASE + orderHash);
    await page.getByText('27182').first().waitFor();
  });
  await step('job: findings, price, agreed, done, paid, gone', async () => {
    await page.goto(BASE + '#/orders/new');
    await page.getByLabel('Номер').fill('31415');
    await page.getByRole('button', { name: 'Nissan', exact: true }).click();
    await page.getByRole('button', { name: 'Sunny', exact: true }).click();
    await page.getByRole('button', { name: 'Brake noise', exact: true }).click();
    await shot('30-check-in');
    await page.getByRole('button', { name: 'Принять' }).click();
    // No photo of the car yet: the tile opens the camera; the shot becomes the car's main photo.
    await page.getByRole('button', { name: 'Фото машины' }).waitFor();
    await shot('30a-job-no-photo');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Фото машины' }).click()]);
    await chooser.setFiles({ name: 'car.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await page.getByRole('button', { name: 'Фото машины' }).locator('img').waitFor();
    const dlg = page.getByRole('dialog');
    // What the mechanic found: a job and a part (the part first without a price: still to find).
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    await dlg.getByLabel('Что сделали').fill('Замена масла');
    await dlg.getByLabel('Цена', { exact: true }).fill('150');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('button', { name: 'Запчасть', exact: true }).click();
    await dlg.getByLabel('Запчасть').fill('Фильтр салона');
    await dlg.getByLabel('Кол-во').fill('2');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByText('Фильтр салона').first().waitFor();
    // No price yet: the quote cannot go.
    if (!(await page.getByRole('button', { name: /^Клиенту/ }).isDisabled())) throw new Error('a line without a price must hold the quote');
    if (await page.getByRole('button', { name: /Спросить запчасти/ }).count()) throw new Error('no ask-for-parts button on the job');
    await page.getByText('Фильтр салона').first().click();
    await dlg.getByLabel('Закупка за шт.').fill('20');
    await dlg.getByLabel('Цена за шт.').fill('30');
    await dlg.getByRole('button', { name: 'Заказано' }).click();
    // A photo on the line (the part): picked in the sheet, saved with it; any photo can be shared or saved.
    await dlg.locator('input[data-photo-input="line"]').setInputFiles({ name: 'part.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await dlg.locator('.strip-tile img').first().waitFor();
    await shot('31-line-photo');
    await dlg.locator('.strip-tile img').first().click();
    await page.locator('.viewer').getByRole('button', { name: /Поделиться|Сохранить/ }).waitFor();
    await page.locator('.viewer button').first().click();
    await page.locator('.viewer').waitFor({ state: 'detached' });
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByText('220,50').first().waitFor(); // (150 + 2 × 30) AED + 5 % VAT
    await page.locator('.list-row').filter({ hasText: 'Фильтр салона' }).locator('svg[aria-label="Фото"]').waitFor();
    // A line without VAT (a fee paid for the customer): 100 AED stays 100 AED.
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    await dlg.getByLabel('Что сделали').fill('RTA test fee');
    await dlg.getByLabel('Цена', { exact: true }).fill('100');
    await dlg.getByText('Итого 105,00 AED, в т. ч. VAT 5,00').waitFor();
    await dlg.getByText('Без VAT', { exact: true }).click();
    await dlg.getByText('Итого 100,00 AED, без VAT').waitFor();
    await shot('31a-line-no-vat');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByText('320,50').first().waitFor(); // 220.50 + 100 without VAT
    // A discount before the invoice: one tap rounds the total down.
    await page.getByRole('button', { name: 'Скидка' }).click();
    await dlg.getByRole('button', { name: 'К оплате 320,00 AED' }).click();
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('button', { name: 'Клиенту · 320,00 AED' }).waitFor();
    // Split over the lines with VAT and without, the discount still shows once.
    if ((await page.locator('.list-row').filter({ hasText: /^Discount/ }).count()) !== 1) throw new Error('the discount must show as one line');
    await shot('31-job-price', true);
    // To the customer: the message is ready; closed without sending, the lines stay as they are.
    await page.getByRole('button', { name: 'Клиенту · 320,00 AED' }).click();
    await page.getByText('Открыть чат').waitFor();
    await page.locator('.mantine-Modal-close').first().click();
    // The customer agrees in person: the work starts, the part is marked as here.
    await page.getByRole('button', { name: 'Согласен' }).click();
    await page.getByText('В работе').first().waitFor();
    await page.getByText('Фильтр салона').first().click();
    await dlg.getByRole('button', { name: 'Есть' }).click();
    await shot('31b-line-actions');
    await page.locator('.mantine-Modal-close').first().click();
    await page.getByRole('button', { name: /^Готово/ }).click();
    await dlg.getByRole('button', { name: 'Выписать инвойс' }).click();
    await page.getByText(/INV-/).first().waitFor();
    // A discount after the invoice: credit note and a new invoice (10 % of 320.50 = 32.05).
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await shot('32a-more');
    await dlg.getByRole('button', { name: 'Скидка' }).click();
    await dlg.getByText('%', { exact: true }).click();
    await dlg.getByRole('button', { name: '10 %' }).click();
    await dlg.getByRole('button', { name: 'Оформить скидку' }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Оформить скидку' }).click();
    await page.getByRole('button', { name: 'Оплата · 288,45 AED' }).waitFor();
    await shot('32-job-invoiced', true);
    await page.getByRole('button', { name: /^Оплата/ }).click();
    await dlg.getByRole('button', { name: 'Провести' }).click();
    await page.getByRole('button', { name: 'Выдать' }).click();
    await page.getByText('Закрыт').first().waitFor();
    await shot('33-job-closed', true);
    // The board shows the cars by step; the closed one is gone from it.
    await page.goto(BASE + '#/');
    await page.locator('.job-row').first().waitFor();
    if (await page.getByText('31415').count()) throw new Error('a closed job is still on the board');
  });
  await step('a known car: its photo and owner come by themselves', async () => {
    await page.goto(BASE + '#/orders/new');
    await page.getByLabel('Номер').fill('31415');
    await page.getByLabel('Эта машина уже в базе').waitFor();
    await page.getByLabel('Эта машина уже в базе').locator('img').waitFor();
    if (await page.getByRole('button', { name: 'Nissan', exact: true }).count()) throw new Error('a known car needs no make');
    await shot('30c-known-car');
    await page.getByRole('button', { name: 'Принять' }).click();
    await page.getByRole('button', { name: 'Фото машины' }).locator('img').waitFor();
    await page.getByText('Nissan Sunny').first().waitFor();
    // Several lines off at once: “…” → Select, tap two, Delete · 2; Undo brings them back.
    const dlg = page.getByRole('dialog');
    for (const [name, price] of [['Wash', '30'], ['Polish', '80']]) {
      await page.getByRole('button', { name: 'Работа', exact: true }).click();
      await dlg.getByLabel('Что сделали').fill(name);
      await dlg.getByLabel('Цена', { exact: true }).fill(price);
      await dlg.getByRole('button', { name: 'Сохранить' }).click();
      await page.locator('.list-row').filter({ hasText: name }).first().waitFor();
    }
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Выбрать' }).click();
    await page.locator('.list-row').filter({ hasText: 'Wash' }).first().click();
    await page.locator('.list-row').filter({ hasText: 'Polish' }).first().click();
    await shot('30d-pick-lines');
    await page.getByRole('button', { name: 'Удалить · 2' }).click();
    await page.getByText('Удалено строк: 2').waitFor();
    if (await page.locator('.list-row').filter({ hasText: 'Polish' }).count()) throw new Error('the picked lines are still there');
    await page.getByRole('button', { name: 'Отменить' }).last().click();
    await page.locator('.list-row').filter({ hasText: 'Polish' }).first().waitFor();
  });
  await step('refused: the job closes without an invoice', async () => {
    await page.goto(BASE + '#/orders/new');
    await page.getByLabel('Номер').fill('16180');
    await page.getByRole('button', { name: 'Принять' }).click();
    const dlg = page.getByRole('dialog');
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    await dlg.getByLabel('Что сделали').fill('Engine overhaul');
    await dlg.getByLabel('Цена', { exact: true }).fill('5000');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('button', { name: /^Клиенту/ }).waitFor();
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await dlg.getByRole('button', { name: 'Отказ' }).click();
    await page.getByRole('dialog', { name: 'Клиент отказался?' }).getByRole('button', { name: 'Отказ' }).click();
    await page.getByText('Закрыт').first().waitFor();
    await shot('33b-job-refused');
  });
  await step('claim page', async () => {
    await page.goto(BASE + `#/orders/${patrol}/claim`);
    await page.getByText('Было / стало').waitFor();
    await shot('23-claim', true);
  });
  await step('money, reports, parts, settings', async () => {
    await page.goto(BASE + '#/money?tab=cash');
    await page.getByRole('button', { name: 'Закрыть день' }).first().click();
    await page.getByRole('dialog').getByLabel('Пересчитал фактически').fill('0');
    const comment = page.getByRole('dialog').getByLabel('Комментарий');
    if (await comment.count()) await comment.fill('тест');
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть день' }).click();
    await page.waitForTimeout(500);
    await shot('24-cash', true);
    await page.goto(BASE + '#/money?tab=expenses&add=1');
    await page.getByRole('dialog').waitFor();
    await shot('25-expense');
    await closeModal();
    // Proofs: photos kept with an expense (the entry itself does not change), a paperclip on its line in the book.
    await page.evaluate(async () => {
      const { addExpense } = await import('/src/services/money.ts');
      const { db } = await import('/src/db/db.ts');
      const { dubaiDate } = await import('/src/domain/dates.ts');
      const cat = (await db.expenseCategories.toArray()).find((c) => c.code === 'tools');
      await addExpense({ date: dubaiDate(new Date().toISOString()), categoryId: cat.id, amountFils: 2646, vatFils: 0, method: 'cash', vendor: 'Proof Shop', note: 'Oil filter' });
    });
    await page.locator('.list-row').filter({ hasText: 'Proof Shop' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Добавить пруф' }).waitFor();
    await page.locator('input[data-photo-input="proof"]').setInputFiles([1, 2].map((n) => ({ name: `proof-${n}.png`, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') })));
    await page.getByRole('dialog').getByRole('button', { name: 'Пруф', exact: true }).nth(1).waitFor();
    await shot('25b-expense-proofs');
    await closeModal();
    await page.goto(BASE + '#/money?tab=book');
    await page.locator('.list-row').filter({ hasText: 'Proof Shop' }).first().getByLabel('Пруф').waitFor();
    await page.goto(BASE + '#/reports');
    await page.getByText('Валовая прибыль').first().waitFor();
    await shot('26-reports', true);
    await page.goto(BASE + '#/parts');
    await shot('27-parts', true);
    await page.goto(BASE + '#/settings?tab=rules');
    await shot('28-settings', true);
  });
  await step('invoice pdf', async () => {
    const b64 = await page.evaluate(async () => {
      const docs = await import('/src/services/documents.ts');
      const { db } = await import('/src/db/db.ts');
      const inv = (await db.invoices.toArray())[0];
      const f = await docs.invoicePdf(inv.id);
      const buf = new Uint8Array(await f.blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s);
    });
    fs.writeFileSync(`${SP}/shots/invoice.pdf`, Buffer.from(b64, 'base64'));
  });
  await step('desktop board', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE + '#/');
    await page.getByText('Lexus').first().waitFor();
    await shot('16-board-desktop');
    await page.locator('.app-nav').getByText('English', { exact: true }).click();
    await page.getByText('Workshop', { exact: true }).first().waitFor();
    await shot('17-board-desktop-en');
  });
  await step('dark theme', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '#/more');
    await page.getByText(/^(Тёмная|Dark)$/).click();
    await page.goto(BASE + '#/');
    await page.waitForTimeout(400);
    await shot('29-board-dark');
    await page.goto(BASE + '#/more');
    await page.getByText(/^(Светлая|Light)$/).click();
  });
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('E2E FAILED:', String((e && e.message) || e).split('\n')[0]); process.exit(1); });
