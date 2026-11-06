import { Alert, Badge, Button, Group, Modal, Paper, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconCash, IconFileInvoice, IconFileTypePdf, IconSignature } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, dubaiDate, formatDate, formatDateTime, nowIso } from '../../domain/dates';
import { activeInvoice, chooseInvoiceType, paidNet } from '../../domain/invoice';
import { summarize } from '../../domain/items';
import type { InvoiceType, PayMethod, Payment } from '../../domain/types';
import { debtPdf, invoicePdf, openPdf, receiptPdf } from '../../services/documents';
import { simpleMessage } from '../../services/messages';
import { addPayment, createDebt, issueCreditNote, issueInvoice } from '../../services/money';
import { bundleAmountDue, type OrderBundle } from '../../services/orders';
import { Money, MoneyInput } from '../../ui/components';
import { useAction } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { SignatureBox, type SignatureHandle } from '../../ui/SignatureBox';

export function PaymentModal({ b, opened, onClose, kind: initialKind }: { b: OrderBundle; opened: boolean; onClose: () => void; kind?: Payment['kind'] }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const due = bundleAmountDue(b);
  const [kind, setKind] = useState<Payment['kind']>(initialKind ?? 'payment');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [amount, setAmount] = useState<number | undefined>(due > 0 ? due : undefined);
  const [reference, setReference] = useState('');
  const save = () =>
    run(async () => {
      await addPayment(b.order.id, { kind, method, amountFils: amount ?? 0, reference });
      onClose();
    }, 'payment.saved');
  return (
    <Modal opened={opened} onClose={onClose} title={t('payment.title')}>
      <Stack>
        <SegmentedControl
          fullWidth
          value={kind}
          onChange={(v) => setKind(v as Payment['kind'])}
          data={(['payment', 'prepayment', 'refund'] as const).map((k) => ({ value: k, label: t(`payment.kind.${k}`) }))}
        />
        <SegmentedControl
          fullWidth
          value={method}
          onChange={(v) => setMethod(v as PayMethod)}
          data={(['cash', 'card', 'transfer'] as const).map((m) => ({ value: m, label: t(`payment.method.${m}`) }))}
        />
        <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} autoFocus required description={due > 0 ? `${t('payment.due')}: ${(due / 100).toFixed(2)} AED` : undefined} />
        {method !== 'cash' && <TextInput label={t('payment.reference')} value={reference} onChange={(e) => setReference(e.currentTarget.value)} />}
        <Button onClick={save} loading={busy} disabled={!amount}>{t('common.save')}</Button>
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
        <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} required />
        <TextInput type="date" label={t('debt.dueDate')} value={date} onChange={(e) => setDate(e.currentTarget.value)} />
        <Text size="sm" fw={500}>{t('debt.customerSigns')}</Text>
        <SignatureBox ref={sig} height={160} />
        <Button onClick={save} loading={busy} leftSection={<IconSignature size={18} />}>{t('debt.sign')}</Button>
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
  const [creditReason, setCreditReason] = useState('');
  const sum = summarize(b.items);
  const inv = activeInvoice(b.invoices);
  const paid = paidNet(b.payments);
  const due = bundleAmountDue(b);
  const [invType, setInvType] = useState<Exclude<InvoiceType, 'credit_note'>>(chooseInvoiceType(b.customer));
  const openDebt = b.debts.find((d) => d.status === 'open');
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };

  const sendInvoice = (invoiceId: string, number: string, total: number) =>
    setSend({
      text: simpleMessage('invoice', ctx, b.order.docLanguage, { invoice: number, amount: (total / 100).toFixed(2) + ' AED' }),
      template: 'invoice',
      lang: b.order.docLanguage,
      orderId: b.order.id,
      pdf: () => invoicePdf(invoiceId),
    });

  return (
    <Stack>
      <Paper withBorder p="md">
        <Group justify="space-between"><Text>{t('payment.approvedTotal')}</Text><Money fils={sum.approvedGross} fw={600} /></Group>
        {inv && <Group justify="space-between"><Text>{t('payment.invoiceTotal')} {inv.number}</Text><Money fils={inv.totalFils} fw={600} /></Group>}
        <Group justify="space-between"><Text>{t('payment.paid')}</Text><Money fils={paid} /></Group>
        <Group justify="space-between" mt={4}>
          <Text fw={700}>{due >= 0 ? t('payment.due') : t('payment.overpaid')}</Text>
          <Money fils={Math.abs(due)} fw={700} size="lg" c={due > 0 ? 'red' : 'green'} />
        </Group>
        {openDebt && <Badge color="red" mt="xs">{t('debt.open', { date: formatDate(openDebt.dueDate) })}: <Money fils={openDebt.amountFils} /></Badge>}
      </Paper>
      <Group grow>
        <Button size="sm" leftSection={<IconCash size={16} />} onClick={() => setPayOpen('payment')}>{t('payment.accept')}</Button>
        <Button size="sm" variant="light" onClick={() => setPayOpen('prepayment')}>{t('payment.kind.prepayment')}</Button>
      </Group>
      {!inv ? (
        <Paper withBorder p="sm">
          <Text size="sm" mb="xs">{t('invoice.notIssued')}</Text>
          <Group align="flex-end">
            <Select
              style={{ flex: 1 }}
              value={invType}
              onChange={(v) => v && setInvType(v as typeof invType)}
              data={[
                { value: 'simplified_tax_invoice', label: t('invoice.type.simplified_tax_invoice') },
                { value: 'tax_invoice', label: t('invoice.type.tax_invoice') },
              ]}
              allowDeselect={false}
            />
            <Button
              leftSection={<IconFileInvoice size={18} />}
              loading={busy}
              disabled={sum.approvedGross === 0 && !b.items.some((i) => i.approvalState === 'approved')}
              onClick={() => run(async () => { const i = await issueInvoice(b.order.id, invType); sendInvoice(i.id, i.number, i.totalFils); }, 'invoice.issued')}
            >
              {t('invoice.issue')}
            </Button>
          </Group>
          {invType === 'tax_invoice' && !b.customer.trn && <Text size="xs" c="orange" mt={4}>{t('invoice.noTrn')}</Text>}
        </Paper>
      ) : (
        <Group>
          <Button variant="default" leftSection={<IconFileTypePdf size={18} />} onClick={() => run(async () => openPdf(await invoicePdf(inv.id)))}>{inv.number}</Button>
          <Button variant="light" onClick={() => sendInvoice(inv.id, inv.number, inv.totalFils)}>{t('common.send')}</Button>
          <Button variant="subtle" color="red" onClick={() => setCreditOpen(true)}>{t('invoice.correct')}</Button>
        </Group>
      )}
      {allowDebt && due > 0 && !openDebt && (
        <Button variant="outline" color="orange" onClick={() => setDebtOpen(true)}>{t('debt.give')}</Button>
      )}
      {openDebt && (
        <Button variant="subtle" leftSection={<IconFileTypePdf size={16} />} onClick={() => run(async () => openPdf(await debtPdf(openDebt.id)))}>{t('debt.document')}</Button>
      )}
      {b.payments.length > 0 && (
        <Stack gap={4}>
          <Text fw={600} size="sm">{t('payment.history')}</Text>
          {b.payments.map((p) => (
            <Group key={p.id} justify="space-between" wrap="nowrap">
              <Text size="sm">
                {formatDateTime(p.receivedAt)} · {t(`payment.kind.${p.kind}`)} · {t(`payment.method.${p.method}`)}
              </Text>
              <Group gap={4} wrap="nowrap">
                <Money fils={p.kind === 'refund' ? -p.amountFils : p.amountFils} size="sm" />
                <Button size="compact-xs" variant="subtle" onClick={() => run(async () => openPdf(await receiptPdf(p.id)))}>{p.receiptNumber}</Button>
              </Group>
            </Group>
          ))}
        </Stack>
      )}
      {b.invoices.filter((i) => i.type === 'credit_note' || i.status === 'credited').map((i) => (
        <Text key={i.id} size="xs" c="dimmed">
          {i.number} · {t(`invoice.type.${i.type}`)} · {formatDateTime(i.issuedAt)} {i.reason ? `· ${i.reason}` : ''} {i.status === 'credited' ? `· ${t('invoice.credited')}` : ''}
        </Text>
      ))}
      {payOpen && <PaymentModal b={b} opened onClose={() => setPayOpen(null)} kind={payOpen} />}
      {debtOpen && <DebtModal b={b} opened onClose={() => setDebtOpen(false)} />}
      <Modal opened={creditOpen} onClose={() => setCreditOpen(false)} title={t('invoice.correct')}>
        <Text size="sm" mb="sm">{t('invoice.correctExplain')}</Text>
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
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
    </Stack>
  );
}
