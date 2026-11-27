import { ActionIcon, Button, Text } from '@mantine/core';
import { IconReceipt, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import { waDigits } from '../../domain/whatsapp';
import { acceptPaymentShot, dismissPaymentShot, paymentShotOf, type PaymentShotProposal } from '../../services/paymentShot';
import { onWaEvent, waFileSrc } from '../../services/whatsapp';
import { ListRow, Money } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import { celebrate } from '../../ui/motion';

/**
 * «Перевод · 1 250.00 → Записать» (audit 27/11): while the job owes, the customer's newest picture in WhatsApp after the
 * invoice, read once by the garage's AI (services/paymentShot.ts) — a proposal; the manager's tap records the payment with
 * the screenshot as its proof, × — not this picture. Read when the job opens, when the customer sends something, and
 * every two minutes.
 */
export function PaymentShotRow({ orderId, phone, dueFils }: { orderId: string; phone?: string; dueFils: number }) {
  const { t } = useTranslation();
  const { run, busy } = useAction({ exclusive: true });
  const [p, setP] = useState<PaymentShotProposal>();
  const [pic, setPic] = useState(true);
  useEffect(() => {
    let alive = true;
    const read = () => void paymentShotOf(orderId).then((x) => alive && setP(x));
    read();
    const every = window.setInterval(read, 120_000);
    const digits = waDigits(phone);
    const off = onWaEvent((ev) => {
      if (ev.t === 'msg' && !ev.msg.me && digits && ev.chat?.phone === digits) window.setTimeout(read, 2000);
    });
    return () => {
      alive = false;
      window.clearInterval(every);
      off();
    };
    // What is due changed (a payment typed in by hand): read again — the proposal follows it.
  }, [orderId, phone, dueFils]);
  if (!p || !(dueFils > 0)) return null;
  const src = pic && !p.mime?.includes('pdf') ? waFileSrc(p.msgId) : undefined;
  return (
    <ListRow
      left={
        src ? (
          <img src={src} alt="" width={40} height={40} onError={() => setPic(false)} style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', display: 'block' }} />
        ) : (
          <IconReceipt size={20} stroke={1.9} color="var(--mantine-color-green-6)" aria-hidden />
        )
      }
      title={
        <Text span inherit fw={600} data-pay-shot={p.method}>
          <Money fils={Math.min(p.amountFils, dueFils)} />
        </Text>
      }
      // The reference number goes with the payment (its «Учёт» line), not here: the way, the day, the bank.
      subtitle={[t(`payShot.${p.method}`), formatDate(p.date).slice(0, 5), p.bank, p.shotFils > p.amountFils ? t('payShot.onShot', { sum: formatAed(p.shotFils) }) : ''].filter(Boolean).join(' · ')}
      right={
        <>
          <Button
            size="compact-md"
            variant="light"
            color="green"
            disabled={busy}
            data-pay-shot-go
            onClick={() =>
              run(async () => {
                const r = await acceptPaymentShot(p);
                setP(undefined);
                if (r?.paidFull) celebrate(t('payment.paidFull'));
                else haptic('success');
              }, 'payShot.saved')
            }
          >
            {t('payShot.record')}
          </Button>
          <ActionIcon variant="subtle" color="gray" size={30} radius="xl" aria-label={t('today.notNeeded')} onClick={() => run(async () => (await dismissPaymentShot(orderId, p.msgId), setP(undefined)))}>
            <IconX size={16} />
          </ActionIcon>
        </>
      }
    />
  );
}
