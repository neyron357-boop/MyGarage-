import { db, uid } from '../db/db';
import { formatDate, nowIso } from '../domain/dates';
import { formatAed } from '../domain/money';
import { normalizePhone, phoneDigits } from '../domain/phone';
import { formatPlate } from '../domain/plates';
import { itemAmounts, itemTitle } from '../domain/items';
import type { Channel, Customer, EstimateVersion, Lang, Order, OrderItem, Vehicle } from '../domain/types';
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
  | 'documents';

export function simpleMessage(tpl: SimpleTemplate, ctx: MsgContext, lang: Lang, vars: Record<string, string | number> = {}): string {
  const t = tFor(lang);
  return t(`msg.${tpl}`, { ...base(ctx, lang), ...vars });
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

export function versionMessage(ctx: MsgContext, v: EstimateVersion): string {
  const lang = v.language;
  const t = tFor(lang);
  const money = (f: number) => formatAed(f, lang);
  const urg = { red: '🔴', yellow: '🟡', green: '🟢' } as const;
  const lines: string[] = [];
  const b = base(ctx, lang);
  if (v.number === 1) lines.push(t('msg.estimateHeader', { ...b, version: v.number }));
  else lines.push(t('msg.supplementHeader', { ...b, version: v.number, reason: v.reason ?? '' }));
  for (const block of ['A', 'B', 'C'] as const) {
    const list = v.items.filter((i) => i.block === block && i.kind !== 'discount');
    if (!list.length) continue;
    lines.push('', t(`msg.block${block}`));
    for (const i of list) {
      const price =
        i.minGross !== undefined && i.maxGross !== undefined && i.minGross !== i.maxGross
          ? `${money(i.minGross)} – ${money(i.maxGross)}`
          : money(i.gross);
      let line = `• ${i.title} — ${price}`;
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
  lines.push('', t('msg.answerHint'));
  return lines.join('\n');
}

export function limitMessage(ctx: MsgContext, v: EstimateVersion): string {
  const lang = v.language;
  const t = tFor(lang);
  const items = v.items.map((i) => `• ${i.title} — ${formatAed(i.gross, lang)}`).join('\n');
  return t('msg.doneByLimit', { ...base(ctx, lang), items, sum: formatAed(v.fixedGross, lang), reason: v.reason ?? '' });
}

export function verbalConfirmation(ctx: MsgContext, lang: Lang, approved: { title: string; gross: number }[], declined: { title: string }[]): string {
  const t = tFor(lang);
  const lines = [t('msg.verbalHeader', base(ctx, lang))];
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
