import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandWhatsapp } from '@tabler/icons-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { onRepliesRead } from '../../services/waAsk';
import { openRoute } from '../../ui/openRoute';

/**
 * A supplier's answer put on a job (v0.79): said once, in a line — who, how many parts got a price, which job — with
 * the way to the job. Nothing else of WhatsApp is said here (its own app on the phone says the messages).
 */
export function WaNotices() {
  const { t } = useTranslation();
  useEffect(
    () =>
      onRepliesRead((r) => {
        notifications.show({
          color: 'green',
          autoClose: 7000,
          icon: <IconBrandWhatsapp size={18} />,
          message: (
            <Group gap="sm" wrap="nowrap" justify="space-between" data-wa-notice>
              <Text size="sm">{t('wa.ask.notice', { supplier: r.supplier, n: r.lines, number: r.number })}</Text>
              <Button
                size="compact-sm"
                variant="light"
                onClick={() => {
                  openRoute(`/orders/${r.orderId}`);
                  notifications.clean();
                }}
              >
                {t('wa.ask.open')}
              </Button>
            </Group>
          ),
        });
      }),
    [t],
  );
  return null;
}
