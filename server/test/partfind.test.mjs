import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { createAi, parseFound } from '../src/ai.mjs';
import { catalogHtml } from './catalog-page.mjs';
import { noteFor } from '../src/partfind.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygarage-find-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const lookup = async () => [{ address: '93.184.216.34' }];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const html = (body) => new Response(body, { headers: { 'Content-Type': 'text/html' } });
const picture = (type, size) => new Response(new Uint8Array(size).fill(7), { headers: { 'Content-Type': type } });
/** What Gemini said without searching, and with Google's own reading of its search. */
const said = (text) => json({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 } });
const grounded = (text, { sites = ['parts.example'], backs = [], queries = ['one search'] } = {}) =>
  json({
    candidates: [{ content: { parts: [{ text }] }, groundingMetadata: { groundingChunks: sites.map((t) => ({ web: { uri: `https://${t}/x`, title: t } })), groundingSupports: backs.map(([segment, at]) => ({ segment: { text: segment }, groundingChunkIndices: at })), webSearchQueries: queries } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40, toolUsePromptTokenCount: 300 },
  });

/** A fetch that answers by address; every question to Gemini is noted as «thinking+tools». */
function world(routes, gemini, { now } = {}) {
  const asked = [];
  const fetched = [];
  const f = async (url, init = {}) => {
    const u = String(url);
    if (/generateContent/.test(u)) {
      const b = JSON.parse(init.body);
      const q = { model: u.split('/models/')[1].split(':')[0], tools: (b.tools ?? []).map((t) => Object.keys(t)[0]).join('+'), thinking: b.generationConfig.thinkingConfig?.thinkingLevel, text: b.contents[0].parts[0].text, images: b.contents[0].parts.filter((x) => x.inline_data).length, low: b.generationConfig.mediaResolution };
      asked.push(q);
      return gemini(q, asked.length);
    }
    fetched.push(u);
    for (const [re, fn] of routes) if (re.test(u)) return fn(u, init);
    return new Response('no', { status: 404 });
  };
  const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f, lookup, ...(now ? { now } : {}) });
  return { ai, asked, fetched, f };
}
const how = (q) => `${q.thinking}${q.tools ? `+${q.tools}` : ''}`;

/** The catalogue of an invented make's parts: a compressor replaced by a newer number, on a «Verso KXA10» diagram. */
const VERSO = [
  [/megazip\.net\/parts\/toyota-1111122220$/, () => html(catalogHtml({ number: '1111122220', formatted: '11111-22220', name: 'Compressor Assy, W/Pulley', superseded: true, family: ['11111-22221'] }))],
  [
    /megazip\.net\/parts\/toyota-1111122221$/,
    () =>
      html(
        catalogHtml({
          number: '1111122221',
          formatted: '11111-22221',
          name: 'Compressor Assy, W/Pulley',
          replaces: true,
          family: ['11111-22220'],
          diagrams: [
            { image: 'https://epc.partsbooster.com/schemas/toyota/kxa10.png', name: 'Air Conditioning Compressor', header: 'Toyota Verso KXA10', sub: ['2nd Gen', '2005 — 2011'], areas: [[10, 20, 30, 40]] },
            { image: 'https://epc.partsbooster.com/schemas/toyota/kxa11.png', name: 'Air Conditioning Compressor', header: 'Toyota Verso KXA11', sub: ['2005 — 2011'], areas: [[1, 2, 3, 4]] },
          ],
        }),
      ),
  ],
  // The same kind of part of another model, and one of this model's other frame.
  [/megazip\.net\/parts\/toyota-1111133330$/, () => html(catalogHtml({ number: '1111133330', formatted: '11111-33330', name: 'Compressor Assy, W/Pulley', diagrams: [{ image: 'https://epc.partsbooster.com/schemas/toyota/other.png', name: 'Compressor', header: 'Toyota Limo ZZ9', sub: ['2005 — 2011'], areas: [] }] }))],
  [/epc\.partsbooster\.com/, () => picture('image/png', 700)],
  [/partsouq\.com\/assets/, () => picture('image/jpeg', 9000)],
];
const verso = { part: 'AC COMPRESSOR', make: 'Toyota', model: 'Verso', year: 2006, engine: '1.5L' };

describe('an answer’s lines', () => {
  it('numbers lettered, numbered or bare; the car’s frames; diagrams and photos; a number said twice is one, words are no number', () => {
    const r = parseFound(`Here is what I found:
F | NCP91, NCP93 / ncp91l
* **N | 04465-60280 | Toyota | GCC, from 2015 | https://catalog.example/en/part/0446560280**
2 | OEM 04465-60281 | Toyota | replaces 04465-60270 | [shop](https://shop.example/p/2), <https://other.example/p/3>
MK512965 | Fuso | main cabin core
N | 0446560280 | Toyota | the same again | https://second.example/p
N | NOT APPLICABLE | Toyota | tyres have no number
N | 12 | Toyota | too short |
D | https://cdn.example/diagram.png | https://catalog.example/x
- P | \`https://cdn.example/pads.jpg\` | https://shop.example/y.
Part of the answer: not a line.`);
    assert.deepEqual(r.frames, ['NCP91', 'NCP93', 'NCP91L']);
    assert.deepEqual(r.numbers, [
      { number: '04465-60280', brand: 'Toyota', note: 'GCC, from 2015', pages: ['https://catalog.example/en/part/0446560280', 'https://second.example/p'] },
      { number: '04465-60281', brand: 'Toyota', note: 'replaces 04465-60270', pages: ['https://shop.example/p/2'] },
      { number: 'MK512965', brand: 'Fuso', note: 'main cabin core', pages: [] },
    ]);
    assert.deepEqual(r.images, [
      { url: 'https://cdn.example/diagram.png', kind: 'diagram', page: 'https://catalog.example/x' },
      { url: 'https://cdn.example/pads.jpg', kind: 'photo', page: 'https://shop.example/y' },
    ]);
    assert.deepEqual(parseFound('NONE'), { numbers: [], images: [], frames: [] });
  });
});

describe('a part looked for: the cheapest way first', () => {
  it('a car known well: the model’s own first number, read in the catalogue — on this car’s diagram: no paid search; the newer number stands for the old; the diagram with the callout’s place, then a photo', async () => {
    const { ai, asked } = world(VERSO, () => said('F | KXA10\nN | 11111-22220 | Toyota | 1.5, with pulley\nN | 11111-99999 | Toyota | made up'));
    const u0 = ai.status().usage.today;
    const r = await ai.partFind(verso);
    // One question, with no tool: no search was paid for.
    assert.deepEqual(asked.map(how), ['low']);
    assert.match(asked[0].text, /From your own knowledge/);
    assert.deepEqual([r.search, r.stage, r.frames], ['web', 0, ['KXA10']]);
    assert.deepEqual(r.numbers, [
      { number: '11111-22221', brand: 'Toyota', note: '1.5, with pulley', seen: ['https://www.megazip.net/parts/toyota-1111122221'], fits: true, name: 'Compressor Assy, W/Pulley', model: 'Verso KXA10 · 2005–2011', replaces: ['11111-22220'] },
    ]);
    // The diagram first — this frame's, its callout's place with it; then a photo. No model looked at them.
    assert.deepEqual(r.images.map((i) => [i.kind, i.url]), [['diagram', 'https://epc.partsbooster.com/schemas/toyota/kxa10.png'], ['photo', 'https://partsouq.com/assets/tesseract/assets/partsimages/Toyota/1111122221.jpg']]);
    assert.deepEqual(r.images[0].marks, [{ x1: 10, y1: 20, x2: 30, y2: 40 }]);
    assert.equal(r.images[0].title, 'Air Conditioning Compressor — Verso KXA10 · 2005–2011');
    const u1 = ai.status().usage.today;
    assert.deepEqual([u1.questions - u0.questions, u1.searches - u0.searches, u1.byKind.guess - (u0.byKind.guess ?? 0)], [1, 0, 1]);
  });

  it('a later guess that is on the diagram is not taken on memory alone: the web is asked, told what the catalogue said', async () => {
    const { ai, asked } = world(VERSO, (q) =>
      q.tools ? grounded('N | 11111-22221 | Toyota | 1.5 | https://parts.example/p', { backs: [['N | 11111-22221 | Toyota', [0]]] }) : said('N | 11111-33330 | Toyota | likeliest\nN | 11111-22221 | Toyota | or this'),
    );
    const r = await ai.partFind({ ...verso, part: 'AC COMPRESSOR NEW' });
    assert.deepEqual(asked.map(how), ['low', 'low+google_search']);
    // The search is told to search, and what the catalogue said of the guesses.
    assert.match(asked[1].text, /^Use Google Search now to find/);
    assert.match(asked[1].text, /11111-33330 — "Compressor Assy, W\/Pulley", on diagrams of Toyota Limo ZZ9/);
    assert.match(asked[1].text, /11111-22221 — .* — on this car's diagram/);
    // The one on this car's diagram, seen by the web too; the other model's number is left out.
    assert.deepEqual(r.numbers.map((n) => [n.number, n.fits, n.seen.length]), [['11111-22221', true, 2]]);
    assert.equal(r.stage, 1);
  });

  it('a car not known well (no engine, no VIN): the web at once — its numbers read in the catalogue, the variants each on its diagram', async () => {
    const routes = [
      [/megazip\.net\/parts\/nissan-444440000A$/, () => html(catalogHtml({ number: '444440000A', formatted: '44444-0000A', name: 'Tensioner Assy', brand: 'Nissan', slug: 'nissan', diagrams: [{ image: 'https://epc.partsbooster.com/schemas/nissan/petrol.png', name: 'Belt', header: 'Nissan Cargo ZX9', sub: ['2012 — 2021'], areas: [[5, 5, 9, 9]] }] }))],
      [/megazip\.net\/parts\/nissan-444441111B$/, () => html(catalogHtml({ number: '444441111B', formatted: '44444-1111B', name: 'Tensioner Assy', brand: 'Nissan', slug: 'nissan', diagrams: [{ image: 'https://epc.partsbooster.com/schemas/nissan/diesel.png', name: 'Belt', header: 'Nissan Cargo CS8ZX9', sub: ['2012 — 2021'], areas: [] }] }))],
      [/epc\.partsbooster\.com/, () => picture('image/png', 700)],
    ];
    const { ai, asked } = world(routes, () => grounded('F | ZX9\nN | 44444-0000A | Nissan | petrol | https://parts.example/a\nN | 444441111B | Nissan | diesel | https://parts.example/b'));
    const r = await ai.partFind({ part: 'TENSIONER PULLEY', make: 'Nissan', model: 'Cargo', year: 2026 });
    assert.deepEqual(asked.map(how), ['low+google_search']);
    // The catalogue's data ends in 2021, the model is still made: both are on this car's diagram.
    assert.deepEqual(r.numbers.map((n) => [n.number, n.fits, n.model]), [['44444-0000A', true, 'Cargo ZX9 · 2012–2021'], ['44444-1111B', true, 'Cargo CS8ZX9 · 2012–2021']]);
    assert.deepEqual(r.images.map((i) => i.kind), ['diagram', 'diagram']);
  });

  it('an answer given without searching is not a search’s: asked once more at the same step, then the climb goes on — the pages read, then a deep search with more thinking', async () => {
    const routes = [[/gmparts\.example/, () => html('<html>Condenser 99999002 for Terrain</html>')]];
    const { ai, asked } = world(routes, (q) => (q.thinking !== 'medium' ? said('N | 99999001 | GM | from memory') : grounded('N | 99999002 | GM | 2.4L | https://gmparts.example/p/1', { sites: ['gmparts.example'] })));
    const u0 = ai.status().usage.today;
    const r = await ai.partFind({ part: 'AC CONDENSER', make: 'GMC', model: 'Terrain', year: 2017, engine: '2.4L' });
    assert.deepEqual(asked.map(how), ['low+google_search', 'low+google_search', 'low+google_search+url_context', 'low+google_search+url_context', 'medium+google_search+url_context']);
    // The second time it is told its answer came without a search.
    assert.match(asked[0].text, /^Use Google Search now to find/);
    assert.match(asked[1].text, /^Search first — your last answer came without a search\.\nA garage needs the genuine/);
    assert.match(asked[1].text, /\nStep 1 — call Google Search with: GMC Terrain 2\.4L ac condenser genuine part number partsouq\n/);
    assert.match(asked[4].text, /Step 2 — it is hard to find: search again, in other words/);
    assert.deepEqual([r.search, r.stage], ['web', 3]);
    // Seen on the pages this computer opened (the one it named, the search's result); the memory's number is shown
    // unchecked (the catalogue has no such make to refuse it).
    assert.deepEqual(r.numbers.map((n) => [n.number, n.seen.length]), [['99999002', 2], ['99999001', 0]]);
    const u1 = ai.status().usage.today;
    assert.deepEqual([u1.byKind.find - (u0.byKind.find ?? 0), u1.byKind.dig - (u0.byKind.dig ?? 0)], [2, 3]);
  });

  it('a make the catalogue does not have: the web’s numbers seen on pages opened here and by Google’s reading; the pictures looked at by a light model in low resolution', async () => {
    const page = (n) => `<html><head><meta property="og:image" content="https://cdn.parts.example/d/${n}.png"></head><body>Terrain condenser ${n}<img src="/x/${n}-photo.jpg" alt="photo"></body></html>`;
    const routes = [
      [/shop\.example/, () => html(page('23400111'))],
      [/second\.example/, () => html(page('23400111'))],
      [/grounding-api-redirect/, () => new Response('', { status: 302, headers: { location: 'https://third.example/p/9' } })],
      [/third\.example/, () => html('<html>no number here</html>')],
      [/cdn\.parts\.example|\/x\//, () => picture('image/png', 20_000)],
    ];
    const { ai, asked, fetched } = world(routes, (q) =>
      q.images
        ? json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ images: [{ index: 1, kind: 'diagram', matches: true }, { index: 2, kind: 'photo', matches: true }, { index: 3, kind: 'other', matches: false }] }) }] } }] })
        : json({
            candidates: [{
              content: { parts: [{ text: 'N | 23400111 | GM | with drier | https://shop.example/p/1\nN | 23400222 | GM | other market |\nP | https://cdn.parts.example/car.jpg | https://shop.example/p/1' }] },
              groundingMetadata: {
                groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'catalog.example' } }, { web: { uri: 'http://127.0.0.1:8788/status.json', title: 'x' } }, { web: { uri: 'https://second.example/p/1', title: 'second' } }],
                groundingSupports: [{ segment: { text: 'N | 23400111 | GM' }, groundingChunkIndices: [0] }],
                webSearchQueries: ['terrain condenser', '23400111'],
              },
            }],
            usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 600, toolUsePromptTokenCount: 1000 },
          }),
    );
    const u0 = ai.status().usage.today;
    const r = await ai.partFind({ part: 'AC CONDENSER', make: 'GMC', model: 'Terrain', year: 2017 });
    assert.equal(r.search, 'web');
    // Seen: the two pages opened here and catalog.example by Google's reading — three sites; the other number nowhere.
    assert.deepEqual(r.numbers.map((n) => [n.number, n.seen.length]), [['23400111', 3], ['23400222', 0]]);
    assert.ok(r.numbers[0].seen.includes('https://catalog.example/'));
    // Two questions: the search (the strongest model, Google only, low thinking) and the pictures (a light one, low resolution, minimal thinking).
    assert.deepEqual(asked.map((q) => [q.model, how(q)]), [['gemini-3.8-flash', 'low+google_search'], ['gemini-3.5-flash-lite', 'minimal']]);
    assert.equal(asked[1].low, 'MEDIA_RESOLUTION_LOW');
    assert.deepEqual(r.images.map((i) => i.kind), ['diagram', 'photo']);
    // This computer's own page is never opened, whatever a search result says.
    assert.ok(!fetched.some((u) => u.startsWith('http://127.0.0.1')));
    const u1 = ai.status().usage.today;
    assert.deepEqual([u1.questions - u0.questions, u1.searches - u0.searches, u1.in - u0.in, u1.out - u0.out], [2, 2, 1200, 600]);
  });

  it('the line’s own number, the garage’s own numbers: the catalogue alone — nothing is asked of the AI', async () => {
    const { ai, asked } = world(VERSO, () => {
      throw new Error('no question expected');
    });
    const own = await ai.partFind({ ...verso, number: '11111-22221' });
    assert.equal(asked.length, 0);
    assert.deepEqual(own.numbers.map((n) => [n.number, n.fits, n.name]), [['11111-22221', true, 'Compressor Assy, W/Pulley']]);
    assert.deepEqual(own.images.map((i) => i.kind), ['diagram', 'photo']);
    // What the garage used before on this car, on this car's diagram: the answer, with no question.
    const hinted = await ai.partFind({ ...verso, part: 'COMPRESSOR', hints: ['11111-22220'] });
    assert.equal(asked.length, 0);
    assert.deepEqual(hinted.numbers.map((n) => [n.number, n.fits, n.replaces]), [['11111-22221', true, ['11111-22220']]]);
  });

  it('asked to dig deeper: starts from what is kept (the model told what the catalogue said), goes to the web with the pages read, and replaces what was kept', async () => {
    const rows = new Map();
    const store = { aiCacheGet: (k) => rows.get(k), aiCachePut: (k, kind, at, value) => rows.set(k, { at, value, kind }) };
    const routes = [...VERSO, [/megazip\.net\/parts\/toyota-1111144440$/, () => html(catalogHtml({ number: '1111144440', formatted: '11111-44440', name: 'Compressor Assy', diagrams: [{ image: 'https://epc.partsbooster.com/schemas/toyota/new.png', name: 'Compressor', header: 'Toyota Verso KXA10', sub: ['2005 — 2011'], areas: [] }] }))]];
    let deep = false;
    const asked = [];
    const f = async (url, init = {}) => {
      const u = String(url);
      if (/generateContent/.test(u)) {
        const b = JSON.parse(init.body);
        asked.push({ tools: (b.tools ?? []).map((t) => Object.keys(t)[0]).join('+'), thinking: b.generationConfig.thinkingConfig?.thinkingLevel, text: b.contents[0].parts[0].text });
        if (!deep) return said('N | 11111-22221 | Toyota | 1.5');
        return b.tools ? grounded('N | 11111-44440 | Toyota | late production | https://parts.example/p') : said('NONE');
      }
      for (const [re, fn] of routes) if (re.test(u)) return fn(u, init);
      return new Response('no', { status: 404 });
    };
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f, lookup, store });
    const q = { ...verso, part: 'COMPRESSOR ASSY' };
    const first = await ai.partFind(q);
    assert.deepEqual(first.numbers.map((n) => n.number), ['11111-22221']);
    assert.equal((await ai.partFind(q)).numbers.length, 1);
    assert.equal(asked.length, 1);
    deep = true;
    const more = await ai.partFind({ ...q, deep: true });
    // From memory once more — told the kept number — then the web with the pages read: no plain search again.
    assert.deepEqual(asked.slice(1).map(how), ['low', 'low+google_search+url_context']);
    assert.match(asked[1].text, /The maker's catalogue was read for these already:\n11111-22221 — /);
    assert.deepEqual(more.numbers.map((n) => [n.number, n.fits]), [['11111-22221', true], ['11111-44440', true]]);
    // What is kept now is the deeper search's answer.
    assert.deepEqual((await ai.partFind(q)).numbers.map((n) => n.number), ['11111-22221', '11111-44440']);
    assert.equal(asked.length, 3);
  });

  it('no car — nothing is looked for; without Google Search on the key the catalogue still confirms a number, and a make it does not have gets the model’s guess, not checked', async () => {
    const { ai, asked } = world(VERSO, (q) => (q.tools ? json({ error: { message: 'You exceeded your current quota' } }, 429) : said('N | 11111-22221 | Toyota | 1.5')));
    await assert.rejects(ai.partFind({ part: 'AC COMPRESSOR' }), /no car/);
    assert.equal(asked.length, 0);
    // The catalogue's make, the car known well: confirmed with no search at all.
    const ok = await ai.partFind({ ...verso, part: 'COMPRESSOR W/PULLEY' });
    assert.deepEqual([ok.search, ok.numbers[0].fits, asked.map(how).join()], ['web', true, 'low']);
    // A make outside the catalogue: the search refused (no paid plan) — what the model knows, kept half an hour.
    const guess = await ai.partFind({ part: 'AC CONDENSER', make: 'GMC', model: 'Terrain', year: 2017 });
    assert.deepEqual([guess.search, guess.numbers.map((n) => [n.number, n.seen.length])], ['model', [['11111-22221', 0]]]);
    assert.equal(guess.images.length, 0);
    assert.equal(ai.status().search, 'off');
  });

  it('kept: a number on this car’s diagram — a year; a guess — half an hour; a catalogue’s page is read once, «no such number» not again within a week', async () => {
    let t = 0;
    let pages = 0;
    let questions = 0;
    const routes = VERSO.map(([re, fn]) => [re, (...a) => (/megazip/.test(re.source) ? pages++ : 0, fn(...a))]);
    const f = async (url, init = {}) => {
      const u = String(url);
      if (/generateContent/.test(u)) {
        questions++;
        const b = JSON.parse(init.body);
        if (b.tools) return json({ error: { message: 'You exceeded your current quota' } }, 429);
        return said(/CONDENSER/.test(b.contents[0].parts[0].text) ? 'N | 55555001 | GM | guess' : 'N | 11111-22221 | Toyota | 1.5\nN | 11111-99999 | Toyota | made up');
      }
      for (const [re, fn] of routes) if (re.test(u)) return fn(u, init);
      if (/megazip/.test(u)) pages++;
      return new Response('no', { status: 404 });
    };
    const ai = createAi({ dataDir: dir, env: { GEMINI_API_KEY: 'AQ.k-1234567890123456' }, fetchImpl: f, lookup, now: () => t });
    const DAY = 24 * 60 * 60_000;
    assert.equal((await ai.partFind({ ...verso, part: 'COMPRESSOR' })).numbers[0].fits, true);
    // The pages read: the number's own and the made-up one's under both sister makes (toyota, lexus).
    assert.deepEqual([questions, pages], [1, 3]);
    t = 300 * DAY;
    assert.equal((await ai.partFind({ ...verso, part: 'COMPRESSOR' })).numbers[0].fits, true);
    assert.deepEqual([questions, pages], [1, 3]);
    // Another part with the same numbers a day later: the model is asked, the catalogue's pages are the kept ones.
    t = 301 * DAY;
    const again = questions;
    await ai.partFind({ ...verso, part: 'COMPRESSOR ASSEMBLY' });
    assert.equal(questions, again + 1);
    assert.equal(pages, 3 + 1 /* the page of the number: kept a quarter of a year, read anew */ + 2 /* «no such number»: a week */);
    // A guess (a make outside the catalogue, no paid search): half an hour.
    const g0 = questions;
    await ai.partFind({ part: 'AC CONDENSER', make: 'GMC', model: 'Terrain', year: 2017 });
    const g1 = questions;
    t += 10 * 60_000;
    await ai.partFind({ part: 'AC CONDENSER', make: 'GMC', model: 'Terrain', year: 2017 });
    assert.equal(questions, g1);
    t += 31 * 60_000;
    await ai.partFind({ part: 'AC CONDENSER', make: 'GMC', model: 'Terrain', year: 2017 });
    assert.ok(questions > g1 && g1 > g0);
  });
});

describe('the note for the garage and how far a search has got (v0.64)', () => {
  it('«S | …» read as the note; NONE is none; the other lines as before', () => {
    const r = parseFound('N | 04465-60280 | Toyota | GCC | https://catalog.example/p\nS | Two variants by build date | check the VIN\nS | a second note is not taken');
    assert.equal(r.note, 'Two variants by build date; check the VIN');
    assert.equal(r.numbers.length, 1);
    assert.equal(parseFound('N | 04465-60280 | Toyota | GCC | https://catalog.example/p\nS | NONE').note, undefined);
    assert.equal(parseFound('S: Only one number fits.').note, 'Only one number fits.');
  });

  it('a note naming a part number not given goes; years, engines and frames are no part numbers', () => {
    const given = [{ number: '04465-60320', replaces: ['04465-60280'] }, { number: '04465-0K290' }];
    assert.equal(noteFor('04465-60320 replaced 04465-60280; 04465-0K290 is for 2016-2020 1GR-FE GRJ150 only.', given), '04465-60320 replaced 04465-60280; 04465-0K290 is for 2016-2020 1GR-FE GRJ150 only.');
    assert.equal(noteFor('Order 04465-99999 instead.', given), '');
    assert.equal(noteFor('Check the VIN.', []), '');
  });

  it('each step as it starts, the time inside it; done — 100; a mark not heard of — null; the note of the numbers given', async () => {
    let clock = Date.now();
    let release;
    const gate = new Promise((r) => (release = r));
    const { ai, asked } = world(
      VERSO,
      async () => {
        await gate;
        return said('F | KXA10\nN | 11111-22220 | Toyota | 1.5, with pulley\nS | 11111-22221 replaced 11111-22220 — the same compressor.');
      },
      { now: () => clock },
    );
    const going = ai.partFind({ ...verso, part: 'AC COMPRESSOR', track: 't-1' });
    // The model's memory asked (the catalogue had nothing to read first): a few seconds in, about half of that step.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(asked.length, 1);
    const start = ai.progress('t-1,t-unknown');
    assert.equal(start['t-unknown'], null);
    assert.ok(start['t-1'] >= 0 && start['t-1'] < 8, String(start['t-1']));
    clock += 6_000;
    const mid = ai.progress('t-1')['t-1'];
    assert.ok(mid > 12 && mid < 26, String(mid));
    // Never past its step's mark, however long it takes.
    clock += 10 * 60_000;
    assert.ok(ai.progress('t-1')['t-1'] <= 26);
    release();
    const r = await going;
    assert.equal(ai.progress('t-1')['t-1'], 100);
    // No question asked for the progress; the note — the model's, of the number that stands.
    assert.equal(asked.length, 1);
    assert.equal(r.note, '11111-22221 replaced 11111-22220 — the same compressor.');
    // The same search asked again under a new mark (kept): done at once.
    await ai.partFind({ ...verso, part: 'AC COMPRESSOR', track: 't-2' });
    assert.equal(ai.progress('t-2')['t-2'], 100);
  });
});
