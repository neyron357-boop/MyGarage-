const { chromium } = require('playwright');

/*
 * The app under the garage's WhatsApp's own traffic (v0.80.2: «после интеграции ватсапа приложение начало тормозить»):
 * a server played in the page with ~400 chats, and a stream of what a busy account says — messages in groups and chats
 * not open, their ticks, unread counts — while a job is open on a phone (the board under it), and the board on a PC.
 * Measured: the main thread's work for the stream (CDP TaskDuration / ScriptDuration) and its long tasks (> 50 ms).
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/waload.cjs [events]
 * (BASE_URL to aim elsewhere). Nothing reaches WhatsApp: the server is played in the page.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const EVENTS = Number(process.argv[2] || 300);

async function launchBrowser() {
  for (const channel of [undefined, 'chrome', 'msedge']) {
    try {
      return await chromium.launch(channel ? { channel } : {});
    } catch {
      // next
    }
  }
  throw new Error('no browser');
}

/** The server's part, played in the page: ready, ~400 chats, the job's customer among them. */
async function playServer(page) {
  await page.evaluate(async () => {
    const { setWaTransport } = await import('/src/services/whatsapp.ts');
    const { db } = await import('/src/db/db.ts');
    const { waDigits } = await import('/src/domain/whatsapp.ts');
    const now = Date.now();
    const customers = (await db.customers.toArray()).filter((c) => waDigits(c.whatsapp || c.phone));
    const chats = [];
    customers.forEach((c, i) => chats.push({ id: `5551${String(i).padStart(10, '0')}@lid`, name: c.name, group: false, phone: waDigits(c.whatsapp || c.phone), unread: 0, t: now - i * 60_000, archived: false, pinned: false, muted: false, self: false, last: { id: `m${i}`, t: now - i * 60_000, me: false, type: 'chat', text: 'Hello', ack: 0 } }));
    for (let i = chats.length; i < 400; i++) {
      const group = i % 3 === 0;
      chats.push({ id: group ? `1203630000${String(i).padStart(8, '0')}@g.us` : `5552${String(i).padStart(10, '0')}@lid`, name: `Chat ${i}`, group, phone: group ? '' : `97150${String(1000000 + i)}`, unread: i % 7, t: now - i * 60_000, archived: false, pinned: false, muted: i % 11 === 0, self: false, last: { id: `m${i}`, t: now - i * 60_000, me: false, type: 'chat', text: 'Some words of the last message in this chat', ack: 0 } });
    }
    window.__load = { chats };
    const status = { ok: true, available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: chats.length, unread: 40 };
    setWaTransport(
      async (path, init) => {
        if (path === 'status') return status;
        if (path === 'chats') return { chats, total: chats.length, unread: 40 };
        if (path === 'messages') return { messages: [], more: false };
        if (path === 'number') return { ok: true, chat: `${init.query.phone}@c.us` };
        if (path === 'outbox') return { items: [] };
        return { ok: true };
      },
      () => '',
    );
  });
}

/** What a busy account says, spread over time: messages in chats not open, their ticks, unread counts. */
async function stream(page, n) {
  await page.evaluate(async (n) => {
    const { waSaid } = await import('/src/services/whatsapp.ts');
    const chats = window.__load.chats;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const c = chats[(i * 37) % chats.length];
      const r = i % 10;
      if (r < 7) {
        const id = `false_${c.id}_LOAD${++k}`;
        const msg = { id, chat: c.id, t: Date.now(), me: false, type: 'chat', text: `message ${i}`, ack: 0, ...(c.group ? { from: { id: '971559990000@c.us', name: 'Someone', phone: '971559990000' } } : {}) };
        waSaid({ t: 'msg', msg, chat: { ...c, t: msg.t, unread: c.unread + 1, last: { id, t: msg.t, me: false, type: 'chat', text: msg.text, ack: 0 } } });
      } else if (r < 9) waSaid({ t: 'ack', chat: c.id, id: `true_${c.id}_X${i}`, ack: 3 });
      else waSaid({ t: 'chat', chat: { ...c, unread: 0 }, unread: 40 });
      // A busy account: a few events a second at most — here faster, so the test is short.
      if (i % 5 === 4) await new Promise((res) => setTimeout(res, 16));
    }
    await new Promise((res) => setTimeout(res, 400));
  }, n);
}

async function measure(page, cdp, n) {
  await page.evaluate(() => {
    window.__long = 0;
    window.__longMs = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => ((window.__long += 1), (window.__longMs += e.duration)))).observe({ type: 'longtask', buffered: false });
  });
  const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await stream(page, n);
  const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const long = await page.evaluate(() => ({ n: window.__long, ms: Math.round(window.__longMs) }));
  return { taskMs: Math.round((after.TaskDuration - before.TaskDuration) * 1000), scriptMs: Math.round((after.ScriptDuration - before.ScriptDuration) * 1000), layoutMs: Math.round((after.LayoutDuration - before.LayoutDuration) * 1000), longTasks: long.n, longMs: long.ms };
}

(async () => {
  const browser = await launchBrowser();
  const out = {};
  for (const [name, viewport] of [
    ['phone: a job open, the board under it', { width: 390, height: 844 }],
    ['pc: the board', { width: 1440, height: 900 }],
  ]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ru-RU' });
    await ctx.addInitScript(() => localStorage.setItem('mygarage.feedback', '0'));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '#/');
    await page.waitForTimeout(800);
    await page.evaluate(async () => (await import('/src/services/demo.ts')).loadDemoData());
    await playServer(page);
    await page.evaluate(async () => {
      const w = await import('/src/services/whatsapp.ts');
      await w.refreshWa();
      await w.loadChats(true);
    });
    await page.goto(BASE + '#/');
    await page.waitForTimeout(1200);
    if (name.startsWith('phone')) {
      const jobId = await page.evaluate(async () => {
        const { db } = await import('/src/db/db.ts');
        const open = (await db.orders.toArray()).filter((o) => !['closed', 'cancelled'].includes(o.stage) && o.customerId);
        return open[0].id;
      });
      await page.evaluate((id) => (location.hash = `#/orders/${id}`), jobId);
      await page.waitForTimeout(1500);
    }
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    out[name] = await measure(page, cdp, EVENTS);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    if (errors.length) out[name].errors = errors.slice(0, 3);
    await ctx.close();
  }
  await browser.close();
  console.log(`${EVENTS} WhatsApp events, CPU ×4:`);
  for (const [k, v] of Object.entries(out)) console.log(`  ${k}: main thread ${v.taskMs} ms (script ${v.scriptMs}, layout ${v.layoutMs}), long tasks ${v.longTasks} (${v.longMs} ms)${v.errors ? ' ERR ' + v.errors.join(' | ') : ''}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
