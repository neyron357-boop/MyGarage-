import { Box, Button, Collapse, Group, Modal, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCash, IconChevronDown, IconClockDollar, IconFileInvoice, IconFileText, IconFileZip, IconTrash, IconUser, IconUserDollar } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate, formatDate, monthLong } from '../../domain/dates';
import type { Debtor } from '../../domain/debts';
import { creditEntry } from '../../domain/ledger';
import { formatAed } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import { formatPlate } from '../../domain/plates';
import type { Customer, ExpenseCategory, PayMethod } from '../../domain/types';
import { companyDebtOf, loadCompanyDebts, loadDebtors, payCredit, type CompanyDebt } from '../../services/debts';
import { debtInvoicesZip, statementPdf } from '../../services/debtDocs';
import { openPdf } from '../../services/documents';
import { removeEntry, restoreEntry } from '../../services/entries';
import { EmptyState, List, ListRow, Money, MoneyInput, PageSkeleton, PersonAvatar, PlateLine, undoToast } from '../../ui/components';
import { DayPill } from '../../ui/DateFields';
import { haptic } from '../../ui/haptics';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { shareOrDownload } from '../../ui/share';
import { useTabSwipe } from '../../ui/tabSwipe';
import { EntryDetails } from './LedgerTab';
import { EntrySheet, PursePicker, wayLabel, type EntryPreset } from './MoneyEntry';

/*
 * Who owes whom (v0.20): the customers' debts as one card per customer — the board's "Debts" and "Money → Debts"
 * show the same cards with the same sums (services/debts.ts) — and the garage's own debts, the expenses taken on
 * credit, paid off in full or in parts.
 */

const tint = (color: string) => ({ background: `var(--mantine-color-${color}-6)` });
export const customerName = (c: Pick<Customer, 'type' | 'companyName' | 'name'>) => (c.type === 'company' && c.companyName ? c.companyName : c.name);

/**
 * One customer and what they owe (v0.30: folded — the name and the total; a tap unfolds it): each car with what each of
 * its jobs still owes, and the papers — take a payment, one sheet for all of it (a statement), every invoice in a .zip,
 * the customer's card.
 */
const DebtorCard = memo(function DebtorCard({ d, onPay }: { d: Debtor; onPay: (customerId: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const today = dubaiDate();
  const name = customerName(d.customer) || t('customer.noName');
  const jobs = d.cars.reduce((n, c) => n + c.jobs.length, 0);
  const before = d.history.reduce((n, m) => n + m.dues.length, 0);
  const late = d.cars.some((c) => c.jobs.some((j) => !!j.dueDate && j.dueDate < today));
  const statement = () => run(async () => openPdf(await statementPdf(d.customer.id)));
  const archive = () => run(async () => shareOrDownload(await debtInvoicesZip(d.customer.id)));
  return (
    <List className={open ? "debt-card is-open" : "debt-card"}>
      <ListRow
        onClick={() => setOpen((o) => !o)}
        left={<PersonAvatar name={name} company={d.customer.type === 'company'} />}
        title={
          <Text span inherit fw={650} lineClamp={1}>
            {name}
          </Text>
        }
        subtitle={[
          d.customer.phone ? formatPhone(d.customer.phone) : '',
          d.cars.length ? t('debt.cars', { count: d.cars.length }) : '',
          jobs ? t('debt.jobs', { count: jobs }) : '',
          before ? t('history.count', { count: before }) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        right={
          <Group gap={6} wrap="nowrap" aria-expanded={open}>
            <Money fils={d.totalFils} c="red" fw={750} roll />
            {late && <span className="debt-late-dot" title={t('debt.overdue')} />}
            <IconChevronDown size={18} className="debt-fold" color="var(--app-label-3)" aria-hidden />
          </Group>
        }
      />
      <Collapse in={open} transitionDuration={260}>
      {d.cars.map((car) =>
        car.jobs.map((j) => {
          const late = !!j.dueDate && j.dueDate < today;
          return (
            <ListRow
              key={j.order.id}
              chevron
              onClick={() => navigate(`/orders/${j.order.id}`)}
              title={[car.vehicle.make, car.vehicle.model].filter(Boolean).join(' ') || formatPlate(car.vehicle.plate, lang)}
              subtitle={
                <Stack gap={2} align="flex-start">
                  <PlateLine plate={car.vehicle.plate}>{`№${j.order.number} · ${formatDate(j.since)}`}</PlateLine>
                  {j.dueDate && (
                    <Text span inherit c={late ? 'red' : undefined}>
                      {t('debt.until', { date: formatDate(j.dueDate) })}
                      {late ? ` · ${t('debt.overdue')}` : ''}
                    </Text>
                  )}
                </Stack>
              }
              right={<Money fils={j.dueFils} size="sm" roll />}
            />
          );
        }),
      )}
      {/* The invoices from before the app (v0.47): a month a row — its statement — what is still owed on it. */}
      {d.history.map((m) => (
        <ListRow
          key={m.month}
          chevron
          onClick={() => navigate(`/customers/${d.customer.id}`)}
          left={
            <span className="row-icon" style={tint('grape')} aria-hidden>
              <IconFileText size={19} stroke={2} />
            </span>
          }
          title={monthLong(m.month, lang)}
          subtitle={t('history.count', { count: m.dues.length })}
          right={<Money fils={m.dueFils} size="sm" roll />}
        />
      ))}
      <div className="debt-actions">
        <button type="button" className="action-tile" onClick={() => onPay(d.customer.id)}>
          <span className="tile-icon" style={{ '--c': 'var(--mantine-color-green-6)' } as React.CSSProperties}>
            <IconCash size={21} stroke={1.9} aria-hidden />
          </span>
          <span>{t('debt.takeShort')}</span>
        </button>
        <button type="button" className="action-tile" disabled={busy} onClick={() => void statement()}>
          <span className="tile-icon" style={{ '--c': 'var(--mantine-color-grape-6)' } as React.CSSProperties}>
            <IconFileInvoice size={21} stroke={1.9} aria-hidden />
          </span>
          <span>{t('debt.statement')}</span>
        </button>
        {/* The invoices of this app's jobs (those from before it are in the customer's monthly reports). */}
        {jobs > 0 && (
          <button type="button" className="action-tile" disabled={busy} onClick={() => void archive()}>
            <span className="tile-icon" style={{ '--c': 'var(--mantine-color-cobalt-6)' } as React.CSSProperties}>
              <IconFileZip size={21} stroke={1.9} aria-hidden />
            </span>
            <span>{t('debt.zip')}</span>
          </button>
        )}
        <button type="button" className="action-tile" onClick={() => navigate(`/customers/${d.customer.id}`)}>
          <span className="tile-icon" style={{ '--c': 'var(--mantine-color-indigo-6)' } as React.CSSProperties}>
            <IconUser size={21} stroke={1.9} aria-hidden />
          </span>
          <span>{t('debt.customerCard')}</span>
        </button>
      </div>
      </Collapse>
    </List>
  );
});

/**
 * The customers who owe, one card each — whoever owes most first. A car or a job opens the job; "Take payment"
 * opens money in as a debt payment of that customer (spread over their jobs, the oldest first).
 */
export function DebtorList({ debtors }: { debtors: Debtor[] }) {
  const [pay, setPay] = useState<EntryPreset | null>(null);
  return (
    <>
      <Stack gap="md" className="debt-cards">
        {debtors.map((d) => (
          <DebtorCard key={d.customer.id} d={d} onPay={(customerId) => setPay({ debt: { customerId } })} />
        ))}
      </Stack>
      <SheetFor value={pay}>{(p, o) => <EntrySheet opened={o} onClose={() => setPay(null)} preset={p} />}</SheetFor>
    </>
  );
}

function useCategoryName(cats?: ExpenseCategory[]) {
  const { t } = useTranslation();
  const lang = useLang();
  return (id: string) => {
    const c = cats?.find((x) => x.id === id);
    return c ? (lang === 'ru' ? c.nameRu : c.nameEn) : t('ledger.out');
  };
}

/** What the garage owes: each expense on credit with what is left of it; a tap opens it to pay. */
export function CompanyDebtList({ list, cats, onOpen }: { list: CompanyDebt[]; cats?: ExpenseCategory[]; onOpen: (expenseId: string) => void }) {
  const { t } = useTranslation();
  const catName = useCategoryName(cats);
  return (
    <List animate>
      {list.map(({ expense: e, paid, leftFils }) => (
        <ListRow
          key={e.id}
          chevron
          onClick={() => onOpen(e.id)}
          left={
            <span className="row-icon" style={tint('orange')} aria-hidden>
              <IconClockDollar size={19} stroke={2} />
            </span>
          }
          title={[catName(e.categoryId), e.vendor].filter(Boolean).join(' · ')}
          subtitle={[formatDate(e.date), paid.length ? t('debt.ofTotal', { sum: formatAed(e.amountFils) }) : '', e.note ?? ''].filter(Boolean).join(' · ')}
          right={<Money fils={leftFils} size="sm" c="orange.7" roll />}
        />
      ))}
    </List>
  );
}

/**
 * An expense on credit, opened: what is left to pay and what was paid; pay all of it or a part, on the day it was paid
 * (v0.23: an earlier day too) — the money goes by the way it is paid (cash: out of the cash box). A payment opens as an
 * operation of the book (its day, sum and way change; it can be deleted); «Удалить» deletes the debt itself, with what
 * was paid towards it — «Отменить» right after.
 */
export function CreditSheet({ expenseId, opened, onClose }: { expenseId: string; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const data = useLiveQuery(async () => ({ d: (await companyDebtOf(expenseId)) ?? null, cats: await db.expenseCategories.toArray() }), [expenseId]);
  const catName = useCategoryName(data?.cats);
  const [amount, setAmount] = useState<number>();
  const [method, setMethod] = useState<PayMethod>('cash');
  const [date, setDate] = useState(dubaiDate());
  const [shown, setShown] = useState<string | null>(null);
  const left = data?.d?.leftFils;
  // The whole remainder is offered (a part is typed over it); after a payment — what is left now.
  useEffect(() => {
    if (left !== undefined) setAmount(left > 0 ? left : undefined);
  }, [left]);
  const d = data?.d;
  const title = d ? [catName(d.expense.categoryId), d.expense.vendor].filter(Boolean).join(' · ') : t('debt.company');
  const payment = d && shown ? d.paid.find((p) => p.id === shown) : undefined;
  const entry = d && payment ? { ...creditEntry(payment, d.expense), cashAfter: 0, cardAfter: 0 } : undefined;
  const remove = () =>
    run(async () => {
      const removed = await removeEntry({ source: 'expense', id: expenseId });
      onClose();
      haptic('light');
      undoToast(t('debt.removed'), t('common.undo'), () => void restoreEntry(removed));
    });
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      {!data ? (
        <PageSkeleton variant="detail" />
      ) : !d ? (
        <EmptyState icon={IconClockDollar} title={t('debt.companyNone')} />
      ) : (
        <Stack gap="md">
          <Box className="kv-rows" mt={0}>
            <Group justify="space-between" align="baseline" wrap="nowrap">
              <Text fz={28} c={d.leftFils > 0 ? 'orange.7' : 'green.7'} data-credit-left={d.leftFils}>
                <Money fils={d.leftFils} display roll />
              </Text>
              <Text size="sm" c="dimmed" className="tnum">
                {t('debt.ofTotal', { sum: formatAed(d.expense.amountFils) })}
              </Text>
            </Group>
            <Text size="sm" c="dimmed">
              {[formatDate(d.expense.date), d.expense.note ?? ''].filter(Boolean).join(' · ')}
            </Text>
          </Box>
          {d.paid.length > 0 && (
            <Box>
              <div className="group-title">{t('debt.payments')}</div>
              <List animate>
                {d.paid.map((p) => (
                  <ListRow
                    key={p.id}
                    chevron
                    onClick={() => setShown(p.id)}
                    title={formatDate(p.date)}
                    subtitle={[wayLabel(t, p.method, 'out'), p.note ?? ''].filter(Boolean).join(' · ')}
                    right={<Money fils={-p.amountFils} size="sm" />}
                  />
                ))}
              </List>
            </Box>
          )}
          {d.leftFils > 0 ? (
            <>
              <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} big />
              <Group gap="xs">
                <DayPill value={date} onChange={setDate} />
              </Group>
              <PursePicker value={method} onChange={(m) => setMethod(m === 'credit' ? 'cash' : m)} kind="out" />
              <Button
                size="lg"
                color="red"
                leftSection={<IconCash size={20} />}
                loading={busy}
                disabled={!amount || amount > d.leftFils}
                onClick={() =>
                  run(async () => {
                    await payCredit(expenseId, { amountFils: amount ?? 0, method, date });
                    haptic('success');
                  }, 'debt.paid')
                }
              >
                {t('debt.pay')}
                {amount ? ` · ${formatAed(amount)}` : ''}
              </Button>
            </>
          ) : (
            <Text fw={600} c="green.7">
              {t('debt.paidOff')}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" color="red" loading={busy} leftSection={<IconTrash size={18} />} onClick={() => void remove()}>
              {t('debt.delete')}
            </Button>
          </Group>
        </Stack>
      )}
      <SheetFor value={entry}>{(e, o) => <EntryDetails opened={o} entry={e} label={t('cashReason.credit_payment')} cats={data?.cats} onClose={() => setShown(null)} />}</SheetFor>
    </Modal>
  );
}

const DEBT_TABS = ['owed', 'owe'] as const;
type DebtTab = (typeof DEBT_TABS)[number];

/**
 * "Money → Debts": who owes the garage (one card per customer) and what the garage owes (expenses on credit) — two
 * tabs (v0.30): the two sums are the tabs, the list under them is turned by a swipe; past the first or the last, the
 * swipe goes on to Money's own tabs (`onEdge`).
 */
export function DebtsOverview({ onEdge }: { onEdge?: (dir: 1 | -1) => void }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const side: DebtTab = params.get('side') === 'owe' ? 'owe' : 'owed';
  const setSide = (v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('side', v);
        return n;
      },
      { replace: true },
    );
  const sw = useTabSwipe(DEBT_TABS, side, setSide, onEdge);
  const data = useScreenLiveQuery(async () => {
    const [debtors, company, cats] = await Promise.all([loadDebtors(), loadCompanyDebts(), db.expenseCategories.toArray()]);
    return { debtors, company, cats };
  }, []);
  const [credit, setCredit] = useState<string | null>(null);
  if (!data) return <PageSkeleton />;
  const owed = data.debtors.reduce((s, d) => s + d.totalFils, 0);
  const owe = data.company.reduce((s, d) => s + d.leftFils, 0);
  return (
    <Stack gap="lg">
      <SimpleGrid cols={2} spacing="sm" role="tablist">
        {(
          [
            ['owed', t('debt.owed'), owed, 'red', data.debtors.length],
            ['owe', t('debt.weOwe'), owe, 'orange', data.company.length],
          ] as const
        ).map(([key, label, fils, color, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={side === key}
            className="kpi kpi-tab"
            data-active={side === key || undefined}
            data-side={key}
            style={{ '--kpi-c': `var(--mantine-color-${color}-6)` } as React.CSSProperties}
            onClick={() => setSide(key)}
          >
            <span className="eyebrow">
              {label}
              {n > 0 && <span className="count">{n}</span>}
            </span>
            <span className="value" style={fils > 0 ? { color: `var(--mantine-color-${color}-text, var(--mantine-color-${color}-6))` } : undefined}>
              <Money fils={fils} roll />
            </span>
          </button>
        ))}
      </SimpleGrid>
      {/* The list under the sums turns like a page (its own swipe, inside Money's). */}
      <div key={side} ref={sw.panel} data-own-swipe className="debt-panel">
        {side === 'owed' ? (
          data.debtors.length ? (
            <DebtorList debtors={data.debtors} />
          ) : (
            <EmptyState icon={IconUserDollar} title={t('debt.none')}>
              {t('debt.noneHint')}
            </EmptyState>
          )
        ) : data.company.length ? (
          <CompanyDebtList list={data.company} cats={data.cats} onOpen={setCredit} />
        ) : (
          <EmptyState icon={IconClockDollar} title={t('debt.companyNone')} />
        )}
      </div>
      <SheetFor value={credit}>{(id, o) => <CreditSheet expenseId={id} opened={o} onClose={() => setCredit(null)} />}</SheetFor>
    </Stack>
  );
}
