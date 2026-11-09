import { Button, Modal, Stack, Text } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import type { Order } from '../../domain/types';
import { deleteJob, jobDeleteBlock, restoreJob } from '../../services/orders';
import { ConfirmModal, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';

/**
 * "Delete job": a job without documents and money goes whole, with an "Undo" right after; a job with
 * an invoice, money, a signed report or a sent estimate cannot go — the sheet says why and what to do.
 * `beforeDelete` lets the job's own screen step away first (so it never shows an empty page).
 */
export function DeleteJobModal({ order, opened, onClose, beforeDelete }: { order: Pick<Order, 'id' | 'number'>; opened: boolean; onClose: () => void; beforeDelete?: () => Promise<void> | void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  // undefined: still checking; null: can go; a reason: must stay.
  const block = useLiveQuery(async () => (opened ? ((await jobDeleteBlock(order.id)) ?? null) : undefined), [opened, order.id]);
  if (opened && block) {
    return (
      <Modal opened onClose={onClose} title={t('order.deleteBlockedTitle')}>
        <Stack gap="md">
          <Text fw={600}>{t(`order.deleteBlock.${block}`)}</Text>
          <Text size="sm" c="dimmed">
            {t('order.deleteBlockedText')}
          </Text>
          <Button variant="default" onClick={onClose}>
            {t('common.close')}
          </Button>
        </Stack>
      </Modal>
    );
  }
  return (
    <ConfirmModal
      opened={opened && block === null}
      onClose={onClose}
      title={t('order.deleteTitle', { n: order.number })}
      confirmLabel={t('order.delete')}
      color="red"
      icon={<IconTrash size={18} />}
      onConfirm={async () => {
        onClose();
        await beforeDelete?.();
        const gone = await run(() => deleteJob(order.id));
        if (gone) {
          haptic('success');
          undoToast(t('order.deleted', { n: order.number }), t('common.undo'), () => void run(() => restoreJob(gone)));
        }
        return false;
      }}
    >
      <Text size="sm">{t('order.deleteText')}</Text>
    </ConfirmModal>
  );
}
