import { formatPhone } from '../../domain/phone';
import { waAutoOf } from '../../domain/waAuto';
import { tFor } from '../../i18n';
import { getSettings } from '../../services/settings';

/**
 * The line before a customer's message forwarded (v0.80.3, the owner: «если это клиент, то при пересылке короткое
 * примечание, от какого клиента»): «From customer Jun (+971 54 444 1554):» — in the language of the garage's own reports
 * (the boss's, «WhatsApp → Автоматизация»). Not a customer's — no line.
 */
export async function forwardNote(customer: { name: string; phone?: string } | undefined): Promise<string | undefined> {
  if (!customer) return undefined;
  const lang = waAutoOf((await getSettings()).waAuto).boss.lang;
  const t = tFor(lang);
  const phone = customer.phone ? formatPhone(customer.phone.startsWith('+') ? customer.phone : `+${customer.phone}`) : '';
  return phone ? t('msg.forwardFrom', { name: customer.name || phone, phone }) : t('msg.forwardFromName', { name: customer.name });
}
