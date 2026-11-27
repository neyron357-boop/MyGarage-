import { db } from '../db/db';
import { readCustomerAnswer, type CustomerAnswer, type ReplyLine } from '../domain/customerReply';
import { dubaiTime } from '../domain/dates';
import { isAwaitingClient, itemTitle } from '../domain/items';
import { isLabourCharge } from '../domain/linePrices';
import { liveOptions } from '../domain/quoteOptions';
import type { OrderItem } from '../domain/types';
import { waDigits } from '../domain/whatsapp';
import { recordDecisions } from './estimate';
import { approveAll, syncStage } from './flow';
import { chooseQuoteOption } from './quoteOptions';
import { chatOfPhone, fetchChatMessages, numberOnWa, waCan } from './whatsapp';

/*
 * The customer's answer in WhatsApp, as a proposal on the job (audit 27/11: «Ответ клиента → «Согласовать?»»). The quote
 * asks for «YES»; what the customer wrote after it is read by the rules (domain/customerReply.ts, no AI) — «ok», «only
 * the pads», «option 2» — and the job shows «Клиент: «ok, go ahead» → Согласовать». Nothing is agreed by itself: the
 * manager's tap does it, the customer's words and their time kept with the decision (the dispute «я не соглашался»).
 */

export interface AnswerProposal {
  orderId: string;
  msgId: string;
  text: string;
  /** When it was written (ms). */
  at: number;
  answer: Exclude<CustomerAnswer, { kind: 'question' } | { kind: 'unknown' }>;
  /** The lines it agrees and refuses (of those waiting for the answer). */
  agree: string[];
  refuse: string[];
  /** The option it chose (its id). */
  optionId?: string;
}

const lineOf = (i: OrderItem, lang: 'ru' | 'en'): ReplyLine => {
  const name = itemTitle(i, lang);
  return { id: i.id, name, labour: !!i.autoLabour || isLabourCharge(name) };
};

/** What the customer's newest message after the quote says, if it says something for sure; else nothing. */
export async function customerAnswerOf(orderId: string): Promise<AnswerProposal | undefined> {
  if (!waCan()) return undefined;
  const order = await db.orders.get(orderId);
  if (!order) return undefined;
  const [customer, items] = await Promise.all([db.customers.get(order.customerId), db.items.where('orderId').equals(orderId).toArray()]);
  const phone = waDigits(customer?.whatsapp || customer?.phone || '');
  if (!phone) return undefined;
  const pending = items.filter(isAwaitingClient);
  const sentOptions = liveOptions(items, order.quoteOptions).filter((o) => o.sentAt && !o.chosenAt);
  if (!pending.length && sentOptions.length < 2) return undefined;
  // Since the quote (or the options) went.
  const versions = await db.versions.bulkGet([...new Set(pending.map((i) => i.lastVersionId).filter((x): x is string => !!x))]);
  const since = Math.min(...[...versions.map((v) => (v ? Date.parse(v.sentAt) : Infinity)), ...sentOptions.map((o) => Date.parse(o.sentAt!))]);
  if (!Number.isFinite(since)) return undefined;
  let chat = chatOfPhone(phone)?.id;
  if (!chat) {
    try {
      const r = await numberOnWa(phone);
      chat = r.ok ? r.chat : undefined;
    } catch {
      chat = undefined;
    }
  }
  if (!chat) return undefined;
  let msgs;
  try {
    msgs = await fetchChatMessages(chat, 20, { lite: true });
  } catch {
    return undefined;
  }
  // The newest of the customer's own words after the quote — not one already seen (×).
  const last = msgs.filter((m) => !m.me && m.t > since && (m.text ?? '').trim()).sort((a, b) => b.t - a.t)[0];
  if (!last || last.id === order.answerSeen) return undefined;
  const lang = order.docLanguage ?? 'en';
  const lines = pending.map((i) => lineOf(i, lang));
  const answer = readCustomerAnswer(last.text, lines, pending.length ? 0 : sentOptions.length);
  if (answer.kind === 'question' || answer.kind === 'unknown') return undefined;
  const ids = pending.map((i) => i.id);
  const base = { orderId, msgId: last.id, text: last.text.trim().slice(0, 200), at: last.t };
  if (answer.kind === 'all') return { ...base, answer, agree: ids, refuse: [] };
  if (answer.kind === 'none') return { ...base, answer, agree: [], refuse: ids };
  if (answer.kind === 'some') return { ...base, answer, agree: answer.agree, refuse: answer.refuse };
  const option = sentOptions[answer.option - 1];
  return option ? { ...base, answer, agree: option.itemIds, refuse: [], optionId: option.id } : undefined;
}

/** The manager's tap on the proposal: the decision recorded with the customer's words and their time. */
export async function acceptCustomerAnswer(p: AnswerProposal): Promise<void> {
  const note = `WhatsApp ${dubaiTime(new Date(p.at).toISOString())}: «${p.text.slice(0, 160)}»`;
  if (p.optionId) {
    await chooseQuoteOption(p.orderId, p.optionId);
    await approveAll(p.orderId);
  } else {
    const items = (await db.items.bulkGet([...p.agree, ...p.refuse])).filter((i): i is OrderItem => !!i && isAwaitingClient(i));
    const byVersion = new Map<string, OrderItem[]>();
    for (const i of items) if (i.lastVersionId) byVersion.set(i.lastVersionId, [...(byVersion.get(i.lastVersionId) ?? []), i]);
    for (const [versionId, list] of byVersion)
      await recordDecisions(
        versionId,
        list.map((i) => ({ itemId: i.id, decision: p.agree.includes(i.id) ? ('approve' as const) : ('decline' as const) })),
        'messenger',
        note,
      );
    await syncStage(p.orderId);
  }
  await db.orders.update(p.orderId, { answerSeen: p.msgId });
}

/** «×» — not this message (it is not shown again; a newer one is read). */
export async function dismissCustomerAnswer(orderId: string, msgId: string): Promise<void> {
  await db.orders.update(orderId, { answerSeen: msgId });
}
