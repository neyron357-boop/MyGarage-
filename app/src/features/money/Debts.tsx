import { Box, Button, Group, Modal, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconBrandWhatsapp, IconCalendarCheck, IconCalendarDollar, IconCalendarMonth, IconCash, IconChevronDown, IconClockDollar, IconFileInvoice, IconFileZip, IconLock, IconReceipt, IconTrash, IconUser, IconUserDollar } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate, formatDate, monthLong } from '../../domain/dates';
import { byMonths, creditMonths, creditSince, spread, type Creditor, type DebtJob, type DebtMonth, type Debtor } from '../../domain/debts';
import { creditEntry } from '../../domain/ledger';
import { expenseNoteLine } from '../../domain/paperLines';
import { formatAed } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import { formatPlate } from '../../domain/plates';
import type { Customer, ExpenseCategory, PayMethod } from '../../domain/types';
import { companyDebtOf, loadCreditors, loadCustomerMonths, loadDebtors, payCredit, paySupplier, type CompanyDebt } from '../../services/debts';
import { openWhatsApp } from '../../services/messages';
import { debtInvoicesZip, statementPdf } from '../../services/debtDocs';
import { openPdf } from '../../services/documents';
import { removeEntry, restoreEntry } from '../../services/entries';
import { EmptyState, List, ListRow, Money, MoneyInput, PageSkeleton, PersonAvatar, PlateLine, undoToast } from '../../ui/components';
import { DayPill } from '../../ui/DateFields';
import { Fold } from '../../ui/Fold';
import { haptic } from '../../ui/haptics';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { shareOrDownload } from '../../ui/share';
import { useTabSwipe } from '../../ui/tabSwipe';
import { EntryDetails } from './LedgerTab';
import { EntrySheet, PursePicker, wayLabel, type EntryPreset } from './MoneyEntry';
import { ExpenseOwedTo, LenderSheet } from './OwedTo';

/*
 * Who owes whom (v0.20): the customers' debts as one card per customer — the board's "Debts" and "Money → Debts"
 * show the same cards with the same sums (services/debts.ts) — and the garage's own debts, the expenses taken on
 * credit, paid off in full or in parts.
 */

const tint = (color: string) => ({ background: `var(--mantine-color-${color}-6)` });
export const customerName = (c: Pick<Customer, 'type' | 'companyName' | 'name'>) => (c.type === 'company' && c.companyName ? c.companyName : c.name);

/**
 * A job a customer still owes on, in its card: the car, its number and day, the signed date; a tap opens the job.
 */
function DebtJobRow({ j, indent }: { j: DebtJob; indent?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const late = !!j.dueDate && j.dueDate < dubaiDate();
  return (
    <ListRow
      chevron
      onClick={() => navigate(`/orders/${j.order.id}`)}
      left={indent ? <span className="row-indent" aria-hidden /> : undefined}
      title={[j.vehicle.make, j.vehicle.model].filter(Boolean).join(' ') || formatPlate(j.vehicle.plate, lang)}
      subtitle={
        <Stack gap={2} align="flex-start">
          {/* Under its month (v0.62) the day is enough — the month and year are above it. */}
          <PlateLine plate={j.vehicle.plate}>{`№${j.order.number} · ${indent ? formatDate(j.since).slice(0, 5) : formatDate(j.since)}`}</PlateLine>
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
}

/**
 * One customer and what they owe (v0.30: folded — the name and the total; a tap unfolds it): each car with what each of
 * its jobs still owes, and the papers — take a payment, one sheet for all of it (a statement), every invoice in a .zip,
 * the customer's card.
 *
 * v0.62 (the user: «оплаты долгов компаний и клиентов по месяцам, выбор месяца и оплата — за некоторые месяцы инвойсы
 * оплачены»): what it owes by month, the oldest first — a month's row (what is left of it, «из» what its invoices came
 * to) opens the payment with that month picked and its sum; its jobs under it. The months paid (every invoice of them)
 * are folded under the ones owed. One month of this app's jobs only — the jobs as they were, by car (`byMonths`).
 */
const DebtorCard = memo(function DebtorCard({ d, onPay }: { d: Debtor; onPay: (customerId: string, month?: DebtMonth) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [past, setPast] = useState(false);
  const today = dubaiDate();
  const name = customerName(d.customer) || t('customer.noName');
  const jobs = d.cars.reduce((n, c) => n + c.jobs.length, 0);
  const before = d.history.reduce((n, m) => n + m.dues.length, 0);
  const late = d.cars.some((c) => c.jobs.some((j) => !!j.dueDate && j.dueDate < today));
  const monthly = byMonths(d.months);
  // Every month of its papers, read only once the card is opened (a card folded reads nothing more).
  const papers = useScreenLiveQuery(() => (open ? loadCustomerMonths(d.customer.id) : undefined), [open, d.customer.id]);
  const came = new Map((papers ?? []).map((m) => [m.month, m.totalFils]));
  const owing = new Set(d.months.map((m) => m.month));
  const paid = (papers ?? []).filter((m) => m.dueFils <= 0 && !owing.has(m.month)).reverse();
  const statement = () => run(async () => openPdf(await statementPdf(d.customer.id)));
  const archive = () => run(async () => shareOrDownload(await debtInvoicesZip(d.customer.id)));
  return (
    <List className={open ? "debt-card is-open" : "debt-card"}>
      <ListRow
        onClick={() => setOpen((o) => !o)}
        left={<PersonAvatar name={name} company={d.customer.type === 'company'} />}
        title={
          <Text span inherit fw={600} lineClamp={1}>
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
            <Money fils={d.totalFils} c="red" fw={700} roll />
            {late && <span className="debt-late-dot" title={t('debt.overdue')} />}
            <IconChevronDown size={18} className="debt-fold" color="var(--app-label-3)" aria-hidden />
          </Group>
        }
      />
      <Fold open={open}>
      {monthly
        ? d.months.map((m) => {
            const of = came.get(m.month) ?? 0;
            return (
              <Fragment key={m.month}>
                {/* A month: what is left of it; a tap — its works by day (v0.69, «нажал — открылись все работы по
                    датам»), where it is paid, closed, and a job forgotten added. Its invoices from before the app are in it. */}
                <ListRow
                  chevron
                  onClick={() => navigate(`/money/months?who=${d.customer.id}&month=${m.month}`)}
                  left={
                    <span className="row-icon" style={tint(d.customer.lockedMonths?.includes(m.month) ? 'gray' : 'green')} aria-hidden>
                      {d.customer.lockedMonths?.includes(m.month) ? <IconLock size={19} stroke={2} /> : <IconCalendarDollar size={19} stroke={2} />}
                    </span>
                  }
                  title={
                    <Text span inherit fw={600} data-debt-month={m.month}>
                      {monthLong(m.month, lang)}
                    </Text>
                  }
                  subtitle={[m.jobs.length ? t('debt.jobs', { count: m.jobs.length }) : '', m.history.length ? t('history.count', { count: m.history.length }) : '', of > m.dueFils ? t('debt.ofTotal', { sum: formatAed(of) }) : ''].filter(Boolean).join(' · ')}
                  right={<Money fils={m.dueFils} size="sm" c="red" fw={600} roll />}
                />
                {m.jobs.map((j) => (
                  <DebtJobRow key={j.order.id} j={j} indent />
                ))}
              </Fragment>
            );
          })
        : d.cars.map((car) => car.jobs.map((j) => <DebtJobRow key={j.order.id} j={j} />))}
      {/* The months paid (v0.62, «за некоторые месяцы инвойсы оплачены»): folded under the debts, the latest first. */}
      {paid.length > 0 && (
        <ListRow
          onClick={() => setPast((p) => !p)}
          title={
            <Text span inherit c="dimmed" fw={500} data-months-paid={paid.length}>
              {t('debt.monthsPaid', { count: paid.length })}
            </Text>
          }
          right={<IconChevronDown size={18} color="var(--app-label-3)" style={{ transform: past ? 'rotate(180deg)' : undefined, transition: 'transform var(--dur-2) var(--ease-out)' }} aria-hidden />}
        />
      )}
      {/* (The card's fold pins no height — ui/Fold.tsx: the months unfolded here push its tiles down, nothing is cut.) */}
      {past && (
        <div className="rise-enter">
          {paid.map((m) => (
            <ListRow
              key={m.month}
              chevron
              onClick={() => navigate(`/money/months?who=${d.customer.id}&month=${m.month}`)}
              left={
                <span className="row-icon" style={tint('teal')} aria-hidden>
                  <IconCalendarCheck size={19} stroke={2} />
                </span>
              }
              title={
                <Text span inherit c="dimmed" data-month-paid={m.month}>
                  {monthLong(m.month, lang)}
                </Text>
              }
              subtitle={t('history.count', { count: m.count })}
              right={<Money fils={m.totalFils} size="sm" c="dimmed" />}
            />
          ))}
        </div>
      )}
      <div className="debt-actions" data-n={jobs > 0 ? 6 : 5}>
        <button type="button" className="action-tile" onClick={() => onPay(d.customer.id)}>
          <span className="tile-icon" style={{ '--c': 'var(--mantine-color-green-6)' } as React.CSSProperties}>
            <IconCash size={21} stroke={1.9} aria-hidden />
          </span>
          <span>{t('debt.takeShort')}</span>
        </button>
        {/* Every month of its works (v0.69): open each, close a month, add a job forgotten. */}
        <button type="button" className="action-tile" data-debtor-months onClick={() => navigate(`/money/months?who=${d.customer.id}`)}>
          <span className="tile-icon" style={{ '--c': 'var(--mantine-color-indigo-6)' } as React.CSSProperties}>
            <IconCalendarMonth size={21} stroke={1.9} aria-hidden />
          </span>
          <span>{t('months.tile')}</span>
        </button>
        {/* Its payments (v0.62.2): what it paid, when, for which months, what was left after each. */}
        <button type="button" className="action-tile" data-debtor-payments onClick={() => navigate(`/money/payments?side=owed&who=${d.customer.id}`)}>
          <span className="tile-icon" style={{ '--c': 'var(--mantine-color-teal-6)' } as React.CSSProperties}>
            <IconReceipt size={21} stroke={1.9} aria-hidden />
          </span>
          <span>{t('debtPays.tile')}</span>
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
      </Fold>
    </List>
  );
});

/**
 * The customers who owe, one card each — whoever owes most first. A car or a job opens the job; "Take payment"
 * opens money in as a debt payment of that customer (spread over their jobs, the oldest first); a month (v0.62) — the
 * same with that month picked and what it owes offered.
 */
export function DebtorList({ debtors }: { debtors: Debtor[] }) {
  const [pay, setPay] = useState<EntryPreset | null>(null);
  return (
    <>
      <Stack gap="md" className="debt-cards">
        {debtors.map((d) => (
          <DebtorCard key={d.customer.id} d={d} onPay={(customerId, m) => setPay(m ? { debt: { customerId, months: [m.month] }, amountFils: m.dueFils } : { debt: { customerId } })} />
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
          subtitle={[formatDate(e.date), paid.length ? t('debt.ofTotal', { sum: formatAed(e.amountFils) }) : '', expenseNoteLine(e) ?? ''].filter(Boolean).join(' · ')}
          right={<Money fils={leftFils} size="sm" c="orange.7" roll />}
        />
      ))}
    </List>
  );
}

/**
 * Whom the garage owes (v0.50.2, the user: «один поставщик — раскрывающийся список, а там его кредиты»; v0.61: a person
 * who paid for the garage too — «если один человек несколько раз платил в долг в разное время на разные расходы»):
 * folded — the name and what is owed to him all; a tap unfolds his credits (each opens to pay it, or to see it), the
 * oldest first — for a person, where each was bought — and the ones paid off already under them; «Оплата» — one sum to
 * him, spread over his credits the oldest first; WhatsApp; a person's name and phone («Контакт»).
 */
const CreditorCard = memo(function CreditorCard({ c, catName, onOpen, onPay, onContact }: { c: Creditor<CompanyDebt>; catName: (id: string) => string; onOpen: (expenseId: string) => void; onPay: (c: Creditor<CompanyDebt>, month?: string) => void; onContact: (c: Creditor<CompanyDebt>) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [past, setPast] = useState(false);
  const phone = c.phone;
  // A person's credit says where it was bought (the seller is not who is owed).
  const where = (e: CompanyDebt['expense']) => (c.lender ? e.vendor ?? '' : '');
  // v0.62: credits of two months or more — by month (a supplier's monthly statement); a month's row pays that month.
  const months = creditMonths(c.credits);
  const credit = ({ expense: e, paid, leftFils }: CompanyDebt, indent?: boolean) => (
    <ListRow
      key={e.id}
      chevron
      onClick={() => onOpen(e.id)}
      left={indent ? <span className="row-indent" aria-hidden /> : undefined}
      title={[formatDate(e.date), catName(e.categoryId)].join(' · ')}
      subtitle={[where(e), paid.length ? t('debt.ofTotal', { sum: formatAed(e.amountFils) }) : '', expenseNoteLine(e) ?? ''].filter(Boolean).join(' · ') || undefined}
      right={<Money fils={leftFils} size="sm" c="orange.7" roll />}
    />
  );
  return (
    <List className={open ? 'debt-card is-open' : 'debt-card'} data-creditor={c.name}>
      <ListRow
        onClick={() => setOpen((o) => !o)}
        left={<PersonAvatar name={c.name} company={!c.lender} />}
        title={
          <Text span inherit fw={600} lineClamp={2}>
            {c.name}
          </Text>
        }
        subtitle={[phone ? formatPhone(phone) : '', t('debt.credits', { count: c.credits.length }), formatDate(c.credits[0].expense.date)].filter(Boolean).join(' · ')}
        right={
          <Group gap={6} wrap="nowrap" aria-expanded={open}>
            <Money fils={c.leftFils} c="orange.7" fw={700} roll />
            <IconChevronDown size={18} className="debt-fold" color="var(--app-label-3)" aria-hidden />
          </Group>
        }
      />
      <Fold open={open}>
        {months.length > 1
          ? months.map((m) => (
              <Fragment key={m.month}>
                <ListRow
                  onClick={() => onPay(c, m.month)}
                  left={
                    <span className="row-icon" style={tint('red')} aria-hidden>
                      <IconCalendarDollar size={19} stroke={2} />
                    </span>
                  }
                  title={
                    <Text span inherit fw={600} data-credit-month={m.month}>
                      {monthLong(m.month, lang)}
                    </Text>
                  }
                  subtitle={t('debt.credits', { count: m.credits.length })}
                  right={<Money fils={m.leftFils} size="sm" c="orange.7" fw={600} roll />}
                />
                {m.credits.map((d) => credit(d, true))}
              </Fragment>
            ))
          : c.credits.map((d) => credit(d))}
        {/* What was owed to him and is paid off already (v0.61): the whole story with him, folded under the debts. */}
        {c.settled.length > 0 && (
          <ListRow
            onClick={() => setPast((p) => !p)}
            title={
              <Text span inherit c="dimmed" fw={500} data-settled={c.settled.length}>
                {t('owed.settled', { count: c.settled.length })}
              </Text>
            }
            right={<IconChevronDown size={18} color="var(--app-label-3)" style={{ transform: past ? 'rotate(180deg)' : undefined, transition: 'transform var(--dur-2) var(--ease-out)' }} aria-hidden />}
          />
        )}
        {past && (
          <div className="rise-enter">
            {c.settled.map(({ expense: e }) => (
              <ListRow
                key={e.id}
                chevron
                onClick={() => onOpen(e.id)}
                title={
                  <Text span inherit c="dimmed">
                    {[formatDate(e.date), catName(e.categoryId)].join(' · ')}
                  </Text>
                }
                subtitle={[where(e), expenseNoteLine(e) ?? ''].filter(Boolean).join(' · ') || undefined}
                right={<Money fils={e.amountFils} size="sm" c="dimmed" />}
              />
            ))}
          </div>
        )}
        <div className="debt-actions">
          <button type="button" className="action-tile" data-pay-supplier onClick={() => onPay(c)}>
            <span className="tile-icon" style={{ '--c': 'var(--mantine-color-red-6)' } as React.CSSProperties}>
              <IconCash size={21} stroke={1.9} aria-hidden />
            </span>
            <span>{t('debt.takeShort')}</span>
          </button>
          {/* What was paid to him (v0.62.2), when, and what was left after each. */}
          <button type="button" className="action-tile" data-creditor-payments onClick={() => navigate(`/money/payments?side=owe&who=${encodeURIComponent(c.key)}`)}>
            <span className="tile-icon" style={{ '--c': 'var(--mantine-color-teal-6)' } as React.CSSProperties}>
              <IconReceipt size={21} stroke={1.9} aria-hidden />
            </span>
            <span>{t('debtPays.tile')}</span>
          </button>
          {phone && (
            <button type="button" className="action-tile" onClick={() => openWhatsApp(phone)}>
              <span className="tile-icon" style={{ '--c': 'var(--mantine-color-green-6)' } as React.CSSProperties}>
                <IconBrandWhatsapp size={21} stroke={1.9} aria-hidden />
              </span>
              <span>WhatsApp</span>
            </button>
          )}
          {c.lender && (
            <button type="button" className="action-tile" data-lender-contact onClick={() => onContact(c)}>
              <span className="tile-icon" style={{ '--c': 'var(--mantine-color-cobalt-6)' } as React.CSSProperties}>
                <IconUser size={21} stroke={1.9} aria-hidden />
              </span>
              <span>{t('owed.contact')}</span>
            </button>
          )}
        </div>
      </Fold>
    </List>
  );
});

/**
 * One sum to a seller (v0.50.2): all it is owed is offered (a part is typed over it); it goes to its credits the oldest
 * first — the rows under the sum say how much to which — on the day it was paid, by the way it was paid.
 * v0.62: credits of two months or more — the months as chips: those picked go first, and what they owe is offered
 * (a month's row in the card opens the sheet with it picked).
 */
function SupplierPaySheet({ c, months: start, opened, onClose }: { c: Creditor<CompanyDebt>; months: string[]; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const months = creditMonths(c.credits);
  const owes = (picked: string[]) => months.reduce((a, m) => a + (picked.includes(m.month) ? m.leftFils : 0), 0);
  const [picked, setPicked] = useState(start);
  const [amount, setAmount] = useState<number | undefined>(start.length ? owes(start) : c.leftFils);
  const [method, setMethod] = useState<PayMethod>('cash');
  const [date, setDate] = useState(dubaiDate());
  const first = months.filter((m) => picked.includes(m.month)).flatMap((m) => m.credits.map((d) => d.expense.id));
  const parts = spread(amount ?? 0, c.credits.map((d) => ({ key: d.expense.id, dueFils: d.leftFils, since: creditSince(d.expense) })), first).parts;
  // A month picked or let go: the sum follows while it is what the months picked owe (a sum typed over it stays).
  const toggle = (month: string) => {
    const next = picked.includes(month) ? picked.filter((x) => x !== month) : [...picked, month];
    if (!amount || amount === (picked.length ? owes(picked) : c.leftFils)) setAmount(next.length ? owes(next) : c.leftFils);
    setPicked(next);
  };
  return (
    <Modal opened={opened} onClose={onClose} title={c.name}>
      <Stack gap="md">
        <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} big />
        {months.length > 1 && (
          <div className="chip-row wrap">
            {months.map((m) => (
              <button key={m.month} type="button" className="chip" data-active={picked.includes(m.month)} data-pay-month={m.month} onClick={() => toggle(m.month)}>
                {monthLong(m.month, lang)}
                <span className="chip-note">{formatAed(m.leftFils)}</span>
              </button>
            ))}
          </div>
        )}
        {parts.length > 0 && (
          <List>
            {parts.map((p) => {
              const d = c.credits.find((x) => x.expense.id === p.key)!;
              return (
                <ListRow
                  key={p.key}
                  title={formatDate(d.expense.date)}
                  subtitle={[c.lender ? d.expense.vendor ?? '' : '', expenseNoteLine(d.expense) ?? ''].filter(Boolean).join(' · ') || undefined}
                  right={
                    <Text size="sm" className="tnum">
                      <Money fils={p.amountFils} size="sm" /> <span className="chip-note">{t('debt.ofTotal', { sum: formatAed(d.leftFils) })}</span>
                    </Text>
                  }
                />
              );
            })}
          </List>
        )}
        <Group gap="xs">
          <DayPill value={date} onChange={setDate} />
        </Group>
        <PursePicker value={method} onChange={(m) => setMethod(m === 'credit' ? 'cash' : m)} kind="out" />
        <Button
          size="lg"
          color="red"
          leftSection={<IconCash size={20} />}
          loading={busy}
          disabled={!amount || amount > c.leftFils}
          onClick={() =>
            run(async () => {
              await paySupplier(
                c.credits.map((d) => d.expense.id),
                { amountFils: amount ?? 0, method, date, first },
              );
              haptic('success');
              onClose();
            }, 'debt.paid')
          }
        >
          {t('debt.pay')}
          {amount ? ` · ${formatAed(amount)}` : ''}
        </Button>
      </Stack>
    </Modal>
  );
}

/** What the garage owes, by whom: a card per seller or person; a credit owed to nobody yet as its own row. */
export function CreditorList({ creditors, loose, cats, onOpen }: { creditors: Creditor<CompanyDebt>[]; loose: CompanyDebt[]; cats?: ExpenseCategory[]; onOpen: (expenseId: string) => void }) {
  const catName = useCategoryName(cats);
  const [pay, setPay] = useState<{ c: Creditor<CompanyDebt>; months: string[] } | null>(null);
  const [contact, setContact] = useState<Creditor<CompanyDebt> | null>(null);
  return (
    <>
      <Stack gap="md" className="debt-cards">
        {creditors.map((c) => (
          <CreditorCard key={c.key} c={c} catName={catName} onOpen={onOpen} onPay={(c, month) => setPay({ c, months: month ? [month] : [] })} onContact={setContact} />
        ))}
        {loose.length > 0 && <CompanyDebtList list={loose} cats={cats} onOpen={onOpen} />}
      </Stack>
      <SheetFor value={pay}>{(p, o) => <SupplierPaySheet c={p.c} months={p.months} opened={o} onClose={() => setPay(null)} />}</SheetFor>
      <SheetFor value={contact?.lender}>{(l, o) => <LenderSheet lender={l} opened={o} onClose={() => setContact(null)} />}</SheetFor>
    </>
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
              {[formatDate(d.expense.date), expenseNoteLine(d.expense) ?? ''].filter(Boolean).join(' · ')}
            </Text>
          </Box>
          {/* Whom it is owed to (v0.61): said here, changed with a tap. */}
          <ExpenseOwedTo expenseId={expenseId} />
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
  const navigate = useNavigate();
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
    const [debtors, owe, cats] = await Promise.all([loadDebtors(), loadCreditors(), db.expenseCategories.toArray()]);
    return { debtors, owe, cats };
  }, []);
  const [credit, setCredit] = useState<string | null>(null);
  if (!data) return <PageSkeleton />;
  const owed = data.debtors.reduce((s, d) => s + d.totalFils, 0);
  const owe = data.owe.creditors.reduce((s, c) => s + c.leftFils, 0) + data.owe.loose.reduce((s, d) => s + d.leftFils, 0);
  // Whom the garage owes: one seller is one (v0.50.2), however many credits it has.
  const owing = data.owe.creditors.length + data.owe.loose.length;
  return (
    <Stack gap="lg">
      <SimpleGrid cols={2} spacing="sm" role="tablist">
        {(
          [
            ['owed', t('debt.owed'), owed, 'red', data.debtors.length],
            ['owe', t('debt.weOwe'), owe, 'orange', owing],
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
      {/* The payments of debts of a period (v0.62.2): paid, owed, after each. */}
      <List>
        <ListRow
          chevron
          onClick={() => navigate(`/money/payments?side=${side}`)}
          left={
            <span className="row-icon" style={tint('teal')} aria-hidden>
              <IconReceipt size={19} stroke={2} />
            </span>
          }
          title={
            <Text span inherit fw={600} data-debt-payments>
              {t('debtPays.title')}
            </Text>
          }
        />
      </List>
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
        ) : owing ? (
          <CreditorList creditors={data.owe.creditors} loose={data.owe.loose} cats={data.cats} onOpen={setCredit} />
        ) : (
          <EmptyState icon={IconClockDollar} title={t('debt.companyNone')} />
        )}
      </div>
      <SheetFor value={credit}>{(id, o) => <CreditSheet expenseId={id} opened={o} onClose={() => setCredit(null)} />}</SheetFor>
    </Stack>
  );
}
