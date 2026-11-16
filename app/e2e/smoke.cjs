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
      const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), args: ['--enable-unsafe-swiftshader'] });
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
  // A person's pace: at least 400 ms between clicks. The app drops a tap that comes within 350 ms where the
  // previous tap changed what is under the finger — the second tap of a double tap (ui/tapGuard.ts): nobody
  // taps a button they have not read yet ("Зафиксировать версию" → "Клиент согласен на всё" in the same place).
  {
    const probe = await ctx.newPage();
    const proto = Object.getPrototypeOf(probe.locator('body'));
    await probe.close();
    const click = proto.click;
    let lastClick = 0;
    proto.click = async function (opts) {
      const wait = lastClick + 400 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await click.call(this, opts);
      } finally {
        lastClick = Date.now();
      }
    };
  }
  const page = await ctx.newPage();
  // A sheet just closed takes its own step back in the history a frame after it is gone (ui/backCloses.ts): a goto or a
  // reload that meets that step is aborted or undone by it (a person never types an address that fast). Let the step
  // pass first — and go once more if it was aborted anyway.
  {
    const sheetStepDone = () =>
      page
        .waitForFunction(() => !!document.querySelector('.mantine-Modal-content, .mantine-Drawer-content') || !history.state?.mgSheet, null, { timeout: 2000 })
        .catch(() => undefined);
    for (const m of ['goto', 'reload']) {
      const own = page[m].bind(page);
      page[m] = async (...a) => {
        await sheetStepDone();
        try {
          return await own(...a);
        } catch (e) {
          if (!/ERR_ABORTED|interrupted by another navigation/.test(String(e))) throw e;
          await page.waitForTimeout(300);
          return own(...a);
        }
      };
    }
  }
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
  // (Only animations that run in time: one tied to a scroll — the glow under the title — never finishes.)
  const settled = () => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.timeline === document.timeline).map((a) => a.finished.catch(() => undefined)))).catch(() => undefined);
  let unpaidJob = '';
  const shot = async (n, full = false) => {
    await settled();
    await page.screenshot({ path: `${SP}/shots/${n}.png`, fullPage: full });
  };
  const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { console.log('FAIL', name, e.message.split('\n').filter((l) => l.trim() && !/^=+/.test(l.trim())).slice(0, 4).join(' | ')); await shot('fail-' + name.replace(/\W+/g, '_')); throw e; } };

  await step('board empty', async () => { await page.goto(BASE); await page.getByText('Мастерская', { exact: true }).first().waitFor(); await shot('01-board-empty'); });
  await step('load demo', async () => {
    await page.goto(BASE + '#/settings?tab=data');
    await page.getByRole('button', { name: 'Загрузить демо-данные' }).click();
    // Written for a few seconds: the steps below must not race it.
    await page.getByText('Демо-данные загружены').first().waitFor({ timeout: 20000 });
    await page.goto(BASE + '#/');
    await page.getByText('Camry').first().waitFor();
    await shot('02-board-demo', true);
    // Every card one size (v0.17.3): a car without a photo has the same card, the car drawn in its place.
    const cards = await page.evaluate(() => [...document.querySelectorAll('.screen[data-role="top"] .job-card')].map((c) => [Math.round(c.querySelector('.job-card-open').getBoundingClientRect().height), c.hasAttribute('data-art')]));
    if (!cards.length || new Set(cards.map(([h]) => h)).size !== 1) throw new Error('board cards of different sizes: ' + JSON.stringify(cards));
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
    // Typed as fast as a thumb types: every digit stays (v0.20 — the iPhone lost some while the page was busy).
    await page.getByLabel('Номер').pressSequentially('55555', { delay: 12 });
    if ((await page.getByLabel('Номер').inputValue()) !== '55555') throw new Error('fast typing lost digits: ' + (await page.getByLabel('Номер').inputValue()));
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
  });
  await step('v0.21: «…» without Photos, Mechanic and Discount; the check-in screen gone, its records kept', async () => {
    // «…»: none of the three tiles (the job card is the inspection; mechanics — their chips; the discount — «％»).
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    const more = page.getByRole('dialog');
    await more.getByRole('button', { name: 'Клиент', exact: true }).waitFor();
    for (const gone of ['Фото', 'Механику', 'Скидка'])
      if (await more.getByRole('button', { name: gone, exact: true }).count()) throw new Error(`«…» still has «${gone}»`);
    await shot('03c-job-more');
    await page.keyboard.press('Escape');
    await more.waitFor({ state: 'hidden' });
    // The job card chip still opens the inspection: the car in 3D (or its drawings without WebGL).
    await front('button.vin-chip[aria-label="Job card"]').click();
    const card = page.getByRole('dialog', { name: 'Job card' });
    await card.locator('canvas.car3d-canvas').or(card.locator('svg[role="img"]')).first().waitFor({ timeout: 20000 });
    await card.getByRole('button', { name: 'Готово' }).click();
    await card.waitFor({ state: 'detached' });
    // The old screen's address shows its job; the address stays (no redirect to flicker through).
    await page.goto(page.url().split('?')[0] + '/intake');
    await page.waitForFunction(() => /^#\/orders\/[^/?]+\/intake$/.test(location.hash));
    await front(':text("Смотрим")').first().waitFor();
    // A check-in act signed before (demo data, with its photos; a damage point put on it as the old screen kept them):
    // its points open in the job card as they were — only to look at — and its photos, report and PDF stay where they
    // are shown (the claim page and "pdfs" below).
    const signed = await page.evaluate(async () => {
      const { db, uid } = await import('/src/db/db.ts');
      const acts = (await db.inspections.toArray()).filter((i) => i.kind === 'intake' && i.locked);
      for (const a of acts) {
        const photos = await db.media.where('ownerId').equals(a.id).count();
        const o = await db.orders.get(a.orderId);
        if (!photos || !o || o.stage === 'closed' || o.stage === 'cancelled') continue;
        await db.damageMarks.add({ id: uid(), inspectionId: a.id, view: 'left', x: 0.5, y: 0.55, type: 'dent' });
        return { orderId: a.orderId, marks: await db.damageMarks.where('inspectionId').equals(a.id).count(), photos };
      }
      return null;
    });
    if (!signed) throw new Error('the demo data has no signed check-in act with photos on an open job');
    await page.goto(BASE + '#/orders/' + signed.orderId);
    await front('button.vin-chip[aria-label="Job card"]').click();
    const old = page.getByRole('dialog', { name: 'Job card' });
    await old.getByText('Акт приёмки подписан').waitFor({ timeout: 20000 });
    if ((await old.locator('.jc-chip').count()) !== signed.marks) throw new Error('the signed act\'s points are not all on the job card');
    await shot('03d-job-card-signed');
    await old.getByRole('button', { name: 'Готово' }).click();
    await old.waitFor({ state: 'detached' });
    // The next steps look for a job's buttons on the whole page: one job screen kept, not two.
    await page.goto(BASE);
    await page.reload();
    await page.getByText('Мастерская', { exact: true }).first().waitFor();
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
  await step('on credit: the car leaves with a signed debt, the payment that clears it closes the job', async () => {
    patrol = await page.evaluate(async () => { const { db } = await import('/src/db/db.ts'); const v = (await db.vehicles.toArray()).find((x) => x.model === 'Patrol'); return (await db.orders.where('vehicleId').equals(v.id).first()).id; });
    await page.goto(BASE + `#/orders/${patrol}`);
    const dlg = page.getByRole('dialog');
    await page.getByRole('button', { name: /^Готово/ }).click();
    await dlg.getByRole('button', { name: 'Выписать инвойс' }).click();
    await page.getByRole('button', { name: /^Оплата ·/ }).waitFor();
    // "Оплата" → "В долг" (v0.19, in the payment sheet): the customer signs for the sum and the date, and the car goes.
    await page.getByRole('button', { name: /^Оплата ·/ }).click();
    await dlg.getByRole('button', { name: 'В долг', exact: true }).click();
    await dlg.getByText('Подпись клиента').waitFor();
    const canvas = dlg.locator('canvas').first();
    await canvas.scrollIntoViewIfNeeded();
    const c = await canvas.boundingBox();
    await page.mouse.move(c.x + 30, c.y + 100); await page.mouse.down();
    for (let i = 0; i < 15; i++) await page.mouse.move(c.x + 30 + i * 15, c.y + 100 - Math.cos(i / 2) * 30);
    await page.mouse.up();
    await shot('19-on-credit', true);
    await dlg.getByRole('button', { name: /^Выдать в долг/ }).click();
    await page.getByText('Долг оформлен').first().waitFor();
    // The signed debt: a row under the total (its paper a tap away) — and under Money → Debts.
    await front('.list-row').filter({ hasText: 'Долг до' }).waitFor();
    const number = await page.evaluate(async (id) => (await (await import('/src/db/db.ts')).db.orders.get(id)).number, patrol);
    await page.goto(BASE + '#/money?tab=debts');
    // v0.30: the customer's card is folded — a tap shows the job.
    await front('.debt-card').filter({ hasText: '№' + number }).locator('.list-row').first().click();
    await page.locator('.screen[data-role="top"]').getByText('№' + number).first().waitFor();
    await page.goto(BASE + '#/orders/' + patrol);
    await page.getByRole('button', { name: /^Оплата ·/ }).waitFor();
    // Gone with money due: the step "debt"; its money is still taken here, and the signed paper opens from "…".
    const gone = await page.evaluate(async (id) => { const { loadOrderBundle } = await import('/src/services/orders.ts'); const { phaseOf } = await import('/src/services/flow.ts'); const b = await loadOrderBundle(id); return { phase: phaseOf(b), stage: b.order.stage, debts: b.debts.map((d) => d.status) }; }, patrol);
    if (gone.phase !== 'debt' || gone.stage !== 'delivered' || gone.debts.join() !== 'open') throw new Error('on credit: ' + JSON.stringify(gone));
    await shot('20-on-credit-gone', true);
    await page.getByRole('button', { name: /^Оплата ·/ }).click();
    await dlg.getByText('Карта', { exact: true }).click();
    await dlg.getByRole('button', { name: 'Провести' }).click();
    await page.getByRole('button', { name: 'Возобновить' }).waitFor();
    const paid = await page.evaluate(async (id) => { const { loadOrderBundle } = await import('/src/services/orders.ts'); const b = await loadOrderBundle(id); return { stage: b.order.stage, debts: b.debts.map((d) => d.status) }; }, patrol);
    if (paid.stage !== 'closed' || paid.debts.join() !== 'paid') throw new Error('paid off: ' + JSON.stringify(paid));
    await shot('22-order-closed', true);
  });
  await step('debts by customer, a debt payment, the garage on credit', async () => {
    // One customer, two jobs gone with debts of 600 and 400 AED: one handed over on credit, one closed with a signed debt.
    await page.evaluate(async () => {
      const { checkIn, changeStage } = await import('/src/services/orders.ts');
      const { addItem } = await import('/src/services/estimate.ts');
      const { approveAll, leaveOnDebt } = await import('/src/services/flow.ts');
      const { quickInvoice, createDebt } = await import('/src/services/money.ts');
      const sig = new Blob(['sig'], { type: 'image/png' });
      const job = async (number, model, aed, customerId) => {
        const o = await checkIn({ plate: { emirate: 'DXB', code: 'D', number }, make: 'Nissan', model, customerId, name: customerId ? '' : 'Rashid Debtor', phone: customerId ? '' : '050 606 0400', docLanguage: 'en', complaint: '', arrivedNow: true });
        await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Repair', unitPriceFils: aed * 100, vatRateBp: 0 });
        await approveAll(o.id);
        await quickInvoice(o.id);
        return o;
      };
      const a = await job('60600', 'Altima', 600);
      await leaveOnDebt(a.id, { amountFils: 60000, dueDate: '2026-12-01', signature: sig });
      const b = await job('40400', 'Sunny', 400, a.customerId);
      await createDebt(b.id, 40000, '2026-12-15', sig);
      await changeStage(b.id, 'closed');
    });
    const cashNow = () => page.evaluate(async () => (await (await import('/src/services/money.ts')).cashState()).expected);
    const dlg = page.getByRole('dialog');
    // The board: "Debts" beside "Archive" — one card for the customer with both cars.
    await page.goto(BASE + '#/');
    await front('[role="tab"]').filter({ hasText: 'Долги' }).click();
    const card = front('.debt-card').filter({ hasText: 'Rashid Debtor' });
    await card.filter({ hasText: '1 000,00' }).waitFor();
    // v0.30: a customer is folded — a tap unfolds the cars and the papers.
    await card.locator('.list-row').first().click();
    await card.locator('.list-row').filter({ hasText: 'Altima' }).waitFor();
    await card.locator('.list-row').filter({ hasText: 'Sunny' }).waitFor();
    if (await front('.job-row').filter({ hasText: 'Altima' }).count()) throw new Error('a car gone with a debt is still on the board');
    await shot('22a-board-debts');
    // "Take payment": 250 in cash — the oldest debt first; the cash grows by all of it.
    let before = await cashNow();
    await card.locator('.debt-actions').getByText('Оплата', { exact: true }).click();
    await dlg.getByRole('button', { name: 'Оплата долга' }).and(page.locator('[data-active="true"]')).waitFor();
    await dlg.getByLabel('Сумма').fill('250');
    await dlg.locator('[data-debt-job]').first().filter({ hasText: '250,00' }).waitFor();
    await shot('22b-debt-payment');
    await dlg.getByRole('button', { name: /^Записать приход/ }).click();
    await dlg.waitFor({ state: 'hidden' });
    if ((await cashNow()) - before !== 25000) throw new Error('a debt payment of 250 in cash: the cash moved by ' + ((await cashNow()) - before));
    await card.filter({ hasText: '750,00' }).waitFor();
    // Money → Debts: the same card, the same sum left.
    await page.goto(BASE + '#/money?tab=debts');
    await front('.debt-card').filter({ hasText: 'Rashid Debtor' }).filter({ hasText: '750,00' }).waitFor();
    // Money in as a debt payment with nobody picked: in the cash, no debt touched.
    await page.goto(BASE + '#/money?tab=book');
    // v0.22: the month's money in and out sit on the cash card (no month block); the month row above the card.
    const cashIn = async () => Number(await front('.money-card [data-month-purse="cash"]').getAttribute('data-in'));
    const in0 = await cashIn();
    if (await front('.surface .month-field').count()) throw new Error('the month block is still there');
    if ((await front('.month-field').boundingBox()).y >= (await front('.money-card').boundingBox()).y) throw new Error('the month row is not above the cash card');
    before = await cashNow();
    await front('button').filter({ hasText: /^Приход$/ }).first().click();
    await dlg.getByLabel('Сумма').fill('100');
    await dlg.getByRole('button', { name: 'Оплата долга' }).click();
    await dlg.getByRole('button', { name: /^Записать приход/ }).click();
    await dlg.waitFor({ state: 'hidden' });
    if ((await cashNow()) - before !== 10000) throw new Error('money in with no customer: the cash moved by ' + ((await cashNow()) - before));
    await page.waitForFunction(
      (want) => Number(document.querySelector('.screen[data-role="top"] .money-card [data-month-purse="cash"]')?.getAttribute('data-in')) === want,
      in0 + 10000,
    );
    // The garage on credit: 1 000 of parts, nothing paid — the cash stays, the company owes 1 000.
    before = await cashNow();
    await front('button').filter({ hasText: /^Расход$/ }).first().click();
    await dlg.getByLabel('Сумма').fill('1000');
    await dlg.getByRole('radio', { name: 'В кредит' }).click();
    await dlg.getByRole('button', { name: /^Записать расход/ }).click();
    await dlg.waitFor({ state: 'hidden' });
    if ((await cashNow()) !== before) throw new Error('an expense on credit moved the cash');
    await page.goto(BASE + '#/money?tab=debts');
    await front('.kpi').filter({ hasText: 'Мы должны' }).filter({ hasText: '1 000,00' }).waitFor();
    // v0.30: what the garage owes is its own tab.
    await front('.kpi-tab[data-side="owe"]').click();
    await shot('22c-money-debts', true);
    // 300 of it paid in cash: the cash −300, 700 left.
    await front('.list-row').filter({ hasText: 'Запчасти' }).filter({ hasText: '1 000,00' }).first().click();
    await dlg.getByLabel('Сумма').fill('300');
    await dlg.getByRole('button', { name: /^Оплатить/ }).click();
    await dlg.locator('[data-credit-left="70000"]').waitFor();
    if (before - (await cashNow()) !== 30000) throw new Error('300 paid towards the credit: the cash moved by ' + (before - (await cashNow())));
    await shot('22d-credit-paid');
    await closeModal();
    await dlg.waitFor({ state: 'detached' });
    await front('.kpi').filter({ hasText: 'Мы должны' }).filter({ hasText: '700,00' }).waitFor();
    // The customer pays the rest: both jobs closed, off the debts — back in the archive.
    await front('.kpi-tab[data-side="owed"]').click();
    await front('.debt-card').filter({ hasText: 'Rashid Debtor' }).locator('.list-row').first().click();
    await front('.debt-card.is-open').filter({ hasText: 'Rashid Debtor' }).locator('.debt-actions').getByText('Оплата', { exact: true }).click();
    await dlg.getByLabel('Сумма').fill('750');
    await dlg.getByRole('button', { name: /^Записать приход/ }).click();
    await dlg.waitFor({ state: 'hidden' });
    await front('.debt-card').filter({ hasText: 'Rashid Debtor' }).waitFor({ state: 'detached' });
    await page.goto(BASE + '#/');
    await front('[role="tab"]').filter({ hasText: 'Архив' }).click();
    await front('.job-row').filter({ hasText: 'Altima' }).waitFor();
    await front('.job-row').filter({ hasText: 'Sunny' }).waitFor();
    await front('[role="tab"]').filter({ hasText: /^Все/ }).click();
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
    // v0.21: on the empty VIN and Mulkiya chips a hold opens the phone's photos — only them (no camera after it).
    const holdOn = async (loc) => {
      const box = await loc.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser'),
        (async () => {
          await page.mouse.down();
          await page.waitForTimeout(650);
          await page.mouse.up();
        })(),
      ]);
      if (await fc.element().getAttribute('capture')) throw new Error('a hold must open the photos, not the camera');
      if (await page.waitForEvent('filechooser', { timeout: 900 }).catch(() => null)) throw new Error('a hold opened the camera too');
      return fc;
    };
    await (await holdOn(page.getByRole('button', { name: 'Снять VIN' }))).setFiles([]);
    const emptyMulkiya = await holdOn(page.getByRole('button', { name: 'Снять Mulkiya' }));
    if ((await emptyMulkiya.element().getAttribute('multiple')) === null) throw new Error('the Mulkiya from the photos takes both sides at once');
    await emptyMulkiya.setFiles([]);
    const [vinChooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Снять VIN' }).click()]);
    await vinChooser.setFiles({ name: 'vin.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await page.getByRole('button', { name: 'Фото VIN' }).locator('img').waitFor();
    // A tap took it with the camera; a long press (a right click here) chooses one from the phone's photos.
    if (!(await vinChooser.element().getAttribute('capture'))) throw new Error('a tap on VIN must open the camera');
    const [fromPhotos] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Фото VIN' }).click({ button: 'right' })]);
    if (await fromPhotos.element().getAttribute('capture')) throw new Error('a long press on VIN must open the photos, not the camera');
    await fromPhotos.setFiles([]);
    // A hold (a mouse held down here) chooses from the photos too: the press's length decides, not which event
    // ends it (the iPhone may take a long press over and end it with a click — v0.17.2).
    const vinBox = await page.getByRole('button', { name: 'Фото VIN' }).boundingBox();
    await page.mouse.move(vinBox.x + vinBox.width / 2, vinBox.y + vinBox.height / 2);
    const [held] = await Promise.all([
      page.waitForEvent('filechooser'),
      (async () => {
        await page.mouse.down();
        await page.waitForTimeout(650);
        await page.mouse.up();
      })(),
    ]);
    if (await held.element().getAttribute('capture')) throw new Error('a hold on VIN must open the photos, not the camera');
    await held.setFiles([]);
    await page.getByRole('button', { name: 'Фото VIN' }).click();
    await page.locator('.viewer').getByText('VIN', { exact: true }).waitFor();
    await page.locator('.viewer').getByRole('button', { name: 'Из фото' }).waitFor();
    // Turned a quarter: the turned copy takes the photo's place (a new photo of the car's VIN).
    const vinId = () =>
      page.evaluate(async () => {
        const { db } = await import('/src/db/db.ts');
        const { vinPhotoOf } = await import('/src/services/cover.ts');
        return vinPhotoOf((await db.vehicles.toArray()).find((v) => v.plateSearch.endsWith('31415')).id);
      });
    const unturned = await vinId();
    await page.locator('.viewer').getByRole('button', { name: 'Повернуть' }).click();
    for (let i = 0; i < 50 && (await vinId()) === unturned; i++) await page.waitForTimeout(100);
    if ((await vinId()) === unturned) throw new Error('the VIN photo was not turned');
    await page.locator('.viewer').getByRole('button', { name: 'Повернуть' }).and(page.locator(':not([disabled])')).waitFor();
    // Taken off: the view closes, the chip asks for a photo again; "Undo" puts it back.
    await page.locator('.viewer').getByRole('button', { name: 'Удалить' }).click();
    await page.locator('.viewer').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Снять VIN' }).waitFor();
    await page.getByRole('button', { name: 'Отменить' }).last().click();
    await page.getByRole('button', { name: 'Фото VIN' }).locator('img').waitFor();
    // The Mulkiya beside VIN: a tap takes the front with the camera, "1/2" until the back is taken too.
    const [mulkiya] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Снять Mulkiya' }).click()]);
    if (!(await mulkiya.element().getAttribute('capture'))) throw new Error('a tap on Mulkiya must open the camera');
    await mulkiya.setFiles({ name: 'mulkiya.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await page.getByRole('button', { name: 'Mulkiya', exact: true }).getByText('1/2').waitFor();
    // v0.21: a saved side opens with a tap (not the camera); the missing back is taken right there — a hold on its
    // button picks it from the phone's photos — and it lands on the back, the front stays. (A finger's pause first: a tap
    // on the chip changed under it within 350 ms of the last one is the guard's — ui/tapGuard.ts.)
    await page.waitForTimeout(450);
    await page.getByRole('button', { name: 'Mulkiya', exact: true }).click();
    const mulkiyaView = page.locator('.viewer');
    await mulkiyaView.getByText('Mulkiya, лицевая').waitFor();
    await mulkiyaView.getByRole('button', { name: 'Переснять' }).waitFor();
    const back = await holdOn(mulkiyaView.getByRole('button', { name: 'Mulkiya, оборот' }));
    await back.setFiles(FIXTURE);
    await page.getByRole('button', { name: 'Mulkiya', exact: true }).locator('.vin-thumb').nth(1).waitFor();
    if (await page.getByRole('button', { name: 'Mulkiya', exact: true }).getByText('1/2').count()) throw new Error('both Mulkiya sides expected');
    await mulkiyaView.getByText('2 из 2').or(mulkiyaView.getByText('1 из 2')).first().waitFor();
    await shot('30a2b-mulkiya-sides');
    await page.keyboard.press('Escape');
    await mulkiyaView.waitFor({ state: 'detached' });
    // Opened again: the VIN and both Mulkiya sides are where they were put.
    const docs = () =>
      page.evaluate(async () => {
        const { db } = await import('/src/db/db.ts');
        const { vinPhotoOf, mulkiyaOf } = await import('/src/services/cover.ts');
        const v = (await db.vehicles.toArray()).find((x) => x.plateSearch.endsWith('31415'));
        const m = await mulkiyaOf(v.id);
        return { vin: !!(await vinPhotoOf(v.id)), front: !!m.mulkiya, back: !!m.mulkiya_back };
      });
    await page.reload();
    await page.getByRole('button', { name: 'Фото VIN' }).locator('img').waitFor();
    await page.getByRole('button', { name: 'Mulkiya', exact: true }).locator('.vin-thumb').nth(1).waitFor();
    if (JSON.stringify(await docs()) !== JSON.stringify({ vin: true, front: true, back: true })) throw new Error('the documents\' photos after reopening: ' + JSON.stringify(await docs()));
    // The job card (v0.17.3): the car's outline — a tap where it is damaged, its kind, its photo; the chip counts.
    await page.getByRole('button', { name: 'Job card', exact: true }).click();
    const card = page.getByRole('dialog', { name: 'Job card' });
    // The car in 3D (v0.19) — or the drawing where there is no WebGL. Measured once the sheet has come up.
    const car3d = card.locator('canvas.car3d-canvas');
    const flat = card.locator('svg[role="img"]');
    await car3d.or(flat).first().waitFor({ timeout: 20000 });
    await settled();
    if (await car3d.count()) {
      // From above, then a tap on the roof: a point on the top.
      await card.getByText('Сверху', { exact: true }).click();
      await page.waitForTimeout(800);
      const b = await car3d.boundingBox();
      await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5);
    } else {
      const outline = await flat.boundingBox();
      await page.mouse.click(outline.x + outline.width * 0.3, outline.y + outline.height * 0.3);
    }
    await card.getByRole('button', { name: 'Вмятина', exact: true }).click();
    await card.getByRole('button', { name: 'Вмятина', exact: true }).and(page.locator('[data-active="true"]')).waitFor();
    const [damage] = await Promise.all([page.waitForEvent('filechooser'), card.locator('.jc-mark .strip-tile[data-empty]').click()]);
    if (!(await damage.element().getAttribute('capture'))) throw new Error('the damage photo tile must open the camera');
    await damage.setFiles(FIXTURE);
    await card.locator('.jc-mark .strip-tile img').waitFor();
    // A hold on the same tile (v0.20): the phone's photos, and only them — no camera after it; the photo picked
    // takes the point's photo's place, as a camera's would.
    const photoOf = () =>
      page.evaluate(async () => {
        const { db } = await import('/src/db/db.ts');
        const o = location.hash.match(/orders\/([^/?]+)/)[1];
        const insp = await db.inspections.where('orderId').equals(o).filter((i) => i.kind === 'intake').first();
        return (await db.damageMarks.where('inspectionId').equals(insp.id).first()).mediaId;
      });
    const firstPhoto = await photoOf();
    const tb = await card.locator('.jc-mark .strip-tile[data-empty]').boundingBox();
    const [damagePhotos] = await Promise.all([
      page.waitForEvent('filechooser'),
      (async () => {
        await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(650);
        await page.mouse.up();
      })(),
    ]);
    if (await damagePhotos.element().getAttribute('capture')) throw new Error('a hold on the damage photo tile must open the photos');
    if (await page.waitForEvent('filechooser', { timeout: 900 }).catch(() => null)) throw new Error('a hold opened the camera too');
    await damagePhotos.setFiles(FIXTURE);
    for (let i = 0; i < 50 && (await photoOf()) === firstPhoto; i++) await page.waitForTimeout(100);
    if ((await photoOf()) === firstPhoto) throw new Error('the photo from the phone did not go to the point');
    await card.locator('.jc-mark .strip-tile img').waitFor();
    if (await car3d.count()) {
      // Close up (v0.20): a wheel over the car brings it nearer and puts no point; the round button — the whole car.
      // Right on the point just put: a wheel over its pin brings the car closer too (v0.33 — it scrolled the sheet).
      const pins = await card.locator('.jc-pin').count();
      const pb = await card.locator('.jc-pin').first().boundingBox();
      await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
      if (!(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.jc-pin'), { x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 })))
        throw new Error('the point is not under the mouse');
      for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120);
      await card.locator('.car3d-whole').waitFor();
      await shot('30a2-job-card-close');
      if ((await card.locator('.jc-pin').count()) !== pins) throw new Error('bringing the car closer put a point');
      await card.locator('.car3d-whole').click();
      await card.locator('.car3d-whole').waitFor({ state: 'detached' });
    }
    await shot('30a3-job-card');
    await card.getByRole('button', { name: 'Готово' }).click();
    await page.getByRole('button', { name: 'Job card', exact: true }).getByText('1', { exact: true }).waitFor();
    const marks = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const o = (await db.orders.toArray()).find((x) => x.id === location.hash.match(/orders\/([^/?]+)/)[1]);
      const insp = await db.inspections.where('orderId').equals(o.id).filter((i) => i.kind === 'intake').first();
      return (await db.damageMarks.where('inspectionId').equals(insp.id).toArray()).map((m) => [m.view, m.type, !!m.mediaId]);
    });
    if (JSON.stringify(marks) !== JSON.stringify([['top', 'dent', true]])) throw new Error('the job card point: ' + JSON.stringify(marks));
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
    // A part shows its photo itself beside its name (v0.29).
    await page.locator('.list-row').filter({ hasText: 'Фильтр салона' }).locator('.part-thumb:not([data-empty]) img').waitFor();
    // The parts by name only, in one tap (for a parts seller).
    await page.getByRole('button', { name: 'Скопировать запчасти' }).click();
    await page.getByText('Запчасти скопированы').first().waitFor();
    await shot('31b-copy-lines');
    // A line without VAT (a fee paid for the customer): 100 AED stays 100 AED.
    await page.getByRole('button', { name: 'Работа', exact: true }).click();
    await dlg.getByLabel('Что сделали').fill('RTA test fee');
    await dlg.getByLabel('Цена', { exact: true }).fill('100');
    // v0.32: the line's money at a glance — what the customer pays, the VAT in it.
    await dlg.locator('.line-sum [data-sum="total"]').filter({ hasText: '105,00' }).filter({ hasText: 'в т. ч. VAT 5,00' }).waitFor();
    await dlg.getByText('Без', { exact: true }).click();
    await dlg.locator('.line-sum [data-sum="total"]').filter({ hasText: '100,00' }).filter({ hasText: 'без VAT' }).waitFor();
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
    // A discount after the invoice — «％» under the invoice's lines (v0.21; it was «…» → «Скидка»): a credit note and
    // a new invoice (10 % of 320.50 = 32.05).
    await front('button.add-extra[aria-label="Скидка"]').click();
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
    await page.getByRole('button', { name: /^Оплата ·/ }).click();
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
    // Lines moved by hand (v0.12): the grip of Polish dragged above Wash; the order stays. The grip is always
    // there (v0.17.2) — no edit mode to open first.
    const grip = (name) => page.locator('.screen[data-role="top"] .list-row').filter({ hasText: name }).locator('.sort-grip');
    await grip('Polish').waitFor();
    // The sheet has gone (its shade would take the press).
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    // The lines in the middle of the screen, clear of the floating bar (as a finger would scroll them up first).
    await grip('Polish').evaluate((el) => el.scrollIntoView({ block: 'center' }));
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
    // The drop did not open the line, and the list's own motion is back on (no `data-sorting` left on it).
    await settled();
    if (await page.getByRole('dialog').count()) throw new Error('dragging a line opened it');
    if (await page.locator('.screen[data-role="top"] .list[data-sorting]').count()) throw new Error('the list kept data-sorting after the drop');
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
  await step('v0.22: the scanner report deleted from its sheet, with its PDF; «Отменить» brings both back', async () => {
    const obdPdfs = () => page.evaluate(async () => (await import('/src/db/db.ts')).db.media.filter((m) => m.slot === 'obd_report').count());
    const pdfs = await obdPdfs();
    await page.getByRole('button', { name: 'Сканер' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
    await page.getByText('Отчёт сканера удалён').first().waitFor();
    await front('.job-obd').waitFor({ state: 'detached' });
    if ((await obdPdfs()) !== pdfs - 1) throw new Error('the report’s PDF stayed');
    await page.getByRole('button', { name: 'Отменить' }).last().click();
    await front('.job-obd').waitFor();
    if ((await obdPdfs()) !== pdfs) throw new Error('«Отменить» did not bring the PDF back');
    // The car's card keeps what the report gave it.
    const vin = await page.evaluate(async () => (await (await import('/src/db/db.ts')).db.vehicles.toArray()).find((x) => x.plateSearch.endsWith('31415'))?.vin);
    if (vin !== '1GKFLTE30BX000001') throw new Error('the car lost its VIN: ' + vin);
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
    // What the customer complains of on this visit (the sheet under the name): it goes to the group too (v0.17.2).
    const complaintLine = page.locator('.screen[data-role="top"]').getByRole('button', { name: 'Жалоба', exact: true });
    await complaintLine.click();
    const complaint = page.getByRole('dialog', { name: 'Жалоба' });
    await complaint.getByRole('textbox', { name: 'Жалоба' }).fill('Стук спереди при торможении');
    await complaint.getByRole('button', { name: 'Сохранить' }).click();
    await complaintLine.getByText('Стук спереди при торможении').waitFor();
    // The job to the garage group (v0.13): the share sheet gets the car's photo and the text — the car, the
    // customer by name only, the lines with their amounts.
    await page.evaluate(() => {
      window.__shared = null;
      navigator.canShare = () => true;
      navigator.share = async (d) => { window.__shared = { text: d.text, files: (d.files || []).map((f) => f.name) }; };
    });
    await page.locator('.screen[data-role="top"]').getByRole('button', { name: 'Поделиться', exact: true }).click();
    const shared = await page.evaluate(() => window.__shared);
    // What the customer complains of goes with it (v0.17.2), under the name.
    if (!shared || shared.files.length !== 1 || !/^Nissan Sunny/.test(shared.text) || !/Клиент: Сергей Иванов\nЖалоба: Стук спереди при торможении\n/.test(shared.text) || !/WASH/.test(shared.text) || !/Итого/.test(shared.text) || shared.text.includes('971'))
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
  await step('v0.16: a service — done by others: on the bill, and what we pay them is the job expense', async () => {
    const id = await page.evaluate(async () => {
      const { checkIn } = await import('/src/services/orders.ts');
      return (await checkIn({ plate: { emirate: 'DXB', code: 'W', number: '35001' }, make: 'Nissan', model: 'Patrol', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true })).id;
    });
    await page.goto(BASE + '#/orders/' + id);
    const dlg = page.getByRole('dialog');
    await front('.add-btn').filter({ hasText: 'Услуга' }).click();
    await dlg.getByText('Добавить услугу').waitFor();
    await dlg.getByLabel('Услуга').fill('Car wash');
    await dlg.getByLabel('Цена', { exact: true }).fill('35');
    await dlg.getByLabel('Платим').fill('25');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await front('.list-row').filter({ hasText: 'CAR WASH' }).waitFor();
    await page.getByRole('button', { name: 'Согласен' }).first().click();
    await page.waitForTimeout(600);
    await front('.list-row').filter({ hasText: 'CAR WASH' }).first().click();
    await dlg.getByRole('button', { name: /^Оплатить/ }).click();
    await dlg.getByRole('button', { name: 'Наличные' }).click();
    await page.getByText('Записано в расходы заказа').first().waitFor();
    const e = await page.evaluate(async (id) => {
      const { db } = await import('/src/db/db.ts');
      const list = await db.expenses.where('orderId').equals(id).toArray();
      const cats = await db.expenseCategories.toArray();
      return list.map((x) => [x.amountFils, cats.find((c) => c.id === x.categoryId)?.code].join(':'));
    }, id);
    if (e.join() !== '2500:subcontract') throw new Error('service expense: ' + JSON.stringify(e));
    await page.keyboard.press('Escape');
  });
  await step('v0.18: the VIN and year read off the photos — a proven one goes in by itself, the rest is looked at', async () => {
    // Pictures drawn in the page: a windscreen VIN label (light letters on a dark ground, dust, a little turned) and
    // a Mulkiya's back. Dust from a fixed seed: the same picture every run.
    const picture = (o) =>
      page.evaluate(async (o) => {
        const { vinCheckDigit } = await import('/src/domain/vin.ts');
        const fill = (v) => v.slice(0, 8) + (o.adds ? vinCheckDigit(v) : vinCheckDigit(v) === '0' ? '1' : '0') + v.slice(9);
        const vin = fill(o.vin);
        const c = document.createElement('canvas');
        c.width = o.w;
        c.height = o.h;
        const g = c.getContext('2d');
        g.fillStyle = o.ground;
        g.fillRect(0, 0, c.width, c.height);
        let seed = 7;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < o.dust; i++) {
          g.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.5})`;
          g.fillRect(rnd() * c.width, rnd() * c.height, 2, 2);
        }
        g.translate(c.width / 2, c.height / 2);
        g.rotate((o.tilt * Math.PI) / 180);
        g.fillStyle = o.ink;
        for (const [text, x, y, size] of o.lines) {
          g.font = `600 ${size}px Arial, sans-serif`;
          g.fillText(text.replace('{VIN}', vin), x - c.width / 2, y - c.height / 2);
        }
        return { vin, jpeg: c.toDataURL('image/jpeg', 0.9).split(',')[1] };
      }, o);
    const car = (number, make, model) =>
      page.evaluate(
        async ([number, make, model]) => {
          const { checkIn } = await import('/src/services/orders.ts');
          const o = await checkIn({ plate: { emirate: 'DXB', code: 'V', number }, make, model, name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
          return { id: o.id, vehicleId: o.vehicleId };
        },
        [number, make, model],
      );
    const vehicle = (vehicleId) =>
      page.evaluate(async (id) => {
        const { db } = await import('/src/db/db.ts');
        const v = await db.vehicles.get(id);
        return { vin: v.vin ?? null, year: v.year ?? null };
      }, vehicleId);
    const waitFor = async (what, fn, ok, ms = 90000) => {
      const t0 = Date.now();
      let last;
      while (Date.now() - t0 < ms) {
        last = await fn();
        if (ok(last)) return last;
        await page.waitForTimeout(250);
      }
      throw new Error(`${what}: ${JSON.stringify(last)}`);
    };

    // 1. The VIN label: its check digit adds up (a Nissan's, made 2016) — in the card at once, the year with it.
    const one = await car('17017', 'Nissan', 'Patrol');
    const label = await picture({ w: 1400, h: 900, ground: '#24403f', ink: '#e9f2f0', dust: 1500, tilt: 3, adds: true, vin: 'JN1TANY6?G0123456', lines: [['{VIN}', 330, 470, 64]] });
    await page.goto(BASE + '#/orders/' + one.id);
    const [plate] = await Promise.all([page.waitForEvent('filechooser'), front('button[aria-label="Снять VIN"]').click()]);
    await plate.setFiles({ name: 'vin.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(label.jpeg, 'base64') });
    await front('.vin-chip[data-reading]').first().waitFor({ timeout: 15000 });
    await page.getByText(`Записано: ${label.vin} · 2016`).first().waitFor({ timeout: 90000 });
    const filled = await vehicle(one.vehicleId);
    if (filled.vin !== label.vin || filled.year !== 2016) throw new Error('the VIN read off the label: ' + JSON.stringify(filled));
    await shot('30h-vin-read');
    // "Undo" puts the card back; "Read VIN" in the photo's full view reads it again (the photo is read once: at once).
    await page.getByRole('button', { name: 'Отменить' }).last().click();
    await waitFor('undone', () => vehicle(one.vehicleId), (v) => v.vin === null && v.year === null);
    await front('button[aria-label="Фото VIN"]').click();
    await page.locator('.viewer').getByRole('button', { name: 'Прочитать VIN' }).click();
    await waitFor('read again', () => vehicle(one.vehicleId), (v) => v.vin === label.vin && v.year === 2016, 20000);
    await page.locator('.viewer').getByRole('button', { name: 'Закрыть' }).click();
    await page.locator('.viewer').waitFor({ state: 'detached' });

    // 2. A Mulkiya with a VIN made for elsewhere (no check digit): not proven — "Check the VIN", an orange dot on the
    //    VIN chip; its "Model" year, read the same twice, goes in by itself. A tap shows the line the VIN was read off
    //    and its 17 places; "Save" puts it in.
    const two = await car('17018', 'Toyota', 'Land Cruiser');
    const card = await picture({
      w: 1400,
      h: 880,
      ground: '#f3efe2',
      ink: '#1d1d1d',
      dust: 0,
      tilt: 0,
      adds: false,
      vin: 'JTMHV05J?K4123456',
      lines: [
        ['UNITED ARAB EMIRATES', 80, 110, 44],
        ['Model: 2019', 80, 250, 46],
        ['Origin: JAPAN', 760, 250, 46],
        ['Veh. Type: STATION', 80, 360, 46],
        ['Chassis No.: {VIN}', 80, 470, 46],
        ['Engine No.: 1VD0123456', 80, 580, 46],
      ],
    });
    await page.goto(BASE + '#/orders/' + two.id);
    const [mulkiya] = await Promise.all([page.waitForEvent('filechooser'), front('button[aria-label="Снять Mulkiya"]').click()]);
    await mulkiya.setFiles({ name: 'mulkiya.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(card.jpeg, 'base64') });
    await page.getByText('Проверьте VIN').first().waitFor({ timeout: 90000 });
    const untouched = await vehicle(two.vehicleId);
    if (untouched.vin !== null || untouched.year !== 2019) throw new Error('an unproven VIN went in, or the Mulkiya’s year did not: ' + JSON.stringify(untouched));
    // The read waits to be looked at: the orange dot is on the Mulkiya it was read off (the VIN has no photo — its chip
    // still takes one with a tap, v0.21); the Mulkiya opens with a tap, "Check VIN" in its full view.
    await front('.vin-chip[data-check][aria-label="Mulkiya"]').waitFor();
    if (!(await front('button[aria-label="Снять VIN"]').count())) throw new Error('the empty VIN chip must still offer the camera');
    await front('button[aria-label="Mulkiya"]').click();
    await page.locator('.viewer').getByRole('button', { name: 'Проверить VIN' }).click();
    const sheet = page.getByRole('dialog', { name: 'Проверка VIN' });
    await sheet.locator('img.vin-crop').waitFor();
    if ((await sheet.locator('.vin-boxes > span').count()) !== 17) throw new Error('the VIN is not in its 17 places');
    if ((await sheet.getByLabel('Год').inputValue()) !== '2019') throw new Error('the Mulkiya’s year is not offered');
    await settled();
    await shot('30h2-vin-check');
    await sheet.getByRole('button', { name: 'Сохранить' }).click();
    const kept = await waitFor('kept', () => vehicle(two.vehicleId), (v) => !!v.vin, 10000);
    if (kept.vin.length !== 17 || kept.year !== 2019) throw new Error('the VIN looked at: ' + JSON.stringify(kept));
    await front('.vin-chip[data-check]').waitFor({ state: 'detached' });
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
    // v0.22: the archive's rows are small and dated — no 2 : 1 cards there; the job just taken off is «Сегодня».
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.screen[data-role="top"] .job-mini')].map((r) => ({ h: Math.round(r.getBoundingClientRect().height), d: r.querySelector('.job-mini-date')?.textContent?.trim() ?? '' })),
    );
    if (!rows.length || rows.some((r) => r.h > 88 || !/^(Сегодня|Вчера|\d{2}\/\d{2}(\/\d{4})?)$/.test(r.d))) throw new Error('archive rows: ' + JSON.stringify(rows));
    if (await front('.job-card').count()) throw new Error('a large card in the archive');
    await back.locator('.job-mini-date', { hasText: 'Сегодня' }).waitFor();
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
    // "…" no longer has "On credit" or "No payment" (v0.19): both are in the payment sheet; nor (v0.21) Photos,
    // Mechanic or Discount — with the invoice out, too.
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await dlg.getByRole('button', { name: 'Клиент', exact: true }).waitFor();
    for (const gone of ['Без оплаты', 'В долг', 'Фото', 'Механику', 'Скидка'])
      if (await dlg.getByRole('button', { name: gone, exact: true }).count()) throw new Error(`"…" still has «${gone}»`);
    await shot('32a-more');
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'hidden' });
    // "Оплата" → No payment: the car leaves, nothing owed — no payment, no debt.
    await page.getByRole('button', { name: /^Оплата ·/ }).click();
    await dlg.getByRole('button', { name: 'Без оплаты', exact: true }).click();
    await dlg.getByRole('button', { name: 'Оплата у главного' }).waitFor();
    await page.waitForTimeout(500);
    await shot('33d-close-unpaid');
    // Two ways: paid to the owner (the usual), or no money at all — here, no money.
    await dlg.getByRole('button', { name: 'Денег не будет' }).click();
    await dlg.getByRole('button', { name: 'Закрыть без оплаты' }).click();
    await dlg.waitFor({ state: 'hidden' });
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
    await top.getByText('Нам должны').waitFor();
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
    await page.getByRole('button', { name: /^Оплата ·/ }).click();
    await dlg.getByRole('button', { name: 'Без оплаты', exact: true }).click();
    // Paid to the owner is the one picked at first.
    await dlg.getByRole('button', { name: 'Оплата у главного' }).and(page.locator('[data-active="true"]')).waitFor();
    await shot('33h-close-owner');
    await dlg.getByRole('button', { name: 'Закрыть без оплаты' }).click();
    await dlg.waitFor({ state: 'hidden' });
    await page.getByText('Закрыт').first().waitFor();
    if (await page.getByRole('button', { name: /^Оплата ·/ }).count()) throw new Error('a job paid to the owner still asks for payment');
    await page.locator('.list-row').filter({ hasText: 'Оплата у главного' }).filter({ hasText: '1 050,00' }).first().waitFor();
    await shot('33i-job-owner', true);
    if ((await cashOf()) !== before) throw new Error('paid to the owner must not touch the cash');
    await page.goto(BASE + '#/money?tab=debts');
    await page.locator('.screen[data-role="top"]').getByText('Нам должны').waitFor();
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
    // When the car was promised: rarely needed — "…" → "Срок" (v0.17.3), a time from the sheet; then its chip on the card.
    if (await front('.due-chip').count()) throw new Error('an empty "Due" chip is still on the card');
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await dlg.getByRole('button', { name: 'Срок' }).click();
    await page.getByRole('dialog', { name: 'Когда будет готова' }).locator('button.chip').first().waitFor();
    await shot('34a-due-sheet');
    await page.getByRole('dialog', { name: 'Когда будет готова' }).locator('button.chip').first().click();
    await front('.due-chip[data-state="set"]').waitFor();
    // The job's notes: their own tab, a chat with oneself — the text, "+" for photos and videos, camera, voice.
    await front('.scroll-tabs > button').filter({ hasText: 'Заметки' }).click();
    await page.getByLabel('Заметка').fill('Front pads at 2 mm, discs OK');
    await front('[aria-label="Добавить"]').click();
    await front('.note-bubble').filter({ hasText: 'Front pads at 2 mm' }).waitFor();
    // A note answered (v0.19): picked by a long press (a right click here) — the bar: how many, Reply, Copy, Delete;
    // "Reply" — the note above the field; the answer quotes it, and the bar is gone once it is sent.
    const rowOf = (text) => front('.note-row').filter({ has: page.locator('.note-text', { hasText: text }) });
    await rowOf('Front pads at 2 mm').locator('.note-bubble').click({ button: 'right' });
    await front('.notes-picking').getByText('Выбрано: 1').waitFor();
    await front('.notes-picking').getByRole('button', { name: 'Ответить' }).click();
    await front('.notes-reply').filter({ hasText: 'Front pads at 2 mm' }).waitFor();
    await page.getByLabel('Заметка').fill('Ordered new pads');
    await front('[aria-label="Добавить"]').click();
    await rowOf('Ordered new pads').locator('.note-quote').filter({ hasText: 'Front pads at 2 mm' }).waitFor();
    if (await front('.notes-reply').count()) throw new Error('the answer bar stays after the answer is sent');
    // Two picked: copied together (the words, in order); picking ends.
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await rowOf('Ordered new pads').locator('.note-bubble').click({ button: 'right' });
    await front('.notes-picking').getByText('Выбрано: 1').waitFor();
    await rowOf('Front pads at 2 mm').locator('.note-pick').click();
    await front('.notes-picking').getByText('Выбрано: 2').waitFor();
    await shot('34b-notes-picked');
    await front('.notes-picking').getByRole('button', { name: 'Скопировать' }).click();
    await page.getByText('Скопировано').first().waitFor();
    await front('.notes-picking').waitFor({ state: 'detached' });
    // (Windows keeps the clipboard's lines as CRLF.)
    const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
    if (copied !== 'Front pads at 2 mm, discs OK\nOrdered new pads') throw new Error('notes copied: ' + JSON.stringify(copied));
    await front('input[data-note-media]').setInputFiles(FIXTURE);
    await front('.note-photo').first().waitFor();
    // Voice messages as in WhatsApp (v0.17.2): a recording made in the page (2 s of a tone, louder in the middle),
    // kept with its bars; one more without bars (made before they were kept) gets them from its recording.
    await page.evaluate(async () => {
      const { addNote } = await import('/src/services/notes.ts');
      const { peaksOfBlob } = await import('/src/ui/voice.ts');
      const orderId = location.hash.match(/orders\/([^/?]+)/)[1];
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.setValueAtTime(0.9, ctx.currentTime + 0.7);
      gain.gain.setValueAtTime(0.3, ctx.currentTime + 1.4);
      osc.start();
      const rec = new MediaRecorder(dest.stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const stopped = new Promise((r) => (rec.onstop = r));
      rec.start(200);
      await new Promise((r) => setTimeout(r, 2000));
      rec.stop();
      await stopped;
      osc.stop();
      void ctx.close();
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      await addNote(orderId, { voice: blob, seconds: 2, peaks: await peaksOfBlob(blob) });
      await addNote(orderId, { voice: blob, seconds: 2 });
    });
    const voice = front('.note-voice');
    await voice.nth(1).waitFor();
    // Both drawn with the recording's bars: the louder middle stands out (the older note's read from its recording).
    for (const k of [0, 1])
      await page.waitForFunction(
        (k) => {
          const bars = [...document.querySelectorAll('.screen[data-role="top"] .note-voice')][k]?.querySelectorAll('.voice-bars:not(.voice-played) > i') ?? [];
          const h = [...bars].map((b) => Number(b.style.getPropertyValue('--h')));
          return h.length === 36 && Math.max(...h) === 1 && Math.min(...h) < 0.9;
        },
        k,
        { timeout: 10000 },
      );
    // Play, then pause: the place is kept, and the microphone has given way to the speed — 1×, a tap: 1,5× (kept
    // for the next ones).
    await voice.first().getByRole('button', { name: 'Слушать' }).click();
    await voice.first().getByRole('button', { name: 'Пауза' }).click();
    await voice.first().getByRole('button', { name: 'Слушать' }).waitFor();
    await voice.first().getByRole('button', { name: 'Скорость' }).click();
    await voice.first().getByRole('button', { name: 'Скорость' }).getByText('1,5×').waitFor();
    if ((await page.evaluate(() => localStorage.getItem('mygarage.voiceRate'))) !== '1.5') throw new Error('the voice speed is not kept');
    // Taps in a row all count (the tap guard knows the pill by its name, not its words): 1,5× → 2× → 1× → 1,5×.
    const speed = voice.first().getByRole('button', { name: 'Скорость' });
    await speed.click();
    await speed.click();
    await speed.click();
    await speed.getByText('1,5×').waitFor();
    if ((await page.evaluate(() => localStorage.getItem('mygarage.voiceRate'))) !== '1.5') throw new Error('quick taps on the voice speed were dropped');
    // A tap halfway along the bars puts the dot there: 0:01 of 0:02.
    const tapWave = async (k, frac) => {
      const box = await voice.nth(k).getByRole('slider', { name: 'Место в записи' }).boundingBox();
      await page.mouse.click(box.x + box.width * frac, box.y + box.height / 2);
    };
    await tapWave(0, 0.5);
    await page.waitForFunction(() => document.querySelector('.screen[data-role="top"] .note-voice [role="slider"]')?.getAttribute('aria-valuenow') === '1');
    // Near its end and played on: when it ends, the next voice message plays by itself, at the same speed.
    await tapWave(0, 0.95);
    await voice.first().getByRole('button', { name: 'Слушать' }).click();
    await voice.nth(1).getByRole('button', { name: 'Пауза' }).waitFor({ timeout: 8000 });
    await voice.nth(1).getByRole('button', { name: 'Скорость' }).getByText('1,5×').waitFor();
    await voice.nth(1).getByRole('button', { name: 'Пауза' }).click();
    if (await voice.first().getByRole('button', { name: 'Скорость' }).count()) throw new Error('two voice notes in the player at once');
    await shot('34a2-notes-chat');
    // The two tabs move like pages: a swipe to the right on the notes brings the job back, to the left — the notes.
    const jobSwipe = (dir) =>
      front('.job-panel').first().evaluate((el, dir) => {
        const y = 420;
        const x0 = dir < 0 ? 330 : 60;
        const touch = (x) => new Touch({ identifier: 2, target: el, clientX: x, clientY: y });
        const fire = (type, x, list = true) => el.dispatchEvent(new TouchEvent(type, { touches: list ? [touch(x)] : [], changedTouches: [touch(x)], bubbles: true, cancelable: true }));
        fire('touchstart', x0);
        for (let i = 1; i <= 8; i++) fire('touchmove', x0 + dir * i * 25);
        fire('touchend', x0 + dir * 200, false);
      }, dir);
    await jobSwipe(1);
    await page.waitForFunction(() => !location.hash.includes('tab=notes'));
    await page.getByRole('button', { name: 'Запчасть', exact: true }).waitFor();
    await page.waitForTimeout(450);
    await jobSwipe(-1);
    await page.waitForFunction(() => location.hash.includes('tab=notes'));
    await front('.note-text').filter({ hasText: 'Front pads at 2 mm' }).waitFor();
    await page.waitForTimeout(450);
    await front('.scroll-tabs > button').filter({ hasText: 'Основная' }).click();
    await page.getByRole('button', { name: 'Запчасть', exact: true }).waitFor();
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
    // The profit (blurred until tapped), with VAT since v0.22: 934.50 (409.50 + 525.00) − 315 (the part, 300 with the
    // seller's 5 % — v0.31) − 300.
    await page.locator('.list-row', { hasText: 'Прибыль' }).click();
    await page.locator('.profit-amount[data-shown="true"]').getByText('319,50').waitFor();
    // Two mechanics on the job (v0.17.2): each chip on by itself; the task goes to both.
    const crewChips = front('.job-foot button.chip:not(.due-chip):not(.vin-chip)');
    const names = await crewChips.allTextContents();
    await crewChips.nth(0).click();
    await crewChips.nth(1).click();
    await front('.job-foot button.chip[aria-pressed="true"]').nth(1).waitFor();
    if ((await front('.job-foot button.chip[aria-pressed="true"]').count()) !== 2) throw new Error('two mechanics on the job expected');
    // A hold on a mechanic's chip (a right click here) — the task in English (v0.21; it was «…» → «Механику»), and the
    // chip stays as it was; "…" → Report: what was done, for the customer.
    await crewChips.nth(0).click({ button: 'right' });
    const task = page.getByRole('dialog', { name: `Механикам · ${names[0]}, ${names[1]}` });
    await task.waitFor();
    if ((await front('.job-foot button.chip[aria-pressed="true"]').count()) !== 2) throw new Error('the hold on a mechanic chip must not take the mechanic off');
    if (!/To do:[\s\S]*BUMPER PAINT/.test(await task.locator('textarea').inputValue())) throw new Error('the mechanic task lists the work');
    await shot('34f-mechanic');
    await task.locator('.mantine-Modal-close').click();
    await task.waitFor({ state: 'detached' });
    // After the hold, a plain tap on the chip still takes the mechanic off and puts them back.
    await crewChips.nth(0).click();
    await front('.job-foot button.chip[aria-pressed="true"]').nth(1).waitFor({ state: 'detached' });
    await crewChips.nth(0).click();
    await front('.job-foot button.chip[aria-pressed="true"]').nth(1).waitFor();
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
    await row.locator('.job-card-due').waitFor();
    await row.locator('svg[aria-label="На стороне"]').waitFor();
    // «Сегодня» — a bell in the head with how many (v0.30).
    await front('.today-bell .today-bell-n').waitFor();
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
    // The supplier base as the garage's own workbook (UAE_Contacts.xlsx): out ready as the sheet opens; a workbook in
    // brings its suppliers up to it — a new one added, one already here (by phone) updated.
    await front('button').filter({ hasText: /^Excel$/ }).click();
    await page.locator('.mantine-Modal-content button.action-tile:not([disabled])', { hasText: 'Выгрузить' }).waitFor();
    await shot('35c-supplier-book');
    await page.keyboard.press('Escape');
    const bookFile = await page.evaluate(async () => {
      const { buildSupplierBook } = await import('/src/domain/supplierBook.ts');
      const now = new Date().toISOString();
      const b = await buildSupplierBook(
        [
          { s: { id: 'x1', name: 'Book Spares LLC', phone: '+971551112233', makes: ['Kia'], createdAt: now }, id: 'CT-0901' },
          { s: { id: 'x2', name: 'Gulf Lights', phone: '+971507654321', parts: 'Фары, фонари', createdAt: now }, id: 'CT-0902' },
        ],
        null,
        now.slice(0, 10),
      );
      let s = '';
      for (const x of b) s += String.fromCharCode(x);
      return btoa(s);
    });
    await front('input[data-suppliers-input]').setInputFiles({ name: 'UAE_Contacts.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bookFile, 'base64') });
    await page.getByText('Добавлено: 1, обновлено: 1').first().waitFor();
    await front('.list-row').filter({ hasText: 'Book Spares LLC' }).waitFor();
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
    await page.getByRole('button', { name: /^Оплата ·/ }).click();
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
    await page.getByText('Фото при приёмке').waitFor();
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
    await page.locator('.mantine-Modal-content').filter({ hasText: 'Выгрузить' }).waitFor({ state: 'detached' }).catch(() => undefined);
    await page.goto(BASE + '#/money?tab=expenses&add=1');
    await page.getByRole('dialog').last().waitFor();
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
    // The cash box: a movement opens as its line of the book — the expense, with the photos added there; money in
    // takes photos too (a sale for cash: the slip), and its line in the box gets the paperclip.
    await page.evaluate(async () => {
      const { addIncome } = await import('/src/services/ledger.ts');
      const { dubaiDate } = await import('/src/domain/dates.ts');
      await addIncome({ date: dubaiDate(new Date().toISOString()), category: 'sales', amountFils: 1500, method: 'cash', note: 'Proof sale' });
    });
    await page.goto(BASE + '#/money?tab=cash');
    await front('.list-row.clickable').filter({ hasText: 'Proof Shop' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Пруф', exact: true }).nth(1).waitFor();
    await closeModal();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await front('.list-row.clickable').filter({ hasText: 'Proof sale' }).first().click();
    await page.getByRole('dialog').getByText('Продажа', { exact: true }).first().waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Добавить пруф' }).waitFor();
    await page.locator('input[data-photo-input="proof"]').setInputFiles({ name: 'slip.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    await page.getByRole('dialog').getByRole('button', { name: 'Пруф', exact: true }).first().waitFor();
    await shot('24b-cash-proof');
    await closeModal();
    await front('.list-row').filter({ hasText: 'Proof sale' }).first().getByLabel('Пруф').waitFor();
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
  await step('v0.22: the report counts every sum with VAT — no VAT section, the profit from the totals', async () => {
    await page.goto(BASE + '#/reports');
    await page.getByText('Валовая прибыль').first().waitFor();
    if (await page.getByText(/VAT с продаж|VAT в покупках|VAT к уплате|без VAT/).count()) throw new Error('the report still takes VAT apart');
    const fils = (s) => Math.round(Number(s.replace(/[^\d,−-]/g, '').replace('−', '-').replace(',', '.')) * 100);
    const kpi = fils(await front('.kpi').filter({ hasText: 'Выручка с VAT' }).locator('.money').first().textContent());
    const rows = await front('.list')
      .filter({ hasText: 'Валовая прибыль' })
      .locator('.list-row')
      .evaluateAll((els) => els.map((e) => [e.querySelector('.title')?.textContent ?? '', e.querySelector('.money')?.textContent ?? '']));
    const val = (name) => {
      const r = rows.find(([t]) => t.includes(name));
      return r ? fils(r[1]) : 0;
    };
    const [rev, other, parts, spent, profit] = ['Выручка с VAT', 'Прочие приходы', 'Себестоимость запчастей', 'Расходы', 'Валовая прибыль'].map(val);
    if (rev !== kpi || profit !== rev + other - parts - spent) throw new Error('report rows: ' + JSON.stringify(rows));
    // The month's invoices with VAT, credit notes less — counted here on their own.
    const want = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const { dubaiDate } = await import('/src/domain/dates.ts');
      const today = dubaiDate(new Date().toISOString());
      const from = today.slice(0, 8) + '01';
      return (await db.invoices.toArray()).filter((i) => dubaiDate(i.issuedAt) >= from && dubaiDate(i.issuedAt) <= today).reduce((s, i) => s + (i.type === 'credit_note' ? -1 : 1) * i.totalFils, 0);
    });
    if (kpi !== want) throw new Error(`revenue ${kpi}, the month's invoices ${want}`);
  });
  await step('v0.22: «Удалить все данные» and «Убрать перенесённое» folded under «Сброс»', async () => {
    // A job as if carried over from Eaglecart: «Убрать перенесённое» has something to take.
    const id = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const o = (await db.orders.toArray()).find((x) => x.stage === 'closed');
      await db.orders.update(o.id, { imported: { system: 'eaglecart', jobId: 'e2e', jobNo: 'E2E-1', status: 'Delivered' } });
      return o.id;
    });
    await page.goto(BASE + '#/settings?tab=data');
    const reset = front('.list-row').filter({ hasText: /^Сброс$/ });
    await reset.waitFor();
    for (const word of ['Удалить все данные', 'Убрать перенесённое']) if ((await front('.list-row').filter({ hasText: word }).count()) + (await front('button').filter({ hasText: word }).count())) throw new Error(`«${word}» is in sight before «Сброс»`);
    await shot('28b-settings-data');
    await reset.click();
    await front('.list-row').filter({ hasText: 'Убрать перенесённое' }).waitFor();
    await shot('28c-settings-reset');
    await front('.list-row').filter({ hasText: 'Удалить все данные' }).click();
    const d = page.getByRole('dialog', { name: 'Удалить все данные' });
    const del = d.getByRole('button', { name: 'Удалить', exact: true });
    await del.waitFor();
    if (!(await del.isDisabled())) throw new Error('«Удалить» on before DELETE is typed');
    await d.getByPlaceholder('DELETE').fill('DELETE');
    if (await del.isDisabled()) throw new Error('«Удалить» stays off with DELETE typed');
    await closeModal();
    await d.waitFor({ state: 'hidden' });
    await front('.list-row').filter({ hasText: 'Удалить все данные' }).click();
    await del.waitFor();
    if (!(await del.isDisabled())) throw new Error('the sheet opened again with «Удалить» on');
    await closeModal();
    await d.waitFor({ state: 'hidden' });
    await page.evaluate(async (id) => (await import('/src/db/db.ts')).db.orders.update(id, { imported: undefined }), id);
  });
  await step('v0.22: the workshop’s own notes — «Ещё» → «Заметки», the same chat, no job', async () => {
    await page.goto(BASE + '#/more');
    await front('.list-row').filter({ hasText: /^Заметки/ }).first().click();
    await page.waitForFunction(() => location.hash === '#/notes');
    await page.getByLabel('Заметка').fill('Купить бумагу для принтера');
    await front('[aria-label="Добавить"]').click();
    await front('.note-bubble').filter({ hasText: 'Купить бумагу для принтера' }).waitFor();
    await shot('36-garage-notes');
    const kept = await page.evaluate(async () => (await (await import('/src/db/db.ts')).db.notes.where('orderId').equals('').toArray()).map((n) => n.text));
    if (JSON.stringify(kept) !== JSON.stringify(['Купить бумагу для принтера'])) throw new Error('workshop notes: ' + JSON.stringify(kept));
    // Its count on the row in «Ещё»; no job shows it.
    await page.goto(BASE + '#/more');
    await front('.list-row').filter({ hasText: /^Заметки1$/ }).waitFor();
    const onJobs = await page.evaluate(async () => (await (await import('/src/db/db.ts')).db.notes.toArray()).filter((n) => n.orderId && n.text === 'Купить бумагу для принтера').length);
    if (onJobs) throw new Error('the workshop note went to a job');
  });
  await step('v0.22: «Вид» — the board compact, its tabs dragged into another order, a step left out, kept on the device', async () => {
    await page.goto(BASE + '#/');
    await front('.job-card').first().waitFor();
    // The strip's tabs by name (their counts come in as the board and the debtors are read).
    const strip = async () => (await front('.scroll-tabs > button').allInnerTexts()).map((x) => x.replace(/\s*\d+$/, '').trim());
    const before = await strip();
    // The first step on the strip (it has cars): left out below.
    const step1 = before[1];
    // A long press on a tab opens «Вид».
    await front('.scroll-tabs > button').first().evaluate(async (el) => {
      const r = el.getBoundingClientRect();
      const touch = () => new Touch({ identifier: 7, target: el, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch()], changedTouches: [touch()], bubbles: true, cancelable: true }));
      await new Promise((ok) => setTimeout(ok, 600));
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch()], bubbles: true, cancelable: true }));
    });
    const v = page.getByRole('dialog', { name: 'Вид' });
    await v.waitFor();
    await closeModal();
    await v.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Вид' }).click();
    await v.waitFor();
    await v.locator('.mantine-SegmentedControl-label', { hasText: 'Компактно' }).click();
    await v.getByRole('radio', { name: 'Компактно', checked: true }).waitFor({ state: 'attached' });
    await v.locator('.list-row').filter({ hasText: step1 }).locator('.mantine-Switch-track').click();
    await v.locator('.list-row').filter({ hasText: step1 }).getByRole('switch', { checked: false }).waitFor({ state: 'attached' });
    // «Архив» moved up to right after «Все» by its grip (its keys; the finger's drag of a grip — motion §16).
    for (let i = 0; i < 8; i++) {
      await v.locator('[data-sort-id="archive"]').press('ArrowUp');
      await page.waitForTimeout(80);
    }
    await shot('02d-board-view');
    await closeModal();
    await v.waitFor({ state: 'hidden' });
    const check = async (when) => {
      const now = await strip();
      if (now[1] !== 'Архив' || now.includes(step1)) throw new Error(`${when}: the strip is ${JSON.stringify(now)}`);
      await front('.job-mini').first().waitFor();
      if (await front('.job-card').count()) throw new Error(`${when}: large cards on a compact board`);
    };
    await check('after «Вид»');
    await shot('02e-board-compact');
    await page.reload();
    await front('.job-mini').first().waitFor();
    await check('after a reload');
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('mygarage.board') ?? '{}'));
    if (kept.size !== 'compact' || kept.order?.[1] !== 'archive' || kept.hidden?.length !== 1) throw new Error('kept on the device: ' + JSON.stringify(kept));
    // Back as it was, for the steps after this one.
    await page.evaluate(() => localStorage.removeItem('mygarage.board'));
    await page.reload();
    await front('.job-card').first().waitFor();
    const after = await strip();
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`the strip did not come back: ${JSON.stringify(after)}, before ${JSON.stringify(before)}`);
  });
  await step('v0.23: any money operation is deleted («Отменить» brings it back) or changed — its day, sum and way; a debt deleted; paid on an earlier day', async () => {
    const dlg = page.getByRole('dialog');
    const cashNow = () => page.evaluate(async () => (await (await import('/src/services/money.ts')).cashState()).expected);
    const undo = () => page.locator('.mantine-Notification-root').filter({ hasText: 'Отменить' }).last().getByText('Отменить').click();
    // The undo banner stays while the pointer is on it (Mantine stops its 5 s): checks between a deletion and «Отменить» may take longer.
    const keep = () => page.locator('.mantine-Notification-root').filter({ hasText: 'Отменить' }).last().hover({ timeout: 5000 }).catch(() => undefined);
    // A day of this month up to today, in the calendar a day pill opens (yesterday; the 1st stays the 1st).
    const today = await page.evaluate(async () => (await import('/src/domain/dates.ts')).dubaiDate());
    const day = Math.max(1, Number(today.slice(8)) - 1);
    const dayIso = `${today.slice(0, 8)}${String(day).padStart(2, '0')}`;
    const dayShown = `${dayIso.slice(8)}/${dayIso.slice(5, 7)}/${dayIso.slice(0, 4)}`;
    const pickDay = async (scope) => {
      await scope.locator('button.day-pill-input').click();
      await page.locator('button.mantine-DatePickerInput-day:not([data-outside])').filter({ hasText: new RegExp(`^${day}$`) }).first().click();
    };
    // An open cash box for this step: the day an earlier step closed is deleted — a closing is an operation too (an
    // operation typed for a counted day goes into that day's closing, not into the open cash box). The book and the
    // cash box still agree.
    const agree = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const { removeEntry } = await import('/src/services/entries.ts');
      const { loadLedger } = await import('/src/services/ledger.ts');
      const { cashState } = await import('/src/services/money.ts');
      for (const c of await db.cashClosings.toArray()) await removeEntry({ source: 'closing', id: c.id });
      return [(await loadLedger()).cash, (await cashState()).expected, await db.cashClosings.count()];
    });
    if (agree[0] !== agree[1] || agree[2] !== 0) throw new Error('the closings deleted: book, cash box, closings ' + JSON.stringify(agree));
    // The user's case (16/11): a recovery of 180 typed in cash and cancelled before v0.23 — a pair in the cash box.
    await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const { addExpense } = await import('/src/services/money.ts');
      const { voidExpense } = await import('/src/services/legacyVoid.ts');
      const parts = (await db.expenseCategories.where('code').equals('parts').first()).id;
      const e = await addExpense({ date: '2026-11-07', categoryId: parts, amountFils: 18000, vatFils: 0, method: 'cash', note: 'E2E RECOVERY' });
      await voidExpense(e.id);
      await addExpense({ date: '2026-11-11', categoryId: parts, amountFils: 18000, vatFils: 0, vendor: 'E2E AHMAD', method: 'cash', note: 'E2E RECOVERY' });
    });
    let before = await cashNow();
    await page.goto(BASE + '#/money?tab=cash');
    const pair = front('.list-row').filter({ hasText: 'E2E RECOVERY' }).filter({ hasNotText: 'AHMAD' });
    await pair.nth(1).waitFor();
    if ((await pair.count()) !== 2) throw new Error('the cancelled pair: ' + (await pair.count()) + ' rows');
    // Its reversal opened: no sum or day to change — only «Удалить»; both rows go, the cash stays.
    await pair.filter({ hasText: 'Корректировка' }).click();
    await dlg.getByRole('button', { name: 'Удалить' }).waitFor();
    if (await dlg.getByLabel('Изменить сумму').count()) throw new Error('a cancelled pair offers a new sum');
    if (await dlg.locator('button.day-pill-input').count()) throw new Error('a cancelled pair offers a new day');
    await shot('23a-cancelled-pair');
    await dlg.getByRole('button', { name: 'Удалить' }).click();
    await dlg.waitFor({ state: 'detached' });
    await keep();
    await pair.first().waitFor({ state: 'detached' });
    if ((await cashNow()) !== before) throw new Error('the cancelled pair deleted moved the cash');
    await undo();
    await pair.nth(1).waitFor();
    await pair.filter({ hasText: 'Корректировка' }).click();
    await dlg.getByRole('button', { name: 'Удалить' }).click();
    await dlg.waitFor({ state: 'detached' });
    await pair.first().waitFor({ state: 'detached' });
    // The cash expense was really on credit: its way changed in its sheet — the row leaves the cash box, the cash is back.
    await front('.list-row').filter({ hasText: 'E2E AHMAD' }).first().click();
    await dlg.locator('button.day-pill-input').waitFor();
    await shot('23b-operation');
    await dlg.getByRole('radio', { name: 'В кредит' }).click();
    await dlg.waitFor({ state: 'detached' });
    if ((await cashNow()) - before !== 18000) throw new Error('cash → credit: the cash moved by ' + ((await cashNow()) - before));
    await front('.list-row').filter({ hasText: 'E2E AHMAD' }).first().waitFor({ state: 'detached' });
    // 10 of it paid in cash on an earlier day; the payment opened — its sum made 20; the debt deleted, and back.
    before = await cashNow();
    // v0.30: what the garage owes is its own tab of the debts.
    await page.goto(BASE + '#/money?tab=debts&side=owe');
    await front('.list-row').filter({ hasText: 'E2E AHMAD' }).first().click();
    await dlg.getByLabel('Сумма').fill('10');
    await pickDay(dlg);
    await dlg.locator('button.day-pill-input').filter({ hasText: day === Number(today.slice(8)) ? 'Сегодня' : /Вчера|\d\d\/\d\d/ }).waitFor();
    await dlg.getByRole('button', { name: /^Оплатить/ }).click();
    await dlg.locator('[data-credit-left="17000"]').waitFor();
    const paid = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      return (await db.creditPayments.toArray()).map((c) => c.date);
    });
    if (!paid.includes(dayIso)) throw new Error('the credit paid on ' + dayIso + ': ' + JSON.stringify(paid));
    if (before - (await cashNow()) !== 1000) throw new Error('10 paid: the cash moved by ' + (before - (await cashNow())));
    await dlg.locator('.list-row').filter({ hasText: dayShown }).first().click();
    const op = page.getByRole('dialog').filter({ hasText: 'Оплата кредита' });
    await op.getByLabel('Изменить сумму').click();
    await op.getByLabel('Изменить сумму').fill('20');
    await op.getByRole('button', { name: 'Сохранить' }).click();
    await dlg.locator('[data-credit-left="16000"]').waitFor();
    await shot('23c-credit-payment');
    await page.locator('.mantine-Modal-close').last().click();
    await op.waitFor({ state: 'detached' });
    before = await cashNow();
    await dlg.getByRole('button', { name: 'Удалить долг' }).click();
    await dlg.waitFor({ state: 'detached' });
    await keep();
    if ((await cashNow()) - before !== 2000) throw new Error('the debt deleted: the cash moved by ' + ((await cashNow()) - before));
    await front('.list-row').filter({ hasText: 'E2E AHMAD' }).first().waitFor({ state: 'detached' });
    await undo();
    await front('.list-row').filter({ hasText: 'E2E AHMAD' }).first().waitFor();
    if ((await cashNow()) !== before) throw new Error('the debt back: the cash is not as it was');
    // A job paid on an earlier day; then its payment — a new sum, deleted, back.
    const jobId = await page.evaluate(async () => {
      const { checkIn } = await import('/src/services/orders.ts');
      const { addItem } = await import('/src/services/estimate.ts');
      const { approveAll } = await import('/src/services/flow.ts');
      const { quickInvoice } = await import('/src/services/money.ts');
      const o = await checkIn({ plate: { emirate: 'DXB', code: 'P', number: '23230' }, make: 'Nissan', model: 'Patrol', name: 'Pay Day', phone: '050 111 2323', docLanguage: 'en', complaint: '', arrivedNow: true });
      await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Repair', unitPriceFils: 30000, vatRateBp: 0 });
      await approveAll(o.id);
      await quickInvoice(o.id);
      return o.id;
    });
    const jobDue = () => page.evaluate(async (id) => { const m = await import('/src/services/orders.ts'); return m.bundleAmountDue(await m.loadOrderBundle(id)); }, jobId);
    await page.goto(BASE + '#/orders/' + jobId);
    await front('button').filter({ hasText: /^Оплата/ }).first().click();
    await pickDay(dlg);
    await shot('23d-pay-job');
    await dlg.getByRole('button', { name: /^Провести/ }).click();
    await dlg.waitFor({ state: 'detached' });
    const at = await page.evaluate(async (id) => {
      const { db } = await import('/src/db/db.ts');
      const { dubaiDate } = await import('/src/domain/dates.ts');
      return (await db.payments.where('orderId').equals(id).toArray()).map((p) => dubaiDate(p.receivedAt));
    }, jobId);
    if (at.join() !== dayIso) throw new Error('the job paid on ' + dayIso + ': ' + at.join());
    await page.goto(BASE + '#/money?tab=book&month=' + dayIso.slice(0, 7));
    await front('.list-row').filter({ hasText: 'Оплата заказа' }).filter({ hasText: 'Pay Day' }).first().click();
    await dlg.getByLabel('Изменить сумму').click();
    await dlg.getByLabel('Изменить сумму').fill('200');
    await dlg.getByLabel('Изменить сумму').press('Enter');
    await page.waitForFunction(async (id) => { const m = await import('/src/services/orders.ts'); return m.bundleAmountDue(await m.loadOrderBundle(id)) === 10000; }, jobId);
    await dlg.getByRole('button', { name: 'Удалить' }).click();
    await dlg.waitFor({ state: 'detached' });
    await keep();
    if ((await jobDue()) !== 30000) throw new Error('the payment deleted: the job owes ' + (await jobDue()));
    await undo();
    await page.waitForFunction(async (id) => { const m = await import('/src/services/orders.ts'); return m.bundleAmountDue(await m.loadOrderBundle(id)) === 10000; }, jobId);
  });
  await step('v0.24: a supplier added from the part — «Новый поставщик» on top, the car’s make on, the number off its business card, one already in the base offered; a hold on its chip — its card', async () => {
    const top = () => page.getByRole('dialog').last();
    const job = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      for (const i of await db.items.filter((x) => x.kind === 'part' && !x.customerSupplied && x.approvalState === 'draft').toArray()) {
        const o = await db.orders.get(i.orderId);
        const v = o && (await db.vehicles.get(o.vehicleId));
        if (o && v?.make && !['closed', 'cancelled', 'delivered'].includes(o.stage)) return { id: o.id, title: i.titleEn || i.titleRu, make: v.make };
      }
      return null;
    });
    if (!job) throw new Error('no job with a part to look for');
    await page.goto(BASE + '#/orders/' + job.id);
    await front('.list-row').filter({ hasText: job.title.toUpperCase() }).first().click();
    const line = page.getByRole('dialog').first();
    await line.getByText('Поставщик').first().waitFor();
    // v0.32: the search is the first chip.
    await line.locator('[aria-label="Поставщик"] button.chip-find').click();
    // On top of the list, not under it.
    const add = top().locator('.list-row').first();
    await add.filter({ hasText: 'Новый поставщик' }).waitFor();
    await add.click();
    await top().getByText('Визитка').first().waitFor();
    if (!(await top().locator('[aria-label="Марки"] button.chip[data-active="true"]').filter({ hasText: job.make }).count())) throw new Error('the car’s make is not on: ' + job.make);
    // The business card photographed: its number and name come by themselves.
    const card = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1400;
      c.height = 800;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#111';
      g.font = 'bold 92px Arial';
      g.fillText('DEIRA AUTO SPARES', 90, 220);
      g.font = '48px Arial';
      g.fillText('Mob: +971 56 909 1357', 90, 470);
      g.fillText('Tel: 04 222 3344', 90, 560);
      return c.toDataURL('image/png').split(',')[1];
    });
    await top().locator('input[data-photo-input="card"]').setInputFiles({ name: 'card.png', mimeType: 'image/png', buffer: Buffer.from(card, 'base64') });
    const phone = top().getByRole('textbox', { name: 'Телефон' });
    await phone.and(page.locator('input[value="+971 56 909 1357"]')).waitFor({ timeout: 90000 });
    if ((await top().getByRole('textbox', { name: 'Название' }).inputValue()) !== 'DEIRA AUTO SPARES') throw new Error('the card’s name was not read');
    await top().locator('[data-card-phones] button.chip').nth(1).waitFor();
    await shot('37a-supplier-card-read');
    // A number already in the base: that supplier is offered instead of a second one.
    await phone.fill('04 333 4455');
    await top().locator('button.suggest[data-twin]').filter({ hasText: 'Al Quoz' }).waitFor();
    await phone.fill('056 909 1357');
    await top().locator('button.suggest[data-twin]').waitFor({ state: 'detached' });
    await top().getByRole('button', { name: 'Сохранить' }).click();
    const chip = line.locator('[aria-label="Поставщик"] button.chip[data-active="true"]').filter({ hasText: 'DEIRA AUTO SPARES' });
    await chip.waitFor();
    const kept = await page.evaluate(async () => (await (await import('/src/db/db.ts')).db.suppliers.filter((s) => s.name === 'DEIRA AUTO SPARES').toArray()).map((s) => [s.phone, s.makes?.join(), s.cardMediaIds?.length]));
    if (JSON.stringify(kept) !== JSON.stringify([['+971569091357', job.make, 1]])) throw new Error('kept as ' + JSON.stringify(kept));
    // A hold on its chip (here a right click, as on a PC): its card — WhatsApp, Telegram, a call, the number as said.
    await chip.click({ button: 'right' });
    await top().locator('.contact-tiles').waitFor();
    if ((await top().getByRole('textbox', { name: 'Телефон' }).inputValue()) !== '+971 56 909 1357') throw new Error('the number is not shown as said');
    await shot('37b-supplier-held');
    // Escape closes the sheet on top only: the part’s sheet under it stays, with what was typed in it.
    await page.keyboard.press('Escape');
    await page.locator('.contact-tiles').waitFor({ state: 'detached' });
    await page.waitForTimeout(400);
    if ((await page.getByRole('dialog').count()) !== 1) throw new Error('Escape closed more than the card: ' + (await page.getByRole('dialog').count()) + ' sheets left');
    // The tap after the hold did not take the chip off.
    if (!(await chip.count())) throw new Error('the hold took the supplier off the part');
    await line.locator('.mantine-Modal-close').click();
    await line.waitFor({ state: 'detached' });
  });
  await step('a customer added after the invoice: on it and in its PDF', async () => {
    // The car came with no name, the invoice went out and its PDF was given; the customer is typed on the job
    // afterwards. The invoice itself never changes — what it left blank is the job's customer now.
    const job = await page.evaluate(async () => {
      const { checkIn } = await import('/src/services/orders.ts');
      const { addItem } = await import('/src/services/estimate.ts');
      const { quickInvoice } = await import('/src/services/money.ts');
      const { invoicePdf } = await import('/src/services/documents.ts');
      const o = await checkIn({ plate: { emirate: 'DXB', code: 'Z', number: '31862' }, make: 'Hyundai', model: 'Tucson', name: '', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
      await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'AC SERVICE', qty: 1, unitPriceFils: 15000 });
      const inv = await quickInvoice(o.id);
      await invoicePdf(inv.id);
      return { id: o.id, invoiceId: inv.id, number: inv.number };
    });
    await page.goto(BASE + '#/orders/' + job.id);
    const invRow = front('.list-row').filter({ hasText: job.number });
    await invRow.waitFor();
    await front('button').filter({ hasText: /^Клиент$/ }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('textbox', { name: /^Имя/ }).fill('Omar Haddad');
    await dlg.getByRole('textbox', { name: /^Телефон/ }).fill('050 777 1234');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await dlg.waitFor({ state: 'detached' });
    // On the invoice's row — whom it bills.
    await invRow.filter({ hasText: 'Omar Haddad' }).waitFor();
    await shot('32c-invoice-customer-after');
    const got = await page.evaluate(async (invoiceId) => {
      const { db } = await import('/src/db/db.ts');
      const { invoicePdf } = await import('/src/services/documents.ts');
      const { pdfTextItems } = await import('/src/services/pdfText.ts');
      const text = (await pdfTextItems((await invoicePdf(invoiceId)).blob)).map((i) => i.str).join(' ');
      return { buyer: (await db.invoices.get(invoiceId)).buyer.name, name: text.includes('Omar Haddad'), phone: text.includes('+971 50 777 1234') };
    }, job.invoiceId);
    if (got.buyer !== '' || !got.name || !got.phone) throw new Error('the customer added after the invoice: ' + JSON.stringify(got));
  });
  await step('v0.26: income categories — «Emil» picked; one of its own added from the chips and picked at once; a hold takes one out («Отменить» brings it back), its entry keeps its name', async () => {
    const top = () => page.getByRole('dialog').last();
    const sheet = page.getByRole('dialog').first();
    const addIn = () => front('button').filter({ hasText: /^Приход$/ }).first().click();
    await page.goto(BASE + '#/money?tab=book');
    // «Emil» — among the chips, picked for 120: its row in the book says «Emil».
    await addIn();
    await sheet.getByLabel('Сумма').fill('120');
    await sheet.locator('button.chip[data-income="emil"]').filter({ hasText: 'Emil' }).click();
    await sheet.locator('button.chip[data-income="emil"][data-active="true"]').waitFor();
    await shot('38a-income-emil');
    await sheet.getByRole('button', { name: /^Записать приход/ }).click();
    await sheet.waitFor({ state: 'detached' });
    await front('.list-row').filter({ hasText: 'Emil' }).filter({ hasText: '120,00' }).first().waitFor();
    // «＋»: a category of its own by its name — picked at once.
    await addIn();
    await sheet.getByLabel('Сумма').fill('15');
    await sheet.locator('button.chip[data-income-add]').click();
    await top().getByText('Новая категория').waitFor();
    await top().getByRole('textbox', { name: 'Название' }).fill('Чаевые');
    await top().getByRole('button', { name: 'Добавить' }).click();
    await sheet.locator('button.chip[data-active="true"]').filter({ hasText: 'Чаевые' }).waitFor();
    await page.getByRole('dialog').filter({ hasText: 'Новая категория' }).waitFor({ state: 'detached' });
    if ((await page.getByRole('dialog').count()) !== 1) throw new Error('the new category’s sheet took the income sheet with it');
    await shot('38b-income-own');
    await sheet.getByRole('button', { name: /^Записать приход/ }).click();
    await sheet.waitFor({ state: 'detached' });
    const row = front('.list-row').filter({ hasText: 'Чаевые' }).filter({ hasText: '15,00' }).first();
    await row.waitFor();
    // A hold on its chip (a right click, as on a PC): its name and «Удалить» — out of the chips; «Отменить» — back.
    await addIn();
    await sheet.locator('button.chip').filter({ hasText: 'Чаевые' }).click({ button: 'right' });
    await top().locator('input[value="Чаевые"]').waitFor();
    // The sheet slides up (a CSS transition that starts a moment after it is put in): the picture once it is up.
    await page.waitForTimeout(500);
    await shot('38c-income-held');
    await top().getByRole('button', { name: 'Удалить' }).click();
    await page.getByText('Категория убрана: Чаевые').waitFor();
    await sheet.locator('button.chip').filter({ hasText: 'Чаевые' }).waitFor({ state: 'detached' });
    if (!(await sheet.locator('button.chip[data-active="true"]').count())) throw new Error('no category picked after the one picked was taken out');
    await page.getByRole('button', { name: 'Отменить' }).last().click();
    await sheet.locator('button.chip').filter({ hasText: 'Чаевые' }).waitFor();
    await closeModal();
    await sheet.waitFor({ state: 'detached' });
    // Taken out again: its entry keeps its name, in the book and in its sheet (picked there, though no longer offered).
    await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const { removeIncomeCategory } = await import('/src/services/incomeCategories.ts');
      await removeIncomeCategory((await db.incomeCategories.filter((c) => c.nameRu === 'Чаевые').first()).id);
    });
    await row.click();
    await sheet.locator('button.chip[data-active="true"]').filter({ hasText: 'Чаевые' }).waitFor();
    await shot('38d-income-entry-removed-category');
    await closeModal();
    await sheet.waitFor({ state: 'detached' });
    await row.waitFor();
    // Settings → Categories: money in above the expenses, the one taken out greyed («не работает»).
    await page.goto(BASE + '#/settings?tab=categories');
    await front('.list-row').filter({ hasText: 'Emil' }).waitFor();
    await front('.list-row').filter({ hasText: 'Чаевые' }).filter({ hasText: 'не работает' }).waitFor();
    await shot('38e-settings-income-categories', true);
  });
  await step('v0.27: money past the cash box — an expense «Не из кассы» (the owner’s own), money in «Владельцу»: the cash stays, a line of its own', async () => {
    const sheet = page.getByRole('dialog').first();
    const cashNow = () => page.evaluate(async () => (await (await import('/src/services/money.ts')).cashState()).expected);
    await page.goto(BASE + '#/money?tab=book');
    const before = await cashNow();
    // The expense: paid with other money — not a debt, not the cash box.
    await front('button').filter({ hasText: /^Расход$/ }).first().click();
    await sheet.getByLabel('Сумма').fill('70');
    await sheet.getByRole('radio', { name: 'Не из кассы' }).click();
    await sheet.locator('button.chip[data-way="outside"][data-active="true"]').waitFor();
    await shot('39a-expense-outside');
    await sheet.getByRole('button', { name: /^Записать расход/ }).click();
    await sheet.waitFor({ state: 'detached' });
    // Money in the owner took himself.
    await front('button').filter({ hasText: /^Приход$/ }).first().click();
    await sheet.getByLabel('Сумма').fill('50');
    await sheet.getByRole('radio', { name: 'Владельцу' }).click();
    await sheet.getByRole('button', { name: /^Записать приход/ }).click();
    await sheet.waitFor({ state: 'detached' });
    if ((await cashNow()) !== before) throw new Error('money past the cash box moved the cash by ' + ((await cashNow()) - before));
    // In the book: lines of their own, the month's row of them on the card, a filter.
    await front('.list-row').filter({ hasText: 'Не из кассы' }).filter({ hasText: '70,00' }).first().waitFor();
    await front('.list-row').filter({ hasText: 'Владельцу' }).filter({ hasText: '50,00' }).first().waitFor();
    const row = front('.money-card [data-month-purse="outside"]');
    await row.waitFor();
    if ((await row.getAttribute('data-in')) !== '5000' || (await row.getAttribute('data-out')) !== '7000') throw new Error('the month past the cash box: ' + (await row.getAttribute('data-in')) + ' / ' + (await row.getAttribute('data-out')));
    await front('button.chip[data-purse="outside"]').click();
    await front('.list-row').filter({ hasText: 'Наличные' }).first().waitFor({ state: 'detached' });
    await shot('39b-book-outside');
    await front('button.chip[data-purse="outside"]').click();
    // Not a company debt.
    const owed = await page.evaluate(async () => (await (await import('/src/services/debts.ts')).loadCompanyDebts()).filter((d) => d.expense.amountFils === 7000).length);
    if (owed) throw new Error('an expense paid with other money became a debt');
  });
  await step('v0.28: «＋» held or swiped up — quick actions; «Фото номера» — the plate read off the photo into «Новый заказ», the photo the car’s', async () => {
    await page.goto(BASE + '#/');
    const plusBox = await page.locator('.tab-plus').boundingBox();
    if (!plusBox) throw new Error('no «＋»');
    const cx = plusBox.x + plusBox.width / 2;
    const cy = plusBox.y + plusBox.height / 2;
    // Held: the actions come up over it; the finger slides onto «Приход» and lets go — the income sheet.
    await page.waitForTimeout(400);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(450);
    await page.locator('.quick-menu').waitFor();
    await page.waitForTimeout(450);
    const inBox = await page.locator('[data-quick="in"]').boundingBox();
    await page.mouse.move(inBox.x + inBox.width / 2, inBox.y + inBox.height / 2, { steps: 8 });
    await page.locator('[data-quick="in"][data-hover]').waitFor();
    await shot('40a-quick-actions');
    await page.mouse.up();
    await page.getByRole('dialog').getByRole('button', { name: /^Записать приход/ }).waitFor();
    if (await page.locator('.quick-menu').count()) throw new Error('the actions stayed up');
    await closeModal();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    // A tap is a new job, as it was.
    await page.waitForTimeout(500);
    await page.mouse.click(cx, cy);
    await page.waitForURL(/orders\/new$/);
    await page.goBack();
    await page.waitForURL((u) => !/orders\/new/.test(u.href));
    await page.waitForTimeout(600);
    // A swipe up onto «Фото номера»: the camera inside the app (v0.31 — the phone's own opens only for a tap, not where a
    // slide lets go); a car with a Dubai plate, B 70415, before it — the test's camera is a canvas.
    const photo = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 2016;
      c.height = 1512;
      const g = c.getContext('2d');
      const bg = g.createLinearGradient(0, 0, 0, c.height);
      bg.addColorStop(0, '#9aa4ad');
      bg.addColorStop(1, '#5d5a55');
      g.fillStyle = bg;
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#26303b';
      g.beginPath();
      g.roundRect(240, 270, 1530, 940, 120);
      g.fill();
      g.fillStyle = '#c0c0c0';
      g.font = 'bold 40px Arial';
      g.fillText('NISSAN', 920, 760);
      const pw = 560;
      const ph = pw / 4.7;
      g.translate(1008, 1000);
      g.fillStyle = '#f7f7f2';
      g.strokeStyle = '#111';
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(-pw / 2, -ph / 2, pw, ph, 12);
      g.fill();
      g.stroke();
      const big = ph * 0.62;
      g.fillStyle = '#111';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold ${big * 0.3}px Arial`;
      g.fillText('DUBAI', -pw / 2 + pw * 0.1, -ph * 0.12);
      g.font = `bold ${big}px Arial`;
      g.fillText('B', -pw / 2 + pw * 0.3, ph * 0.04);
      g.fillText('70415', pw * 0.16, ph * 0.04);
      // The camera films it (redrawn a little each time: a canvas gives frames as it changes).
      const live = document.createElement('canvas');
      live.width = c.width;
      live.height = c.height;
      const lg = live.getContext('2d');
      let n = 0;
      const paint = () => {
        lg.drawImage(c, 0, 0);
        lg.fillStyle = n++ % 2 ? '#5d5a55' : '#5e5a55';
        lg.fillRect(0, live.height - 2, 2, 2);
      };
      paint();
      const timer = setInterval(paint, 80);
      const stream = live.captureStream(15);
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const taken = [];
      window.__e2eCamera = { taken, done: () => (clearInterval(timer), (navigator.mediaDevices.getUserMedia = real)) };
      navigator.mediaDevices.getUserMedia = async () => {
        const k = stream.clone();
        taken.push(k);
        return k;
      };
      return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    });
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 30, { steps: 3 });
    await page.locator('.quick-menu').waitFor();
    const ph = await page.locator('[data-quick="photo"]').boundingBox();
    await page.mouse.move(ph.x + ph.width / 2, ph.y + ph.height / 2, { steps: 5 });
    await page.mouse.up();
    // Let go: the camera is up at once, live; it reads the plate off its frames while aimed (v0.33) — the pill shows it,
    // green when two frames agree; one tap on the shutter — the photo goes on with the plate.
    await page.locator('.cam[data-phase="live"]').waitFor({ timeout: 8000 });
    await page.locator('.plate-scan[data-state="stable"]').waitFor({ timeout: 30000 });
    const pill = await page.locator('.plate-scan-pill').getAttribute('aria-label');
    if (!/B 70415/.test(pill || '')) throw new Error('the camera read ' + pill);
    await shot('40b-camera');
    await page.getByRole('button', { name: 'Снять фото' }).click();
    await page.waitForURL(/orders\/new\?photo=/);
    if (await page.locator('.cam').count()) throw new Error('the camera stayed up');
    if (await page.evaluate(() => window.__e2eCamera.taken.some((t) => t.getTracks().some((x) => x.readyState === 'live')))) throw new Error('the camera was not let go');
    await page.locator('.car-shot').waitFor();
    await page.locator('.car-shot-badge[data-state="read"]').waitFor({ timeout: 90000 });
    await page.locator('.car-shot-box').waitFor();
    const read = [await page.getByRole('textbox', { name: 'Код', exact: true }).inputValue(), await page.getByRole('textbox', { name: 'Номер', exact: true }).inputValue()];
    if (read.join(' ') !== 'B 70415') throw new Error('the plate read as ' + read.join(' '));
    if (!(await page.locator('[role="radio"][aria-checked="true"]').filter({ hasText: 'Дубай' }).count())) throw new Error('the emirate is not Dubai');
    // No keyboard over the photo: the number is not focused.
    if (await page.evaluate(() => document.activeElement?.tagName === 'INPUT')) throw new Error('a field took the focus over the photo');
    await shot('40c-plate-read');
    await page.getByRole('button', { name: 'Принять' }).click();
    await page.waitForURL(/#\/orders\/(?!new)/);
    const kept = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const o = await db.orders.get(location.hash.split('/')[2]);
      const v = await db.vehicles.get(o.vehicleId);
      return { plate: `${v.plate.emirate} ${v.plate.code} ${v.plate.number}`, covers: (await db.media.where('ownerId').equals(o.vehicleId).toArray()).filter((m) => m.slot === 'cover').length };
    });
    if (kept.plate !== 'DXB B 70415' || kept.covers !== 1) throw new Error('the job: ' + JSON.stringify(kept));
    // The camera: Back closes it, the board stays; «Фото из телефона» — a photo from the phone goes on the same way, and
    // Back from "New job" is the board (the camera left no step of its own in the history).
    await page.goto(BASE + '#/');
    await page.waitForTimeout(500);
    await page.mouse.click(cx, cy, { button: 'right' });
    await page.locator('[data-quick="photo"]').click();
    await page.locator('.cam[data-phase="live"]').waitFor({ timeout: 8000 });
    await page.goBack();
    await page.locator('.cam').waitFor({ state: 'detached' });
    if (!/#\/$/.test(page.url())) throw new Error('Back from the camera went to ' + page.url());
    await page.waitForTimeout(400);
    await page.mouse.click(cx, cy, { button: 'right' });
    await page.locator('[data-quick="photo"]').click();
    await page.locator('.cam').waitFor();
    const [fromPhone] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Фото из телефона' }).click()]);
    await fromPhone.setFiles({ name: 'car.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo, 'base64') });
    await page.waitForURL(/orders\/new\?photo=/);
    await page.locator('.car-shot').waitFor();
    await page.goBack();
    await page.waitForURL((u) => /#\/$/.test(u.href));
    await page.waitForTimeout(300);
    if (await page.evaluate(() => !!history.state?.mgCamera)) throw new Error('the camera left its step in the history');
    await page.evaluate(() => window.__e2eCamera.done());
    // A right click (a long press on Android): the actions stay for a tap.
    await page.goto(BASE + '#/');
    await page.waitForTimeout(500);
    await page.mouse.click(cx, cy, { button: 'right' });
    await page.locator('.quick-layer[data-mode="sticky"]').waitFor();
    await page.locator('[data-quick="note"]').click();
    await page.waitForURL(/#\/notes/);
  });
  await step('v0.29: a part’s photo beside its name; parts picked set at once (supplier, state); the job’s picture for the owner', async () => {
    const job = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      for (const o of await db.orders.toArray()) {
        if (['closed', 'cancelled', 'delivered', 'ready'].includes(o.stage)) continue;
        if (await db.invoices.where('orderId').equals(o.id).count()) continue;
        const items = await db.items.where('orderId').equals(o.id).toArray();
        if (items.filter((i) => i.kind === 'part' && !i.customerSupplied && ['draft', 'pending', 'approved'].includes(i.approvalState)).length >= 2) return o.id;
      }
      return null;
    });
    if (!job) throw new Error('no open job with two parts');
    await page.goto(BASE + '#/orders/' + job);
    await front('.part-thumb').first().waitFor();
    // An empty thumb: a tap — the camera; the photo goes on the line (its sheet does not open).
    const thumb = front('.part-thumb[data-empty]').first();
    await thumb.scrollIntoViewIfNeeded();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), thumb.click()]);
    await chooser.setFiles(FIXTURE);
    await front('.part-thumb:not([data-empty]) img').first().waitFor();
    await page.waitForTimeout(300);
    if (await page.getByRole('dialog').count()) throw new Error('the thumb opened the line’s sheet');
    await front('.part-thumb:not([data-empty])').first().click();
    await page.locator('.viewer').waitFor();
    await shot('41a-part-photo');
    await page.keyboard.press('Escape');
    await page.locator('.viewer').waitFor({ state: 'detached' });
    // Two parts picked (a hold — a right click on a PC), one supplier and «Заказано» for both.
    const names = (await front('.list-row:has(.part-thumb) .title').allInnerTexts()).map((x) => x.trim().split('\n')[0]);
    await page.waitForTimeout(400);
    await front('.list-row').filter({ hasText: names[0] }).first().locator('.body').click({ button: 'right' });
    await page.waitForTimeout(400);
    await front('.list-row').filter({ hasText: names[1] }).first().locator('.body').click();
    await page.getByRole('button', { name: 'Поставщик и наличие' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByText('Запчасти · 2').waitFor();
    await dlg.locator('[aria-label="Поставщик"] button.chip-supplier').first().click();
    await dlg.getByRole('radio', { name: 'Заказано' }).click();
    await shot('41b-parts-batch');
    await dlg.getByRole('button', { name: /^Применить · 2/ }).click();
    await dlg.waitFor({ state: 'detached' });
    const set = await page.evaluate(async (id) => {
      const { db } = await import('/src/db/db.ts');
      const parts = (await db.items.where('orderId').equals(id).toArray()).filter((i) => i.kind === 'part' && !i.customerSupplied && i.supplierId && i.procurementStatus === 'ordered');
      return parts.length;
    }, job);
    if (set < 2) throw new Error('parts set at once: ' + set);
    // «…» → «Владельцу»: the picture, then «Отправить» (a download on a PC).
    await page.waitForTimeout(400);
    await front('[aria-label="Ещё"]').first().click();
    await page.getByRole('dialog').getByText('Владельцу').click();
    await page.locator('img[data-owner-check]').waitFor({ timeout: 15000 });
    const size = await page.locator('img[data-owner-check]').evaluate((img) => [img.naturalWidth, img.naturalHeight]);
    if (size[0] !== 1080 || size[1] < 900) throw new Error('the picture is ' + size.join('×'));
    await shot('41c-owner-check');
    // The phone's share sheet (a PC's too, in Chrome): what it is handed is the picture.
    await page.evaluate(() => {
      window.__shared = null;
      navigator.canShare = () => true;
      navigator.share = async (d) => void (window.__shared = d.files.map((f) => [f.name, f.type]));
    });
    await page.getByRole('button', { name: 'Отправить' }).click();
    const shared = await page.waitForFunction(() => window.__shared).then((h) => h.jsonValue());
    if (shared.length !== 1 || shared[0][1] !== 'image/jpeg' || !/\.jpg$/.test(shared[0][0])) throw new Error('shared ' + JSON.stringify(shared));
    await closeModal();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  });
  await step('v0.30: the board — what each job is, its paper, a swipe right to WhatsApp, «Сегодня» in a bell; tabs by a swipe; debts as two tabs, folded customers, one statement, the invoices zip', async () => {
    // A finger's swipe from (x0, y0) by dx (touch events on whatever is under it, as on a phone).
    const fingerSwipe = (x0, y0, dx, steps = 12) =>
      page.evaluate(
        async ({ x0, y0, dx, steps }) => {
          const el = document.elementFromPoint(x0, y0);
          const touch = (x) => new Touch({ identifier: 7, target: el, clientX: x, clientY: y0 });
          const fire = (type, x, list = true) => el.dispatchEvent(new TouchEvent(type, { touches: list ? [touch(x)] : [], changedTouches: [touch(x)], bubbles: true, cancelable: true }));
          fire('touchstart', x0);
          for (let i = 1; i <= steps; i++) {
            fire('touchmove', x0 + (dx * i) / steps);
            await new Promise((r) => setTimeout(r, 14));
          }
          fire('touchend', x0 + dx, false);
        },
        { x0, y0, dx, steps },
      );
    await page.goto(BASE + '#/');
    // A card says what the job is about, and has its paper (quote or invoice) a tap away.
    await front('.job-card-what').first().waitFor();
    await front('.job-card-doc').first().waitFor();
    if (await front('.today-strip').count()) throw new Error('«Сегодня» is still a strip');
    // «Сегодня» — a bell with how many; a tap — the list.
    await front('.today-bell').click();
    await page.locator('.today-note').first().waitFor();
    await shot('42a-today-bell');
    await closeModal();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    // A card swiped right: the customer's WhatsApp.
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (u) => void window.__opened.push(String(u));
    });
    const card = await front('.job-card').first().boundingBox();
    await fingerSwipe(card.x + 30, card.y + card.height / 2, card.width - 50);
    await page.waitForFunction(() => window.__opened.some((u) => u.startsWith('https://wa.me/')));
    await shot('42b-board-cards');
    // A sideways swipe on the board (not on a card): Search; on Search — Money. (A swipe begun while the screen still
    // slides in is the stack's, not a new one: it is tried again once the screen has settled.)
    const swipeTo = async (x, y, dx, url) => {
      for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(600);
        await fingerSwipe(x, y, dx);
        if (await page.waitForURL(url, { timeout: 3000 }).then(() => true, () => false)) return;
      }
      throw new Error('a sideways swipe did not go to ' + url);
    };
    await swipeTo(330, 70, -260, /#\/search$/);
    await swipeTo(330, 260, -260, /#\/money/);
    // Money → Debts: the two sums are tabs; the list under them turns by a swipe (and stays in Debts).
    await page.goto(BASE + '#/money?tab=debts');
    await front('.kpi-tab[data-side="owed"][data-active]').waitFor();
    await page.waitForTimeout(400);
    await fingerSwipe(330, 600, -260);
    await front('.kpi-tab[data-side="owe"][data-active]').waitFor();
    if (!/tab=debts/.test(page.url())) throw new Error('the swipe left Debts: ' + page.url());
    await front('.kpi-tab[data-side="owed"]').click();
    // A customer is folded: a tap unfolds the jobs and the papers.
    const debtor = front('.debt-card').first();
    await debtor.waitFor();
    if ((await debtor.locator('.debt-actions').evaluate((el) => el.parentElement.getBoundingClientRect().height)) > 1) throw new Error('a customer is not folded');
    await debtor.locator('.list-row').first().click();
    await front('.debt-card.is-open .debt-actions').waitFor();
    await shot('42c-debtor-open');
    // One sheet for all of it, and every invoice in a zip.
    const papers = await page.evaluate(async () => {
      const { loadDebtors } = await import('/src/services/debts.ts');
      const { statementPdf, debtInvoicesZip } = await import('/src/services/debtDocs.ts');
      const d = (await loadDebtors())[0];
      const s = await statementPdf(d.customer.id);
      const z = await debtInvoicesZip(d.customer.id).catch((e) => String(e.message || e));
      return { pdf: [s.filename, s.blob.type, s.blob.size], zip: typeof z === 'string' ? z : [z.name, z.type, z.size] };
    });
    if (!/^Statement - .+\.pdf$/.test(papers.pdf[0]) || papers.pdf[2] < 2000) throw new Error('statement: ' + JSON.stringify(papers.pdf));
    if (typeof papers.zip === 'string' || !/\.zip$/.test(papers.zip[0]) || papers.zip[2] < 2000) throw new Error('zip: ' + JSON.stringify(papers.zip));
  });
  await step('v0.32: a video note as in a messenger — its first frame, ▶ and how long; a tap plays it on the whole screen, Back closes it; the cash card in named tiles', async () => {
    // A short video (a second of a moving square), made by the browser itself.
    const video = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 240;
      c.height = 320;
      const g = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
      const parts = [];
      rec.ondataavailable = (e) => parts.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start();
      for (let i = 0; i < 20; i++) {
        g.fillStyle = '#204060';
        g.fillRect(0, 0, 240, 320);
        g.fillStyle = '#f0c040';
        g.fillRect(20 + i * 8, 120, 60, 60);
        await new Promise((r) => setTimeout(r, 60));
      }
      rec.stop();
      await done;
      const b = new Blob(parts, { type: 'video/webm' });
      return btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())));
    });
    const job = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const o = (await db.orders.toArray()).find((x) => !['closed', 'cancelled', 'delivered'].includes(x.stage));
      return o?.id;
    });
    await page.goto(BASE + '#/orders/' + job + '?tab=notes');
    await front('.notes-field').waitFor();
    await front('input[data-note-media]').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(video, 'base64') });
    const bubble = front('.note-video').last();
    await bubble.waitFor({ timeout: 20000 });
    await bubble.locator('.note-video-play').waitFor();
    await shot('43a-video-note');
    await bubble.click();
    const player = page.locator('.vp');
    await player.waitFor();
    // It plays at once: the place moves on.
    await page.waitForFunction(() => (document.querySelector('.vp-video')?.currentTime ?? 0) > 0.2, null, { timeout: 8000 });
    await shot('43b-video-player');
    // The line dragged to its middle: the place follows.
    const bar = await page.locator('.vp-bar').boundingBox();
    await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.waitForFunction(() => {
      const v = document.querySelector('.vp-video');
      return v && v.duration && Math.abs(v.currentTime / v.duration - 0.5) < 0.25;
    }, null, { timeout: 5000 }).catch(() => undefined);
    await page.goBack();
    await player.waitFor({ state: 'detached' });
    if (!/tab=notes/.test(page.url())) throw new Error('Back from the player left the notes: ' + page.url());
    // The cash card: the month in tiles, each named.
    await page.goto(BASE + '#/money');
    const tiles = front('.money-card .money-card-purse');
    await tiles.first().waitFor();
    if (!(await tiles.first().locator('.money-card-purse-name').innerText()).trim()) throw new Error('a purse tile without its name');
    await front('.money-card-start').waitFor();
    await shot('43c-cash-card');
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
  await step('v0.13.3: a backup brings every photo back', async () => {
    // The whole garage to a file, then back through "Accept the file" (as from another device): every photo
    // and PDF comes back readable, and a banner says what came back.
    await page.evaluate(async () => (await import('/src/i18n/index.ts')).setLang('ru'));
    const saved = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const { exportBackup } = await import('/src/services/backup.ts');
      const file = await exportBackup();
      const buf = new Uint8Array(await file.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { files: await db.mediaBlobs.count(), data: btoa(s) };
    });
    if (!saved.files) throw new Error('no photos to back up');
    await page.goto(BASE + '#/more');
    await page.getByText('На другое устройство').click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('dialog').getByRole('button', { name: 'Принять файл' }).click()]);
    await chooser.setFiles({ name: 'mygarage.mygarage', mimeType: 'application/octet-stream', buffer: Buffer.from(saved.data, 'base64') });
    await page.getByRole('dialog').last().getByText(`фото и файлов ${saved.files}`).waitFor();
    await shot('36-restore-confirm');
    await page.getByRole('dialog').last().getByRole('button', { name: /^Заменить/ }).click();
    await page.getByText('Данные восстановлены').first().waitFor({ timeout: 60000 });
    const back = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      let readable = 0;
      for (const r of await db.mediaBlobs.toArray()) if ((await r.blob.arrayBuffer()).byteLength === r.blob.size && r.blob.size > 0) readable++;
      return { files: await db.mediaBlobs.count(), readable };
    });
    if (back.files !== saved.files || back.readable !== saved.files) throw new Error('photos after the restore: ' + JSON.stringify({ saved: saved.files, ...back }));
    await shot('36b-restored');
  });
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => { console.error('E2E FAILED:', String((e && e.message) || e).split('\n')[0]); process.exit(1); });
