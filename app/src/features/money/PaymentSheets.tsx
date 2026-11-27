import { Button, Group, Modal, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconBuildingBank, IconCash, IconCashOff, IconCreditCard, IconSignature, IconUserDollar, type Icon } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, dubaiDate, nowIso } from '../../domain/dates';
import { liveLines } from '../../domain/flow';
import { activeInvoice } from '../../domain/invoice';
import { paymentDayFor } from '../../domain/jobDay';
import { itemAmounts } from '../../domain/items';
import { formatAed } from '../../domain/money';
import { canCloseUnpaid } from '../../domain/stages';
import type { PayMethod, Payment } from '../../domain/types';
import { removeEntry } from '../../services/entries';
import { canLeaveOnDebt, closeUnpaid, leaveOnDebt } from '../../services/flow';
import { addPayment, lastPayMethod } from '../../services/money';
import { bundleAmountDue, type OrderBundle } from '../../services/orders';
import { haptic } from '../../ui/haptics';
import { celebrate } from '../../ui/motion';
import { Money, MoneyInput, SelectCard, undoToast } from '../../ui/components';
import { DateField, DayPill } from '../../ui/DateFields';
import { useAction } from '../../ui/hooks';
import { SignatureBox, type SignatureHandle } from '../../ui/SignatureBox';

/**
 * How the job is settled: paid (cash, card, transfer), paid to the garage's owner (`closeUnpaid(…, 'owner')`), left on
 * credit — the car goes, the customer signs for the sum and the date (`leaveOnDebt`; the job then waits under "Debts" in
 * Money), a part paid now and the rest on credit in the same sheet — or closed with no money at all (`closeUnpaid`).
 */
type Way = PayMethod | 'owner' | 'debt' | 'unpaid';
const WAY_ICON: Record<Way, Icon> = { cash: IconCash, card: IconCreditCard, transfer: IconBuildingBank, outside: IconUserDollar, owner: IconUserDollar, debt: IconSignature, unpaid: IconCashOff };
const PAY_METHODS: PayMethod[] = ['cash', 'card', 'transfer'];

function WayCard({ way, active, onClick }: { way: Way; active: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const I = WAY_ICON[way];
  return (
    <SelectCard active={active} onClick={onClick}>
      <Stack gap={4} align="center">
        <I size={22} stroke={1.7} />
        <Text size="sm" fw={600}>
          {way === 'owner' ? t('payment.owner') : t(`payment.method.${way}`)}
        </Text>
      </Stack>
    </SelectCard>
  );
}

/** The last day of the month the date is in (YYYY-MM-DD). */
const monthEnd = (day: string) => {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * Money in or back on a job: a payment, an advance or a refund (the job's "Pay", its "…" → "Prepayment" / "Refund") — or
 * the car on credit, or closed unpaid.
 *
 * v0.99 (audit С29–С36): the button says the way («Наличные · 351,75»), the customer's way last time is chosen first;
 * cash over the sum due is change (only the sum due is recorded); another way over it asks a second tap; «Отменить»
 * after every payment; «Главному» is a way of its own beside the money; «Без оплаты» is only «no money», and nothing is
 * picked for it beforehand; on credit, a part can be paid now — the rest is the debt, not typed; the due day by chips.
 */
export function PaymentModal({ b, opened, onClose, kind: initialKind }: { b: OrderBundle; opened: boolean; onClose: () => void; kind?: Payment['kind'] }) {
  const { t } = useTranslation();
  const { run, busy } = useAction({ exclusive: true });
  const due = bundleAmountDue(b);
  const kind: Payment['kind'] = initialKind ?? 'payment';
  const [way, setWay] = useState<Way>('cash');
  const picked = useRef(false);
  const pick = (w: Way) => {
    picked.current = true;
    setOver(false);
    setWay(w);
  };
  // The way this customer paid last time (a card customer is not put on cash silently).
  useEffect(() => {
    if (!opened || kind === 'refund') return;
    let gone = false;
    void lastPayMethod(b.order.customerId).then((m) => {
      if (!gone && m && !picked.current) setWay(m);
    });
    return () => {
      gone = true;
    };
  }, [opened, kind, b.order.customerId]);
  // An advance is usually for the parts: their price is suggested (the customer pays it before they are ordered).
  const partsGross = liveLines(b.items).filter((i) => i.kind === 'part' && !i.customerSupplied).reduce((s, i) => s + itemAmounts(i).gross, 0);
  const [amount, setAmount] = useState<number | undefined>(kind === 'payment' ? (due > 0 ? due : undefined) : kind === 'prepayment' && partsGross > 0 && !b.payments.length ? partsGross : undefined);
  const [reference, setReference] = useState('');
  // The day it was paid: today, or an earlier one (v0.23 — a payment typed in a day late).
  // A job typed in later (v0.53): its invoice's day.
  const [date, setDate] = useState(() => paymentDayFor(b.order, activeInvoice(b.invoices) ?? undefined));
  const [dueDate, setDueDate] = useState(dubaiDate(addDays(nowIso(), 7)));
  // On credit: what is paid now (the rest is the debt) and how.
  const [now, setNow] = useState<number | undefined>(undefined);
  const [nowWay, setNowWay] = useState<PayMethod>('card');
  // More than due by another way than cash: the second tap says it is right.
  const [over, setOver] = useState(false);
  const sig = useRef<SignatureHandle>(null);
  // Beside the payment: the owner, the car on credit, no money — only where the job allows them.
  const unpaidOk = kind === 'payment' && canCloseUnpaid(b.order.stage, due);
  const debtOk = kind === 'payment' && canLeaveOnDebt(b);
  const methods: Way[] = [...PAY_METHODS, ...(unpaidOk ? (['owner'] as const) : [])];
  const others: Way[] = [...(debtOk ? (['debt'] as const) : []), ...(unpaidOk ? (['unpaid'] as const) : [])];
  const settle: Way = [...methods, ...others].includes(way) ? way : 'cash';
  const method = PAY_METHODS.includes(settle as PayMethod) ? (settle as PayMethod) : null;
  // Cash over the sum due: change, the sum due recorded. Another way over it: a second tap.
  const change = kind === 'payment' && method === 'cash' && due > 0 && (amount ?? 0) > due ? (amount ?? 0) - due : 0;
  const overBy = kind === 'payment' && method && method !== 'cash' && due > 0 && (amount ?? 0) > due ? (amount ?? 0) - due : 0;
  const recorded = change ? due : amount ?? 0;
  // Paid in full: the moment gets its mark (instead of a banner); a part payment — the usual banner.
  const full = kind !== 'refund' && due > 0 && recorded >= due;
  const rest = Math.max(0, due - (now ?? 0));
  const undoPayment = (p: Payment) =>
    undoToast(t('payment.recorded', { sum: formatAed(p.amountFils), way: t(`payment.method.${p.method}`) }), t('common.undo'), () => void removeEntry({ source: 'payment', id: p.id }));
  const save = () => {
    if (settle === 'debt')
      return run(async () => {
        if (!sig.current || sig.current.isEmpty()) throw new Error(t('sign.required'));
        if ((now ?? 0) >= due) throw new Error(t('payment.nowTooMuch'));
        if (now && now > 0) await addPayment(b.order.id, { kind: 'payment', method: nowWay, amountFils: now, date });
        await leaveOnDebt(b.order.id, { amountFils: rest, dueDate, signature: sig.current.toBlob() });
        haptic('success');
        onClose();
      }, 'debt.saved');
    if (settle === 'owner' || settle === 'unpaid')
      return run(
        async () => {
          await closeUnpaid(b.order.id, settle === 'owner' ? 'owner' : undefined);
          haptic('success');
          onClose();
        },
        settle === 'owner' ? 'payment.closedOwner' : 'payment.closedUnpaid',
      );
    if (overBy && !over) {
      setOver(true);
      haptic('warning');
      return;
    }
    return run(async () => {
      const p = await addPayment(b.order.id, { kind, method: method ?? 'cash', amountFils: recorded, reference, date });
      if (full) {
        haptic('success');
        celebrate(t('payment.paidFull'));
      }
      onClose();
      undoPayment(p);
    });
  };
  const amountShown = settle === 'owner' || settle === 'unpaid' ? due : settle === 'debt' ? rest : amount;
  const dayChips = [
    { key: 'd7', day: dubaiDate(addDays(nowIso(), 7)) },
    { key: 'd14', day: dubaiDate(addDays(nowIso(), 14)) },
    { key: 'd30', day: dubaiDate(addDays(nowIso(), 30)) },
    { key: 'end', day: monthEnd(dubaiDate()) },
  ];
  const label =
    settle === 'debt'
      ? t('debt.give')
      : settle === 'owner'
        ? t('payment.closeOwner')
        : settle === 'unpaid'
          ? t('payment.closeNoMoney')
          : kind === 'payment' && method
            ? `${t(`payment.by.${method}`)}${recorded ? ` · ${formatAed(recorded)}` : ''}`
            : `${t(`payment.kind.${kind}`)}${recorded ? ` · ${formatAed(recorded)}` : ''}`;
  const I = WAY_ICON[settle];
  return (
    <Modal opened={opened} onClose={onClose} title={`${t(`payment.kind.${kind}`)} · ${t('payment.jobNo', { n: b.order.number })}`}>
      <Stack gap="md">
        {/* The sum first and large, as a bank app asks it; the amount due is already in (no keyboard over the
            button unless there is nothing to suggest), the whole of it one tap away when another was typed.
            Closed (owner / no money) or on credit: the sum let go or owed, as it is. */}
        <MoneyInput
          label={settle === 'debt' ? t('payment.method.debt') : t('common.amount')}
          value={amountShown}
          onChange={(v) => (setOver(false), setAmount(v))}
          autoFocus={!amount}
          required
          big
          readOnly={settle === 'owner' || settle === 'unpaid' || settle === 'debt'}
        />
        {due > 0 && kind !== 'refund' && method && amount !== due && (
          <Group justify="center" mt={-8}>
            <Button size="compact-md" variant="light" radius="xl" onClick={() => (setOver(false), setAmount(due))}>
              <span>{t('payment.fullDue')}</span>
              <span style={{ margin: '0 6px', opacity: 0.6 }}>·</span>
              <Money fils={due} />
            </Button>
          </Group>
        )}
        {change > 0 && (
          <Text ta="center" fw={700} c="green" mt={-6} data-pay-change>
            {t('payment.change', { sum: formatAed(change) })}
          </Text>
        )}
        {overBy > 0 && (
          <Text ta="center" fw={600} c="orange" size="sm" mt={-6} data-pay-over>
            {t('payment.over', { sum: formatAed(overBy) })}
          </Text>
        )}
        <SimpleGrid cols={methods.length} spacing="xs">
          {methods.map((m) => (
            <WayCard key={m} way={m} active={settle === m} onClick={() => pick(m)} />
          ))}
        </SimpleGrid>
        {others.length > 0 && (
          <SimpleGrid cols={others.length} spacing="xs" className="pay-others">
            {others.map((m) => (
              <WayCard key={m} way={m} active={settle === m} onClick={() => pick(m)} />
            ))}
          </SimpleGrid>
        )}
        {method && (
          <Group gap="xs">
            <DayPill value={date} onChange={setDate} />
          </Group>
        )}
        {(settle === 'card' || settle === 'transfer') && <TextInput label={t('payment.reference')} value={reference} onChange={(e) => setReference(e.currentTarget.value)} />}
        {settle === 'debt' && (
          <>
            {/* A part now (card, cash, transfer), the rest on credit — one sheet, one signature. */}
            <div>
              <MoneyInput label={t('payment.now')} value={now} onChange={setNow} />
              {!!now && (
                <div className="chip-row wrap" style={{ marginTop: 8 }}>
                  {PAY_METHODS.map((m) => (
                    <button key={m} type="button" className="chip" data-active={nowWay === m} onClick={() => setNowWay(m)}>
                      {t(`payment.method.${m}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <DateField label={t('debt.dueDate')} value={dueDate} onChange={setDueDate} />
              <div className="chip-row wrap" style={{ marginTop: 8 }}>
                {dayChips.map((c) => (
                  <button key={c.key} type="button" className="chip" data-active={dueDate === c.day} onClick={() => setDueDate(c.day)}>
                    {t(`payment.dueIn.${c.key}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Text size="sm" fw={600} mb={6}>
                {t('debt.customerSigns')}
              </Text>
              <SignatureBox ref={sig} height={150} />
            </div>
          </>
        )}
        {/* Money in is green (as the job's "Pay" that opened the sheet), money back to the customer red; the car on
            credit, paid to the owner or let go unpaid — orange, as its step and its debt. */}
        <Button
          size="lg"
          onClick={() => void save()}
          loading={busy}
          disabled={settle === 'debt' ? rest <= 0 : method ? !amount : false}
          color={kind === 'refund' ? 'red' : over ? 'orange' : method ? 'green' : 'orange'}
          leftSection={<I size={20} />}
          data-pay-save
        >
          {label}
        </Button>
      </Stack>
    </Modal>
  );
}
