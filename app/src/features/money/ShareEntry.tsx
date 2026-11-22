import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconShare2 } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { formatDate } from '../../domain/dates';
import { activeInvoice } from '../../domain/invoice';
import type { LedgerEntry } from '../../domain/ledger';
import { formatAed } from '../../domain/money';
import { formatPlate } from '../../domain/plates';
import { invoicePdf } from '../../services/documents';
import { cardBlob } from '../../services/media';
import { proofsOf } from '../../services/proofs';
import { copyText } from '../../ui/clipboard';
import { haptic } from '../../ui/haptics';
import { useLang, useScreenLiveQuery } from '../../ui/hooks';
import { downloadFile } from '../../ui/share';
import { wayLabel } from './MoneyEntry';

/**
 * A money operation to the owner in one tap (v0.68, the user: «кнопку поделиться, которая отправляет владельцу что
 * было — сразу инвойс работы и фотографию, которую загрузил в эту операцию, например чек; так же и в расходах»): the
 * share sheet with what it was (the sum, how, the day, the job and its car, whom it is owed, the note), its photos (the
 * receipt, the proofs — at the card's size) and, money in for a job, the job's invoice. An iPhone shares only right in
 * the tap: the files are made beforehand, a moment after the sheet opens. Where nothing can be shared (a PC browser
 * without it), the text is copied and the files are saved.
 */
export function ShareEntryButton({ entry, label }: { entry: LedgerEntry; label: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const about = useScreenLiveQuery(async () => {
    const order = entry.orderId ? await db.orders.get(entry.orderId) : undefined;
    const vehicleId = order?.vehicleId ?? entry.vehicleId;
    const customerId = order?.customerId ?? entry.customerId;
    const [proofs, vehicle, customer, invoices] = await Promise.all([
      proofsOf(entry.id),
      vehicleId ? db.vehicles.get(vehicleId) : undefined,
      customerId ? db.customers.get(customerId) : undefined,
      order && entry.kind === 'in' ? db.invoices.where('orderId').equals(order.id).toArray() : [],
    ]);
    return { proofIds: proofs.map((m) => m.id), order, vehicle, customer, invoiceId: activeInvoice(invoices)?.id };
  }, [entry.id, entry.orderId, entry.vehicleId, entry.customerId, entry.kind]);
  const [files, setFiles] = useState<File[]>();
  const want = about ? [about.invoiceId ?? '', ...about.proofIds].join('|') : undefined;
  useEffect(() => {
    if (!about) return;
    let alive = true;
    setFiles(undefined);
    const timer = window.setTimeout(async () => {
      const out: File[] = [];
      if (about.invoiceId) {
        const pdf = await invoicePdf(about.invoiceId).catch(() => undefined);
        if (pdf) out.push(new File([pdf.blob], pdf.filename, { type: 'application/pdf' }));
      }
      for (const [n, id] of about.proofIds.entries()) {
        const blob = await cardBlob(id).catch(() => undefined);
        if (blob) out.push(new File([blob], `${entry.date}-${n + 1}.jpg`, { type: blob.type || 'image/jpeg' }));
      }
      if (alive) setFiles(out);
    }, 500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // The files follow what is attached (a proof added, the invoice redone), not every read of the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, entry.date]);

  const text = () => {
    const v = about?.vehicle;
    const c = about?.customer;
    const car = v ? [v.make, v.model, formatPlate(v.plate)].filter(Boolean).join(' ') : '';
    const who = c ? (c.type === 'company' && c.companyName ? c.companyName : c.name) : '';
    const sign = entry.kind === 'in' ? '+' : '−';
    return [
      [label, entry.vendor].filter(Boolean).join(' · '),
      `${sign}${formatAed(entry.amountFils, lang)}`,
      [wayLabel(t, entry.method ?? (entry.purse === 'credit' ? 'credit' : 'cash'), entry.source === 'payment' ? 'in' : entry.kind), formatDate(entry.date)].join(' · '),
      [about?.order ? `№${about.order.number}` : '', car, who].filter(Boolean).join(' · '),
      entry.owedTo ? t('ledger.shareOwed', { name: entry.owedTo }) : '',
      (entry.source === 'expense' ? entry.expenseNote : entry.note) ?? '',
    ]
      .filter(Boolean)
      .join('\n');
  };
  const share = () => {
    haptic('light');
    const list = files ?? [];
    const body = text();
    if (typeof navigator.share === 'function') {
      const data: ShareData = list.length && navigator.canShare?.({ files: list }) ? { files: list, text: body } : { text: body };
      navigator.share(data).catch(() => undefined);
      return;
    }
    void copyText(body).then((ok) => ok && notifications.show({ color: 'green', message: t('common.copied') }));
    list.forEach(downloadFile);
  };
  return (
    <Button variant="light" fullWidth leftSection={<IconShare2 size={18} />} loading={!files} onClick={share} data-share-entry>
      {t('common.share')}
    </Button>
  );
}
