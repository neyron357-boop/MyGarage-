const { chromium } = require('playwright');
const fs = require('fs');
// Browser smoke test of the whole job flow on a phone-sized screen.
// Usage: start the dev server (npm run dev -- --port 5173), then: node e2e/smoke.cjs [outDir]
const path = require('path');
const SP = process.argv[2] || path.join(__dirname, '..', 'test-results', 'e2e');
const FIXTURE = path.join(__dirname, 'fixtures', 'car.jpg');
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
fs.mkdirSync(`${SP}/shots`, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: false, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  const shot = (n, full = false) => page.screenshot({ path: `${SP}/shots/${n}.png`, fullPage: full });
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
  await step('new order', async () => {
    await page.goto(BASE + '#/orders/new');
    await page.getByText('Новый клиент').first().click();
    await page.getByLabel('Имя').fill('Сергей Иванов');
    await page.getByLabel('Телефон').fill('050 777 8899');
    await page.getByRole('textbox', { name: /^Номер/ }).fill('55555');
    await page.getByLabel('Код').fill('B');
    await page.getByLabel('Марка').fill('Lexus');
    await page.getByLabel('Модель').fill('RX 350');
    await shot('03-new-order');
    await page.getByRole('button', { name: 'Сохранить и продолжить' }).click();
    await page.getByPlaceholder('Словами клиента: что беспокоит').fill('Стук спереди справа на неровностях, не холодит кондиционер');
    await page.getByRole('button', { name: 'Начать приёмку' }).click();
    await page.getByText('Шаг 1 из 10').waitFor();
  });
  await step('intake photos', async () => {
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.getByText('Шаг 2 из 10').waitFor();
    for (let i = 0; i < 8; i++) {
      await page.locator('input[type=file][accept="image/*"]').nth(i).setInputFiles(FIXTURE);
      await page.getByText(`${i + 1} / 8`).waitFor({ timeout: 10000 });
    }
    await shot('04-intake-photos', true);
  });
  await step('intake damage', async () => {
    await page.getByRole('button', { name: 'Дальше' }).click();
    const svg = page.locator('svg[role=img]').first();
    const box = await svg.boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.25);
    await page.getByRole('dialog').getByText('Вмятина').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Готово' }).click();
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
  await step('intake obd/checks/belongings/complaint/conditions', async () => {
    await page.getByRole('button', { name: 'Дальше' }).click();
    const tags = page.locator('input[placeholder="P0300"]');
    await tags.fill('P0300');
    await tags.press('Enter');
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.locator('.mantine-SegmentedControl-root').first().getByText('2', { exact: true }).click();
    await page.getByRole('button', { name: 'Дальше' }).click();
    await page.getByRole('button', { name: 'Дальше' }).click();
    await shot('07-intake-conditions', true);
    await page.getByRole('button', { name: 'К подписи' }).click();
  });
  await step('intake sign', async () => {
    await page.getByText('Шаг 10 из 10').waitFor();
    const canvas = page.locator('canvas').first();
    await canvas.scrollIntoViewIfNeeded();
    const c = await canvas.boundingBox();
    await page.mouse.move(c.x + 30, c.y + 120);
    await page.mouse.down();
    for (let i = 0; i < 20; i++) await page.mouse.move(c.x + 30 + i * 12, c.y + 120 - Math.sin(i / 2) * 40);
    await page.mouse.up();
    await shot('08-intake-sign', true);
    await page.getByRole('button', { name: 'Подписать и сохранить' }).click();
    await page.getByText('Отправить клиенту').first().waitFor({ timeout: 15000 });
    await page.getByText('Открыть чат').waitFor();
    await shot('09-send-dialog');
    await page.locator('.mantine-Modal-close').first().click();
    await page.getByRole('link', { name: 'Открыть заказ' }).or(page.getByRole('button', { name: 'Открыть заказ' })).first().click(); await page.getByText('Диагностика / оценка').first().waitFor();
    await shot('10-order-after-intake', true);
  });
  await step('estimate', async () => {
    await page.getByRole('button', { name: 'Составить оценку' }).click();
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
    const url = page.url().replace('/estimate', '') ;
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
    await page.goto(BASE + `#/orders/${patrol}?tab=work`);
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
      await page.locator('input[type=file][accept="image/*"]').nth(i).setInputFiles(FIXTURE);
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
    await page.getByText('Открыть чат').waitFor();
    await closeModal();
    await page.getByRole('button', { name: 'Принять оплату' }).click();
    await page.getByRole('dialog').getByText('Карта', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Провести' }).click();
    await page.getByText('Оплачено (или оформлен долг) — можно подписывать').waitFor();
    await shot('21-handover-payment', true);
    await page.getByRole('button', { name: 'К подписи' }).click();
    const canvas = page.locator('canvas').first();
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
    await page.getByLabel('Язык').click();
    await page.getByText('Workshop', { exact: true }).first().waitFor();
    await shot('17-board-desktop-en');
  });
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch(() => { console.error('E2E FAILED'); process.exit(1); });
