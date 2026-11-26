const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
/*
 * Main-thread cost of the usual moves on the phone (CPU time from a Chrome trace, so the CPU slowdown's
 * pauses do not count): for each move the busiest task — what stands between the tap and the first frame
 * of the animation — and the whole move. Serves a built app itself, so two builds compare side by side:
 *   npm run build && node e2e/moves.cjs dist [cpuSlowdown] [otherDist]
 * HISTORY=1500 (v0.37): the demo's closed jobs copied that many times into the past (a year or two of a garage's
 * work): what grows with the history shows — the start, the board coming back, the archive, search, debts.
 */
const DIRS = [process.argv[2] || 'dist', process.argv[4]].filter(Boolean);
const SLOW = Number(process.argv[3] || 4);
const HISTORY = Number(process.env.HISTORY || 0);

/** The demo's closed jobs copied `n` times, each an older one, straight into the database (the built app's modules are not reachable). */
function grow(page, n) {
  return page.evaluate(async (n) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('mygarage');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all = (store) => new Promise((res, rej) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const [orders, items, invoices, payments, events, versions, decisions] = await Promise.all(['orders', 'items', 'invoices', 'payments', 'events', 'versions', 'decisions'].map(all));
    const done = orders.filter((o) => o.stage === 'closed');
    const id = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const put = { orders: [], items: [], invoices: [], payments: [], events: [], versions: [], decisions: [] };
    for (let k = 0; k < n; k++) {
      const src = done[k % done.length];
      const oid = id();
      const back = (iso) => (iso ? new Date(new Date(iso).getTime() - (k + 1) * 6 * 3600e3).toISOString() : iso);
      put.orders.push({ ...src, id: oid, number: 100000 + k, createdAt: back(src.createdAt), closedAt: back(src.closedAt), stageChangedAt: back(src.stageChangedAt), deliveredAt: back(src.deliveredAt), archivedAt: undefined });
      const map = new Map();
      for (const it of items.filter((i) => i.orderId === src.id)) map.set(it.id, id()), put.items.push({ ...it, id: map.get(it.id), orderId: oid, createdAt: back(it.createdAt) });
      for (const v of versions.filter((x) => x.orderId === src.id)) map.set(v.id, id()), put.versions.push({ ...v, id: map.get(v.id), orderId: oid, items: (v.items || []).map((x) => ({ ...x, itemId: map.get(x.itemId) ?? x.itemId })) });
      for (const d of decisions.filter((x) => x.orderId === src.id)) put.decisions.push({ ...d, id: id(), orderId: oid, versionId: map.get(d.versionId) ?? d.versionId, itemId: map.get(d.itemId) ?? d.itemId });
      for (const inv of invoices.filter((x) => x.orderId === src.id)) put.invoices.push({ ...inv, id: id(), orderId: oid, number: `H-${k}`, issuedAt: back(inv.issuedAt) });
      for (const x of payments.filter((y) => y.orderId === src.id)) put.payments.push({ ...x, id: id(), orderId: oid, receivedAt: back(x.receivedAt), typedAt: back(x.typedAt) });
      for (const e of events.filter((x) => x.orderId === src.id)) put.events.push({ ...e, id: id(), orderId: oid, at: back(e.at) });
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
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

async function run(dir) {
  const { server, base } = await serve(dir);
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU', hasTouch: false });
  await ctx.addInitScript(() => localStorage.getItem('mygarage.feedback') ?? localStorage.setItem('mygarage.feedback', '0'));
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

  const out = [];
  const measure = async (name, fn) => {
    if (process.env.MOVES_DEBUG) console.log('…', name);
    await page.waitForTimeout(900);
    await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
    const t0 = Date.now();
    await fn();
    const wall = Date.now() - t0;
    await page.waitForTimeout(800);
    const events = JSON.parse((await browser.stopTracing()).toString()).traceEvents;
    const names = new Map();
    for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
    const mains = [...names.entries()].filter(([, n]) => n === 'CrRendererMain').map(([k]) => k);
    let best = { cpu: -1 };
    for (const k of mains) {
      const tasks = events.filter((e) => `${e.pid}:${e.tid}` === k && e.name === 'RunTask' && e.ph === 'X');
      const cpu = tasks.reduce((s, e) => s + (e.tdur || 0), 0);
      if (cpu > best.cpu) best = { cpu, k, tasks };
    }
    const all = events.filter((e) => `${e.pid}:${e.tid}` === best.k && e.ph === 'X');
    const big = [...best.tasks].sort((a, b) => (b.tdur || 0) - (a.tdur || 0))[0];
    const within = (n) => all.filter((e) => e.name === n && e.ts >= big.ts && e.ts + e.dur <= big.ts + big.dur).reduce((s, e) => s + (e.tdur || e.dur), 0);
    out.push({
      move: name,
      'until done ms': wall,
      'busiest task ms': +((big.tdur || 0) / 1000).toFixed(1),
      'of it: style': +(within('UpdateLayoutTree') / 1000).toFixed(1),
      layout: +(within('Layout') / 1000).toFixed(1),
      'move total ms': +(best.cpu / 1000).toFixed(0),
    });
  };

  await measure('start', async () => {
    await page.reload();
    await top('.job-row').first().waitFor({ timeout: 60000 });
  });
  await measure('board → job', async () => {
    await top('.job-row').filter({ hasText: 'Nissan Patrol' }).first().click();
    await top('.list-row').first().waitFor();
  });
  await measure('line sheet up', async () => {
    await page.getByRole('button', { name: 'Добавить позицию', exact: true }).click();
    await page.getByRole('dialog').waitFor();
  });
  await measure('line sheet down', async () => {
    await page.locator('.mantine-Modal-close').first().click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  });
  await measure('job → board', async () => {
    await page.goBack();
    await top('.job-row').first().waitFor();
  });
  await measure('tab: money', async () => {
    await page.locator('.tab-bar button', { hasText: 'Деньги' }).click();
    await top('.tab-panel').waitFor();
  });
  await measure('tab: board', async () => {
    await page.locator('.tab-bar button', { hasText: 'Доска' }).click();
    await top('.job-row').first().waitFor();
  });
  await measure('new job up', async () => {
    await page.locator('.tab-plus').click();
    await top('input[aria-label="Номер"]').first().waitFor();
  });
  await measure('new job down', async () => {
    await page.goBack();
    await top('.job-row').first().waitFor();
  });
  await measure('board: archive', async () => {
    // v0.81: the board's lists are under «Фильтры» on a phone.
    await page.locator('[data-board-filters]').filter({ visible: true }).click();
    await page.getByRole('dialog').locator('.list-row').filter({ hasText: /Архив/ }).first().click();
    await top('.job-mini').first().waitFor({ timeout: 60000 });
  });
  // v0.81: the search is the board's own field (no «Поиск» in the tab bar).
  await measure('search: type', async () => {
    await page.locator('.tab-bar button', { hasText: 'Доска' }).click();
    await top('input[type="search"]').first().click();
    for (const ch of 'toyota') await page.keyboard.type(ch, { delay: 60 });
    await page.waitForTimeout(300);
  });
  await browser.close();
  server.close();
  return out;
}

(async () => {
  const results = [];
  for (const d of DIRS) results.push({ dir: d, rows: await run(d) });
  for (const r of results) {
    console.log(`\n${r.dir} (CPU ×${SLOW})`);
    console.table(r.rows);
  }
  if (results.length === 2) {
    console.log('\nbusiest task, ms: first → second');
    for (let i = 0; i < results[0].rows.length; i++) {
      const a = results[0].rows[i];
      const b = results[1].rows[i];
      console.log(`${a.move.padEnd(18)} ${String(a['busiest task ms']).padStart(7)} → ${String(b['busiest task ms']).padStart(7)}   (move ${a['move total ms']} → ${b['move total ms']})`);
    }
  }
})().catch((e) => {
  console.error('MOVES FAILED:', String((e && e.message) || e).split('\n')[0]);
  process.exit(1);
});
