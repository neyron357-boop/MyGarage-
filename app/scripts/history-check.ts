/*
 * A customer's invoices from before this app (v0.45), checked in a terminal — written nowhere unless --apply:
 *
 *   npm run history:check -- <folder of the PDFs> [--expect <expected.json>] [--rate 500]
 *   … --db <garage.db> --customer <id>  — against the garage's records (read only): jobs, cars, flags
 *   … --apply http://127.0.0.1:8788      — and written there (the server's page; see below), --backup <file> for the copy
 *
 * Every PDF is read as the app reads it (domain/historyInvoices.ts): its pages (summary · invoice A or B · terms · empty),
 * every invoice's sums checked, the summary's rows matched with the invoices. Printed: the month table (invoices, lines,
 * net, VAT, total) against the expected one, the plates, what the summaries say otherwise. Exit 1 when a sum does not add
 * up or the table is not the expected one.
 *
 * expected.json — { "months": [{ "month": "2026-05", "invoices": 8, "lines": 36, "net": "8880.00", "vat": "444.00",
 * "total": "9324.00" }, …, { "month": "all", … }], "plates": 59 } — kept with the PDFs, never in this repository (a
 * customer's figures).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { matchSummary, monthTable, readDocument, tableDiff, type MonthRow } from '../src/domain/historyInvoices';
import type { TextItem } from '../src/domain/obdReport';

const args = process.argv.slice(2).filter((a) => a !== '--');
const dir = args.find((a, i) => !a.startsWith('--') && !['--expect', '--rate'].includes(args[i - 1]));
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!dir) {
  console.log('npm run history:check -- <folder of PDFs> [--expect expected.json] [--rate 500]');
  process.exit(2);
}
const rateBp = Number(opt('--rate') ?? 500);

/** The pieces of a PDF's text with their places — as services/pdfText.ts gives them in the app. */
async function textItems(bytes: Uint8Array): Promise<{ items: TextItem[]; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  const items: TextItem[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    for (const it of content.items) {
      if ('str' in it && it.str.length) items.push({ page, x: Math.round(it.transform[4] * 10) / 10, y: Math.round(it.transform[5]), str: it.str.trim() ? it.str : ' ', w: Math.round(it.width * 10) / 10 });
    }
  }
  return { items, pages: doc.numPages };
}

const fmt = (fils: number) => (fils / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s: string | number, n: number, left = false) => (left ? String(s).padEnd(n) : String(s).padStart(n));

const files = fs
  .readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.pdf'))
  .sort();
const invoices: { date: string; plate: string; lines: { netFils: number; vatFils: number; grossFils: number }[] }[] = [];
let problems = 0;
for (const f of files) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const { items, pages } = await textItems(bytes);
  const doc = readDocument(items, pages, rateBp);
  console.log(`\n${f}  (${pages} pages, sha256 ${sha}…)  ${Object.entries(doc.kinds).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  for (const p of doc.problems) console.log(`  ✗ ${p}`);
  problems += doc.problems.length;
  invoices.push(...doc.invoices);
  if (doc.summary) {
    const { matches, unlisted } = matchSummary(doc.summary.rows, doc.invoices);
    const sum = doc.invoices.reduce((a, i) => a + i.printed.total, 0);
    const odd = matches.filter((m) => m.status !== 'ok');
    console.log(`  summary: ${doc.summary.rows.length} rows, TOTAL ${doc.summary.totalFils !== undefined ? fmt(doc.summary.totalFils) : '—'}; the invoices: ${doc.invoices.length}, ${fmt(sum)}`);
    for (const m of odd) {
      const inv = m.invoice !== undefined ? doc.invoices[m.invoice] : undefined;
      const r = m.row;
      const what =
        m.status === 'missing'
          ? 'no document'
          : `${m.status}: ${inv!.numberKind === 'job' ? 'Job' : 'Inv'} ${inv!.number} — ${m.status !== 'amount' ? `plate ${inv!.plate}` : ''}${m.status === 'plate-amount' ? ', ' : ''}${m.status !== 'plate' ? `sum ${fmt(inv!.printed.total)}` : ''}`;
      console.log(`    · row ${r.no} ${r.date} ${r.vehicleText} ${r.plate} ${fmt(r.amountFils)}${r.invoiceNo ? ` (#${r.invoiceNo})` : ''} → ${what}`);
    }
    for (const i of unlisted) console.log(`    · not in the summary: ${doc.invoices[i].number} ${doc.invoices[i].date} ${doc.invoices[i].plate} ${fmt(doc.invoices[i].printed.total)}`);
  }
}

// Every description as read, with how many lines have it (--descriptions): what the service catalogue must know.
if (args.includes('--descriptions')) {
  const counts = new Map<string, number>();
  for (const inv of invoices as unknown as { lines: { description: string }[] }[]) for (const l of inv.lines) counts.set(l.description, (counts.get(l.description) ?? 0) + 1);
  console.log(`\nDescriptions: ${counts.size}`);
  for (const [d, n] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${String(n).padStart(3)}  ${d}`);
}

const table = monthTable(invoices);
const expected = opt('--expect') ? (JSON.parse(fs.readFileSync(opt('--expect')!, 'utf8')) as { months: { month: string; invoices: number; lines: number; net: string; vat: string; total: string }[]; plates?: number }) : undefined;
const want: MonthRow[] | undefined = expected?.months.map((m) => ({ month: m.month, invoices: m.invoices, lines: m.lines, netFils: Math.round(Number(m.net) * 100), vatFils: Math.round(Number(m.vat) * 100), totalFils: Math.round(Number(m.total) * 100) }));
console.log(`\n${pad('Month', 9, true)} ${pad('Invoices', 8)} ${pad('Lines', 6)} ${pad('Net', 12)} ${pad('VAT 5%', 10)} ${pad('Total AED', 12)}${want ? '  expected' : ''}`);
for (const r of table) {
  const w = want?.find((x) => x.month === r.month);
  const same = w ? tableDiff([r], [w]).length === 0 : undefined;
  console.log(`${pad(r.month === 'all' ? 'All' : r.month, 9, true)} ${pad(r.invoices, 8)} ${pad(r.lines, 6)} ${pad(fmt(r.netFils), 12)} ${pad(fmt(r.vatFils), 10)} ${pad(fmt(r.totalFils), 12)}${want ? (same ? '  ✓' : '  ✗') : ''}`);
}
const plates = new Set(invoices.map((i) => i.plate)).size;
console.log(`Plates as printed: ${plates}${expected?.plates !== undefined ? ` (expected ${expected.plates})` : ''}`);

// Against the garage's records (read only): each invoice's job and car, what would be brought in, what is marked.
if (opt('--db') && opt('--customer')) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(opt('--db')!, { readOnly: true });
  // A record with its id (the server keeps it beside the data; some records were written without it inside).
  const all = <T>(tbl: string): T[] => (db.prepare('SELECT id, data FROM records WHERE tbl = ? AND deleted = 0').all(tbl) as { id: string; data: string }[]).map((r) => ({ ...JSON.parse(r.data), id: r.id }) as T);
  const customerId = opt('--customer')!;
  const { planHistory } = await import('../src/domain/historyPlan');
  type Rec = { customerId: string };
  const docs = [];
  for (const f of files) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    const { items, pages } = await textItems(bytes);
    docs.push({ file: f, sha256: createHash('sha256').update(bytes).digest('hex'), read: readDocument(items, pages, rateBp) });
  }
  const plan = planHistory({
    customerId,
    docs,
    vehicles: all('vehicles'),
    orders: all<Rec & import('../src/domain/types').Order>('orders').filter((o) => o.customerId === customerId),
    existing: all<Rec & import('../src/domain/types').HistoryInvoice>('historyInvoices').filter((i) => i.customerId === customerId),
    existingRows: all<Rec & import('../src/domain/types').HistorySummaryRow>('historySummaryRows').filter((i) => i.customerId === customerId),
    now: new Date().toISOString(),
  });
  const withJob = plan.invoices.filter((i) => i.orderId).length;
  console.log(`\nAgainst the garage's records: ${plan.invoices.length} invoices — ${withJob} with their job here; ${plan.cars} cars, ${plan.newCars} brought in; to write ${plan.write.invoices.length} invoices, ${plan.write.rows.length} summary rows; ${plan.unchanged} the same as here.`);
  const flagged = plan.invoices.filter((i) => i.flags?.length);
  for (const i of flagged) console.log(`  ⚑ ${i.numberKind === 'job' ? 'Job' : 'Inv'} ${i.number} ${i.date} ${i.plate}: ${i.flags!.map((f) => f.text).join('; ')}`);
  for (const v of plan.vehicles.filter((v) => v.id.startsWith('hv-'))) console.log(`  + car ${carKeyOf(v)} ${v.make} ${v.model}${v.type ? ` (${v.type})` : ''}`);
  for (const p of plan.problems) console.log(`  ✗ ${p}`);
  problems += plan.problems.length;

  // --apply <the server's page, http://127.0.0.1:8788>: written into the garage's records — only when every sum adds up
  // and the table is the expected one; a copy of the database first; written in one go by the server (every device takes
  // it); counted again from what the server has; not the same — what was there before put back.
  if (opt('--apply')) {
    const page = opt('--apply')!.replace(/\/$/, '');
    const fail = (why: string) => {
      console.log(`\nNOT written: ${why}`);
      process.exit(1);
    };
    if (plan.problems.length || problems) fail('a sum does not add up or a page was not read');
    if (!want) fail('--expect <expected.json> is needed to write');
    if (tableDiff(plan.table, want!).length) fail('the table is not the expected one');
    const has = (tbl: string, id: string) => db.prepare('SELECT data, deleted FROM records WHERE tbl = ? AND id = ?').get(tbl, id) as { data: string | null; deleted: number } | undefined;
    const newCars = plan.vehicles.filter((v) => v.id.startsWith('hv-') && !has('vehicles', v.id));
    const changes = [
      ...newCars.map((v) => ({ t: 'vehicles', k: v.id, d: v })),
      ...plan.ownerships.filter((o) => newCars.some((v) => v.id === o.vehicleId)).map((o) => ({ t: 'ownerships', k: o.id, d: o })),
      ...plan.write.invoices.map((i) => ({ t: 'historyInvoices', k: i.id, d: i })),
      ...plan.write.rows.map((r) => ({ t: 'historySummaryRows', k: r.id, d: r })),
    ];
    if (!changes.length) {
      console.log('\nNothing to write: all of it is in the garage’s records already.');
    } else {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const copy = opt('--backup') ?? path.join(path.dirname(opt('--db')!), '..', 'Резервные копии', `garage-до-истории-инвойсов-${stamp}.db`);
      db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
      console.log(`\nA copy of the database: ${copy}`);
      // What each record was before (none — it was not there): to be put back if the figures are not the same after.
      const before = changes.map((c) => {
        const r = has(c.t, c.k);
        return { t: c.t, k: c.k, d: r && !r.deleted && r.data ? JSON.parse(r.data) : null };
      });
      const send = async (list: { t: string; k: string; d: unknown }[]) => {
        const res = await fetch(`${page}/records`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changes: list }) });
        if (!res.ok) throw new Error(`the server said ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return (await res.json()) as { rev: number; n: number };
      };
      const sent = await send(changes);
      console.log(`Written by the server: ${sent.n} records (up to rev ${sent.rev}).`);
      // Counted again from the server's records.
      const now = new DatabaseSync(opt('--db')!, { readOnly: true });
      const back = plan.invoices
        .map((i) => now.prepare('SELECT data FROM records WHERE tbl = ? AND id = ? AND deleted = 0').get('historyInvoices', i.id) as { data: string } | undefined)
        .filter((r): r is { data: string } => !!r)
        .map((r) => JSON.parse(r.data) as { date: string; lines: { netFils: number; vatFils: number; grossFils: number }[] });
      const counted = monthTable(back);
      const off = [...tableDiff(counted, plan.table), ...tableDiff(counted, want!)];
      if (back.length !== plan.invoices.length || off.length) {
        await send(before);
        fail(`counted again from the server: ${back.length} of ${plan.invoices.length} invoices; ${off.join('; ')} — what was there before is put back`);
      }
      console.log('Counted again from the garage’s records:');
      for (const r of counted) console.log(`  ${pad(r.month === 'all' ? 'All' : r.month, 9, true)} ${pad(r.invoices, 4)} ${pad(r.lines, 5)} ${pad(fmt(r.netFils), 12)} ${pad(fmt(r.vatFils), 10)} ${pad(fmt(r.totalFils), 12)}  ✓`);
    }
  }
}
function carKeyOf(v: { plate: { code: string; number: string } }) {
  return [v.plate.code, v.plate.number].filter(Boolean).join('-');
}
const diff = want ? tableDiff(table, want) : [];
for (const d of diff) console.log(`  ✗ ${d}`);
console.log(problems || diff.length ? `\nNOT the same: ${problems} problem(s), ${diff.length} difference(s).` : `\nAll invoices add up${want ? ', the table is the expected one' : ''}.`);
process.exit(problems || diff.length ? 1 : 0);
