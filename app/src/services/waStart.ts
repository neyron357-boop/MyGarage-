import { startWaReplies } from './waAsk';
import { startChatStudy } from './chatStudy';
import { fillPriceBook } from './priceBook';
import { startWaAuto } from './waAuto';
import { startWaOutbox } from './waOutbox';
import { startWaRequests } from './waRequest';
import { startDailySummary } from './dailySummary';
import { startNewsWatch } from './newsWatch';

/** The garage's WhatsApp by itself (v0.79), started once with the app: the reports heard, the outbox kept, the answers read. */
export function startWaAutomation() {
  startWaAuto();
  startWaOutbox();
  // Who a chat is (v0.86), and what the garage's requests in it came to, its makes (v0.91) — all chats once, then as they speak.
  startChatStudy();
  // The prices the suppliers said before the price book (v0.91.7) — into it, once.
  void fillPriceBook().catch(() => undefined);
  // A customer's request made a job of «Заявки» (v0.90, #69) — on the main device.
  startWaRequests();
  // The owner's summary of the day in the evening (audit 27/11) — on the main device, through «Проверить и отправить».
  startDailySummary();
  // v0.97: what happened, told at once — a customer's answer to the quote, a payment's proof (services/newsWatch.ts).
  startNewsWatch();
}
export function startWaAsk() {
  startWaReplies();
}
