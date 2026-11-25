import { startWaReplies } from './waAsk';
import { startWaAuto } from './waAuto';
import { startWaOutbox } from './waOutbox';
import { startWaRoles } from './waRoles';

/** The garage's WhatsApp by itself (v0.79), started once with the app: the reports heard, the outbox kept, the answers read. */
export function startWaAutomation() {
  startWaAuto();
  startWaOutbox();
  // Who a new chat is — said by the AI (v0.86).
  startWaRoles();
}
export function startWaAsk() {
  startWaReplies();
}
