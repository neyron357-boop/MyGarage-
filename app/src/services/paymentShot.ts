import { dubaiDate } from '../domain/dates';
import { paymentPlan, type PaymentShotPlan } from '../domain/paymentShot';
import { kindOf, waDigits, type WaMessage } from '../domain/whatsapp';
import { db } from '../db/db';
import { aiPaymentShot, type AiPaymentShot } from './ai';
import { addPayment } from './money';
import { bundleAmountDue, loadOrderBundle } from './orders';
import { addProofs } from './proofs';
import { oneAtATime } from './serial';
import { chatOfPhone, fetchChatMessages, numberOnWa, waCan, waFileBlob } from './whatsapp';

/*
 * A payment from the customer's screenshot (audit 27/11: «клиент присылает скрин перевода — менеджер переписывает сумму
 * руками»): while the job owes, the customer's newest picture (or PDF) in WhatsApp after the invoice is shown to the
 * garage's AI once (`aiPaymentShot`: only what is printed); a payment for sure (domain/paymentShot.ts) is a proposal on
 * the job — «Перевод · 1 250.00 · 27/11 · Emirates NBD → Записать». Nothing is recorded by itself: the manager's tap
 * records the payment (the screenshot its proof); × — not this picture. Nothing of the chat is kept: what the AI said of
 * a picture lives in memory, a picture that is not a payment — its id on this device.
 */

export interface PaymentShotProposal extends PaymentShotPlan {
  orderId: string;
  msgId: string;
  /** When the picture came (ms). */
  at: number;
  mime?: string;
  bank?: string;
  dueFils: number;
}

const NOT_PAYMENT = 'mygarage.payShot.no';
const notPayment = (): string[] => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(NOT_PAYMENT) ?? '[]') as string[];
  } catch {
    return [];
  }
};
const markNotPayment = (id: string) => {
  try {
    globalThis.localStorage?.setItem(NOT_PAYMENT, JSON.stringify([...notPayment().filter((x) => x !== id), id].slice(-300)));
  } catch {
    // nothing more to do
  }
};

/** What the AI said of each picture, while the app is open — a picture is asked about once. */
const reads = new Map<string, Promise<AiPaymentShot | undefined>>();
const readOnce = (id: string) => {
  let r = reads.get(id);
  if (!r) {
    r = aiPaymentShot(id);
    reads.set(id, r);
  }
  return r;
};

const isShot = (m: WaMessage) => {
  const kind = kindOf(m.type);
  return kind === 'photo' || (kind === 'file' && /pdf/i.test(m.file?.mime ?? '') && (m.file?.size ?? 0) <= 4_000_000);
};

/** The proposal of the customer's newest picture after the invoice, if it is a payment for sure; else nothing. */
export async function paymentShotOf(orderId: string): Promise<PaymentShotProposal | undefined> {
  if (!waCan()) return undefined;
  const b = await loadOrderBundle(orderId);
  if (!b || b.order.waived) return undefined;
  const dueFils = Math.max(0, bundleAmountDue(b));
  const invoices = b.invoices.filter((i) => i.type !== 'credit_note' && i.status === 'issued');
  if (!(dueFils > 0) || !invoices.length) return undefined;
  const since = Math.max(...invoices.map((i) => Date.parse(i.issuedAt))) - 10 * 60_000;
  const customer = await db.customers.get(b.order.customerId);
  const phone = waDigits(customer?.whatsapp || customer?.phone || '');
  if (!phone) return undefined;
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
  let msgs: WaMessage[];
  try {
    msgs = await fetchChatMessages(chat, 15);
  } catch {
    return undefined;
  }
  const no = new Set(notPayment());
  const shot = msgs.filter((m) => !m.me && m.t > since && isShot(m)).sort((a, b2) => b2.t - a.t)[0];
  if (!shot || shot.id === b.order.payShotSeen || no.has(shot.id)) return undefined;
  const read = await readOnce(shot.id);
  if (!read) {
    reads.delete(shot.id); // no answer (no server, no key): asked again later
    return undefined;
  }
  const plan = paymentPlan(read, dueFils, dubaiDate(new Date(shot.t)), dubaiDate());
  if (!plan) {
    if (!read.isPayment) markNotPayment(shot.id);
    return undefined;
  }
  return { ...plan, orderId, msgId: shot.id, at: shot.t, mime: shot.file?.mime, bank: read.bank?.trim() || undefined, dueFils };
}

/**
 * The manager's tap: the payment recorded on the job (the day and the reference of the screenshot), never more than is
 * due now (read again — another tap or device may have paid since); the screenshot kept as its proof.
 */
export async function acceptPaymentShot(p: PaymentShotProposal): Promise<{ amountFils: number; paidFull: boolean } | undefined> {
  return oneAtATime(`pay-shot:${p.orderId}`, async () => {
    const b = await loadOrderBundle(p.orderId);
    const due = b ? Math.max(0, bundleAmountDue(b)) : 0;
    await db.orders.update(p.orderId, { payShotSeen: p.msgId });
    if (!(due > 0)) return undefined;
    const amountFils = Math.min(p.amountFils, due);
    const payment = await addPayment(p.orderId, { kind: 'payment', method: p.method, amountFils, reference: p.reference, date: p.date });
    try {
      const file = await waFileBlob({ id: p.msgId, chat: '', t: p.at, me: false, type: 'image', text: '', ack: 0, file: { mime: p.mime } } as WaMessage);
      if (file) await addProofs({ id: payment.id, source: 'payment' }, [file]);
    } catch {
      // the payment stands; the picture stays in the chat
    }
    return { amountFils, paidFull: amountFils >= due };
  });
}

/** «×» — not this picture (not proposed again; a newer one is read). */
export async function dismissPaymentShot(orderId: string, msgId: string): Promise<void> {
  await db.orders.update(orderId, { payShotSeen: msgId });
}
