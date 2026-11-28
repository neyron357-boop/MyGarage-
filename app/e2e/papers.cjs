const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/*
 * v1.05, «Инвойсы поставщиков» — the multi-scanner, as the owner uses it (phone 390×844 with the iPhone's tap labels, PC
 * 1440×900). The garage's AI is played in the page (what each picture is read as is said by its file's name); every seller,
 * TRN, number, part and price is made up:
 * - «Деньги → Расходы → Инвойсы поставщиков»: four papers picked at once (one twice — told), read by themselves;
 * - a seller new to the base added off its paper, known again by its TRN on the next one; a twin; an expense it already is;
 * - a paper's sheet: its photo, its seller, its day, its lines; «Записать расходом» with «Отменить»;
 * - what it taught: the supplier's card (its invoices, what it sold most, for which makes), «+ Цена» of a Toyota job's line
 *   («Из прайса» — its price from the invoice), the «Поставщики» of that job («Брали»).
 * Screenshots — test-results/papers/.
 *
 * Usage: start the dev server afresh (npm run dev -- --port 5173), then: node e2e/papers.cjs (BASE_URL to aim elsewhere).
 */
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const OUT = path.join(__dirname, '..', 'test-results', 'papers');
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

const SELLER = { vendor: 'Al Noor Auto Spare Parts LLC', vendorTrn: '100000000000003', vendorPhone: '+971500000001', vendorAddress: 'Industrial Area 4, Sharjah', kind: 'parts' };
const READS = {
  A: {
    isReceipt: true,
    ...SELLER,
    invoiceNo: 'INV-0420',
    dateText: '05/02/2025',
    date: '2025-02-05',
    carText: 'TOYOTA HIACE 2018',
    items: [
      { name: 'Brake pad front', part: 'FRONT BRAKE PADS', qty: 1, unitPrice: 180, total: 180 },
      { name: 'Oil filter', part: 'OIL FILTER', qty: 2, unitPrice: 25, total: 50 },
      { name: 'Spark plug NGK', part: 'SPARK PLUG', qty: 4, unitPrice: 20, total: 80 },
    ],
    subtotal: 310,
    vat: 15.5,
    total: 325.5,
    confidence: 0.9,
  },
  B: {
    isReceipt: true,
    ...SELLER,
    vendor: 'AL-NOOR SPARE PARTS',
    vendorPhone: '',
    invoiceNo: 'INV-0533',
    dateText: '10/06/2025',
    date: '2025-06-10',
    carText: 'TOYOTA HIACE',
    items: [{ name: 'Brake pad front', part: 'FRONT BRAKE PADS', qty: 1, unitPrice: 175, total: 175 }],
    total: 175,
    confidence: 0.9,
  },
  C: { isReceipt: true, ...SELLER, invoiceNo: 'INV 420', dateText: '05/02/2025', date: '2025-02-05', items: [{ name: 'Brake pad front', qty: 1, unitPrice: 180, total: 180 }], total: 325.5, confidence: 0.9 },
  D: { isReceipt: true, vendor: 'Gulf Radiators Workshop', kind: 'service', invoiceNo: '7701', dateText: '20/11/2026', date: '2026-11-20', items: [{ name: 'Radiator repair', part: 'RADIATOR REPAIR', qty: 1, unitPrice: 300, total: 300 }], total: 300, confidence: 0.9 },
};

(async () => {
  const browser = await launch();
  const errors = [];
  const results = [];
  const check = (ok, what) => {
    results.push(`${ok ? 'ok' : 'FAIL'} ${what}`);
    console.log(`${ok ? 'ok' : 'FAIL'} ${what}`);
  };
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  };
  /** The AI played: a picture is told by the file's name its paper was taken in under. */
  const playAi = (page) =>
    page.evaluate(async (reads) => {
      const { setAiTransport } = await import('/src/services/ai.ts');
      const { picture } = await import('/src/services/receipts.ts');
      const { mediaBlob } = await import('/src/services/media.ts');
      const { db } = await import('/src/db/db.ts');
      window.__asked = [];
      setAiTransport(async (p, body) => {
        if (p !== 'receipt') throw new Error('not played: ' + p);
        await new Promise((r) => setTimeout(r, 400));
        for (const paper of await db.papers.toArray()) {
          const m = await db.media.get(paper.mediaId);
          const blob = await mediaBlob(paper.mediaId);
          if (!m || !blob) continue;
          if ((await picture(blob, 2048)).data !== body.image.data) continue;
          const word = (m.name ?? '').slice(0, 1);
          window.__asked.push(word);
          return reads[word];
        }
        throw new Error('not known');
      });
    }, READS);
  /** A paper's photo: a white sheet with an invoice's lines on it (JPEG bytes). */
  const paperJpeg = (page, word) =>
    page.evaluate(async (w) => {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 1200;
      const g = c.getContext('2d');
      g.fillStyle = '#fbfaf6';
      g.fillRect(0, 0, 900, 1200);
      g.fillStyle = '#222';
      g.font = 'bold 44px serif';
      g.fillText(w === 'D' ? 'GULF RADIATORS' : 'AL NOOR AUTO SPARE PARTS', 60, 110);
      g.font = '28px monospace';
      g.fillText(`TAX INVOICE   No ${w}-${w.charCodeAt(0)}`, 60, 190);
      for (let i = 0; i < 9; i++) g.fillText(`${i + 1}. PART ${w}${i}   ${(i + 1) * 15}.00`, 60, 290 + i * 60);
      g.fillText(`TOTAL  ${w.charCodeAt(0) * 3}.50`, 520, 1000);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    }, word);

  /* ---------- The phone ---------- */
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  await phoneCtx.addInitScript(() => {
    localStorage.setItem('mygarage.feedback', '0');
    localStorage.setItem('mygarage.hapticLabels', '1');
  });
  const page = await phoneCtx.newPage();
  watch(page);
  const top = (sel) => page.locator(`.screen[data-role="top"] ${sel}`);
  const settle = (ms = 500) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
  await page.goto(BASE + '#/');
  await settle(1500);
  // The base: a customer and a Toyota Hiace job with front brake pads; an expense of the radiator workshop already there.
  const jobId = await page.evaluate(async () => {
    const { checkIn } = await import('/src/services/orders.ts');
    const { addItem } = await import('/src/services/estimate.ts');
    const { addExpense } = await import('/src/services/money.ts');
    const { db } = await import('/src/db/db.ts');
    const o = await checkIn({ plate: { emirate: 'DXB', code: 'H', number: String(40000 + Math.floor(Math.random() * 9000)) }, make: 'Toyota', model: 'Hiace', name: 'Sam Test', phone: '', docLanguage: 'en', complaint: '', arrivedNow: true });
    await addItem(o.id, { kind: 'part', block: 'A', titleEn: 'FRONT BRAKE PADS', qty: 1 });
    const cats = await db.expenseCategories.toArray();
    await addExpense({ date: '2026-11-20', categoryId: cats[0].id, amountFils: 30000, vatFils: 0, vendor: 'Gulf Radiators Workshop', method: 'cash', note: '' });
    return o.id;
  });
  await playAi(page);

  // 1. «Деньги → Расходы»: the way in.
  await page.goto(BASE + '#/money?tab=expenses');
  await top('[data-open-papers]').waitFor({ timeout: 15000 });
  check(true, '«Инвойсы поставщиков» under «Добавить расход»');
  await top('[data-open-papers]').click();
  await top('[data-papers]').waitFor({ timeout: 10000 });
  await settle(600);
  await shot('phone-01-empty');
  check((await top('[data-papers-camera]').count()) === 1 && (await top('[data-papers-photos]').count()) === 1, '«Снять» and «Фото и PDF» — the two ways in');

  // 2. Four papers picked at once (A twice): three in, one told as taken before; read by themselves.
  const files = [];
  for (const w of ['A', 'B', 'C', 'D']) files.push({ name: `${w}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(await paperJpeg(page, w), 'base64') });
  files.push({ ...files[0] });
  await page.locator('[data-papers-pick]').setInputFiles(files);
  await top('[data-papers-reading]').waitFor({ timeout: 10000 }).catch(() => undefined);
  await shot('phone-02-reading');
  const until = async (fn, ms = 30000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await page.evaluate(fn).catch(() => undefined);
      if (v || Date.now() > end) return v;
      await settle(300);
    }
  };
  const counts = await until(async () => {
    const { loadPapers } = await import('/src/services/papers.ts');
    const v = await loadPapers();
    return v.counts.waiting === 0 && v.counts.all === 4 ? v.counts : undefined;
  });
  check(!!counts && counts.done + counts.look === 3 && counts.twin === 1, `read by themselves: 3 learnt, 1 twin (${JSON.stringify(counts)})`);
  await settle(2000);
  await shot('phone-03-read');
  const learnt = await top('[data-papers-learnt]').innerText().catch(() => '');
  check(/2\s*поставщик/.test(learnt) && /новых|новый/.test(learnt), `what they taught is said: «${learnt.replace(/\s+/g, ' ')}»`);
  const sellers = await page.evaluate(async () => (await (await import('/src/db/db.ts')).db.suppliers.toArray()).map((s) => [s.name, s.phone ?? '', s.notes ?? '', !!s.service]));
  check(sellers.filter(([n]) => /noor/i.test(n)).length === 1, 'the seller new to the base added once (known again by its TRN): ' + JSON.stringify(sellers));
  check(sellers.some(([n, , notes]) => /noor/i.test(n) && /TRN 100000000000003/.test(notes)), 'its TRN in its notes');
  check(sellers.some(([n, , , svc]) => /gulf/i.test(n) && svc), 'the radiator workshop — a contractor');

  // 3. The twin, and the expense it already is.
  await top('[data-papers-filter="twin"]').click();
  await settle(400);
  check((await top('[data-paper-state="twin"]').count()) === 1, '«Дубли» — the same invoice photographed again');
  await shot('phone-04-twins');
  await top('[data-papers-filter="all"]').click();
  await settle(400);
  const gulf = await page.evaluate(async () => (await (await import('/src/db/db.ts')).db.papers.toArray()).find((p) => /gulf/i.test(p.vendor ?? '')));
  check(!!gulf?.expenseId, 'the radiator workshop’s invoice is told as the expense already recorded');

  // 4. A paper's sheet: its photo, its seller (new), its day, its lines; «Записать расходом» with «Отменить».
  const a = await page.evaluate(async () => (await (await import('/src/db/db.ts')).db.papers.toArray()).find((p) => p.lines?.length === 3 && p.state !== 'twin'));
  const looks = await page.evaluate(async () => { const { paperDoubts } = await import('/src/domain/papers.ts'); return (await (await import('/src/db/db.ts')).db.papers.toArray()).filter((p) => p.state === 'look').map((p) => [p.vendor, paperDoubts(p)]); });
  console.log('to look at:', JSON.stringify(looks));
  await top(`[data-paper="${a.id}"]`).click();
  const sheet = page.locator(`[data-paper-sheet="${a.id}"]`);
  await sheet.waitFor({ timeout: 8000 });
  await settle(900);
  await shot('phone-05-paper');
  check((await sheet.locator('[data-paper-line]').count()) === 3, 'its three lines');
  check(/Al Noor Auto Spare Parts LLC/.test(await sheet.locator('[data-paper-seller]').innerText()), 'its seller, by its fullest name');
  check((await page.locator('[data-papers] .papers-tag[data-tone="new"]').count()) >= 2, 'the papers that added a supplier say «новый»');
  await sheet.locator('[data-paper-expense]').click();
  await settle(700);
  const ex = await page.evaluate(async (id) => !!(await (await import('/src/db/db.ts')).db.papers.get(id))?.expenseId, a.id);
  check(ex, '«Записать расходом» — an expense now');
  await shot('phone-06-recorded');
  await page.locator('.mantine-Notification-root button', { hasText: 'Отменить' }).first().click();
  await settle(700);
  const back = await page.evaluate(async (id) => !(await (await import('/src/db/db.ts')).db.papers.get(id))?.expenseId, a.id);
  check(back, '«Отменить» — the expense gone again');
  await page.keyboard.press('Escape');
  await settle(500);

  // 5. The supplier's card: its invoices, what it sold most, for which makes.
  await page.goto(BASE + '#/parts?tab=suppliers');
  await settle(1500);
  await top('.list-row', { hasText: 'Al Noor' }).first().click().catch(async () => top(`text=Al Noor`).first().click());
  const card = page.locator('[data-supplier-papers]');
  await card.waitFor({ timeout: 8000 });
  await settle(600);
  await shot('phone-07-supplier-card');
  const cardText = await card.innerText();
  check(/2\s*инвойса/i.test(cardText) && /FRONT BRAKE PADS/.test(cardText) && /Toyota/.test(cardText), `its card: «${cardText.replace(/\s+/g, ' ').slice(0, 160)}»`);
  await page.keyboard.press('Escape');
  await settle(400);

  // 6. A Toyota Hiace job: «+ Цена» of its front brake pads — «Из прайса», the invoice's price.
  await page.goto(BASE + `#/orders/${jobId}`);
  await top('.price-add').first().waitFor({ timeout: 10000 });
  await top('.price-add').first().click();
  const hint = page.locator('[data-price-hints] .price-hint').first();
  await hint.waitFor({ timeout: 8000 });
  await settle(500);
  await shot('phone-08-price-hint');
  const hintText = await hint.innerText();
  check(/Noor/.test(hintText) && /175/.test(hintText) && /инвойс/.test(hintText), `«Из прайса»: «${hintText.replace(/\s+/g, ' ')}»`);
  await page.keyboard.press('Escape');
  await settle(400);
  const why = await page.evaluate(async (id) => {
    const { suppliersForJob } = await import('/src/services/supplierRank.ts');
    const j = await suppliersForJob(id, 'ru');
    const r = j.parts.find((x) => /noor/i.test(x.supplier.name));
    return r ? r.why.map((w) => w.kind) : [];
  }, jobId);
  check(why.includes('sold') && why.includes('boughtFor'), '«Поставщики» of the job: it sold this part for Toyota — ' + JSON.stringify(why));
  // v1.06: under the job's line — the history's prices for this car (a tap — its cost); «Цены из истории · N» above the lines.
  const chip = top('[data-hist-offers] .hist-offer').first();
  await chip.waitFor({ timeout: 8000 });
  const chipText = await chip.innerText();
  check(/Al Noor/.test(chipText) && /175/.test(chipText) && /Hiace/.test(chipText), `under the line, the history's price: «${chipText.replace(/\s+/g, ' ')}»`);
  await shot('phone-09-history-prices');
  check((await top('[data-hist-fill]').count()) === 1, '«Цены из истории · 1» above the lines');
  await top('[data-hist-put]').click();
  await settle(900);
  const priced = await page.evaluate(async (id) => {
    const { db } = await import('/src/db/db.ts');
    const i = (await db.items.where('orderId').equals(id).toArray()).find((x) => x.kind === 'part');
    return { cost: i?.costPriceFils, price: i?.unitPriceFils, from: !!i?.costFrom };
  }, jobId);
  check(priced.cost === 17500 && priced.price > 17500 && priced.from, '«Поставить»: the cost 175 and the customer’s price by the markup — ' + JSON.stringify(priced));
  check((await top('[data-hist-offers] .hist-offer[data-active]').count()) === 1, 'the price taken marked under the line');
  await shot('phone-09b-history-set');
  await page.locator('.mantine-Notification-root button', { hasText: 'Отменить' }).first().click();
  await settle(900);
  const undone = await page.evaluate(async (id) => {
    const { db } = await import('/src/db/db.ts');
    const i = (await db.items.where('orderId').equals(id).toArray()).find((x) => x.kind === 'part');
    return i?.costPriceFils === undefined && !i?.costFrom;
  }, jobId);
  check(undone, '«Отменить» — the cost gone again');
  // v1.06: the suggestions — the part bought for this car, said with a car
  await top('[data-add-line]').click();
  await settle(600);
  await page.keyboard.type('brake');
  const bought = page.locator('.qa-row .qa-bought').first();
  await bought.waitFor({ timeout: 8000 });
  const boughtText = await bought.innerText();
  check(/Al Noor/.test(boughtText) && /175/.test(boughtText) && (await bought.getAttribute('data-qa-bought')) === '2', `the suggestion bought for this car: «${boughtText}»`);
  await shot('phone-09c-suggestion-bought');
  await page.keyboard.press('Escape');
  await settle(500);
  // «Поставщики»: the one who sold it for this model picked at once, «Брали … для Hiace · 175».
  await top('button.add-extra[aria-label="Поставщики"]').click();
  const noorRow = page.locator('.ask-row[data-ask-supplier]', { hasText: 'Al Noor' }).first();
  await noorRow.waitFor({ timeout: 8000 });
  await settle(700);
  await shot('phone-10-ask-picked');
  const rowText = await noorRow.innerText();
  check((await noorRow.getAttribute('aria-pressed')) === 'true' && /Брали .* для Hiace/.test(rowText) && /175/.test(rowText), `the seller of it picked at once: «${rowText.replace(/s+/g, ' ')}»`);
  await page.keyboard.press('Escape');
  await settle(500);
  // v1.06: «Поставщики» searched by a part and a car — who sold it to the garage, for how much; «Спросить снова».
  await page.goto(BASE + '#/parts?tab=suppliers&q=' + encodeURIComponent('brake pads hiace'));
  // (a fresh start on that address: the suppliers' screen of step 5 is still in the stack, its search empty)
  await page.reload();
  const hit = page.locator('[data-bought-search] .list-row').first();
  await hit.waitFor({ timeout: 10000 });
  await settle(600);
  await shot('phone-11-bought-search');
  const hitText = await hit.innerText();
  check(/BRAKE/i.test(hitText) && /Al Noor/.test(hitText) && /Hiace/.test(hitText) && /175/.test(hitText), `the parts bought searched: «${hitText.replace(/\s+/g, ' ')}»`);
  await phoneCtx.close();

  /* ---------- The PC ---------- */
  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await deskCtx.addInitScript(() => localStorage.setItem('mygarage.feedback', '0'));
  const desk = await deskCtx.newPage();
  watch(desk);
  await desk.goto(BASE + '#/money/papers');
  await desk.waitForTimeout(1500);
  // Its own data (another browser): the same papers taken in on the PC.
  await playAi(desk);
  const deskFiles = [];
  for (const w of ['A', 'B', 'D']) deskFiles.push({ name: `${w}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(await paperJpeg(desk, w), 'base64') });
  await desk.locator('[data-papers-pick]').setInputFiles(deskFiles);
  await desk.locator('[data-paper-state="done"]').nth(2).waitFor({ timeout: 30000 }).catch(() => undefined);
  await desk.waitForTimeout(2000);
  await desk.screenshot({ path: `${OUT}/desk-01-papers.png` });
  check((await desk.locator('[data-paper]').count()) >= 3, 'PC: the papers listed');
  await desk.locator('[data-paper]').first().click();
  await desk.waitForTimeout(1200);
  await desk.screenshot({ path: `${OUT}/desk-02-paper.png` });
  await deskCtx.close();

  await browser.close();
  console.log(`ERRORS: ${errors.length ? errors.join(' | ') : 'none'}`);
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(failed.length || errors.length ? 'PAPERS E2E FAILED' : 'PAPERS E2E OK');
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
