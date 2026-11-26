import { startWaReplies } from './waAsk';
import { startWaAuto } from './waAuto';
import { startWaOutbox } from './waOutbox';
import { startWaRoles } from './waRoles';
import { startWaRequests } from './waRequest';

/** The garage's WhatsApp by itself (v0.79), started once with the app: the reports heard, the outbox kept, the answers read. */
export function startWaAutomation() {
  startWaAuto();
  startWaOutbox();
  // Who a new chat is — said by the AI (v0.86).
  startWaRoles();
  // A customer's request made a job of «Заявки» (v0.90, #69) — on the main device.
  startWaRequests();
}
export function startWaAsk() {
  startWaReplies();
}
