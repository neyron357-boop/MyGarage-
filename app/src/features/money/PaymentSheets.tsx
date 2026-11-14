import { Alert, Button, Group, Modal, SegmentedControl, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconBuildingBank, IconCash, IconCreditCard, IconSignature, type Icon } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, dubaiDate, nowIso } from '../../domain/dates';
import { liveLines } from '../../domain/flow';
import { itemAmounts } from '../../domain/items';
import { formatAed } from '../../domain/money';
import type { PayMethod, Payment } from '../../domain/types';
import { leaveOnDebt } from '../../services/flow';
import { addPayment } from '../../services/money';
import { bundleAmountDue, type OrderBundle } from '../../services/orders';
import { haptic } from '../../ui/haptics';
import { celebrate } from '../../ui/motion';
import { Money, MoneyInput, SelectCard } from '../../ui/components';
import { DateField } from '../../ui/DateFields';
import { useAction } from '../../ui/hooks';
import { SignatureBox, type SignatureHandle } from '../../ui/SignatureBox';

const METHOD_ICON: Record<PayMethod, Icon> = { cash: IconCash, card: IconCreditCard, transfer: IconBuildingBank };

/** Money in or back on a job: a payment, an advance or a refund (the job's "Pay", its "…" → "Prepayment"). */
export function PaymentModal({ b, opened, onClose, kind: initialKind }: { b: OrderBundle; opened: boolean; onClose: () => void; kind?: Payment['kind'] }) {
  const { t } = useTranslation();
  const { run, busy } = useAction({ exclusive: true });
  const due = bundleAmountDue(b);
  const [kind, setKind] = useState<Payment['kind']>(initialKind ?? 'payment');
  const [method, setMethod] = useState<PayMethod>('cash');
  // An advance is usually for the parts: their price is suggested (the customer pays it before they are ordered).
  const partsGross = liveLines(b.items).filter((i) => i.kind === 'part' && !i.customerSupplied).reduce((s, i) => s + itemAmounts(i).gross, 0);
  const [amount, setAmount] = useState<number | undefined>(
    (initialKind ?? 'payment') === 'payment' ? (due > 0 ? due : undefined) : initialKind === 'prepayment' && partsGross > 0 && !b.payments.length ? partsGross : undefined,
  );
  const [reference, setReference] = useState('');
  // Paid in full: the moment gets its mark (instead of a banner); a part payment — the usual banner.
  const full = kind !== 'refund' && due > 0 && (amount ?? 0) >= due;
  const save = () =>
    run(
      async () => {
        await addPayment(b.order.id, { kind, method, amountFils: amount ?? 0, reference });
        if (full) {
          haptic('success');
          celebrate(t('payment.paidFull'));
        }
        onClose();
      },
      full ? undefined : 'payment.saved',
    );
  return (
    <Modal opened={opened} onClose={onClose} title={t(`payment.kind.${kind}`)}>
      <Stack gap="md">
        <SegmentedControl
          fullWidth
          value={kind}
          onChange={(v) => setKind(v as Payment['kind'])}
          color={kind === 'refund' ? 'red' : undefined}
          data={(['payment', 'prepayment', 'refund'] as const).map((k) => ({ value: k, label: t(`payment.kind.${k}`) }))}
        />
        {/* The sum first and large, as a bank app asks it; the amount due is already in (no keyboard over the
            button unless there is nothing to suggest), the whole of it one tap away when another was typed. */}
        <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} autoFocus={!amount} required big />
        {due > 0 && kind !== 'refund' && amount !== due && (
          <Group justify="center" mt={-8}>
            <Button size="compact-md" variant="light" radius="xl" onClick={() => setAmount(due)}>
              <span>{t('payment.fullDue')}</span>
              <span style={{ margin: '0 6px', opacity: 0.6 }}>·</span>
              <Money fils={due} />
            </Button>
          </Group>
        )}
        <SimpleGrid cols={3} spacing="xs">
          {(['cash', 'card', 'transfer'] as const).map((m) => {
            const I = METHOD_ICON[m];
            return (
              <SelectCard key={m} active={method === m} onClick={() => setMethod(m)}>
                <Stack gap={4} align="center">
                  <I size={22} stroke={1.7} />
                  <Text size="sm" fw={600}>
                    {t(`payment.method.${m}`)}
                  </Text>
                </Stack>
              </SelectCard>
            );
          })}
        </SimpleGrid>
        {method !== 'cash' && <TextInput label={t('payment.reference')} value={reference} onChange={(e) => setReference(e.currentTarget.value)} />}
        {/* Money in is green (as the job's "Pay" that opened the sheet), money back to the customer red. */}
        <Button size="lg" onClick={save} loading={busy} disabled={!amount} color={kind === 'refund' ? 'red' : 'green'}>
          {t('payment.save')}
          {!!amount && ` · ${formatAed(amount)}`}
        </Button>
      </Stack>
    </Modal>
  );
}

/**
 * The car leaves now, the money comes later: the customer signs for the sum and the date, and the job is
 * handed over with the debt (`leaveOnDebt`) — red on the board until it is paid.
 */
export function DebtModal({ b, opened, onClose }: { b: OrderBundle; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction({ exclusive: true });
  const sig = useRef<SignatureHandle>(null);
  const due = bundleAmountDue(b);
  const [amount, setAmount] = useState<number | undefined>(due);
  const [date, setDate] = useState(dubaiDate(addDays(nowIso(), 7)));
  const save = () =>
    run(async () => {
      if (!sig.current || sig.current.isEmpty()) throw new Error(t('sign.required'));
      await leaveOnDebt(b.order.id, { amountFils: amount ?? 0, dueDate: date, signature: sig.current.toBlob() });
      haptic('success');
      onClose();
    }, 'debt.saved');
  return (
    <Modal opened={opened} onClose={onClose} title={t('debt.title')} size="lg">
      <Stack>
        <Alert color="orange">{t('debt.explain', { name: b.customer.name })}</Alert>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} required />
          <DateField label={t('debt.dueDate')} value={date} onChange={setDate} />
        </SimpleGrid>
        <Text size="sm" fw={600}>
          {t('debt.customerSigns')}
        </Text>
        <SignatureBox ref={sig} height={170} />
        <Button onClick={save} loading={busy} leftSection={<IconSignature size={18} />}>
          {t('debt.sign')}
        </Button>
      </Stack>
    </Modal>
  );
}
