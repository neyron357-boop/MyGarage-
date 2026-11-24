const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
/*
 * The garage's WhatsApp in the app (v0.78), with the garage's server played in the page (services/whatsapp
 * `setWaTransport`): no server, no WhatsApp and nobody's chats are touched — every name, number and message here is made
 * up. A phone: what stands in the way → linking by a code → the chats (whose chat, tabs, a search) → a chat (a text
 * sent, a file sent, a message coming in, an answer) → a chat's card → a new chat → the customer's chat from a job →
 * an estimate sent from the app with its PDF. A PC: the chats and the chat side by side, a message's menu.
 * Screenshots (light and dark) go to test-results/whatsapp.
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/whatsapp.cjs [outDir]
 */
const OUT = process.argv[2] || path.join(__dirname, '..', 'test-results', 'whatsapp');
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
fs.mkdirSync(OUT, { recursive: true });

async function launchBrowser() {
  const forced = process.env.E2E_BROWSER;
  const channels = forced ? [forced] : ['chromium', 'chrome', 'msedge'];
  for (const channel of channels) {
    try {
      return await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), args: ['--enable-unsafe-swiftshader'] });
    } catch {
      // try the next one
    }
  }
  throw new Error('no browser: run "npx playwright install chromium" or install Google Chrome / Microsoft Edge');
}

/** In the page: the server's part. `phase` — where WhatsApp stands when the page first asks. */
async function playServer(page, phase) {
  await page.evaluate(async (phase) => {
    const { setWaTransport } = await import('/src/services/whatsapp.ts');
    const { db } = await import('/src/db/db.ts');
    const { waDigits } = await import('/src/domain/whatsapp.ts');
    // A picture drawn here: its bytes are «the file», a small copy of it «the preview WhatsApp sends».
    const draw = (w, h, label, hue) => {
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, `hsl(${hue} 60% 46%)`);
      grad.addColorStop(1, `hsl(${hue + 40} 70% 28%)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.92)';
      g.font = `bold ${Math.round(h / 7)}px system-ui`;
      g.fillText(label, w * 0.08, h * 0.56);
      return c;
    };
    const dataUrl = (c, q = 0.8) => c.toDataURL('image/jpeg', q);
    const photo = draw(960, 720, 'BRAKE PADS', 205);
    const small = draw(48, 36, '', 205);
    const files = { photo1: dataUrl(photo), };
    const avatars = {};

    // (The demo's people come in no order: the same ones each run — by name; a customer who is written to on WhatsApp.)
    const customers = (await db.customers.toArray()).filter((c) => waDigits(c.whatsapp || c.phone) && c.preferredChannel !== 'telegram').sort((a, b) => a.name.localeCompare(b.name));
    const suppliers = (await db.suppliers.toArray()).filter((s) => waDigits(s.phone)).sort((a, b) => a.name.localeCompare(b.name));
    const cust = customers[0];
    const cust2 = customers[1];
    const sup = suppliers[0];
    const ME = '971500000001';
    const now = Date.now();
    const min = 60_000;
    // WhatsApp keeps a person's chat under an id that hides the number (@lid): the server finds the number.
    const lid = (n) => `5551234567${String(n).padStart(4, '0')}@lid`;
    const chat = (id, name, phone, over = {}) => ({ id, name, group: false, phone, unread: 0, t: now, archived: false, pinned: false, muted: false, self: false, last: null, ...over });
    const A = lid(1);
    const B = lid(2);
    const S = lid(3);
    const U = lid(4);
    const G = '120363000000000001@g.us';
    const SELF = lid(9);
    avatars[A] = dataUrl(draw(96, 96, 'A', 20));
    avatars[G] = dataUrl(draw(96, 96, 'MG', 150));
    let n = 0;
    const msg = (chatId, over) => ({ id: `${over.me ? 'true' : 'false'}_${chatId}_M${++n}`, chat: chatId, t: now - 30 * min, me: false, type: 'chat', text: '', ack: 0, ...over });
    const messages = {
      [A]: [
        msg(A, { t: now - 26 * 60 * min, me: true, text: '*Toyota Camry 2019*\nBrake pads front — 450 AED\nOil service — 280 AED\n\nTotal: 730 AED (VAT included)', ack: 3 }),
        msg(A, { t: now - 26 * 60 * min + 2 * min, me: true, type: 'document', text: '', ack: 3, file: { mime: 'application/pdf', name: 'QUO-2026-351.pdf', size: 84_200, here: true } }),
        msg(A, { t: now - 25 * 60 * min, text: 'Ok, how long will it take?' }),
        msg(A, { t: now - 25 * 60 * min + min, me: true, text: 'Ready tomorrow by 5 pm', ack: 3 }),
        msg(A, { t: now - 50 * min, type: 'image', text: 'This noise is from here', file: { mime: 'image/jpeg', size: 182_000, w: 960, h: 720, thumb: dataUrl(small, 0.5).split(',')[1], here: true }, fileKey: 'photo1' }),
        msg(A, { t: now - 48 * min, type: 'ptt', file: { mime: 'audio/ogg', sec: 14, here: true } }),
        msg(A, { t: now - 20 * min, text: 'Yes, do the brakes. Skip the oil for now', quote: { id: 'q1', type: 'chat', text: 'Brake pads front — 450 AED', me: true } }),
        msg(A, { t: now - 19 * min, me: true, text: 'Done. See https://maps.app.goo.gl/garage for the location.', ack: 2 }),
      ],
      [S]: [
        msg(S, { t: now - 3 * 60 * min, me: true, text: '*Toyota Camry 2019*\nVIN: 4T1B11HK5KU123456\n1. BRAKE PADS FRONT (04465-33471)\n\nPrice and availability, please: original / aftermarket?', ack: 3 }),
        msg(S, { t: now - 170 * min, text: 'Original 380, aftermarket 210. Available today' }),
      ],
      [G]: [
        msg(G, { t: now - 90 * min, text: 'Camry is on the lift', from: { id: '971559990000@c.us', name: 'Rashid', phone: '971559990000' } }),
        msg(G, { t: now - 85 * min, text: 'Pads are worn to metal', from: { id: '971559990000@c.us', name: 'Rashid', phone: '971559990000' } }),
        msg(G, { t: now - 80 * min, me: true, text: 'Ok, asking the customer', ack: 3 }),
        msg(G, { t: now - 70 * min, type: 'location', text: 'Al Quoz Industrial 3', place: { lat: 25.13, lng: 55.23 }, from: { id: '971551112233@c.us', name: 'Imran', phone: '971551112233' } }),
      ],
      [U]: [msg(U, { t: now - 5 * min, text: 'Hello, do you repair gearboxes?' }), msg(U, { t: now - 4 * min, type: 'vcard', card: { name: 'Gearbox shop', phone: '971507770000' } })],
      [B]: [msg(B, { t: now - 2 * 24 * 60 * min, me: true, text: 'Your car is ready', ack: 3 }), msg(B, { t: now - 2 * 24 * 60 * min + 5 * min, type: 'revoked' })],
      [SELF]: [msg(SELF, { t: now - 6 * 60 * min, me: true, text: 'Buy paper for the printer', ack: 3 })],
    };
    for (const list of Object.values(messages)) for (const m of list) if (m.fileKey) files[m.id] = files[m.fileKey];
    const lastOf = (id) => {
      const m = messages[id].at(-1);
      return { id: m.id, t: m.t, me: m.me, type: m.type, text: m.text, ack: m.ack, name: m.file?.name, sec: m.file?.sec, from: m.from?.name };
    };
    const chats = [
      chat(A, cust?.name || 'Customer', waDigits(cust?.whatsapp || cust?.phone), { unread: 2, pinned: true }),
      chat(U, '+971 52 444 0000', '971524440000', { unread: 1 }),
      chat(G, 'Garage team', '', { group: true }),
      chat(S, 'Parts seller', waDigits(sup?.phone)),
      chat(SELF, 'You', ME, { self: true }),
      chat(B, 'B wa', waDigits(cust2?.whatsapp || cust2?.phone)),
      chat(lid(7), 'Old muted chat', '971509090909', { muted: true, unread: 5, t: now - 9 * 24 * 60 * min }),
      chat(lid(8), 'Archived one', '971508080808', { archived: true, t: now - 30 * 24 * 60 * min }),
    ].map((c) => (messages[c.id] ? { ...c, t: messages[c.id].at(-1).t, last: lastOf(c.id) } : c));

    const state = { phase, linked: phase === 'ready', qr: '', qrAt: 0, code: '', loading: 0, me: phase === 'ready' ? { id: `${ME}@c.us`, phone: ME, name: 'Garage' } : null, platform: 'smbi', web: '2.3000.1055910951', error: '', chats: chats.length, unread: 3 };
    const status = () => ({ ok: true, available: true, installed: true, browser: true, on: state.phase !== 'off', ...state });
    const world = { state, chats, messages, asked: [], files, fail: null };
    window.__wa = world;
    const { SyncError } = await import('/src/services/sync/api.ts');
    const err = (status, message) => new SyncError(status, message);
    setWaTransport(
      async (path, init) => {
        world.asked.push({ path, method: init.method ?? 'GET', body: init.body, query: init.query, file: init.file ? { type: init.file.type, size: init.file.size } : undefined });
        await new Promise((r) => setTimeout(r, 120));
        if (world.fail) throw err(world.fail, 'failed');
        if (path === 'status') return status();
        if (path === 'link') {
          Object.assign(state, { phase: 'qr', qr: dataUrl(draw(360, 360, 'QR', 0)), qrAt: Date.now() });
          return status();
        }
        if (path === 'code') {
          state.code = 'ABCD1234';
          return status();
        }
        if (path === 'logout') {
          Object.assign(state, { phase: 'off', linked: false, me: null, qr: '', code: '' });
          return status();
        }
        if (path === 'restart') return status();
        if (path === 'chats') return { chats: world.chats, total: world.chats.length, unread: 3 };
        if (path === 'messages') return { messages: world.messages[init.query.chat] ?? [], more: false };
        if (path === 'seen') {
          world.chats = world.chats.map((c) => (c.id === init.body.chat ? { ...c, unread: 0 } : c));
          return { ok: true, unread: 0 };
        }
        if (path === 'number') {
          const known = world.chats.find((c) => !c.group && c.phone === init.query.phone);
          return { ok: init.query.phone !== '971500009999', chat: known?.id ?? `${init.query.phone}@c.us` };
        }
        if (path === 'send' || path === 'file') {
          const chatId = path === 'send' ? init.body.chat : init.query.chat;
          const type = path === 'send' ? 'chat' : init.query.doc ? 'document' : /^image/.test(init.file.type) ? 'image' : 'document';
          const sent = msg(chatId, { me: true, t: Date.now(), type, text: path === 'send' ? init.body.text : (init.query.caption ?? ''), ack: 1, file: path === 'file' ? { mime: init.file.type, name: init.query.name, size: init.file.size, here: true } : undefined });
          if (path === 'file' && type === 'image') files[sent.id] = URL.createObjectURL(init.file);
          (world.messages[chatId] ??= []).push(sent);
          return { ok: true, msg: sent };
        }
        throw err(404, 'not found');
      },
      (kind, id) => (kind === 'media' ? (files[id] ?? '') : (avatars[id] ?? '')),
    );
  }, phase);
}

/** What the server says on its stream. */
const say = (page, event) => page.evaluate(async (ev) => (await import('/src/services/whatsapp.ts')).waSaid(ev), event);

let current = null;
(async () => {
  const browser = await launchBrowser();
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text().slice(0, 300)));
  };
  const check = (ok, what) => {
    if (!ok) throw new Error(`whatsapp e2e: ${what}`);
    console.log('ok', what);
  };

  /* ---------------- A phone ---------------- */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false, locale: 'ru-RU' });
  await ctx.addInitScript(() => localStorage.getItem('mygarage.feedback') ?? localStorage.setItem('mygarage.feedback', '0'));
  const page = await ctx.newPage();
  current = page;
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

  await go('#/');
  await page.evaluate(async () => (await import('/src/services/demo.ts')).loadDemoData());
  await page.evaluate(async () => {
    // The garage's own number, as the settings have it: the code is asked for it.
    const { db } = await import('/src/db/db.ts');
    await db.settings.update('main', { phone: '+971500000001' });
  });
  await page.addStyleTag({ content: '.mantine-Notifications-root { animation: none !important; }' });

  // 1. No server connected: said in a line, with the way to connect one.
  await go('#/whatsapp');
  await top().getByText('Нужен сервер мастерской').waitFor();
  check(await top().locator('[data-wa-gate="server"]').isVisible(), 'without a server the screen says so');
  await shot('phone-01-no-server');

  // 2. A server, WhatsApp not linked: linked by a code typed on the phone (a phone cannot scan its own screen).
  await playServer(page, 'off');
  await go('#/more');
  await go('#/whatsapp');
  await top().locator('[data-wa-gate="link"]').click();
  await top().locator('[data-wa-link]').waitFor();
  await shot('phone-02-setup-off');
  await top().locator('[data-wa-link]').click();
  await top().locator('[data-wa-linking]').waitFor();
  check((await top().locator('[data-wa-code-phone]').inputValue()).replace(/\D/g, '') === '971500000001', "the garage's own number is offered for the code");
  await top().locator('[data-wa-code-get]').click();
  await top().locator('[data-wa-code]').waitFor();
  check((await top().locator('[data-wa-code]').innerText()).includes('ABCD-1234'), 'the code to type on the phone is shown in two halves');
  await shot('phone-03-setup-code');
  await top().getByRole('tab', { name: 'QR-код' }).click();
  await top().locator('[data-wa-qr]').waitFor();
  await shot('phone-04-setup-qr');
  // The phone has taken the code: the server says so on its stream.
  await page.evaluate(() => Object.assign(window.__wa.state, { phase: 'ready', linked: true, qr: '', code: '', me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' } }));
  await say(page, { t: 'state', state: await page.evaluate(() => ({ ok: true, available: true, installed: true, browser: true, on: true, ...window.__wa.state })) });
  await top().locator('[data-wa-state="ready"]').waitFor();
  check(await top().locator('[data-wa-unlink]').isVisible(), 'linked: the setup shows the device and how to unlink it');
  await shot('phone-05-setup-ready');

  // 3. The chats: whose they are, how many wait, the tabs, a search.
  await go('#/whatsapp');
  await top().locator('[data-wa-chat]').first().waitFor();
  const names = await top().locator('.wa-row-name').allInnerTexts();
  check(names.length === 7, `seven chats are listed, the archived one is not (${names.length})`);
  const demo = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const { waDigits } = await import('/src/domain/whatsapp.ts');
    const c = (await db.customers.toArray()).filter((x) => waDigits(x.whatsapp || x.phone) && x.preferredChannel !== 'telegram').sort((a, b) => a.name.localeCompare(b.name));
    const s = (await db.suppliers.toArray()).filter((x) => waDigits(x.phone)).sort((a, b) => a.name.localeCompare(b.name));
    return { customer: (c[0].type === 'company' && c[0].companyName) || c[0].name, customerId: c[0].id, supplier: s[0].name, supplierPhone: s[0].phone };
  });
  check(names[0] === demo.customer, `the pinned chat is first, under the garage's own name for the customer («${names[0]}»)`);
  check((await top().locator('.list-row').first().locator('.wa-who').innerText()) === 'Клиент', 'a customer’s chat is tagged');
  check((await top().locator('.list-row').first().locator('.wa-badge').innerText()) === '2', 'what waits to be read is counted on the chat');
  check(names.includes(demo.supplier), 'a supplier’s chat has the name the garage keeps');
  check(names.includes('Вы (себе)'), 'the account’s own chat is named so');
  // v0.80: WhatsApp is a tab of its own in the bar, with how many wait.
  const waTabBtn = page.locator('.tab-bar button[data-href="/whatsapp"]');
  check(await waTabBtn.isVisible(), 'v0.80: WhatsApp has its own tab in the bar');
  check(/active/.test((await waTabBtn.getAttribute('class')) ?? ''), 'v0.80: its tab is lit on its screen');
  check(Number(await waTabBtn.locator('.tab-badge').innerText()) > 0, 'v0.80: the tab says how many messages wait');
  await shot('phone-06-chats');
  await top().getByRole('tab', { name: /^Поставщики/ }).click();
  await settle(400);
  check((await top().locator('.wa-row-name').allInnerTexts()).join('|') === demo.supplier, 'the suppliers’ tab shows the supplier’s chat only');
  await top().getByRole('tab', { name: /^Новые/ }).click();
  await settle(400);
  check((await top().locator('.wa-row-name').count()) === 3, 'the unread tab: three chats');
  await top().getByRole('tab', { name: /^Все/ }).click();
  await top().locator('.search-field input').fill('archived');
  await settle(400);
  check((await top().locator('.wa-row-name').allInnerTexts()).join('|') === 'Archived one', 'a search finds an archived chat');
  await top().locator('.search-field input').fill('052 444');
  await settle(400);
  check((await top().locator('.wa-row-name').count()) === 1, 'a search by the number as it is said');
  await top().locator('.search-field input').fill('');
  await settle(300);

  // 4. A chat: both sides, a photo, a document, a voice message, an answer; read once opened.
  await top().locator('[data-wa-chat]').first().click();
  await top().locator('[data-wa-list]').waitFor();
  await settle(900);
  check((await top().locator('.note-row').count()) === 8, 'the chat shows its eight messages');
  check((await top().locator('.note-row[data-in]').count()) === 4, 'four of them are the customer’s, on the left');
  check((await top().locator('.wa-pic-full[data-shown]').count()) === 1, 'the photo is shown over its preview');
  check(await top().locator('.wa-doc-name', { hasText: 'QUO-2026-351.pdf' }).isVisible(), 'a document shows its name');
  check(await top().locator('.wa-sound').isVisible(), 'a voice message has its player');
  check(await top().locator('.wa-quote').isVisible(), 'an answer shows what it answers');
  check((await top().locator('.note-bubble b').first().innerText()) === 'Toyota Camry 2019', 'WhatsApp’s bold is bold');
  check(await top().locator('.note-bubble a[href="https://maps.app.goo.gl/garage"]').isVisible(), 'a link is a link');
  check(await page.evaluate(() => window.__wa.asked.some((a) => a.path === 'seen')), 'opened, the chat is marked read on WhatsApp');
  await shot('phone-07-chat');
  // v0.80: «＋» of a customer's chat — what can be done for them at once (a file, a new job, their card, their jobs).
  await top().locator('[data-wa-plus]').click();
  await page.locator('[data-wa-quick]').waitFor();
  await page.locator('[data-wa-quick-act="newJob"]').waitFor();
  await settle(500);
  check(await page.locator('[data-wa-quick-act="files"]').isVisible(), 'v0.80: «＋» of a customer’s chat keeps photos and files');
  check(await page.locator('[data-wa-quick-act="customer"]').isVisible(), 'v0.80: … and offers the customer’s card and a new job for them');
  await shot('phone-07b-chat-quick');
  await page.locator('[data-wa-quick-act="newJob"]').click();
  await settle(900);
  check(page.url().includes(`/orders/new?customerId=${demo.customerId}`), 'v0.80: «Новый заказ» from the chat opens a new job for this customer');
  await page.goBack();
  await top().locator('[data-wa-list]').waitFor();
  await settle(600);

  // A text: in the chat at once, then with its tick.
  await top().locator('[data-wa-field]').fill('Car is ready, you can come');
  await top().locator('[data-wa-send]').click();
  await top().locator('.note-row', { hasText: 'Car is ready, you can come' }).waitFor();
  await settle(500);
  check((await top().locator('.note-row').count()) === 9, 'the sent text is the ninth message — once');
  check((await top().locator('.note-row').last().locator('.wa-ticks').getAttribute('data-state')) === 'sent', 'it has one tick');
  check((await top().locator('[data-wa-field]').inputValue()) === '', 'the field is empty again');
  // Its ticks, as WhatsApp says them.
  const A = await page.evaluate(() => window.__wa.chats[0].id);
  const sentId = await page.evaluate((id) => window.__wa.messages[id].at(-1).id, A);
  await say(page, { t: 'ack', chat: A, id: sentId, ack: 3 });
  await settle(200);
  check((await top().locator('.note-row').last().locator('.wa-ticks').getAttribute('data-state')) === 'read', 'read: two blue ticks');

  // A file: shown before it goes, then sent with its caption.
  await top().locator('[data-wa-file]').setInputFiles({ name: 'INV-2026-351.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await page.locator('[data-wa-files]').waitFor();
  await page.locator('[data-wa-files] textarea').fill('Invoice');
  await settle(400);
  await shot('phone-08-files-sheet');
  await page.locator('[data-wa-files-send]').click();
  await top().locator('.wa-doc-name', { hasText: 'INV-2026-351.pdf' }).waitFor();
  check(await page.evaluate(() => window.__wa.asked.some((a) => a.path === 'file' && a.query.name === 'INV-2026-351.pdf' && a.query.caption === 'Invoice' && a.query.doc === '1')), 'the PDF went as a document with its caption');

  // A message comes in while the chat is open: it is there.
  const incoming = { id: `false_${A}_IN1`, chat: A, t: Date.now(), me: false, type: 'chat', text: 'Coming in an hour', ack: 0 };
  await say(page, { t: 'msg', msg: incoming, chat: null });
  await top().locator('.note-row[data-in]', { hasText: 'Coming in an hour' }).waitFor();
  check(true, 'a message from WhatsApp appears in the open chat');
  await settle(500);
  await shot('phone-09-chat-after');

  // A message that does not go stays, marked.
  await page.evaluate(() => (window.__wa.fail = 429));
  await top().locator('[data-wa-field]').fill('one more');
  await top().locator('[data-wa-send]').click();
  await top().locator('.note-row[data-failed]').waitFor();
  check(await page.getByText('Слишком часто — подождите минуту').first().isVisible(), 'why it did not go is said');
  await page.evaluate(() => (window.__wa.fail = null));
  await top().locator('.wa-failed').click();
  await top().locator('.note-row[data-failed]').waitFor({ state: 'detached' });
  check((await top().locator('.note-row', { hasText: 'one more' }).count()) === 1, 'tapped, it is sent again — once');

  // 5. The chat's card: who it is.
  await top().locator('[data-wa-info-btn]').click();
  await page.locator('[data-wa-info="customer"]').waitFor();
  await settle(400);
  await shot('phone-10-chat-card');
  await page.locator('[data-wa-info="customer"]').click();
  await settle(900);
  check(page.url().includes(`/customers/${demo.customerId}`), 'the card opens the customer');
  await page.goBack();
  await settle(700);

  // An unknown number: into the customers, the number filled in.
  await go('#/whatsapp');
  await top().locator('[data-wa-chat]').first().waitFor();
  await top().locator('.wa-row-name', { hasText: '+971 52 444 0000' }).click();
  await top().locator('[data-wa-list]').waitFor();
  check((await top().locator('.wa-card').innerText()).includes('Gearbox shop'), 'a contact card shows its name');
  await top().locator('[data-wa-info-btn]').click();
  await page.locator('[data-wa-info="addCustomer"]').click();
  await settle(700);
  const phoneField = page.locator('.mantine-Modal-content').last().locator('input[type="tel"], input[inputmode="tel"]').first();
  check((await phoneField.inputValue()).replace(/\D/g, '') === '971524440000', 'a new customer’s card opens with the chat’s number');
  await page.keyboard.press('Escape');
  await settle(400);
  await page.keyboard.press('Escape');
  await settle(400);

  // 6. A new chat: someone the garage knows, or a number.
  await go('#/whatsapp');
  await top().locator('[data-wa-new-btn]').click();
  await page.locator('[data-wa-new]').waitFor();
  await page.locator('[data-wa-new] .search-field input').fill(demo.supplier.slice(0, 5));
  await settle(400);
  await shot('phone-11-new-chat');
  await page.locator('[data-wa-new] .search-field input').fill('+971 50 000 9999');
  await page.locator('[data-wa-new-number]').click();
  await page.getByText('У номера нет WhatsApp').first().waitFor();
  check(true, 'a number without WhatsApp is said to have none');
  await page.locator('[data-wa-new] .search-field input').fill('050 321 0000');
  // (a tap right after an action ended is taken for the same finger's second tap: a person types a number first)
  await settle(900);
  await page.locator('[data-wa-new-number]').click();
  await top().getByText('Сообщений нет').waitFor();
  check(page.url().includes(encodeURIComponent('971503210000@c.us')), 'a number with WhatsApp opens its (empty) chat');

  // 7. From a job: «…» → «Чат» is the customer's chat.
  const jobId = await page.evaluate(async (customerId) => {
    const { db } = await import('/src/db/db.ts');
    const { checkIn } = await import('/src/services/orders.ts');
    const { addItem } = await import('/src/services/estimate.ts');
    const c = await db.customers.get(customerId);
    const o = await checkIn({ customerId, plate: { emirate: 'DXB', code: 'W', number: '78078' }, make: 'Toyota', model: 'Camry', name: c.name, phone: c.phone, docLanguage: 'en', complaint: '', arrivedNow: true });
    await addItem(o.id, { kind: 'labor', block: 'A', titleEn: 'Brake pads front', unitPriceFils: 45_000, vatRateBp: 500 });
    return o.id;
  }, demo.customerId);
  await go(`#/orders/${jobId}`, 1200);
  // v0.80: the job has the whole screen — the tab bar goes, «＋» stays (over the job's own bar at the bottom edge).
  await settle(500);
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.tab-bar')).opacity === '0'), 'v0.80: on a job the tab bar is away');
  check(await page.locator('.tab-plus').isVisible(), 'v0.80: … «＋» stays');
  const plusBox = await page.locator('.tab-plus').boundingBox();
  const barBox = await top().locator('.screen-bottom .sticky-bar').boundingBox();
  check(!!plusBox && !!barBox && plusBox.y + plusBox.height <= barBox.y + 1 && barBox.y + barBox.height >= 844 - 2, 'v0.80: … over the job’s own bar, which takes the bottom edge');
  await shot('phone-14-job-full');
  // The customer's chat is a tab of the job, next to it (a swipe from it); «…» → «Чат» opens it too.
  check(await top().getByRole('tab', { name: /WhatsApp/ }).isVisible(), 'v0.80: the job has a «WhatsApp» tab');
  await top().getByRole('button', { name: /^(Ещё|More)$/ }).first().click();
  await page.locator('.action-tile', { hasText: 'Чат' }).click();
  await top().locator('[data-job-chat] [data-wa-list]').waitFor();
  await settle(700);
  check(page.url().includes(`/orders/${jobId}`) && page.url().includes('tab=chat'), 'the job’s «Чат» is the customer’s chat, on the job itself (v0.80)');
  check((await top().locator('[data-job-chat] .note-row').count()) >= 8, 'v0.80: the chat on the job shows the customer’s messages');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.tab-bar-wrap')).opacity === '0'), 'v0.80: the job’s chat — the whole screen, its composer at the bottom');
  await shot('phone-15-job-chat');
  // «＋» in the job's chat: this job first, its estimate a tap away.
  await top().locator('[data-wa-plus]').click();
  await page.locator(`[data-wa-quick-job="${jobId}"]`).waitFor();
  await settle(500);
  check(await page.locator('[data-wa-quick-doc="estimate"]').first().isVisible(), 'v0.80: in the job’s chat its estimate is a tap away');
  await shot('phone-16-job-chat-quick');
  await page.keyboard.press('Escape');
  await settle(400);

  // 8. An estimate sent from the app: the words and the PDF go by themselves.
  await go(`#/orders/${jobId}`, 1200);
  const before = await page.evaluate(() => window.__wa.asked.length);
  await top().getByRole('button', { name: /^Клиенту/ }).click();
  await page.locator('[data-send-direct]').waitFor();
  await settle(500);
  await shot('phone-12-send-direct');
  await page.locator('[data-send-direct]').click();
  await page.getByText('Отправлено').first().waitFor({ timeout: 20000 });
  const went = await page.evaluate((n) => window.__wa.asked.slice(n).filter((a) => a.path === 'send' || a.path === 'file'), before);
  check(went.length === 2 && went[0].path === 'send' && went[0].body.chat === A && /Brake pads front/i.test(went[0].body.text), 'the estimate’s words went to the customer’s chat');
  check(went[1].path === 'file' && went[1].file.type === 'application/pdf' && went[1].query.doc === '1' && /\.pdf$/.test(went[1].query.name), 'its PDF went after them, as a document');
  check(await page.locator('[data-send-direct]').waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false), 'the sheet closed: nobody is asked whether it was sent');

  // v0.80: the estimate again from the job's chat («＋» → «Смета»): the version waiting for the answer, its PDF.
  await go(`#/orders/${jobId}?tab=chat`, 1200);
  await top().locator('[data-job-chat] [data-wa-list]').waitFor();
  await top().locator('[data-wa-plus]').click();
  await page.locator(`[data-wa-quick-job="${jobId}"]`).waitFor();
  const before2 = await page.evaluate(() => window.__wa.asked.length);
  await page.locator('[data-wa-quick-doc="estimate"]').first().click();
  await page.locator('[data-send-direct]').waitFor();
  await settle(400);
  await page.locator('[data-send-direct]').click();
  await page.locator('[data-send-direct]').waitFor({ state: 'hidden', timeout: 20000 });
  const went2 = await page.evaluate((n) => window.__wa.asked.slice(n).filter((a) => a.path === 'send' || a.path === 'file'), before2);
  check(went2.length === 2 && went2[0].body.chat === A && /Brake pads front/i.test(went2[0].body.text) && went2[1].file.type === 'application/pdf', 'v0.80: «Смета» from the chat’s «＋» sends the words and the PDF to the customer');

  // v0.80: «Владельцу на проверку» — one tap to the owner's WhatsApp (picked the first time, then at once).
  await go(`#/orders/${jobId}`, 1200);
  await top().getByRole('button', { name: /^(Ещё|More)$/ }).first().click();
  await page.locator('.action-tile', { hasText: 'Владельцу' }).click();
  await page.locator('[data-owner-check]').waitFor({ timeout: 15000 });
  await settle(500);
  await shot('phone-17-owner-check');
  await page.locator('[data-owner-wa]').click();
  await page.locator('[data-chat-picker] .list-row').first().waitFor();
  await settle(400);
  const before3 = await page.evaluate(() => window.__wa.asked.length);
  await page.locator('[data-chat-picker] .list-row').first().click();
  await page.getByText('Отправлено владельцу').first().waitFor({ timeout: 20000 });
  const went3 = await page.evaluate((n) => window.__wa.asked.slice(n).filter((a) => a.path === 'file'), before3);
  check(went3.length === 1 && went3[0].file.type === 'image/jpeg', 'v0.80: the owner’s check went to the chosen chat as a picture');
  const boss = await page.evaluate(async () => (await (await import('/src/db/db.ts')).db.settings.get('main')).waAuto?.boss);
  check(!!boss?.to?.chat && boss.on === false, 'v0.80: the chat picked is the owner’s from now on — its automatic reports not turned on by it');
  check(went3[0].query.chat === boss.to.chat, 'v0.80: … and the picture went to it');
  await settle(900);
  await top().getByRole('button', { name: /^(Ещё|More)$/ }).first().click();
  await page.locator('.action-tile', { hasText: 'Владельцу' }).click();
  await page.locator('[data-owner-check]').waitFor({ timeout: 15000 });
  await settle(400);
  const before4 = await page.evaluate(() => window.__wa.asked.length);
  await page.locator('[data-owner-wa]').click();
  await page.getByText('Отправлено владельцу').first().waitFor({ timeout: 20000 });
  const went4 = await page.evaluate((n) => window.__wa.asked.slice(n).filter((a) => a.path === 'file'), before4);
  check(went4.length === 1 && went4[0].query.chat === boss.to.chat, 'v0.80: the second time one tap sends it to the owner');

  // «Ещё»: WhatsApp with how many wait.
  await go('#/more');
  check(await top().locator('.list-row', { hasText: 'WhatsApp' }).isVisible(), '«Ещё» has WhatsApp');
  await shot('phone-13-more');

  // Dark.
  await page.evaluate(() => localStorage.setItem('mygarage.scheme', 'dark'));
  await page.reload();
  await settle(900);
  await playServer(page, 'ready');
  await go('#/more');
  await go('#/whatsapp');
  await top().locator('[data-wa-chat]').first().waitFor();
  await settle(500);
  await shot('phone-dark-01-chats');
  await top().locator('[data-wa-chat]').first().click();
  await top().locator('[data-wa-list]').waitFor();
  await settle(900);
  await shot('phone-dark-02-chat');
  await ctx.close();

  /* ---------------- A PC ---------------- */
  for (const scheme of ['light', 'dark']) {
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ru-RU' });
    await desk.addInitScript((s) => {
      localStorage.getItem('mygarage.feedback') ?? localStorage.setItem('mygarage.feedback', '0');
      localStorage.setItem('mygarage.scheme', s);
    }, scheme);
    const p = await desk.newPage();
    current = p;
    watch(p);
    const wait = (ms = 700) => p.waitForTimeout(ms);
    await p.goto(BASE + '#/');
    await wait();
    await p.evaluate(async () => (await import('/src/services/demo.ts')).loadDemoData());
    await playServer(p, 'ready');
    await p.goto(BASE + '#/settings');
    await p.goto(BASE + '#/whatsapp');
    await p.locator('[data-wa-chat]').first().waitFor();
    await wait(500);
    check((await p.locator('.wa-desk-none').count()) === 1, `PC ${scheme}: the chats, and a place for the chosen one`);
    await p.screenshot({ path: `${OUT}/pc-${scheme}-01-chats.png` });
    await p.locator('[data-wa-chat]').first().click();
    await p.locator('[data-wa-list]').waitFor();
    await wait(900);
    check(await p.locator('.wa-desk-list [data-wa-chat]').first().isVisible(), `PC ${scheme}: the list stays beside the open chat`);
    const box = await p.locator('.wa-pane-foot').boundingBox();
    check(box && box.y + box.height <= 900 && box.y > 600, `PC ${scheme}: the composer is at the foot of the window`);
    check(await p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2), `PC ${scheme}: the window itself does not scroll`);
    await p.screenshot({ path: `${OUT}/pc-${scheme}-02-chat.png` });
    if (scheme === 'light') {
      // Enter sends; a right click on a message — its menu.
      await p.locator('[data-wa-field]').fill('Ok, see you at 5');
      await p.keyboard.press('Enter');
      await p.locator('.note-row', { hasText: 'Ok, see you at 5' }).waitFor();
      check(true, 'PC: Enter sends');
      await p.locator('.note-row[data-in] .note-bubble').first().click({ button: 'right' });
      await p.getByRole('menuitem', { name: 'Ответить' }).click();
      await p.locator('.notes-reply').waitFor();
      check(true, 'PC: a right click answers a message');
      await p.screenshot({ path: `${OUT}/pc-${scheme}-03-reply.png` });
      // Another chat: the group, with who wrote.
      await p.locator('.wa-row-name', { hasText: 'Garage team' }).click();
      await p.locator('.wa-author').first().waitFor();
      check((await p.locator('.wa-author').first().innerText()) === 'Rashid', 'PC: in a group a run of messages says who wrote it');
      await wait(500);
      await p.screenshot({ path: `${OUT}/pc-${scheme}-04-group.png` });
      await p.goto(BASE + '#/whatsapp/setup');
      await p.locator('[data-wa-state="ready"]').waitFor();
      await wait(400);
      await p.screenshot({ path: `${OUT}/pc-${scheme}-05-setup.png` });
      check((await p.locator('.desk-nav-item', { hasText: 'WhatsApp' }).count()) === 1, 'PC: WhatsApp is in the side menu');

      // v0.80: on WhatsApp the side menu is put away by a button — the chats get the whole window — and brought back.
      await p.goto(BASE + '#/whatsapp');
      await p.locator('[data-wa-chat]').first().waitFor();
      await p.locator('[data-wa-side-btn]').click();
      await wait(400);
      check(await p.locator('.desk-side').isHidden(), 'PC v0.80: the side menu is put away on WhatsApp');
      check(((await p.locator('.wa-desk').boundingBox())?.x ?? 999) < 60, 'PC v0.80: … the chats start at the window’s edge');
      await p.locator('[data-wa-chat]').first().click();
      await p.locator('[data-wa-list]').waitFor();
      await wait(700);
      await p.screenshot({ path: `${OUT}/pc-${scheme}-06-menu-away.png` });
      // «＋» of a customer's chat: a menu where it is — files, the customer's jobs, a new job.
      await p.locator('[data-wa-plus]').click();
      await p.getByRole('menuitem', { name: 'Фото и файлы' }).waitFor();
      await p.getByRole('menuitem', { name: 'Новый заказ' }).waitFor();
      await wait(300);
      await p.screenshot({ path: `${OUT}/pc-${scheme}-07-quick.png` });
      await p.keyboard.press('Escape');
      await p.goto(BASE + '#/');
      await p.locator('.desk-side').waitFor();
      check(await p.locator('.desk-side').isVisible(), 'PC v0.80: other screens keep their side menu');
      await p.goto(BASE + '#/whatsapp');
      await p.locator('[data-wa-side-btn]').click();
      await wait(300);
      check(await p.locator('.desk-side').isVisible(), 'PC v0.80: the same button brings the menu back');

      // v0.80: a card's «WhatsApp» (right click on the board) opens the chat in the app.
      await p.goto(BASE + '#/');
      await p.locator('article.dcard').first().waitFor();
      await wait(600);
      const cards = p.locator('article.dcard');
      let opened = false;
      for (let i = 0; i < (await cards.count()) && !opened; i++) {
        await cards.nth(i).click({ button: 'right' });
        const item = p.getByRole('menuitem', { name: 'WhatsApp' });
        if (await item.isVisible().catch(() => false)) {
          await item.click();
          opened = true;
        } else await p.keyboard.press('Escape');
      }
      check(opened, 'PC v0.80: a card with a customer’s number has «WhatsApp» in its menu');
      await p.waitForURL(/#\/whatsapp\/chat\//, { timeout: 15000 });
      check(true, 'PC v0.80: the card’s «WhatsApp» opens the chat in the app, not WhatsApp outside');

      // v0.80: a job beside the job — «Заказ рядом»: a new job taken in on the right, both on one screen.
      const pcJob = await p.evaluate(async () => {
        const { db } = await import('/src/db/db.ts');
        const o = (await db.orders.toArray()).find((x) => !['closed', 'cancelled'].includes(x.stage));
        return o.id;
      });
      await p.goto(BASE + `#/orders/${pcJob}`);
      await p.locator('[data-twin-btn]').click();
      const side = p.locator('.desk-twin-pane[data-pane="side"]');
      await side.locator('[data-pane-page="new"]').waitFor();
      await side.getByLabel('Номер').fill('27183');
      await side.getByRole('button', { name: 'Принять' }).click();
      await side.locator('[data-pane-page="job"]').waitFor({ timeout: 15000 });
      await wait(900);
      const twinUrl = p.url();
      check(twinUrl.includes(`/orders/${pcJob}`) && /side=[^&]+/.test(twinUrl) && !twinUrl.includes('side=new'), 'PC v0.80: the new job is taken in beside the first, the window keeps both');
      check(await p.locator('.desk-twin-pane[data-pane="main"] .desk-title').isVisible() && (await side.locator('.desk-title').innerText()).length > 0, 'PC v0.80: both jobs are on the screen, each with its toolbar');
      check(await p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2), 'PC v0.80: the window does not scroll — each pane does');
      await p.screenshot({ path: `${OUT}/pc-${scheme}-08-twin.png` });
      // The keys act in the pane last clicked: «1» — work on that job only.
      await side.locator('.desk-title').click();
      await p.keyboard.press('1');
      await p.locator('.mantine-Modal-content').first().waitFor();
      await wait(400);
      check((await p.locator('.mantine-Modal-content').count()) === 1, 'PC v0.80: «1» opens one sheet — in the pane last clicked');
      await p.keyboard.press('Escape');
      await wait(500);
      await side.locator('[data-pane-back]').click();
      await p.locator('.desk-twin').waitFor({ state: 'detached' });
      check(!p.url().includes('side='), 'PC v0.80: × closes the pane, the first job stays');
    }
    await desk.close();
  }

  await browser.close();
  if (errors.length) {
    console.error(errors.join('\n'));
    throw new Error(`whatsapp e2e: ${errors.length} error(s) in the page`);
  }
  console.log('WHATSAPP E2E OK');
})().catch(async (e) => {
  console.error(e);
  // Where it stopped, as a picture.
  await current?.screenshot({ path: OUT + '/failed.png' }).catch(() => undefined);
  process.exit(1);
});
