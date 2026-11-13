import { ActionIcon, Alert, Badge, Box, Button, Group, Modal, SegmentedControl, SimpleGrid, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import {
  IconArrowBackUp,
  IconBuildingBank,
  IconCash,
  IconCreditCard,
  IconFileInvoice,
  IconFileTypePdf,
  IconReceipt2,
  IconSend,
  IconSignature,
  type Icon,
} from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, dubaiDate, formatDate, formatDateTime, nowIso } from '../../domain/dates';
import { liveLines } from '../../domain/flow';
import { activeInvoice, chooseInvoiceType, paidNet } from '../../domain/invoice';
import { itemAmounts, summarize } from '../../domain/items';
import { formatAed } from '../../domain/money';
import type { InvoiceType, PayMethod, Payment } from '../../domain/types';
import { debtPdf, invoicePdf, openPdf, receiptPdf } from '../../services/documents';
import { simpleMessage } from '../../services/messages';
import { addPayment, createDebt, issueCreditNote, issueInvoice } from '../../services/money';
import { bundleAmountDue, type OrderBundle } from '../../services/orders';
import { haptic } from '../../ui/haptics';
import { celebrate } from '../../ui/motion';
import { ConfirmModal, List, ListRow, Money, MoneyInput, Section, SelectCard } from '../../ui/components';
import { DateField } from '../../ui/DateFields';
import { useAction } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { SignatureBox, type SignatureHandle } from '../../ui/SignatureBox';

const METHOD_ICON: Record<PayMethod, Icon> = { cash: IconCash, card: IconCreditCard, transfer: IconBuildingBank };

export function PaymentModal({ b, opened, onClose, kind: initialKind }: { b: OrderBundle; opened: boolean; onClose: () => void; kind?: Payment['kind'] }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
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

function DebtModal({ b, opened, onClose }: { b: OrderBundle; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const sig = useRef<SignatureHandle>(null);
  const due = bundleAmountDue(b);
  const [amount, setAmount] = useState<number | undefined>(due);
  const [date, setDate] = useState(dubaiDate(addDays(nowIso(), 7)));
  const save = () =>
    run(async () => {
      if (!sig.current || sig.current.isEmpty()) throw new Error(t('sign.required'));
      await createDebt(b.order.id, amount ?? 0, date, sig.current.toBlob());
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

export function PaymentPanel({ b, allowDebt }: { b: OrderBundle; allowDebt?: boolean }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [payOpen, setPayOpen] = useState<Payment['kind'] | null>(null);
  const [debtOpen, setDebtOpen] = useState(false);
  const [send, setSend] = useState<SendRequest | null>(null);
  const [creditOpen, setCreditOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [creditReason, setCreditReason] = useState('');
  const sum = summarize(b.items);
  const inv = activeInvoice(b.invoices);
  const paid = paidNet(b.payments);
  const due = bundleAmountDue(b);
  const [invType, setInvType] = useState<Exclude<InvoiceType, 'credit_note'>>(chooseInvoiceType(b.customer));
  const openDebt = b.debts.find((d) => d.status === 'open');
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
  const hasApproved = b.items.some((i) => i.approvalState === 'approved');

  const sendInvoice = (invoiceId: string, number: string, total: number) =>
    setSend({
      text: simpleMessage('invoice', ctx, b.order.docLanguage, { invoice: number, amount: (total / 100).toFixed(2) + ' AED' }),
      template: 'invoice',
      lang: b.order.docLanguage,
      orderId: b.order.id,
      pdf: () => invoicePdf(invoiceId),
    });

  return (
    <Stack gap="lg">
      <Box className="surface" p="md">
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
          <div className="amount-cell">
            <div className="eyebrow">{t('payment.approvedTotal')}</div>
            <Text fz={20} mt={2}>
              <Money fils={sum.approvedGross} display />
            </Text>
          </div>
          <div className="amount-cell">
            <div className="eyebrow">{inv ? inv.number : t('payment.invoiceTotal')}</div>
            <Text fz={20} mt={2} c={inv ? undefined : 'dimmed'}>
              {inv ? <Money fils={inv.totalFils} display /> : '—'}
            </Text>
          </div>
          <div className="amount-cell">
            <div className="eyebrow">{t('payment.paid')}</div>
            <Text fz={20} mt={2}>
              <Money fils={paid} display />
            </Text>
          </div>
          <div className="amount-cell">
            <div className="eyebrow">{due >= 0 ? t('payment.due') : t('payment.overpaid')}</div>
            <Text fz={26} mt={0} c={due > 0 ? 'red' : 'green'}>
              <Money fils={Math.abs(due)} display />
            </Text>
          </div>
        </SimpleGrid>
        {openDebt && (
          <Badge color="red" mt="md" size="lg">
            {t('debt.open', { date: formatDate(openDebt.dueDate) })} · <Money fils={openDebt.amountFils} />
          </Badge>
        )}
        <Stack mt="md" gap="xs">
          <Button fullWidth leftSection={<IconCash size={18} />} onClick={() => setPayOpen('payment')} disabled={due <= 0 && hasApproved}>
            {t('payment.accept')}
          </Button>
          <Group gap={6} wrap="wrap">
            <Button size="compact-md" variant="default" onClick={() => setPayOpen('prepayment')}>
              {t('payment.kind.prepayment')}
            </Button>
            <Button size="compact-md" variant="default" leftSection={<IconArrowBackUp size={16} />} onClick={() => setPayOpen('refund')}>
              {t('payment.kind.refund')}
            </Button>
            {allowDebt && due > 0 && !openDebt && (
              <Button size="compact-md" variant="light" color="orange" leftSection={<IconSignature size={16} />} onClick={() => setDebtOpen(true)}>
                {t('debt.give')}
              </Button>
            )}
          </Group>
        </Stack>
      </Box>

      <Section title={t('invoice.title')} description={t('invoice.hint')} mt={0}>
        {!inv ? (
          <Box className="surface" p="md">
            <SimpleGrid cols={2} spacing="xs">
              {(['simplified_tax_invoice', 'tax_invoice'] as const).map((x) => (
                <SelectCard key={x} active={invType === x} onClick={() => setInvType(x)}>
                  <Text size="sm" fw={700}>
                    {t(`invoice.type.${x}`)}
                  </Text>
                  <Text size="xs" c="dimmed" mt={2}>
                    {t(`invoice.typeHint.${x}`)}
                  </Text>
                </SelectCard>
              ))}
            </SimpleGrid>
            {invType === 'tax_invoice' && !b.customer.trn && (
              <Text size="xs" c="orange" mt="xs">
                {t('invoice.noTrn')}
              </Text>
            )}
            <Button
              mt="md"
              fullWidth
              leftSection={<IconFileInvoice size={18} />}
              loading={busy}
              disabled={!hasApproved}
              onClick={() => setIssueOpen(true)}
            >
              {t('invoice.issue')}
            </Button>
            {!hasApproved && (
              <Text size="xs" c="dimmed" mt={6} ta="center">
                {t('invoice.nothingYet')}
              </Text>
            )}
          </Box>
        ) : (
          <List>
            <ListRow
              left={
                <ThemeIcon variant="light" color="cobalt" size={40} radius="md">
                  <IconFileInvoice size={21} />
                </ThemeIcon>
              }
              title={inv.number}
              subtitle={`${t(`invoice.type.${inv.type}`)} · ${formatDate(inv.issuedAt)}`}
              right={
                <Group gap={4} wrap="nowrap">
                  <Money fils={inv.totalFils} size="sm" />
                  <ActionIcon variant="default" size={32} onClick={() => run(async () => openPdf(await invoicePdf(inv.id)))} aria-label="PDF">
                    <IconFileTypePdf size={17} />
                  </ActionIcon>
                  <ActionIcon variant="light" size={32} onClick={() => sendInvoice(inv.id, inv.number, inv.totalFils)} aria-label={t('common.send')}>
                    <IconSend size={17} />
                  </ActionIcon>
                </Group>
              }
            />
            {b.invoices
              .filter((i) => i.type === 'credit_note' || i.status === 'credited')
              .map((i) => (
                <ListRow key={i.id} title={i.number} subtitle={`${t(`invoice.type.${i.type}`)} · ${formatDateTime(i.issuedAt)}${i.reason ? ` · ${i.reason}` : ''}${i.status === 'credited' ? ` · ${t('invoice.credited')}` : ''}`} />
              ))}
          </List>
        )}
        {inv && (
          <Button mt="xs" variant="subtle" color="red" size="compact-sm" onClick={() => setCreditOpen(true)}>
            {t('invoice.correct')}
          </Button>
        )}
      </Section>

      {(b.payments.length > 0 || openDebt) && (
        <Section title={t('payment.history')} mt={0}>
          <List>
            {b.payments.map((p) => {
              const I = METHOD_ICON[p.method];
              return (
                <ListRow
                  key={p.id}
                  left={
                    <ThemeIcon variant="light" color={p.kind === 'refund' ? 'red' : 'green'} size={40} radius="md">
                      <I size={20} />
                    </ThemeIcon>
                  }
                  title={`${t(`payment.kind.${p.kind}`)} · ${t(`payment.method.${p.method}`)}`}
                  subtitle={`${formatDateTime(p.receivedAt)} · ${p.receiptNumber}${p.reference ? ` · ${p.reference}` : ''}`}
                  right={
                    <Group gap={4} wrap="nowrap">
                      <Money fils={p.kind === 'refund' ? -p.amountFils : p.amountFils} size="sm" c={p.kind === 'refund' ? 'red' : undefined} />
                      <ActionIcon variant="subtle" color="gray" size={32} onClick={() => run(async () => openPdf(await receiptPdf(p.id)))} aria-label={p.receiptNumber}>
                        <IconReceipt2 size={17} />
                      </ActionIcon>
                    </Group>
                  }
                />
              );
            })}
            {openDebt && (
              <ListRow
                left={
                  <ThemeIcon variant="light" color="orange" size={40} radius="md">
                    <IconSignature size={20} />
                  </ThemeIcon>
                }
                title={t('debt.document')}
                subtitle={`${formatDateTime(openDebt.signedAt)} · ${t('debt.dueDate')} ${formatDate(openDebt.dueDate)}`}
                right={
                  <ActionIcon variant="subtle" color="gray" size={32} onClick={() => run(async () => openPdf(await debtPdf(openDebt.id)))} aria-label="PDF">
                    <IconFileTypePdf size={17} />
                  </ActionIcon>
                }
              />
            )}
          </List>
        </Section>
      )}

      {payOpen && <PaymentModal b={b} opened onClose={() => setPayOpen(null)} kind={payOpen} />}
      {debtOpen && <DebtModal b={b} opened onClose={() => setDebtOpen(false)} />}
      <Modal opened={creditOpen} onClose={() => setCreditOpen(false)} title={t('invoice.correct')}>
        <Text size="sm" mb="sm">
          {t('invoice.correctExplain')}
        </Text>
        <TextInput label={t('common.reason')} value={creditReason} onChange={(e) => setCreditReason(e.currentTarget.value)} required />
        <Button
          mt="md"
          fullWidth
          color="red"
          disabled={!creditReason.trim() || !inv}
          onClick={() => inv && run(async () => { await issueCreditNote(inv.id, creditReason); setCreditOpen(false); setCreditReason(''); }, 'invoice.credited')}
        >
          {t('invoice.issueCredit')}
        </Button>
      </Modal>
      <ConfirmModal
        opened={issueOpen}
        onClose={() => setIssueOpen(false)}
        title={t('invoice.confirmTitle')}
        confirmLabel={t('invoice.issue')}
        icon={<IconFileInvoice size={18} />}
        onConfirm={() =>
          run(async () => {
            const i = await issueInvoice(b.order.id, invType);
            haptic('success');
            sendInvoice(i.id, i.number, i.totalFils);
            return true;
          }, 'invoice.issued')
        }
      >
        <Box className="surface-soft" p="sm">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text size="sm" fw={700}>
                {t(`invoice.type.${invType}`)}
              </Text>
              <Text size="xs" c="dimmed">
                {b.customer.type === 'company' && b.customer.companyName ? b.customer.companyName : b.customer.name}
                {b.customer.trn ? ` · TRN ${b.customer.trn}` : ''}
              </Text>
            </div>
            <Text fz={22}>
              <Money fils={sum.approvedGross} display />
            </Text>
          </Group>
        </Box>
        <Text size="sm" c="dimmed" mt="sm">
          {t('invoice.confirmText')}
        </Text>
      </ConfirmModal>
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
    </Stack>
  );
}
