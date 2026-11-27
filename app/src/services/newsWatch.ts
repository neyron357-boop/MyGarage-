import { db } from '../db/db';
import { formatAed } from '../domain/money';
import { itemAmounts, itemTitle } from '../domain/items';
import type { Customer, Lang, Order, OrderItem, PartAsk, Vehicle } from '../domain/types';
import { kindOf, type WaMessage } from '../domain/whatsapp';
import i18n, { tFor } from '../i18n';
import { customerAnswerOf } from './customerReply';
import { tellNews } from './news';
import { bundleAmountDue, loadOrderBundle } from './orders';
import { paymentShotOf } from './paymentShot';
import { knownPeople, onWaEvent } from './whatsapp';

/*
 * What happened, told as news (v0.97, services/news.ts) — looked for by any device of the garage that is open (the PC at
 * the desk all day): a customer's message → their open jobs: an answer to the quote the rules understand (domain/
 * customerReply.ts), a payment's proof on a job that owes (services/paymentShot.ts); a supplier's prices (services/
 * waAsk.ts calls `pricesNews`); a request made a job (services/waRequest.ts calls `requestNews`). Nothing is decided here:
 * the manager's tap on the job does it, as before.
 */

const lang = (): Lang => (i18n.language === 'en' ? 'en' : 'ru');
/** «Toyota Camry · Q 12345». */
export const carLine = (v?: Pick<Vehicle, 'make' | 'model' | 'plate'>) => (v ? [[v.make, v.model].filter(Boolean).join(' '), [v.plate?.code, v.plate?.number].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : '');
/** A customer's or a supplier's name, short. */
const short = (name?: string) => (name ?? '').trim().split(/\s+/).slice(0, 2).join(' ');
const nameOf = (c?: Pick<Customer, 'name' | 'companyName' | 'type'>) => short((c?.type === 'company' && c.companyName) || c?.name || '');

let started = false;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Once, with the WhatsApp of the app: each customer's message looked at a few seconds after it (a picture comes after its words). */
export function startNewsWatch() {
  if (started || typeof window === 'undefined') return;
  started = true;
  onWaEvent((ev) => {
    if (ev.t !== 'msg' || ev.msg.me) return;
    const phone = ev.chat?.phone;
    if (!phone) return;
    clearTimeout(timers.get(phone));
    timers.set(
      phone,
      setTimeout(() => {
        timers.delete(phone);
        void lookAt(phone, ev.msg).catch(() => undefined);
      }, 4000),
    );
  });
}

/** A customer's message: their open jobs — an answer to the quote, a payment. */
export async function lookAt(phone: string, msg: Pick<WaMessage, 'type'>): Promise<number> {
  const who = (await knownPeople()).get(phone);
  if (who?.kind !== 'customer') return 0;
  const customer = await db.customers.get(who.id);
  const orders = (await db.orders.where('customerId').equals(who.id).toArray()).filter((o) => o.stage !== 'cancelled' && !o.archivedAt);
  const t = tFor(lang());
  const picture = kindOf(msg.type) === 'photo' || kindOf(msg.type) === 'file';
  let said = 0;
  for (const o of orders) {
    const v = await db.vehicles.get(o.vehicleId);
    const car = carLine(v);
    const name = nameOf(customer) || t('customer.noName');
    if (o.stage !== 'closed') {
      const p = await customerAnswerOf(o.id);
      if (p) {
        const agreed = (await db.items.bulkGet(p.agree)).filter((i): i is OrderItem => !!i);
        const sum = agreed.reduce((n, i) => n + itemAmounts(i).gross, 0);
        const title =
          p.answer.kind === 'all'
            ? t('notify.news.answerAll', { who: name, car })
            : p.answer.kind === 'none'
              ? t('notify.news.answerNone', { who: name, car })
              : p.answer.kind === 'option'
                ? t('notify.news.answerOption', { who: name, car, n: p.answer.option })
                : t('notify.news.answerSome', { who: name, car, agree: p.agree.length, refuse: p.refuse.length });
        const body = [`«${p.text.slice(0, 120)}»`, sum > 0 ? formatAed(sum, lang()) : ''].filter(Boolean).join(' · ');
        if (await tellNews('answer', { key: `answer:${p.msgId}`, title, body, url: `#/orders/${o.id}` })) said++;
      }
    }
    if (picture) {
      const pay = await paymentShotOf(o.id);
      if (pay) {
        const b = await loadOrderBundle(o.id);
        const due = b ? Math.max(0, bundleAmountDue(b)) : pay.dueFils;
        const title = t('notify.news.payment', { way: t(`payShot.${pay.method}`), sum: formatAed(pay.shotFils, lang()), who: name });
        if (await tellNews('payment', { key: `payment:${pay.msgId}`, title, body: t('notify.news.paymentBody', { car, due: formatAed(due, lang()) }), url: `#/orders/${o.id}` })) said++;
      }
    }
  }
  return said;
}

/** A supplier's answer read into prices (services/waAsk.ts): «💲 Noor Parts: цены на 2 · Patrol», the lines with their prices. */
export async function pricesNews(x: { order: Order; ask: PartAsk }, msgId: string): Promise<boolean> {
  const items = (await db.items.bulkGet(x.ask.items)).filter((i): i is OrderItem => !!i);
  const priced = items.flatMap((i) => (i.offers ?? []).filter((o) => o.msg === msgId).map((o) => ({ i, o })));
  if (!priced.length) return false;
  const l = lang();
  const t = tFor(l);
  const [supplier, v] = await Promise.all([db.suppliers.get(x.ask.supplierId), db.vehicles.get(x.order.vehicleId)]);
  const lines = priced
    .slice(0, 4)
    .map(({ i, o }) => `${itemTitle(i, l)} ${o.na ? '—' : o.costFils ? formatAed(o.costFils, l, false) : '?'}`)
    .join(' · ');
  const n = new Set(priced.map((p) => p.i.id)).size;
  return tellNews('prices', {
    key: `prices:${msgId}`,
    title: t('notify.news.prices', { who: short(supplier?.name) || t('notify.news.kind.prices'), n, car: carLine(v) }),
    body: lines + (priced.length > 4 ? ` +${priced.length - 4}` : ''),
    url: `#/orders/${x.order.id}`,
  });
}

/** A request in WhatsApp made a job of «Заявки» (services/waRequest.ts). */
export async function requestNews(orderId: string, who: string, car: string, lines: number): Promise<boolean> {
  const t = tFor(lang());
  return tellNews('request', { key: `request:${orderId}`, title: t('notify.news.request', { car }), body: t('notify.news.requestBody', { who: short(who), n: lines }), url: `#/orders/${orderId}` });
}
