import { Box, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconFileInvoice, IconReceipt } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { periodRange, type PaymentRow, type PeriodKind } from '../../domain/account';
import { dayHeading, dubaiDate, formatDate, monthKey, monthLong } from '../../domain/dates';
import type { LedgerEntry } from '../../domain/ledger';
import { formatAed } from '../../domain/money';
import { loadDebtPayments, type DebtSide, type PayOwner } from '../../services/account';
import { statementPdf } from '../../services/debtDocs';
import { openPdf } from '../../services/documents';
import { DataTable, type Column } from '../../ui/DataTable';
import { DateField, MonthField } from '../../ui/DateFields';
import { EmptyState, Kpi, List, ListRow, Money, PageHeader, PageSkeleton, PersonAvatar, ScrollTabs } from '../../ui/components';
import { useDesk } from '../../ui/desk';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { EntryDetails, useCategoryLabel } from './LedgerTab';
import { wayLabel } from './MoneyEntry';

/*
 * «Платежи» (v0.62.2, the user: «после оплаты долга, например, за несколько месяцев — отдельная таблица этих платежей:
 * сколько заплатили, сколько осталось, с выбором периода»). The payments of debts of a period — customers' («Оплата
 * долга», a job paid after its car left) or the garage's (its credits paid): what was paid in it and what is owed now,
 * for everyone or one; each payment — the months it paid, how, and what was owed right after it; a tap opens it as an
 * operation of the money book. One customer — its statement of account of the period (PDF: pdf/statement.tsx).
 * Reached from «Деньги → Долги» (the side open there) and from a debtor's or a creditor's card (that one picked).
 */

const PERIODS: PeriodKind[] = ['month', 'year', 'all', 'custom'];

export function DebtPaymentsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const desk = useDesk();
  const { run, busy } = useAction();
  const [params, setParams] = useSearchParams();
  const side: DebtSide = params.get('side') === 'owe' ? 'owe' : 'owed';
  const who = params.get('who') ?? '';
  const set = (patch: Record<string, string>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
        return n;
      },
      { replace: true },
    );
  const [kind, setKind] = useState<PeriodKind>(who ? 'all' : 'month');
  const [month, setMonth] = useState(monthKey());
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const today = dubaiDate();
  const { from, to } = periodRange(kind, { month, ...custom }, today);
  const data = useScreenLiveQuery(async () => {
    const [view, cats] = await Promise.all([loadDebtPayments(side, from, to), db.expenseCategories.toArray()]);
    return { ...view, cats };
  }, [side, from, to]);
  const label = useCategoryLabel(data?.cats);
  const [open, setOpen] = useState<LedgerEntry | null>(null);
  const owners = data?.owners ?? [];
  const owner = owners.find((o) => o.key === who);
  const rows = (data?.rows ?? []).filter((r) => !who || r.owner === who);
  const paid = who ? (owner?.paidFils ?? 0) : owners.reduce((a, o) => a + o.paidFils, 0);
  const left = who ? (owner?.leftFils ?? 0) : owners.reduce((a, o) => a + o.leftFils, 0);
  const nameOf = (key: string) => owners.find((o) => o.key === key)?.name || t(side === 'owed' ? 'customer.noName' : 'debtPays.nobody');
  const months = (r: PaymentRow) => r.months.map((m) => monthLong(m, lang)).join(', ');
  const way = (r: PaymentRow) => wayLabel(t, r.method, side === 'owed' ? 'in' : 'out');
  const statement = () => run(async () => openPdf(await statementPdf(who, { from, to })));
  // Money in is green, what is owed to the garage red; what the garage paid out — plain, what it still owes orange (as «Мы должны»).
  const paidC = side === 'owed' ? 'green.7' : undefined;
  const leftC = side === 'owed' ? 'red' : 'orange.7';

  const head = (
    <>
      <PageHeader title={t('debtPays.title')} subtitle={kind === 'all' ? t('debtPays.period.all') : `${formatDate(from)} – ${formatDate(to)}`} />
      <ScrollTabs
        segmented
        value={side}
        onChange={(v) => set({ side: v, who: '' })}
        items={[
          { value: 'owed', label: t('debt.owed') },
          { value: 'owe', label: t('debt.weOwe') },
        ]}
      />
      <ScrollTabs value={kind} onChange={(v) => setKind(v as PeriodKind)} items={PERIODS.map((p) => ({ value: p, label: t(`debtPays.period.${p}`) }))} />
      {kind === 'month' && (
        <Box mb="md">
          <MonthField value={month} onChange={setMonth} />
        </Box>
      )}
      {kind === 'custom' && (
        <SimpleGrid cols={2} mb="md">
          <DateField label={t('common.from')} value={custom.from} onChange={(d) => setCustom((c) => ({ ...c, from: d }))} maxDate={today} />
          <DateField label={t('common.to')} value={custom.to} onChange={(d) => setCustom((c) => ({ ...c, to: d }))} maxDate={today} />
        </SimpleGrid>
      )}
    </>
  );
  if (!data) {
    return (
      <>
        {head}
        <PageSkeleton />
      </>
    );
  }
  // Whom to show: everyone, or one (those who paid in the period, or owe now — the one who paid most first).
  const chips = owner || !who ? owners : [...owners, { key: who, name: nameOf(who), paidFils: 0, count: 0, leftFils: 0 } as PayOwner];
  const tableCols: Column<PaymentRow & { entry?: LedgerEntry }>[] = [
    { key: 'date', label: t('common.date'), cell: (r) => formatDate(r.date), sort: (r) => r.at, desc: true, width: 110, nowrap: true },
    ...(who ? [] : [{ key: 'who', label: t(side === 'owed' ? 'debt.who' : 'owed.title'), cell: (r: PaymentRow) => nameOf(r.owner), sort: (r: PaymentRow) => nameOf(r.owner) }]),
    { key: 'what', label: t('debtPays.forWhat'), cell: (r) => months(r) || (r.restFils > 0 ? t('debt.rest') : '—'), muted: true },
    { key: 'way', label: t('debtPays.way'), cell: (r) => way(r), width: 150, muted: true, nowrap: true },
    { key: 'paid', label: t('debtPays.paid'), cell: (r) => <Money fils={r.amountFils} c={paidC} />, sort: (r) => r.amountFils, align: 'right', width: 140, nowrap: true },
    { key: 'left', label: t('debtPays.leftAfter'), cell: (r) => <Money fils={r.leftFils} c={r.leftFils > 0 ? leftC : 'dimmed'} />, sort: (r) => r.leftFils, align: 'right', width: 150, nowrap: true },
  ];
  const days = new Map<string, typeof rows>();
  for (const r of rows) days.set(r.date, [...(days.get(r.date) ?? []), r]);
  return (
    <>
      {head}
      <Stack gap="lg">
        {/* Who: everyone, or one. */}
        {chips.length > 0 && (
          <div className="chip-row bleed" aria-label={t(side === 'owed' ? 'debt.who' : 'owed.title')}>
            <button type="button" className="chip" data-active={!who} data-pays-who="" onClick={() => set({ who: '' })}>
              {t('debtPays.all')}
            </button>
            {chips.map((o) => (
              <button key={o.key} type="button" className="chip chip-supplier" data-active={who === o.key} data-pays-who={o.key} onClick={() => set({ who: who === o.key ? '' : o.key })}>
                {o.name || t(side === 'owed' ? 'customer.noName' : 'debtPays.nobody')}
              </button>
            ))}
          </div>
        )}
        {/* What was paid in the period; what is owed now. */}
        <SimpleGrid cols={2} spacing="sm">
          <Kpi label={t('debtPays.paid')} value={<Money fils={paid} roll />} color={side === 'owed' ? 'green' : undefined} hint={t('debtPays.count', { count: rows.length })} />
          <Kpi label={t('debtPays.left')} value={<Money fils={left} roll />} color={left > 0 ? (side === 'owed' ? 'red' : 'orange') : undefined} hint={t('debtPays.now')} />
        </SimpleGrid>
        {side === 'owed' && who && (
          <Button variant="light" size="md" leftSection={<IconFileInvoice size={18} />} loading={busy} onClick={() => void statement()} data-pays-statement>
            {t('debtPays.statement')}
          </Button>
        )}
        {/* Everyone: one row each — paid in the period, owed now; a tap picks that one. */}
        {!who && owners.length > 0 && (
          <Box>
            <div className="group-title">{t(side === 'owed' ? 'debtPays.byCustomer' : 'debtPays.byCreditor')}</div>
            <List>
              {owners.map((o) => (
                <ListRow
                  key={o.key}
                  chevron
                  onClick={() => set({ who: o.key })}
                  left={<PersonAvatar name={o.name || '—'} company={side === 'owed' ? o.company : !o.person} size={36} />}
                  title={
                    <Text span inherit fw={600} lineClamp={1} data-pays-owner={o.key}>
                      {o.name || t(side === 'owed' ? 'customer.noName' : 'debtPays.nobody')}
                    </Text>
                  }
                  subtitle={t('debtPays.count', { count: o.count })}
                  right={
                    <Stack gap={0} align="flex-end">
                      <Money fils={o.paidFils} size="sm" c={o.paidFils ? paidC : 'dimmed'} />
                      {o.leftFils > 0 && (
                        <Text size="xs" c={leftC} className="tnum">
                          {t('debtPays.leftSum', { sum: formatAed(o.leftFils) })}
                        </Text>
                      )}
                    </Stack>
                  }
                />
              ))}
            </List>
          </Box>
        )}
        {/* The payments, by day; a tap opens the operation. */}
        {!rows.length ? (
          <EmptyState icon={IconReceipt} title={t('debtPays.none')} />
        ) : desk ? (
          <DataTable rows={rows} columns={tableCols} rowKey={(r) => `${r.source}:${r.id}`} onRow={(r) => r.entry && setOpen(r.entry)} initialSort={{ key: 'date', dir: -1 }} label={t('debtPays.list')} />
        ) : (
          [...days.entries()].map(([day, list]) => {
            const h = dayHeading(day, lang);
            return (
              <Box key={day}>
                <Group justify="space-between" px={4} mb={6} wrap="nowrap">
                  <Text size="sm" fw={600} c="dimmed" className="day-head">
                    {h.word ? t(`common.${h.word}`) : h.text}
                  </Text>
                  <Text size="xs" fw={600} c={paidC ?? 'dimmed'} className="tnum">
                    {formatAed(list.reduce((a, r) => a + r.amountFils, 0))}
                  </Text>
                </Group>
                <List>
                  {list.map((r) => (
                    <ListRow
                      key={`${r.source}:${r.id}`}
                      onClick={r.entry ? () => setOpen(r.entry!) : undefined}
                      left={who ? undefined : <PersonAvatar name={nameOf(r.owner)} company={side === 'owed' ? owners.find((o) => o.key === r.owner)?.company : !owners.find((o) => o.key === r.owner)?.person} size={36} />}
                      title={
                        <Text span inherit fw={600} lineClamp={2} data-pays-row={r.id}>
                          {who ? months(r) || (r.restFils > 0 ? t('debt.rest') : way(r)) : nameOf(r.owner)}
                        </Text>
                      }
                      subtitle={[who ? '' : months(r), way(r), r.restFils > 0 && r.months.length ? t('debtPays.rest', { sum: formatAed(r.restFils) }) : ''].filter(Boolean).join(' · ')}
                      right={
                        <Stack gap={0} align="flex-end">
                          <Money fils={r.amountFils} size="sm" c={paidC} fw={600} />
                          <Text size="xs" c={r.leftFils > 0 ? leftC : 'dimmed'} className="tnum" data-left-after={r.leftFils}>
                            {r.leftFils > 0 ? t('debtPays.leftSum', { sum: formatAed(r.leftFils) }) : t('debtPays.settled')}
                          </Text>
                        </Stack>
                      }
                    />
                  ))}
                </List>
              </Box>
            );
          })
        )}
      </Stack>
      <SheetFor value={open}>{(e, o) => <EntryDetails opened={o} entry={e} label={label(e)} cats={data.cats} onClose={() => setOpen(null)} />}</SheetFor>
    </>
  );
}
