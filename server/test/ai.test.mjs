import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { builtWhere, createAi, parseJson } from '../src/ai.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-ai-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const answer = (obj, extra = {}) => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, ...extra }] });

function fake(routes) {
  const seen = [];
  const f = async (url, init = {}) => {
    seen.push({ url: String(url), body: init.body ? JSON.parse(init.body) : undefined });
    for (const [re, fn] of routes) if (re.test(String(url))) return fn(String(url), init);
    return new Response('no', { status: 404 });
  };
  return { f, seen };
}

describe('helpers', () => {
  it('reads the JSON a model wrote, in a fence or among words', () => {
    assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseJson('Here it is: {"n":[1,2]} — done'), { n: [1, 2] });
    assert.equal(parseJson('no json'), undefined);
  });
  it('says where a VIN’s car was built by its first characters', () => {
    assert.equal(builtWhere('JTDBR42E39J016456'), 'Japan');
    assert.equal(builtWhere('4T1B11HK5JU123456'), 'USA');
    assert.equal(builtWhere('MR0FZ29G601000000'), 'Thailand');
    assert.equal(builtWhere('x'), '');
  });
});

describe('the AI', () => {
  it('is off without a key; the key set here is kept in Служебное/ai.json', () => {
    const ai = createAi({ dataDir: dir, env: {}, fetchImpl: async () => json({}) });
    assert.equal(ai.on(), false);
    ai.setKey('AQ.test-key-1234567890');
    assert.equal(ai.on(), true);
    assert.equal(ai.status().key, '…7890');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'Служебное', 'ai.json'), 'utf8')).key, 'AQ.test-key-1234567890');
    assert.equal(createAi({ dataDir: dir, env: {} }).on(), true);
  });

  it('decodes a VIN: the official decoder’s facts go to Gemini with it; the next busy model answers; asked once', async () => {
    let tries = 0;
    const { f, seen } = fake([
      [/vpic\.nhtsa/, () => json({ Results: [{ Make: 'TOYOTA', ModelYear: '2009', PlantCountry: 'JAPAN' }] })],
      [/gemini-3\.5-flash-lite/, () => (tries++, json({ error: { message: 'high demand' } }, 503))],
      [/gemini-3\.1-flash-lite/, () => answer({ make: 'Toyota', model: 'Corolla', year: 2009, engine: '1.8L 4-cyl', body: 'sedan', confidence: 0.9 })],
    ]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f });
    const r = await ai.vin('jtdbr42e39j016456');
    assert.deepEqual([r.make, r.model, r.year, r.engine, r.body], ['Toyota', 'Corolla', 2009, '1.8L 4-cyl', 'sedan']);
    assert.equal(r.facts.make, 'TOYOTA');
    const ask = seen.find((x) => /gemini-3\.1-flash-lite/.test(x.url));
    assert.match(ask.body.contents[0].parts[0].text, /JTDBR42E39J016456[\s\S]*"make":"TOYOTA"/);
    assert.equal(ask.body.generationConfig.responseMimeType, 'application/json');
    // The key goes in the header only, never in an address.
    assert.ok(seen.every((x) => !x.url.includes('AQ.k-')));
    await ai.vin('JTDBR42E39J016456');
    assert.equal(tries, 1);
    // The busy one is passed over for a while: the next question goes straight to the one that answered.
    await ai.partName({ name: 'oil filter' }).catch(() => {});
    assert.equal(tries, 1);
    await assert.rejects(ai.vin('NOTAVIN'), /not a VIN/);
  });

  it('v0.88: a VIN — no model named in the question (a light model gave back «Land Cruiser» for an Indonesian Veloz), its maker’s code said; the stronger model first, thinking a little', async () => {
    const { f, seen } = fake([
      [/vpic\.nhtsa/, () => json({ Results: [{ Make: 'TOYOTA', ModelYear: '2023' }] })],
      [/generateContent/, () => answer({ make: 'Toyota', model: 'Veloz', year: 2023, engine: '1.5L 4-cyl', body: 'mpv', confidence: 0.8 })],
    ]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f });
    const r = await ai.vin('MHFAB1BY4P3069309');
    assert.equal(r.model, 'Veloz');
    const ask = seen.find((x) => /generateContent/.test(x.url));
    assert.match(ask.url, /gemini-3\.8-flash:/);
    const text = ask.body.contents[0].parts[0].text;
    assert.doesNotMatch(text, /Land Cruiser|Camry|Corolla/);
    assert.match(text, /"MHF"[\s\S]*Indonesia[\s\S]*"AB1BY"/);
    assert.equal(ask.body.generationConfig.thinkingConfig.thinkingLevel, 'low');
  });

  it('a part’s name: its mistakes put right, its English name', async () => {
    const { f, seen } = fake([[/generateContent/, () => answer({ fixed: 'колодки тормозные', english: 'BRAKE PADS', isPart: true, confidence: 0.92 })]]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f });
    const r = await ai.partName({ name: 'колодки тормазные', make: 'Toyota', model: 'Camry', year: 2018 });
    assert.equal(r.fixed, 'колодки тормозные');
    assert.equal(r.english, 'BRAKE PADS');
    assert.match(seen[0].body.contents[0].parts[0].text, /for a 2018 Toyota Camry: "колодки тормазные"/);
  });

  it('a VIN the official decoder knows whole is not asked of Gemini; the answers are kept in the store for every device and restart', async () => {
    let gemini = 0;
    const rows = new Map();
    const store = { aiCacheGet: (k) => rows.get(k), aiCachePut: (k, kind, at, value) => rows.set(k, { at, value, kind }) };
    const { f } = fake([
      [/vpic\.nhtsa/, () => json({ Results: [{ Make: 'TOYOTA', Model: 'Camry', ModelYear: '2018', DisplacementL: '2.5', EngineCylinders: '4', BodyClass: 'Sedan/Saloon', PlantCountry: 'UNITED STATES (USA)' }] })],
      [/generateContent/, () => (gemini++, answer({ fixed: 'oil filter', english: 'OIL FILTER', isPart: true, confidence: 0.9 }))],
    ]);
    const one = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f, store });
    const v = await one.vin('4T1B11HK5JU123456');
    assert.deepEqual([v.by, v.make, v.model, v.year, v.engine, v.body, v.built], ['nhtsa', 'Toyota', 'Camry', 2018, '2.5L 4-cyl', 'sedan', 'USA']);
    assert.equal(gemini, 0);
    await one.partName({ name: 'oil filtre' });
    assert.equal(gemini, 1);
    assert.equal(rows.size, 2);
    // Another start (another server, a restart): the same questions, the store's answers, no tokens.
    const two = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f, store });
    assert.equal((await two.vin('4T1B11HK5JU123456')).by, 'nhtsa');
    assert.equal((await two.partName({ name: 'oil filtre' })).english, 'OIL FILTER');
    assert.equal(gemini, 1);
  });

  it('a receipt photographed (v0.50): a light model reads it with the picture, the sums come as numbers; the same picture is not asked twice; no picture — 400', async () => {
    const { f, seen } = fake([
      [/gemini-3\.8-flash/, () => answer({ isReceipt: true, kind: 'parts', dateText: '18-Nov-2026', dateSure: true, vendor: 'AL QUOZ AUTO PARTS', vendorPhone: '050 442 1190', invoiceNo: 'A-1042', date: '2026-11-18', items: [{ name: 'OIL FILTER', partNumber: '90915-YZZE1', qty: 1, unitPrice: 35, total: 35 }], subtotal: '35', vat: '1.75', total: 36.75, paymentMethod: 'cash', carText: '', confidence: 0.9 })],
    ]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f });
    const image = { type: 'image/jpeg', data: 'x'.repeat(5000) };
    const r = await ai.receipt({ image });
    assert.deepEqual([r.vendor, r.vendorPhone, r.kind, r.subtotal, r.vat, r.total, r.items[0].partNumber, r.by], ['AL QUOZ AUTO PARTS', '050 442 1190', 'parts', 35, 1.75, 36.75, '90915-YZZE1', 'gemini-3.8-flash']);
    // A paper's figures and its date: the stronger model reads it (v0.50.2), the date as printed with it.
    assert.equal(r.dateText, '18-Nov-2026');
    const ask = seen.find((x) => /gemini-3\.8-flash/.test(x.url));
    const pic = ask.body.contents[0].parts.find((p) => p.inline_data);
    assert.deepEqual(pic.inline_data, { mime_type: 'image/jpeg', data: image.data });
    assert.equal(ask.body.generationConfig.responseMimeType, 'application/json');
    assert.equal(ask.body.generationConfig.thinkingConfig.thinkingLevel, 'low');
    // The paper's kind is asked (parts, a contractor's work, fuel, food, other), with the seller's phone and address.
    const schema = ask.body.generationConfig.responseJsonSchema;
    assert.deepEqual(schema.properties.kind.enum, ['parts', 'service', 'fuel', 'food', 'other']);
    assert.ok(schema.required.includes('kind') && schema.properties.vendorPhone && schema.properties.vendorAddress);
    assert.ok(schema.required.includes('dateText') && schema.properties.dateSure && schema.properties.items.items.properties.part && schema.properties.items.items.properties.car);
    assert.match(ask.body.contents[0].parts[0].text, /day first/);
    // The same paper photographed again (or asked by another device) — the reading kept, no second question.
    await ai.receipt({ image });
    assert.equal(seen.filter((x) => /generateContent/.test(x.url)).length, 1);
    for (const bad of [{ image: { type: 'image/gif', data: 'x'.repeat(5000) } }, { image: { type: 'image/jpeg', data: 'x' } }, {}])
      await assert.rejects(ai.receipt(bad), /no picture/);
  });

  it('v0.89: a car’s make and model off its photo — a light model, low resolution, no thinking, no model named; the same photo once', async () => {
    let first = true;
    const { f, seen } = fake([
      // The first model takes no low resolution (400): asked again at its own, not passed over.
      [/gemini-3\.5-flash-lite/, (url, init) => (JSON.parse(init.body).generationConfig.mediaResolution && first ? ((first = false), new Response('{"error":{"message":"mediaResolution"}}', { status: 400 })) : answer({ isCar: true, make: 'Toyota', model: 'Veloz', confidence: 0.8 }))],
    ]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f });
    const image = { type: 'image/jpeg', data: 'y'.repeat(30_000) };
    const r = await ai.car({ image });
    assert.deepEqual([r.isCar, r.make, r.model, r.by], [true, 'Toyota', 'Veloz', 'gemini-3.5-flash-lite']);
    const asks = seen.filter((x) => /generateContent/.test(x.url));
    assert.equal(asks.length, 2);
    assert.equal(asks[0].body.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW');
    assert.equal(asks[1].body.generationConfig.mediaResolution, undefined);
    assert.equal(asks[0].body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    assert.doesNotMatch(asks[0].body.contents[0].parts[0].text, /Land Cruiser|Camry|Corolla|Patrol/);
    await ai.car({ image });
    assert.equal(seen.filter((x) => /generateContent/.test(x.url)).length, 2);
    for (const bad of [{ image: { type: 'image/gif', data: 'x'.repeat(5000) } }, { image: { type: 'image/jpeg', data: 'x'.repeat(2_000_000) } }, {}])
      await assert.rejects(ai.car(bad), /no picture/);
  });

  it('v0.90: a WhatsApp request — the messages and the last picture at medium resolution, a light model; the same once', async () => {
    const { f, seen } = fake([[/gemini-3.5-flash-lite/, () => answer({ isRequest: true, car: { make: 'Nissan', model: 'Altima', year: 2015, plate: { emirate: 'DXB', code: 'V', number: '12345' }, vin: '' }, items: [{ name: 'ENGINE MOUNT', kind: 'part', both: true }], owner: '', confidence: 0.9 })]]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f });
    const image = { type: 'image/jpeg', data: 'z'.repeat(40_000) };
    const texts = ['I want to change the engine mount', 'Nissan Altima 2015', 'Original or duplicate?', '[photo]'];
    const r = await ai.request({ texts, image });
    assert.deepEqual([r.isRequest, r.car.model, r.items[0].both, r.by], [true, 'Altima', true, 'gemini-3.5-flash-lite']);
    const ask = seen.find((x) => /generateContent/.test(x.url));
    assert.equal(ask.body.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_MEDIUM');
    assert.equal(ask.body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    assert.match(ask.body.contents[0].parts[0].text, /Original or duplicate?/);
    assert.ok(ask.body.contents[0].parts.some((p) => p.inline_data?.data === image.data));
    await ai.request({ texts, image });
    assert.equal(seen.filter((x) => /generateContent/.test(x.url)).length, 1);
    await assert.rejects(ai.request({ texts: [] }), /no messages/);
  });

  it('a device may ask 120 times a minute (a long list of parts is asked at once)', () => {
    let t = 0;
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, now: () => t });
    for (let i = 0; i < 120; i++) ai.allow('d1');
    assert.throws(() => ai.allow('d1'), /too many/);
    ai.allow('d2');
    t = 61_000;
    ai.allow('d1');
  });
});

describe('the AI through the API', () => {
  it('only a paired device asks; without a key — «ai off»; the answer is the AI’s', async () => {
    const { createServer } = await import('node:http');
    const { createApi, createPairing } = await import('../src/api.mjs');
    const { loadConfig } = await import('../src/config.mjs');
    const { openStore } = await import('../src/store.mjs');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-ai-api-'));
    const store = openStore(d, { keepBackups: 1 });
    const pairing = createPairing();
    let on = false;
    const asked = [];
    const ai = { on: () => on, status: () => ({ on }), allow: () => {}, vin: async (v) => (asked.push(v), { make: 'Toyota', model: 'Camry' }), partName: async () => ({}), receipt: async (b) => ({ got: b.image.data.length }) };
    const server = createServer(createApi({ store, config: loadConfig({ DATA_DIR: d }), pairing, log: () => {}, ai }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const code = pairing.issue().code;
      const { token } = await (await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'X-Sync': '2', 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: 'iPhone' }) })).json();
      const ask = (t) => fetch(`${base}/api/ai/vin`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ vin: 'JTNB11HK6J3012345' }) });
      assert.equal((await ask()).status, 401);
      assert.equal((await ask(token)).status, 503);
      on = true;
      const r = await ask(token);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { make: 'Toyota', model: 'Camry' });
      assert.deepEqual(asked, ['JTNB11HK6J3012345']);
      // A receipt's picture is a big body (up to 8 MB, v0.50); any other question is a few lines — 16 KB.
      const post = (p, body) => fetch(`${base}/api/ai/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body });
      const rr = await post('receipt', JSON.stringify({ image: { type: 'image/jpeg', data: 'x'.repeat(200_000) } }));
      assert.equal(rr.status, 200);
      assert.deepEqual(await rr.json(), { got: 200_000 });
      assert.equal((await post('vin', JSON.stringify({ vin: 'x'.repeat(20_000) }))).status, 413);
      // The part-number search is gone (v0.85, the owner's decision): no route for it, nor for its progress.
      assert.equal((await post('part-find', JSON.stringify({ part: 'FRONT BRAKE PADS', make: 'Toyota' }))).status, 404);
      assert.equal((await fetch(`${base}/api/ai/progress?t=a`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);
    } finally {
      server.close();
      store.close();
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('v0.86: the labour line, a supplier’s answer, who chats are — light models, asked once', () => {
  it('says the labour, the light model first with minimal thinking; the same parts — not asked again', async () => {
    const { f, seen } = fake([[/generateContent/, () => answer({ text: 'Labor charge: replace front brake pads' })]]);
    const ai = createAi({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mg-ai-l-')), env: { GEMINI_API_KEY: 'k' }, fetchImpl: f });
    const r = await ai.labour({ parts: ['FRONT BRAKE PADS'] });
    assert.equal(r.text, 'REPLACE FRONT BRAKE PADS');
    assert.match(seen[0].url, /flash-lite/);
    assert.equal(seen[0].body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    await ai.labour({ parts: ['FRONT BRAKE PADS'] });
    assert.equal(seen.length, 1);
    assert.equal(ai.status().usage.today.byKind.labour, 1);
  });

  it('reads a supplier’s answer: the request it answers, each line’s prices; a line number not in the request is dropped', async () => {
    const { f } = fake([[/generateContent/, () => answer({ ask: 'B', lines: [{ n: 1, offers: [{ price: 185, kind: 'oem', brand: '', na: false }] }, { n: 9, offers: [{ price: 1, kind: '', brand: '', na: false }] }], vat: 'excl' })]]);
    const ai = createAi({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mg-ai-r-')), env: { GEMINI_API_KEY: 'k' }, fetchImpl: f });
    const r = await ai.reply({ text: 'pads 185 original +vat', asks: [{ id: 'a1', car: 'Toyota', lines: ['OIL FILTER'] }, { id: 'a2', car: 'Nissan', lines: ['BRAKE PADS', 'DISC'] }] });
    assert.deepEqual(r, { ask: 'a2', lines: [{ n: 1, offers: [{ price: 185, kind: 'oem', brand: '', na: false }] }], vat: 'excl' });
  });

  it('says who chats are; a role it was not asked for is left out', async () => {
    const { f } = fake([[/generateContent/, () => answer({ chats: [{ id: 'c1', role: 'supplier', confidence: 0.9 }, { id: 'zz', role: 'customer', confidence: 1 }, { id: 'c2', role: 'boss', confidence: 1 }] })]]);
    const ai = createAi({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mg-ai-c-')), env: { GEMINI_API_KEY: 'k' }, fetchImpl: f });
    const r = await ai.roles({ chats: [{ id: 'c1', name: 'Al Noor Auto Parts', texts: ['price 120'] }, { id: 'c2', name: 'Ahmed', texts: ['my car ready?'] }] });
    assert.deepEqual(r.chats, [{ id: 'c1', role: 'supplier', makes: [], confidence: 0.9 }]);
  });

  it("v0.91: a supplier makes with its role; what the garage knows goes in the question", async () => {
    let asked = '';
    const { f } = fake([
      [
        /generateContent/,
        (url, init) => {
          asked = String(init.body);
          return answer({ chats: [{ id: 'c1', role: 'supplier', makes: ['Toyota', ' Lexus ', ''], confidence: 0.8 }] });
        },
      ],
    ]);
    const ai = createAi({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mg-ai-m-')), env: { GEMINI_API_KEY: 'k' }, fetchImpl: f });
    const r = await ai.roles({ chats: [{ id: 'c1', name: 'Toyota Lexus Parts', texts: ['Prado 2015 bumper?', '950'], known: 'supplier' }] });
    assert.deepEqual(r.chats, [{ id: 'c1', role: 'supplier', makes: ['Toyota', 'Lexus'], confidence: 0.8 }]);
    assert.match(asked, /known supplier/);
    assert.match(asked, /makes/);
  });

  it('v0.91.2: a chat is a short key in the question (not its long number), the answer goes back to it; who wrote each line is said', async () => {
    let asked = '';
    const { f } = fake([
      [
        /generateContent/,
        (url, init) => {
          asked = String(init.body);
          return answer({ chats: [{ id: 'c2', role: 'supplier', makes: [], confidence: 0.9 }, { id: 'c1', role: 'other', makes: [], confidence: 0.95 }, { id: '971500000001@c.us', role: 'customer', makes: [], confidence: 1 }] });
        },
      ],
    ]);
    const ai = createAi({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mg-ai-k-')), env: { GEMINI_API_KEY: 'k' }, fetchImpl: f });
    const r = await ai.roles({
      chats: [
        { id: '971500000001@c.us', name: 'Mama', texts: ['T: Did you eat?', 'G: Yes'] },
        { id: '971500000002@c.us', name: 'Mohammed', texts: ['G: Patrol 2016 gearbox mounting available?', 'T: available 350'] },
      ],
    });
    assert.deepEqual(r.chats, [
      { id: '971500000002@c.us', role: 'supplier', makes: [], confidence: 0.9 },
      { id: '971500000001@c.us', role: 'other', makes: [], confidence: 0.95 },
    ]);
    assert.doesNotMatch(asked, /971500000001/);
    assert.match(asked, /written by the garage/);
  });
});

describe('audit 27/11: a message translated, a voice message written down — neither kept', () => {
  it('translates for the manager, asked again each time (the chat’s words are never stored)', async () => {
    const { f, seen } = fake([[/generateContent/, () => answer({ text: 'Тормозные колодки есть, 250 дирхам', from: 'ar' })]]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f });
    const r = await ai.translate({ text: 'فحمات الفرامل موجودة 250 درهم', to: 'ru' });
    assert.equal(r.text, 'Тормозные колодки есть, 250 дирхам');
    assert.equal(r.from, 'ar');
    await ai.translate({ text: 'فحمات الفرامل موجودة 250 درهم', to: 'ru' });
    assert.equal(seen.filter((s) => s.url.includes('generateContent')).length, 2);
    assert.match(seen[0].body.contents[0].parts[0].text, /into Russian/);
    await assert.rejects(ai.translate({ text: '  ' }), /no text/);
  });

  it('a voice message: heard as audio (an iPhone’s mp4 as m4a), written down and in English', async () => {
    const { f, seen } = fake([[/generateContent/, () => answer({ text: 'pads original 295, copy 150', english: '', from: 'en' })]]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f });
    const data = Buffer.alloc(600, 7).toString('base64');
    const r = await ai.voice({ audio: { type: 'audio/ogg; codecs=opus', data } });
    assert.equal(r.text, 'pads original 295, copy 150');
    const parts = seen[0].body.contents[0].parts;
    assert.deepEqual(parts.slice(-2), [{ text: 'Voice message:' }, { inline_data: { mime_type: 'audio/ogg', data } }]);
    await ai.voice({ audio: { type: 'audio/mp4', data } });
    assert.equal(seen[1].body.contents[0].parts.at(-1).inline_data.mime_type, 'audio/m4a');
    await assert.rejects(ai.voice({ audio: { type: 'image/jpeg', data } }), /no voice/);
  });

  it('a job’s lines dictated: names, numbers, kinds — cleaned; nothing said, nothing added', async () => {
    let lines = [
      { name: ' front brake pads ', qty: 1, kind: 'part', price: 0 },
      { name: 'BRAKE DISC FRONT', qty: 2.2, kind: 'part', price: 0 },
      { name: 'wheel alignment', qty: 1, kind: 'service', price: 120 },
      { name: 'x', qty: 1, kind: 'part', price: 0 },
      { name: 'BRAKE SERVICE', qty: 99, kind: 'other', price: -5 },
    ];
    const { f, seen } = fake([[/generateContent/, () => answer({ text: 'колодки передние, диски обе, развал 120', lines })]]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f });
    const data = Buffer.alloc(900, 5).toString('base64');
    const r = await ai.voiceLines({ audio: { type: 'audio/mp4', data } });
    assert.deepEqual(r.lines, [
      { name: 'FRONT BRAKE PADS', qty: 1, kind: 'part', price: 0 },
      { name: 'BRAKE DISC FRONT', qty: 2, kind: 'part', price: 0 },
      { name: 'WHEEL ALIGNMENT', qty: 1, kind: 'service', price: 120 },
      { name: 'BRAKE SERVICE', qty: 20, kind: 'part', price: 0 },
    ]);
    assert.equal(seen[0].body.contents[0].parts.at(-1).inline_data.mime_type, 'audio/m4a');
    assert.doesNotMatch(seen[0].body.contents[0].parts[0].text, /BRAKE|FILTER|OIL/);
    lines = [];
    assert.deepEqual((await ai.voiceLines({ audio: { type: 'audio/webm', data } })).lines, []);
    await assert.rejects(ai.voiceLines({ audio: { type: 'image/png', data } }), /no voice/);
  });

  it('a supplier’s picture written down as lines; a customer’s payment proof — what is printed; neither kept', async () => {
    const { f, seen } = fake([
      [/generateContent/, (_u, init) => (/payment's proof/.test(JSON.parse(init.body).contents[0].parts[0].text)
        ? answer({ isPayment: true, amount: 1250, currency: 'AED', date: '2026-11-27', reference: 'FT2611270042', bank: 'Emirates NBD', confidence: 0.92 })
        : answer({ text: '1. brake pads original 180\n2. disc copy 95' }))],
    ]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f });
    const data = Buffer.alloc(900, 3).toString('base64');
    const r = await ai.pictureText({ image: { type: 'image/jpeg', data } });
    assert.equal(r.text, '1. brake pads original 180\n2. disc copy 95');
    const parts = seen.at(-1).body.contents[0].parts;
    assert.deepEqual(parts.slice(-2), [{ text: 'Picture 1:' }, { inline_data: { mime_type: 'image/jpeg', data } }]);
    await ai.pictureText({ image: { type: 'image/jpeg', data } });
    assert.equal(seen.filter((s) => s.url.includes('generateContent')).length, 2);
    const p = await ai.payment({ image: { type: 'image/png', data } });
    assert.equal(p.isPayment, true);
    assert.equal(p.amount, 1250);
    assert.equal(p.reference, 'FT2611270042');
    await assert.rejects(ai.payment({ image: { type: 'audio/ogg', data } }), /no picture/);
    await ai.pictureText({ image: { type: 'application/pdf', data } });
    assert.equal(seen.at(-1).body.contents[0].parts.at(-1).inline_data.mime_type, 'application/pdf');
    await assert.rejects(ai.payment({ image: { type: 'application/pdf', data } }), /no picture/);
    await assert.rejects(ai.pictureText({ image: { type: 'image/jpeg', data: 'x' } }), /no picture/);
  });
});
