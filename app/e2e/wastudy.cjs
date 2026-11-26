const { chromium } = require('playwright');

/*
 * The WhatsApp list while the app studies the chats (v0.91.7, the owner: «оптимизируй работу ватсапа, сделай его плавнее»):
 * a server played in the page with 400 chats, what the app knows of them (`chatFacts`: requests and answers — 20 chats
 * with a long history from exports, the rest a short one) and 200 suppliers; the list open on a phone; then a pass of the
 * study — its record of a chat written one after another, as a real pass does between its reads of the server.
 * Measured: the main thread's work for the pass (CDP TaskDuration / ScriptDuration) and its long tasks (> 50 ms).
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/wastudy.cjs [writes] [cpu]
 * (BASE_URL to aim elsewhere). Nothing reaches WhatsApp: the server is played in the page; every name is made up.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const WRITES = Number(process.argv[2] || 120);
const CPU = Number(process.argv[3] || 4);

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

async function seed(page) {
  await page.evaluate(async () => {
    const { setWaTransport } = await import('/src/services/whatsapp.ts');
    const { db } = await import('/src/db/db.ts');
    const { uid } = await import('/src/db/db.ts');
    const now = Date.now();
    const chats = [];
    for (let i = 0; i < 400; i++) {
      const group = i % 9 === 0;
      chats.push({ id: group ? `1203630000${String(i).padStart(8, '0')}@g.us` : `97150${String(1000000 + i)}@c.us`, name: group ? `Group ${i}` : `Spare Parts ${i}`, group, phone: group ? '' : `97150${String(1000000 + i)}`, unread: i % 7, t: now - i * 60_000, archived: false, pinned: false, muted: false, self: false, last: { id: `m${i}`, t: now - i * 60_000, me: false, type: 'chat', text: 'Some words of the last message in this chat', ack: 0 } });
    }
    window.__study = { chats };
    const makes = ['Toyota', 'Nissan', 'Lexus', 'Mitsubishi', 'Hyundai'];
    const kinds = ['body', 'engine', 'brakes', 'suspension'];
    const turns = (n, k) =>
      Array.from({ length: n }, (_, j) => ({ t: now - (n - j) * 3_600_000 - k, ...(j % 4 ? { r: 600 + (j % 7) * 60 } : {}), ...(j % 3 === 0 ? { p: 1 } : {}), ...(j % 11 === 0 ? { na: 1 } : {}), mk: [makes[(k + j) % 5]], k: [kinds[j % 4]], ...(j % 5 === 0 ? { o: 'oa' } : {}) }));
    const people = chats.filter((c) => !c.group);
    await db.transaction('rw', db.chatFacts, db.suppliers, async () => {
      for (let i = 0; i < people.length; i++) {
        const c = people[i];
        await db.chatFacts.put({ id: c.id, phone: c.phone, name: c.name, turns: turns(i < 20 ? 300 : 20, i), through: now - 60_000, studiedAt: new Date(now - 86_400_000).toISOString(), deepAt: new Date(now - 86_400_000).toISOString(), studyV: 2, aiRole: 'supplier', aiV: 3, aiMakes: [makes[i % 5]], updatedAt: new Date(now - 86_400_000).toISOString() });
        if (i < 200) await db.suppliers.put({ id: uid(), name: c.name, phone: `+${c.phone}`, createdAt: new Date().toISOString() });
      }
    });
    const status = { ok: true, available: true, installed: true, browser: true, on: true, phase: 'ready', linked: true, qr: '', qrAt: 0, code: '', loading: 100, me: { id: '971500000001@c.us', phone: '971500000001', name: 'Garage' }, platform: 'smbi', web: '', error: '', chats: chats.length, unread: 40 };
    setWaTransport(
      async (path) => {
        if (path === 'status') return status;
        if (path === 'chats') return { chats, total: chats.length, unread: 40 };
        if (path === 'messages' || path === 'history') return { messages: [], more: false, end: 1 };
        if (path === 'outbox') return { items: [] };
        if (path === 'history-state') return { more: 0, noAccess: 0, chats: 0, came: 0, asks: 0, phone: 'unknown', okAt: 0, passAt: 0, running: false, done: 0, total: 0 };
        return { ok: true };
      },
      () => '',
    );
    // The study itself stays still: the pass below writes its records as it would.
    const { resetChatStudy } = await import('/src/services/chatStudy.ts');
    resetChatStudy(1e9);
  });
}

/** A pass of the study: a chat's record written, a short wait (its read of the server), the next. */
async function pass(page, n) {
  await page.evaluate(async (n) => {
    const { db } = await import('/src/db/db.ts');
    const people = window.__study.chats.filter((c) => !c.group);
    for (let i = 0; i < n; i++) {
      const c = people[(i * 7) % people.length];
      const was = await db.chatFacts.get(c.id);
      await db.chatFacts.put({ ...was, through: Date.now(), studiedAt: new Date().toISOString(), turns: [...(was.turns ?? []), { t: Date.now(), r: 300, p: 1, mk: ['Toyota'] }].slice(-1000), updatedAt: new Date().toISOString() });
      await new Promise((r) => setTimeout(r, 40));
    }
    await new Promise((r) => setTimeout(r, 1500));
  }, n);
}

(async () => {
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'ru-RU' });
  await ctx.addInitScript(() => localStorage.setItem('mygarage.feedback', '0'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '#/');
  await page.waitForTimeout(800);
  await seed(page);
  await page.evaluate(async () => {
    const w = await import('/src/services/whatsapp.ts');
    await w.refreshWa();
    await w.loadChats(true);
  });
  await page.goto(BASE + '#/whatsapp');
  await page.locator('[data-wa-chat]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.evaluate(() => {
    window.__long = 0;
    window.__longMs = 0;
    window.__longMax = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => ((window.__long += 1), (window.__longMs += e.duration), (window.__longMax = Math.max(window.__longMax, e.duration))))).observe({ type: 'longtask', buffered: false });
  });
  const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const t0 = Date.now();
  await pass(page, WRITES);
  const wall = Date.now() - t0;
  const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const long = await page.evaluate(() => ({ n: window.__long, ms: Math.round(window.__longMs), max: Math.round(window.__longMax) }));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await browser.close();
  const task = Math.round((after.TaskDuration - before.TaskDuration) * 1000);
  const script = Math.round((after.ScriptDuration - before.ScriptDuration) * 1000);
  console.log(`the WhatsApp list on a phone, a study pass of ${WRITES} chats, CPU ×${CPU}: main thread ${task} ms of ${wall} ms (script ${script}), long tasks ${long.n} (${long.ms} ms, longest ${long.max} ms)${errors.length ? ' ERR ' + errors.slice(0, 3).join(' | ') : ''}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
