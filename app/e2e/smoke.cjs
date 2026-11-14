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
  let unpaidJob = '';
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
  // A small PDF with text pieces at given places — a scanner report's layout, for the OBD import.
  const makePdf = (lines) => {
    const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);
    const content = lines.map(([x, y, t]) => `BT /F1 12 Tf ${x} ${y} Td (${esc(t)}) Tj ET`).join('\n');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let out = '%PDF-1.4\n';
    const offs = [];
    objs.forEach((o, n) => {
      offs.push(Buffer.byteLength(out));
      out += `${n + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out);
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  };
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
    // The VIN photo, beside the mechanics: a tap takes it, then its thumbnail opens it full screen.
    await shot('30a2-vin-empty');
    const [vinChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Снять VIN' }).click()]);
    await vinChooser.setFiles({ name: 'vin.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await page.getByRole('button', { name: 'Фото VIN' }).locator('img').waitFor();
    await page.getByRole('button', { name: 'Фото VIN' }).click();
    await page.locator('.viewer').getByText('VIN', { exact: true }).waitFor();
    await page.locator('.viewer button').first().click();
    await page.locator('.viewer').waitFor({ state: 'detached' });
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
    await dlg.getByText('Заказано', { exact: true }).click();
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
    // The whole list of lines copied in one tap.
    await page.getByRole('button', { name: 'Скопировать позиции' }).click();
    await page.getByText('Позиции скопированы').first().waitFor();
    await shot('31b-copy-lines');
    // A line without VAT (a fee paid for the customer): 100 AED stays 100 AED.
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    await dlg.getByLabel('Что сделали').fill('RTA test fee');
    await dlg.getByLabel('Цена', { exact: true }).fill('100');
    await dlg.getByText('Итого 105,00 AED, в т. ч. VAT 5,00').waitFor();
    await dlg.getByText('Без', { exact: true }).click();
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
    await dlg.getByText('Есть', { exact: true }).click();
    await shot('31b-line-actions');
    await page.locator('.mantine-Modal-close').first().click();
    await page.getByRole('button', { name: /^Готово/ }).click();
    await dlg.getByRole('button', { name: 'Выписать инвойс' }).click();
    await page.getByText(/INV-/).first().waitFor();
    // A discount after the invoice: credit note and a new invoice (10 % of 320.50 = 32.05).
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Скидка' }).waitFor();
    await page.waitForTimeout(500);
    await shot('32a-more');
    await dlg.getByRole('button', { name: 'Скидка' }).click();
    await dlg.getByText('%', { exact: true }).click();
    await dlg.getByRole('button', { name: '10 %' }).click();
    await dlg.getByRole('button', { name: 'Оформить скидку' }).click();
    await page.getByRole('dialog').last().getByRole('button', { name: 'Оформить скидку' }).click();
    await page.getByRole('button', { name: 'Оплата · 288,45 AED' }).waitFor();
    await shot('32-job-invoiced', true);
    // Something forgotten after the invoice (v0.12): the invoice is changed — a credit note, the line added and
    // agreed, “Done” issues a new invoice; the name is in capitals.
    await page.locator('.screen[data-role="top"]').getByRole('button', { name: 'Изменить', exact: true }).click();
    await page.getByRole('dialog').getByText('Изменить инвойс?').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Изменить', exact: true }).click();
    await page.getByRole('button', { name: /^Готово/ }).waitFor();
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    await dlg.getByLabel('Что сделали').fill('Air filter clean');
    await dlg.getByLabel('Цена', { exact: true }).fill('20');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByText('AIR FILTER CLEAN', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Согласен' }).click();
    await page.getByRole('button', { name: /^Готово/ }).click();
    await dlg.getByRole('button', { name: 'Выписать инвойс' }).click();
    await page.getByRole('button', { name: 'Оплата · 309,45 AED' }).waitFor(); // 288.45 + 20 + 5 % VAT
    await shot('32b-job-amended', true);
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
    await page.getByRole('dialog').getByRole('button', { name: 'Править' }).click();
    await page.locator('.list-row').filter({ hasText: 'Wash' }).first().click();
    await page.locator('.list-row').filter({ hasText: 'Polish' }).first().click();
    await shot('30d-pick-lines');
    await page.getByRole('button', { name: 'Удалить · 2' }).click();
    await page.getByText('Удалено строк: 2').waitFor();
    if (await page.locator('.list-row').filter({ hasText: 'Polish' }).count()) throw new Error('the picked lines are still there');
    await page.getByRole('button', { name: 'Отменить' }).last().click();
    await page.locator('.list-row').filter({ hasText: 'Polish' }).first().waitFor();
    // Lines moved by hand (v0.12): “…” → Edit, the grip of Polish dragged above Wash; the order stays.
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Править' }).click();
    const grip = (name) => page.locator('.screen[data-role="top"] .list-row').filter({ hasText: name }).locator('.sort-grip');
    await grip('Polish').waitFor();
    // The sheet has gone (its shade would take the press).
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await settled();
    const from = await grip('Polish').boundingBox();
    const to = await grip('Wash').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, to.y + 6, { steps: 10 });
    await shot('30e-moving-line');
    await page.mouse.up();
    await page.waitForFunction(() => {
      const t = [...document.querySelectorAll('.screen[data-role="top"] .list .list-row .title')].map((e) => e.textContent);
      return t.includes('POLISH') && t.indexOf('POLISH') < t.indexOf('WASH');
    });
    await page.getByRole('button', { name: 'Отмена', exact: true }).first().click();
    await page.locator('.sort-grip').first().waitFor({ state: 'detached' });
  });
  await step("scanner report: codes and the car's data from its PDF", async () => {
    const pdf = makePdf([
      [24, 698, 'Year:2011'], [24, 678, 'Make:GM'], [24, 658, 'Model:Terrain'], [24, 638, 'VIN:1GKFLTE30BX000001'],
      [24, 618, 'Odometer:151584 miles'], [24, 598, 'Engine Size:LFW 3L 6 Dual Overhead Cam (DOHC)'], [24, 578, 'Test Time:2026-10-26 01:52:17AM'],
      [22, 423, 'DTC'], [105, 423, 'Description'], [300, 423, 'State'], [411, 423, 'System'],
      [24, 393, 'P0430-00'], [107, 399, 'Catalyst System Low Efficiency'], [107, 387, 'Bank 2'], [302, 393, 'Current'], [413, 393, 'Engine Control Module (ECM)'],
      [24, 355, 'P0700-00'], [107, 367, 'Transmission Control Module'], [107, 355, 'Requested Malfunction Indicator'], [107, 343, 'Lamp (MIL) Illumination'], [302, 355, 'Passed And Failed'], [413, 355, 'Engine Control Module (ECM)'],
      [24, 189, 'U0073-00'], [107, 195, 'Control Module Communication'], [107, 183, 'High Speed CAN Bus Off'], [302, 189, 'History'], [413, 195, 'Rear Differential Clutch'], [413, 183, 'Control Module (RDCCM)'],
    ]);
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('dialog').getByRole('button', { name: 'Сканер' }).click()]);
    await chooser.setFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.getByText('Отчёт сканера: ошибок 3').first().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Сканер' }).first().click();
    await page.getByRole('dialog').getByText('Catalyst System Low Efficiency Bank 2').waitFor();
    await page.getByRole('dialog').getByText('Passed And Failed · Engine Control Module (ECM)').waitFor();
    await shot('30e-obd-report');
    await closeModal();
    const car = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const v = (await db.vehicles.toArray()).find((x) => x.plateSearch.endsWith('31415'));
      return v && [v.vin, v.year, v.engine];
    });
    if (!car || car[0] !== '1GKFLTE30BX000001' || car[1] !== 2011) throw new Error('the car card did not get the report data: ' + JSON.stringify(car));
  });
  await step('v0.12: a customer already in the base, picked on the job', async () => {
    // The car came without a name: typing one that is in the base offers that customer; a tap — the job is theirs.
    await page.getByRole('button', { name: 'Клиент', exact: true }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('textbox', { name: /^Имя/ }).fill('Серг');
    await dlg.locator('.suggest').filter({ hasText: 'Сергей Иванов' }).waitFor();
    await shot('30f-customer-from-base');
    await dlg.locator('.suggest').filter({ hasText: 'Сергей Иванов' }).click();
    await page.locator('.screen[data-role="top"] .job-line').filter({ hasText: 'Сергей Иванов' }).waitFor();
    // The job to the garage group (v0.13): the share sheet gets the car's photo and the text — the car, the
    // customer by name only, the lines with their amounts.
    await page.evaluate(() => {
      window.__shared = null;
      navigator.canShare = () => true;
      navigator.share = async (d) => { window.__shared = { text: d.text, files: (d.files || []).map((f) => f.name) }; };
    });
    await page.locator('.screen[data-role="top"]').getByRole('button', { name: 'Поделиться', exact: true }).click();
    const shared = await page.evaluate(() => window.__shared);
    if (!shared || shared.files.length !== 1 || !/^Nissan Sunny/.test(shared.text) || !/Клиент: Сергей Иванов/.test(shared.text) || !/WASH/.test(shared.text) || !/Итого/.test(shared.text) || shared.text.includes('971'))
      throw new Error('the job shared to the group: ' + JSON.stringify(shared));
  });
  await step('v0.13: a job from an invoice PDF in one go', async () => {
    // The garage's tax invoice (as Eaglecart prints it): a new car and customer, the lines at the printed prices.
    const pdf = makePdf([
      [38, 800, 'RUKN ZAMZAM GARAGE LLC'], [245, 760, 'TAX INVOICE'],
      [38, 730, 'SELLER'], [470, 730, 'BILL TO'], [38, 712, 'RUKN ZAMZAM GARAGE LLC'],
      [400, 712, 'SAND DUNE TRADING LLC'], [420, 696, '+971 50 765 4321'], [420, 680, 'Kia Sportage (White)'], [420, 664, 'PLATE : K 40404'],
      [38, 664, 'Invoice Number : 512'], [38, 648, 'Date : 12 Nov 2026, 10:00:00 AM'],
      [38, 610, '#'], [55, 610, 'Description'], [250, 610, 'Price'], [360, 610, 'VAT'], [440, 610, 'Qty'], [500, 610, 'Total'],
      [38, 590, '1.'], [55, 590, 'BRAKE PADS FRONT'], [250, 590, 'AED'], [285, 590, '200.00'], [360, 590, 'AED'], [395, 590, '10.00'], [450, 590, '1'], [495, 590, 'AED'], [525, 590, '210.00'],
      [38, 570, '2.'], [55, 570, 'WHEEL ALIGNMENT'], [250, 570, 'AED'], [285, 570, '100.00'], [360, 570, 'AED'], [395, 570, '5.00'], [450, 570, '1'], [495, 570, 'AED'], [525, 570, '105.00'],
      [38, 530, 'Total Qty 2'], [334, 530, 'Subtotal'], [495, 530, 'AED'], [525, 530, '315.00'],
      [334, 500, 'Total'], [495, 500, 'AED'], [525, 500, '315.00'],
    ]);
    await page.goto(BASE + '#/orders/new');
    await page.getByRole('button', { name: 'Из инвойса или сметы (PDF)' }).waitFor();
    await page.locator('.screen[data-role="top"] input[data-doc-input]').setInputFiles({ name: 'invoice-512.pdf', mimeType: 'application/pdf', buffer: pdf });
    const seen = async (what, loc, state = 'visible') => loc.waitFor({ state, timeout: 20000 }).catch(() => { throw new Error('not shown: ' + what); });
    await seen('the toast', page.getByText('Инвойс 512').first());
    await seen('the button', page.getByRole('button', { name: 'Готово · 315,00 AED' }));
    await seen('the line', page.locator('.screen[data-role="top"] .list-row').filter({ hasText: 'BRAKE PADS FRONT' }));
    await seen('the customer', page.locator('.screen[data-role="top"] .job-line').filter({ hasText: 'SAND DUNE TRADING LLC' }));
    await shot('30g-job-from-pdf');
  });
  await step('archive: a swipe left takes a job off the board, a swipe in the archive brings it back', async () => {
    // A finger's swipe from the right edge of a row to the left (touch events, as on a phone).
    const swipeLeft = (loc) =>
      loc.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const x0 = r.right - 20;
        const touch = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        const fire = (type, x, list = true) => el.dispatchEvent(new TouchEvent(type, { touches: list ? [touch(x)] : [], changedTouches: [touch(x)], bubbles: true, cancelable: true }));
        fire('touchstart', x0);
        for (let i = 1; i <= 12; i++) fire('touchmove', x0 - i * 28);
        fire('touchend', x0 - 12 * 28, false);
      });
    await page.goto(BASE + '#/');
    const row = page.locator('.job-row', { hasText: '31415' }).first();
    await row.waitFor();
    await swipeLeft(row);
    await page.getByText(/в архиве$/).first().waitFor();
    await page.locator('.job-row', { hasText: '31415' }).waitFor({ state: 'detached' });
    await page.getByRole('tab', { name: /Архив/ }).click();
    const back = page.locator('.job-row', { hasText: '31415' }).first();
    await back.waitFor();
    await shot('02c-archive');
    await swipeLeft(back);
    await page.getByText('Заказ снова на доске').first().waitFor();
    await page.getByRole('tab', { name: /^Все/ }).click();
    await page.locator('.job-row', { hasText: '31415' }).first().waitFor();
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
    // A closed job comes back in one tap: back in the workshop, the bottom button gone.
    await page.getByRole('button', { name: 'Возобновить' }).click();
    await page.getByText('Заказ возобновлён').first().waitFor();
    await page.getByRole('button', { name: 'Возобновить' }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Работа', exact: true }).waitFor();
    await shot('33c-job-reopened');
  });
  await step('closed without payment and without a debt', async () => {
    await page.goto(BASE + '#/orders/new');
    await page.getByLabel('Номер').fill('57721');
    await page.getByRole('button', { name: 'Принять' }).click();
    const dlg = page.getByRole('dialog');
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    await dlg.getByLabel('Что сделали').fill('Warranty rework');
    await dlg.getByLabel('Цена', { exact: true }).fill('200');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('button', { name: 'Согласен' }).click();
    await page.getByRole('button', { name: /^Готово/ }).click();
    await dlg.getByRole('button', { name: 'Выписать инвойс' }).click();
    await page.getByRole('button', { name: 'Оплата · 210,00 AED' }).waitFor();
    // “…” → No payment: the car leaves, nothing owed — no payment, no debt.
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await dlg.getByRole('button', { name: 'Без оплаты' }).waitFor();
    await page.waitForTimeout(600);
    await shot('33c2-more-unpaid');
    await dlg.getByRole('button', { name: 'Без оплаты' }).click();
    const ask = page.getByRole('dialog', { name: 'Закрыть без оплаты?' });
    await ask.getByText('210,00').waitFor();
    await shot('33d-close-unpaid');
    // Two ways: paid to the owner (the usual), or no money at all — here, no money.
    await ask.getByRole('button', { name: 'Оплата у главного' }).waitFor();
    await ask.getByRole('button', { name: 'Денег не будет' }).click();
    await ask.waitFor({ state: 'hidden' });
    await page.getByText('Закрыт').first().waitFor();
    await page.locator('.list-row').filter({ hasText: 'Без оплаты' }).filter({ hasText: '210,00' }).first().waitFor();
    // (the main button of a job to be paid: «Оплата · сумма»)
    if (await page.getByRole('button', { name: /^Оплата ·/ }).count()) throw new Error('a job closed without payment still asks for it');
    await shot('33e-job-unpaid', true);
    unpaidJob = page.url();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    await shot('33f-job-unpaid-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    // Nothing owed: not among the debts.
    await page.goto(BASE + '#/money?tab=debts');
    const top = page.locator('.screen[data-role="top"]');
    await top.getByText('Всего долгов').waitFor();
    if (await top.getByText('57721').count()) throw new Error('a job closed without payment shows as a debt');
  });
  await step('paid to the owner: closed, nothing in the cash', async () => {
    const cashOf = () => page.evaluate(async () => {
      const { cashState } = await import('/src/services/money.ts');
      return (await cashState()).expected;
    });
    const before = await cashOf();
    await page.goto(BASE + '#/orders/new');
    await page.getByLabel('Номер').fill('24680');
    await page.getByRole('button', { name: 'Принять', exact: true }).click();
    const dlg = page.getByRole('dialog');
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    await dlg.getByLabel('Что сделали').fill('Gearbox repair');
    await dlg.getByLabel('Цена', { exact: true }).fill('1000');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('button', { name: 'Согласен' }).click();
    await page.getByRole('button', { name: /^Готово/ }).click();
    await dlg.getByRole('button', { name: 'Выписать инвойс' }).click();
    await page.getByRole('button', { name: 'Оплата · 1 050,00 AED' }).waitFor();
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await dlg.getByRole('button', { name: 'Без оплаты' }).click();
    const ask = page.getByRole('dialog', { name: 'Закрыть без оплаты?' });
    await ask.getByText('1 050,00').waitFor();
    await shot('33h-close-owner');
    await ask.getByRole('button', { name: 'Оплата у главного' }).click();
    await ask.waitFor({ state: 'hidden' });
    await page.getByText('Закрыт').first().waitFor();
    if (await page.getByRole('button', { name: /^Оплата ·/ }).count()) throw new Error('a job paid to the owner still asks for payment');
    await page.locator('.list-row').filter({ hasText: 'Оплата у главного' }).filter({ hasText: '1 050,00' }).first().waitFor();
    await shot('33i-job-owner', true);
    if ((await cashOf()) !== before) throw new Error('paid to the owner must not touch the cash');
    await page.goto(BASE + '#/money?tab=debts');
    await page.locator('.screen[data-role="top"]').getByText('Всего долгов').waitFor();
    if (await page.locator('.screen[data-role="top"]').getByText('24680').count()) throw new Error('paid to the owner is not a debt');
  });
  await step('a new price: tapped on the line — agreed in person, or a waiting line back to the price', async () => {
    await page.goto(BASE + '#/orders/new');
    await page.getByLabel('Номер').fill('14142');
    await page.getByRole('button', { name: 'Принять', exact: true }).click();
    await page.getByRole('button', { name: 'Работа', exact: true }).waitFor();
    const id = page.url().split('/orders/')[1].split(/[/?]/)[0];
    const dlg = page.getByRole('dialog');
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    await dlg.getByLabel('Что сделали').fill('Front brake pads replacement');
    await dlg.getByLabel('Цена', { exact: true }).fill('120');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('button', { name: 'Запчасть', exact: true }).click();
    await dlg.getByLabel('Запчасть').fill('Spark plug');
    await dlg.getByLabel('Кол-во').fill('4');
    await dlg.getByLabel('Цена за шт.').fill('30');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('button', { name: 'Клиенту · 252,00 AED' }).waitFor();
    await page.getByRole('button', { name: 'Согласен' }).click();
    await page.getByRole('button', { name: 'Готово · 252,00 AED' }).waitFor();
    // Agreed: the price on the line's sheet is a button; the new one is agreed in person.
    await front('.list-row').filter({ hasText: 'Front brake pads replacement' }).click();
    await dlg.getByRole('button', { name: 'Изменить цену' }).click();
    const price = dlg.getByLabel('Изменить цену');
    if ((await price.inputValue()) !== '126') throw new Error(`the field starts from the price shown, not ${await price.inputValue()}`);
    await price.fill('100');
    await shot('35-price-edit');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await dlg.getByRole('button', { name: 'Изменить цену' }).filter({ hasText: '100,00' }).waitFor();
    await shot('35a-price-changed');
    await page.locator('.mantine-Modal-close').first().click();
    await page.getByRole('button', { name: 'Готово · 226,00 AED' }).waitFor();
    // Several of a part: the price of one, the line's total under it; Enter saves.
    await front('.list-row').filter({ hasText: 'Spark plug' }).click();
    await dlg.getByRole('button', { name: 'Изменить цену' }).click();
    if ((await price.inputValue()) !== '31,5') throw new Error(`the price of one part, not ${await price.inputValue()}`);
    await price.fill('25');
    await dlg.getByText(/= 100,00/).waitFor();
    await shot('35b-price-per-unit');
    await price.press('Enter');
    await dlg.getByRole('button', { name: 'Изменить цену' }).filter({ hasText: '100,00' }).waitFor();
    await page.locator('.mantine-Modal-close').first().click();
    await page.getByRole('button', { name: 'Готово · 200,00 AED' }).waitFor();
    // What was agreed before stays: two versions told in person, the journal keeps both prices.
    const kept = await page.evaluate(async (orderId) => {
      const { db } = await import('/src/db/db.ts');
      const versions = await db.versions.where('orderId').equals(orderId).sortBy('number');
      const events = (await db.events.where('orderId').equals(orderId).toArray()).filter((e) => e.type === 'price_changed');
      return { kinds: versions.map((v) => v.kind), first: versions[0].items.map((s) => s.gross), changed: events.map((e) => [e.payload.from, e.payload.to]) };
    }, id);
    if (JSON.stringify(kept) !== JSON.stringify({ kinds: ['initial', 'price_change', 'price_change'], first: [12600, 12600], changed: [[12600, 10000], [12600, 10000]] })) throw new Error('the price change must keep what was agreed: ' + JSON.stringify(kept));
    // Waiting for the answer: a new price takes the line back — the job asks to send the price again.
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    await dlg.getByLabel('Что сделали').fill('Brake fluid flush');
    await dlg.getByLabel('Цена', { exact: true }).fill('80');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByRole('button', { name: 'Клиенту · 284,00 AED' }).waitFor();
    await page.evaluate(async (orderId) => {
      const { sendVersion } = await import('/src/services/estimate.ts');
      await sendVersion(orderId, { via: 'whatsapp' });
    }, id);
    await page.getByRole('button', { name: 'Отказ' }).waitFor();
    await front('.list-row').filter({ hasText: 'Brake fluid flush' }).click();
    await dlg.getByRole('button', { name: 'Согласен' }).waitFor();
    await dlg.getByRole('button', { name: 'Изменить цену' }).click();
    await price.fill('70');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await dlg.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Клиенту · 270,00 AED' }).waitFor();
    await shot('35c-price-back-to-send', true);
  });
  await step('v0.7: due time, notes, offers, return terms, work outside, mechanic, report', async () => {
    await page.goto(BASE + '#/orders/new');
    await page.getByLabel('Номер').fill('61803');
    await page.getByRole('button', { name: 'Nissan', exact: true }).click();
    await page.getByRole('button', { name: 'Sunny', exact: true }).click();
    await page.getByRole('button', { name: 'Принять' }).click();
    const dlg = page.getByRole('dialog');
    // When the car was promised: a chip on the card, a time from the sheet.
    await page.getByRole('button', { name: 'Срок' }).click();
    await page.getByRole('dialog', { name: 'Когда будет готова' }).locator('button.chip').first().waitFor();
    await shot('34a-due-sheet');
    await page.getByRole('dialog', { name: 'Когда будет готова' }).locator('button.chip').first().click();
    await front('.due-chip[data-state="set"]').waitFor();
    // A note at the bottom of the job, like a chat with oneself.
    await page.getByLabel('Заметка').fill('Front pads at 2 mm, discs OK');
    await front('[aria-label="Добавить"]').click();
    await page.locator('.notes .list-row', { hasText: 'Front pads at 2 mm' }).waitFor();
    // A part with its number and two offers: the first one goes on the line (cost + markup).
    await page.getByRole('button', { name: 'Запчасть', exact: true }).click();
    await dlg.getByLabel('Запчасть').fill('Headlight LH');
    await dlg.getByLabel('Номер').fill('81150-06B20');
    await dlg.getByRole('button', { name: /^Варианты/ }).click();
    await dlg.getByText('Вариант', { exact: true }).click();
    await dlg.getByLabel('Закупка варианта').fill('300');
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await dlg.getByText('Вариант', { exact: true }).click();
    await dlg.getByText('Б/у', { exact: true }).click();
    await dlg.getByLabel('Закупка варианта').fill('120');
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    if ((await dlg.locator('.offer-row').count()) !== 2) throw new Error('two offers expected');
    await dlg.getByRole('button', { name: 'Варианты клиенту' }).waitFor();
    await dlg.getByRole('button', { name: /^Запрос/ }).waitFor();
    await shot('34b-part-offers');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByText('409,50').first().waitFor(); // 300 + 30 % markup + 5 % VAT
    // Work outside: the paint shop, what we pay them.
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    await dlg.getByLabel('Что сделали').fill('Bumper paint');
    await dlg.getByLabel('Цена', { exact: true }).fill('500');
    await dlg.getByRole('button', { name: 'На стороне' }).click();
    await dlg.getByLabel('Платим').fill('300');
    await shot('34c-outside');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await page.locator('.list-row', { hasText: 'Bumper paint' }).getByText(/Отдать/).waitFor();
    await page.getByRole('button', { name: 'Согласен' }).click();
    await page.getByText('В работе').first().waitFor();
    // Bought: the seller takes it back within 7 days, the receipt photo kept with the line.
    await page.locator('.list-row', { hasText: 'Headlight LH' }).first().click();
    await dlg.getByText('Заказано', { exact: true }).click();
    await dlg.getByRole('button', { name: '7 дн.' }).click();
    await dlg.locator('input[data-photo-input="deal"]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await dlg.locator('.strip-tile img').first().waitFor();
    await dlg.getByText(/^Возврат · до /).waitFor();
    await shot('34d-return-terms');
    await page.locator('.mantine-Modal-close').first().click();
    // The paint shop has the bumper, then paid: an expense of the job.
    await page.locator('.list-row', { hasText: 'Bumper paint' }).first().click();
    await dlg.getByRole('button', { name: 'У них' }).click();
    await dlg.getByRole('button', { name: /^Оплатить/ }).click();
    await dlg.getByRole('button', { name: 'Наличные' }).click();
    await dlg.getByText(/^Оплачено/).waitFor();
    await shot('34e-outside-paid');
    await page.locator('.mantine-Modal-close').first().click();
    // The profit (blurred until tapped): 390 + 500 net − 300 − 300.
    await page.locator('.list-row', { hasText: 'Прибыль' }).click();
    await page.locator('.profit-amount[data-shown="true"]').getByText('290,00').waitFor();
    // "…" → Mechanic: the task in English; → Report: what was done, for the customer.
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await dlg.getByRole('button', { name: 'Механику' }).click();
    const task = page.getByRole('dialog', { name: /Механику|Задание механику/ });
    if (!/To do:[\s\S]*BUMPER PAINT/.test(await task.locator('textarea').inputValue())) throw new Error('the mechanic task lists the work');
    await shot('34f-mechanic');
    await task.locator('.mantine-Modal-close').click();
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await dlg.getByRole('button', { name: 'Отчёт' }).click();
    await page.getByText('Открыть чат').waitFor();
    if (!/HEADLIGHT LH[\s\S]*BUMPER PAINT/.test(await page.getByRole('dialog').last().locator('textarea').inputValue())) throw new Error('the report lists what was done');
    await shot('34g-report');
    await page.locator('.mantine-Modal-close').last().click();
    await page.waitForTimeout(300);
    await shot('34h-job-v07', true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    await shot('34h2-job-v07-desktop', true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    // On the board: the promised time beside the plate, the paint shop's sign on the row.
    await page.goto(BASE + '#/');
    const row = page.locator('.job-row', { hasText: '61803' }).first();
    await row.locator('.row-due').waitFor();
    await row.locator('svg[aria-label="На стороне"]').waitFor();
    await page.getByText(/^Сегодня\s*\d+$/).waitFor();
    await shot('34i-board-today');
  });
  await step('v0.7: suppliers from a list, their card; moving to another device', async () => {
    await page.goto(BASE + '#/parts?tab=suppliers');
    await front('input[data-suppliers-input]').setInputFiles({ name: 'suppliers.csv', mimeType: 'text/csv', buffer: Buffer.from('Название;Телефон;Марки;Новые/Б/у;Что продают\nGulf Lights;050 765 4321;Toyota, Nissan;б/у;Фары\nAl Shams Paint;04 333 2211;;;покраска\n', 'utf8') });
    await page.getByText('Добавлено: 2, уже были: 0').first().waitFor();
    await front('.list-row').filter({ hasText: 'Gulf Lights' }).waitFor();
    await shot('35a-suppliers');
    await front('.list-row').filter({ hasText: 'Gulf Lights' }).click();
    await page.getByRole('dialog').getByText('Марки').waitFor();
    await shot('35b-supplier-card');
    await page.locator('.mantine-Modal-close').first().click();
    // The search finds suppliers by make and what they sell.
    await page.goto(BASE + '#/search?q=' + encodeURIComponent('nissan фары'));
    await front('.list-row').filter({ hasText: 'Gulf Lights' }).waitFor();
    await page.goto(BASE + '#/more');
    await page.getByText('На другое устройство').click();
    await page.getByRole('dialog').getByRole('button', { name: /^Отправить \d/ }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Принять файл' }).waitFor();
    await shot('35c-transfer');
    await page.locator('.mantine-Modal-close').first().click();
  });
  await step('v0.8: swipes on lines, the way of the job, the mark of a moment', async () => {
    // A finger's swipe on a row (touch events, as on a phone): dir −1 to the left, +1 to the right.
    const swipe = (loc, dir, steps = 12) =>
      loc.evaluate((el, { dir, steps }) => {
        const r = el.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const x0 = dir < 0 ? r.right - 20 : r.left + 20;
        const touch = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        const fire = (type, x, list = true) => el.dispatchEvent(new TouchEvent(type, { touches: list ? [touch(x)] : [], changedTouches: [touch(x)], bubbles: true, cancelable: true }));
        fire('touchstart', x0);
        for (let i = 1; i <= steps; i++) fire('touchmove', x0 + dir * i * 28);
        fire('touchend', x0 + dir * steps * 28, false);
      }, { dir, steps });
    await page.goto(BASE + '#/orders/new');
    await page.getByLabel('Номер').fill('80808');
    await page.getByRole('button', { name: 'Принять', exact: true }).click();
    const dlg = page.getByRole('dialog');
    for (const [name, price] of [['Oil change', '100'], ['Wheel alignment', '120']]) {
      await page.getByRole('button', { name: 'Работа', exact: true }).click();
      await dlg.getByLabel('Что сделали').fill(name);
      await dlg.getByLabel('Цена', { exact: true }).fill(price);
      await dlg.getByRole('button', { name: 'Сохранить' }).click();
      await front('.list-row').filter({ hasText: name }).first().waitFor();
    }
    // The way of the job: six segments, the one it is on marked.
    if ((await front('.phase-track > span').count()) !== 6) throw new Error('the phase track has six steps');
    await front('.phase-track > span[data-now]').waitFor();
    const line = (name) => front('.list-row:not([data-ghost])').filter({ hasText: name }).first();
    // A draft swiped left all the way: gone at once, with Undo.
    await swipe(line('Wheel alignment'), -1);
    await line('Wheel alignment').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Отменить' }).last().click();
    await line('Wheel alignment').waitFor();
    // A short swipe only uncovers the button; a tap on the row closes it again.
    await swipe(line('Wheel alignment'), -1, 3);
    await line('Wheel alignment').locator('.swipe-btn', { hasText: 'Удалить' }).waitFor();
    await shot('36a-line-swipe');
    await line('Wheel alignment').locator('.body').click();
    if (await dlg.count()) throw new Error('a tap on an open row only closes it');
    // Agreed in person; a swipe right marks the work done, the line steps back.
    await page.getByRole('button', { name: 'Согласен' }).click();
    await page.getByText('В работе').first().waitFor();
    await swipe(line('Oil change'), 1);
    await front('.list-row[data-done]').filter({ hasText: 'Oil change' }).waitFor();
    // An agreed line swiped left all the way is not dropped at once: the button waits for a tap.
    await swipe(line('Wheel alignment'), -1);
    await line('Wheel alignment').locator('.swipe-btn', { hasText: 'Убрать' }).waitFor();
    await line('Wheel alignment').locator('.body').click();
    await shot('36b-line-done');
    // Paid in full and handed over: each moment gets its mark.
    await page.getByRole('button', { name: /^Готово/ }).click();
    await dlg.getByRole('button', { name: 'Выписать инвойс' }).click();
    await page.getByRole('button', { name: /^Оплата/ }).click();
    await dlg.getByRole('button', { name: 'Провести' }).click();
    await page.locator('.celebration').getByText('Оплачено').waitFor();
    await page.getByRole('button', { name: 'Выдать' }).click();
    await page.locator('.celebration').getByText('Выдана').waitFor();
    // The mark is on screen for a second: its picture is taken while it is there (not after it has gone).
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${SP}/shots/36c-celebration.png` });
    await shot('36c-handed-over');
    await page.getByText('Закрыт').first().waitFor();
    // Tabs move like pages: a swipe to the left on Money opens the next tab, to the right — back.
    await page.goto(BASE + '#/money');
    const pageSwipe = (dir) =>
      front('.tab-panel').first().evaluate((el, dir) => {
        const y = 520;
        const x0 = dir < 0 ? 330 : 60;
        const touch = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        const fire = (type, x, list = true) => el.dispatchEvent(new TouchEvent(type, { touches: list ? [touch(x)] : [], changedTouches: [touch(x)], bubbles: true, cancelable: true }));
        fire('touchstart', x0);
        for (let i = 1; i <= 8; i++) fire('touchmove', x0 + dir * i * 25);
        fire('touchend', x0 + dir * 200, false);
      }, dir);
    await front('.tab-panel').first().waitFor();
    await pageSwipe(-1);
    await page.waitForFunction(() => location.hash.includes('tab=cash'));
    await page.getByRole('button', { name: 'Закрыть день' }).first().waitFor();
    await pageSwipe(1);
    await page.waitForFunction(() => location.hash.includes('tab=book'));
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
    // The money sheet (Excel, as the garage's Money Tracker): the export holds the whole book; a sheet imports once.
    const book = await page.evaluate(async () => {
      const { exportMoneySheet } = await import('/src/services/moneySheet.ts');
      const { readMoneyWorkbook } = await import('/src/domain/moneySheet.ts');
      const { loadLedger } = await import('/src/services/ledger.ts');
      const file = await exportMoneySheet();
      return { rows: (await readMoneyWorkbook(new Uint8Array(await file.arrayBuffer()))).rows.length, entries: (await loadLedger()).entries.length, name: file.name };
    });
    if (!book.rows || book.rows !== book.entries || !/^Money Tracker/.test(book.name)) throw new Error('money sheet export: ' + JSON.stringify(book));
    const sheet = await page.evaluate(async () => {
      const { buildMoneyWorkbook } = await import('/src/domain/moneySheet.ts');
      const b = buildMoneyWorkbook({
        cashStartFils: 0,
        cardStartFils: 0,
        rows: [
          { date: '2026-11-01', type: 'Income', amountFils: 25000, payment: 'Cash', category: 'Repair Labor', notes: 'sheet test income' },
          { date: '2026-11-01', type: 'Expense', amountFils: 4500, payment: 'Card', category: 'Workshop Supplies', notes: 'sheet test expense' },
        ],
      });
      let s = '';
      for (const x of b) s += String.fromCharCode(x);
      return btoa(s);
    });
    await page.goto(BASE + '#/money?tab=book');
    await page.getByRole('button', { name: 'Excel' }).click();
    await page.locator('.mantine-Modal-content button.action-tile:not([disabled])', { hasText: 'Выгрузить' }).waitFor();
    await shot('25c-money-sheet');
    await page.locator('input[data-money-sheet-input]').setInputFiles({ name: 'Money Tracker.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(sheet, 'base64') });
    await page.getByText('Новых записей: 2 — приходов 1, расходов 1').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Загрузить' }).last().click();
    await page.getByText('Таблица загружена').first().waitFor();
    await page.getByText('sheet test expense').first().waitFor();
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
    // A part being bought: the iOS form — state, supplier, cost, receipt, return terms.
    await page.goto(BASE + '#/parts?tab=ordered');
    await front('.list-row.clickable').first().click();
    const buy = page.getByRole('dialog');
    await buy.getByLabel('Закупка за ед. (без VAT)').waitFor();
    await buy.locator('.group-title', { hasText: /^Возврат/ }).waitFor();
    await shot('27b-procurement');
    await page.locator('.mantine-Modal-close').first().click();
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
    if (unpaidJob) {
      await page.goto(unpaidJob);
      await page.waitForTimeout(400);
      await shot('33g-job-unpaid-dark');
    }
    await page.goto(BASE + '#/more');
    await page.getByText(/^(Светлая|Light)$/).click();
  });
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('E2E FAILED:', String((e && e.message) || e).split('\n')[0]); process.exit(1); });
