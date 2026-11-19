import { catalogSlugs, diagramFits, frameFits, plainNumber, sameKind } from './catalog.mjs';

/*
 * A part's number looked for — the cheapest way first, deeper only when that did not find it (v0.55, the user: «улучши
 * способность поиска; научи копать глубоко, если не получается найти; сократи траты максимально, качество — выше;
 * намного быстрее; приоритет по фото — схема детали, потом образец»).
 *
 * What costs: a question with Google Search is paid by the search (the tokens beside it are small change); a question
 * without it costs a few hundred tokens; reading the open catalogue's page of a number costs nothing. So:
 *
 *   0. the numbers the garage used before, and — for a car known well enough to tell a part's variants apart (its year,
 *      and its engine or VIN) — the numbers the model names from its own knowledge, no search, are each read in the open
 *      catalogue by this computer (catalog.mjs): it exists, it is that kind of part, it is on a diagram of this model in
 *      these years, of this frame. The model's memory alone is never taken (it named the Prado's pads for a Land
 *      Cruiser 200); the catalogue's page is;
 *   1. Google Search — when the catalogue confirmed nothing, does not have the make, or the car is not known well
 *      enough — told what was checked already; what it names is read in the catalogue too;
 *   2. the same with the found pages read whole;
 *   3. a deep search: more thinking, several searches, the part's other names, the car's frame and engine codes.
 *
 * Each step stops the climb as soon as a number stands; an answer given without searching is not a search's. Numbers
 * that are one part under an older and a newer number (the catalogue says which replaced which) come as one. The
 * pictures: the part's factory diagram from the catalogue, the place of its callout with it — first; a photo of the
 * part — after.
 */

/** An address in a cell of an answer's line: as is, in a markdown link, in angle brackets or quotes. */
function addressIn(cell) {
  const m = String(cell ?? '').match(/https?:\/\/[^\s<>"'`|)\]]+/);
  return m ? m[0].replace(/[.,;]+$/, '') : '';
}

/** A cell that can be a part number: letters and digits (a dash, a space, a dot between them), a digit among them. */
function numberLike(cell) {
  const s = String(cell ?? '').replace(/^(?:OEM|PN|P\/N|No\.?)[:#\s]+/i, '').trim();
  const p = plainNumber(s);
  if (p.length < 5 || p.length > 20 || !/\d/.test(p) || !/^[A-Z0-9][A-Z0-9 ./-]{3,26}$/i.test(s) || /^(19|20)\d\d$/.test(p)) return '';
  return s;
}

/**
 * An answer in its lines — «N | number | maker | note | page», «D | picture | page» (a diagram), «P | picture | page» (a
 * photo of the part), «F | frame codes» (the car's): read here, no second question to write it down. A model's bullets,
 * bold and numbering are let be; so is a line numbered instead of lettered («1 | 88310-52481 | Toyota | …») or with no
 * letter at all. A number said twice (with a dash and without) is one; words in a number's place («NOT APPLICABLE») are
 * no number.
 */
export function parseFound(text) {
  const numbers = [];
  const images = [];
  const frames = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^[\s*•\-–>#]+|\*\*/g, '').replace(/^\d+[.)]\s+/, '').trim();
    if (!line.includes('|') && !/^[NDPF]\s*:/i.test(line)) continue;
    let cells = line.split('|').map((c) => c.trim().replace(/^`+|`+$/g, ''));
    let tag = '';
    const lettered = /^([NDPF])\s*:?\s*$/i.exec(cells[0]) ?? /^([NDPF])\s*:\s*(.+)$/i.exec(cells[0]);
    if (lettered) {
      tag = lettered[1].toUpperCase();
      cells = lettered[2] ? [lettered[2].trim(), ...cells.slice(1)] : cells.slice(1);
    } else if (/^\d{1,2}$/.test(cells[0])) {
      cells = cells.slice(1);
    }
    if (tag === 'F') {
      for (const f of cells.join(' ').split(/[\s,;/]+/)) {
        const x = f.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (x.length >= 2 && x.length <= 10 && /[A-Z]/.test(x) && !/^(UNKNOWN|NONE|NA)$/.test(x) && !frames.includes(x) && frames.length < 6) frames.push(x);
      }
      continue;
    }
    if (tag === 'D' || tag === 'P') {
      const url = addressIn(cells[0]);
      if (url && !images.some((i) => i.url === url)) images.push({ url, kind: tag === 'D' ? 'diagram' : 'photo', page: addressIn(cells[1]) });
      continue;
    }
    // A number's line: lettered «N», numbered, or bare — then its first cell must look like a number and a second be there.
    const number = numberLike(cells[0]);
    if (!number || (!tag && cells.length < 2)) continue;
    const pages = cells.slice(1).map(addressIn).filter(Boolean);
    const had = numbers.find((n) => plainNumber(n.number) === plainNumber(number));
    if (had) {
      for (const p of pages) if (!had.pages.includes(p)) had.pages.push(p);
      // The catalogue's own writing has the dash.
      if (!/[-\s]/.test(had.number) && /[-\s]/.test(number)) had.number = number;
      continue;
    }
    numbers.push({ number, brand: addressIn(cells[1]) ? '' : cells[1] ?? '', note: addressIn(cells[2]) ? '' : cells[2] ?? '', pages });
  }
  return { numbers, images, frames };
}

const carWords = (car, vin, built) => `${car || 'unknown'}${vin ? `, VIN ${vin}` : ''}${built ? ` (built in ${built})` : ''}, in the UAE — GCC specification unless the VIN says otherwise`;
const FRAME = `F | this car's frame (chassis) codes as the maker's catalogue has them (like NCP91, UZJ200, E26), the likeliest first`;
const LINES = `N | number as the catalogue writes it | maker | what tells the variants apart (market, dates, engine, side; replaces …), under 60 characters`;

/** The questions («заготовки»): short, what is known already put in front of the model. */
export const PF = {
  guess: (part, car, vin, built, hints, tried) =>
    `From your own knowledge of the maker's parts catalogue (no search): the genuine (OEM) part number of "${part}" for exactly this car: ${carWords(car, vin, built)}.${hints.length ? `\nThe garage used ${hints.join(', ')} for this part on this car before.` : ''}${tried ? `\nThe maker's catalogue was read for these already:\n${tried}\nName the right number for exactly this car — one of these, or others.` : ''}
Up to 5 candidates, the most likely first (variants by engine, body or side — a line each; a replaced number — the newer one). Answer only with lines, nothing else:
${FRAME}
${LINES}
Not sure of any number: NONE`,
  /**
   * The web's question. Plain first — «search once»: one or two searches, each paid. `steps` — asked again after an
   * answer without a search, or digging deep: its first step is the search to make (`query`, made here from the car and
   * the part). Measured on the real service: told only «use Google Search», the model now and then answers «nothing
   * found» without one search (a car newer than it knows); given the search as a step it makes it — and several more.
   */
  search: (part, car, vin, built, hints, { tried = '', deep = false, steps = false, query = '' } = {}) => {
    const known = `${hints.length ? `\nThe garage used ${hints.join(', ')} for this part on this car before: confirm or correct.` : ''}${tried ? `\nThe maker's catalogue was read for these already — do not repeat what it refused, find the right one:\n${tried}` : ''}`;
    const newer = 'The car may be newer than what you know — its parts are in the catalogues all the same: search, do not answer from memory.';
    const sites = "partsouq.com, amayama.com, megazip.net, 7zap.com, the maker's, dealers' parts shops";
    const answer = `${FRAME}
${LINES} | page address
D | address of a catalogue diagram picture showing the part | page address
P | address of a photo of the part itself | page address`;
    if (!steps && !deep)
      return `Use Google Search now to find the genuine (OEM) part number of "${part}" for exactly this car: ${carWords(car, vin, built)}. ${newer}
Search once (a second time only if the first shows no number) — catalogues: ${sites}. Every number must come from a search result or a page.${known}
Answer only with lines like these, nothing else:
${answer}`;
    return `A garage needs the genuine (OEM) part number of "${part}" for exactly this car: ${carWords(car, vin, built)}. ${newer}${known}
Step 1 — call Google Search with: ${query || `${car} ${part} genuine part number`}
Step 2 — ${deep ? "it is hard to find: search again, in other words — the car's frame (chassis) and engine codes, the catalogue's own name of the part and its other names (British and American words), the catalogue group it is in; a part sold only inside an assembly or a kit — that number, saying so" : 'only if the results show no number, search once more in other words'} (the catalogues: ${sites}).
Step 3 — answer only with lines like these, nothing else (every number from a search result or a page):
${answer}`;
  },
  extract: (text) =>
    `Write this parts-catalogue answer down as JSON, nothing added:
numbers: each {number (as written), brand, note (variants, market, replaces…, under 80 characters), pages: [addresses where it was seen]}; images: each {url, kind: "diagram" | "photo", page}.
Answer:
${text}`,
};

const FIND_SCHEMA = {
  type: 'object',
  properties: {
    numbers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { number: { type: 'string' }, brand: { type: 'string' }, note: { type: 'string' }, pages: { type: 'array', items: { type: 'string' } } },
        required: ['number'],
      },
    },
    images: {
      type: 'array',
      items: { type: 'object', properties: { url: { type: 'string' }, kind: { type: 'string' }, page: { type: 'string' } }, required: ['url'] },
    },
  },
  required: ['numbers'],
};

/** A diagram's heading for a person: «Yaris NCP91 · 2005–2011» (the make left out when the line has it). */
function headingOf(d, brand) {
  let m = String(d?.model ?? '').trim();
  if (brand && m.toLowerCase().startsWith(`${brand.toLowerCase()} `)) m = m.slice(brand.length + 1);
  const y = d?.years ? `${d.years.from}–${d.years.to ?? ''}` : '';
  return [m, y].filter(Boolean).join(' · ').slice(0, 60);
}

/**
 * The search itself. What the AI module gives it: `ask` and `json` (questions to Gemini), `page` and `image` (public
 * addresses fetched by this computer), `lookAt` (pictures told apart by a light model), `catalogPage` (a number's page
 * in the open catalogue, kept), `pageText`, `diagramImages`, `siteUrl`, `within`, the models to search with.
 */
export function createPartFind({ ask, json, page, image, lookAt, catalogPage, pageText, diagramImages, siteUrl, within, models, fetchMs = 8_000, log = () => {} }) {
  return async function findPart({ part, make, model, year, engine, vin, built, hints, number, deep, before, car, catalogOnly }) {
    const carKey = { make, model, year: Number(year) || undefined };
    const inCatalog = catalogSlugs(make).length > 0;
    // The car known well enough to tell a part's variants apart: its year, and its engine or its VIN.
    const wellKnown = !!carKey.year && (!!String(engine ?? '').trim() || !!vin);
    /** Every number met, by its letters and digits. */
    const all = new Map();
    /** The car's frame codes, as the model names them. */
    const frames = [];
    let order = 0;
    const add = (n, from) => {
      const written = String(n.number ?? '').trim().toUpperCase().slice(0, 40);
      const plain = plainNumber(written);
      if (plain.length < 5 || !/\d/.test(plain)) return undefined;
      let c = all.get(plain);
      if (!c) {
        c = { number: written, plain, brand: String(n.brand ?? '').trim().slice(0, 40), note: String(n.note ?? '').trim().slice(0, 80), pages: [], backed: [], opened: [], catalog: undefined, kind: undefined, fits: false, from, web: 0, order: order++, replaces: [], into: undefined };
        all.set(plain, c);
      } else {
        if (!c.note && n.note) c.note = String(n.note).trim().slice(0, 80);
        if (!c.brand && n.brand) c.brand = String(n.brand).trim().slice(0, 40);
      }
      for (const p of Array.isArray(n.pages) ? n.pages.map(String) : []) if (p && !c.pages.includes(p)) c.pages.push(p);
      return c;
    };
    const live = () => [...all.values()].filter((c) => !c.into && !c.ghost);
    /** The diagrams of a number (its own page, and the page of the older number it stands for) that are of this car. */
    const diagramsOf = (c) =>
      [c.fitBy?.catalog, c.catalog]
        .filter(Boolean)
        .flatMap((cat) => cat.diagrams.map((d) => ({ ...d, from: cat.url, brand: cat.brand, fit: diagramFits(d, carKey, cat.brand) })))
        .map((d) => ({ ...d, exact: d.fit && frames.length > 0 && frameFits(d, frames) }));
    /**
     * On this car's diagram: the model and its years — and, when the car's frame is known and any number is on a diagram
     * of that very frame, only such (a Yaris NCP91's pads are not a Yaris NCP90's).
     */
    const fitting = () => {
      const on = live().filter((c) => c.fits && c.kind !== false);
      const exact = on.filter((c) => diagramsOf(c).some((d) => d.exact));
      return exact.length ? exact : on;
    };

    /** The catalogue's word on every number not asked yet; a number replaced by one newer is followed to it. */
    const check = async () => {
      for (let depth = 0; depth < 3; depth++) {
        const todo = [...all.values()].filter((c) => c.catalog === undefined).slice(0, 8);
        if (!todo.length) break;
        await Promise.all(
          todo.map(async (c) => {
            c.catalog = inCatalog ? ((await catalogPage(make, c.number).catch(() => null)) ?? null) : null;
            if (!c.catalog) return;
            c.kind = sameKind(part, c.catalog.name);
            c.fits = c.catalog.diagrams.some((d) => diagramFits(d, carKey, c.catalog.brand));
          }),
        );
        // One part under two numbers: the newer one stands for both (when the catalogue names one successor).
        for (const c of todo) {
          if (!c.catalog || c.catalog.newer.length !== 1) continue;
          const had = all.has(plainNumber(c.catalog.newer[0]));
          const next = add({ number: c.catalog.newer[0], brand: c.brand, note: c.note }, c.from);
          if (!next || next === c || next.into === c.plain) continue;
          if (!had) next.linked = true;
          c.into = next.plain;
        }
      }
      // What the old number of a part had goes to its newer one.
      for (const c of all.values()) {
        if (!c.into) continue;
        let to = all.get(c.into);
        for (let i = 0; to?.into && i < 4; i++) to = all.get(to.into);
        if (!to || to === c) {
          c.into = undefined;
          continue;
        }
        // The newer one's page was not read (the catalogue did not answer): the old number stands, the link is let go.
        if (!to.catalog) {
          c.into = undefined;
          if (to.linked) to.ghost = true;
          continue;
        }
        c.into = to.plain;
        const old = c.catalog?.number ?? c.number;
        if (!to.replaces.includes(old)) to.replaces.push(old);
        for (const k of ['pages', 'backed', 'opened']) for (const x of c[k]) if (!to[k].includes(x)) to[k].push(x);
        if (c.fits && c.kind !== false && !to.fitBy) to.fitBy = c;
        if (c.fits && c.kind !== false) to.fits = true;
        if (to.kind === undefined) to.kind = c.kind;
        if (!to.note) to.note = c.note;
        to.web = to.web || c.web;
        to.own = to.own || c.own;
        to.order = Math.min(to.order, c.order);
      }
    };
    /** What the catalogue said, for the next question: a line a number. */
    const tried = () =>
      [...all.values()]
        .filter((c) => !c.ghost && c.catalog !== undefined && (inCatalog || c.catalog))
        .slice(0, 7)
        .map((c) => {
          if (!c.catalog) return `${c.number} — not in the maker's catalogue`;
          const on = [...new Set(c.catalog.diagrams.map((d) => headingOf(d, '')))].slice(0, 3).join('; ');
          return `${c.catalog.number} — "${c.catalog.name}"${c.kind === false ? ' (another part)' : ''}${on ? `, on diagrams of ${on}` : ''}${c.fits && c.kind !== false ? " — on this car's diagram" : ''}${c.into ? `, replaced by ${all.get(c.into)?.number ?? ''}` : ''}`;
        })
        .join('\n');
    const take = (parsed) => {
      for (const f of parsed.frames ?? []) if (!frames.includes(f) && frames.length < 8) frames.push(f);
    };

    /** The model's own first choice from memory (its likeliest), followed to the number that replaced it. */
    let first;
    const firstStands = () => {
      let c = first ? all.get(first) : undefined;
      for (let i = 0; c?.into && i < 4; i++) c = all.get(c.into);
      return !!c && fitting().includes(c);
    };
    /**
     * Stands without the web: the car is known well enough, and this car's diagram has a number of the garage's own —
     * or the very number the model named first (its memory and the catalogue agree; a later guess that happens to be on
     * the diagram may be the part of another production date — the web is asked).
     */
    const decided = () => wellKnown && (deep ? fresh().some((c) => c.fits) : fitting().some((c) => c.own) || firstStands());

    const query = [make, model, String(engine ?? '').trim(), part.toLowerCase(), 'genuine part number partsouq'].filter(Boolean).join(' ');
    let search = 'model';
    let stage = 0;
    let sources = [];
    const named = [];

    // The line has its number (typed, or the garage's own), the garage used some before: read in the catalogue first —
    // that alone may be the answer, nothing asked of the AI.
    for (const n of [number, ...hints].filter(Boolean)) {
      const c = add({ number: n, brand: make }, 0);
      if (c) c.own = true;
    }
    // What was found before (asked to dig deeper): where this search starts from.
    for (const n of before?.numbers ?? []) {
      const c = add({ number: n.number, brand: n.brand, note: n.note }, 0);
      if (!c) continue;
      c.own = true;
      for (const s of n.seen ?? []) if (!c.backed.includes(s) && !/megazip\.net/.test(s)) c.backed.push(s);
    }
    if (all.size) await check();
    const known = new Set(all.keys());
    /** New since the start, and with something to its name (asked to dig deeper, only this counts as found). */
    const fresh = () => live().filter((c) => !known.has(c.plain) && c.kind !== false && (c.fits || c.catalog || c.backed.length || c.opened.length || c.pages.length));
    const found = () => (deep ? fresh().some((c) => c.fits) : fitting().length > 0);

    // The line's own number is in the catalogue: its name, its diagram — nothing else is looked for.
    const ownKnown = !!number && !deep && !!all.get(plainNumber(number))?.catalog;
    // «The catalogue only» (a number the garage knows already wants its diagram): nothing is asked of the AI whatever it says.
    if (!ownKnown && !catalogOnly) {
      // 0. The model's own knowledge, checked in the catalogue: for a car known well enough (else its variants cannot be
      //    told apart — the web is asked at once); asked to dig deeper — once more, told what the catalogue said.
      if (inCatalog && (wellKnown || deep) && !decided()) {
        try {
          const said = await ask(PF.guess(part, car, vin, built, hints, tried()), { kind: 'guess', models, timeout: 25_000 });
          const parsed = parseFound(said.text);
          take(parsed);
          first = parsed.numbers[0] ? plainNumber(parsed.numbers[0].number) : undefined;
          for (const n of parsed.numbers.slice(0, 5)) add(n, 0);
          await check();
          log(`ai find: ${part} | ${car} — from memory: ${parsed.numbers.map((n) => n.number).join(' ') || 'none'}; frames ${frames.join(' ') || '?'}; on the diagram ${fitting().map((c) => c.number).join(' ') || 'none'}`);
        } catch (e) {
          log(`ai guess: ${e.message}`);
        }
      }
      if (!decided()) {
        // 1–3. The web: one search; then with the pages read; then a deep one — each only when the one before found
        //      nothing that stands. A line with its own number asks the web once, no more (it wants its pictures).
        for (const s of deep ? [2, 3] : number ? [1] : [1, 2, 3]) {
          let r;
          try {
            // The model itself chooses whether to search (measured: the same question is searched one time and answered
            // from memory the next). Answered without a search — asked once more at this step: nothing was paid for the
            // first, and the dearer steps are for a search that found nothing, not for one that was not made.
            for (let attempt = 0; attempt < 2; attempt++) {
              const q = PF.search(part, car, vin, built, hints, { tried: tried(), deep: s === 3, steps: attempt > 0, query });
              r = await ask(attempt ? `Search first — your last answer came without a search.\n${q}` : q, { kind: s === 1 ? 'find' : 'dig', search: true, read: s >= 2, thinking: s === 3 ? 'medium' : 'low', models, timeout: s === 1 ? 40_000 : s === 2 ? 45_000 : 70_000 });
              if (r.searched) break;
              // What it said from memory is read in the catalogue all the same (it may be right) — as a guess.
              const guessed = parseFound(r.text);
              take(guessed);
              for (const n of guessed.numbers.slice(0, 5)) add(n, 0);
            }
          } catch (e) {
            if (!e.searchOff) {
              // A later step failing leaves what the earlier ones found.
              if (!all.size) throw e;
              log(`ai search ${s}: ${e.message}`);
              break;
            }
            // No Google Search on this key: what the model knows itself (outside the catalogue's makes it was not asked yet).
            if (!inCatalog || !wellKnown) {
              const own = await ask(PF.guess(part, car, vin, built, hints, tried()), { kind: 'find', models, timeout: 60_000 });
              let parsed = parseFound(own.text);
              if (!parsed.numbers.length && /[A-Z0-9-]{5,}/i.test(own.text) && /\d{3}/.test(own.text)) parsed = (await json(PF.extract(own.text), FIND_SCHEMA, { kind: 'extract', thinking: 'minimal', timeout: 30_000 })).value;
              take(parsed);
              for (const n of (Array.isArray(parsed.numbers) ? parsed.numbers : []).slice(0, 5)) add(n, 0);
              await check();
            }
            break;
          }
          stage = s;
          let parsed = parseFound(r.text);
          if (!parsed.numbers.length && /[A-Z0-9-]{5,}/i.test(r.text) && /\d{3}/.test(r.text) && !/^\s*NONE\s*$/i.test(r.text)) {
            const x = await json(PF.extract(r.text), FIND_SCHEMA, { kind: 'extract', thinking: 'minimal', timeout: 30_000 }).catch(() => undefined);
            if (x) parsed = { numbers: Array.isArray(x.value.numbers) ? x.value.numbers : [], images: Array.isArray(x.value.images) ? x.value.images : [], frames: [] };
          }
          take(parsed);
          if (r.searched) search = 'web';
          sources = [...sources, ...r.sources].slice(0, 12);
          for (const n of (parsed.numbers ?? []).slice(0, 5)) {
            const c = add(n, s);
            // Named by a search — not by an answer given without one (that is the model's memory again).
            if (c && !c.web && r.searched) c.web = s;
          }
          for (const i of (parsed.images ?? []).filter((x) => x && typeof x.url === 'string').slice(0, 6)) {
            try {
              const url = new URL(i.url, i.page || undefined).toString();
              if (!named.some((c) => c.url === url)) named.push({ url, from: i.page || '', hint: i.kind });
            } catch {
              // not an address
            }
          }
          // Google's own reading: the words of the answer that hold a number, backed by search results (their sites).
          if (r.searched)
            for (const c of all.values())
              for (const x of r.supports) {
                if (!plainNumber(x.text).includes(c.plain)) continue;
                for (const site of x.sites.map((st) => siteUrl(st)).filter(Boolean)) if (!c.backed.includes(site)) c.backed.push(site);
              }
          await check();
          // Stands: this car's diagram has one (and the web was really searched, or the car is known well); or the search
          // named one the catalogue does not refuse — it has it, or the make is not the catalogue's, or the results back it.
          // (Measured: told to search only once, the model named for a Pajero a number no catalogue had, seen on one site —
          // a lone sighting of a number the maker's catalogue does not have is not a find.)
          const sites = (c) => new Set([...c.backed, ...c.pages].map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }).filter(Boolean)).size;
          const named1 = live().some((c) => c.web === s && c.kind !== false && (c.catalog || sites(c) >= 2 || (!inCatalog && sites(c) >= 1)));
          const stood = deep ? fresh().length > 0 : (found() && r.searched) || decided() || (r.searched && named1);
          log(`ai find: ${part} | ${car} — step ${s}: ${r.searched ? 'searched' : 'no search'}, named ${(parsed.numbers ?? []).map((n) => n.number).join(' ') || 'none'}; on the diagram ${fitting().map((c) => c.number).join(' ') || 'none'}${stood ? '; stands' : ''}`);
          if (stood) break;
        }
      }
    }
    if ([...all.values()].some((c) => c.catalog)) search = 'web';

    // The pages named (public addresses only) are opened here when the catalogue did not speak: a number seen on them counts.
    const spoken = live().some((c) => c.catalog && c.kind !== false);
    let pages = [];
    if (!spoken && search === 'web') {
      const urls = [...new Set([...live().flatMap((c) => c.pages), ...named.map((i) => i.from).filter(Boolean), ...sources.map((x) => x.url)])].slice(0, 8);
      pages = (await within(urls.map(page), fetchMs)).filter(Boolean);
      for (const c of live()) for (const pg of pages) if (plainNumber(pageText(pg.html)).includes(c.plain) && !c.opened.includes(pg.url)) c.opened.push(pg.url);
    }

    // The numbers, the surest first: on this car's diagram; in the catalogue as this part; seen on the web. Left out:
    // what the catalogue calls another part; what only the model's memory names (the catalogue has it, but not on this
    // car's diagram) once a number does stand on this car's diagram; a memory's number the catalogue does not have.
    const fit = new Set(fitting());
    const evidence = (c) => c.backed.length + c.opened.length;
    const rank = (c) => (fit.has(c) ? 0 : c.catalog ? 1 : 2);
    const out = live()
      .filter((c) => c.kind !== false)
      .filter((c) => fit.has(c) || c.own || c.web || evidence(c) > 0 || !inCatalog || (c.catalog && !fit.size))
      .sort((a, b) => rank(a) - rank(b) || evidence(b) - evidence(a) || a.order - b.order)
      .slice(0, 5);
    const numbers = out.map((c) => {
      const mine = diagramsOf(c);
      const shown = mine.find((d) => d.exact) ?? mine.find((d) => d.fit) ?? mine[0];
      // Where it was seen for this car: the pages opened, Google's own results — and the catalogue's page when it is on
      // this car's diagram, or the web (or the garage) named it (a number the catalogue merely has is not «seen»).
      const cat = c.catalog && (fit.has(c) || c.web || c.own) ? [c.catalog.url] : [];
      return {
        number: c.catalog?.number || c.number,
        brand: c.catalog?.brand || c.brand,
        note: c.note,
        seen: [...new Set([...c.opened, ...(search === 'web' ? c.backed : []), ...cat])],
        ...(fit.has(c) ? { fits: true } : {}),
        ...(c.catalog ? { name: c.catalog.name } : {}),
        ...(shown ? { model: headingOf(shown, shown.brand) } : {}),
        ...(c.replaces.length ? { replaces: c.replaces.slice(0, 4) } : {}),
      };
    });

    // The pictures. 1. The part's factory diagram from the catalogue, its callout's place with it: of the numbers on this
    // car's diagram (two at most, of different drawings); none stands — the first number's.
    const drawings = [];
    for (const c of fit.size ? out.filter((x) => fit.has(x)) : out.slice(0, 1)) {
      if (drawings.length >= 2) break;
      const mine = diagramsOf(c);
      const best = mine.find((d) => d.exact) ?? mine.find((d) => d.fit) ?? mine[0];
      if (best && !drawings.some((d) => d.image === best.image)) drawings.push(best);
    }
    const top = out[0];
    // 2. A photo of the part: the UAE's catalogue keeps one by the number.
    const photoUrl = top?.catalog ? `https://partsouq.com/assets/tesseract/assets/partsimages/${encodeURIComponent(top.catalog.brand)}/${plainNumber(top.catalog.number)}.jpg` : '';
    const early = named.slice(0, 4).map((c) => image(c.url, c.from || c.url).then((img) => (img ? { ...img, hint: c.hint } : null)));
    const [drawn, photo] = await Promise.all([
      within(
        drawings.map((d) => image(d.image, d.from, 300).then((img) => (img ? { ...img, kind: 'diagram', marks: d.areas, title: [d.name, headingOf(d, d.brand)].filter(Boolean).join(' — ').slice(0, 90) } : null))),
        fetchMs,
      ),
      photoUrl ? within([image(photoUrl, 'https://partsouq.com/')], fetchMs).then((x) => x[0]) : Promise.resolve(null),
    ]);
    const images = drawn.filter(Boolean);
    const photos = photo ? [{ ...photo, kind: 'photo' }] : [];
    // 3. Without the catalogue's diagram, or without a photo: the pictures the search named and those of the opened
    //    pages, looked at by a light model (the part's diagram, photos of the part — the rest goes).
    if (!images.length || !photos.length) {
      const fromPages = [];
      for (const pg of pages) {
        const has = out.filter((c) => c.opened.includes(pg.url)).map((c) => c.number);
        if (!has.length) continue;
        for (const x of diagramImages(pg.html, pg.url, has).slice(0, 2)) if (!named.some((n) => n.url === x.url) && !fromPages.some((n) => n.url === x.url)) fromPages.push({ url: x.url, from: pg.url });
      }
      const late = fromPages.slice(0, 4).map((c) => image(c.url, c.from));
      const fetched = (await within([...early, ...late], fetchMs)).filter(Boolean).slice(0, 5);
      if (fetched.length && out.length) {
        const kept = await lookAt(fetched, part, car).catch(() => []);
        for (const k of kept) {
          if (k.kind === 'diagram' && !images.length) images.push(k);
          if (k.kind === 'photo' && photos.length < 2) photos.push(k);
        }
      }
    }
    // The diagram first, then the photo: three pictures at most.
    return { part, car, search, stage, numbers, ...(frames.length ? { frames: frames.slice(0, 4) } : {}), sources: sources.slice(0, 8), images: [...images.slice(0, 2), ...photos].slice(0, 3) };
  };
}
