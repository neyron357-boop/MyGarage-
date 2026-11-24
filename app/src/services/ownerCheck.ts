import { db } from '../db/db';
import { formatDate, nowIso } from '../domain/dates';
import { liveLines } from '../domain/flow';
import { itemCostPaid } from '../domain/items';
import { formatAed } from '../domain/money';
import { ownerCheckOf, type OwnerCheck } from '../domain/ownerCheck';
import { formatPhone } from '../domain/phone';
import { formatPlate } from '../domain/plates';
import { jobProfit, partsPaid } from '../domain/profit';
import type { Lang } from '../domain/types';
import { waAutoOf } from '../domain/waAuto';
import { chatIdOf } from '../domain/whatsapp';
import { tFor } from '../i18n';
import { coverOf } from './cover';
import type { PdfFile } from './documents';
import { cardUrl } from './media';
import { loadOrderBundle, type OrderBundle } from './orders';
import { waAvatarSrc, waCan } from './whatsapp';

/*
 * The job for the owner to check (v0.82, domain/ownerCheck.ts — what it says; pdf/ownerCheck.tsx — how): its PDF and the
 * short message that goes with it, in the owner's language (the boss's of «WhatsApp → Автоматизация»). The sellers'
 * pictures are their WhatsApp pictures (through the garage's server) when they have one.
 */

/** A picture as the PDF takes it (a data address); none — when it cannot be read. */
async function dataUrl(src: string | undefined): Promise<string | undefined> {
  if (!src) return undefined;
  try {
    const res = await fetch(src, { cache: 'force-cache' });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!/^image\//.test(blob.type) || blob.size < 100) return undefined;
    return await new Promise<string | undefined>((ok) => {
      const r = new FileReader();
      r.onload = () => ok(typeof r.result === 'string' ? r.result : undefined);
      r.onerror = () => ok(undefined);
      r.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export interface OwnerCheckFile {
  pdf: PdfFile;
  check: OwnerCheck;
  /** The short message to the owner (the PDF's caption). */
  text: string;
  lang: Lang;
}

/** The owner's language: the boss's (its reports), else the app's. */
export function ownerLang(b: Pick<OrderBundle, 'settings'>, appLang: Lang): Lang {
  return waAutoOf(b.settings.waAuto).boss.lang ?? appLang;
}

export async function ownerCheckFile(orderId: string, appLang: Lang): Promise<OwnerCheckFile> {
  const b = await loadOrderBundle(orderId);
  if (!b) throw new Error('not found');
  const lang = ownerLang(b, appLang);
  const t = tFor(lang);
  const expenses = await db.expenses.where('orderId').equals(orderId).toArray();
  const cats = await db.expenseCategories.toArray();
  const partsCategoryId = cats.find((c) => c.code === 'parts')?.id;
  const live = liveLines(b.items);
  const p = jobProfit({ order: b.order, items: b.items, invoices: b.invoices, expenses, partsCategoryId });
  const paidOutside = new Set(live.map((i) => (i.kind !== 'part' ? i.outsource?.expenseId : undefined)).filter(Boolean));
  const beyond = partsPaid(expenses, partsCategoryId, paidOutside) - live.filter((i) => i.kind === 'part' && !i.customerSupplied).reduce((s, i) => s + itemCostPaid(i), 0);
  const check = ownerCheckOf({
    items: b.items,
    expenses,
    partsCategoryId,
    categoryName: (id) => {
      const c = cats.find((x) => x.id === id);
      return c ? (lang === 'ru' ? c.nameRu : c.nameEn) : '';
    },
    profit: p.profit,
    partsBeyond: Math.max(0, beyond),
    docLang: b.order.docLanguage,
    beyondName: t('ownerCheck.partsBeyond'),
    vatRateBp: b.settings.vatRateBp,
  });
  // The sellers: name, number — and their WhatsApp picture when the garage's WhatsApp is there.
  const ids = check.sellers.map((s) => s.supplierId);
  const suppliers = (await db.suppliers.bulkGet(ids)).filter((s) => !!s);
  const sellers = new Map(
    await Promise.all(
      suppliers.map(async (s) => {
        const chat = s!.phone ? chatIdOf(s!.phone) : '';
        const picture = chat && waCan() ? await dataUrl(waAvatarSrc(chat)) : undefined;
        return [s!.id, { name: s!.name, phone: s!.phone ? formatPhone(s!.phone) : undefined, ...(picture ? { picture } : {}) }] as const;
      }),
    ),
  );
  const cover = await coverOf(b.vehicle.id);
  const photo = cover ? await dataUrl(await cardUrl(cover).catch(() => undefined)) : undefined;
  const c = b.customer;
  const car = [b.vehicle.make, b.vehicle.model, b.vehicle.year].filter(Boolean).join(' ') || formatPlate(b.vehicle.plate, 'en');
  const plate = formatPlate(b.vehicle.plate, 'en');
  const customer = [(c.type === 'company' && c.companyName ? c.companyName : c.name) || '', c.phone ? formatPhone(c.phone) : ''].filter(Boolean).join(' · ');
  const w = (k: string, o?: Record<string, unknown>) => t(`ownerCheck.pdf.${k}`, o);
  const { renderOwnerCheck } = await import('../pdf/ownerCheck');
  const blob = await renderOwnerCheck({
    garage: b.settings.name,
    logo: b.settings.logoDataUrl,
    photo,
    number: `№${b.order.number}`,
    date: formatDate(nowIso()),
    car,
    plate,
    customer,
    check,
    sellers,
    words: {
      title: w('title'),
      parts: w('parts'),
      work: w('work'),
      extra: w('extra'),
      item: w('item'),
      qty: w('qty'),
      buyNet: w('buyNet'),
      buyVat: w('buyVat'),
      saleNet: w('saleNet'),
      saleVat: w('saleVat'),
      saleTotal: w('saleTotal'),
      margin: w('margin'),
      noCost: w('noCost'),
      noPrice: w('noPrice'),
      own: w('own'),
      outside: w('outside'),
      noSupplier: w('noSupplier'),
      off: w('off'),
      discount: w('discount'),
      totals: w('totals'),
      net: w('net'),
      vat: w('vat'),
      gross: w('gross'),
      toClient: w('toClient'),
      spent: w('spent'),
      profit: w('profit'),
      profitGross: w('profitGross'),
      profitNet: w('profitNet'),
      taxes: w('taxes'),
      vatOut: w('vatOut'),
      vatIn: w('vatIn'),
      vatDue: w('vatDue'),
      warnUnpriced: w('warnUnpriced'),
      warnNoCost: w('warnNoCost'),
      sellers: w('sellers'),
      sellerTotal: w('sellerTotal'),
      noSellers: w('noSellers'),
      customer: w('customer'),
    },
  });
  const name = [`№${b.order.number}`, b.vehicle.make, b.vehicle.model, `${b.vehicle.plate.code}${b.vehicle.plate.number}`].filter(Boolean).join(' ');
  return { pdf: { blob, filename: `${name} - ${w('file')}.pdf` }, check, text: ownerText(check, { number: b.order.number, car, plate }, lang), lang };
}

/**
 * The short message with it (v0.82: «чаще это с просьбой спросить владельца, сколько ставить за оплату труда»): the car,
 * the customer's total and what the parts cost, the profit — and, when the job has no labour charge priced, the question.
 */
export function ownerText(c: OwnerCheck, job: { number: number; car: string; plate: string }, lang: Lang): string {
  const t = tFor(lang);
  const money = (f: number) => formatAed(f, lang);
  return [
    `*${job.car}* · ${job.plate} · №${job.number}`,
    t('ownerCheck.msg.client', { sum: money(c.sale.gross) }),
    c.buy.gross ? t('ownerCheck.msg.spent', { sum: money(c.buy.gross) }) : '',
    c.buy.gross ? t('ownerCheck.msg.profit', { sum: money(c.profit.gross) }) : '',
    c.askLabour ? `\n${t('ownerCheck.msg.labour')}` : `\n${t('ownerCheck.msg.check')}`,
  ]
    .filter(Boolean)
    .join('\n');
}
