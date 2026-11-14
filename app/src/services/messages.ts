import { db, uid } from '../db/db';
import { formatDate, nowIso } from '../domain/dates';
import { formatAed } from '../domain/money';
import { normalizePhone, phoneDigits } from '../domain/phone';
import { formatPlate } from '../domain/plates';
import { itemAmounts, itemTitle, lineName } from '../domain/items';
import type { Channel, Customer, EstimateVersion, Lang, Order, OrderItem, PartOffer, Vehicle } from '../domain/types';
import { sumAmounts } from '../domain/vat';
import { tFor } from '../i18n';

export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(text)}`;
}

export function telegramUrl(text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(' ')}&text=${encodeURIComponent(text)}`;
}

/** Open a Telegram chat with the customer: by @username if known, otherwise by phone number. */
export function telegramChatUrl(phone: string, telegram?: string): string {
  const handle = telegram?.trim();
  if (handle && /^@?[A-Za-z][A-Za-z0-9_]{3,}$/.test(handle)) return `https://t.me/${handle.replace(/^@/, '')}`;
  const tgPhone = handle && handle.replace(/\D/g, '').length >= 7 ? normalizePhone(handle) : null;
  return `https://t.me/+${phoneDigits(tgPhone ?? phone)}`;
}

export interface MsgContext {
  customer: Customer;
  vehicle: Vehicle;
  order: Order;
  garageName: string;
  /** Parts costing this much or more are ordered after an advance (the estimate says so). */
  partsAdvanceFrom?: number;
}

/**
 * A customer without a name ('' is allowed): "Здравствуйте, !" becomes "Здравствуйте!", ", ваш Camry…"
 * becomes "Ваш Camry…".
 */
export function tidy(text: string): string {
  return text
    .replace(/,?[ \t]+!/g, '!')
    .replace(/,!/g, '!')
    .replace(/(^|\n),\s*/g, '$1')
    .replace(/(^|\n)(\p{Ll})/gu, (_, a: string, c: string) => a + c.toUpperCase());
}

function base(ctx: MsgContext, lang: Lang) {
  return {
    name: ctx.customer.name.split(' ')[0],
    car: `${ctx.vehicle.make} ${ctx.vehicle.model}`.trim(),
    plate: formatPlate(ctx.vehicle.plate, lang),
    garage: ctx.garageName,
    number: ctx.order.number,
  };
}

export type SimpleTemplate =
  | 'booked'
  | 'carReceived'
  | 'carReady'
  | 'paymentReminder'
  | 'storageReminder'
  | 'prepayment'
  | 'reviewRequest'
  | 'invoice'
  | 'documents'
  | 'followUp'
  | 'serviceDue';

export function simpleMessage(tpl: SimpleTemplate, ctx: MsgContext, lang: Lang, vars: Record<string, string | number> = {}): string {
  const t = tFor(lang);
  return tidy(t(`msg.${tpl}`, { ...base(ctx, lang), ...vars }));
}

/** Itemized estimate / supplement text; the customer answers in the chat. */
/**
 * The job's lines as plain text, copied with one tap to paste anywhere (a supplier, the customer, a note):
 * the car and its plate, the numbered lines with their amounts (VAT included, as on screen), the discount
 * and the total — in the job's document language, as the lines themselves.
 */
export function linesText(vehicle: Pick<Vehicle, 'make' | 'model' | 'year' | 'plate'>, items: OrderItem[], lang: Lang): string {
  const t = tFor(lang);
  const money = (f: number) => formatAed(f, lang);
  const car = [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ');
  const out = [[car, formatPlate(vehicle.plate, lang)].filter(Boolean).join(' · '), ''];
  items
    .filter((i) => i.kind !== 'discount')
    .forEach((i, n) => {
      const each = i.kind === 'part' && i.qty !== 1 ? ` (${i.qty} × ${money(itemAmounts({ ...i, qty: 1 }).gross)})` : '';
      const gross = itemAmounts(i).gross;
      const price = i.customerSupplied ? t('msg.customerPart') : gross ? money(gross) : '?';
      out.push(`${n + 1}. ${itemTitle(i, lang)}${each} — ${price}`);
    });
  const off = items.filter((i) => i.kind === 'discount');
  if (off.length) out.push('', `${itemTitle(off[0], lang)}: ${money(off.reduce((a, i) => a + itemAmounts(i).gross, 0))}`);
  const sum = sumAmounts(items.map(itemAmounts));
  out.push('', `${t('job.total')}: ${money(sum.gross)}` + (sum.vat ? ` (VAT ${money(sum.vat)})` : ''));
  return out.join('\n');
}

/**
 * The job for the garage's group chat (with the car's photo): the car, the customer by name only (no
 * phone — the group is not the customer's), the lines with their amounts and the total.
 */
export function jobShareText(
  vehicle: Pick<Vehicle, 'make' | 'model' | 'year' | 'plate'>,
  customer: Pick<Customer, 'name' | 'type' | 'companyName'>,
  items: OrderItem[],
  lang: Lang,
): string {
  const name = ((customer.type === 'company' && customer.companyName) || customer.name || '').trim();
  const [car, , ...rest] = linesText(vehicle, items, lang).split('\n');
  return [car, ...(name ? [`${tFor(lang)('job.client')}: ${name}`] : []), '', ...rest].join('\n');
}

/**
 * A request to a parts seller, in English (the trade's language here, whatever the customer speaks): the
 * car with its VIN, the part with its number and how many — to paste to several sellers with the photos.
 */
export function partRequestText(vehicle: Pick<Vehicle, 'make' | 'model' | 'year' | 'vin' | 'engine'>, item: Pick<OrderItem, 'titleEn' | 'titleRu' | 'partNumber' | 'qty'>): string {
  const car = [vehicle.make, vehicle.model, vehicle.year, vehicle.engine].filter(Boolean).join(' ');
  const out = [car];
  if (vehicle.vin) out.push(`VIN: ${vehicle.vin}`);
  out.push('', `Part: ${item.titleEn || item.titleRu || ''}${item.qty > 1 ? ` × ${item.qty}` : ''}`);
  if (item.partNumber) out.push(`Part No: ${item.partNumber}`);
  out.push('', 'Price and availability, please: original / aftermarket / used?');
  return out.join('\n');
}

/** When an offer is here, in words: today, tomorrow, in 3 days. */
export function offerWhen(days: number | undefined, lang: Lang): string {
  if (days === undefined) return '';
  const t = tFor(lang);
  return days <= 0 ? t('offer.today') : days === 1 ? t('offer.tomorrow') : t('offer.inDays', { n: days });
}

/** A part's offers for the customer to choose from (original, aftermarket, used): the price to them and how soon. */
export function optionsText(ctx: MsgContext, lang: Lang, title: string, options: { kind: PartOffer['kind']; gross: number; days?: number }[]): string {
  const t = tFor(lang);
  const out = [tidy(t('msg.optionsHeader', { ...base(ctx, lang), part: title })), ''];
  options.forEach((o, n) => {
    const when = offerWhen(o.days, lang);
    out.push(`${n + 1}) ${t(`offer.${o.kind}`)} — ${formatAed(o.gross, lang)}${when ? `, ${when}` : ''}`);
  });
  out.push('', t('msg.optionsAsk'));
  return out.join('\n');
}

/**
 * What was done, for the customer (or a company's group chat) when the car leaves: the car, the lines
 * done, the checks before handover, the mileage and the warranty — in the customer's language.
 */
export function reportText(
  ctx: MsgContext,
  lang: Lang,
  r: { done: string[]; checks: string[]; mileageKm?: number; warrantyMonths?: number; warrantyKm?: number },
): string {
  const t = tFor(lang);
  const b = base(ctx, lang);
  const car = [ctx.vehicle.make, ctx.vehicle.model, ctx.vehicle.year].filter(Boolean).join(' ');
  const out = [`${car} · ${b.plate}`, t('msg.reportHeader', b), ''];
  r.done.forEach((d) => out.push(`✓ ${d}`));
  if (r.checks.length) out.push('', `${t('msg.reportChecked')}: ${r.checks.join(', ')}`);
  if (r.mileageKm) out.push(`${t('msg.reportMileage')}: ${r.mileageKm.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')} ${t('unit.km')}`);
  if (r.warrantyMonths || r.warrantyKm) {
    const plural = new Intl.PluralRules(lang === 'ru' ? 'ru' : 'en').select(r.warrantyMonths ?? 0);
    const w = [r.warrantyMonths ? t(`msg.months_${plural}`, { count: r.warrantyMonths }) : '', r.warrantyKm ? `${r.warrantyKm.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')} ${t('unit.km')}` : ''].filter(Boolean).join(' / ');
    out.push(`${t('msg.reportWarranty')}: ${w}`);
  }
  out.push('', t('msg.reportThanks', b));
  return out.join('\n');
}

/**
 * The job for a mechanic, in English (the mechanics read English): the car, what the customer said,
 * the agreed work to do (with who does it), and the manager's notes.
 */
export function mechanicText(
  vehicle: Pick<Vehicle, 'make' | 'model' | 'year' | 'plate'>,
  order: Pick<Order, 'number' | 'complaint'>,
  lines: { title: string; who?: string }[],
  notes: string[],
): string {
  const car = [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ');
  const out = [`#${order.number} ${car} · ${formatPlate(vehicle.plate, 'en')}`];
  if (order.complaint) out.push(`Complaint: ${order.complaint}`);
  if (lines.length) {
    out.push('', 'To do:');
    lines.forEach((l, n) => out.push(`${n + 1}. ${l.title}${l.who ? ` — ${l.who}` : ''}`));
  }
  if (notes.length) {
    out.push('', 'Notes:');
    notes.forEach((x) => out.push(`- ${x}`));
  }
  return out.join('\n');
}

export function versionMessage(ctx: MsgContext, v: EstimateVersion): string {
  const lang = v.language;
  const t = tFor(lang);
  const money = (f: number) => formatAed(f, lang);
  const urg = { red: '🔴', yellow: '🟡', green: '🟢' } as const;
  const lines: string[] = [];
  const b = base(ctx, lang);
  if (v.number === 1) lines.push(tidy(t('msg.estimateHeader', { ...b, version: v.number })));
  else lines.push(tidy(t('msg.supplementHeader', { ...b, version: v.number, reason: v.reason ?? '' })));
  for (const block of ['A', 'B', 'C'] as const) {
    const list = v.items.filter((i) => i.block === block && i.kind !== 'discount');
    if (!list.length) continue;
    lines.push('', t(`msg.block${block}`));
    for (const i of list) {
      const price =
        i.minGross !== undefined && i.maxGross !== undefined && i.minGross !== i.maxGross
          ? `${money(i.minGross)} – ${money(i.maxGross)}`
          : money(i.gross);
      let line = `• ${lineName(i.title, i.kind)} — ${price}`;
      if (i.urgency) line = `${urg[i.urgency]} ${line}`;
      if (i.customerSupplied) line += ` (${t('msg.customerPart')})`;
      lines.push(line);
      if (i.ifNotDone) lines.push(`   ${t('msg.ifNotDone')}: ${i.ifNotDone}`);
    }
  }
  lines.push('');
  // The discount once, right before the total — not among the lines.
  const off = v.items.filter((i) => i.kind === 'discount');
  if (off.length) lines.push(`${off[0].title}: ${money(off.reduce((a, i) => a + i.gross, 0))}`);
  if (v.maxGross !== v.fixedGross) lines.push(t('msg.totalRange', { fixed: money(v.fixedGross), max: money(v.maxGross) }));
  else lines.push(t('msg.total', { fixed: money(v.fixedGross) }));
  if (v.recommendedGross > 0) lines.push(t('msg.recommendedTotal', { sum: money(v.recommendedGross) }));
  lines.push(t('msg.validUntil', { date: formatDate(v.validUntil) }));
  if (v.items.some((i) => i.block === 'B')) lines.push('', t('msg.bExplain'));
  // Parts that cost something are ordered after an advance: said once, calmly, with the amount.
  const parts = v.items.filter((i) => i.kind === 'part' && !i.customerSupplied).reduce((s, i) => s + i.gross, 0);
  if (ctx.partsAdvanceFrom && parts >= ctx.partsAdvanceFrom) lines.push('', t('msg.partsAdvance', { amount: money(parts) }));
  lines.push('', t('msg.answerHint'));
  return lines.join('\n');
}

export function limitMessage(ctx: MsgContext, v: EstimateVersion): string {
  const lang = v.language;
  const t = tFor(lang);
  const items = v.items.map((i) => `• ${lineName(i.title, i.kind)} — ${formatAed(i.gross, lang)}`).join('\n');
  return tidy(t('msg.doneByLimit', { ...base(ctx, lang), items, sum: formatAed(v.fixedGross, lang), reason: v.reason ?? '' }));
}

export function verbalConfirmation(ctx: MsgContext, lang: Lang, approved: { title: string; gross: number }[], declined: { title: string }[]): string {
  const t = tFor(lang);
  const lines = [tidy(t('msg.verbalHeader', base(ctx, lang)))];
  if (approved.length) {
    lines.push(t('msg.verbalApproved'));
    for (const a of approved) lines.push(`• ${a.title} — ${formatAed(a.gross, lang)}`);
    lines.push(t('msg.total', { fixed: formatAed(approved.reduce((s, a) => s + a.gross, 0), lang) }));
  }
  if (declined.length) {
    lines.push(t('msg.verbalDeclined'));
    for (const d of declined) lines.push(`• ${d.title}`);
  }
  lines.push(t('msg.verbalFooter'));
  return lines.join('\n');
}

export async function logMessage(input: { orderId?: string; customerId: string; channel: Channel | 'in_person'; template: string; language: Lang; text: string }) {
  await db.messages.add({ ...input, id: uid(), createdAt: nowIso() });
  if (input.orderId) {
    await db.events.add({ id: uid(), orderId: input.orderId, at: nowIso(), type: 'message', payload: { channel: input.channel, template: input.template } });
  }
}
