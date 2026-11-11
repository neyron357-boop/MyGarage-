/*
 * A scanner's report (PDF), read into data: the car (VIN, year, make, model, engine, odometer) and the
 * fault codes with their description, state and module. Made for LAUNCH X-431 "Diagnostic History"
 * reports — "Key:value" lines, then a DTC table (DTC · Description · State · System) whose cells wrap
 * over several lines — and tolerant of others: any line with a code is taken.
 *
 * Input: the PDF's text pieces with their position (services/pdfText.ts); y grows upwards.
 */

export interface TextItem {
  page: number;
  x: number;
  y: number;
  str: string;
}

export interface ObdCode {
  /** P0430 — the code as people say it. */
  code: string;
  /** P0430-00 — as the scanner printed it (with the failure type). */
  full: string;
  description: string;
  /** Current · History · Passed And Failed · Pending… */
  state: string;
  /** The module that reported it: Engine Control Module (ECM)… */
  system: string;
}

export interface ObdReport {
  tool?: string;
  vehicle: {
    plate?: string;
    year?: number;
    make?: string;
    model?: string;
    vin?: string;
    engine?: string;
    odometer?: { value: number; unit: 'km' | 'mi' };
  };
  /** When the car was scanned (Dubai time). */
  testedAt?: string;
  softwareVersion?: string;
  appVersion?: string;
  codes: ObdCode[];
}

const CODE = /^([PCBU][0-9A-F]{4})(?:-([0-9A-F]{2}))?$/i;
const CODE_IN_TEXT = /\b([PCBU][0-9A-F]{4})(?:-([0-9A-F]{2}))?\b/i;
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/i;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** "2026-10-26 01:52:17AM" → "2026-10-26T01:52:17+04:00". */
function testTime(s: string): string | undefined {
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?/i.exec(s);
  if (!m) return undefined;
  let h = +m[4];
  if (m[7]) h = (h % 12) + (/pm/i.test(m[7]) ? 12 : 0);
  return `${m[1]}-${m[2]}-${m[3]}T${String(h).padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}+04:00`;
}

/** Lines of text, top to bottom, page by page (pieces on the same baseline joined). */
function lines(items: TextItem[]): { page: number; y: number; x: number; text: string }[] {
  const sorted = [...items].filter((i) => i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const out: { page: number; y: number; x: number; text: string }[] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= 2) last.text = clean(`${last.text} ${it.str}`);
    else out.push({ page: it.page, y: it.y, x: it.x, text: clean(it.str) });
  }
  return out;
}

export function parseObdReport(items: TextItem[]): ObdReport {
  const report: ObdReport = { vehicle: {}, codes: [] };
  const all = items.map((i) => i.str).join(' ');
  if (/launch/i.test(all)) report.tool = /x-?431/i.test(all) ? 'LAUNCH X-431' : 'LAUNCH';

  // The car: "Key:value" lines.
  for (const l of lines(items)) {
    const m = /^([A-Za-z][A-Za-z #.]*?)\s*:\s*(.*)$/.exec(l.text);
    if (!m) continue;
    const key = m[1].toLowerCase().trim();
    const value = clean(m[2]);
    if (!value) continue;
    const v = report.vehicle;
    if (/^license|^plate/.test(key)) v.plate ??= value;
    else if (key === 'year' && /^\d{4}$/.test(value)) v.year ??= +value;
    else if (key === 'make' || key === 'brand') v.make ??= value;
    else if (key === 'model') v.model ??= value;
    else if (key === 'vin' && VIN.test(value.replace(/\s/g, ''))) v.vin ??= value.replace(/\s/g, '').toUpperCase();
    else if (/^odometer|^mileage/.test(key)) {
      const o = /(\d[\d,. ]*)\s*(miles?|mi|km|kilomet)/i.exec(value);
      const n = o ? Number(o[1].replace(/[, ]/g, '')) : NaN;
      if (o && Number.isFinite(n)) v.odometer ??= { value: Math.round(n), unit: /^mi/i.test(o[2]) ? 'mi' : 'km' };
    } else if (/^engine/.test(key)) v.engine ??= value;
    else if (/^test time|^date|^time/.test(key)) report.testedAt ??= testTime(value);
    else if (/^vehicle software/.test(key)) report.softwareVersion ??= value;
    else if (/^diagnostic application/.test(key)) report.appVersion ??= value;
  }

  // The DTC table: its header gives the columns; a code starts a row and every piece belongs to the
  // code nearest to it in height (cells wrap over lines above and below the code).
  type Cols = { desc: number; state: number; system: number; headY: number };
  let cols: Cols | undefined;
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  for (const page of pages) {
    const onPage = items.filter((i) => i.page === page && i.str.trim());
    const head = onPage.find((i) => /^description$/i.test(i.str.trim()));
    if (head) {
      const same = onPage.filter((i) => Math.abs(i.y - head.y) <= 2);
      const at = (re: RegExp) => same.find((i) => re.test(i.str.trim()))?.x;
      cols = { desc: head.x, state: at(/^state|^status/i) ?? Infinity, system: at(/^system|^module/i) ?? Infinity, headY: head.y };
    }
    if (!cols) continue;
    const c = cols;
    const below = onPage.filter((i) => (head ? i.y < c.headY - 2 : true));
    const codes = below.filter((i) => i.x < c.desc - 4 && CODE.test(i.str.trim()));
    if (!codes.length) continue;
    const rows = codes.map((i) => {
      const m = CODE.exec(i.str.trim())!;
      return { y: i.y, code: m[1].toUpperCase(), full: i.str.trim().toUpperCase(), desc: [] as TextItem[], state: [] as TextItem[], system: [] as TextItem[] };
    });
    for (const it of below) {
      if (codes.includes(it)) continue;
      const row = rows.reduce((best, r) => (Math.abs(r.y - it.y) < Math.abs(best.y - it.y) ? r : best));
      if (Math.abs(row.y - it.y) > 40) continue;
      if (it.x >= c.system - 4) row.system.push(it);
      else if (it.x >= c.state - 4) row.state.push(it);
      else if (it.x >= c.desc - 4) row.desc.push(it);
    }
    const join = (list: TextItem[]) => clean(list.sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.str).join(' ')).replace(/Control ?Module/g, 'Control Module');
    for (const r of rows) report.codes.push({ code: r.code, full: r.full, description: join(r.desc), state: join(r.state), system: join(r.system) });
  }

  // No table found: a code anywhere in a line, the rest of the line as its description.
  if (!report.codes.length) {
    for (const l of lines(items)) {
      const m = CODE_IN_TEXT.exec(l.text);
      if (!m || /^vin\b/i.test(l.text)) continue;
      const code = m[1].toUpperCase();
      if (report.codes.some((x) => x.code === code)) continue;
      report.codes.push({ code, full: m[0].toUpperCase(), description: clean(l.text.replace(m[0], '')), state: '', system: '' });
    }
  }
  return report;
}

/** The odometer in kilometres (the act counts km). */
export const odometerKm = (o: { value: number; unit: 'km' | 'mi' } | undefined): number | undefined =>
  o ? (o.unit === 'mi' ? Math.round(o.value * 1.609344) : o.value) : undefined;
