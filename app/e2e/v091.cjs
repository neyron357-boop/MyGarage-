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
 *   sends read (three older requests of the fast supplier); v0.91.3 — the server fetches it by itself: its state shown
 *   («не разрешил этому устройству»), «Загрузить сейчас», the chat it brought read again by the app on the server's word.
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
    const historyState = { more: 2, noAccess: 1, chats: 5, came: 0, asks: 3, phone: 'noAccess', okAt: 0, passAt: Date.now() - 600_000, running: false, done: 0, total: 0 };
    const world = { out: [], chats: [FAST, SILENT, DESERT, OMAR, TEAM], messages, read: [], ai: [], ends, phone: {}, phoneAsked: [], historyState };
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
      // v0.91.3: the server fetching the older messages by itself — its state, and a pass now.
      if (p === 'history-state') return world.historyState;
      if (p === 'history-run' && init.method === 'POST') {
        world.ran = (world.ran ?? 0) + 1;
        world.historyState = { ...world.historyState, running: true, done: 0, total: 2 };
        // The phone answers for the fast supplier: its older requests come, the devices are told.
        setTimeout(async () => {
          const { waSaid } = await import('/src/services/whatsapp.ts');
          world.ends[FAST.id] = 1;
          world.phone[FAST.id] = older;
          waSaid({ t: 'history', chat: FAST.id });
          world.historyState = { ...world.historyState, running: false, more: 1, came: 1, phone: 'gives', done: 0, total: 0 };
          waSaid({ t: 'historyState', state: world.historyState });
        }, 1500);
        return world.historyState;
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

  // v0.91.6: the main supplier (the fast one, by its work) — first in the list, pinned by the app; «Закрепить» — Desert too.
  await top('[data-wa-chat]').first().waitFor();
  const firstRow = await top('.list-row').first().innerText();
  check(firstRow.includes('Fast Toyota Parts') && (await top('.list-row').first().locator('[data-wa-top]').count()) === 1, 'v0.91.6: the main supplier first, pinned by the app: ' + firstRow.split('\n')[0]);
  await top('[data-wa-pick]').click();
  await settle(300);
  await top('.list-row:has([data-wa-chat="971501110003@c.us"])').click();
  await settle(300);
  await page.locator('[data-wa-pin-picked]').click();
  await page.waitForFunction(() => document.querySelectorAll('.screen[data-role="top"] [data-wa-top]').length === 2, null, { timeout: 8000 });
  const pinnedOrder = await top('[data-wa-chat]').evaluateAll((els) => els.slice(0, 2).map((e) => e.getAttribute('data-wa-chat')));
  check(pinnedOrder.includes('971501110003@c.us') && pinnedOrder.includes('971501110001@c.us'), 'v0.91.6: «Закрепить» — Desert pinned on top too: ' + JSON.stringify(pinnedOrder));
  await settle(400);
  await shot('phone-03b-main-suppliers');

  // 3. The chat's card: how it answers.
  await top('.list-row:has([data-wa-chat="971501110001@c.us"])').click();
  await page.locator('[data-wa-head]').first().click();
  const card = page.locator('[data-wa-know]');
  await card.waitFor();
  const cardText = await card.innerText();
  check(/Заявок 4/.test(cardText) && /ответил 4/.test(cardText) && /с ценой 4/.test(cardText) && /Toyota/.test(cardText), 'the chat’s card: asked 4, answered 4, with a price 4, Toyota: ' + cardText.replace(/\n/g, ' '));
  check(await card.locator('.stars-pill[data-auto]').isVisible(), 'the chat’s card: the stars its answers earned');
  // v0.91.6: main, and what it is by its history — Toyota, body parts, original and copy, since when.
  check(await card.locator('[data-wa-top-badge]').isVisible(), 'v0.91.6: the chat’s card — «Главный поставщик»');
  const profile = await card.locator('.wa-profile').innerText();
  check(/Toyota 100 %/.test(profile) && /Кузов 100 %/.test(profile) && /оригинал 50 %/.test(profile) && /копия 50 %/.test(profile) && /с \d\d\/\d{4}/.test(profile), 'v0.91.6: its profile — makes, parts, what it offers, since when: ' + profile.replace(/\n/g, ' '));
  await settle(700);
  await shot('phone-04-chat-card');
  await page.keyboard.press('Escape');
  await settle(400);

  // v0.91.3: «История с телефона» — the server fetches it by itself: what the phone says, «Загрузить сейчас», the chat it
  // brought read again by the app on the server's word.
  await page.goto(BASE + '#/whatsapp/setup');
  await top('[data-wa-history-left]').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('.screen[data-role="top"] [data-wa-history-left]')?.textContent?.trim() === '2', null, { timeout: 8000 });
  check((await top('[data-wa-history-phone]').innerText()).includes('не отдаёт этому устройству'), 'v0.91.3: the server’s word — the phone has not allowed this device');
  await top('[data-wa-history-ask]').scrollIntoViewIfNeeded();
  await shot('phone-04b-phone-history');
  await top('[data-wa-history-ask]').click();
  await page.waitForFunction(() => document.querySelector('.screen[data-role="top"] [data-wa-history-phone]')?.getAttribute('data-wa-history-phone') === 'gives', null, { timeout: 15000 });
  let fast91 = 0;
  for (let i = 0; i < 60 && fast91 !== 7; i++) {
    await settle(500);
    fast91 = await page.evaluate(async () => (await (await import('/src/db/db.ts')).db.chatFacts.get('971501110001@c.us'))?.turns?.length ?? 0);
  }
  const ran = await page.evaluate(() => window.__wa.ran);
  check(ran === 1 && fast91 === 7, 'v0.91.3: «Загрузить сейчас» — the server’s pass; the chat it brought read again by the app (7 requests): ' + JSON.stringify({ ran, fast91 }));
  check((await top('[data-wa-history-left]').innerText()).trim() === '1', 'v0.91.3: one chat left with more on the phone');
  await shot('phone-04c-phone-history-done');

  // v0.91.5: «Экспорт чатов» — the fast supplier's whole chat exported from the phone (made up), read and counted.
  const exported = [
    '[12/03/2025, 09:14:05] Rukn Garage: *Toyota Camry 2018*',
    '1. FRONT BUMPER',
    '[12/03/2025, 09:30:41] Fast Toyota Parts: org 950 dup 400',
    '[20/03/2025, 10:00:00] Rukn Garage: Toyota Hilux 2020 shock absorber?',
    '[20/03/2025, 10:05:00] Fast Toyota Parts: 350',
  ].join('\n');
  await top('[data-wa-export-input]').setInputFiles([{ name: 'WhatsApp Chat - Fast Toyota Parts.txt', mimeType: 'text/plain', buffer: Buffer.from(exported) }]);
  const exportSheet = page.locator('.mantine-Modal-content').filter({ has: page.locator('[data-wa-export-learn]') });
  await exportSheet.locator('[data-wa-export-row="0"][data-ready]').waitFor({ timeout: 10000 });
  check((await exportSheet.locator('[data-wa-export-garage="Rukn Garage"][aria-pressed="true"]').count()) === 1, 'v0.91.5: the export read — its chat found by name, the garage’s side found');
  await settle(400);
  await shot('phone-04d-export');
  await exportSheet.locator('[data-wa-export-learn]').click();
  await page.locator('.mantine-Notification-root', { hasText: 'Учтено чатов: 1' }).waitFor({ timeout: 10000 });
  const fastAfter = await page.evaluate(async () => (await (await import('/src/db/db.ts')).db.chatFacts.get('971501110001@c.us')) ?? {});
  check(fastAfter.turns?.length === 9 && !!fastAfter.exportAt && !JSON.stringify(fastAfter).includes('BUMPER'), 'v0.91.5: two older requests of the export counted (9), its words not kept: ' + fastAfter.turns?.length);
  await settle(500);
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
  check(first.includes('Fast Toyota Parts') && /Toyota · ответил 9/.test(first), 'the fast one first, «Toyota · ответил 9» (four read here, three from the phone, two from its export): ' + first.replace(/\n/g, ' '));
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
