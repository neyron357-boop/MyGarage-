import { formatDate } from './dates';
import { formatAed } from './money';
import { formatPlate } from './plates';
import type { Lang, Plate } from './types';

/*
 * What the garage's WhatsApp says by itself, and how (v0.79, the user: «автоотчёт в рабочую группу при визите каждого
 * авто — фото и список позиций без цен»; «в группу корпоративного клиента — по одной кнопке, без цен»; «в WhatsApp
 * босса — автоматически: инвойс, оплата, расходы, смета»; «CAR WASH — в группу мойки фото авто с надписью»;
 * «заявки поставщикам — выбрать и отправить»; «всё — с самостоятельными настройками»). Here — the settings, their
 * defaults, and the words of each message; nothing here sends (services/waAuto.ts, services/waAsk.ts).
 */

/** A chat a report goes to: its WhatsApp id (a group's or a person's), and its name as it was picked. */
export interface WaTarget {
  chat: string;
  name: string;
}

export interface WaAuto {
  /** The garage's work group: the car's photo and what is to be done — never a price. */
  work: {
    to?: WaTarget;
    on: boolean;
    lang: Lang;
    /** When it goes by itself: the car in (its photo taken), the customer agreed (the lines to do), the job ready. */
    checkin: boolean;
    agreed: boolean;
    done: boolean;
    complaint: boolean;
    lines: boolean;
    mechanics: boolean;
  };
  /** A company's own group (the group is the customer's: `Customer.waGroup`): a report of the visit, one tap — no prices. */
  client: {
    on: boolean;
    lang: Lang;
    driver: boolean;
    mileage: boolean;
    lines: boolean;
    complaint: boolean;
    /** How many photos of the car go with it (its main one first). */
    photos: number;
    /** It goes by itself when the job is ready too (not only by the button). */
    done: boolean;
  };
  /** The boss: what happens to the money, as it happens. */
  boss: {
    to?: WaTarget;
    on: boolean;
    lang: Lang;
    estimate: boolean;
    invoice: boolean;
    payment: boolean;
    /** Money in that is not a job's payment: a debt paid, a sale, other income. */
    income: boolean;
    expense: boolean;
    /** The invoice's and the estimate's PDF with it. */
    pdf: boolean;
    /** A receipt's photo with an expense. */
    photo: boolean;
  };
  /** The wash: a line of the job named so — the car's photo with a word. */
  wash: {
    to?: WaTarget;
    on: boolean;
    /** What a line's name says for it to be a wash (whole words; «WASHER» is a part, not a wash). */
    words: string[];
    caption: string;
    plate: boolean;
  };
  /** Requests to suppliers and their answers. */
  ask: {
    /** A pause between one supplier and the next, seconds (a person goes from one chat to the next). */
    gapSec: number;
    /** No more suppliers than this in one request. */
    max: number;
    /** Read the suppliers' answers in WhatsApp and put their prices on the job's lines. */
    read: boolean;
    /** What an answer does: variants on the line · and its cost · and the customer's price by the markup. */
    prices: 'offers' | 'cost' | 'price';
    /** A price said without «+VAT» or «incl.»: without VAT (as most sellers here say) or with it. */
    vat: 'net' | 'gross';
    /** Which variant is put on the line by itself: the original, or the cheapest. */
    prefer: 'oem' | 'cheap';
    /** The settings' version (v0.86: an answer's prices are the line's cost by default — set once). */
    v?: number;
  };
}

export const WASH_WORDS = ['CAR WASH', 'WASH', 'WASHING', 'МОЙКА'];

/**
 * v0.86 (the owner: «если поставщик дал цены… в этом заказе заполнять цены закупок»): an answer's prices are the line's
 * cost by default — settings kept before that said only variants: once put to the cost.
 */
export const ASK_V = 2;

export const WA_AUTO: WaAuto = {
  work: { on: true, lang: 'en', checkin: false, agreed: true, done: false, complaint: true, lines: true, mechanics: true },
  client: { on: true, lang: 'en', driver: true, mileage: true, lines: true, complaint: false, photos: 1, done: false },
  boss: { on: true, lang: 'en', estimate: true, invoice: true, payment: true, income: true, expense: true, pdf: true, photo: true },
  wash: { on: true, words: WASH_WORDS, caption: 'CAR WASH', plate: false },
  ask: { gapSec: 8, max: 15, read: true, prices: 'cost', vat: 'net', prefer: 'oem', v: ASK_V },
};

type Deep<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : Partial<T[K]>) : T[K] };

/** The settings as kept (a part, or none) with the defaults under them. */
export function waAutoOf(kept?: Deep<WaAuto> | null): WaAuto {
  const k = kept ?? {};
  const out = {
    work: { ...WA_AUTO.work, ...k.work },
    client: { ...WA_AUTO.client, ...k.client },
    boss: { ...WA_AUTO.boss, ...k.boss },
    wash: { ...WA_AUTO.wash, ...k.wash },
    ask: { ...WA_AUTO.ask, ...k.ask },
  } as WaAuto;
  out.wash.words = (out.wash.words ?? []).map((w) => w.trim()).filter(Boolean);
  if (!out.wash.words.length) out.wash.words = WASH_WORDS;
  out.client.photos = Math.min(4, Math.max(0, Math.round(out.client.photos)));
  out.ask.gapSec = Math.min(60, Math.max(3, Math.round(out.ask.gapSec)));
  out.ask.max = Math.min(30, Math.max(1, Math.round(out.ask.max)));
  if ((k.ask?.v ?? 0) < ASK_V && out.ask.prices === 'offers') out.ask.prices = 'cost';
  out.ask.v = ASK_V;
  return out;
}

/* ---------- The wash ---------- */

const words = (s: string) => s.toLocaleUpperCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Is this line a wash — its name says one of the words as whole words («WINDSHIELD WASHER» is not). */
export function isWash(name: string, list: string[] = WASH_WORDS): boolean {
  const n = ` ${words(name)} `;
  return list.some((w) => {
    const x = words(w);
    return !!x && n.includes(` ${x} `);
  });
}

/* ---------- The words of the reports ---------- */

export interface CarFace {
  make?: string;
  model?: string;
  year?: number | string;
  plate?: Plate;
}
const carLine = (c: CarFace, lang: Lang) => {
  const name = [c.make, c.model, c.year].filter(Boolean).join(' ').trim();
  const plate = c.plate ? formatPlate(c.plate, lang) : '';
  return [name ? `*${name.replace(/\*/g, '')}*` : '', plate].filter(Boolean).join(' · ');
};

const W = {
  en: { job: 'Job', arrived: 'Car in', agreed: 'Agreed — to do', added: 'Added', ready: 'Ready', complaint: 'Complaint', todo: 'To do', mechanics: 'Mechanics', date: 'Date', driver: 'Driver', mileage: 'Mileage', work: 'Work', km: 'km', customer: 'Customer', estimate: 'Estimate', invoice: 'Invoice', payment: 'Payment received', income: 'Money in', expense: 'Expense', total: 'Total', due: 'Still due', paid: 'Paid in full', debt: 'Debt payment', method: { cash: 'Cash', card: 'Card', transfer: 'Transfer', outside: 'To the owner', credit: 'On credit' }, vatIncl: 'incl. VAT', for: 'For', receipt: 'Receipt' },
  ru: { job: 'Заказ', arrived: 'Машина принята', agreed: 'Согласовано — к работе', added: 'Добавлено', ready: 'Готово', complaint: 'Жалоба', todo: 'Сделать', mechanics: 'Механики', date: 'Дата', driver: 'Водитель', mileage: 'Пробег', work: 'Работы', km: 'км', customer: 'Клиент', estimate: 'Смета', invoice: 'Инвойс', payment: 'Оплата получена', income: 'Приход', expense: 'Расход', total: 'Итого', due: 'Осталось оплатить', paid: 'Оплачено полностью', debt: 'Оплата долга', method: { cash: 'Наличные', card: 'Карта', transfer: 'Перевод', outside: 'Владельцу', credit: 'В кредит' }, vatIncl: 'с VAT', for: 'За', receipt: 'Чек' },
} as const;

export type WorkTrigger = 'checkin' | 'agreed' | 'added' | 'done' | 'manual';

export interface LineFace {
  title: string;
  qty?: number;
}
const listOf = (lines: LineFace[]) => lines.map((l, i) => `${i + 1}. ${l.title}${l.qty && l.qty > 1 ? ` × ${l.qty}` : ''}`);

/** To the work group: the car, the job's number, what it came with, what to do, who does it — never a price. */
export function workText(
  x: { car: CarFace; number: number; complaint?: string; lines: LineFace[]; mechanics: string[]; trigger: WorkTrigger },
  lang: Lang,
  opts: Pick<WaAuto['work'], 'complaint' | 'lines' | 'mechanics'>,
): string {
  const w = W[lang];
  const head = { checkin: w.arrived, agreed: w.agreed, added: w.added, done: w.ready, manual: '' }[x.trigger];
  const out = [carLine(x.car, lang), [`${w.job} #${x.number}`, head].filter(Boolean).join(' · ')];
  if (opts.complaint && x.complaint?.trim()) out.push(`${w.complaint}: ${x.complaint.trim()}`);
  if (opts.lines && x.lines.length) out.push('', `${x.trigger === 'added' ? w.added : w.todo}:`, ...listOf(x.lines));
  if (opts.mechanics && x.mechanics.length) out.push('', `${w.mechanics}: ${x.mechanics.join(', ')}`);
  return out.filter((l, i) => l || i > 0).join('\n').trim();
}

/** To a company's group: the car, the day, who brought it, its mileage, what was done — no prices. */
export function clientText(
  x: { car: CarFace; day: string; driver?: string; mileageKm?: number; complaint?: string; lines: LineFace[] },
  lang: Lang,
  opts: Pick<WaAuto['client'], 'driver' | 'mileage' | 'lines' | 'complaint'>,
): string {
  const w = W[lang];
  const out = [carLine(x.car, lang), `${w.date}: ${formatDate(x.day)}`];
  if (opts.driver && x.driver?.trim()) out.push(`${w.driver}: ${x.driver.trim()}`);
  if (opts.mileage && x.mileageKm) out.push(`${w.mileage}: ${x.mileageKm.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')} ${w.km}`);
  if (opts.complaint && x.complaint?.trim()) out.push(`${w.complaint}: ${x.complaint.trim()}`);
  if (opts.lines && x.lines.length) out.push('', `${w.work}:`, ...x.lines.map((l) => `• ${l.title}${l.qty && l.qty > 1 ? ` × ${l.qty}` : ''}`));
  return out.join('\n');
}

/** The wash: the word asked for (and the plate, if asked). */
export function washText(x: { car: CarFace }, lang: Lang, opts: Pick<WaAuto['wash'], 'caption' | 'plate'>): string {
  const plate = opts.plate && x.car.plate ? formatPlate(x.car.plate, lang) : '';
  return [opts.caption.trim() || 'CAR WASH', plate].filter(Boolean).join('\n');
}

/* ---------- To the boss ---------- */

export type BossEvent =
  | { kind: 'estimate'; number: number; car: CarFace; customer: string; lines: { title: string; gross: number }[]; total: number; version: number }
  | { kind: 'invoice'; number: string; car: CarFace; customer: string; total: number; jobNumber: number }
  | { kind: 'payment'; amount: number; method: string; car?: CarFace; customer: string; jobNumber?: number; due?: number }
  | { kind: 'income'; amount: number; method: string; what: string; customer?: string; debt: boolean }
  | { kind: 'expense'; amount: number; method: string; category: string; vendor?: string; note?: string; car?: CarFace; jobNumber?: number; parts?: { method: string; amount: number }[]; customer?: string; lines?: { name: string; qty?: number }[] };

const EMOJI: Record<BossEvent['kind'], string> = { estimate: '📋', invoice: '🧾', payment: '💵', income: '💵', expense: '💸' };

/** A line to the boss for what just happened — amounts with VAT, as the garage's money book has them. */
export function bossText(e: BossEvent, lang: Lang): string {
  const w = W[lang];
  const money = (f: number) => formatAed(f, lang);
  const way = (m: string) => (w.method as Record<string, string>)[m] ?? m;
  const job = (n?: number, car?: CarFace) => [n ? `${w.job} #${n}` : '', car ? carLine(car, lang) : ''].filter(Boolean).join(' · ');
  switch (e.kind) {
    case 'estimate':
      return [
        `${EMOJI.estimate} *${w.estimate}${e.version > 1 ? ` v${e.version}` : ''}* · ${money(e.total)}`,
        job(e.number, e.car),
        `${w.customer}: ${e.customer}`,
        '',
        ...e.lines.map((l, i) => `${i + 1}. ${l.title} — ${money(l.gross)}`),
        '',
        `${w.total}: ${money(e.total)} (${w.vatIncl})`,
      ].join('\n');
    case 'invoice':
      return [`${EMOJI.invoice} *${w.invoice} ${e.number}* · ${money(e.total)}`, job(e.jobNumber, e.car), `${w.customer}: ${e.customer}`].join('\n');
    case 'payment':
      return [`${EMOJI.payment} *${w.payment}* · ${money(e.amount)} · ${way(e.method)}`, job(e.jobNumber, e.car), `${w.customer}: ${e.customer}`, e.due === undefined ? '' : e.due > 0 ? `${w.due}: ${money(e.due)}` : w.paid].filter(Boolean).join('\n');
    case 'income':
      return [`${EMOJI.income} *${e.debt ? w.debt : w.income}* · ${money(e.amount)} · ${way(e.method)}`, e.customer ? `${w.customer}: ${e.customer}` : '', e.debt ? '' : e.what].filter(Boolean).join('\n');
    case 'expense':
      return [
        `${EMOJI.expense} *${w.expense}* · ${money(e.amount)} · ${e.parts?.length ? e.parts.map((p) => `${way(p.method)} ${money(p.amount)}`).join(' + ') : way(e.method)}`,
        [e.category, e.vendor].filter(Boolean).join(' · '),
        e.note?.trim() ? e.note.trim() : '',
        e.jobNumber || e.car ? `${w.for}: ${job(e.jobNumber, e.car)}` : '',
        e.customer ? `${w.customer}: ${e.customer}` : '',
        // The paper's positions (v0.81, sent by hand once its job is picked): one a line.
        ...(e.lines?.length ? ['', ...e.lines.map((l, i) => `${i + 1}. ${l.name}${l.qty && l.qty !== 1 ? ` × ${l.qty}` : ''}`)] : []),
      ]
        .filter(Boolean)
        .join('\n');
  }
}
