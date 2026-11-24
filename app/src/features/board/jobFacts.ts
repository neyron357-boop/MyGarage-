import { boardStatusOf, STATUS_PHASE } from '../../domain/boardStatus';
import { dueShort, hoursBetween, nowIso } from '../../domain/dates';
import type { Phase } from '../../domain/flow';
import { liveLines } from '../../domain/flow';
import { activeInvoice } from '../../domain/invoice';
import { itemAmounts, summarize } from '../../domain/items';
import { jobSummary } from '../../domain/jobSummary';
import type { Lang } from '../../domain/types';
import { partsToFind } from '../../services/flow';
import { bundleAmountDue, type OrderBundle } from '../../services/orders';
import { PHASE_META } from '../job/phase';
import { orderFlags } from '../orders/flags';

/**
 * The steps of a car in the workshop in the order the day goes: cars to look at first. A car gone with money due
 * is not one of them — it is under "Debts", one card per customer.
 */
export const BOARD_STEPS: Phase[] = ['look', 'price', 'wait', 'work', 'pay', 'out', 'booked'];
export const isBoardStep = (k: string): k is Phase => (BOARD_STEPS as string[]).includes(k);

/** What the job is worth now: the amount due on its invoice, or the total of its lines. */
export function jobAmount(b: OrderBundle): number {
  if (activeInvoice(b.invoices) || b.order.stage === 'delivered') return Math.max(0, bundleAmountDue(b));
  return liveLines(b.items).reduce((s, i) => s + itemAmounts(i).gross, 0);
}

/** What a job came to: its invoice (with VAT), or the lines the customer agreed to — a closed or cancelled job in the archive. */
export function jobTotal(b: OrderBundle): number {
  if (b.order.stage === 'cancelled') return 0;
  return activeInvoice(b.invoices)?.totalFils ?? summarize(b.items).approvedGross;
}

/**
 * What a job's card says, read off its facts — the same for the phone's card and row (`JobRow`) and the PC's card and
 * line (`DeskBoard`, v0.75): where it stands and since when, whether that is too long, what it is about, what it is
 * worth, what waits on it (parts to find, parts on their way, work outside, the time promised), its paper.
 */
export function jobFacts(b: OrderBundle, phase: Phase, lang: Lang) {
  // Put in a tab by hand (v0.70) other than its step would put it: the card says where — its colour, its word.
  const manual = b.order.boardTab && b.order.boardTab !== boardStatusOf({}, phase) ? b.order.boardTab : undefined;
  const m = manual ? PHASE_META[STATUS_PHASE[manual]] : PHASE_META[phase];
  const { flags, waitingHours } = orderFlags(b);
  const hours = phase === 'wait' && waitingHours !== undefined ? waitingHours : hoursBetween(b.order.stageChangedAt);
  // No answer, or no price told, for a couple of hours: the time turns red.
  // An appointment says when the car is due in (red once that time has passed), not how long it was booked.
  const booked = phase === 'booked' ? b.order.bookedFor : undefined;
  const late = ((phase === 'wait' || phase === 'price') && hours >= (b.settings.boardWarnHours ?? 2)) || (!!booked && booked < nowIso());
  const amount = jobAmount(b);
  const car = [b.vehicle.make, b.vehicle.model].filter(Boolean).join(' ');
  const working = phase === 'look' || phase === 'price' || phase === 'wait' || phase === 'work';
  const find = working && phase !== 'look' ? partsToFind(b.items).length : 0;
  // Parts on their way (ordered, not here yet), work handed outside, the time promised to the customer.
  const coming = working && !find && b.items.some((i) => i.kind === 'part' && !i.customerSupplied && !i.done && i.approvalState === 'approved' && (i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit'));
  const outside = working && b.items.some((i) => i.outsource?.state === 'out' && i.approvalState !== 'declined' && i.approvalState !== 'cancelled');
  const due = working ? b.order.promisedReadyAt : undefined;
  const dueLate = !!due && due < nowIso();
  const dueText = due ? dueShort(due, lang) : '';
  // The step in its colour — red once it has been there too long: the first thing the card says.
  const tone = late ? 'red' : m.color;
  const name = car || `№${b.order.number}`;
  // What the job is about, in a line (v0.30): its work and parts by name, else the complaint.
  const what = jobSummary(b.items, b.order.complaint, b.order.docLanguage);
  // Its paper, on the card (v0.30): the invoice once issued, else the quote of its lines.
  const inv = activeInvoice(b.invoices);
  const doc: 'invoice' | 'quote' | null = inv ? 'invoice' : liveLines(b.items).some((i) => i.kind !== 'discount') ? 'quote' : null;
  // The customer's WhatsApp, when there is a number to write to.
  const wa = b.customer.whatsapp || b.customer.phone;
  // Whose it is (v0.81, the user's brief: «на карточке показать автомобиль, госномер и имя клиента, если оно указано»).
  const who = (b.customer.type === 'company' && b.customer.companyName) || b.customer.name.trim();
  return { manual, m, flags, hours, booked, late, amount, car, working, find, coming, outside, due, dueLate, dueText, tone, name, what, inv, doc, wa, who };
}

export type JobFacts = ReturnType<typeof jobFacts>;
