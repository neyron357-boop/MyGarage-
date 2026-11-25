const { chromium } = require('playwright');

/*
 * The plate typed fast in «Новый заказ» (v0.89, the owner: «если быстро вбиваю номер… цифру набрал — она исчезает»):
 * a phone 390×844 with the CPU slowed, each digit sent as a key 60 ms after the last (a fast thumb). Prints what each key
 * cost the page (Event Timing: from the key to the frame after it, and the handler's own time), the long tasks while
 * typing, and whether the field ends with every digit typed.
 *
 * Usage: a fresh dev server, then node e2e/plate-typing.cjs [cpu=6] [gap ms=60] (BASE_URL to aim elsewhere).
 */
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const CPU = Number(process.argv[2] || 6);
const GAP = Number(process.argv[3] || 60);
const DIGITS = '583921';

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

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await ctx.addInitScript(() => {
    localStorage.setItem('mygarage.feedback', '0');
    const w = window;
    w.__events = [];
    w.__long = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__events.push({ name: e.name, duration: e.duration, work: e.processingEnd - e.processingStart, delay: e.processingStart - e.startTime, at: e.startTime }))).observe({ type: 'event', durationThreshold: 16, buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push({ at: e.startTime, duration: e.duration }))).observe({ type: 'longtask', buffered: true });
    } catch {
      // no Event Timing here
    }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '#/');
  await page.waitForTimeout(1500);
  // Some cars in the base, as at the garage: the plate's lookup has something to look through.
  await page.evaluate(async () => {
    const { db, uid } = await import('/src/db/db.ts');
    if ((await db.vehicles.count()) > 200) return;
    const now = new Date().toISOString();
    const cars = Array.from({ length: 400 }, (_, i) => ({ id: uid(), plate: { emirate: 'DXB', code: 'ABCDEFGHJK'[i % 10], number: String(10000 + i * 37) }, make: 'Toyota', model: 'Corolla', customerId: '', createdAt: now, updatedAt: now }));
    await db.vehicles.bulkAdd(cars);
  });
  await page.goto(BASE + '#/orders/new');
  const field = page.locator('.screen[data-role="top"] input[inputmode="numeric"]').first();
  await field.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  await field.focus();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.evaluate(() => {
    window.__events.length = 0;
    window.__long.length = 0;
    window.__t0 = performance.now();
  });
  for (const d of DIGITS) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: d, key: d, code: `Digit${d}`, windowsVirtualKeyCode: d.charCodeAt(0) });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: d, code: `Digit${d}`, windowsVirtualKeyCode: d.charCodeAt(0) });
    await new Promise((r) => setTimeout(r, GAP));
  }
  await page.waitForTimeout(1500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const value = await field.inputValue();
  const r = await page.evaluate(() => {
    const t0 = window.__t0;
    const ev = window.__events.filter((e) => e.at >= t0 && /key|input/.test(e.name));
    const long = window.__long.filter((e) => e.at >= t0);
    return { ev, long };
  });
  const keys = r.ev.filter((e) => e.name === 'keydown' || e.name === 'input' || e.name === 'beforeinput');
  const worst = keys.reduce((m, e) => Math.max(m, e.duration), 0);
  const work = keys.reduce((s, e) => s + e.work, 0);
  console.log(`cpu ×${CPU}, a key every ${GAP} ms: typed ${DIGITS}, field ${value} ${value === DIGITS ? 'ok' : 'LOST'}`);
  console.log(`events over 16 ms: ${keys.length}; worst key to frame ${Math.round(worst)} ms; handlers ${Math.round(work)} ms in all`);
  console.log(`long tasks: ${r.long.length}, ${Math.round(r.long.reduce((s, e) => s + e.duration, 0))} ms in all, longest ${Math.round(r.long.reduce((m, e) => Math.max(m, e.duration), 0))} ms`);
  if (errors.length) console.log('page errors:', errors.slice(0, 3));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
