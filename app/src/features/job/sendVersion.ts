import { useState } from 'react';
import type { EstimateVersion } from '../../domain/types';
import { quotationPdf, versionPdf } from '../../services/documents';
import { previewVersion, sendVersion, type SendOptions } from '../../services/estimate';
import { versionMessage } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import type { SendRequest } from '../../ui/SendDialog';

/**
 * "To the customer" (WhatsApp / Telegram): the message is shown first; the quote is frozen (the lines wait
 * for the answer) only once it really goes — "Yes, sent" or the PDF shared. Closing the message keeps the drafts.
 */
export function useSendVersion(b: OrderBundle | undefined) {
  const [send, setSend] = useState<SendRequest | null>(null);
  const prepare = async (orderId: string, opts: SendOptions) => {
    if (!b) return;
    const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
    const preview = await previewVersion(orderId, opts);
    let frozen: Promise<EstimateVersion> | undefined;
    const freeze = () => (frozen ??= sendVersion(orderId, opts));
    setSend({
      text: versionMessage(ctx, preview),
      template: preview.number === 1 ? 'estimate' : 'supplement',
      lang: preview.language,
      orderId,
      pdf: async () => versionPdf((await freeze()).id),
      // The boss sees the quote first (v0.80.3): the lines as they are — nothing frozen.
      bossPdf: () => quotationPdf(orderId),
      // The photos of the lines going now (what was found): shared with the text from the phone.
      photos: b.items.filter((i) => i.approvalState === 'draft').flatMap((i) => i.mediaIds ?? []),
      onConfirm: async () => {
        await freeze();
      },
    });
  };
  return { send, setSend, prepare };
}
