import { formatAed } from '../../domain/money';
import type { Lang } from '../../domain/types';

/*
 * The job for the owner to check (v0.29): one picture (JPEG) to send — what the car is and whose, every part with what
 * it is bought for, from whom and what it is sold for, the work, and what the job earns. Plain and quiet: a table and a
 * sum, black on white, the profit the one green (or red) thing; the garage's logo small at the top. Drawn on a canvas
 * in two passes — measured, then drawn at the height it came to.
 */

export interface CheckLine {
  name: string;
  qty: number;
  /** One for the customer (with VAT). */
  unitSale: number;
  /** All of them for the customer (with VAT). */
  sale: number;
  /** As bought or paid out, with VAT (`itemCostPaid`); undefined — not entered yet. */
  cost?: number;
  /** Bought from / done by. */
  supplier?: string;
  /** The customer's own part: nothing bought, nothing sold. */
  own?: boolean;
}

export interface CheckData {
  lang: Lang;
  logo?: string;
  garage: string;
  number: string;
  date: string;
  car: string;
  plate: string;
  customer: string;
  parts: CheckLine[];
  work: CheckLine[];
  /** The job's other expenses (towing, consumables…) — what they cost, nothing sold. */
  extra: CheckLine[];
  /** The discount given (positive), if any. */
  discount: number;
  revenue: number;
  /** Everything that went out for the job, with VAT, once (`jobProfit`). */
  spent: number;
  profit: number;
  labels: {
    parts: string;
    work: string;
    cost: string;
    sale: string;
    noSupplier: string;
    noCost: string;
    own: string;
    discount: string;
    toClient: string;
    expenses: string;
    spent: string;
    profit: string;
    footer: string;
  };
}

const W = 1080;
const P = 56;
const SALE_R = W - P;
const COST_R = W - P - 220;
const NAME_W = COST_R - 210 - P;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Arial, sans-serif';
const C = {
  ink: '#1c1c1e',
  dim: '#8e8e93',
  hair: '#e5e5ea',
  fill: '#f2f2f7',
  blue: '#0a64d6',
  green: '#1e8e3e',
  greenBg: '#e8f6ec',
  red: '#d70015',
  redBg: '#fdecee',
  orange: '#c45c00',
};

type Draw = (g: CanvasRenderingContext2D) => void;

const font = (px: number, weight = 400) => `${weight} ${px}px ${FONT}`;

/**
 * A supplier's long name (wider than its room in the name's column) shorter by 30 % — the user's call (v0.31) — and
 * never past the cost's column: whole words, then "…".
 */
function shortName(g: CanvasRenderingContext2D, text: string, room: number, max: number): string {
  const full = g.measureText(text).width;
  if (full <= room) return text;
  const limit = Math.min(max, full * 0.7);
  const words = text.split(/\s+/).filter(Boolean);
  const fits = (s: string) => g.measureText(`${s}…`).width <= limit;
  while (words.length > 1 && !fits(words.join(' '))) words.pop();
  let cut = words.join(' ').replace(/[\s,.;:·–—-]+$/, '');
  while (cut.length > 1 && !fits(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Words into lines no wider than `max` (a word too long for a line is cut where it must be). */
function wrap(g: CanvasRenderingContext2D, text: string, max: number, lines = 3): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width <= max) line = next;
    else {
      if (line) out.push(line);
      line = word;
      while (g.measureText(line).width > max && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && g.measureText(line.slice(0, k)).width > max) k--;
        out.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
  }
  if (line) out.push(line);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    let last = kept[lines - 1];
    while (last.length > 1 && g.measureText(`${last}…`).width > max) last = last.slice(0, -1);
    kept[lines - 1] = `${last}…`;
    return kept;
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

/** The picture (JPEG). */
export async function drawOwnerCheck(d: CheckData): Promise<Blob> {
  const m = document.createElement('canvas').getContext('2d')!;
  const money = (fils: number) => formatAed(fils, d.lang, false);
  const logo = d.logo ? await loadImage(d.logo) : undefined;
  const ops: Draw[] = [];
  let y = P;

  // The head: the garage's logo (or name) small, the job's number and day on the right.
  const headH = 64;
  {
    const top = y;
    if (logo) {
      const k = Math.min(headH / logo.height, 220 / logo.width);
      const lw = logo.width * k;
      const lh = logo.height * k;
      ops.push((g) => g.drawImage(logo, P, top + (headH - lh) / 2, lw, lh));
    } else {
      ops.push((g) => {
        g.font = font(28, 700);
        g.fillStyle = C.ink;
        g.textBaseline = 'middle';
        g.fillText(d.garage, P, top + headH / 2);
      });
    }
    ops.push((g) => {
      g.textAlign = 'right';
      g.textBaseline = 'alphabetic';
      g.fillStyle = C.ink;
      g.font = font(30, 700);
      g.fillText(d.number, SALE_R, top + 28);
      g.fillStyle = C.dim;
      g.font = font(24);
      g.fillText(d.date, SALE_R, top + 60);
      g.textAlign = 'left';
    });
    y += headH + 28;
    const at = y;
    ops.push((g) => {
      g.fillStyle = C.hair;
      g.fillRect(P, at, W - 2 * P, 2);
    });
    y += 34;
  }

  // The car, its plate, the customer.
  {
    m.font = font(50, 800);
    const carLines = wrap(m, d.car, W - 2 * P, 2);
    for (const line of carLines) {
      const at = y + 48;
      ops.push((g) => {
        g.font = font(50, 800);
        g.fillStyle = C.ink;
        g.fillText(line, P, at);
      });
      y += 60;
    }
    y += 10;
    m.font = font(28, 700);
    const pw = m.measureText(d.plate).width + 32;
    const top = y;
    ops.push((g) => {
      g.strokeStyle = C.ink;
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(P, top, pw, 48, 8);
      g.stroke();
      g.font = font(28, 700);
      g.fillStyle = C.ink;
      g.textBaseline = 'middle';
      g.fillText(d.plate, P + 16, top + 25);
      g.textBaseline = 'alphabetic';
      if (d.customer) {
        g.font = font(28);
        g.fillStyle = C.dim;
        let who = d.customer;
        while (who.length > 1 && g.measureText(who).width > W - 2 * P - pw - 24) who = who.slice(0, -1);
        g.fillText(who === d.customer ? who : `${who}…`, P + pw + 24, top + 34);
      }
    });
    y += 48 + 40;
  }

  /** A table: its title with the columns' names, then its lines. */
  const table = (title: string, lines: CheckLine[], kind: 'part' | 'work' | 'extra') => {
    if (!lines.length) return;
    const top = y;
    ops.push((g) => {
      g.font = font(34, 800);
      g.fillStyle = C.ink;
      g.fillText(title, P, top + 34);
      g.font = font(23, 600);
      g.fillStyle = C.dim;
      g.textAlign = 'right';
      g.fillText(d.labels.cost, COST_R, top + 34);
      g.fillText(d.labels.sale, SALE_R, top + 34);
      g.textAlign = 'left';
    });
    y += 56;
    for (const l of lines) {
      const rowTop = y;
      m.font = font(29, 700);
      const names = wrap(m, l.name, NAME_W, 3);
      const sub: { text: string; color: string }[] = [];
      if (l.qty !== 1 && !l.own) sub.push({ text: `${l.qty} × ${money(l.unitSale)}`, color: C.dim });
      if (l.own) sub.push({ text: d.labels.own, color: C.dim });
      else if (l.supplier) {
        m.font = font(24, 500);
        const before = sub.length ? m.measureText(`${sub[0].text} · `).width : 0;
        sub.push({ text: shortName(m, l.supplier, NAME_W - before, COST_R - 40 - P - before), color: C.blue });
      } else if (kind === 'part') sub.push({ text: d.labels.noSupplier, color: C.orange });
      const textH = names.length * 38 + (sub.length ? 34 : 0);
      const margin = !l.own && l.cost !== undefined ? l.sale - l.cost : undefined;
      const numsH = 38 + (margin !== undefined && kind === 'part' ? 32 : 0);
      const h = Math.max(textH, numsH) + 26;
      ops.push((g) => {
        names.forEach((n, i) => {
          g.font = font(29, 700);
          g.fillStyle = C.ink;
          g.fillText(n, P, rowTop + 32 + i * 38);
        });
        if (sub.length) {
          let x = P;
          const sy = rowTop + 32 + names.length * 38;
          g.font = font(24, 500);
          sub.forEach((s, i) => {
            if (i) {
              g.fillStyle = C.dim;
              g.fillText(' · ', x, sy);
              x += g.measureText(' · ').width;
            }
            g.fillStyle = s.color;
            g.fillText(s.text, x, sy);
            x += g.measureText(s.text).width;
          });
        }
        g.textAlign = 'right';
        // What it costs the garage: the sum, or a dash where none was entered (orange for a part — it is missing).
        if (l.own) {
          g.font = font(28, 500);
          g.fillStyle = C.dim;
          g.fillText('—', COST_R, rowTop + 32);
          g.fillText('—', SALE_R, rowTop + 32);
        } else {
          g.font = font(28, 500);
          g.fillStyle = l.cost === undefined ? (kind === 'part' ? C.orange : C.dim) : C.ink;
          g.fillText(l.cost === undefined ? (kind === 'part' ? d.labels.noCost : '—') : money(l.cost), COST_R, rowTop + 32);
          g.font = font(28, 700);
          g.fillStyle = kind === 'extra' ? C.dim : C.ink;
          g.fillText(kind === 'extra' ? '—' : money(l.sale), SALE_R, rowTop + 32);
          if (margin !== undefined && kind === 'part') {
            g.font = font(23, 600);
            g.fillStyle = margin < 0 ? C.red : C.green;
            g.fillText(`${margin < 0 ? '−' : '+'}${money(Math.abs(margin))}`, SALE_R, rowTop + 64);
          }
        }
        g.textAlign = 'left';
        g.fillStyle = C.hair;
        g.fillRect(P, rowTop + h - 1, W - 2 * P, 1.5);
      });
      y += h;
    }
    y += 34;
  };
  table(d.labels.parts, d.parts, 'part');
  table(d.labels.work, d.work, 'work');
  table(d.labels.expenses, d.extra, 'extra');

  // The sum: what the customer pays, what goes out, what stays — the profit large.
  {
    const rows: { label: string; fils: number; sign?: '−' }[] = [];
    if (d.discount > 0) rows.push({ label: d.labels.discount, fils: d.discount, sign: '−' });
    // What went out — one sum, with VAT (v0.31: not parts and expenses apart — they were the same money).
    rows.push({ label: d.labels.toClient, fils: d.revenue });
    rows.push({ label: d.labels.spent, fils: d.spent, sign: '−' });
    const top = y;
    const boxH = 30 + rows.length * 48 + 24 + 92 + 26;
    const good = d.profit >= 0;
    ops.push((g) => {
      g.fillStyle = C.fill;
      g.beginPath();
      g.roundRect(P, top, W - 2 * P, boxH, 28);
      g.fill();
      rows.forEach((r, i) => {
        const ry = top + 30 + i * 48 + 32;
        g.font = font(28, r.label === d.labels.toClient ? 700 : 500);
        g.fillStyle = r.label === d.labels.toClient ? C.ink : C.dim;
        g.textAlign = 'left';
        g.fillText(r.label, P + 32, ry);
        g.textAlign = 'right';
        g.font = font(28, r.label === d.labels.toClient ? 700 : 600);
        g.fillStyle = r.label === d.labels.toClient ? C.ink : '#3a3a3c';
        g.fillText(`${r.sign ?? ''}${money(r.fils)}`, SALE_R - 32, ry);
      });
      const py = top + 30 + rows.length * 48 + 24;
      g.fillStyle = C.hair;
      g.fillRect(P + 32, py - 12, W - 2 * P - 64, 2);
      g.fillStyle = good ? C.greenBg : C.redBg;
      g.beginPath();
      g.roundRect(P + 16, py, W - 2 * P - 32, 92, 20);
      g.fill();
      g.textAlign = 'left';
      g.font = font(34, 800);
      g.fillStyle = good ? C.green : C.red;
      g.fillText(d.labels.profit, P + 40, py + 58);
      // The margin beside it, small: how much of what the customer pays stays.
      if (d.revenue > 0) {
        const lw = g.measureText(d.labels.profit).width;
        g.font = font(26, 700);
        g.fillText(`${Math.round((d.profit / d.revenue) * 100)}%`, P + 40 + lw + 16, py + 57);
      }
      g.textAlign = 'right';
      g.font = font(46, 800);
      g.fillText(`${d.profit < 0 ? '−' : ''}${formatAed(Math.abs(d.profit), d.lang)}`, SALE_R - 40, py + 62);
      g.textAlign = 'left';
    });
    y += boxH + 26;
    const fy = y;
    ops.push((g) => {
      g.font = font(22, 500);
      g.fillStyle = C.dim;
      g.fillText(d.labels.footer, P, fy + 22);
    });
    y += 22 + P;
  }

  const c = document.createElement('canvas');
  c.width = W;
  c.height = Math.ceil(y);
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, c.height);
  g.textBaseline = 'alphabetic';
  for (const op of ops) {
    g.save();
    op(g);
    g.restore();
  }
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/jpeg', 0.92));
}
