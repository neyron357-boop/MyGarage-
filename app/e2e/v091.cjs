const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/*
 * v0.91, as the owner sees it (phone 390×844 with the iPhone's tap labels over the controls, PC 1440×900); the garage's
 * server and the AI are played in the page — every name, number and message is made up, nothing reaches WhatsApp:
 * - the chats studied: the AI going through them (its line in the list), a supplier's makes by its chat, a chat only in
 *   WhatsApp said «supplier» by the AI; the chat's card — how it answers, its stars;
 * - «Выбрать» → «Марка»: Toyota to two chats at once (a supplier of the base — on its card; a chat — on its record);
 * - «Поставщики» of a Toyota job: the fast one first («Toyota · ответил 4»), the WhatsApp pictures, every supplier (the list
 *   longer than a screen), the search finds the one only in WhatsApp (#74); «Отправить» works at once, the rows under it
 *   (#75) — and the one only in WhatsApp becomes a supplier of the base;
 * - the PC's tabs dragged along the strip, Ctrl+Shift+→ (#29);
 * - v0.91.1: each chat read deep the first time; «История с телефона» in WhatsApp's settings — the phone asked, what it
 *   sends read (three older requests of the fast supplier).
 * Screenshots — test-results/v091/.
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/v091.cjs (BASE_URL to aim elsewhere).
 */
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = path.join(__dirname, '..', 'test-results', 'v091');
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

/** The garage's server and the AI, in the page: WhatsApp linked, a few chats with made-up talk. */
async function playServer(page) {
  await page.evaluate(async () => {
    const { setWaTransport, refreshWa } = await import('/src/services/whatsapp.ts');
    const { setAiTransport } = await import('/src/services/ai.ts');
    const { SyncError } = await import('/src/services/sync/api.ts');
    const MIN = 60_000;
    const DAY = 24 * 60 * MIN;
    const T0 = Date.now() - 20 * DAY;
    const chat = (id, name, phone, over = {}) => ({ id, name, group: false, phone, unread: 0, t: Date.now() - DAY, archived: false, pinned: false, muted: false, self: false, last: null, ...over });
    const FAST = chat('971501110001@c.us', 'Fast Toyota Parts', '971501110001');
    const SILENT = chat('971501110002@c.us', 'Silent Spares', '971501110002');
    const DESERT = chat('971501110003@c.us', 'Desert Auto Spare Parts', '971501110003', { last: { id: 'x', t: Date.now() - DAY, me: false, type: 'chat', text: '280', ack: 0 } });
    const OMAR = chat('971501110004@c.us', 'Omar', '971501110004');
    const TEAM = chat('120363000000000009@g.us', 'Garage team', '', { group: true });
    const msg = (c, min, me, text) => ({ id: `${me}_${c.id}_${min}`, chat: c.id, t: T0 + min * MIN, me, type: 'chat', text, ack: 3 });
    const messages = {
      [FAST.id]: [0, 1, 2, 3].flatMap((d) => [msg(FAST, d * 1440, true, '*Toyota Camry 2018*\n1. FRONT BUMPER'), msg(FAST, d * 1440 + 10, false, 'org 950 dup 400')]),
      [SILENT.id]: [0, 1, 2, 3].flatMap((d) => [msg(SILENT, d * 1440, true, 'Nissan Patrol 2016 gearbox mounting price?'), ...(d === 0 ? [msg(SILENT, 600, false, 'not available')] : [])]),
      [DESERT.id]: [msg(DESERT, 0, true, 'Lexus LX570 brake pads available?'), msg(DESERT, 20, false, '280')],
    };
    // What stayed on the phone (v0.91.1): WhatsApp's word per chat, and three older Toyota requests of the fast one.
    const ends = { [FAST.id]: 0, [SILENT.id]: 2, [DESERT.id]: 1 };
    const older = [-40, -39, -38].flatMap((d) => [msg(FAST, d * 1440, true, '*Toyota Prado 2016*\n1. HEADLIGHT'), msg(FAST, d * 1440 + 15, false, '650')]);
    const world = { out: [], chats: [FAST, SILENT, DESERT, OMAR, TEAM], messages, read: [], ai: [], ends, phone: {}, phoneAsked: [] };
    window.__wa = world;
    setWaTransport(async (p, init) => {
      await new Promise((r) => setTimeout(r, 120));
      if (p === 'status') return { ok: true, available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '2.3000', error: '', chats: world.chats.length, unread: 0 };
      if (p === 'chats') return { chats: world.chats, total: world.chats.length, unread: 0 };
      if (p === 'history') {
        const id = init.query.chat;
        world.read.push(id);
        return { messages: [...(world.phone[id] ?? []), ...(world.messages[id] ?? [])].map(({ id: mid, t, me, type, text }) => ({ id: mid, t, me, type, text })), more: false, end: world.ends[id] ?? null };
      }
      if (p === 'history-sync' && init.method === 'POST') {
        const id = init.body.chat;
        const end = world.ends[id];
        if (end !== 0 && end !== 2) return { asked: false, end };
        world.phoneAsked.push(id);
        const ok = id === FAST.id;
        if (ok) {
          world.ends[id] = 1;
          world.phone[id] = older;
        }
        return { asked: true, end, result: ok ? 'ok' : 'none', endNow: world.ends[id] };
      }
      if (p === 'messages') {
        if (init.query.lite === '1') world.read.push(init.query.chat);
        return { messages: world.messages[init.query.chat] ?? [], more: false };
      }
      if (p === 'outbox' && init.method === 'POST') {
        for (const x of init.body.items) if (!world.out.some((o) => o.key === x.key)) world.out.push(x);
        return { ok: true, items: init.body.items.map((x) => ({ key: x.key, state: 'queued', at: Date.now(), title: x.title })) };
      }
      if (p === 'outbox') return { ok: true, items: [], queued: 0, failed: 0, sent: 0 };
      throw new SyncError(404, 'not found');
    });
    setAiTransport(async (p, body) => {
      if (p !== 'roles') throw new Error('not played');
      world.ai.push(...body.chats.map((c) => c.id));
      return { chats: body.chats.map((c) => ({ id: c.id, role: c.id === world.chats[3].id ? 'customer' : 'supplier', makes: c.id === DESERT.id ? ['Lexus'] : [], confidence: 0.9 })) };
    });
    // A server answered: WhatsApp ready (the app's own start studies the chats only 20 s later — the scenario starts it).
    localStorage.setItem('mygarage.chatStudy.at', String(Date.now()));
    await refreshWa();
  });
}

(async () => {
  const browser = await launch();
  const errors = [];
  const check = (ok, what) => {
    if (!ok) throw new Error('v0.91 e2e: ' + what);
    console.log('ok', what);
  };
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  };

  /* ---------- The phone ---------- */
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await phoneCtx.addInitScript(() => {
    localStorage.setItem('mygarage.feedback', '0');
    // The iPhone's tap labels over the controls (ui/haptics.ts) — the owner's note #75 is about them.
    localStorage.setItem('mygarage.hapticLabels', '1');
  });
  const page = await phoneCtx.newPage();
  watch(page);
  const top = (sel) => page.locator(`.screen[data-role="top"] ${sel}`);
  const settle = (ms = 500) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
  await page.goto(BASE + '#/');
  await settle(1500);

  // The base: two suppliers with these numbers (no makes on their cards) and twenty more, a customer, a Toyota job.
  const jobId = await page.evaluate(async () => {
    const { saveSupplier } = await import('/src/services/parts.ts');
    const { createCustomer } = await import('/src/services/customers.ts');
    const { checkIn } = await import('/src/services/orders.ts');
    const { addItem } = await import('/src/services/estimate.ts');
    await saveSupplier({ name: 'Fast Toyota Parts', phone: '+971501110001' });
    await saveSupplier({ name: 'Silent Spares', phone: '+971501110002' });
    for (let k = 0; k < 20; k++) await saveSupplier({ name: `Al Test Spares ${String(k + 1).padStart(2, '0')}`, phone: `+97150222${String(k).padStart(4, '0')}` });
    await createCustomer({ name: 'Omar', phone: '+971501110004', type: 'individual', preferredChannel: 'whatsapp', docLanguage: 'en' });
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'T', number: String(30000 + Math.floor(Math.random() * 9000)) }, make: 'Toyota', model: 'Camry', name: 'Sam Test', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BUMPER', qty: 1 });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'HEADLIGHT LEFT', qty: 1 });
    return o.id;
  });
  await playServer(page);

  // 1. The AI going through the chats: its line in the list, then what each chat taught.
  await page.goto(BASE + '#/whatsapp');
  await top('[data-wa-chat]').first().waitFor({ timeout: 15000 });
  const study = page.evaluate(async () => (await import('/src/services/chatStudy.ts')).studyChats());
  await top('[data-wa-study]').waitFor({ timeout: 8000 });
  check((await top('[data-wa-study]').innerText()).includes('ИИ изучает чаты'), 'the list says the AI is going through the chats');
  await shot('phone-01-studying');
  const swept = await study;
  const world = await page.evaluate(() => ({ read: window.__wa.read, ai: window.__wa.ai }));
  check(swept.studied === 3 && world.read.length === 3 && !world.read.includes('971501110004@c.us'), 'the suppliers and the unknown chat read deep (light), not the customer nor the group: ' + JSON.stringify(world.read));
  check(world.ai.includes('971501110003@c.us'), 'the chat nobody knows shown to the AI');
  await page.locator('[data-wa-tab="suppliers"]').click();
  await top('[data-wa-chat="971501110003@c.us"]').waitFor();
  const fastMakes = await top('.list-row:has([data-wa-chat="971501110001@c.us"]) [data-wa-makes]').innerText();
  check(fastMakes.includes('Toyota'), 'a supplier of the base: Toyota — what it answered for, read off its chat');
  check(await top('.list-row:has([data-wa-chat="971501110003@c.us"]) [data-wa-makes]').isVisible(), 'the chat only in WhatsApp: «supplier» and Lexus, said by the AI');
  await settle(400);
  await shot('phone-02-suppliers-makes');

  // 2. «Выбрать» → «Марка»: Toyota to Silent Spares (of the base) and Desert (only a chat).
  await top('[data-wa-pick]').click();
  await settle(300);
  await top('.list-row:has([data-wa-chat="971501110002@c.us"])').click();
  await settle(450);
  await top('.list-row:has([data-wa-chat="971501110003@c.us"])').click();
  await settle(300);
  await page.locator('[data-wa-make-picked]').click();
  const makeSheet = page.locator('.mantine-Modal-content').filter({ has: page.locator('[data-wa-make-list]') });
  await makeSheet.waitFor();
  await makeSheet.locator('[data-wa-make="Toyota"]').click();
  await makeSheet.locator('[data-wa-make="Toyota"][aria-pressed="true"]').waitFor();
  await shot('phone-03-make-sheet');
  await makeSheet.locator('[data-wa-make-save]').click();
  await makeSheet.waitFor({ state: 'detached' });
  const after = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    return { silent: (await db.suppliers.toArray()).find((s) => s.name === 'Silent Spares')?.makes, desert: (await db.chatFacts.get('971501110003@c.us'))?.makes };
  });
  check(JSON.stringify(after.silent) === '["Toyota"]' && JSON.stringify(after.desert) === '["Toyota"]', '«Марка»: Toyota on the supplier’s card and on the chat’s record: ' + JSON.stringify(after));

  // 3. The chat's card: how it answers.
  await top('.list-row:has([data-wa-chat="971501110001@c.us"])').click();
  await page.locator('[data-wa-head]').first().click();
  const card = page.locator('[data-wa-know]');
  await card.waitFor();
  const cardText = await card.innerText();
  check(/Заявок 4/.test(cardText) && /ответил 4/.test(cardText) && /с ценой 4/.test(cardText) && /Toyota/.test(cardText), 'the chat’s card: asked 4, answered 4, with a price 4, Toyota: ' + cardText.replace(/\n/g, ' '));
  check(await card.locator('.stars-pill[data-auto]').isVisible(), 'the chat’s card: the stars its answers earned');
  await settle(700);
  await shot('phone-04-chat-card');
  await page.keyboard.press('Escape');
  await settle(400);

  // v0.91.1: «История с телефона» — two chats have more there; the phone answers for one, its older requests are counted.
  await page.goto(BASE + '#/whatsapp/setup');
  await top('[data-wa-history-left]').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('.screen[data-role="top"] [data-wa-history-left]')?.textContent?.trim() === '2', null, { timeout: 8000 });
  await top('[data-wa-history-ask]').scrollIntoViewIfNeeded();
  await shot('phone-04b-phone-history');
  await top('[data-wa-history-ask]').click();
  await page.locator('.mantine-Notification-root', { hasText: 'С телефона пришло' }).waitFor({ timeout: 20000 });
  const after91 = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    return { asked: window.__wa.phoneAsked, fast: (await db.chatFacts.get('971501110001@c.us'))?.turns?.length };
  });
  check(after91.asked.length === 2 && after91.fast === 7, 'v0.91.1: the phone asked for the two chats with more there; the fast one’s three older requests read: ' + JSON.stringify(after91));
  await page.waitForFunction(() => document.querySelector('.screen[data-role="top"] [data-wa-history-left]')?.textContent?.trim() === '1', null, { timeout: 8000 });
  await shot('phone-04c-phone-history-done');
  await settle(400);

  // 4. «Поставщики» of the Toyota job.
  await page.goto(BASE + `#/orders/${jobId}`);
  await top('button.add-extra[aria-label="Поставщики"]').waitFor({ timeout: 15000 });
  await settle(600);
  await top('button.add-extra[aria-label="Поставщики"]').click();
  const ask = page.locator('.mantine-Modal-content.ask-sheet');
  await ask.locator('[data-ask-supplier]').first().waitFor();
  await settle(500);
  const first = await ask.locator('[data-ask-supplier]').first().innerText();
  check(first.includes('Fast Toyota Parts') && /Toyota · ответил 7/.test(first), 'the fast one first, «Toyota · ответил 7» (four read here, three from the phone): ' + first.replace(/\n/g, ' '));
  const rows = await ask.locator('[data-ask-supplier]').count();
  check(rows > 12, `every supplier, not twelve (#74): ${rows} rows`);
  check((await ask.locator('.ask-row .wa-avatar').count()) >= 10, 'the WhatsApp picture by each supplier with a number');
  const silentAt = await ask.locator('[data-ask-supplier]').allInnerTexts();
  check(silentAt.findIndex((x) => x.includes('Silent Spares')) > 0, 'Silent Spares after the fast one');
  await shot('phone-05-ask-sheet');
  // The search goes through all of them: the one only in WhatsApp, by its name.
  await ask.locator('.search-field input').fill('desert');
  await ask.locator('[data-ask-chat-only]').waitFor();
  await ask.locator('[data-ask-chat-only]').click();
  await ask.locator('[data-ask-chat-only][aria-pressed="true"]').waitFor();
  await ask.locator('.search-field input').fill('');
  await settle(500);
  // #75: «Отправить» with rows scrolled under it — the finger lands on the button, not on a row.
  const send = ask.locator('[data-ask-send]');
  const box = await send.boundingBox();
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return { send: !!el?.closest('[data-ask-send]'), row: !!el?.closest('[data-ask-supplier]') };
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  check(hit.send && !hit.row, '#75: the finger on «Отправить» lands on it, not on a row under it: ' + JSON.stringify(hit));
  await shot('phone-06-ask-picked');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await ask.waitFor({ state: 'detached', timeout: 8000 });
  // Seen first (v0.85): «Проверить и отправить» — the person's «Отправить».
  const confirmSheet = page.locator('[data-wa-confirm]');
  await confirmSheet.waitFor({ timeout: 8000 });
  await settle(400);
  await shot('phone-07-confirm');
  const all = confirmSheet.getByRole('button', { name: /^Отправить все/ });
  if (await all.isVisible().catch(() => false)) await all.click();
  else await confirmSheet.locator('.wa-ask').first().getByRole('button', { name: /^Отправить$/ }).click();
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.__wa.out.length)); i++) await settle(200);
  const sent = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const made = (await db.suppliers.toArray()).find((s) => s.phone === '+971501110003');
    return { out: window.__wa.out.map((x) => x.key), made: made?.name, makes: made?.makes };
  });
  check(sent.out.some((k) => k.startsWith('ask:')), '«Отправить» tapped at once: the request handed to the server');
  check(sent.made === 'Desert Auto Spare Parts' && JSON.stringify(sent.makes) === '["Toyota"]', 'the one only in WhatsApp is a supplier of the base now, with its makes: ' + JSON.stringify(sent));
  await phoneCtx.close();

  /* ---------- The PC: the tabs ---------- */
  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await deskCtx.addInitScript(() => localStorage.setItem('mygarage.feedback', '0'));
  const desk = await deskCtx.newPage();
  watch(desk);
  await desk.goto(BASE + '#/');
  await desk.waitForTimeout(1500);
  await desk.evaluate(async () => {
    const { openTab, focusTab, MAIN_TAB } = await import('/src/ui/deskTabs.ts');
    openTab('/customers', { front: false });
    openTab('/parts', { front: false });
    focusTab(MAIN_TAB);
  });
  const chips = desk.locator('[data-tab-chip]');
  await chips.nth(2).waitFor();
  const order = () => desk.evaluate(async () => (await import('/src/ui/deskTabs.ts')).deskTabs().tabs.map((t) => t.path));
  const was = await order();
  // The last tab dragged over the first.
  const a = await chips.nth(2).boundingBox();
  const b = await chips.nth(0).boundingBox();
  await desk.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await desk.mouse.down();
  for (let k = 1; k <= 12; k++) await desk.mouse.move(a.x + a.width / 2 + ((b.x + 10 - (a.x + a.width / 2)) * k) / 12, a.y + a.height / 2);
  await desk.screenshot({ path: `${OUT}/desk-01-tab-dragged.png` });
  await desk.mouse.up();
  await desk.waitForTimeout(400);
  const now = await order();
  check(now[0] === was[2] && now.length === 3, `#29: the tab dragged first: ${was.join(' ')} → ${now.join(' ')}`);
  // Ctrl+Shift+→ on it: one place right.
  await chips.nth(0).focus();
  await desk.keyboard.press('Control+Shift+ArrowRight');
  await desk.waitForTimeout(300);
  const moved = await order();
  check(moved[1] === was[2], '#29: Ctrl+Shift+→ moves it one place right');
  await desk.screenshot({ path: `${OUT}/desk-02-tabs.png` });
  await deskCtx.close();

  await browser.close();
  if (errors.length) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('v0.91 e2e: all ok; ERRORS: none');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
