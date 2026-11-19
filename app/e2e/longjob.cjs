const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
/*
 * A long job on the phone (v0.56): thirty parts on a job of the demo, each with a diagram and a photo as the AI keeps
 * them — the job opened, its lines scrolled and picked, a part's sheet opened, typed in and closed. For each move the
 * main thread's busiest task (what stands between the tap and the first frame) and the whole move, from a Chrome trace
 * at a phone's speed (CPU ×4). Serves a built app itself, so two builds compare side by side (the numbers move by
 * 10–20 ms from run to run: run both orders):
 *   npm run build && node e2e/longjob.cjs dist [otherDist]        LINES=30, SLOW=4
 */
const DIRS = process.argv.slice(2).filter(Boolean);
const SLOW = Number(process.env.SLOW || 4);
const LINES = Number(process.env.LINES || 30);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
function serve(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((rq, res) => {
    const url = decodeURIComponent((rq.url || '/').split('?')[0]);
    let file = path.join(root, url === '/' ? 'index.html' : url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/` })));
}

/** An open job of the demo given LINES parts, each with a diagram and a photo as the AI keeps them (straight into the database). */
function longJob(page, n) {
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
    const [orders, items] = await Promise.all([all('orders'), all('items')]);
    const open = orders.filter((o) => !['closed', 'cancelled'].includes(o.stage) && !o.archivedAt);
    // The job with the most draft lines (still editable), else any open one.
    const job = open.sort((a, b) => items.filter((i) => i.orderId === b.id && i.approvalState === 'draft').length - items.filter((i) => i.orderId === a.id && i.approvalState === 'draft').length)[0];
    const pic = (w, h, bg, type) => new Promise((res) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#222';
      for (let i = 0; i < 40; i++) g.strokeRect(10 + i * 7, 10 + ((i * 13) % (h - 60)), 60, 40);
      c.toBlob((b) => res(b), type, 0.8);
    });
    const [diagram, dThumb, photo, pThumb] = await Promise.all([pic(760, 1100, '#fff', 'image/png'), pic(276, 400, '#fff', 'image/jpeg'), pic(800, 600, '#567', 'image/jpeg'), pic(400, 300, '#567', 'image/jpeg')]);
    const id = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const now = new Date().toISOString();
    const names = ['AC COMPRESSOR', 'AC CONDENSER', 'EXPANSION VALVE', 'FRONT BRAKE PADS', 'REAR BRAKE PADS', 'OIL FILTER', 'AIR FILTER', 'CABIN FILTER', 'SPARK PLUG', 'WATER PUMP', 'RADIATOR HOSE', 'FAN BELT', 'LOWER ARM', 'LINK ROD', 'SHOCK ABSORBER'];
    const put = { items: [], media: [], mediaBlobs: [] };
    for (let k = 0; k < n; k++) {
      const iid = id();
      const d = id();
      const p = id();
      put.media.push({ id: d, ownerType: 'item', ownerId: iid, slot: 'diagram', kind: 'photo', mime: 'image/png', size: diagram.size, sha256: d, name: 'https://www.megazip.net/parts/x', locked: false, createdAt: now });
      put.media.push({ id: p, ownerType: 'item', ownerId: iid, slot: 'sample', kind: 'photo', mime: 'image/jpeg', size: photo.size, sha256: p, name: 'https://partsouq.com/', locked: false, createdAt: now });
      put.mediaBlobs.push({ id: d, blob: diagram, thumb: dThumb, up: 1 });
      put.mediaBlobs.push({ id: p, blob: photo, thumb: pThumb, up: 1 });
      put.items.push({ id: iid, orderId: job.id, kind: 'part', block: 'A', titleEn: `${names[k % names.length]} ${Math.floor(k / names.length) || ''}`.trim(), qty: 1, unitPriceFils: 10000 + k * 500, vatRateBp: 500, approvalState: 'draft', procurementStatus: 'needed', position: 100 + k, createdAt: now, updatedAt: now, partNumber: k % 2 ? `04465-${60000 + k}` : undefined, diagramIds: [d], sampleIds: [p], aiFind: { at: now, search: 'web', part: 'x', numbers: [{ number: `04465-${60000 + k}`, seen: ['https://www.megazip.net/parts/x'], fits: true, name: 'Pad Kit, Disc Brake, Front', model: 'Land Cruiser GRJ200 · 2007–2021' }, { number: `04465-${70000 + k}`, seen: ['https://partsouq.com/x'] }] } });
    }
    await new Promise((res, rej) => {
      const tx = db.transaction(Object.keys(put), 'readwrite');
      for (const [store, list] of Object.entries(put)) for (const r of list) tx.objectStore(store).put(r);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return job.id;
  }, n);
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
  const jobId = await longJob(page, LINES);
  await page.goto(base + '#/');
  await top('.job-row').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });

  const out = [];
  const measure = async (name, fn) => {
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
    const big = [...best.tasks].sort((a, b) => (b.tdur || 0) - (a.tdur || 0))[0];
    out.push({ move: name, 'until done ms': wall, 'busiest task ms': +((big?.tdur || 0) / 1000).toFixed(1), 'move total ms': +(best.cpu / 1000).toFixed(0), 'tasks > 50 ms': best.tasks.filter((e) => (e.tdur || 0) > 50000).length });
  };

  await measure('open the long job', async () => {
    await page.evaluate((id) => (location.hash = '#/orders/' + id), jobId);
    await top('.list-row').nth(LINES - 1).waitFor({ timeout: 60000 });
  });
  await measure('scroll its lines', async () => {
    await page.evaluate(async () => {
      const el = document.querySelector('.screen[data-role="top"] .screen-scroll');
      await new Promise((done) => {
        let n = 0;
        const tick = () => {
          el.scrollTop += 40;
          if (++n < 90) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
    });
  });
  await measure('«…» → pick lines', async () => {
    await page.locator('.screen[data-role="top"] .nav-bar .mantine-ActionIcon-root').last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Править' }).click();
    await page.getByRole('button', { name: 'Отмена' }).waitFor();
  });
  await measure('pick a line', async () => {
    await top('.list-row').filter({ hasText: 'OIL FILTER' }).first().click();
    await page.waitForTimeout(250);
  });
  await measure('pick another', async () => {
    await top('.list-row').filter({ hasText: 'AIR FILTER' }).first().click();
    await page.waitForTimeout(250);
  });
  await measure('leave picking', async () => {
    await page.getByRole('button', { name: 'Отмена' }).click();
    await page.waitForTimeout(250);
  });
  await measure('a part’s sheet up', async () => {
    await top('.list-row').filter({ hasText: 'WATER PUMP' }).first().click();
    await page.getByRole('dialog').waitFor();
  });
  await measure('type in the sheet', async () => {
    await page.getByRole('dialog').getByLabel('Запчасть').click();
    for (const ch of 'new') await page.keyboard.type(ch, { delay: 60 });
    await page.waitForTimeout(200);
  });
  await measure('the sheet down', async () => {
    await page.locator('.mantine-Modal-close').first().click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  });
  await browser.close();
  server.close();
  return out;
}

(async () => {
  const results = [];
  for (const d of DIRS) results.push({ dir: d, rows: await run(d) });
  for (const r of results) {
    console.log(`\n${r.dir} (CPU ×${SLOW}, ${LINES} parts)`);
    console.table(r.rows);
  }
  if (results.length === 2) {
    console.log('\nbusiest task, ms: first → second   (the whole move)');
    for (let i = 0; i < results[0].rows.length; i++) {
      const a = results[0].rows[i];
      const b = results[1].rows[i];
      console.log(`${a.move.padEnd(22)} ${String(a['busiest task ms']).padStart(7)} → ${String(b['busiest task ms']).padStart(7)}   (${a['move total ms']} → ${b['move total ms']})`);
    }
  }
})().catch((e) => {
  console.error('FAILED:', String((e && e.message) || e).split('\n').slice(0, 3).join(' | '));
  process.exit(1);
});
