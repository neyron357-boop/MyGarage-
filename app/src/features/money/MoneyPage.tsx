import { Alert, Badge, Button, Card, Group, Modal, Paper, Progress, SegmentedControl, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate, formatDate, formatDateTime, monthKey } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import { netFromGross, vatOf } from '../../domain/vat';
import type { CashReason, PayMethod, SalaryPayment } from '../../domain/types';
import { addCashMovement, addExpense, cashState, categoryMonthSpent, closeCashDay, paySalary } from '../../services/money';
import { bundleAmountDue, loadOrderBundle, type OrderBundle } from '../../services/orders';
import { CaptureButton } from '../../ui/CaptureButton';
import { EmptyState, Money, MoneyInput, PageHeader, Photo, PlateText } from '../../ui/components';
import { useAction, useLang } from '../../ui/hooks';

function CashTab() {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const st = useLiveQuery(cashState, []);
  const closings = useLiveQuery(() => db.cashClosings.orderBy('date').reverse().limit(30).toArray(), []);
  const [moveOpen, setMoveOpen] = useState(false);
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [reason, setReason] = useState<CashReason>('collection');
  const [amount, setAmount] = useState<number>();
  const [note, setNote] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [actual, setActual] = useState<number>();
  const [comment, setComment] = useState('');
  if (!st) return null;
  const diff = actual !== undefined ? actual - st.expected : 0;
  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">{t('cash.opening')}</Text><Money fils={st.opening} fw={600} /></Paper>
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">{t('cash.in')}</Text><Money fils={st.inFils} fw={600} c="green" /></Paper>
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">{t('cash.out')}</Text><Money fils={st.outFils} fw={600} c="red" /></Paper>
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">{t('cash.expected')}</Text><Money fils={st.expected} fw={800} size="lg" /></Paper>
      </SimpleGrid>
      <Group>
        <Button onClick={() => setCloseOpen(true)}>{t('cash.closeDay')}</Button>
        <Button variant="light" onClick={() => setMoveOpen(true)}>{t('cash.addMovement')}</Button>
      </Group>
      <Title order={6}>{t('cash.movements')}</Title>
      {st.movements.length === 0 && <EmptyState>{t('cash.noMovements')}</EmptyState>}
      {[...st.movements].reverse().map((m) => (
        <Group key={m.id} justify="space-between" wrap="nowrap">
          <Text size="sm">{formatDateTime(m.at)} · {t(`cashReason.${m.reason}`)}{m.note ? ` · ${m.note}` : ''}</Text>
          <Money fils={m.direction === 'in' ? m.amountFils : -m.amountFils} c={m.direction === 'in' ? 'green' : 'red'} size="sm" />
        </Group>
      ))}
      <Title order={6} mt="md">{t('cash.history')}</Title>
      {closings?.map((c) => (
        <Paper key={c.id} withBorder p="xs">
          <Group justify="space-between">
            <Text size="sm">{formatDate(c.date)} · {t('cash.expected')} {formatAed(c.expectedFils)} · {t('cash.actual')} {formatAed(c.actualFils)}</Text>
            {c.diffFils !== 0 ? <Badge color="red">{formatAed(c.diffFils)}</Badge> : <Badge color="green">OK</Badge>}
          </Group>
          <Text size="xs" c="dimmed">{t('payment.method.card')}: {formatAed(c.cardTotalFils)} · {t('payment.method.transfer')}: {formatAed(c.transferTotalFils)}{c.comment ? ` · ${c.comment}` : ''}</Text>
        </Paper>
      ))}
      <Modal opened={moveOpen} onClose={() => setMoveOpen(false)} title={t('cash.addMovement')}>
        <Stack>
          <SegmentedControl fullWidth value={dir} onChange={(v) => setDir(v as 'in' | 'out')} data={[{ value: 'in', label: t('cash.in') }, { value: 'out', label: t('cash.out') }]} />
          <Select value={reason} onChange={(v) => v && setReason(v as CashReason)} allowDeselect={false} data={(['collection', 'adjustment', 'other'] as const).map((r) => ({ value: r, label: t(`cashReason.${r}`) }))} />
          <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} />
          <TextInput label={t('common.comment')} value={note} onChange={(e) => setNote(e.currentTarget.value)} description={t('cash.commentHint')} />
          <Button loading={busy} onClick={() => run(async () => { await addCashMovement({ direction: dir, amountFils: amount ?? 0, reason, note }); setMoveOpen(false); setAmount(undefined); setNote(''); }, 'common.saved')}>{t('common.save')}</Button>
        </Stack>
      </Modal>
      <Modal opened={closeOpen} onClose={() => setCloseOpen(false)} title={t('cash.closeDay')}>
        <Stack>
          <Text>{t('cash.shouldBe')}: <b>{formatAed(st.expected)}</b></Text>
          <MoneyInput label={t('cash.counted')} value={actual} onChange={setActual} autoFocus />
          {actual !== undefined && diff !== 0 && <Alert color="red">{t('cash.diff')}: {formatAed(diff)}</Alert>}
          {actual !== undefined && diff !== 0 && <TextInput label={t('common.comment')} required value={comment} onChange={(e) => setComment(e.currentTarget.value)} />}
          <Button loading={busy} disabled={actual === undefined} onClick={() => run(async () => { await closeCashDay(actual ?? 0, comment); setCloseOpen(false); setActual(undefined); setComment(''); }, 'cash.closed')}>{t('cash.close')}</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

function ExpenseModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const cats = useLiveQuery(() => db.expenseCategories.filter((c) => c.active).toArray(), []);
  const [date, setDate] = useState(dubaiDate());
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>();
  const [vat, setVat] = useState<number>();
  const [vendor, setVendor] = useState('');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [note, setNote] = useState('');
  const [over, setOver] = useState('');
  const [receipt, setReceipt] = useState<File>();
  const [spent, setSpent] = useState(0);
  const cat = cats?.find((c) => c.id === categoryId);
  useEffect(() => {
    if (categoryId) void categoryMonthSpent(categoryId, date.slice(0, 7)).then(setSpent);
  }, [categoryId, date]);
  const overLimit = !!cat && cat.monthlyLimitFils > 0 && spent + (amount ?? 0) > cat.monthlyLimitFils;
  const reset = () => { setAmount(undefined); setVat(undefined); setVendor(''); setNote(''); setOver(''); setReceipt(undefined); };
  return (
    <Modal opened={opened} onClose={onClose} title={t('expense.add')} size="lg">
      <Stack>
        <SimpleGrid cols={2}>
          <TextInput type="date" label={t('common.date')} value={date} onChange={(e) => setDate(e.currentTarget.value)} />
          <Select label={t('expense.category')} value={categoryId} onChange={setCategoryId} data={(cats ?? []).map((c) => ({ value: c.id, label: lang === 'ru' ? c.nameRu : c.nameEn }))} />
        </SimpleGrid>
        {cat && cat.monthlyLimitFils > 0 && (
          <div>
            <Text size="xs" c={overLimit ? 'red' : 'dimmed'}>{t('expense.limitUsage', { spent: formatAed(spent + (amount ?? 0)), limit: formatAed(cat.monthlyLimitFils) })}</Text>
            <Progress value={Math.min(100, ((spent + (amount ?? 0)) / cat.monthlyLimitFils) * 100)} color={overLimit ? 'red' : 'blue'} />
          </div>
        )}
        <SimpleGrid cols={2}>
          <MoneyInput label={t('expense.amountGross')} value={amount} onChange={setAmount} />
          <MoneyInput label={t('expense.vat')} value={vat} onChange={setVat} description={amount ? <Button size="compact-xs" variant="subtle" onClick={() => setVat(vatOf(netFromGross(amount, 500), 500))}>{t('expense.vatFromGross')}</Button> : undefined} />
        </SimpleGrid>
        <TextInput label={t('expense.vendor')} value={vendor} onChange={(e) => setVendor(e.currentTarget.value)} />
        <SegmentedControl fullWidth value={method} onChange={(v) => setMethod(v as PayMethod)} data={(['cash', 'card', 'transfer'] as const).map((m) => ({ value: m, label: t(`payment.method.${m}`) }))} />
        <CaptureButton variant="light" camera={false} onFiles={(f) => setReceipt(f[0])}>{receipt ? t('parts.receiptAttached') : t('parts.receiptPhoto')}</CaptureButton>
        <TextInput label={t('common.notes')} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        {overLimit && <TextInput label={t('expense.overLimitComment')} required value={over} onChange={(e) => setOver(e.currentTarget.value)} error={t('expense.overLimit')} />}
        <Button loading={busy} disabled={!categoryId || !amount} onClick={() => run(async () => { await addExpense({ date, categoryId: categoryId!, amountFils: amount ?? 0, vatFils: vat ?? 0, vendor, method, note, overLimitComment: over, receipt }); reset(); onClose(); }, 'common.saved')}>
          {t('common.save')}
        </Button>
      </Stack>
    </Modal>
  );
}

function ExpensesTab({ addOpen }: { addOpen: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [open, setOpen] = useState(addOpen);
  const [month, setMonth] = useState(monthKey());
  const data = useLiveQuery(async () => {
    const [list, cats] = await Promise.all([db.expenses.filter((e) => e.date.startsWith(month)).reverse().sortBy('date'), db.expenseCategories.toArray()]);
    return { list, cats };
  }, [month]);
  if (!data) return null;
  const byCat = (id: string) => data.list.filter((e) => e.categoryId === id).reduce((s, e) => s + e.amountFils, 0);
  const total = data.list.reduce((s, e) => s + e.amountFils, 0);
  return (
    <Stack>
      <Group justify="space-between">
        <TextInput type="month" value={month} onChange={(e) => setMonth(e.currentTarget.value || monthKey())} w={180} />
        <Button leftSection={<IconPlus size={18} />} onClick={() => setOpen(true)}>{t('expense.add')}</Button>
      </Group>
      <Paper withBorder p="sm">
        <Group justify="space-between" mb="xs"><Text fw={600}>{t('expense.byCategory')}</Text><Money fils={total} fw={700} /></Group>
        <Stack gap={6}>
          {data.cats.filter((c) => c.active).map((c) => {
            const s = byCat(c.id);
            const pct = c.monthlyLimitFils ? (s / c.monthlyLimitFils) * 100 : 0;
            return (
              <div key={c.id}>
                <Group justify="space-between">
                  <Text size="sm">{lang === 'ru' ? c.nameRu : c.nameEn}</Text>
                  <Text size="sm">{formatAed(s)}{c.monthlyLimitFils ? ` / ${formatAed(c.monthlyLimitFils)}` : ''}</Text>
                </Group>
                {c.monthlyLimitFils > 0 && <Progress value={Math.min(100, pct)} color={pct > 100 ? 'red' : pct > 80 ? 'orange' : 'blue'} size="sm" />}
              </div>
            );
          })}
        </Stack>
      </Paper>
      {data.list.map((e) => {
        const c = data.cats.find((x) => x.id === e.categoryId);
        return (
          <Card key={e.id} withBorder padding="xs">
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text size="sm" fw={500}>{c ? (lang === 'ru' ? c.nameRu : c.nameEn) : ''}{e.vendor ? ` · ${e.vendor}` : ''}</Text>
                <Text size="xs" c="dimmed">{formatDate(e.date)} · {t(`payment.method.${e.method}`)}{e.vatFils ? ` · VAT ${formatAed(e.vatFils)}` : ''}{e.note ? ` · ${e.note}` : ''}{e.overLimitComment ? ` · ⚠ ${e.overLimitComment}` : ''}</Text>
              </div>
              <Group gap={4} wrap="nowrap">
                {e.receiptMediaId && <Photo id={e.receiptMediaId} h={36} />}
                <Money fils={e.amountFils} fw={600} size="sm" />
              </Group>
            </Group>
          </Card>
        );
      })}
      <ExpenseModal opened={open} onClose={() => setOpen(false)} />
    </Stack>
  );
}

function SalariesTab() {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [month, setMonth] = useState(monthKey());
  const data = useLiveQuery(async () => ({ emps: await db.employees.filter((e) => e.active).toArray(), pays: await db.salaryPayments.where('month').equals(month).toArray() }), [month]);
  const [pay, setPay] = useState<{ employeeId: string; kind: SalaryPayment['kind'] } | null>(null);
  const [amount, setAmount] = useState<number>();
  const [method, setMethod] = useState<PayMethod>('cash');
  if (!data) return null;
  return (
    <Stack>
      <TextInput type="month" value={month} onChange={(e) => setMonth(e.currentTarget.value || monthKey())} w={180} />
      <Table>
        <Table.Thead>
          <Table.Tr><Table.Th>{t('customer.name')}</Table.Th><Table.Th>{t('salary.salary')}</Table.Th><Table.Th>{t('salary.paid')}</Table.Th><Table.Th>{t('salary.left')}</Table.Th><Table.Th /></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.emps.map((e) => {
            const paid = data.pays.filter((p) => p.employeeId === e.id).reduce((s, p) => s + p.amountFils, 0);
            return (
              <Table.Tr key={e.id}>
                <Table.Td>{e.name}</Table.Td>
                <Table.Td>{formatAed(e.monthlySalaryFils)}</Table.Td>
                <Table.Td>{formatAed(paid)}</Table.Td>
                <Table.Td>{formatAed(Math.max(0, e.monthlySalaryFils - paid))}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Button size="compact-xs" variant="light" onClick={() => { setPay({ employeeId: e.id, kind: 'advance' }); setAmount(undefined); }}>{t('salary.kind.advance')}</Button>
                    <Button size="compact-xs" onClick={() => { setPay({ employeeId: e.id, kind: 'salary' }); setAmount(Math.max(0, e.monthlySalaryFils - paid) || undefined); }}>{t('salary.kind.salary')}</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">{t('salary.hint')}</Text>
      <Modal opened={!!pay} onClose={() => setPay(null)} title={pay ? t(`salary.kind.${pay.kind}`) : ''}>
        <Stack>
          <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} />
          <SegmentedControl fullWidth value={method} onChange={(v) => setMethod(v as PayMethod)} data={(['cash', 'card', 'transfer'] as const).map((m) => ({ value: m, label: t(`payment.method.${m}`) }))} />
          <Button loading={busy} onClick={() => pay && run(async () => { await paySalary({ ...pay, month, amountFils: amount ?? 0, method }); setPay(null); }, 'common.saved')}>{t('common.save')}</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

function DebtsTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const list = useLiveQuery(async () => {
    const orders = await db.orders.where('stage').anyOf('delivered', 'closed').toArray();
    const bundles = (await Promise.all(orders.map((o) => loadOrderBundle(o.id)))).filter(Boolean) as OrderBundle[];
    return bundles.filter((b) => bundleAmountDue(b) > 0);
  }, []);
  if (!list) return null;
  if (!list.length) return <EmptyState>{t('debt.none')}</EmptyState>;
  return (
    <Stack gap="xs">
      {list.map((b) => {
        const d = b.debts.find((x) => x.status === 'open');
        const overdue = d && d.dueDate < dubaiDate();
        return (
          <Card key={b.order.id} withBorder padding="sm" className="tap-card" onClick={() => navigate(`/orders/${b.order.id}?tab=payments`)}>
            <Group justify="space-between">
              <div>
                <Group gap={6}><PlateText plate={b.vehicle.plate} size="xs" /><Text fw={600} size="sm">{b.customer.name}</Text></Group>
                <Text size="xs" c={overdue ? 'red' : 'dimmed'}>№{b.order.number}{d ? ` · ${t('debt.dueDate')} ${formatDate(d.dueDate)}` : ''}</Text>
              </div>
              <Money fils={bundleAmountDue(b)} fw={700} c="red" />
            </Group>
          </Card>
        );
      })}
    </Stack>
  );
}

export function MoneyPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'cash';
  return (
    <>
      <PageHeader title={t('nav.money')} />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'cash' })} mb="md">
        <Tabs.List>
          <Tabs.Tab value="cash">{t('money.cash')}</Tabs.Tab>
          <Tabs.Tab value="expenses">{t('money.expenses')}</Tabs.Tab>
          <Tabs.Tab value="salaries">{t('money.salaries')}</Tabs.Tab>
          <Tabs.Tab value="debts">{t('money.debts')}</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {tab === 'cash' && <CashTab />}
      {tab === 'expenses' && <ExpensesTab addOpen={params.get('add') === '1'} />}
      {tab === 'salaries' && <SalariesTab />}
      {tab === 'debts' && <DebtsTab />}
    </>
  );
}
