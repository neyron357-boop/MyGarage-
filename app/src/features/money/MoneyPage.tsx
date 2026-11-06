import { Alert, Avatar, Badge, Box, Button, Group, Modal, Progress, Select, SimpleGrid, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import {
  IconArrowDownLeft,
  IconArrowUpRight,
  IconBuildingBank,
  IconCash,
  IconCashRegister,
  IconCreditCard,
  IconLock,
  IconPlus,
  IconReceipt2,
  IconUserDollar,
  type Icon,
} from '@tabler/icons-react';
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
import { EmptyState, List, ListRow, Money, MoneyInput, PageHeader, Photo, PlateText, ScrollTabs, Section, SelectCard } from '../../ui/components';
import { DateField, MonthField } from '../../ui/DateFields';
import { useAction, useLang } from '../../ui/hooks';
import { initials } from '../customers/CustomersPage';

const METHOD_ICON: Record<PayMethod, Icon> = { cash: IconCash, card: IconCreditCard, transfer: IconBuildingBank };

function MethodPicker({ value, onChange }: { value: PayMethod; onChange: (m: PayMethod) => void }) {
  const { t } = useTranslation();
  return (
    <SimpleGrid cols={3} spacing="xs">
      {(['cash', 'card', 'transfer'] as const).map((m) => {
        const I = METHOD_ICON[m];
        return (
          <SelectCard key={m} active={value === m} onClick={() => onChange(m)}>
            <Stack gap={4} align="center">
              <I size={20} stroke={1.7} />
              <Text size="sm" fw={600}>
                {t(`payment.method.${m}`)}
              </Text>
            </Stack>
          </SelectCard>
        );
      })}
    </SimpleGrid>
  );
}

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
    <Stack gap="lg">
      <Box p="lg" style={{ background: 'var(--app-ink)', color: '#fff', borderRadius: 'var(--mantine-radius-lg)' }}>
        <Text size="11px" fw={700} tt="uppercase" c="var(--app-ink-muted)" style={{ letterSpacing: '0.08em' }}>
          {t('cash.expected')}
        </Text>
        <Text fz={40} lh={1.1} mt={4}>
          <Money fils={st.expected} display />
        </Text>
        <Group gap="lg" mt="sm">
          <Text size="sm" c="var(--app-ink-muted)">
            {t('cash.opening')}: <Money fils={st.opening} c="#fff" />
          </Text>
          <Text size="sm" c="var(--app-ink-muted)">
            {t('cash.in')}: <Money fils={st.inFils} c="green.4" />
          </Text>
          <Text size="sm" c="var(--app-ink-muted)">
            {t('cash.out')}: <Money fils={st.outFils} c="red.4" />
          </Text>
        </Group>
        <Group mt="lg" gap="xs">
          <Button leftSection={<IconLock size={18} />} onClick={() => setCloseOpen(true)}>
            {t('cash.closeDay')}
          </Button>
          <Button variant="white" color="dark" onClick={() => setMoveOpen(true)}>
            {t('cash.addMovement')}
          </Button>
        </Group>
        {st.lastClosing && (
          <Text size="xs" c="var(--app-ink-muted)" mt="sm">
            {t('cash.lastClosed', { date: formatDateTime(st.lastClosing.closedAt) })}
          </Text>
        )}
      </Box>
      <Section title={t('cash.movements')} mt={0}>
        {st.movements.length === 0 ? (
          <EmptyState icon={IconCashRegister}>{t('cash.noMovements')}</EmptyState>
        ) : (
          <List>
            {[...st.movements].reverse().map((m) => (
              <ListRow
                key={m.id}
                left={
                  <ThemeIcon variant="light" color={m.direction === 'in' ? 'green' : 'red'} size={38} radius="md">
                    {m.direction === 'in' ? <IconArrowDownLeft size={19} /> : <IconArrowUpRight size={19} />}
                  </ThemeIcon>
                }
                title={t(`cashReason.${m.reason}`)}
                subtitle={`${formatDateTime(m.at)}${m.note ? ` · ${m.note}` : ''}`}
                right={<Money fils={m.direction === 'in' ? m.amountFils : -m.amountFils} c={m.direction === 'in' ? 'green' : 'red'} size="sm" />}
              />
            ))}
          </List>
        )}
      </Section>
      {!!closings?.length && (
        <Section title={t('cash.history')} mt={0}>
          <List>
            {closings.map((c) => (
              <ListRow
                key={c.id}
                title={formatDate(c.date)}
                subtitle={`${t('cash.expected')} ${formatAed(c.expectedFils)} · ${t('cash.actual')} ${formatAed(c.actualFils)} · ${t('payment.method.card')} ${formatAed(c.cardTotalFils)}${c.comment ? ` · ${c.comment}` : ''}`}
                right={c.diffFils !== 0 ? <Badge color="red">{formatAed(c.diffFils)}</Badge> : <Badge color="green">OK</Badge>}
              />
            ))}
          </List>
        </Section>
      )}
      <Modal opened={moveOpen} onClose={() => setMoveOpen(false)} title={t('cash.addMovement')}>
        <Stack>
          <SimpleGrid cols={2} spacing="xs">
            {(['in', 'out'] as const).map((d) => (
              <SelectCard key={d} active={dir === d} onClick={() => setDir(d)}>
                <Group gap={6}>
                  {d === 'in' ? <IconArrowDownLeft size={18} color="var(--mantine-color-green-6)" /> : <IconArrowUpRight size={18} color="var(--mantine-color-red-6)" />}
                  <Text fw={600} size="sm">
                    {t(`cash.${d}`)}
                  </Text>
                </Group>
              </SelectCard>
            ))}
          </SimpleGrid>
          <Select value={reason} onChange={(v) => v && setReason(v as CashReason)} allowDeselect={false} data={(['collection', 'adjustment', 'other'] as const).map((r) => ({ value: r, label: t(`cashReason.${r}`) }))} />
          <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} />
          <TextInput label={t('common.comment')} value={note} onChange={(e) => setNote(e.currentTarget.value)} description={t('cash.commentHint')} />
          <Button loading={busy} onClick={() => run(async () => { await addCashMovement({ direction: dir, amountFils: amount ?? 0, reason, note }); setMoveOpen(false); setAmount(undefined); setNote(''); }, 'common.saved')}>
            {t('common.save')}
          </Button>
        </Stack>
      </Modal>
      <Modal opened={closeOpen} onClose={() => setCloseOpen(false)} title={t('cash.closeDay')}>
        <Stack>
          <Box className="surface-soft" p="md">
            <div className="eyebrow">{t('cash.shouldBe')}</div>
            <Text fz={28}>
              <Money fils={st.expected} display />
            </Text>
          </Box>
          <MoneyInput label={t('cash.counted')} value={actual} onChange={setActual} autoFocus />
          {actual !== undefined && diff === 0 && <Alert color="green">{t('cash.match')}</Alert>}
          {actual !== undefined && diff !== 0 && (
            <>
              <Alert color="red" title={t('cash.diff')}>
                {formatAed(diff)}
              </Alert>
              <TextInput label={t('common.comment')} required value={comment} onChange={(e) => setComment(e.currentTarget.value)} />
            </>
          )}
          <Button loading={busy} disabled={actual === undefined} leftSection={<IconLock size={18} />} onClick={() => run(async () => { await closeCashDay(actual ?? 0, comment); setCloseOpen(false); setActual(undefined); setComment(''); }, 'cash.closed')}>
            {t('cash.close')}
          </Button>
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
  const reset = () => {
    setAmount(undefined);
    setVat(undefined);
    setVendor('');
    setNote('');
    setOver('');
    setReceipt(undefined);
  };
  return (
    <Modal opened={opened} onClose={onClose} title={t('expense.add')} size="lg">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label={t('expense.category')} placeholder={t('expense.pickCategory')} value={categoryId} onChange={setCategoryId} data={(cats ?? []).map((c) => ({ value: c.id, label: lang === 'ru' ? c.nameRu : c.nameEn }))} />
          <DateField label={t('common.date')} value={date} onChange={setDate} />
        </SimpleGrid>
        {cat && cat.monthlyLimitFils > 0 && (
          <Box className="surface-soft" p="sm">
            <Text size="xs" c={overLimit ? 'red' : 'dimmed'} fw={600} mb={4}>
              {t('expense.limitUsage', { spent: formatAed(spent + (amount ?? 0)), limit: formatAed(cat.monthlyLimitFils) })}
            </Text>
            <Progress value={Math.min(100, ((spent + (amount ?? 0)) / cat.monthlyLimitFils) * 100)} color={overLimit ? 'red' : 'cobalt'} />
          </Box>
        )}
        <SimpleGrid cols={2}>
          <MoneyInput label={t('expense.amountGross')} value={amount} onChange={setAmount} />
          <MoneyInput
            label={t('expense.vat')}
            value={vat}
            onChange={setVat}
            description={
              amount ? (
                <Text span size="xs" c="cobalt.6" style={{ cursor: 'pointer' }} onClick={() => setVat(vatOf(netFromGross(amount, 500), 500))}>
                  {t('expense.vatFromGross')}
                </Text>
              ) : undefined
            }
          />
        </SimpleGrid>
        <TextInput label={t('expense.vendor')} value={vendor} onChange={(e) => setVendor(e.currentTarget.value)} />
        <MethodPicker value={method} onChange={setMethod} />
        <CaptureButton variant="light" camera={false} leftSection={<IconReceipt2 size={18} />} onFiles={(f) => setReceipt(f[0])}>
          {receipt ? t('parts.receiptAttached') : t('parts.receiptPhoto')}
        </CaptureButton>
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
  const cats = data.cats.filter((c) => c.active && (byCat(c.id) > 0 || c.monthlyLimitFils > 0)).sort((a, b) => byCat(b.id) - byCat(a.id));
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <MonthField value={month} onChange={setMonth} />
        <Button leftSection={<IconPlus size={18} />} onClick={() => setOpen(true)}>
          {t('expense.add')}
        </Button>
      </Group>
      <Box className="surface" p="md">
        <Group justify="space-between" mb="md">
          <div>
            <div className="eyebrow">{t('expense.monthTotal')}</div>
            <Text fz={28}>
              <Money fils={total} display />
            </Text>
          </div>
        </Group>
        <Stack gap="sm">
          {cats.map((c) => {
            const s = byCat(c.id);
            const pct = c.monthlyLimitFils ? (s / c.monthlyLimitFils) * 100 : 0;
            return (
              <div key={c.id}>
                <Group justify="space-between" mb={4} wrap="nowrap">
                  <Text size="sm" fw={500}>
                    {lang === 'ru' ? c.nameRu : c.nameEn}
                  </Text>
                  <Text size="sm" className="tnum" c={pct > 100 ? 'red' : undefined} fw={600}>
                    {formatAed(s)}
                    {c.monthlyLimitFils ? (
                      <Text span c="dimmed" fw={400} size="xs">
                        {' '}
                        / {formatAed(c.monthlyLimitFils)}
                      </Text>
                    ) : null}
                  </Text>
                </Group>
                {c.monthlyLimitFils > 0 && <Progress value={Math.min(100, pct)} color={pct > 100 ? 'red' : pct > 80 ? 'orange' : 'cobalt'} size="sm" />}
              </div>
            );
          })}
        </Stack>
      </Box>
      {data.list.length === 0 ? (
        <EmptyState icon={IconReceipt2}>{t('expense.empty')}</EmptyState>
      ) : (
        <List>
          {data.list.map((e) => {
            const c = data.cats.find((x) => x.id === e.categoryId);
            const I = METHOD_ICON[e.method];
            return (
              <ListRow
                key={e.id}
                left={
                  e.receiptMediaId ? (
                    <Photo id={e.receiptMediaId} h={40} />
                  ) : (
                    <ThemeIcon variant="light" color="gray" size={40} radius="md">
                      <I size={19} />
                    </ThemeIcon>
                  )
                }
                title={`${c ? (lang === 'ru' ? c.nameRu : c.nameEn) : ''}${e.vendor ? ` · ${e.vendor}` : ''}`}
                subtitle={`${formatDate(e.date)} · ${t(`payment.method.${e.method}`)}${e.vatFils ? ` · VAT ${formatAed(e.vatFils)}` : ''}${e.note ? ` · ${e.note}` : ''}${e.overLimitComment ? ` · ⚠ ${e.overLimitComment}` : ''}`}
                right={<Money fils={e.amountFils} size="sm" />}
              />
            );
          })}
        </List>
      )}
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
    <Stack gap="lg">
      <MonthField value={month} onChange={setMonth} />
      <List>
        {data.emps.map((e) => {
          const paid = data.pays.filter((p) => p.employeeId === e.id).reduce((s, p) => s + p.amountFils, 0);
          const pct = e.monthlySalaryFils ? Math.min(100, (paid / e.monthlySalaryFils) * 100) : 0;
          return (
            <ListRow
              key={e.id}
              left={
                <Avatar color="cobalt" radius="xl">
                  {initials(e.name)}
                </Avatar>
              }
              title={e.name}
              subtitle={
                <Stack gap={4}>
                  <span>
                    {t(`role.${e.role}`)} · {t('salary.paid')} {formatAed(paid)} {t('problem.of')} {formatAed(e.monthlySalaryFils)}
                  </span>
                  {e.monthlySalaryFils > 0 && <Progress value={pct} size="xs" color={pct >= 100 ? 'green' : 'cobalt'} maw={220} />}
                </Stack>
              }
              right={
                <Group gap={4} wrap="nowrap">
                  <Button size="compact-sm" variant="default" onClick={() => { setPay({ employeeId: e.id, kind: 'advance' }); setAmount(undefined); }}>
                    {t('salary.kind.advance')}
                  </Button>
                  <Button size="compact-sm" onClick={() => { setPay({ employeeId: e.id, kind: 'salary' }); setAmount(Math.max(0, e.monthlySalaryFils - paid) || undefined); }}>
                    {t('salary.kind.salary')}
                  </Button>
                </Group>
              }
            />
          );
        })}
      </List>
      <Text size="xs" c="dimmed">
        {t('salary.hint')}
      </Text>
      <Modal opened={!!pay} onClose={() => setPay(null)} title={pay ? t(`salary.kind.${pay.kind}`) : ''}>
        <Stack>
          <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} autoFocus />
          <MethodPicker value={method} onChange={setMethod} />
          <Button loading={busy} onClick={() => pay && run(async () => { await paySalary({ ...pay, month, amountFils: amount ?? 0, method }); setPay(null); }, 'common.saved')}>
            {t('common.save')}
          </Button>
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
  if (!list.length) return <EmptyState icon={IconUserDollar} title={t('debt.none')}>{t('debt.noneHint')}</EmptyState>;
  const total = list.reduce((s, b) => s + bundleAmountDue(b), 0);
  return (
    <Stack gap="md">
      <Box className="surface" p="md">
        <div className="eyebrow">{t('debt.total')}</div>
        <Text fz={28} c="red">
          <Money fils={total} display />
        </Text>
      </Box>
      <List>
        {list.map((b) => {
          const d = b.debts.find((x) => x.status === 'open');
          const overdue = d && d.dueDate < dubaiDate();
          return (
            <ListRow
              key={b.order.id}
              onClick={() => navigate(`/orders/${b.order.id}?tab=payments`)}
              chevron
              left={<PlateText plate={b.vehicle.plate} size="sm" />}
              title={b.customer.name}
              subtitle={
                <Text span size="xs" c={overdue ? 'red' : 'dimmed'}>
                  №{b.order.number}
                  {d ? ` · ${t('debt.dueDate')} ${formatDate(d.dueDate)}` : ''}
                  {overdue ? ` · ${t('debt.overdue')}` : ''}
                </Text>
              }
              right={<Money fils={bundleAmountDue(b)} c="red" size="sm" />}
            />
          );
        })}
      </List>
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
      <ScrollTabs
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        items={[
          { value: 'cash', label: t('money.cash') },
          { value: 'expenses', label: t('money.expenses') },
          { value: 'salaries', label: t('money.salaries') },
          { value: 'debts', label: t('money.debts') },
        ]}
      />
      {tab === 'cash' && <CashTab />}
      {tab === 'expenses' && <ExpensesTab addOpen={params.get('add') === '1'} />}
      {tab === 'salaries' && <SalariesTab />}
      {tab === 'debts' && <DebtsTab />}
    </>
  );
}
