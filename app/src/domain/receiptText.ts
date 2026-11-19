import { printedDate, type ReceiptItem, type ReceiptRead } from './receipt';
import { phoneDigits } from './phone';
import { phonesInText, sellerKey } from './suppliers';

/*
 * A supplier's paper read on the phone itself (v0.51, the user: «сделай, чтобы распознавание работало без ИИ, чтобы
 * токены не тратились зря; обучи систему на реальных инвойсах»): the words the OCR found, with their places
 * (services/vinReader.ts `readDocument`), turned into what the paper says — the way it was taught on the garage's own
 * papers (Al Maroof's form, Divya's, Lataf Tyres', Bustan Al Khaleej's, Al Ras', Al Amoudi's, Zurich's, a card slip):
 *   - rows: the words put into rows by their places (a table's columns lie apart; a photo is tilted, the paper bent);
 *   - the sum: the paper proves it itself — the amount without VAT, the VAT and the total among its figures, the VAT
 *     5 % of the amount and the two adding up to the total (every invoice prints the three, under whatever labels:
 *     «GROSS AMT.» is before VAT on one form and with it on another); a card slip alone — its «AMOUNT»;
 *   - the date: the one under a date's label («DATE», «Dated», «Invoice Date», «Delivery Date»), else the slip's;
 *   - the number, the seller (its TRN — not the garage's —, its e-mail, «For …» at the foot, the top line), its phone;
 *   - how it was paid: a card slip on it — the card (whatever the form says), «Paid on Cash» — cash, «Sales Credit» /
 *     a balance due — credit;
 *   - the lines: rows with a name and the figures that add up (price × qty, + VAT), their part numbers.
 * Sure (the sum proven, a date) — the expense is made from it and no AI is asked. Not sure — what was read is still
 * given (the sheet opens with it); the AI may be asked then.
 */

export interface PaperWord {
  text: string;
  conf: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The garage itself (the buyer on every paper): its name and TRN are not the seller's. */
export interface PaperContext {
  garageName?: string;
  garageTrn?: string;
  /** The garage's suppliers as it knows them (learned from their papers: the TRN and e-mail kept in their notes). */
  known?: KnownSeller[];
}

/** A supplier the garage knows, and what tells its papers: its TRN, its e-mail, its phones, its name. */
export interface KnownSeller {
  id: string;
  name: string;
  trn?: string;
  email?: string;
  phones?: string[];
}

/**
 * The known supplier the paper is from (v0.51 — taught by the papers before it): its TRN on it (the surest), its
 * e-mail, one of its phones, or its name (letters only, its company words aside — the OCR may part or join the words:
 * «ALMAROOF AUTO SPARE PART S» is still Al Maroof Auto Spare Parts).
 */
export function knownSellerOf(all: string, trns: string[], known: KnownSeller[]): KnownSeller | undefined {
  const digits = all.replace(/(\d)[\s.-](?=\d)/g, '$1');
  const byTrn = known.find((k) => k.trn && (trns.includes(k.trn) || digits.includes(k.trn)));
  if (byTrn) return byTrn;
  const low = all.toLowerCase();
  const byMail = known.find((k) => k.email && low.includes(k.email.toLowerCase()));
  if (byMail) return byMail;
  const flatDigits = all.replace(/\D+/g, ' ');
  const byPhone = known.find((k) => (k.phones ?? []).some((ph) => {
    const d = phoneDigits(ph).replace(/^971/, '0');
    return d.length >= 9 && ` ${flatDigits.replace(/ /g, '')} `.includes(d.replace(/^0/, ''));
  }));
  if (byPhone) return byPhone;
  const letters = low.replace(/[^a-z0-9]+/g, '');
  const byName = known
    .map((k) => ({ k, key: sellerKey(k.name) }))
    .filter((x) => x.key.length >= 6 && letters.includes(x.key))
    .sort((a, b) => b.key.length - a.key.length)[0];
  return byName?.k;
}

/** A name read clean enough to make a supplier of: words only (two at least), one of a company's. */
export function cleanName(name?: string): boolean {
  if (!name) return false;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.every((w) => /^[A-Za-z][A-Za-z&'.-]*[A-Za-z.]$|^&$/.test(w) && (w.length >= 2 || w === '&')) && COMPANY.test(name);
}

export interface PaperRead {
  read: ReceiptRead;
  /** A card slip is on the paper. */
  slip?: boolean;
  /** The date was found under a date's label. */
  dateLabelled?: boolean;
  /** The known supplier it is from (by its TRN, e-mail, phone or name). */
  seller?: KnownSeller;
  /** The sum proven by the paper itself (or a card slip's amount) and the seller known or read clean; merged (`mergePapers`) — a date too: no AI needed. */
  sure: boolean;
  /** What was found and how — for tests and for a paper that does not read. */
  why: string[];
}

interface Row {
  words: PaperWord[];
  text: string;
  y: number;
  h: number;
}

const mid = (w: PaperWord) => (w.y0 + w.y1) / 2;
const height = (w: PaperWord) => Math.max(1, w.y1 - w.y0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * The words in rows: each word goes on with the row whose last word ends left of it at about its height (the row's
 * height follows its own words — a tilted photo, a bent paper); rows top to bottom, words left to right.
 */
export function paperRows(given: PaperWord[], skew = 0): Row[] {
  // Level: each word's height as if the photo were not tilted (its lines run at `skew`).
  const words = skew ? given.map((w) => ({ ...w, y0: w.y0 - skew * w.x0, y1: w.y1 - skew * w.x0 })) : given;
  const list = words.filter((w) => w.text.trim()).sort((a, b) => a.x0 - b.x0);
  const rows: { words: PaperWord[]; y: number; h: number }[] = [];
  for (const w of list) {
    const h = height(w);
    let best: (typeof rows)[number] | undefined;
    let near = Infinity;
    for (const r of rows) {
      const last = r.words[r.words.length - 1];
      if (last.x1 > w.x0 + h * 0.6) continue;
      const tol = Math.max(h, r.h) * 0.6;
      const d = Math.abs(mid(w) - r.y);
      // A gap too wide is not one row (a stamp far off on its own line), unless the row is a table's.
      if (d <= tol && d < near && w.x0 - last.x1 < Math.max(h, r.h) * 40) (near = d), (best = r);
    }
    if (best) {
      best.words.push(w);
      best.y = mid(w);
      best.h = (best.h * (best.words.length - 1) + h) / best.words.length;
    } else rows.push({ words: [w], y: mid(w), h });
  }
  return rows
    .map((r) => ({ words: r.words, text: r.words.map((w) => w.text).join(' '), y: median(r.words.map(mid)), h: median(r.words.map(height)) }))
    .sort((a, b) => a.y - b.y);
}

/** A figure as printed: «1,470.00», «76.190», «Đ136.00», «AED 80.00», «(10.00)»; OCR's O for 0, l for 1, S for 5 put right. */
export function moneyOf(token: string): number | undefined {
  let t = token.trim().replace(/^(AED|DHS?|Đ|Ð|D|B|₫|د\.إ)\s*/i, '').replace(/(AED|DHS?)$/i, '');
  if (!/\d/.test(t)) return undefined;
  t = t.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5');
  // After the point, the last digit only: «75.0C», «90.0D» are 75.00, 90.00.
  t = t.replace(/\.(\d)[CDQ]$/i, '.$10');
  t = t.replace(/^\((.*)\)$/, '$1');
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,3})$|^\d+\.\d{1,3}$/.test(t)) return undefined;
  const v = Number(t.replace(/,/g, ''));
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined;
}

const TOTAL_WORDS = /\b(TOTAL|NET|GRAND|GROSS|AMOUNT|AMT|SUB ?TOTAL|BALANCE|VAT|PAYABLE|DHS)\b/i;
const NOT_LINE = /\b(AMT|AMOUNT IN|SUB ?TOTAL|GRAND TOTAL|NET (TOTAL|AMOUNT|AMT)|GROSS AMT|TOTAL VALUE|VAT AMOUNT|VAT ?@|BALANCE|DISCOUNT|IN WORDS|DIRHAMS?|ADVANCE|ADJUSTED|AMOUNT DUE|PAID ON|TOTAL ?:?$|^TOTAL\b)/i;
const SLIP = /\b(MASTERCARD|MASTER CARD|VISA|CONTACTLESS|APPROVAL CODE|AUTH(ORI[SZ]ATION)? CODE|CUSTOMER COPY|MERCHANT COPY|DEBIT MY ACCOUNT|NEOPAY|NETWORK|PAN SEQ|BATCH NO|TERMINAL ID|RRN)\b/i;

interface Fig {
  v: number;
  row: number;
  x: number;
}

/** The figures of the rows, each with its row and place. */
function figures(rows: Row[]): Fig[] {
  const out: Fig[] = [];
  rows.forEach((r, i) => {
    for (let k = 0; k < r.words.length; k++) {
      const w = r.words[k];
      let v = moneyOf(w.text);
      // «1 470.00», «AED 80.00» split in two words.
      if (v === undefined && /^\d{1,3}$/.test(w.text) && r.words[k + 1] && /^\d{3}\.\d{2}$/.test(r.words[k + 1].text)) v = moneyOf(w.text + ',' + r.words[k + 1].text);
      if (v !== undefined) out.push({ v, row: i, x: w.x0 });
    }
  });
  return out;
}

const near = (a: number, b: number, d = 0.021) => Math.abs(a - b) <= d;
const isVatOf = (net: number, vat: number) => vat > 0 && Math.abs(vat - net * 0.05) <= 0.03 + net * 0.0005;

/**
 * The paper's sum proven by itself: three of its figures, the amount, the VAT (5 % of it) and the total (the two
 * added). The largest such total is the paper's (a line's own three are smaller, or the same when it is one line); a
 * total under a total's label, or lower on the paper, first among equals.
 */
function proven(rows: Row[], figs: Fig[]): { net: number; vat: number; total: number; row: number } | undefined {
  const vals = [...new Set(figs.map((f) => f.v))].filter((v) => v > 0);
  let best: { net: number; vat: number; total: number; row: number; score: number } | undefined;
  for (const total of vals)
    for (const vat of vals) {
      if (vat >= total) continue;
      const net = Math.round((total - vat) * 100) / 100;
      if (!vals.some((v) => near(v, net)) || !isVatOf(net, vat)) continue;
      const at = figs.filter((f) => near(f.v, total));
      const row = Math.max(...at.map((f) => f.row));
      const labelled = at.some((f) => TOTAL_WORDS.test(rows[f.row].text) || (rows[f.row + 1] && /NET|TOTAL/i.test(rows[f.row + 1].text)));
      const score = total * 1000 + (labelled ? 500 : 0) + row;
      if (!best || score > best.score) best = { net, vat, total, row, score };
    }
  return best && { net: best.net, vat: best.vat, total: best.total, row: best.row };
}

/** The date under a date's label first (the paper's own), then any date on it (a card slip's). */
function dateOf(rows: Row[]): { date?: string; text?: string; labelled: boolean } {
  const LABEL = /\b(DATE|DATED|INVOICE DATE|DELIVERY DATE|INV\.? DATE|BILL DATE)\b/i;
  const found: { date: string; text: string; labelled: boolean; slip: boolean }[] = [];
  rows.forEach((r, i) => {
    const texts = [r.text, rows[i + 1]?.text ?? ''];
    for (const t of [r.text]) {
      const m = t.match(/\b\d{1,2}[\s\-/.]*(?:[A-Za-z]{3,9})[\s\-/.,']*\d{2,4}\b|\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/);
      if (!m) continue;
      const date = printedDate(m[0]);
      if (!date) continue;
      const labelled = LABEL.test(t) || (i > 0 && LABEL.test(rows[i - 1].text) && !/\d/.test(rows[i - 1].text));
      found.push({ date, text: m[0], labelled, slip: SLIP.test(texts.join(' ')) || /\bTIME\b/i.test(t) });
    }
  });
  const pick = found.find((f) => f.labelled && !f.slip) ?? found.find((f) => f.labelled) ?? found.find((f) => !f.slip) ?? found[0];
  return pick ? { date: pick.date, text: pick.text, labelled: pick.labelled } : { labelled: false };
}

/** The paper's own number: the word after «Invoice No», «Tax Invoice No.», «Inv #», «Bill No». */
function numberOf(rows: Row[]): string | undefined {
  for (const r of rows) {
    const m = r.text.match(/\b(?:TAX\s+)?(?:INVOICE|INV|BILL)\s*(?:NO|NUMBER|#)\.?\s*[:.]?\s*([A-Z0-9][A-Z0-9/\-]{2,24})/i);
    if (m && /\d/.test(m[1]) && !/^(DATE|TRN)$/i.test(m[1])) return m[1].toUpperCase();
  }
  return undefined;
}

const COMPANY = /\b(L\.?L\.?C\.?|LLC|TRADING|TR\.?|PARTS|SPARE|AUTO|TYRES?|TIRES?|ESTABLISHMENT|EST\.?|FZE|FZCO|GARAGE|MOTORS?|CENTER|CENTRE|WORKSHOP|ACCESSORIES)\b/i;
const NOT_NAME = /\b(TAX INVOICE|INVOICE|ORIGINAL|CUSTOMER COPY|DELIVERY NOTE|DUPLICATE|RECEIPT|PAGE|TEL|MOB|PHONE|FAX|EMAIL|E-MAIL|P\.?O\.? BOX|TRN|WWW|HTTP|DATE)\b/i;

/** The seller's name: «For …» at the foot (a form signs off so), else the top's largest name-like line (with the line under it when it goes on). */
function sellerOf(rows: Row[], ctx: PaperContext, pageHeight: number): string | undefined {
  const mine = (t: string) => !!ctx.garageName && sellerWords(t) === sellerWords(ctx.garageName);
  for (const r of rows) {
    const m = r.text.match(/^\s*for\s+([A-Z][A-Za-z0-9 .&'-]{3,70})$/i);
    if (m && COMPANY.test(m[1]) && !mine(m[1])) return clean(m[1]);
  }
  const top = rows.filter((r) => r.y < pageHeight * 0.3 && /[A-Za-z]{2,}.*[A-Za-z]{2,}/.test(r.text) && !NOT_NAME.test(r.text) && !mine(r.text));
  if (!top.length) return undefined;
  const big = [...top].sort((a, b) => b.h - a.h || a.y - b.y);
  for (const r of big.slice(0, 4)) {
    const at = rows.indexOf(r);
    const next = rows[at + 1];
    let name = r.text;
    if (next && COMPANY.test(next.text) && !NOT_NAME.test(next.text) && next.y - r.y < r.h * 2.5 && !COMPANY.test(name)) name = `${name} ${next.text}`;
    if (COMPANY.test(name) || r === big[0]) return clean(name);
  }
  return undefined;
}
const clean = (s: string) =>
  s
    .replace(/[|_~«»"()[\]{}<>=+*\\/]+/g, ' ')
    .split(/\s+/)
    .filter((w) => /^[A-Za-z][A-Za-z&'.-]*$/.test(w) && (w.length >= 2 || w === '&'))
    .join(' ')
    .trim()
    .slice(0, 60);
const sellerWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** A part number as a catalogue writes it: letters and digits mixed, often with dashes («12310-EA000», «68217808AAT», «CAS-1427»). */
const PART_NO = /^(?=.*\d)(?=.*[A-Z])[A-Z0-9][A-Z0-9-]{4,19}$|^\d{5}-\d{5}$|^\d{8,}[A-Z]{2,3}$/;

/**
 * The lines: rows with a name and figures that hold together — the price × the quantity is the amount, the amount and
 * its VAT add up to the line's total —, above the paper's total. A row's first figure-free words are its name (its
 * row number and its part number aside).
 */
interface Line extends ReceiptItem {
  /** Its VAT, when the row's figures prove it (the VAT 5 % of the amount, the two adding up to the line's total). */
  vat?: number;
}
const HEAD_WORDS = /\b(DESCRIPTION|DESC|PARTICULARS|ITEM|QTY|QUANTITY|PRICE|RATE|AMOUNT|AMT|UNIT|VAT|TAX|CODE|PART|MATERIAL|GOODS|TOTAL|NET|GROSS)\b/gi;
/** The table's header: a row of at least three of its column names. */
export function headerRow(rows: Row[]): number {
  return rows.findIndex((r) => new Set((r.text.match(HEAD_WORDS) ?? []).map((w) => w.toUpperCase())).size >= 3 && !/\d\.\d\d/.test(r.text));
}
/** Footer and slip words: never a line of goods. */
const NOT_GOODS = /\b(PLEASE|TRANSACTION|VISIT|THANK|SIGNATURE|RECEIVED|DELIVERED|PLACE|EMIRATES|WARRANTY|JURISDICTION|TERMS|CONDITIONS|DECLARATION|CUSTOMER|SALESMAN|SALES ?PERSON|PAYMENT|BALANCE|DATE|INVOICE|TRN|PHONE|TEL|MOB)\b/i;

function linesOf(all: Row[], totalRow: number): Line[] {
  const out: Line[] = [];
  // Within the table when there is one: under its header, down to its totals.
  const head = headerRow(all);
  let end = all.length;
  // The table ends at its first totals' row after a line with figures (a header's second row — «AED  %  Amt» — is not it).
  let seenLine = false;
  if (head >= 0)
    for (let i = head + 1; i < all.length; i++) {
      const figs = all[i].words.some((w) => /\d[.,]\d{2}\b/.test(w.text));
      if (NOT_LINE.test(all[i].text) && seenLine) {
        end = i;
        break;
      }
      if (figs && !NOT_LINE.test(all[i].text)) seenLine = true;
    }
  const given = head >= 0 ? all.slice(head + 1, end) : all.slice(0, totalRow + 2);
  const hasMoney = (r: Row) => r.words.some((w) => moneyOf(w.text) !== undefined);
  const hasName = (r: Row) => /[A-Za-z]{3,}/.test(r.words.filter((w) => moneyOf(w.text) === undefined).map((w) => w.text).join(' '));
  const rows: Row[] = [];
  for (let i = 0; i < given.length; i++) {
    const r = given[i];
    const next = given[i + 1];
    if (next && !hasMoney(r) && hasName(r) && hasMoney(next) && !hasName(next) && next.y - r.y < Math.max(r.h, next.h) * 2.2) {
      rows.push({ words: [...r.words, ...next.words.map((w) => ({ ...w, x0: w.x0 + 100000, x1: w.x1 + 100000 }))], text: `${r.text} ${next.text}`, y: r.y, h: r.h });
      i++;
    } else rows.push(r);
  }
  rows.forEach((r) => {
    if (NOT_LINE.test(r.text) || SLIP.test(r.text) || NOT_GOODS.test(r.text)) return;
    // A figure with one decimal counts only beside two-decimal ones (alone it is a size: «AT 2.2», «2.5 TON»).
    const raw = r.words.map((w) => moneyOf(w.text));
    const twoDecimals = r.words.some((w) => /\d[.,]\d{2}\b/.test(w.text) && moneyOf(w.text) !== undefined);
    const vals = raw.map((v, k) => (v !== undefined && !twoDecimals && /\.\d$/.test(r.words[k].text) ? undefined : v));
    const money = vals.filter((v): v is number => v !== undefined);
    if (!money.length || /^\W*VAT\b/i.test(r.text)) return;
    const firstFig = vals.findIndex((v) => v !== undefined);
    // The name: the words before the figures, a row number and a part number aside.
    const head = r.words.slice(0, firstFig < 0 ? r.words.length : firstFig);
    let k = 0;
    if (head[0] && /^\d{1,2}[).]?$/.test(head[0].text)) k = 1;
    let partNumber: string | undefined;
    const name: string[] = [];
    let qty: number | undefined;
    for (; k < head.length; k++) {
      const t = head[k].text.replace(/[|]/g, '');
      if (!t) continue;
      if (!partNumber && PART_NO.test(t.toUpperCase()) && name.length === 0) {
        partNumber = t.toUpperCase();
        continue;
      }
      name.push(t);
    }
    // A quantity: a whole number (or «1.00») just before the prices, at the end of the name.
    while (name.length && /^\d{1,4}$/.test(name[name.length - 1]) && qty === undefined && name.length > 1) qty = Number(name.pop());
    const desc = name.join(' ').trim();
    if (!/[A-Za-z]{2,}/.test(desc) || desc.length < 3) return;
    // The figures: the last is the line's total; a VAT that is 5 % of the amount; a price × quantity.
    const total = money[money.length - 1];
    let net: number | undefined;
    let vat: number | undefined;
    for (let a = 0; a < money.length - 1 && net === undefined; a++)
      for (let b = 0; b < money.length - 1; b++) {
        if (a === b) continue;
        if (near(money[a] + money[b], total) && isVatOf(money[a], money[b])) {
          net = money[a];
          vat = money[b];
          break;
        }
      }
    // The price misread («550.00» as «560.0»): the VAT and the total prove the line by themselves.
    if (net === undefined)
      for (const v of money.slice(0, -1)) {
        const n = Math.round((total - v) * 100) / 100;
        if (v < total && isVatOf(n, v)) {
          net = n;
          vat = v;
          break;
        }
      }
    const smalls = money.filter((v) => Number.isInteger(v) && v > 0 && v <= 999);
    if (qty === undefined) {
      // «1.00» read as a figure before the price: the quantity (when price × it is the amount).
      for (const q of smalls) {
        const rest = money.filter((v) => v !== q);
        if (rest.some((p) => rest.some((amt) => near(p * q, amt, 0.05) && amt >= p))) {
          qty = q;
          break;
        }
      }
    }
    const lineNet = net ?? total;
    const unit = qty && qty > 0 ? Math.round((lineNet / qty) * 100) / 100 : lineNet;
    out.push({ name: desc.toUpperCase(), partNumber, qty: qty ?? 1, unitPrice: unit, total: vat !== undefined ? total : lineNet, vat });
  });
  return out;
}

/** How it was paid: a card slip on the paper — the card; «Paid on Cash» — cash; «Sales Credit», a balance due — credit. */
function wayOf(all: string): string {
  const slipWords = new Set((all.match(new RegExp(SLIP.source, 'gi')) ?? []).map((w) => w.toUpperCase()));
  if (slipWords.size >= 2) return 'card';
  if (/\bPAID\s+(ON|BY|IN)\s+CASH\b|\bCASH\s+(SALE|PAID|RECEIVED)\b|\bMODE OF SALES?\s*:?\s*CASH\b/i.test(all)) return 'cash';
  // «Sales Credit» as a faint print reads: «Sales Cradlt», «Sales Credlt».
  if (/\b(SALES?\s+CR[AE][DT]\w{0,4}|ON\s+CREDIT|CREDIT\s+(SALE|INVOICE)|BALANCE\b.*\bDR\b|NOT\s+RECEIVED|PAYMENT\s+DUE|AMOUNT\s+DUE\s*:?\s*[1-9])/i.test(all)) return 'credit';
  if (/\b(BANK\s+)?TRANSFER\b/i.test(all) && !/\bTRANSFER\s*$/i.test(all)) return 'transfer';
  return 'cash';
}

/** What the paper is for: fuel and food are not parts (their category is the manager's). */
function kindOf(all: string): string {
  if (/\b(PETROL|FUEL|DIESEL|SPECIAL\s*95|SUPER\s*98|E-?PLUS\s*91|ENOC|ADNOC|EPPCO|EMARAT)\b/i.test(all)) return 'fuel';
  if (/\b(RESTAURANT|CAFETERIA|CAFE|COFFEE|SHAWARMA|BURGER|PIZZA|FOOD|GROCERY|SUPERMARKET|HYPERMARKET)\b/i.test(all)) return 'food';
  return 'parts';
}

/** A TRN: 15 digits beginning with 100 (OCR may part them with spaces); the garage's own is the buyer's. */
function trnOf(rows: Row[], ctx: PaperContext): string | undefined {
  const own = (ctx.garageTrn ?? '').replace(/\D/g, '');
  const found: { trn: string; ours: boolean }[] = [];
  for (const r of rows) {
    const flat = r.text.replace(/(\d)[\s.](?=\d)/g, '$1');
    for (const m of flat.matchAll(/\b(1\d{14})\b/g)) found.push({ trn: m[1], ours: /\bOUR\s+TRN\b|\bTRN\s*NO\b/i.test(r.text) });
  }
  const theirs = found.filter((f) => f.trn !== own);
  return (theirs.find((f) => f.ours) ?? theirs[0])?.trn;
}

/** The paper read: what it says, and whether the app can take it as it is. */
export function readPaper(words: PaperWord[], pageHeight: number, ctx: PaperContext = {}, skew = 0): PaperRead {
  const rows = paperRows(words, skew);
  const all = rows.map((r) => r.text).join('\n');
  const why: string[] = [];
  const figs = figures(rows);
  let sum = proven(rows, figs);
  const slip = new Set((all.match(new RegExp(SLIP.source, 'gi')) ?? []).map((w) => w.toUpperCase())).size >= 2;
  let total: number | undefined;
  let vat: number | undefined;
  let subtotal: number | undefined;
  if (sum) {
    ({ total, vat, net: subtotal } = sum);
    why.push(`sum ${sum.net} + ${sum.vat} = ${sum.total}`);
  } else {
    // No VAT on it: a card slip's «AMOUNT», else the figure under a total's label.
    const amountRow = rows.find((r) => /\bAMOUNT\b|\bTOTAL\b/i.test(r.text) && r.words.some((w) => moneyOf(w.text) !== undefined));
    const v = amountRow ? Math.max(...amountRow.words.map((w) => moneyOf(w.text) ?? 0)) : 0;
    if (v > 0) {
      total = v;
      vat = 0;
      why.push(`amount ${v}${slip ? ' (slip)' : ''}`);
    }
  }
  const lines = linesOf(rows, sum?.row ?? rows.length);
  // The three figures for the whole paper did not read (its totals' boxes), or what was found is one line's own: its
  // lines, every one proven, added up.
  const provenLines = lines.filter((l) => l.vat !== undefined);
  const allProven = provenLines.length > 0 && provenLines.length === lines.length;
  const linesTotal = Math.round(provenLines.reduce((a, l) => a + (l.total ?? 0), 0) * 100) / 100;
  // The paper's total is never less than its lines (each line's last figure): three figures under them are a line's own.
  const linesTop = Math.round(lines.reduce((a, l) => a + (l.total ?? 0), 0) * 100) / 100;
  if (sum && lines.length > 1 && Math.max(linesTotal, linesTop) > sum.total + 0.05) {
    why.push(`${sum.total} is a line's`);
    sum = undefined;
    total = vat = subtotal = undefined;
  }
  if (!sum && allProven) {
    const t = provenLines.reduce((a, l) => a + (l.total ?? 0), 0);
    const v = provenLines.reduce((a, l) => a + (l.vat ?? 0), 0);
    total = Math.round(t * 100) / 100;
    vat = Math.round(v * 100) / 100;
    subtotal = Math.round((t - v) * 100) / 100;
    why.push(`lines ${provenLines.length}: ${subtotal} + ${vat} = ${total}`);
  }
  const linesSum = !sum && allProven;
  const items: ReceiptItem[] = lines.map(({ vat: _vat, ...l }) => l);
  const d = dateOf(rows);
  if (d.date) why.push(`date ${d.date}${d.labelled ? '' : ' (no label)'}`);
  const trn = trnOf(rows, ctx);
  const allTrns = [...all.replace(/(\d)[\s.](?=\d)/g, '$1').matchAll(/\b(1\d{14})\b/g)].map((m) => m[1]);
  const knownSeller = ctx.known?.length ? knownSellerOf(all, allTrns, ctx.known) : undefined;
  const vendor = knownSeller?.name ?? sellerOf(rows, ctx, pageHeight);
  if (knownSeller) why.push(`seller known: ${knownSeller.name}`);
  const email = all.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
  const phone = phonesInText(rows.filter((r) => r.y < pageHeight * 0.35).map((r) => r.text).join('\n')).find((p) => /^\+?9715|^05/.test(p.replace(/\s/g, ''))) ??
    phonesInText(rows.filter((r) => r.y < pageHeight * 0.35).map((r) => r.text).join('\n'))[0];
  const read: ReceiptRead = {
    isReceipt: total !== undefined || items.length > 0,
    vendor,
    vendorTrn: trn,
    vendorPhone: phone,
    vendorEmail: email,
    kind: kindOf(all),
    invoiceNo: numberOf(rows),
    dateText: d.text ?? '',
    date: d.date ?? '',
    dateSure: false,
    items,
    subtotal,
    vat,
    total,
    paymentMethod: wayOf(all),
    carText: all.match(/\bVEH(?:ICLE)?\.?\s*(?:NO)?\s*:?\s*([A-Z]{2,10}\s*[A-Z]?\s*\d{3,5})/i)?.[1] ?? '',
    confidence: sum || linesSum ? 0.9 : total ? 0.6 : 0.2,
  };
  // A seller the garage does not know yet, its name not read clean: the AI reads this one paper (the next ones of it are known).
  const sellerSure = !!knownSeller || cleanName(vendor);
  if (!sellerSure) why.push('seller not sure');
  // Sure of the sum and the seller (the date is the merge's: two readings, either may hold it).
  const sure = (!!sum || linesSum || (slip && !!total)) && sellerSure;
  return { read, sure, why, seller: knownSeller, slip, dateLabelled: d.labelled };
}

/**
 * Two readings of one paper made one (v0.51 — taught on the garage's papers: each way of making the photo ready reads
 * some papers and not others, and a single reading can misread a digit): the sum — one proven, or both proven alike
 * (two proven differently — not sure); the date — both alike: sure; one alone or two apart: the labelled one (the one
 * of the proven reading), not sure; a card slip seen by either — the card; the lines and the number of the proven
 * reading; the known seller of either.
 */
export function mergePapers(a: PaperRead | undefined, b: PaperRead | undefined): PaperRead | undefined {
  if (!a || !b) return a ?? b;
  const why = [...a.why.map((w) => `1: ${w}`), ...b.why.map((w) => `2: ${w}`)];
  const proved = (r: PaperRead) => r.sure && r.read.total !== undefined;
  const ta = proved(a) ? a.read.total : undefined;
  const tb = proved(b) ? b.read.total : undefined;
  const apart = ta !== undefined && tb !== undefined && (Math.abs(ta - tb) > 0.005 || Math.abs((a.read.vat ?? 0) - (b.read.vat ?? 0)) > 0.005);
  const main = tb !== undefined && ta === undefined ? b : a;
  const other = main === a ? b : a;
  const da = a.read.date || '';
  const db = b.read.date || '';
  const agreed = !!da && da === db;
  const date = agreed ? da : main.dateLabelled && main.read.date ? main.read.date : other.dateLabelled && other.read.date ? other.read.date : main.read.date || other.read.date || '';
  const way = a.slip || b.slip ? 'card' : [a.read.paymentMethod, b.read.paymentMethod].includes('credit') ? 'credit' : main.read.paymentMethod;
  const seller = a.seller ?? b.seller;
  if (apart) why.push('the two readings differ');
  const read: ReceiptRead = {
    ...main.read,
    vendor: seller?.name ?? main.read.vendor ?? other.read.vendor,
    vendorTrn: main.read.vendorTrn ?? other.read.vendorTrn,
    vendorPhone: main.read.vendorPhone ?? other.read.vendorPhone,
    vendorEmail: main.read.vendorEmail ?? other.read.vendorEmail,
    invoiceNo: main.read.invoiceNo && other.read.invoiceNo && main.read.invoiceNo !== other.read.invoiceNo ? (main.read.invoiceNo.length >= other.read.invoiceNo.length ? main.read.invoiceNo : other.read.invoiceNo) : (main.read.invoiceNo ?? other.read.invoiceNo),
    date,
    dateText: agreed ? a.read.dateText : main.read.dateText || other.read.dateText,
    dateSure: agreed,
    items: (main.read.items?.length ?? 0) >= (other.read.items?.length ?? 0) || proved(main) ? main.read.items : other.read.items,
    paymentMethod: way,
  };
  return { read, sure: !apart && (proved(a) || proved(b)) && !!date, why, seller, slip: a.slip || b.slip, dateLabelled: main.dateLabelled || other.dateLabelled };
}
