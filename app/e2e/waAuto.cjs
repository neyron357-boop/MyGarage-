const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
/*
 * What the garage's WhatsApp says by itself (v0.79), with the garage's server played in the page (services/whatsapp
 * `setWaTransport`): nothing reaches WhatsApp, every name, number and message is made up. The settings («Автоматизация»):
 * the work group, the boss, the wash picked among the chats; a job agreed — the work group and the boss told; a line
 * «CAR WASH» — the wash told; a company's group set on its card and its report sent from the job; suppliers picked and
 * asked, one answers — its prices on the job's lines. Screenshots go to test-results/wa-auto.
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/waAuto.cjs [outDir]
 */
const OUT = process.argv[2] || path.join(__dirname, '..', 'test-results', 'wa-auto');
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
fs.mkdirSync(OUT, { recursive: true });

async function launchBrowser() {
  const forced = process.env.E2E_BROWSER;
  for (const channel of forced ? [forced] : ['chromium', 'chrome', 'msedge']) {
    try {
      return await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), args: ['--enable-unsafe-swiftshader'] });
    } catch {
      // the next one
    }
  }
  throw new Error('no browser');
}

/** The server's part, in the page: WhatsApp linked, a few chats, the outbox kept in `window.__out`. */
async function playServer(page) {
  await page.evaluate(async () => {
    const { setWaTransport } = await import('/src/services/whatsapp.ts');
    const { SyncError } = await import('/src/services/sync/api.ts');
    const { db } = await import('/src/db/db.ts');
    const { waDigits } = await import('/src/domain/whatsapp.ts');
    const sups = (await db.suppliers.toArray()).filter((s) => waDigits(s.phone)).sort((a, b) => a.name.localeCompare(b.name));
    const chat = (id, name, phone, over = {}) => ({ id, name, group: false, phone, unread: 0, t: Date.now() - 3600_000, archived: false, pinned: false, muted: false, self: false, last: null, ...over });
    const chats = [
      chat('120363000000000001@g.us', 'Garage team', '', { group: true }),
      chat('120363000000000002@g.us', 'Car wash', '', { group: true }),
      chat('120363000000000003@g.us', 'ABC Transport — cars', '', { group: true }),
      chat('55500000000001@lid', 'Boss', '971500000009'),
      ...sups.slice(0, 3).map((s, i) => chat(`5550000000010${i}@lid`, s.name, waDigits(s.phone))),
    ];
    const world = { out: [], chats, messages: {}, sups: sups.slice(0, 3).map((s) => ({ id: s.id, name: s.name, phone: waDigits(s.phone) })) };
    window.__wa = world;
    setWaTransport(async (p, init) => {
      await new Promise((r) => setTimeout(r, 60));
      if (p === 'status') return { ok: true, available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '2.3000', error: '', chats: chats.length, unread: 0 };
      if (p === 'chats') return { chats: world.chats, total: world.chats.length, unread: 0 };
      if (p === 'messages') return { messages: world.messages[init.query.chat] ?? [], more: false };
      if (p === 'number') {
        const known = world.chats.find((c) => !c.group && c.phone === init.query.phone);
        return { ok: true, chat: known?.id ?? `${init.query.phone}@c.us` };
      }
      if (p === 'outbox' && init.method === 'POST') {
        const items = init.body.items;
        for (const x of items) if (!world.out.some((o) => o.key === x.key)) world.out.push(x);
        return { ok: true, items: items.map((x) => ({ key: x.key, state: 'queued', at: Date.now(), title: x.title })) };
      }
      if (p === 'outbox') return { ok: true, items: world.out.map((x) => ({ key: x.key, state: 'sent', at: Date.now(), title: x.title })), queued: 0, failed: 0, sent: world.out.length };
      throw new SyncError(404, 'not found');
    });
    (await import('/src/services/waAuto.ts')).setWaAutoDelays({ agree: 300, checkin: 300, cover: 300, ready: 300, wash: 300 });
  });
}

(async () => {
  const browser = await launchBrowser();
  const errors = [];
  let current = null;
  const watch = (page) => {
    current = page;
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
  };
  const check = (ok, what) => {
    if (!ok) throw new Error(`wa-auto e2e: ${what}`);
    console.log('ok', what);
  };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU' });
    await ctx.addInitScript(() => localStorage.getItem('mygarage.feedback') ?? localStorage.setItem('mygarage.feedback', '0'));
    const page = await ctx.newPage();
    watch(page);
    const settle = (ms = 700) => page.waitForTimeout(ms);
    const top = () => page.locator('.screen[data-role="top"]');
    const shot = async (name) => {
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.timeline === document.timeline).map((a) => a.finished.catch(() => undefined)))).catch(() => undefined);
      await page.screenshot({ path: `${OUT}/${name}.png` });
      console.log('shot', name);
    };
    const go = async (hash, ms) => {
      await page.goto(BASE + hash);
      await settle(ms);
    };
    const out = (prefix) => page.evaluate((p) => window.__wa.out.filter((x) => x.key.startsWith(p)), prefix);
    // v0.85: nothing goes by itself — «Проверить и отправить» opens, the person taps «Отправить» (all of them at once).
    const confirm = async () => {
      const sheet = page.locator('[data-wa-confirm]');
      if (!(await sheet.isVisible().catch(() => false))) return;
      const all = sheet.getByRole('button', { name: /^Отправить все/ });
      if (await all.isVisible().catch(() => false)) await all.click();
      else await sheet.locator('.wa-ask').first().getByRole('button', { name: /^Отправить$/ }).click();
      await settle(400);
    };
    const waitOut = async (prefix, n = 1) => {
      for (let i = 0; i < 60; i++) {
        await confirm();
        if ((await out(prefix)).length >= n) return out(prefix);
        await page.waitForTimeout(150);
      }
      throw new Error(`wa-auto e2e: nothing handed over under «${prefix}»`);
    };

    await go('#/');
    await page.evaluate(async () => (await import('/src/services/demo.ts')).loadDemoData());
    await playServer(page);
    await page.addStyleTag({ content: '.mantine-Notifications-root { animation: none !important; }' });

    // 1. The settings: the work group, the boss, the wash — picked among the chats.
    await go('#/whatsapp/setup');
    await top().locator('[data-wa-auto-link]').click();
    await top().locator('[data-wa-target="work"]').waitFor();
    const pickIn = async (mark, chatId) => {
      await top().locator(`[data-wa-target="${mark}"]`).click();
      await page.locator(`[data-chat-pick="${chatId}"]`).click();
      await page.locator(`[data-chat-pick="${chatId}"]`).waitFor({ state: 'detached' });
      await settle(400);
    };
    await pickIn('work', '120363000000000001@g.us');
    await pickIn('wash', '120363000000000002@g.us');
    await top().locator('[data-wa-target="boss"]').click();
    await page.getByRole('tab', { name: 'Люди' }).waitFor();
    await page.locator('[data-chat-pick="55500000000001@lid"]').click();
    await settle(500);
    check((await top().locator('[data-wa-target="work"]').innerText()) === 'Garage team', 'the work group is picked');
    check((await top().locator('[data-wa-target="boss"]').innerText()) === 'Boss', 'the boss is picked');
    await page.evaluate(() => document.querySelector('.screen[data-role="top"] [data-wa-auto="boss-pdf"]').click());
    await settle(300);
    await shot('phone-01-auto');
    await page.evaluate(() => (document.querySelector('.screen[data-role="top"] .screen-scroll').scrollTop = 1400));
    await settle(300);
    await shot('phone-02-auto-suppliers');

    // 2. A job agreed: the work group (photo, lines, no prices) and the boss (the estimate) told by themselves.
    const job = await page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      const { checkIn } = await import('/src/services/orders.ts');
      const { addItem } = await import('/src/services/estimate.ts');
      const { approveAll } = await import('/src/services/flow.ts');
      const c = (await db.customers.toArray()).filter((x) => x.type === 'company').sort((a, b) => a.name.localeCompare(b.name))[0] ?? (await db.customers.toArray())[0];
      const o = await checkIn({ customerId: c.id, plate: { emirate: 'DXB', code: 'W', number: '79079' }, make: 'Toyota', model: 'Hiace', name: c.name, phone: c.phone, docLanguage: 'en', complaint: 'Brakes noise', arrivedNow: true });
      const pads = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Brake pads front', unitPriceFils: 0 });
      const disc = await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'Brake disc front', qty: 2, unitPriceFils: 0 });
      await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Brake service', unitPriceFils: 15000 });
      return { id: o.id, customerId: c.id, pads: pads.id, disc: disc.id };
    });
    await page.evaluate(async (id) => (await import('/src/services/flow.ts')).approveAll(id), job.id);
    await page.locator('[data-wa-ask^="work:agreed"]').waitFor({ timeout: 10000 });
    check((await out('work:')).length === 0, 'nothing goes before «Отправить»: the work group’s report waits, seen first');
    await settle(500);
    await shot('phone-02b-confirm');
    const work = (await waitOut('work:agreed'))[0];
    check(work.chat === '120363000000000001@g.us' && /BRAKE SERVICE/.test(work.parts[0].text ?? work.parts[0].caption) && !/AED/.test(work.parts[0].text ?? work.parts[0].caption), 'agreed: the work group gets the lines to do, no prices');
    const est = (await waitOut('boss:estimate'))[0];
    check(est.chat === '55500000000001@lid' && /Estimate/.test(est.parts[0].text) && est.parts.length === 1, 'the boss gets the estimate (the PDF switched off)');

    // 3. A line «CAR WASH»: the wash told.
    await page.evaluate(async (id) => (await import('/src/services/estimate.ts')).addItem(id, { kind: 'labor', block: 'A', titleEn: 'Car wash', unitPriceFils: 3000 }), job.id);
    const wash = (await waitOut('wash:'))[0];
    check(wash.chat === '120363000000000002@g.us' && /CAR WASH/.test(JSON.stringify(wash.parts)), 'a line «CAR WASH»: the wash group told');

    // 4. A company's group on its card; the job's report to it — by one tile.
    await go(`#/customers/${job.customerId}`, 900);
    await top().locator('[data-customer-wa-group]').click();
    await page.locator('[data-chat-pick="120363000000000003@g.us"]').click();
    await settle(600);
    check((await top().locator('[data-customer-wa-group]').innerText()).includes('ABC Transport — cars'), "the company's group is on its card");
    await shot('phone-03-customer-group');
    await go(`#/orders/${job.id}`, 1200);
    await top().getByRole('button', { name: /^(Ещё|More)$/ }).first().click();
    await shot('phone-04-job-tiles');
    await page.locator('.action-tile', { hasText: 'Группе клиента' }).click();
    const client = (await waitOut('client:hand'))[0];
    check(client.chat === '120363000000000003@g.us' && !/AED/.test(JSON.stringify(client.parts)), "the visit's report goes to the company's group, no prices");

    // 4b. v0.85: «＋» on the job's screen is this job's actions — a tap, not the app's «Новый заказ».
    await go(`#/orders/${job.id}`, 1200);
    await page.locator('.tab-plus').click();
    await page.locator('.quick-item[data-job]').first().waitFor();
    const acts = await page.locator('.quick-item[data-job]').evaluateAll((els) => els.map((e) => e.dataset.quick));
    check(['toWork', 'toClient', 'owner', 'new'].every((k) => acts.includes(k)), `the job's «＋»: its own actions (${acts.join(', ')})`);
    await shot('phone-04b-job-plus');
    const before = (await out('work:hand')).length;
    await page.locator('.quick-item[data-quick="toWork"]').click();
    await page.locator('[data-wa-ask^="work:hand"]').waitFor({ timeout: 10000 });
    check((await out('work:hand')).length === before, "«В рабочую группу» from «＋»: seen first, nothing gone yet");
    await waitOut('work:hand', before + 1);

    // 5. Suppliers: picked, asked through the server, one answers — its prices on the lines.
    // v0.82 (#22): «Поставщики» under the job's lines — picked in its sheet, «Отправить» sends at once (no confirmation).
    await go(`#/orders/${job.id}`, 1200);
    await top().locator('button.add-extra[aria-label="Поставщики"]').click();
    const askSheet = page.locator('.mantine-Modal-content.ask-sheet');
    await askSheet.locator('[data-ask-supplier]').first().waitFor();
    const sups = await page.evaluate(() => window.__wa.sups);
    for (const s of sups.slice(0, 2)) {
      await askSheet.locator('[data-ask-search] input, .search-field input').first().fill(s.name);
      await askSheet.locator('.supplier-name-text', { hasText: s.name }).first().click();
      // A person's second tap, not a double tap at the same spot (ui/tapGuard.ts drops that one).
      await settle(450);
    }
    await askSheet.locator('.search-field input').first().fill('');
    await settle(300);
    await shot('phone-05-suppliers-picked');
    await askSheet.locator('[data-ask-send]').click();
    await askSheet.waitFor({ state: 'detached' });
    const asks = await waitOut('ask:', 2);
    check(asks.length === 2 && asks.every((a) => /1\. BRAKE PADS FRONT/.test(a.parts[0].text) && a.gap === 8), 'each picked supplier gets the request, a pause between');
    // The first supplier answers in its own way: the list copied back with prices.
    const sup = sups[0];
    const at = Date.now() + 2000;
    const chatId = await page.evaluate((phone) => window.__wa.chats.find((c) => c.phone === phone).id, sup.phone);
    await page.evaluate(
      ({ chatId, at }) => {
        window.__wa.messages[chatId] = [{ id: `false_${chatId}_R1`, chat: chatId, t: at, me: false, type: 'chat', text: '1. BRAKE PADS FRONT  org 180/dupl 95\n2. BRAKE DISC FRONT × 2  NA\n+VAT', ack: 0 }];
      },
      { chatId, at },
    );
    await page.evaluate(async ({ chatId, at, phone }) => {
      const { waSaid } = await import('/src/services/whatsapp.ts');
      waSaid({ t: 'msg', msg: { id: `false_${chatId}_R1`, chat: chatId, t: at, me: false, type: 'chat', text: '1. BRAKE PADS FRONT  org 180/dupl 95', ack: 0 }, chat: { id: chatId, name: 'x', group: false, phone, unread: 1, t: at, archived: false, pinned: false, muted: false, self: false, last: null } });
    }, { chatId, at, phone: sup.phone });
    // The answer read into the line (any open device reads it — here, at once on the message).
    for (let i = 0; i < 100; i++) {
      const n = await page.evaluate(async (id) => (await (await import('/src/db/db.ts')).db.items.get(id))?.offers?.length ?? 0, job.pads);
      if (n >= 2) break;
      await page.waitForTimeout(150);
    }
    const offers = await page.evaluate(async (id) => (await (await import('/src/db/db.ts')).db.items.get(id)).offers, job.pads);
    check(offers?.length === 2 && offers[0].kind === 'oem' && offers[0].costFils === 18000 && offers[1].costFils === 9500, "the answer's prices are the line's offers (original 180, copy 95)");
    const disc = await page.evaluate(async (id) => (await (await import('/src/db/db.ts')).db.items.get(id)).offers, job.disc);
    check(disc?.[0]?.na === true, '«NA» is said on its line');
    await settle(500);
    await shot('phone-06-suppliers-answered');
    // The line's sheet: the offers read, a tap takes one.
    await go(`#/orders/${job.id}`, 1200);
    await top().locator('.list-row', { hasText: 'BRAKE PADS FRONT' }).first().click();
    // (the line was agreed with the customer: its sheet opens its editor by «Изменить»)
    // v0.99 (audit З11): back to a draft only by a second tap that says so.
    const edit = page.locator('[data-line-edit]');
    if (await edit.isVisible().catch(() => false)) {
      await edit.click();
      // (the tap guard drops a second tap within 0.35 s on what changed under the finger)
      await page.waitForTimeout(450);
      await edit.click();
    }
    await page.locator('[data-offer-wa]').first().waitFor({ timeout: 10000 });
    await page.locator('[data-offer-wa]').first().scrollIntoViewIfNeeded();
    await settle(400);
    await shot('phone-07-line-offers');
    check((await page.locator('[data-offer-wa]').count()) === 2, 'the line sheet shows the two offers read from WhatsApp');
    await page.keyboard.press('Escape');
    await ctx.close();

    // 6. A PC: the settings, the suppliers with their answers.
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
    await desk.addInitScript(() => localStorage.getItem('mygarage.feedback') ?? localStorage.setItem('mygarage.feedback', '0'));
    const p = await desk.newPage();
    watch(p);
    await p.goto(BASE + '#/');
    await p.waitForTimeout(700);
    await p.evaluate(async () => (await import('/src/services/demo.ts')).loadDemoData());
    await playServer(p);
    await p.goto(BASE + '#/settings');
    await p.goto(BASE + '#/whatsapp/auto');
    await p.locator('[data-wa-target="work"]').waitFor();
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${OUT}/pc-01-auto.png` });
    check(await p.evaluate(() => document.querySelector('.wa-auto').getBoundingClientRect().width <= 770), 'PC: the settings are a readable column');
    await desk.close();
  } catch (e) {
    await current?.screenshot({ path: `${OUT}/failed.png` }).catch(() => undefined);
    throw e;
  } finally {
    await browser.close();
  }
  if (errors.length) {
    console.error(errors.join('\n'));
    throw new Error(`wa-auto e2e: ${errors.length} error(s) in the page`);
  }
  console.log('WA AUTO E2E OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
