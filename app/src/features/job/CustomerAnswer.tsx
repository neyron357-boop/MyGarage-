import { ActionIcon, Button, Text } from '@mantine/core';
import { IconMessageCheck, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dubaiTime } from '../../domain/dates';
import { waDigits } from '../../domain/whatsapp';
import { acceptCustomerAnswer, customerAnswerOf, dismissCustomerAnswer, type AnswerProposal } from '../../services/customerReply';
import { onWaEvent } from '../../services/whatsapp';
import { ListRow } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';

/**
 * «Клиент: «ok, go ahead» → Согласовать» (audit 27/11): while the job waits for the customer, their newest WhatsApp words
 * after the quote, read by the rules (services/customerReply.ts) — a proposal; the manager's tap records it (with the words
 * and their time), × — not this message. Read when the job opens, when the customer writes, and every minute.
 */
export function CustomerAnswerRow({ orderId, phone }: { orderId: string; phone?: string }) {
  const { t } = useTranslation();
  const { run, busy } = useAction({ exclusive: true });
  const [p, setP] = useState<AnswerProposal>();
  useEffect(() => {
    let alive = true;
    const read = () => void customerAnswerOf(orderId).then((x) => alive && setP(x));
    read();
    const every = window.setInterval(read, 60_000);
    const digits = waDigits(phone);
    const off = onWaEvent((ev) => {
      if (ev.t === 'msg' && !ev.msg.me && digits && ev.chat?.phone === digits) window.setTimeout(read, 1500);
    });
    return () => {
      alive = false;
      window.clearInterval(every);
      off();
    };
  }, [orderId, phone]);
  if (!p) return null;
  const what =
    p.answer.kind === 'all'
      ? t('answer.all')
      : p.answer.kind === 'none'
        ? t('answer.none')
        : p.answer.kind === 'option'
          ? t('answer.option', { n: p.answer.option })
          : t('answer.some', { agree: p.agree.length, refuse: p.refuse.length });
  return (
    <ListRow
      left={<IconMessageCheck size={20} stroke={1.9} color="var(--mantine-color-green-6)" aria-hidden />}
      title={
        <Text span inherit data-customer-answer={p.answer.kind}>
          «{p.text}»
        </Text>
      }
      subtitle={`${dubaiTime(new Date(p.at).toISOString())} · ${what}`}
      right={
        <>
          <Button
            size="compact-md"
            variant="light"
            color={p.answer.kind === 'none' ? 'red' : 'green'}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await acceptCustomerAnswer(p);
                haptic('success');
                setP(undefined);
              })
            }
          >
            {p.answer.kind === 'none' ? t('answer.refuse') : p.answer.kind === 'all' ? t('answer.agree') : t('answer.record', { what })}
          </Button>
          <ActionIcon variant="subtle" color="gray" size={36} radius="xl" aria-label={t('today.notNeeded')} onClick={() => run(async () => (await dismissCustomerAnswer(orderId, p.msgId), setP(undefined)))}>
            <IconX size={16} />
          </ActionIcon>
        </>
      }
    />
  );
}
