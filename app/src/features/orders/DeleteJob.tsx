import { Text } from '@mantine/core';
import { IconAlertTriangle, IconCash, IconFileInvoice, IconFileText, IconReceiptRefund, IconSignature, IconTrash, IconTruckReturn } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeleteBlock } from '../../domain/deletion';
import type { Order } from '../../domain/types';
import { deleteJob, jobHolds, restoreJob } from '../../services/orders';
import { ConfirmModal, List, ListRow, Money, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';

const HOLD_ICON: Record<DeleteBlock, { icon: ReactNode; color: string }> = {
  invoice: { icon: <IconFileInvoice size={18} />, color: 'red' },
  payment: { icon: <IconCash size={18} />, color: 'green' },
  debt: { icon: <IconReceiptRefund size={18} />, color: 'orange' },
  signed: { icon: <IconSignature size={18} />, color: 'indigo' },
  sent: { icon: <IconFileText size={18} />, color: 'violet' },
  claim: { icon: <IconAlertTriangle size={18} />, color: 'yellow' },
  return: { icon: <IconTruckReturn size={18} />, color: 'teal' },
};

/**
 * "Delete job": a job without documents and money goes whole, with an "Undo" right after. One with an invoice, money,
 * a debt, a signed report or a sent estimate (v0.38, the user's call) — the sheet lists what goes with it, and the red
 * button deletes it all: its documents, and its money from the book and the cash box; "Undo" right after brings it back.
 * `beforeDelete` lets the job's own screen step away first (so it never shows an empty page).
 */
export function DeleteJobModal({ order, opened, onClose, beforeDelete }: { order: Pick<Order, 'id' | 'number'>; opened: boolean; onClose: () => void; beforeDelete?: () => Promise<void> | void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  // undefined: still checking.
  const holds = useLiveQuery(async () => (opened ? await jobHolds(order.id) : undefined), [opened, order.id]);
  const withRecords = !!holds?.holds.length;
  return (
    <ConfirmModal
      opened={opened && !!holds}
      onClose={onClose}
      title={t(withRecords ? 'order.deleteAllTitle' : 'order.deleteTitle', { n: order.number })}
      confirmLabel={t(withRecords ? 'order.deleteAll' : 'order.delete')}
      color="red"
      icon={<IconTrash size={18} />}
      onConfirm={async () => {
        onClose();
        await beforeDelete?.();
        const gone = await run(() => deleteJob(order.id, { withRecords }));
        if (gone) {
          haptic('success');
          undoToast(t('order.deleted', { n: order.number }), t('common.undo'), () => void run(() => restoreJob(gone)));
        }
        return false;
      }}
    >
      {withRecords && holds ? (
        <>
          <List className="delete-holds">
            {holds.holds.map((h) => (
              <ListRow
                key={h}
                left={
                  <span className="row-icon" style={{ background: `var(--mantine-color-${HOLD_ICON[h].color}-6)` }} aria-hidden>
                    {HOLD_ICON[h].icon}
                  </span>
                }
                title={t(`order.deleteHold.${h}`)}
                right={
                  h === 'invoice' ? (
                    <Text size="sm" c="dimmed">
                      {holds.invoices.join(', ')}
                    </Text>
                  ) : h === 'payment' ? (
                    <Money fils={holds.paidFils} />
                  ) : undefined
                }
              />
            ))}
          </List>
          <Text size="sm" c="dimmed" mt="sm">
            {t('order.deleteAllText')}
          </Text>
        </>
      ) : (
        <Text size="sm">{t('order.deleteText')}</Text>
      )}
    </ConfirmModal>
  );
}
