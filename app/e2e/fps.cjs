const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
/*
 * Scrolling on the phone, frame by frame (v0.83: «очень сильно сейчас проседает FPS»): the built app on an iPhone-sized
 * screen (touch, DPR 3), the demo's data (HISTORY=n — a year or two of closed jobs more), CPU slowed (×4 by default), and
 * each screen scrolled by a finger (CDP touch scroll gestures, down and up). From a Chrome trace, per screen:
 *   frames — frames the compositor drew during the scroll; dropped — those that came late (> 1.5 vsync);
 *   main ms — the main thread's work (script, style, layout, paint records); raster ms — painting the tiles;
 *   paint — paint records made (layers painted again).
 * The numbers are Chrome's, not the iPhone's GPU: they compare builds and variants (VARIANT=… injects CSS to
 * switch a suspect off), they are not the phone's FPS.
 *   npm run build && node e2e/fps.cjs dist [cpuSlowdown] [otherDist]
 *   VARIANT=noglow|noglass|noimages|nofixed node e2e/fps.cjs dist
 */
const DIRS = [process.argv[2] || 'dist', process.argv[4]].filter(Boolean);
const SLOW = Number(process.argv[3] || 4);
const HISTORY = Number(process.env.HISTORY || 0);
const VARIANTS = {
  noglow: '.screen-body::before, .page-shell::before { display: none !important; }',
  noglass: '* { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }',
  noimages: 'img { visibility: hidden !important; }',
  notimeline: '.screen-scroll { scroll-timeline: none !important; } .screen-body::before { position: absolute !important; animation: none !important; }',
};
const VARIANT = process.env.VARIANT || '';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
function serve(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(root, url === '/' ? 'index.html' : url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/` })));
}

async function launch() {
  for (const channel of [process.env.E2E_BROWSER, 'chromium', 'chrome', 'msedge'].filter(Boolean)) {
    try {
      return await chromium.launch(channel === 'chromium' ? {} : { channel });
    } catch {
      // next
    }
  }
  throw new Error('no browser');
}

/** The demo's closed jobs copied `n` times into the past (as e2e/moves.cjs). */
function grow(page, n) {
  return page.evaluate(async (n) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('mygarage');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all = (store) =>
      new Promise((res, rej) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const [orders, items, invoices, payments] = await Promise.all(['orders', 'items', 'invoices', 'payments'].map(all));
    const done = orders.filter((o) => o.stage === 'closed');
    const id = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const put = { orders: [], items: [], invoices: [], payments: [] };
    for (let k = 0; k < n; k++) {
      const src = done[k % done.length];
      const oid = id();
      const back = (iso) => (iso ? new Date(new Date(iso).getTime() - (k + 1) * 6 * 3600e3).toISOString() : iso);
      put.orders.push({ ...src, id: oid, number: 100000 + k, createdAt: back(src.createdAt), closedAt: back(src.closedAt), stageChangedAt: back(src.stageChangedAt), deliveredAt: back(src.deliveredAt), archivedAt: undefined });
      for (const it of items.filter((i) => i.orderId === src.id)) put.items.push({ ...it, id: id(), orderId: oid, createdAt: back(it.createdAt) });
      for (const inv of invoices.filter((x) => x.orderId === src.id)) put.invoices.push({ ...inv, id: id(), orderId: oid, number: `H-${k}`, issuedAt: back(inv.issuedAt) });
      for (const x of payments.filter((y) => y.orderId === src.id)) put.payments.push({ ...x, id: id(), orderId: oid, receivedAt: back(x.receivedAt), typedAt: back(x.typedAt) });
    }
    await new Promise((res, rej) => {
      const tx = db.transaction(Object.keys(put), 'readwrite');
      for (const [store, list] of Object.entries(put)) for (const r of list) tx.objectStore(store).put(r);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, n);
}

async function run(dir) {
  const { server, base } = await serve(dir);
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await ctx.addInitScript(() => localStorage.getItem('mygarage.feedback') ?? localStorage.setItem('mygarage.feedback', '0'));
  if (VARIANT) await ctx.addInitScript((css) => document.addEventListener('DOMContentLoaded', () => document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }))), VARIANTS[VARIANT]);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const top = (sel) => page.locator(`.screen[data-role="top"] ${sel}`);
  await page.goto(base + '#/settings?tab=data');
  await page.getByRole('button', { name: 'Загрузить демо-данные' }).click();
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.querySelector('button[data-loading]'), null, { timeout: 120000 });
  if (HISTORY) await grow(page, HISTORY);
  await page.goto(base + '#/');
  await top('.job-row').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });

  /** A finger scrolling the screen in front: down by `px`, then back up. */
  const scroll = async (px) => {
    const box = await top('.screen-scroll').first().boundingBox();
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height * 0.6);
    for (const dy of [-px, px]) await cdp.send('Input.synthesizeScrollGesture', { x, y, yDistance: dy, speed: 1800, gestureSourceType: 'mouse', repeatCount: 1 });
  };

  const out = [];
  const measure = async (name, fn) => {
    if (process.env.FPS_DEBUG) console.log('…', name);
    await page.waitForTimeout(800);
    await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'cc', 'benchmark'] });
    const t0 = Date.now();
    await fn();
    const wall = Date.now() - t0;
    const events = JSON.parse((await browser.stopTracing()).toString()).traceEvents;
    const names = new Map();
    for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
    const thread = (n) => [...names.entries()].filter(([, v]) => v === n).map(([k]) => k);
    const on = (keys) => events.filter((e) => keys.includes(`${e.pid}:${e.tid}`));
    // The renderer's main thread: the busiest one called so.
    const mains = thread('CrRendererMain');
    let main = { cpu: -1, k: '' };
    for (const k of mains) {
      const cpu = events.filter((e) => `${e.pid}:${e.tid}` === k && e.name === 'RunTask' && e.ph === 'X').reduce((s, e) => s + (e.tdur || e.dur || 0), 0);
      if (cpu > main.cpu) main = { cpu, k };
    }
    const pid = main.k.split(':')[0];
    const ofMain = events.filter((e) => `${e.pid}:${e.tid}` === main.k && e.ph === 'X');
    const sum = (list, n) => list.filter((e) => e.name === n).reduce((s, e) => s + (e.tdur || e.dur || 0), 0) / 1000;
    const raster = on(thread('CompositorTileWorker1').concat(thread('CompositorTileWorker2'), thread('CompositorTileWorker3'), thread('CompositorTileWorker4'))).filter((e) => String(e.pid) === pid && e.ph === 'X' && /RasterTask|TaskGraphRunner::RunTask/.test(e.name));
    // Frames: the compositor's begin-frames during the gesture, and those whose work came in late.
    const frames = events.filter((e) => String(e.pid) === pid && (e.name === 'DrawFrame' || e.name === 'Graphics.Pipeline' && e.ph === 'b'));
    const draws = events.filter((e) => String(e.pid) === pid && e.name === 'DrawFrame').map((e) => e.ts).sort((a, b) => a - b);
    let late = 0;
    for (let i = 1; i < draws.length; i++) if (draws[i] - draws[i - 1] > 25000) late++;
    out.push({
      screen: name,
      'wall ms': wall,
      frames: draws.length || frames.length,
      'late gaps': late,
      'main ms': +(main.cpu / 1000).toFixed(0),
      script: +sum(ofMain, 'FunctionCall').toFixed(0),
      style: +sum(ofMain, 'UpdateLayoutTree').toFixed(0),
      layout: +sum(ofMain, 'Layout').toFixed(0),
      paint: +sum(ofMain, 'Paint').toFixed(0),
      'raster ms': +(raster.reduce((s, e) => s + (e.tdur || e.dur || 0), 0) / 1000).toFixed(0),
    });
  };

  await measure('board: scroll', () => scroll(2400));
  if (process.env.FPS_DEBUG) await page.screenshot({ path: 'test-results/fps-after-scroll.png' });
  await measure('board → job', async () => {
    // A tap (touch), as a finger does: the board's cards open on the tap.
    await top('.job-row').filter({ hasText: 'Nissan Patrol' }).first().tap({ timeout: 15000 });
    await top('.list-row').first().waitFor();
    await page.waitForTimeout(600);
  });
  await measure('job: scroll', () => scroll(1400));
  await measure('job → board', async () => {
    await page.goBack();
    await top('.job-row').first().waitFor();
    await page.waitForTimeout(600);
  });
  await measure('tab: money', async () => {
    await page.locator('.tab-bar button', { hasText: 'Деньги' }).click();
    await top('.tab-panel').waitFor();
    await page.waitForTimeout(600);
  });
  await measure('money: scroll', () => scroll(1600));
  await measure('tab: board', async () => {
    await page.locator('.tab-bar button', { hasText: 'Доска' }).click();
    await top('.job-row').first().waitFor();
    await page.waitForTimeout(600);
  });
  await measure('board: archive scroll', async () => {
    await page.evaluate(() => (location.hash = '#/?tab=archive'));
    await top('.job-mini, .job-row').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(600);
    await scroll(2400);
  });
  await browser.close();
  server.close();
  return out;
}

(async () => {
  const results = [];
  for (const d of DIRS) results.push({ dir: d, rows: await run(d) });
  for (const r of results) {
    console.log(`\n${r.dir} (CPU ×${SLOW}${VARIANT ? ', ' + VARIANT : ''}${HISTORY ? ', history ' + HISTORY : ''})`);
    console.table(r.rows);
  }
})().catch((e) => {
  console.error('FPS FAILED:', String((e && e.message) || e).slice(0, 1500));
  process.exit(1);
});
