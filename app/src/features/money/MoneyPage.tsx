import { Alert, Badge, Box, Button, Group, Modal, Progress, SimpleGrid, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import {
  IconArrowDownLeft,
  IconArrowUpRight,
  IconCashRegister,
  IconFiles,
  IconLock,
  IconPaperclip,
  IconPlus,
  IconReceipt2,
  type Icon,
} from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { dayShort, dubaiTime, formatDate, formatDateTime, monthKey } from '../../domain/dates';
import { expenseEntry, withEntries } from '../../domain/ledger';
import { formatAed } from '../../domain/money';
import type { CashReason, ExpenseMethod, PayMethod, SalaryPayment } from '../../domain/types';
import { expenseNoteLine } from '../../domain/paperLines';
import { loadCredits } from '../../services/debts';
import { loadLedger } from '../../services/ledger';
import { addCashMovement, cashState, closeCashDay, paySalary } from '../../services/money';
import { proofIndex } from '../../services/proofs';
import { removeEntry } from '../../services/entries';
import { EmptyState, List, ListRow, MediaImage, Money, MoneyInput, PageHeader, PageSkeleton, PlateText, ScrollTabs, Section, SelectCard, PersonAvatar, undoToast } from '../../ui/components';
import { MonthField } from '../../ui/DateFields';
import { useAction, useLang, usePhone, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { stepMainTab } from '../../ui/mainSwipe';
import { hintNavigation } from '../../ui/stack';
import { useTabSwipe } from '../../ui/tabSwipe';
import { DebtsOverview } from './Debts';
import { EntryDetails, LedgerTab, useCategoryLabel } from './LedgerTab';
import { EntrySheet, PURSE_ICON, wayLabel } from './MoneyEntry';
import { MoneySheetActions } from './MoneySheetActions';
import { OwedName } from './OwedTo';

const METHOD_ICON: Record<ExpenseMethod, Icon> = PURSE_ICON;

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

/** A moment as people say it (v0.99, audit Ф32): «Сегодня 20:28», «Вчера 09:10», «14/11 18:02». */
function whenSaid(t: TFunction, iso: string): string {
  const d = dayShort(iso);
  const day = d.word ? t(`common.${d.word}`) : d.text;
  return `${day} ${dubaiTime(iso)}`;
}

function CashTab() {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  // The cash box with the book: a movement opens as its line of the book (the job's payment, the income, the
  // expense or the movement itself), with its photos — the same sheet as in "Book".
  const data = useScreenLiveQuery(async () => {
    const [st, book, cats] = await Promise.all([cashState(), loadLedger(), db.expenseCategories.toArray()]);
    const lines = withEntries(st.lines, book.entries).reverse();
    return { st, lines, cats, photos: await proofIndex(lines.map((l) => l.entry.id)) };
  }, []);
  const closings = useScreenLiveQuery(async () => (await db.cashClosings.toArray()).sort((a, b) => b.closedAt.localeCompare(a.closedAt)).slice(0, 30), []);
  const label = useCategoryLabel(data?.cats);
  const [opened, setOpened] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [reason, setReason] = useState<CashReason>('collection');
  const [amount, setAmount] = useState<number>();
  const [note, setNote] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [actual, setActual] = useState<number>();
  const [comment, setComment] = useState('');
  // On a PC (v0.41): the box and its closings in a column, the movements beside them.
  const phone = usePhone();
  if (!data) return <PageSkeleton />;
  const { st } = data;
  // The sheet follows its entry as it changes; when the day is closed, the line is gone and the sheet with it.
  const open = opened ? data.lines.find((l) => l.m.id === opened)?.entry : undefined;
  const diff = actual !== undefined ? actual - st.expected : 0;
  return (
    <Stack gap="lg" className={phone ? undefined : 'desk-cash'}>
      <Box p="lg" className="surface">
        <div className="eyebrow">{t('cash.expected')}</div>
        <Text fz={40} lh={1.1} mt={4}>
          <Money fils={st.expected} display />
        </Text>
        {/* How the figure is made up: rows of "label — amount", as on an iPhone receipt. */}
        <div className="kv-rows">
          <div className="kv-row">
            <span>{t('cash.opening')}</span>
            <Money fils={st.opening} />
          </div>
          <div className="kv-row">
            <span>{t('cash.in')}</span>
            <Money fils={st.inFils} c="green.7" />
          </div>
          <div className="kv-row">
            <span>{t('cash.out')}</span>
            <Money fils={st.outFils} c="red.7" />
          </div>
        </div>
        <Stack mt="lg" gap="xs">
          <Button fullWidth leftSection={<IconLock size={18} />} onClick={() => setCloseOpen(true)}>
            {t('cash.closeDay')}
          </Button>
          <Button fullWidth variant="light" onClick={() => setMoveOpen(true)}>
            {t('cash.addMovement')}
          </Button>
        </Stack>
        {st.lastClosing && (
          <Text size="xs" c="dimmed" mt="sm">
            {t('cash.lastClosed', { date: formatDateTime(st.lastClosing.closedAt) })}
          </Text>
        )}
      </Box>
      <Section title={t('cash.movements')} mt={0}>
        {data.lines.length === 0 ? (
          <EmptyState icon={IconCashRegister}>{t('cash.noMovements')}</EmptyState>
        ) : (
          <List>
            {/* The newest first, each on its operation's own day (a sheet's row on its day, not the import's) and
                with what was in the box after it — as the money sheet's "Cash Balance". A tap opens it; one with
                photos has a paperclip, as in the book. */}
            {data.lines.map(({ m, date, timed, after, entry }) => (
              <ListRow
                key={m.id}
                onClick={() => setOpened(m.id)}
                left={
                  <ThemeIcon variant="light" color={m.direction === 'in' ? 'green' : 'red'} size={38} radius="md">
                    {m.direction === 'in' ? <IconArrowDownLeft size={19} /> : <IconArrowUpRight size={19} />}
                  </ThemeIcon>
                }
                title={t(`cashReason.${m.reason}`)}
                subtitle={
                  <>
                    {data.photos.has(entry.id) && <IconPaperclip size={13} className="inline-icon" aria-label={t('ledger.proof')} />}
                    {/* A credit paid: to whom (v0.61). */}
                    {entry.owedTo && (
                      <>
                        <OwedName name={entry.owedTo} />
                        {' · '}
                      </>
                    )}
                    {`${timed ? whenSaid(t, m.at) : formatDate(date)}${m.note ? ` · ${m.note}` : ''}`}
                  </>
                }
                right={
                  <Stack gap={0} align="flex-end">
                    <Money fils={m.direction === 'in' ? m.amountFils : -m.amountFils} c={m.direction === 'in' ? 'green' : 'red'} size="sm" />
                    <Text size="xs" c="dimmed" className="tnum" style={{ whiteSpace: 'nowrap' }}>
                      {t('ledger.cashShort')} {formatAed(after).replace(/^-/, '−')}
                    </Text>
                  </Stack>
                }
              />
            ))}
          </List>
        )}
      </Section>
      <SheetFor value={open}>{(e, o) => <EntryDetails opened={o} entry={e} label={label(e)} cats={data.cats} onClose={() => setOpened(null)} />}</SheetFor>
      {!!closings?.length && (
        <Section title={t('cash.history')} mt={0}>
          <List>
            {closings.map((c) => (
              <ListRow
                key={c.id}
                title={closings.filter((x) => x.date === c.date).length > 1 ? formatDateTime(c.closedAt) : formatDate(c.date)}
                subtitle={`${t('cash.expected')} ${formatAed(c.expectedFils)} · ${t('cash.actual')} ${formatAed(c.actualFils)} · ${t('payment.method.card')} ${formatAed(c.cardTotalFils)}${c.comment ? ` · ${c.comment}` : ''}`}
                right={c.diffFils !== 0 ? <Badge color={c.diffFils < 0 ? 'red' : 'orange'}>{`${c.diffFils > 0 ? '+' : '−'}${formatAed(Math.abs(c.diffFils))}`}</Badge> : <Badge color="green">{t('cash.matched')}</Badge>}
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
          <div className="chip-row wrap" role="radiogroup" aria-label={t('common.comment')} data-cash-reasons>
            {(['collection', 'adjustment', 'other'] as const).map((r) => (
              <button key={r} type="button" className="chip" role="radio" aria-checked={reason === r} data-active={reason === r} onClick={() => setReason(r)}>
                {t(`cash.reasonChip.${r}`)}
              </button>
            ))}
          </div>
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
              <Alert color={diff < 0 ? 'red' : 'orange'} title={t(diff < 0 ? 'cash.short' : 'cash.over', { sum: formatAed(Math.abs(diff)) })} data-cash-diff={diff < 0 ? 'short' : 'over'} />
              <div className="chip-row wrap" data-diff-reasons>
                {(['change', 'unwritten', 'owner'] as const).map((r) => (
                  <button key={r} type="button" className="chip" data-active={comment === t(`cash.why.${r}`)} onClick={() => setComment(t(`cash.why.${r}`))}>
                    {t(`cash.why.${r}`)}
                  </button>
                ))}
              </div>
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

function ExpensesTab({ addOpen }: { addOpen: boolean }) {
  const { t } = useTranslation();
  const openPapers = useNavigate();
  const lang = useLang();
  const [open, setOpen] = useState(addOpen);
  const [shown, setShown] = useState<string | null>(null);
  const [month, setMonth] = useState(monthKey());
  const data = useScreenLiveQuery(async () => {
    const [list, cats, vehicles, credits, lenders] = await Promise.all([
      db.expenses.filter((e) => e.date.startsWith(month) && !e.voidedAt).reverse().sortBy('date'),
      db.expenseCategories.toArray(),
      db.vehicles.toArray(),
      loadCredits(),
      db.lenders.toArray(),
    ]);
    const photos = await proofIndex(list.map((e) => e.id));
    // On credit: what is still owed on each (counted as spent all the same — once, when it was taken).
    const owed = new Map(credits.map((c) => [c.expense.id, c.leftFils]));
    // A person who paid for it (v0.61): named on its row (a seller is named in the title already).
    return { list, cats, photos, owed, lenders: new Map(lenders.map((l) => [l.id, l.name])), vehicles: new Map(vehicles.map((v) => [v.id, v])) };
  }, [month]);
  // The open one is read by itself: moved to another month (v0.23), it stays open and follows; deleted — it closes.
  const opened = useScreenLiveQuery(async () => (shown ? ((await db.expenses.get(shown)) ?? null) : null), [shown]);
  const label = useCategoryLabel(data?.cats);
  // On a PC (v0.41): the month and its sums in a column, the expenses beside them.
  const phone = usePhone();
  if (!data) return <PageSkeleton />;
  const expense = opened && opened.id === shown && !opened.voidedAt ? opened : undefined;
  const entry = expense ? { ...expenseEntry(expense), cashAfter: 0, cardAfter: 0 } : undefined;
  const byCat = (id: string) => data.list.filter((e) => e.categoryId === id).reduce((s, e) => s + e.amountFils, 0);
  const total = data.list.reduce((s, e) => s + e.amountFils, 0);
  const cats = data.cats.filter((c) => c.active && (byCat(c.id) > 0 || c.monthlyLimitFils > 0)).sort((a, b) => byCat(b.id) - byCat(a.id));
  return (
    <Stack gap="lg" className={phone ? undefined : 'desk-expenses'}>
      <MonthField value={month} onChange={setMonth} />
      <Button size="md" color="red" variant="light" leftSection={<IconPlus size={20} />} onClick={() => setOpen(true)}>
        {t('expense.add')}
      </Button>
      {/* v1.05: the suppliers' paper invoices read in bulk — what they teach, not money. */}
      <Button size="md" variant="default" leftSection={<IconFiles size={20} />} onClick={() => openPapers('/money/papers')} data-route="/money/papers" data-open-papers>
        {t('papers.open')}
      </Button>
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
            const owed = e.method === 'credit' ? data.owed.get(e.id) ?? 0 : 0;
            return (
              <ListRow
                key={e.id}
                onClick={() => setShown(e.id)}
                left={
                  data.photos.has(e.id) ? (
                    <MediaImage id={data.photos.get(e.id)!} h={40} />
                  ) : (
                    <ThemeIcon variant="light" color={e.method === 'credit' ? 'orange' : 'gray'} size={40} radius="md">
                      <I size={19} />
                    </ThemeIcon>
                  )
                }
                title={`${c ? (lang === 'ru' ? c.nameRu : c.nameEn) : ''}${e.vendor ? ` · ${e.vendor}` : ''}`}
                subtitle={
                  <Group gap={6} wrap="nowrap" mt={2}>
                    {e.method === 'credit' && e.lenderId && data.lenders.get(e.lenderId) && (
                      <Text span size="xs" style={{ display: 'flex', minWidth: 0, flexShrink: 1 }}>
                        <OwedName name={data.lenders.get(e.lenderId)!} />
                      </Text>
                    )}
                    {e.vehicleId && data.vehicles.get(e.vehicleId) && <PlateText plate={data.vehicles.get(e.vehicleId)!.plate} size="xs" />}
                    <Text span size="xs" c="dimmed" lineClamp={2}>
                      {`${formatDate(e.date)} · ${wayLabel(t, e.method, 'out')}`}
                      {owed > 0 && (
                        <Text span inherit c="orange.7" fw={600}>
                          {` · ${t('debt.leftSum', { sum: formatAed(owed) })}`}
                        </Text>
                      )}
                      {`${e.vatFils ? ` · VAT ${formatAed(e.vatFils)}` : ''}${expenseNoteLine(e) ? ` · ${expenseNoteLine(e)}` : ''}${e.overLimitComment ? ` · ⚠ ${e.overLimitComment}` : ''}`}
                    </Text>
                  </Group>
                }
                right={<Money fils={e.amountFils} size="sm" />}
              />
            );
          })}
        </List>
      )}
      <EntrySheet opened={open} onClose={() => setOpen(false)} preset={OUT} />
      <SheetFor value={entry}>{(e, o) => <EntryDetails opened={o} entry={e} label={label(e)} cats={data.cats} onClose={() => setShown(null)} />}</SheetFor>
    </Stack>
  );
}

const OUT = { kind: 'out' as const };

function SalariesTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const [month, setMonth] = useState(monthKey());
  const data = useScreenLiveQuery(async () => ({ emps: await db.employees.filter((e) => e.active).toArray(), pays: await db.salaryPayments.where('month').equals(month).toArray() }), [month]);
  const [pay, setPay] = useState<{ employeeId: string; kind: SalaryPayment['kind'] } | null>(null);
  const [amount, setAmount] = useState<number>();
  const [method, setMethod] = useState<PayMethod>('cash');
  if (!data) return <PageSkeleton />;
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
                <PersonAvatar name={e.name} />
              }
              title={e.name}
              subtitle={
                <Stack gap={4}>
                  <span>{t(`role.${e.role}`)}</span>
                  {/* Paid this month out of the salary: the figures and a bar that turns green when it is all paid. */}
                  <span className="tnum" aria-label={`${t('salary.paid')} ${formatAed(paid)} ${t('problem.of')} ${formatAed(e.monthlySalaryFils)}`}>
                    <Text span inherit fw={600} c={pct >= 100 ? 'green.7' : 'var(--mantine-color-text)'}>
                      {formatAed(paid, lang, false)}
                    </Text>
                    {' / '}
                    {formatAed(e.monthlySalaryFils)}
                  </span>
                  {e.monthlySalaryFils > 0 && <Progress value={pct} size="sm" radius="xl" color={pct >= 100 ? 'green' : 'cobalt'} maw={220} />}
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
      <Modal opened={!!pay} onClose={() => setPay(null)} title={pay ? t(`salary.kind.${pay.kind}`) : ''}>
        <Stack>
          <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} autoFocus big />
          <MethodPicker value={method} onChange={setMethod} />
          <Button size="lg" disabled={!amount} loading={busy} onClick={() =>
              pay &&
              run(async () => {
                const id = await paySalary({ ...pay, month, amountFils: amount ?? 0, method });
                setPay(null);
                // v0.99 (audit Ф50): paid — said with «Отменить», as any money written.
                undoToast(t('salary.paidN', { sum: formatAed(amount ?? 0) }), t('common.undo'), () => void run(() => removeEntry({ source: 'expense', id })));
              })
            }
          >
            {t('common.save')}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

const MONEY_TABS = ['book', 'cash', 'expenses', 'salaries', 'debts'];

export function MoneyPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  // An old or mistyped link opens the book, not an empty screen.
  const asked = params.get('tab') ?? 'book';
  const tab = MONEY_TABS.includes(asked) ? asked : 'book';
  const navigate = useNavigate();
  // Past the book or the debts, the swipe goes on to the tab bar's places beside Money (v0.30).
  const mainEdge = (dir: 1 | -1) => void stepMainTab(navigate, hintNavigation, '/money', dir);
  const sw = useTabSwipe(MONEY_TABS, tab, (v) => setParams({ tab: v }, { replace: true }), mainEdge);
  // The debts' own pages (owed · we owe): past them, on to Money's tab beside — or past Money's, the tab bar's.
  const debtsEdge = (dir: 1 | -1) => {
    const to = MONEY_TABS[MONEY_TABS.indexOf('debts') + dir];
    if (to) setParams({ tab: to }, { replace: true });
    else mainEdge(dir);
  };
  return (
    <>
      <PageHeader title={t('nav.money')} right={<MoneySheetActions />} />
      <ScrollTabs
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        items={[
          { value: 'book', label: t('money.book') },
          { value: 'cash', label: t('money.cash') },
          { value: 'expenses', label: t('money.expenses') },
          { value: 'salaries', label: t('money.salaries') },
          { value: 'debts', label: t('money.debts') },
        ]}
      />
      {/* The tabs move like pages: the page follows the finger sideways, the next one comes in beside it. */}
      <div key={tab} ref={sw.panel} className="tab-panel">
        {tab === 'book' && <LedgerTab />}
        {tab === 'cash' && <CashTab />}
        {tab === 'expenses' && <ExpensesTab addOpen={params.get('add') === '1'} />}
        {tab === 'salaries' && <SalariesTab />}
        {tab === 'debts' && <DebtsOverview onEdge={debtsEdge} />}
      </div>
    </>
  );
}
