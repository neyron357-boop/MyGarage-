import { startWaReplies } from './waAsk';
import { startWaAuto } from './waAuto';
import { startWaOutbox } from './waOutbox';

/** The garage's WhatsApp by itself (v0.79), started once with the app: the reports heard, the outbox kept, the answers read. */
export function startWaAutomation() {
  startWaAuto();
  startWaOutbox();
}
export function startWaAsk() {
  startWaReplies();
}
