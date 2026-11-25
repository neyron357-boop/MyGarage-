import { isToSend, liveLines } from '../../domain/flow';
import { activeInvoice } from '../../domain/invoice';
import { isAwaitingClient, itemAmounts } from '../../domain/items';
import { formatAed } from '../../domain/money';
import { qtyShort } from '../../domain/sides';
import type { EstimateVersion } from '../../domain/types';
import { invoicePdf, quotationPdf, versionPdf } from '../../services/documents';
import { previewVersion, sendVersion } from '../../services/estimate';
import { phaseOf } from '../../services/flow';
import { simpleMessage, versionMessage } from '../../services/messages';
import { bundleAmountDue, type OrderBundle } from '../../services/orders';
import type { SendRequest } from '../../ui/SendDialog';

/*
 * A job's documents for its customer, from outside the job's screen (v0.80: a chat's «＋») — the same messages as the
 * job's own buttons: «Клиенту» (a new estimate, frozen only once it really goes), the estimate waiting for the answer,
 * the invoice.
 */

export interface JobDocs {
  /** The estimate: the drafts as a new version (`fresh`), else the version the customer has not answered, else the last. */
  estimate?: { fresh: boolean; make: () => Promise<SendRequest> };
  /** A part short of its name (v0.70): looked at before a new estimate goes, as before «Клиенту». */
  qtyAsk: boolean;
  /** The invoice in force, its PDF with the words of «машина готова» (or «документы» when nothing is owed). */
  invoice?: () => SendRequest;
}

export function jobDocs(b: OrderBundle): JobDocs {
  const phase = phaseOf(b);
  const inv = activeInvoice(b.invoices);
  const live = liveLines(b.items);
  const lines = live.filter((i) => i.kind !== 'discount');
  const waiting = b.items.filter(isAwaitingClient);
  const unpriced = lines.filter((i) => i.approvalState === 'draft' && !i.customerSupplied && itemAmounts(i).gross === 0);
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
  const docLang = b.order.docLanguage;
  const oid = b.order.id;
  const sent = (v: EstimateVersion, photos: string[]): SendRequest => ({ text: versionMessage(ctx, v), template: 'estimate', lang: v.language, orderId: oid, pdf: () => versionPdf(v.id), photos });

  let estimate: JobDocs['estimate'];
  if (!inv && phase === 'price' && lines.length && !unpriced.length)
    estimate = {
      fresh: true,
      make: async () => {
        const opts = { via: 'whatsapp' as const };
        const preview = await previewVersion(oid, opts);
        let frozen: Promise<EstimateVersion> | undefined;
        const freeze = () => (frozen ??= sendVersion(oid, opts));
        return {
          text: versionMessage(ctx, preview),
          template: preview.number === 1 ? 'estimate' : 'supplement',
          lang: preview.language,
          orderId: oid,
          pdf: async () => versionPdf((await freeze()).id),
          bossPdf: () => quotationPdf(oid),
          photos: b.items.filter(isToSend).flatMap((i) => i.mediaIds ?? []),
          onConfirm: async () => {
            await freeze();
          },
        };
      },
    };
  else {
    const v = waiting.length ? b.versions.filter((x) => waiting.some((i) => i.lastVersionId === x.id)).pop() : b.versions[b.versions.length - 1];
    if (v) estimate = { fresh: false, make: async () => sent(v, waiting.flatMap((i) => i.mediaIds ?? [])) };
  }

  const due = Math.max(0, bundleAmountDue(b));
  const invoice = inv
    ? (): SendRequest => ({
        text: due > 0 ? simpleMessage('carReady', ctx, docLang, { amount: formatAed(due, docLang) }) : simpleMessage('documents', ctx, docLang),
        template: due > 0 ? 'carReady' : 'documents',
        lang: docLang,
        orderId: oid,
        pdf: () => invoicePdf(inv.id),
      })
    : undefined;

  return { estimate, qtyAsk: !!estimate?.fresh && live.some((i) => qtyShort(i)), invoice };
}
