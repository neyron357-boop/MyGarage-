import { Button, Group, Modal, SegmentedControl, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconBuildingBank, IconCash, IconCashOff, IconCreditCard, IconSignature, IconUserDollar, type Icon } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, dubaiDate, nowIso } from '../../domain/dates';
import { liveLines } from '../../domain/flow';
import { itemAmounts } from '../../domain/items';
import { formatAed } from '../../domain/money';
import { canCloseUnpaid } from '../../domain/stages';
import type { PayMethod, Payment } from '../../domain/types';
import { canLeaveOnDebt, closeUnpaid, leaveOnDebt } from '../../services/flow';
import { addPayment } from '../../services/money';
import { bundleAmountDue, type OrderBundle } from '../../services/orders';
import { haptic } from '../../ui/haptics';
import { celebrate } from '../../ui/motion';
import { Money, MoneyInput, SelectCard } from '../../ui/components';
import { DateField, DayPill } from '../../ui/DateFields';
import { useAction } from '../../ui/hooks';
import { SignatureBox, type SignatureHandle } from '../../ui/SignatureBox';

/**
 * How the job is settled: paid (cash, card, transfer), left on credit — the car goes, the customer signs for the
 * sum and the date (`leaveOnDebt`; the job then waits under "Debts" in Money) — or closed with nothing to pay
 * (`closeUnpaid`: paid to the garage's owner, or no money at all).
 */
type Way = PayMethod | 'debt' | 'unpaid';
const WAY_ICON: Record<Way, Icon> = { cash: IconCash, card: IconCreditCard, transfer: IconBuildingBank, outside: IconUserDollar, debt: IconSignature, unpaid: IconCashOff };
const PAY_METHODS: PayMethod[] = ['cash', 'card', 'transfer'];

function WayCard({ way, active, onClick }: { way: Way; active: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const I = WAY_ICON[way];
  return (
    <SelectCard active={active} onClick={onClick}>
      <Stack gap={4} align="center">
        <I size={22} stroke={1.7} />
        <Text size="sm" fw={600}>
          {t(`payment.method.${way}`)}
        </Text>
      </Stack>
    </SelectCard>
  );
}

/** Money in or back on a job: a payment, an advance or a refund (the job's "Pay", its "…" → "Prepayment") — or the car on credit, or closed unpaid. */
export function PaymentModal({ b, opened, onClose, kind: initialKind }: { b: OrderBundle; opened: boolean; onClose: () => void; kind?: Payment['kind'] }) {
  const { t } = useTranslation();
  const { run, busy } = useAction({ exclusive: true });
  const due = bundleAmountDue(b);
  const [kind, setKind] = useState<Payment['kind']>(initialKind ?? 'payment');
  const [way, setWay] = useState<Way>('cash');
  // An advance is usually for the parts: their price is suggested (the customer pays it before they are ordered).
  const partsGross = liveLines(b.items).filter((i) => i.kind === 'part' && !i.customerSupplied).reduce((s, i) => s + itemAmounts(i).gross, 0);
  const [amount, setAmount] = useState<number | undefined>(
    (initialKind ?? 'payment') === 'payment' ? (due > 0 ? due : undefined) : initialKind === 'prepayment' && partsGross > 0 && !b.payments.length ? partsGross : undefined,
  );
  const [reference, setReference] = useState('');
  // The day it was paid: today, or an earlier one (v0.23 — a payment typed in a day late).
  const [date, setDate] = useState(dubaiDate());
  const [dueDate, setDueDate] = useState(dubaiDate(addDays(nowIso(), 7)));
  const [owner, setOwner] = useState(true);
  const sig = useRef<SignatureHandle>(null);
  // Beside the payment: the car on credit, or no payment at all — only where the job allows them.
  const others: Way[] = kind === 'payment' ? [...(canLeaveOnDebt(b) ? (['debt'] as const) : []), ...(canCloseUnpaid(b.order.stage, due) ? (['unpaid'] as const) : [])] : [];
  const settle = others.includes(way) ? way : PAY_METHODS.includes(way as PayMethod) ? way : 'cash';
  // Paid in full: the moment gets its mark (instead of a banner); a part payment — the usual banner.
  const full = kind !== 'refund' && due > 0 && (amount ?? 0) >= due;
  const save = () => {
    if (settle === 'debt')
      return run(async () => {
        if (!sig.current || sig.current.isEmpty()) throw new Error(t('sign.required'));
        await leaveOnDebt(b.order.id, { amountFils: amount ?? 0, dueDate, signature: sig.current.toBlob() });
        haptic('success');
        onClose();
      }, 'debt.saved');
    if (settle === 'unpaid')
      return run(async () => {
        await closeUnpaid(b.order.id, owner ? 'owner' : undefined);
        haptic('success');
        onClose();
      }, 'payment.closedUnpaid');
    return run(
      async () => {
        await addPayment(b.order.id, { kind, method: settle as PayMethod, amountFils: amount ?? 0, reference, date });
        if (full) {
          haptic('success');
          celebrate(t('payment.paidFull'));
        }
        onClose();
      },
      full ? undefined : 'payment.saved',
    );
  };
  const amountShown = settle === 'unpaid' ? due : amount;
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
            button unless there is nothing to suggest), the whole of it one tap away when another was typed.
            Closed unpaid: the sum let go, as it is. */}
        <MoneyInput label={t('common.amount')} value={amountShown} onChange={setAmount} autoFocus={!amount} required big readOnly={settle === 'unpaid'} />
        {due > 0 && kind !== 'refund' && settle !== 'unpaid' && amount !== due && (
          <Group justify="center" mt={-8}>
            <Button size="compact-md" variant="light" radius="xl" onClick={() => setAmount(due)}>
              <span>{t('payment.fullDue')}</span>
              <span style={{ margin: '0 6px', opacity: 0.6 }}>·</span>
              <Money fils={due} />
            </Button>
          </Group>
        )}
        <SimpleGrid cols={3} spacing="xs">
          {PAY_METHODS.map((m) => (
            <WayCard key={m} way={m} active={settle === m} onClick={() => setWay(m)} />
          ))}
        </SimpleGrid>
        {others.length > 0 && (
          <SimpleGrid cols={others.length} spacing="xs" className="pay-others">
            {others.map((m) => (
              <WayCard key={m} way={m} active={settle === m} onClick={() => setWay(m)} />
            ))}
          </SimpleGrid>
        )}
        {PAY_METHODS.includes(settle as PayMethod) && (
          <Group gap="xs">
            <DayPill value={date} onChange={setDate} />
          </Group>
        )}
        {(settle === 'card' || settle === 'transfer') && <TextInput label={t('payment.reference')} value={reference} onChange={(e) => setReference(e.currentTarget.value)} />}
        {settle === 'debt' && (
          <>
            <DateField label={t('debt.dueDate')} value={dueDate} onChange={setDueDate} />
            <div>
              <Text size="sm" fw={600} mb={6}>
                {t('debt.customerSigns')}
              </Text>
              <SignatureBox ref={sig} height={150} />
            </div>
          </>
        )}
        {settle === 'unpaid' && (
          // The usual case first: the customer paid the garage's owner. Nothing goes into the cash either way.
          <div className="chip-row wrap" aria-label={t('payment.method.unpaid')}>
            <button type="button" className="chip" data-active={owner} onClick={() => setOwner(true)}>
              {t('job.paidOwner')}
            </button>
            <button type="button" className="chip" data-active={!owner} onClick={() => setOwner(false)}>
              {t('job.noMoney')}
            </button>
          </div>
        )}
        {/* Money in is green (as the job's "Pay" that opened the sheet), money back to the customer red; the car on
            credit or let go unpaid — orange, as its step and its debt. */}
        <Button
          size="lg"
          onClick={() => void save()}
          loading={busy}
          disabled={settle !== 'unpaid' && !amount}
          color={kind === 'refund' ? 'red' : settle === 'debt' || settle === 'unpaid' ? 'orange' : 'green'}
          leftSection={settle === 'debt' ? <IconSignature size={20} /> : undefined}
        >
          {settle === 'debt' ? t('debt.give') : settle === 'unpaid' ? t('payment.closeUnpaid') : t('payment.save')}
          {settle !== 'unpaid' && !!amount && ` · ${formatAed(amount)}`}
        </Button>
      </Stack>
    </Modal>
  );
}
