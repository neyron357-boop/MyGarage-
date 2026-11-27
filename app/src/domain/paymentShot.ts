/*
 * A customer's payment proof in WhatsApp (audit 27/11: «Оплата по скриншоту перевода»): the garage's AI says what the
 * picture prints (services/ai.ts `aiPaymentShot`); these rules decide whether it is a proposal on the job and with what.
 * Nothing is recorded by itself — the manager's tap does it (services/paymentShot.ts).
 */

export interface PaymentShotRead {
  isPayment: boolean;
  amount: number;
  currency: string;
  date?: string;
  reference?: string;
  bank?: string;
  way?: string;
  confidence: number;
}

export interface PaymentShotPlan {
  /** What to record: the screenshot's amount, never more than is due. */
  amountFils: number;
  /** What the picture says (when it is more than is due — said beside it). */
  shotFils: number;
  method: 'transfer' | 'card';
  /** The day of the payment, YYYY-MM-DD (Dubai): the printed one when it can be, else the day the picture came. */
  date: string;
  reference?: string;
}

const AED = /^(aed|dhs?|dirhams?|درهم|د\.إ\.?)$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const back = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/**
 * The proposal of a read picture, or nothing: only a payment the AI is sure of (≥ 0,6), in dirhams (or no currency
 * printed), with an amount, while the job owes. The day printed counts when it is a real day, not after today and not
 * more than a week before the picture came; the reference — the bank and the number as printed.
 */
export function paymentPlan(read: PaymentShotRead | undefined, dueFils: number, sentDay: string, today: string): PaymentShotPlan | undefined {
  if (!read?.isPayment || !(read.confidence >= 0.6) || !(dueFils > 0)) return undefined;
  const currency = (read.currency ?? '').trim();
  if (currency && !AED.test(currency)) return undefined;
  const shotFils = Math.round(Number(read.amount) * 100);
  if (!(shotFils > 0)) return undefined;
  const printed = (read.date ?? '').trim();
  const date = DAY.test(printed) && !Number.isNaN(Date.parse(printed)) && printed <= today && printed >= back(sentDay, 7) ? printed : sentDay <= today ? sentDay : today;
  const reference = [read.bank, read.reference].map((x) => (x ?? '').trim()).filter(Boolean).join(' · ').slice(0, 80) || undefined;
  return { amountFils: Math.min(shotFils, dueFils), shotFils, method: /card|slip|pos/i.test(read.way ?? '') ? 'card' : 'transfer', date, reference };
}
