const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/*
 * The audit of 27/11/2026, as the manager sees it (phone 390×844, the iPhone's tap labels over the controls). Every
 * name, number and price is made up; WhatsApp and the AI are not reached:
 * - a car on its second visit: «В прошлый раз отказался» with what was declined on the first — «Добавить» puts it on;
 * - «Добавить позицию»: «Шаблоны» before the first line (a tap adds the template's lines), «Часто вместе» after it;
 * - «Готово»: nothing pops up (the customer may pay at once); the job says «Клиенту не сказано» — «Отправить» there;
 * - the customer answered the quote in WhatsApp «ok go ahead» — on the job their words and «Согласовать»;
 * - a message in Arabic in the chat — «Перевести», the translation under it;
 * - «Заказать»: the cheaper offer picked, one order to the supplier seen before it goes, then the part «заказано»;
 * - «Сегодня»: tomorrow's booking — remind the customer; the work declined a month ago — offer it again.
 * Screenshots — test-results/audit/.
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/audit.cjs (BASE_URL to aim elsewhere).
 */
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = path.join(__dirname, '..', 'test-results', 'audit');
fs.mkdirSync(OUT, { recursive: true });

async function launch() {
  for (const channel of [process.env.E2E_BROWSER, undefined, 'chrome', 'msedge'].filter((x, i) => x || i === 1)) {
    try {
      // A fake microphone (the lines dictated, audit 27/11): Chrome's own test tone, no question asked.
      const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
      return await chromium.launch(channel ? { channel, args } : { args });
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
    if (!ok) throw new Error('audit e2e: ' + what);
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

  try {
    await page.goto(BASE + '#/');
    await settle(900);
    // The base: a customer with a number; a Camry seen before (the discs declined then); a Corolla gone a month ago with
    // work declined; a Hiace booked for tomorrow at 10:00 (Dubai).
    const ids = await page.evaluate(async () => {
      const { createCustomer } = await import('/src/services/customers.ts');
      const { checkIn } = await import('/src/services/orders.ts');
      const { addItem } = await import('/src/services/estimate.ts');
      const { db } = await import('/src/db/db.ts');
      const c = await createCustomer({ name: 'Rashid Test', phone: '+971501239876', type: 'individual', preferredChannel: 'whatsapp', docLanguage: 'en' });
      const plate = (n) => ({ emirate: 'DXB', code: 'Q', number: String(n) });
      const day = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
      const camry = plate(50000 + Math.floor(Math.random() * 9000));
      const first = await checkIn({ customerId: c.id, plate: camry, make: 'Toyota', model: 'Camry', name: c.name, phone: c.phone, docLanguage: 'en', complaint: '', arrivedNow: true });
      const discs = await addItem(first.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE DISCS', qty: 1, unitPriceFils: 36190 });
      await db.items.update(discs.id, { approvalState: 'declined' });
      await db.orders.update(first.id, { stage: 'closed', closedAt: day(20), arrivedAt: day(21), createdAt: day(21) });
      const second = await checkIn({ vehicleId: first.vehicleId, customerId: c.id, plate: camry, make: 'Toyota', model: 'Camry', name: c.name, phone: c.phone, docLanguage: 'en', complaint: 'Service', arrivedNow: true });
      const corolla = await checkIn({ customerId: c.id, plate: plate(60000 + Math.floor(Math.random() * 9000)), make: 'Toyota', model: 'Corolla', name: c.name, phone: c.phone, docLanguage: 'en', complaint: '', arrivedNow: true });
      const wipers = await addItem(corolla.id, { kind: 'part', block: 'A', titleEn: 'WIPER BLADES', qty: 1, unitPriceFils: 5000 });
      await db.items.update(wipers.id, { approvalState: 'declined' });
      await db.orders.update(corolla.id, { stage: 'closed', outcome: 'completed', closedAt: day(35), arrivedAt: day(36), createdAt: day(36) });
      const tomorrow = new Date(Date.now() + 86_400_000);
      const bookedFor = `${tomorrow.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })}T06:00:00.000Z`;
      const hiace = await checkIn({ customerId: c.id, plate: plate(70000 + Math.floor(Math.random() * 9000)), make: 'Toyota', model: 'Hiace', name: c.name, phone: c.phone, docLanguage: 'en', complaint: '', bookedFor });
      return { jobId: second.id, corolla: corolla.id, hiace: hiace.id };
    });

    // 1. The Camry's second visit: what was declined on the first, a tap from this job.
    await page.goto(BASE + `#/orders/${ids.jobId}`);
    const declined = top('[data-declined-before]');
    await declined.waitFor({ timeout: 15000 });
    check((await declined.innerText()).includes('FRONT BRAKE DISCS'), '«В прошлый раз отказался»: FRONT BRAKE DISCS');
    await shot('phone-01-declined-before');
    await declined.getByRole('button', { name: 'Добавить' }).click();
    await top('.list-row').filter({ hasText: 'FRONT BRAKE DISCS' }).first().waitFor({ timeout: 8000 });
    await declined.waitFor({ state: 'detached', timeout: 8000 });
    check(true, '«Добавить» — the discs on this job, the row gone');

    // 2. «Добавить позицию»: «Шаблоны» before the first line typed; «Часто вместе» after.
    await top('[data-add-line]').click();
    const qa = page.locator('.mantine-Modal-content').filter({ has: page.locator('.qa-field') });
    await qa.waitFor();
    await qa.locator('[data-qa-templates]').waitFor({ timeout: 8000 });
    await shot('phone-02-templates');
    await qa.locator('[data-qa-templates] .chip').filter({ hasText: /масло и фильтр/i }).click();
    await page.waitForFunction(() => document.querySelectorAll('.mantine-Modal-content .qa-added-name').length >= 3, null, { timeout: 8000 });
    check(true, 'a template tapped — its three lines added');
    await qa.locator('[data-qa-together]').waitFor({ timeout: 8000 });
    const together = await qa.locator('[data-qa-together] .chip').allInnerTexts();
    check(together.some((x) => /AIR FILTER|CABIN FILTER/.test(x)), '«Часто вместе» after the oil service: ' + together.join(', '));
    await shot('phone-03-together');
    // (The tap guard drops a tap on another control at the same spot right after an action — ui/tapGuard.ts.)
    await settle(500);
    await qa.locator('[data-qa-together] .chip').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.mantine-Modal-content .qa-added-name').length >= 4, null, { timeout: 8000 });
    check(true, 'a hint tapped — added');
    await qa.locator('.mantine-Modal-close').click();
    await qa.waitFor({ state: 'detached' });

    // 3. «Готово»: the customer told at once — the message with the invoice, one tap away.
    await page.evaluate(async (id) => {
      const { db } = await import('/src/db/db.ts');
      const { syncStage } = await import('/src/services/flow.ts');
      // Agreed in person (the test's shortcut): every line priced and «да».
      for (const i of await db.items.where('orderId').equals(id).toArray()) await db.items.update(i.id, { approvalState: 'approved', ...(i.unitPriceFils ? {} : { unitPriceFils: 5000 }) });
      await syncStage(id);
    }, ids.jobId);
    const dlg = page.getByRole('dialog');
    await settle(500);
    await page.getByRole('button', { name: /^Готово/ }).click();
    await dlg.getByRole('button', { name: 'Выписать инвойс' }).click();
    // Nothing pops up (the customer may be paying at the counter): the job says «Клиенту не сказано» with «Отправить».
    await top('[data-ready-state="untold"]').waitFor({ timeout: 10000 });
    check((await page.locator('.mantine-Modal-content').filter({ hasText: 'is ready' }).count()) === 0, '«Готово» — no sheet in the way of the payment');
    await top('[data-ready-state="untold"]').scrollIntoViewIfNeeded();
    await settle(400);
    await shot('phone-04-untold');
    await settle(400);
    await top('.list-row').filter({ has: page.locator('[data-ready-state="untold"]') }).getByRole('button', { name: 'Отправить' }).click();
    const sendSheet = page.locator('.mantine-Modal-content').filter({ hasText: 'is ready' });
    await sendSheet.waitFor({ timeout: 10000 });
    check(true, '«Отправить» — «your car is ready» with the invoice');
    await settle(400);
    await shot('phone-05-ready-to-send');
    await page.keyboard.press('Escape');
    await sendSheet.waitFor({ state: 'detached', timeout: 8000 });

    // 4. The customer answered the quote in WhatsApp «ok go ahead»: on the job — their words and «Согласовать».
    const quoted = await page.evaluate(async () => {
      const { setWaTransport, refreshWa } = await import('/src/services/whatsapp.ts');
      const { SyncError } = await import('/src/services/sync/api.ts');
      const { db } = await import('/src/db/db.ts');
      const { checkIn } = await import('/src/services/orders.ts');
      const { addItem, sendVersion } = await import('/src/services/estimate.ts');
      const c = (await db.customers.toArray()).find((x) => x.name === 'Rashid Test');
      const o = await checkIn({ customerId: c.id, plate: { emirate: 'DXB', code: 'Q', number: String(80000 + Math.floor(Math.random() * 9000)) }, make: 'Nissan', model: 'Patrol', name: c.name, phone: c.phone, docLanguage: 'en', complaint: '', arrivedNow: true });
      await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 24000 });
      await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'BRAKE SERVICE', qty: 1, unitPriceFils: 15000 });
      await sendVersion(o.id, { via: 'whatsapp' });
      const chat = '971501239876@c.us';
      setWaTransport(async (p) => {
        if (p === 'status') return { ok: true, available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 1, unread: 1 };
        if (p === 'chats') return { chats: [{ id: chat, name: 'Rashid Test', group: false, phone: '971501239876', unread: 1, t: Date.now(), archived: false, pinned: false, muted: false, self: false, last: null }], total: 1, unread: 1 };
        if (p === 'number') return { ok: true, chat };
        if (p === 'messages')
          return {
            messages: [
              // Before the quote (not its answer): a supplier-like message in Arabic, for «Перевести».
              { id: 'e2e-arabic-1', chat, t: Date.now() - 3_600_000, me: false, type: 'chat', text: 'فحمات الفرامل موجودة 250 درهم', ack: 0 },
              { id: 'e2e-answer-1', chat, t: Date.now() + 2000, me: false, type: 'chat', text: 'ok go ahead', ack: 0 },
            ],
            more: false,
          };
        if (p === 'outbox') return { ok: true, items: [], queued: 0, failed: 0, sent: 0 };
        throw new SyncError(404, 'not found');
      });
      await refreshWa();
      const { setAiTransport } = await import('/src/services/ai.ts');
      setAiTransport(async (p) => {
        if (p === 'translate') return { text: 'Тормозные колодки есть, 250 дирхам', from: 'ar' };
        if (p === 'part-name') return { fixed: '', english: '', isPart: true, kind: 'part', kindSure: 0.5, confidence: 0.5 };
        if (p === 'labour') return { text: '' };
        throw new Error('not played');
      });
      return o.id;
    });
    await page.goto(BASE + `#/orders/${quoted}`);
    const answer = top('.list-row').filter({ has: page.locator('[data-customer-answer]') });
    await answer.waitFor({ timeout: 15000 });
    check((await answer.innerText()).includes('ok go ahead'), 'the customer’s words on the job: «ok go ahead» — «Согласен на всё»');
    await settle(400);
    await shot('phone-06-customer-answer');
    await answer.getByRole('button', { name: 'Согласовать' }).click();
    await answer.waitFor({ state: 'detached', timeout: 8000 });
    const states = await page.evaluate(async (id) => {
      const { db } = await import('/src/db/db.ts');
      const d = await db.decisions.where('orderId').equals(id).toArray();
      return { items: (await db.items.where('orderId').equals(id).toArray()).map((i) => i.approvalState), note: d[0]?.note ?? '' };
    }, quoted);
    check(states.items.every((x) => x === 'approved') && states.note.includes('ok go ahead'), 'a tap — agreed, the customer’s words kept with the decision: ' + states.note);

    // 4b. The chat: a message in Arabic — «Перевести» under it, the translation in its place (kept in memory only).
    await page.goto(BASE + '#/whatsapp/chat/971501239876%40c.us');
    const ask = top('[data-wa-extra-ask]').first();
    await ask.waitFor({ timeout: 15000 });
    await settle(400);
    await ask.click();
    await top('[data-wa-extra="done"]').waitFor({ timeout: 8000 });
    check((await top('[data-wa-extra="done"]').innerText()).includes('Тормозные колодки есть'), 'a message in Arabic — «Перевести» — its translation under it');
    await shot('phone-07-translated');

    // 4c. «Заказать»: a part two suppliers priced — the cheaper picked; one message through «Проверить и отправить»; then «заказано».
    const buy = await page.evaluate(async () => {
      const { db, uid } = await import('/src/db/db.ts');
      const { checkIn } = await import('/src/services/orders.ts');
      const { addItem } = await import('/src/services/estimate.ts');
      const c = (await db.customers.toArray()).find((x) => x.name === 'Rashid Test');
      const o = await checkIn({ customerId: c.id, plate: { emirate: 'DXB', code: 'Q', number: String(90000 + Math.floor(Math.random() * 9000)) }, make: 'Toyota', model: 'Land Cruiser', name: c.name, phone: c.phone, docLanguage: 'en', complaint: '', arrivedNow: true });
      const a = uid();
      const b = uid();
      await db.suppliers.bulkAdd([
        { id: a, name: 'Fast Toyota Parts', phone: '+971501110001' },
        { id: b, name: 'Desert Spares', phone: '+971501110002' },
      ]);
      const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1, unitPriceFils: 40000 });
      await db.items.update(pads.id, { approvalState: 'approved', offers: [{ id: 'o-a', kind: 'oem', costFils: 26000, supplierId: a }, { id: 'o-b', kind: 'aftermarket', costFils: 14000, supplierId: b, brand: 'TRW' }] });
      return { jobId: o.id, itemId: pads.id, cheap: b };
    });
    await page.goto(BASE + `#/orders/${buy.jobId}`);
    await top('button.add-extra[aria-label="Заказать"]').waitFor({ timeout: 15000 });
    await settle(400);
    await top('button.add-extra[aria-label="Заказать"]').click();
    const sheet = page.locator('.mantine-Modal-content.buy-sheet');
    await sheet.waitFor({ timeout: 8000 });
    check((await sheet.locator('[data-buy-offer][data-on]').innerText()).includes('Desert Spares'), '«Заказать»: the cheaper offer picked first (Desert Spares, 140)');
    await settle(400);
    await shot('phone-08-buy');
    await sheet.locator('[data-buy-go]').click();
    const review = page.locator('.mantine-Modal-content').filter({ hasText: 'Please keep for us' });
    await review.waitFor({ timeout: 10000 });
    check(((await review.textContent()) ?? '').includes('FRONT BRAKE PADS (copy TRW) — 140.00 AED'), 'the order to the supplier, seen before it goes');
    await shot('phone-09-buy-review');
    await review.getByRole('button', { name: /^Отправить/ }).first().click();
    // (A page's async waitForFunction returns at once — polled from here.)
    let after = [];
    for (let k = 0; k < 20; k++) {
      after = await page.evaluate(async (id) => {
        const { db } = await import('/src/db/db.ts');
        const i = await db.items.get(id);
        return [i.procurementStatus, i.costPriceFils, i.supplierId];
      }, buy.itemId);
      if (after[0] === 'ordered') break;
      await settle(500);
    }
    check(after[0] === 'ordered' && after[1] === 14000 && after[2] === buy.cheap, 'sent — the part «заказано» at Desert Spares, 140: ' + JSON.stringify(after));

    // 4d. The customer sends a transfer screenshot after the invoice: on the job — «Перевод · 315.00 → Записать»; the
    // tap records the payment with the screenshot as its proof.
    const paid = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const { checkIn } = await import('/src/services/orders.ts');
      const { addItem } = await import('/src/services/estimate.ts');
      const { quickInvoice } = await import('/src/services/money.ts');
      const { setWaTransport, refreshWa } = await import('/src/services/whatsapp.ts');
      const { SyncError } = await import('/src/services/sync/api.ts');
      const { setAiTransport } = await import('/src/services/ai.ts');
      const c = (await db.customers.toArray()).find((x) => x.name === 'Rashid Test');
      const o = await checkIn({ customerId: c.id, plate: { emirate: 'DXB', code: 'Q', number: String(30000 + Math.floor(Math.random() * 9000)) }, make: 'Nissan', model: 'Sunny', name: c.name, phone: c.phone, docLanguage: 'en', complaint: '', arrivedNow: true });
      await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'AC SERVICE', qty: 1, unitPriceFils: 30000 });
      await quickInvoice(o.id);
      const cv = document.createElement('canvas');
      cv.width = cv.height = 80;
      const g = cv.getContext('2d');
      g.fillStyle = '#e8f5ee';
      g.fillRect(0, 0, 80, 80);
      g.fillStyle = '#1a7f4b';
      g.fillRect(10, 30, 60, 12);
      const picture = cv.toDataURL('image/jpeg');
      const chat = '971501239876@c.us';
      setWaTransport(
        async (q) => {
          if (q === 'status') return { ok: true, available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: 1, unread: 1 };
          if (q === 'chats') return { chats: [{ id: chat, name: 'Rashid Test', group: false, phone: '971501239876', unread: 1, t: Date.now(), archived: false, pinned: false, muted: false, self: false, last: null }], total: 1, unread: 1 };
          if (q === 'number') return { ok: true, chat };
          if (q === 'messages') return { messages: [{ id: 'e2e-pay-1', chat, t: Date.now() + 2000, me: false, type: 'image', text: '', ack: 0, file: { mime: 'image/jpeg', w: 80, h: 80 } }], more: false };
          if (q === 'outbox') return { ok: true, items: [], queued: 0, failed: 0, sent: 0 };
          throw new SyncError(404, 'not found');
        },
        () => picture,
      );
      await refreshWa();
      setAiTransport(async (q) => {
        if (q === 'payment') return { isPayment: true, amount: 315, currency: 'AED', date: '', reference: 'FT2611270042', bank: 'Emirates NBD', way: 'transfer', confidence: 0.93 };
        if (q === 'lines') return { text: 'диски передние обе, развал сто двадцать', lines: [{ name: 'FRONT BRAKE DISCS', qty: 2, kind: 'part', price: 0 }, { name: 'WHEEL ALIGNMENT', qty: 1, kind: 'service', price: 120 }] };
        if (q === 'part-name') return { fixed: '', english: '', isPart: true, kind: 'part', kindSure: 0.5, confidence: 0.5 };
        if (q === 'labour') return { text: '' };
        throw new Error('not played');
      });
      return o.id;
    });
    await page.goto(BASE + `#/orders/${paid}`);
    const shotRow = top('.list-row').filter({ has: page.locator('[data-pay-shot]') });
    await shotRow.waitFor({ timeout: 15000 });
    check(/315[\s\S]*Перевод · \d\d\/\d\d · Emirates NBD/.test(await shotRow.innerText()), 'the transfer screenshot on the job: «315.00 · Перевод · Emirates NBD» — «Записать»');
    await settle(600);
    await shot('phone-10-pay-shot');
    await shotRow.locator('[data-pay-shot-go]').click();
    let rec = {};
    for (let k = 0; k < 20; k++) {
      rec = await page.evaluate(async (id) => {
        const { db } = await import('/src/db/db.ts');
        const pays = await db.payments.where('orderId').equals(id).toArray();
        const proofs = pays[0] ? await db.media.where('ownerId').equals(pays[0].id).count() : 0;
        return { pays: pays.map((x) => [x.method, x.amountFils, x.reference]), proofs };
      }, paid);
      if (rec.pays.length && rec.proofs) break;
      await settle(500);
    }
    check(JSON.stringify(rec.pays) === JSON.stringify([['transfer', 31500, 'Emirates NBD · FT2611270042']]) && rec.proofs === 1, 'a tap — the transfer recorded, the screenshot its proof: ' + JSON.stringify(rec));
    await settle(900);
    await shot('phone-11-pay-shot-recorded');

    // 4e. Lines dictated: «Добавить позицию» → the microphone → spoken → the AI's lines on the job (discs ×2, alignment 120).
    await page.goto(BASE + `#/orders/${buy.jobId}`);
    await top('[data-add-line]').waitFor({ timeout: 15000 });
    await settle(500);
    await top('[data-add-line]').click();
    const qa2 = page.locator('.mantine-Modal-content').filter({ has: page.locator('.qa-field') });
    await qa2.waitFor();
    const mic = qa2.locator('[data-qa-voice]');
    await mic.waitFor({ timeout: 8000 });
    await settle(400);
    await mic.click();
    await qa2.locator('[data-qa-voice="on"]').waitFor({ timeout: 8000 });
    await page.waitForTimeout(1500);
    await shot('phone-14-dictating');
    await qa2.locator('[data-qa-voice="on"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mantine-Modal-content .qa-added-name').length >= 2, null, { timeout: 15000 });
    const said = await qa2.locator('.qa-added-name').allInnerTexts();
    check(said.some((x) => x.includes('FRONT BRAKE DISCS')) && said.some((x) => x.includes('WHEEL ALIGNMENT')), 'dictated — the lines on the job: ' + said.join(', '));
    await settle(500);
    await shot('phone-15-dictated');
    const lines = await page.evaluate(async (id) => {
      const { db } = await import('/src/db/db.ts');
      return (await db.items.where('orderId').equals(id).toArray()).map((i) => [i.titleEn, i.qty, i.unitPriceFils ?? 0]);
    }, buy.jobId);
    const discs = lines.find((x) => x[0] === 'FRONT BRAKE DISCS');
    const align = lines.find((x) => x[0] === 'WHEEL ALIGNMENT');
    check(discs && discs[1] === 2 && align && align[2] > 0, 'the discs ×2 as said, the alignment at the price said: ' + JSON.stringify(lines));
    await qa2.locator('.mantine-Modal-close').click();
    await qa2.waitFor({ state: 'detached' });

    // 4f. The Mulkiya's expiry: set on the car — orange on the chip within a month; the pill in the Mulkiya's view.
    const soon = await page.evaluate(async (x) => {
      const { db } = await import('/src/db/db.ts');
      const { setMulkiya } = await import('/src/services/cover.ts');
      const { setMulkiyaExpiry } = await import('/src/services/mulkiya.ts');
      const { dubaiDate, shiftDay } = await import('/src/domain/dates.ts');
      const camry = (await db.orders.get(x.jobId)).vehicleId;
      const cv = document.createElement('canvas');
      cv.width = 640;
      cv.height = 400;
      const g = cv.getContext('2d');
      g.fillStyle = '#dfe9f2';
      g.fillRect(0, 0, 640, 400);
      g.fillStyle = '#123';
      g.font = '28px sans-serif';
      g.fillText('Exp. Date', 40, 160);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
      await setMulkiya(camry, 'mulkiya', blob);
      const day = shiftDay(dubaiDate(), 10);
      await setMulkiyaExpiry(camry, day);
      // The Corolla (gone a month ago): its Mulkiya runs out in ten days too — «Сегодня» says it.
      await setMulkiyaExpiry((await db.orders.get(x.corolla)).vehicleId, day);
      return day;
    }, ids);
    await page.goto(BASE + `#/orders/${ids.jobId}`);
    const due = top('[data-mulkiya-due]');
    await due.waitFor({ timeout: 15000 });
    check((await due.getAttribute('data-due')) === 'soon', 'the Mulkiya chip: its day in orange — ' + (await due.innerText()));
    await settle(500);
    await top('.vin-chip').filter({ has: page.locator('[data-mulkiya-due]') }).click();
    const pill = page.locator('.day-pill').filter({ hasText: 'До' }).first();
    await pill.waitFor({ timeout: 10000 });
    check(true, 'the Mulkiya’s view: «До ' + soon + '» — a tap changes it');
    await settle(600);
    check((await page.locator('button.day-pill-input[data-due="soon"]').count()) > 0, 'the pill orange: within a month');
    await shot('phone-16-mulkiya');
    await page.keyboard.press('Escape');
    await settle(600);

    // 5. «Сегодня»: tomorrow's booking and the work declined a month ago — each a ready message.
    await page.goto(BASE + '#/');
    await top('.today-bell').click();
    // (The jobs that left are read a moment after the board — TodayBell's `loadPast`.)
    await page.locator('.today-note').filter({ hasText: 'В прошлый раз отказался' }).waitFor({ timeout: 10000 });
    const notes = await page.locator('.today-note').allInnerTexts();
    check(notes.some((x) => x.includes('Завтра в 10:00')), '«Сегодня»: tomorrow at 10:00 — remind the customer');
    check(notes.some((x) => x.includes('В прошлый раз отказался')), '«Сегодня»: declined last time — offer again');
    check(notes.some((x) => x.includes('Mulkiya до')), '«Сегодня»: the Corolla’s Mulkiya runs out — remind the customer');
    await shot('phone-07-today');
    await page.locator('.today-note').filter({ hasText: 'В прошлый раз отказался' }).click();
    const offer = page.locator('.mantine-Modal-content').filter({ hasText: 'WIPER BLADES' });
    await offer.waitFor({ timeout: 8000 });
    check(true, 'the offer names the declined work: WIPER BLADES');
    await shot('phone-08-declined-offer');
    await page.keyboard.press('Escape');
    await offer.waitFor({ state: 'detached', timeout: 8000 });

    // 5b. «Написать всем · N»: the day's customer messages in «Проверить и отправить» together; what went leaves «Сегодня».
    await settle(500);
    await top('.today-bell').click();
    const all = page.locator('[data-today-batch]');
    await all.waitFor({ timeout: 10000 });
    check(/Написать всем · \d/.test(await all.innerText()), '«Сегодня»: ' + (await all.innerText()));
    await shot('phone-12-today-batch');
    await settle(500);
    await all.click();
    const morning = page.locator('.mantine-Modal-content').filter({ has: page.locator('[data-wa-confirm]') });
    await morning.waitFor({ timeout: 10000 });
    const words = (await morning.textContent()) ?? '';
    check(words.includes('WIPER BLADES') && words.includes('tomorrow at') && words.includes('registration (Mulkiya)'), 'the declined work, tomorrow’s booking and the Mulkiya — all in «Проверить и отправить»');
    await settle(500);
    await shot('phone-13-today-review');
    await morning.getByRole('button', { name: /^Отправить все/ }).click();
    let marks = [];
    for (let k = 0; k < 20; k++) {
      marks = await page.evaluate(async (x) => {
        const { db } = await import('/src/db/db.ts');
        const corolla = await db.orders.get(x.corolla);
        return [!!corolla.declinedOfferedAt, !!(await db.orders.get(x.hiace)).bookingRemindedAt, !!(await db.vehicles.get(corolla.vehicleId)).regRemindedFor];
      }, ids);
      if (marks.every(Boolean)) break;
      await settle(500);
    }
    check(marks.every(Boolean), 'sent — the declined offer, the booking and the Mulkiya reminders left «Сегодня»: ' + JSON.stringify(marks));

    check(errors.length === 0, 'no errors in the console' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log('audit e2e: all passed');
  } catch (e) {
    await shot('failed').catch(() => undefined);
    console.error(e.message, errors.length ? '\nconsole: ' + errors.join(' | ') : '');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
