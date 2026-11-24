import { Button, Stack, Text } from '@mantine/core';
import { IconBrandWhatsapp, IconCheck } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { formatDateTime } from '../../domain/dates';
import { waAutoOf, type WaTarget } from '../../domain/waAuto';
import { saveWaAuto, sendExpenseToBoss } from '../../services/waAuto';
import { waCan } from '../../services/whatsapp';
import { haptic } from '../../ui/haptics';
import { useAction, useSettings } from '../../ui/hooks';
import { ChatPicker } from '../whatsapp/ChatPicker';

/**
 * «Отправить руководителю» in an expense's sheet (v0.81, the user's brief: «разрешить отправку распознанного расхода только
 * после сохранения ручной привязки… кнопка «Отправить руководителю» одним нажатием отправляет данные расхода и вручную
 * выбранного заказа прямо в настроенный чат через интеграцию WhatsApp»): lit once the expense is on a job; one tap — the
 * expense and that job to the boss's chat (the first time the chat is picked here and kept as the boss's; the boss's own
 * reports stay as they were set). Sent — it says when; another job picked — it goes again. Only with the garage's WhatsApp.
 */
export function BossSend({ expenseId }: { expenseId: string }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const e = useLiveQuery(() => db.expenses.get(expenseId), [expenseId]);
  const [picking, setPicking] = useState(false);
  const { run, busy } = useAction({ exclusive: true });
  if (!waCan() || !e || !settings) return null;
  const boss = waAutoOf(settings.waAuto).boss;
  const send = (to?: WaTarget) =>
    run(async () => {
      await sendExpenseToBoss(expenseId, to);
      haptic('success');
    }, 'wa.boss.sent');
  const sent = !!e.toBoss && e.toBoss.orderId === e.orderId;
  return (
    <Stack gap={6}>
      <Button
        fullWidth
        color="green"
        variant={sent ? 'light' : 'filled'}
        leftSection={sent ? <IconCheck size={18} /> : <IconBrandWhatsapp size={18} />}
        disabled={!e.orderId}
        loading={busy}
        data-boss-send
        onClick={() => (boss.to ? void send() : setPicking(true))}
      >
        {sent ? t('wa.boss.sentAt', { time: formatDateTime(e.toBoss!.at) }) : t('wa.boss.send')}
      </Button>
      {!e.orderId && (
        <Text size="sm" c="dimmed" ta="center">
          {t('wa.boss.pickJob')}
        </Text>
      )}
      <ChatPicker
        opened={picking}
        onClose={() => setPicking(false)}
        kind="person"
        title={t('ownerCheck.pickOwner')}
        onPick={(to) => {
          // The boss's chat from now on; its reports are not turned on from here.
          void saveWaAuto('boss', settings.waAuto?.boss?.on === undefined ? { to, on: false } : { to });
          setPicking(false);
          void send(to);
        }}
      />
    </Stack>
  );
}
