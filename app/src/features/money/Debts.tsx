import { Box, Button, Group, Modal, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCash, IconClockDollar, IconUserDollar } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate, formatDate } from '../../domain/dates';
import type { Debtor } from '../../domain/debts';
import { formatAed } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import { formatPlate } from '../../domain/plates';
import type { CreditPayment, Customer, ExpenseCategory, PayMethod } from '../../domain/types';
import { companyDebtOf, loadCompanyDebts, loadDebtors, payCredit, voidCreditPayment, type CompanyDebt } from '../../services/debts';
import { ConfirmModal, EmptyState, Kpi, List, ListRow, Money, MoneyInput, PageSkeleton, PersonAvatar, PlateLine } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { EntrySheet, PursePicker, type EntryPreset } from './MoneyEntry';

/*
 * Who owes whom (v0.20): the customers' debts as one card per customer — the board's "Debts" and "Money → Debts"
 * show the same cards with the same sums (services/debts.ts) — and the garage's own debts, the expenses taken on
 * credit, paid off in full or in parts.
 */

const tint = (color: string) => ({ background: `var(--mantine-color-${color}-6)` });
export const customerName = (c: Pick<Customer, 'type' | 'companyName' | 'name'>) => (c.type === 'company' && c.companyName ? c.companyName : c.name);

/** One customer and what they owe: the total, then each car with what each of its jobs still owes. */
const DebtorCard = memo(function DebtorCard({ d, onPay }: { d: Debtor; onPay: (customerId: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const today = dubaiDate();
  const name = customerName(d.customer) || t('customer.noName');
  return (
    <List className="debt-card">
      <ListRow
        onClick={() => navigate(`/customers/${d.customer.id}`)}
        left={<PersonAvatar name={name} company={d.customer.type === 'company'} />}
        title={
          <Text span inherit fw={650} lineClamp={1}>
            {name}
          </Text>
        }
        subtitle={[d.customer.phone ? formatPhone(d.customer.phone) : '', t('debt.cars', { count: d.cars.length })].filter(Boolean).join(' · ')}
        right={<Money fils={d.totalFils} c="red" fw={750} roll />}
      />
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
      <ListRow
        onClick={() => onPay(d.customer.id)}
        left={
          <span className="row-icon" style={tint('green')} aria-hidden>
            <IconCash size={19} stroke={2} />
          </span>
        }
        title={
          <Text span inherit fw={600} c="green.7">
            {t('debt.take')}
          </Text>
        }
      />
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
 * An expense on credit, opened: what is left to pay and what was paid; pay all of it or a part — the money goes
 * now, by the way it is paid (cash: out of the cash box). A payment made by mistake is cancelled from its row.
 */
export function CreditSheet({ expenseId, opened, onClose }: { expenseId: string; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const data = useLiveQuery(async () => ({ d: (await companyDebtOf(expenseId)) ?? null, cats: await db.expenseCategories.toArray() }), [expenseId]);
  const catName = useCategoryName(data?.cats);
  const [amount, setAmount] = useState<number>();
  const [method, setMethod] = useState<PayMethod>('cash');
  const [cancel, setCancel] = useState<CreditPayment | null>(null);
  const left = data?.d?.leftFils;
  // The whole remainder is offered (a part is typed over it); after a payment — what is left now.
  useEffect(() => {
    if (left !== undefined) setAmount(left > 0 ? left : undefined);
  }, [left]);
  const d = data?.d;
  const title = d ? [catName(d.expense.categoryId), d.expense.vendor].filter(Boolean).join(' · ') : t('debt.company');
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
                    onClick={() => setCancel(p)}
                    title={formatDate(p.date)}
                    subtitle={[t(`payment.method.${p.method}`), p.note ?? ''].filter(Boolean).join(' · ')}
                    right={<Money fils={-p.amountFils} size="sm" />}
                  />
                ))}
              </List>
            </Box>
          )}
          {d.leftFils > 0 ? (
            <>
              <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} big />
              <PursePicker value={method} onChange={(m) => setMethod(m === 'credit' ? 'cash' : m)} kind="out" />
              <Button
                size="lg"
                color="red"
                leftSection={<IconCash size={20} />}
                loading={busy}
                disabled={!amount || amount > d.leftFils}
                onClick={() =>
                  run(async () => {
                    await payCredit(expenseId, { amountFils: amount ?? 0, method });
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
        </Stack>
      )}
      <ConfirmModal
        opened={!!cancel}
        onClose={() => setCancel(null)}
        title={t('debt.cancelPaymentTitle')}
        confirmLabel={t('debt.cancelPayment')}
        color="red"
        onConfirm={() =>
          run(async () => {
            if (cancel) await voidCreditPayment(cancel.id);
            setCancel(null);
            return true;
          }, 'debt.cancelled')
        }
      >
        <Text size="sm">{t(cancel?.method === 'cash' ? 'ledger.voidTextCash' : 'ledger.voidText')}</Text>
      </ConfirmModal>
    </Modal>
  );
}

/** "Money → Debts": who owes the garage (one card per customer) and what the garage owes (expenses on credit). */
export function DebtsOverview() {
  const { t } = useTranslation();
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
      <SimpleGrid cols={2} spacing="sm">
        <Kpi label={t('debt.owed')} value={<Money fils={owed} roll />} color={owed > 0 ? 'red' : undefined} />
        <Kpi label={t('debt.weOwe')} value={<Money fils={owe} roll />} color={owe > 0 ? 'orange' : undefined} />
      </SimpleGrid>
      <Box>
        <div className="group-title">
          {t('debt.customers')}
          {data.debtors.length > 0 && <span className="count">{data.debtors.length}</span>}
        </div>
        {data.debtors.length ? <DebtorList debtors={data.debtors} /> : <EmptyState icon={IconUserDollar} title={t('debt.none')}>{t('debt.noneHint')}</EmptyState>}
      </Box>
      <Box>
        <div className="group-title">
          {t('debt.company')}
          {data.company.length > 0 && <span className="count">{data.company.length}</span>}
        </div>
        {data.company.length ? <CompanyDebtList list={data.company} cats={data.cats} onOpen={setCredit} /> : <EmptyState icon={IconClockDollar} title={t('debt.companyNone')} />}
      </Box>
      <SheetFor value={credit}>{(id, o) => <CreditSheet expenseId={id} opened={o} onClose={() => setCredit(null)} />}</SheetFor>
    </Stack>
  );
}
