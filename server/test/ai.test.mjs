import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { createAi, diagramImages, pageText, parseJson, plainNumber, publicUrl } from '../src/ai.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-ai-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Addresses as the internet has them — and one name that points inside this computer's network. */
const lookup = async (host) => (host === 'evil.example' ? [{ address: '192.168.1.10' }] : [{ address: '93.184.216.34' }]);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const answer = (obj, extra = {}) => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, ...extra }] });
const png = () => new Response(new Uint8Array(20_000).fill(7), { headers: { 'Content-Type': 'image/png' } });

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
  it('writes a part number by its letters and digits only', () => {
    assert.equal(plainNumber('04465-33471'), '0446533471');
    assert.equal(plainNumber(' 04465 33471 '), '0446533471');
  });
  it('opens only addresses on the open internet', async () => {
    assert.equal(await publicUrl('https://www.amayama.com/en/part/x', lookup), true);
    for (const u of ['http://127.0.0.1:8788/status.json', 'http://localhost/', 'http://192.168.0.5/', 'http://[::1]/', 'https://evil.example/', 'file:///C:/x', 'ftp://a.com/', 'http://10.0.0.1/', 'https://user:pw@a.com/'])
      assert.equal(await publicUrl(u, lookup), false, u);
  });
  it('picks a page’s diagram: its picture, and pictures that name the number or a diagram — no logos', () => {
    const html = `<meta property="og:image" content="/img/og.jpg"><img src="/logo.png"><img src="/cat/04465-33471.jpg" alt="pads"><img src="/x/1.jpg" alt="Front brake exploded diagram"><img src="/y.jpg">`;
    const got = diagramImages(html, 'https://parts.example/p/1', ['04465-33471']).map((x) => x.url);
    assert.deepEqual(got, ['https://parts.example/cat/04465-33471.jpg', 'https://parts.example/og.jpg'.replace('og.jpg', 'img/og.jpg'), 'https://parts.example/x/1.jpg']);
    assert.equal(pageText('<p>Part&nbsp;No <b>04465-33471</b></p><script>x</script>').trim(), 'Part No 04465-33471');
  });
});

describe('the AI', () => {
  it('is off without a key; the key set here is kept in Служебное/ai.json', () => {
    const ai = createAi({ dataDir: dir, env: {}, fetchImpl: async () => json({}), lookup });
    assert.equal(ai.on(), false);
    ai.setKey('AQ.test-key-1234567890');
    assert.equal(ai.on(), true);
    assert.equal(ai.status().key, '…7890');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'Служебное', 'ai.json'), 'utf8')).key, 'AQ.test-key-1234567890');
    assert.equal(createAi({ dataDir: dir, env: {}, lookup }).on(), true);
  });

  it('decodes a VIN: the official decoder’s facts go to Gemini with it; the next busy model answers; asked once', async () => {
    let tries = 0;
    const { f, seen } = fake([
      [/vpic\.nhtsa/, () => json({ Results: [{ Make: 'TOYOTA', ModelYear: '2009', PlantCountry: 'JAPAN' }] })],
      [/gemini-3\.5-flash-lite/, () => (tries++, json({ error: { message: 'high demand' } }, 503))],
      [/gemini-3\.1-flash-lite/, () => answer({ make: 'Toyota', model: 'Corolla', year: 2009, engine: '1.8L 4-cyl', body: 'sedan', confidence: 0.9 })],
    ]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f, lookup });
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

  it('a part’s name: its mistakes put right, its English name', async () => {
    const { f, seen } = fake([[/generateContent/, () => answer({ fixed: 'колодки тормозные', english: 'BRAKE PADS', isPart: true, confidence: 0.92 })]]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f, lookup });
    const r = await ai.partName({ name: 'колодки тормазные', make: 'Toyota', model: 'Camry', year: 2018 });
    assert.equal(r.fixed, 'колодки тормозные');
    assert.equal(r.english, 'BRAKE PADS');
    assert.match(seen[0].body.contents[0].parts[0].text, /for a 2018 Toyota Camry: "колодки тормазные"/);
  });

  it('a part’s number off the web: seen on the pages opened here and backed by Google’s reading; the pictures looked at — the diagram and the photo kept', async () => {
    const page = (n) => `<html><head><meta property="og:image" content="https://cdn.parts.example/d/${n}.png"></head><body>Toyota Camry front pads ${n}<img src="/x/${n}-photo.jpg" alt="photo"></body></html>`;
    const asked = [];
    const { f, seen } = fake([
      [/generateContent/, (u, init) => {
        const b = JSON.parse(init.body);
        asked.push({ model: u.split('/models/')[1].split(':')[0], tools: !!b.tools, images: b.contents[0].parts.filter((x) => x.inline_data).length });
        // The pictures looked at: the first a diagram, the second a photo of the part, the third — the car (not kept).
        if (b.contents[0].parts.some((x) => x.inline_data)) return answer({ images: [{ index: 1, kind: 'diagram', matches: true }, { index: 2, kind: 'photo', matches: true }, { index: 3, kind: 'other', matches: false }] });
        assert.ok(b.tools.some((t) => t.google_search));
        const text = JSON.stringify({ numbers: [{ number: '04465-33471', brand: 'Toyota', pages: ['https://www.amayama.com/en/part/toyota/0446533471'] }, { number: '04465-06090', brand: 'Toyota', pages: [] }], images: [{ url: 'https://cdn.parts.example/car.jpg', kind: 'photo', page: 'https://www.amayama.com/en/part/toyota/0446533471' }] });
        return json({
          candidates: [{
            content: { parts: [{ text }] },
            groundingMetadata: {
              groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'partsouq.com' } }, { web: { uri: 'http://127.0.0.1:8788/status.json', title: 'x' } }, { web: { uri: 'https://megazip.example/p/1', title: 'megazip' } }],
              // Google's own reading backs the words with the first number by partsouq.com.
              groundingSupports: [{ segment: { text: '"number":"04465-33471"' }, groundingChunkIndices: [0] }],
            },
          }],
        });
      }],
      [/amayama\.com/, () => new Response(page('04465-33471'), { headers: { 'Content-Type': 'text/html' } })],
      [/megazip\.example/, () => new Response(page('0446533471'), { headers: { 'Content-Type': 'text/html' } })],
      [/grounding-api-redirect/, () => new Response('', { status: 302, headers: { location: 'https://partsouq.example/p/9' } })],
      [/partsouq\.example/, () => new Response('<html>no number here</html>', { headers: { 'Content-Type': 'text/html' } })],
      [/cdn\.parts\.example|\/x\//, () => png()],
    ]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f, lookup });
    const r = await ai.partFind({ part: 'FRONT BRAKE PADS', make: 'Toyota', model: 'Camry', year: 2018, vin: 'JTNB11HK6J3012345' });
    assert.equal(r.search, 'web');
    // Seen: the two pages opened here (amayama, megazip) and partsouq.com by Google's reading — three sites.
    assert.deepEqual(r.numbers.map((n) => [n.number, n.seen.length]), [['04465-33471', 3], ['04465-06090', 0]]);
    assert.ok(r.numbers[0].seen.includes('https://partsouq.com/'));
    // The number is looked up by the strongest model first, with Google Search; the pictures by a light one.
    assert.equal(asked[0].model, 'gemini-3.8-flash');
    assert.ok(asked[0].tools);
    const look = asked.find((x) => x.images);
    assert.equal(look.model, 'gemini-3.5-flash-lite');
    assert.ok(look.images >= 3);
    assert.deepEqual(r.images.map((i) => i.kind), ['diagram', 'photo']);
    assert.equal(r.images[0].type, 'image/png');
    // This computer's own page is never opened, whatever a search result says.
    assert.ok(!seen.some((x) => x.url.startsWith('http://127.0.0.1')));
    assert.equal(ai.status().search, 'on');
  });

  it('without Google Search on the key (a paid plan’s): what the model knows — not checked anywhere', async () => {
    const { f } = fake([
      [/generateContent/, (_u, init) => (JSON.parse(init.body).tools ? json({ error: { message: 'You exceeded your current quota' } }, 429) : answer({ numbers: [{ number: '04465-33471', brand: 'Toyota' }] }))],
    ]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f, lookup });
    const r = await ai.partFind({ part: 'BRAKE PADS', make: 'Toyota', model: 'Camry', year: 2018 });
    assert.equal(r.search, 'model');
    assert.deepEqual(r.numbers.map((n) => [n.number, n.seen.length]), [['04465-33471', 0]]);
    assert.equal(r.images.length, 0);
    assert.equal(ai.status().search, 'off');
  });

  it('a guess without the web is kept half an hour, a find on the web a week', async () => {
    let t = 0;
    let web = false;
    let calls = 0;
    const { f } = fake([
      [/generateContent/, (_u, init) => {
        calls++;
        const b = JSON.parse(init.body);
        if (b.tools && !web) return json({ error: { message: 'You exceeded your current quota' } }, 429);
        return answer({ numbers: [{ number: '04465-33471', brand: 'Toyota' }] });
      }],
    ]);
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f, lookup, now: () => t });
    const q = { part: 'BRAKE PADS', make: 'Toyota', model: 'Camry', year: 2018 };
    assert.equal((await ai.partFind(q)).search, 'model');
    t = 10 * 60_000;
    assert.equal((await ai.partFind(q)).search, 'model');
    const before = calls;
    // The paid plan on: after half an hour the same part goes to the web — and stays a week.
    web = true;
    t = 31 * 60_000;
    assert.equal((await ai.partFind(q)).search, 'web');
    assert.ok(calls > before);
    const now = calls;
    t = 6 * 24 * 60 * 60_000;
    assert.equal((await ai.partFind(q)).search, 'web');
    assert.equal(calls, now);
  });

  it('a device may ask 40 times a minute', () => {
    let t = 0;
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, lookup, now: () => t });
    for (let i = 0; i < 40; i++) ai.allow('d1');
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
    const ai = { on: () => on, status: () => ({ on }), allow: () => {}, vin: async (v) => (asked.push(v), { make: 'Toyota', model: 'Camry' }), partName: async () => ({}), partFind: async () => ({}) };
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
    } finally {
      server.close();
      store.close();
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
