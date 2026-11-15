const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
/*
 * How long the job card's 3D car takes to open (v0.20), on a built app, the CPU slowed down as on a phone:
 * from the tap on "Job card" to the car drawn (the 3D part loaded, the car built, the first frame) — the first
 * time on a page (the 3D part is fetched and read) and again (it is already there). Two builds side by side:
 *   npm run build && node e2e/jobcard3d.cjs dist [cpuSlowdown] [otherDist] [runs]
 */
const DIRS = [process.argv[2] || 'dist', process.argv[4]].filter(Boolean);
const SLOW = Number(process.argv[3] || 4);
const RUNS = Number(process.argv[5] || 3);

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
      // WebGL in a headless browser: the software renderer.
      return await chromium.launch(channel === 'chromium' ? { args: ['--enable-unsafe-swiftshader'] } : { channel, args: ['--enable-unsafe-swiftshader'] });
    } catch {
      // next
    }
  }
  throw new Error('no browser');
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function run(dir) {
  const { server, base } = await serve(dir);
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(base + '#/settings?tab=data');
  await page.getByRole('button', { name: 'Загрузить демо-данные' }).click();
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.querySelector('button[data-loading]'), null, { timeout: 120000 });
  const cold = [];
  const warm = [];
  for (let r = 0; r < RUNS; r++) {
    await page.goto(base + '#/');
    await page.reload();
    const row = page.locator('.screen[data-role="top"] .job-row').first();
    await row.waitFor();
    await row.click();
    const chip = page.locator('.screen[data-role="top"] button.vin-chip[aria-label="Job card"]');
    await chip.waitFor();
    await page.waitForTimeout(1500);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });
    for (const into of [cold, warm]) {
      const t0 = await page.evaluate(() => performance.now());
      await chip.click();
      // Drawn: the frame is no longer waiting and the canvas has its size.
      await page.waitForFunction(() => {
        const host = document.querySelector('.car3d');
        const c = host?.querySelector('canvas.car3d-canvas');
        return host && !host.hasAttribute('data-loading') && c && c.width > 0;
      }, null, { timeout: 60000 });
      // One more frame: the car is on the screen.
      const t1 = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now())))));
      into.push(t1 - t0);
      await page.getByRole('dialog', { name: 'Job card' }).getByRole('button', { name: 'Готово' }).click();
      await page.getByRole('dialog', { name: 'Job card' }).waitFor({ state: 'detached' }).catch(() => undefined);
      await page.waitForTimeout(900);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.detach();
  }
  await browser.close();
  server.close();
  return { build: dir, cpu: `×${SLOW}`, 'first open ms (median)': Math.round(median(cold)), 'again ms (median)': Math.round(median(warm)), runs: cold.map((x, i) => `${Math.round(x)}/${Math.round(warm[i])}`).join(' ') };
}

(async () => {
  const rows = [];
  for (const d of DIRS) rows.push(await run(d));
  console.table(rows);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
