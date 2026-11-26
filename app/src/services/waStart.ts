import { startWaReplies } from './waAsk';
import { startChatStudy } from './chatStudy';
import { startWaAuto } from './waAuto';
import { startWaOutbox } from './waOutbox';
import { startWaRequests } from './waRequest';

/** The garage's WhatsApp by itself (v0.79), started once with the app: the reports heard, the outbox kept, the answers read. */
export function startWaAutomation() {
  startWaAuto();
  startWaOutbox();
  // Who a chat is (v0.86), and what the garage's requests in it came to, its makes (v0.91) — all chats once, then as they speak.
  startChatStudy();
  // A customer's request made a job of «Заявки» (v0.90, #69) — on the main device.
  startWaRequests();
}
export function startWaAsk() {
  startWaReplies();
}
