const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/*
 * v0.92, as the owner sees it (phone 390×844 with the iPhone's tap labels over the controls); the garage's server and the
 * AI are played in the page — every name, number and price is made up, nothing reaches WhatsApp:
 * - one «Добавить позицию» under a job's lines: «Авто» — each line's kind found as it is typed (a part, work, a service),
 *   the spelling put right by the dictionary at once;
 * - a status given by hand wins over the base's own (a customer's number made «Поставщик» on the chat's card);
 * - a contact's picture on the whole screen (the list's picture, the card's);
 * - «Отправить» held in «Поставщики» — «Отправить позже»: the request kept until its time («уйдёт в …»);
 * - «Запчасти → Цены»: every price a supplier said, with its car; «+ Цена» of another Camry's line — «Из прайса».
 * Screenshots — test-results/v092/.
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/v092.cjs (BASE_URL to aim elsewhere).
 */
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = path.join(__dirname, '..', 'test-results', 'v092');
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

/** A tiny picture (a WhatsApp profile photo), as the server would give it. */
const PIC = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#2a7"/><circle cx="320" cy="260" r="120" fill="#fff"/></svg>').toString('base64');

async function playServer(page) {
  await page.evaluate(async (pic) => {
    const { setWaTransport, refreshWa } = await import('/src/services/whatsapp.ts');
    const { setAiTransport } = await import('/src/services/ai.ts');
    const { SyncError } = await import('/src/services/sync/api.ts');
    const chat = (id, name, phone) => ({ id, name, group: false, phone, unread: 0, t: Date.now() - 60_000, archived: false, pinned: false, muted: false, self: false, last: { id: 'x' + phone, t: Date.now() - 60_000, me: false, type: 'chat', text: 'ok', ack: 0 } });
    const world = {
      out: [],
      chats: [chat('971501110001@c.us', 'Fast Toyota Parts', '971501110001'), chat('971501110004@c.us', 'Omar', '971501110004')],
    };
    window.__wa = world;
    setWaTransport(
      async (p, init) => {
        await new Promise((r) => setTimeout(r, 60));
        if (p === 'status') return { ok: true, available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '2.3000', error: '', chats: world.chats.length, unread: 0, later: true };
        if (p === 'chats') return { chats: world.chats, total: world.chats.length, unread: 0 };
        if (p === 'messages' || p === 'history') return { messages: [], more: false, end: 1 };
        if (p === 'history-state') return { more: 0, noAccess: 0, chats: 0, came: 0, asks: 0, phone: 'unknown', okAt: 0, passAt: 0, running: false, done: 0, total: 0 };
        if (p === 'number') return { ok: true, chat: `${init.query.phone}@c.us` };
        if (p === 'outbox' && init.method === 'POST') {
          for (const x of init.body.items) if (!world.out.some((o) => o.key === x.key)) world.out.push(x);
          return { ok: true, items: init.body.items.map((x) => ({ key: x.key, state: 'queued', at: Date.now(), after: x.after, title: x.title })) };
        }
        if (p === 'outbox') return { ok: true, items: [], queued: 0, failed: 0, sent: 0 };
        throw new SyncError(404, 'not found');
      },
      // A chat's picture (the element and the full screen load it from here).
      (what) => (what.startsWith('avatar') ? pic : ''),
    );
    setAiTransport(async (p) => {
      if (p === 'part-name') return { fixed: '', english: '', isPart: true, kind: 'part', kindSure: 0.5, confidence: 0.5 };
      if (p === 'labour') return { text: '' };
      throw new Error('not played');
    });
    localStorage.setItem('mygarage.chatStudy.at', String(Date.now()));
    await refreshWa();
  }, PIC);
}

(async () => {
  const browser = await launch();
  const errors = [];
  const check = (ok, what) => {
    if (!ok) throw new Error('v0.92 e2e: ' + what);
    console.log('ok', what);
  };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await ctx.addInitScript(() => {
    localStorage.setItem('mygarage.feedback', '0');
    localStorage.setItem('mygarage.hapticLabels', '1');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  const top = (sel) => page.locator(`.screen[data-role="top"] ${sel}`);
  const settle = (ms = 500) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

  await page.goto(BASE + '#/');
  await settle(900);
  // The base: a supplier and a customer with these numbers, a Toyota Camry's job, an earlier Camry's prices.
  const ids = await page.evaluate(async () => {
    const { saveSupplier } = await import('/src/services/parts.ts');
    const { createCustomer } = await import('/src/services/customers.ts');
    const { checkIn } = await import('/src/services/orders.ts');
    const { addItem, updateItem } = await import('/src/services/estimate.ts');
    const { db } = await import('/src/db/db.ts');
    await saveSupplier({ name: 'Fast Toyota Parts', phone: '+971501110001' });
    await createCustomer({ name: 'Omar', phone: '+971501110004', type: 'individual', preferredChannel: 'whatsapp', docLanguage: 'en' });
    const sup = (await db.suppliers.toArray()).find((s) => s.name === 'Fast Toyota Parts');
    const plate = (n) => ({ emirate: 'DXB', code: 'T', number: String(n) });
    const before = await checkIn({ plate: plate(30000 + Math.floor(Math.random() * 9000)), make: 'Toyota', model: 'Camry', name: 'Sam Test', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    const pads = await addItem(before.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1 });
    await updateItem(pads.id, { offers: [{ id: 'wa:e2e:0:0', kind: 'oem', costFils: 18000, supplierId: sup.id, msg: 'M1' }, { id: 'wa:e2e:0:1', kind: 'aftermarket', costFils: 9500, brand: 'TRW', supplierId: sup.id, msg: 'M1' }] });
    const o = await checkIn({ plate: plate(40000 + Math.floor(Math.random() * 9000)), make: 'Toyota', model: 'Camry', name: 'Sam Test', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    return { jobId: o.id, supId: sup.id };
  });
  await playServer(page);

  // 1. One «Добавить позицию»: «Авто», each line's kind found as it is typed.
  await page.goto(BASE + `#/orders/${ids.jobId}`);
  await top('[data-add-line]').waitFor({ timeout: 15000 });
  check((await top('.add-row .add-btn').count()) === 1, 'one «Добавить позицию» under the lines (no three tiles)');
  await top('[data-add-line]').click();
  const qa = page.locator('.mantine-Modal-content').filter({ has: page.locator('.qa-field') });
  await qa.waitFor();
  check((await qa.locator('[data-qa-mode="auto"]').getAttribute('aria-checked')) === 'true', '«Авто» chosen at the start');
  const typeAndSee = async (text) => {
    await qa.locator('.qa-field input').fill(text);
    await qa.locator('.qa-new [data-qa-kind]').waitFor();
    return qa.locator('.qa-new [data-qa-kind]').getAttribute('data-qa-kind');
  };
  check((await typeAndSee('AC GAS RECHARGE')) === 'service', '«AC GAS RECHARGE» — a service, as it is typed');
  await qa.locator('.qa-field input').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.mantine-Modal-content .qa-added-name').length >= 1);
  check((await typeAndSee('labour')) === 'labor', '«labour» — the labour charge');
  // A part of the history: its own row (the price it had), its kind on it.
  await qa.locator('.qa-field input').fill('front brake pads');
  await qa.locator('.qa-row:not(.qa-new) [data-qa-kind]').first().waitFor();
  check((await qa.locator('.qa-row:not(.qa-new) [data-qa-kind]').first().getAttribute('data-qa-kind')) === 'part', '«front brake pads» — a part of the history, its kind on its row');
  await qa.locator('.qa-field input').fill('BRAK PADS');
  await qa.locator('[data-qa-fixed]').waitFor();
  check((await qa.locator('.qa-new .qa-name').innerText()).includes('BRAKE PADS'), '«BRAK PADS» put right at once — «BRAKE PADS»');
  await qa.locator('.qa-field input').fill('front brake pads');
  await qa.locator('.qa-row:not(.qa-new)').first().waitFor();
  await shot('phone-01-auto-kinds');
  await qa.locator('.qa-field input').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.mantine-Modal-content .qa-added-name').length >= 2);
  await qa.locator('.mantine-Modal-close').click();
  await qa.waitFor({ state: 'detached' });
  const kinds = await page.evaluate(async (id) => {
    const { db } = await import('/src/db/db.ts');
    return (await db.items.where('orderId').equals(id).toArray()).filter((i) => !i.autoLabour).map((i) => [i.titleEn, i.kind]);
  }, ids.jobId);
  check(JSON.stringify(kinds.sort()) === JSON.stringify([['AC GAS RECHARGE', 'labor'], ['FRONT BRAKE PADS', 'part']]), 'added with their kinds: ' + JSON.stringify(kinds));
  await settle(600);
  await shot('phone-02-one-button');

  // 2. «+ Цена» of the pads: the prices said before for a Camry's pads — «Из прайса».
  await top('.list-row').filter({ hasText: 'FRONT BRAKE PADS' }).first().locator('.price-add, .price-tap-row').click();
  const ps = page.locator('.mantine-Modal-content.price-sheet');
  await ps.waitFor();
  await ps.locator('[data-price-hints]').waitFor({ timeout: 8000 });
  check((await ps.locator('[data-price-hint]').count()) === 2, '«Из прайса»: the two prices said before (original and copy)');
  await ps.locator('[data-price-hint]').filter({ hasText: 'TRW' }).click();
  check((await ps.getByLabel('Закупка').inputValue()).replace(/\s/g, '').startsWith('95'), 'a tap — the cost 95');
  await shot('phone-03-price-hints');
  await page.keyboard.press('Escape');
  await ps.waitFor({ state: 'detached' });

  // 3. «Поставщики» — «Отправить» held: «Отправить позже», in an hour.
  await top('button.add-extra[aria-label="Поставщики"]').click();
  const ask = page.locator('.mantine-Modal-content.ask-sheet');
  await ask.waitFor();
  await ask.locator(`[data-ask-supplier="${ids.supId}"]`).click();
  const send = ask.locator('[data-ask-send]');
  const box = await send.boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await touch('touchStart');
  await settle(700);
  await touch('touchEnd');
  const later = page.locator('.mantine-Modal-content').filter({ has: page.locator('[data-later-choices]') });
  await later.waitFor({ timeout: 5000 });
  check(true, 'held — «Отправить позже» opened');
  await shot('phone-04-send-later');
  await later.locator('[data-later="in60"]').click();
  // «Проверить и отправить»: the request shows its time; «Отправить» there hands it to the server with it.
  const confirm = page.locator('[data-wa-ask-later]').first();
  await confirm.waitFor({ timeout: 8000 });
  check(/уйдёт в \d\d:\d\d/.test(await confirm.innerText()), 'the request to check says when it goes: ' + (await confirm.innerText()));
  await shot('phone-05-confirm-later');
  await page.locator('.mantine-Modal-content').filter({ has: page.locator('[data-wa-ask-later]') }).getByRole('button', { name: /^Отправить/ }).first().click();
  await page.waitForFunction(() => window.__wa.out.length > 0, null, { timeout: 8000 });
  const out = await page.evaluate(() => window.__wa.out.map((x) => ({ key: x.key, after: x.after })));
  check(out[0].after && out[0].after > Date.now() + 50 * 60_000, 'handed to the server with its time (in an hour): ' + JSON.stringify(out.map((x) => x.key.split(':')[0])));

  // 4. WhatsApp: a contact's picture on the whole screen; Omar (a customer of the base) made «Поставщик» by hand.
  await page.goto(BASE + '#/whatsapp');
  await top('[data-wa-chat]').first().waitFor({ timeout: 15000 });
  await top('[data-wa-pic="971501110001@c.us"]').click();
  await page.locator('.viewer img, [class*="viewer"] img').first().waitFor({ timeout: 8000 });
  check(true, 'the list’s picture tapped — on the whole screen');
  await settle(500);
  await shot('phone-06-picture');
  await page.keyboard.press('Escape');
  await settle(500);
  const omarRow = top('.list-row:has([data-wa-chat="971501110004@c.us"])');
  check((await omarRow.locator('.wa-who').innerText()).includes('Клиент'), 'Omar — a customer of the base');
  await omarRow.click();
  await page.locator('[data-wa-head]').first().click();
  await page.locator('[data-wa-info="status"]').click();
  await page.locator('.mantine-Modal-content').getByText('Поставщик', { exact: true }).last().click();
  await settle(900);
  await page.keyboard.press('Escape');
  await page.goto(BASE + '#/whatsapp');
  await top('[data-wa-chat="971501110004@c.us"]').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.screen[data-role="top"] .list-row')].some((r) => r.querySelector('[data-wa-chat="971501110004@c.us"]') && /Поставщик/.test(r.textContent)), null, { timeout: 8000 });
  check(true, 'a status by hand wins: Omar’s chat — «Поставщик»');
  await shot('phone-07-status-by-hand');

  // 5. «Запчасти → Цены»: the pads with the Camry's prices.
  await page.goto(BASE + '#/parts?tab=prices');
  await top('[data-price-book]').waitFor({ timeout: 15000 });
  await top('[data-price-part="FRONT BRAKE PADS"]').waitFor();
  await top('.list-row').filter({ hasText: 'FRONT BRAKE PADS' }).first().click();
  const sheet = page.locator('.mantine-Modal-content').filter({ hasText: 'TRW' });
  await sheet.waitFor();
  const txt = await sheet.innerText();
  check(/Fast Toyota Parts/.test(txt) && /Toyota Camry/.test(txt) && /копия/.test(txt) && /оригинал/.test(txt), '«Цены»: who, the car, original and copy');
  await shot('phone-08-price-book');

  await browser.close();
  console.log(`v0.92 e2e: all ok; ERRORS: ${errors.length ? errors.join(' | ') : 'none'}`);
  if (errors.length) process.exit(1);
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
