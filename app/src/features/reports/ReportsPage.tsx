import { Box, Button, Group, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { IconChartBar, IconDownload, IconFileTypePdf, IconShare } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { owedIndex, owedToOf } from '../../domain/debts';
import { invoiceBuyer } from '../../domain/invoice';
import { addDays, dubaiDate, formatDate, nowIso } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import { computeReport } from '../../domain/reports';
import { downloadBlob, toCsv } from '../../services/backup';
import { openPdf } from '../../services/documents';
import { EmptyState, Kpi, List, ListRow, Money, PageHeader, PageSkeleton, ScrollTabs, Section } from '../../ui/components';
import { DateField } from '../../ui/DateFields';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';

type Period = 'today' | 'week' | 'month' | 'custom';

function range(p: Period, from: string, to: string): [string, string] {
  const today = dubaiDate();
  if (p === 'today') return [today, today];
  if (p === 'week') return [dubaiDate(addDays(nowIso(), -6)), today];
  if (p === 'month') return [today.slice(0, 8) + '01', today];
  return [from || today, to || today];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** One whole split into parts (revenue by kind): segments with a 2px gap, details on hover and in the rows below. */
function SegmentedBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const lang = useLang();
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const visible = parts.filter((p) => p.value > 0);
  return (
    <Box>
      <Box style={{ display: 'flex', gap: 2, height: 18 }} role="img" aria-label={visible.map((p) => `${p.label} ${formatAed(p.value, lang)} (${pct(p.value, total)}%)`).join(', ')}>
        {visible.map((p, i) => (
          <Tooltip key={p.key} label={`${p.label}: ${formatAed(p.value, lang)} · ${pct(p.value, total)}%`}>
            <Box
              tabIndex={0}
              style={{
                flex: `${p.value} 1 0`,
                background: p.color,
                borderRadius: `${i === 0 ? 4 : 0}px ${i === visible.length - 1 ? 4 : 0}px ${i === visible.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
                minWidth: 4,
              }}
            />
          </Tooltip>
        ))}
        {visible.length === 0 && <Box style={{ flex: 1, background: 'var(--app-hairline)', borderRadius: 4 }} />}
      </Box>
      <Stack gap={0} mt="sm">
        {parts.map((p) => (
          <Group key={p.key} justify="space-between" py={6} style={{ borderTop: '1px solid var(--app-hairline)' }} wrap="nowrap">
            <Group gap={8} wrap="nowrap">
              <span className="stage-dot" style={{ background: p.color, width: 10, height: 10, borderRadius: 3 }} />
              <Text size="sm">{p.label}</Text>
            </Group>
            <Group gap="md" wrap="nowrap">
              <Text size="xs" c="dimmed" className="tnum" w={40} ta="right">
                {String(pct(p.value, total)).replace('-', '−')}%
              </Text>
              <Money fils={p.value} size="sm" />
            </Group>
          </Group>
        ))}
      </Stack>
    </Box>
  );
}

/** Single-series horizontal bars, sorted: the name and amount on one line, the bar under it (nothing is cut off). */
function HBars({ rows }: { rows: { key: string; label: string; value: number; hint?: string }[] }) {
  const lang = useLang();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Stack gap={12}>
      {rows.map((r) => (
        <Tooltip key={r.key} label={r.hint ?? formatAed(r.value, lang)} position="top-start" openDelay={300}>
          <Box tabIndex={0}>
            <Group justify="space-between" wrap="nowrap" gap="sm" mb={5}>
              <Text size="sm" style={{ minWidth: 0 }}>
                {r.label}
              </Text>
              <Money fils={r.value} size="sm" />
            </Group>
            <Box style={{ height: 8, borderRadius: 4, background: 'var(--app-soft)', overflow: 'hidden' }}>
              <Box className="bar-grow" style={{ height: '100%', width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: 'var(--viz-1)', borderRadius: 4 }} />
            </Box>
          </Box>
        </Tooltip>
      ))}
    </Stack>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState<string>();
  const [to, setTo] = useState<string>();
  const [f, tt] = range(period, from ?? '', to ?? '');
  const data = useScreenLiveQuery(async () => {
    const [orders, invoices, items, allExpenses, payments, closings, cats, incomes] = await Promise.all([
      db.orders.toArray(),
      db.invoices.toArray(),
      db.items.toArray(),
      db.expenses.toArray(),
      db.payments.toArray(),
      db.cashClosings.toArray(),
      db.expenseCategories.toArray(),
      db.incomes.toArray(),
    ]);
    const expenses = allExpenses.filter((e) => !e.voidedAt);
    return { report: computeReport({ from: f, to: tt, orders, invoices, items, expenses, payments, closings, incomes, partsCategoryId: cats.find((c) => c.code === 'parts')?.id }), invoices, payments, expenses, cats, orders };
  }, [f, tt]);
  if (!data) return <PageSkeleton />;
  const r = data.report;
  const catName = (id: string) => {
    const c = data.cats.find((x) => x.id === id);
    return c ? (lang === 'ru' ? c.nameRu : c.nameEn) : id;
  };
  const pdf = async () => {
    const { renderReport } = await import('../../pdf/documents');
    return { blob: await renderReport(r, f, tt, lang, data.cats), filename: `report-${f}-${tt}.pdf` };
  };
  const share = async () => {
    const file = await pdf();
    const fl = new File([file.blob], file.filename, { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (!nav.canShare?.({ files: [fl] })) throw new Error('share unavailable');
      await navigator.share({ files: [fl], text: `${t('report.title')} ${formatDate(f)} – ${formatDate(tt)}` });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      await downloadBlob(file.blob, file.filename);
    }
  };
  const exportCsv = async () => {
    const inv = data.invoices.filter((i) => dubaiDate(i.issuedAt) >= f && dubaiDate(i.issuedAt) <= tt);
    // The buyer as the invoice's PDF prints it (left blank on it — the job's customer now).
    const customers = new Map((await db.customers.toArray()).map((c) => [c.id, c]));
    const buyer = (i: (typeof inv)[number]) => invoiceBuyer(i.buyer, customers.get(data.orders.find((o) => o.id === i.orderId)?.customerId ?? ''));
    await downloadBlob(
      toCsv([
        ['number', 'type', 'date', 'buyer', 'buyer_trn', 'net_aed', 'vat_aed', 'total_aed', 'status'],
        ...inv.map((i) => [i.number, i.type, formatDate(i.issuedAt), buyer(i).name, i.buyer.trn, (i.subtotalFils / 100).toFixed(2), (i.vatFils / 100).toFixed(2), (i.totalFils / 100).toFixed(2), i.status]),
      ]),
      `invoices-${f}-${tt}.csv`,
    );
    const ex = data.expenses.filter((e) => e.date >= f && e.date <= tt);
    // On credit (v0.61): whom it is owed to — the person who paid for it, else the seller.
    const credit = ex.filter((e) => e.method === 'credit');
    const [lenders, sellers] = await Promise.all([credit.length ? db.lenders.toArray() : [], db.suppliers.bulkGet([...new Set(credit.map((e) => e.supplierId).filter((id): id is string => !!id))])]);
    const owed = owedIndex(sellers.filter((s) => !!s), lenders);
    await downloadBlob(
      toCsv([
        ['date', 'category', 'vendor', 'method', 'owed_to', 'gross_aed', 'vat_aed', 'note'],
        ...ex.map((e) => [formatDate(e.date), catName(e.categoryId), e.vendor, e.method, e.method === 'credit' ? owedToOf(e, owed)?.name : '', (e.amountFils / 100).toFixed(2), (e.vatFils / 100).toFixed(2), e.note]),
      ]),
      `expenses-${f}-${tt}.csv`,
    );
    const pays = data.payments.filter((p) => dubaiDate(p.receivedAt) >= f && dubaiDate(p.receivedAt) <= tt);
    await downloadBlob(
      toCsv([
        ['receipt', 'date', 'order', 'kind', 'method', 'amount_aed', 'reference'],
        ...pays.map((p) => [p.receiptNumber, formatDate(p.receivedAt), data.orders.find((o) => o.id === p.orderId)?.number, p.kind, p.method, (p.amountFils / 100).toFixed(2), p.reference]),
      ]),
      `payments-${f}-${tt}.csv`,
    );
  };
  const empty = r.revenueGross === 0 && r.expensesGross === 0 && r.ordersReceived === 0;
  return (
    <>
      <PageHeader title={t('report.title')} subtitle={`${formatDate(f)} – ${formatDate(tt)}`} />
      <ScrollTabs value={period} onChange={(v) => setPeriod(v as Period)} items={(['today', 'week', 'month', 'custom'] as const).map((p) => ({ value: p, label: t(`report.period.${p}`) }))} />
      {period === 'custom' && (
        <SimpleGrid cols={2} mb="md">
          <DateField label={t('common.from')} value={from} onChange={setFrom} />
          <DateField label={t('common.to')} value={to} onChange={setTo} />
        </SimpleGrid>
      )}
      {empty ? (
        <EmptyState icon={IconChartBar} title={t('report.emptyTitle')}>
          {t('report.emptyText')}
        </EmptyState>
      ) : (
        <>
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
            <Kpi label={t('report.revenueGross')} value={<Money fils={r.revenueGross} display />} hint={t('report.invoicesInPeriod')} />
            <Kpi label={t('report.grossProfit')} value={<Money fils={r.grossProfit} display />} color={r.grossProfit >= 0 ? 'green' : 'red'} hint={t('report.profitHint')} />
            <Kpi label={t('report.avgTicket')} value={<Money fils={r.averageTicketGross} display />} />
            <Kpi label={t('report.carsLabel')} value={`${r.ordersReceived} / ${r.ordersDelivered}`} hint={t('report.carsHint')} />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mt="xl">
            <Section title={t('report.revenueSplit')} description={t('report.revenueSplitHint')} mt={0}>
              <Box className="surface" p="md">
                <SegmentedBar
                  parts={[
                    { key: 'labor', label: t('item.kind.labor'), value: r.laborGross, color: 'var(--viz-1)' },
                    { key: 'parts', label: t('item.kind.part'), value: r.partsGross, color: 'var(--viz-2)' },
                    { key: 'other', label: t('report.other'), value: r.otherGross, color: 'var(--viz-3)' },
                  ]}
                />
              </Box>
            </Section>
            <Section title={t('report.pnl')} description={t('report.pnlHint')} mt={0}>
              <List>
                <ListRow title={t('report.revenueGross')} right={<Money fils={r.revenueGross} size="sm" />} />
                {r.otherIncome > 0 && <ListRow title={`+ ${t('report.otherIncome')}`} right={<Money fils={r.otherIncome} size="sm" />} />}
                <ListRow title={`− ${t('report.partsCost')}`} right={<Money fils={r.partsCostGross} size="sm" />} />
                <ListRow title={`− ${t('report.expenses')}`} right={<Money fils={r.expensesGross} size="sm" />} />
                <ListRow title={<Text fw={700} size="sm">{t('report.grossProfit')}</Text>} right={<Money fils={r.grossProfit} size="sm" fw={700} c={r.grossProfit >= 0 ? 'green' : 'red'} />} />
              </List>
            </Section>
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" mt="xl">
            <Section title={t('expense.byCategory')} description={t('report.expensesHint')} mt={0}>
              <Box className="surface" p="md">
                {r.expensesByCategory.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    {t('report.noExpenses')}
                  </Text>
                ) : (
                  <HBars rows={r.expensesByCategory.map((c) => ({ key: c.categoryId, label: catName(c.categoryId), value: c.gross }))} />
                )}
              </Box>
            </Section>
            <Section title={t('report.paymentsTitle')} mt={0}>
              <List>
                <ListRow title={t('payment.method.cash')} right={<Money fils={r.payments.cash} size="sm" />} />
                <ListRow title={t('payment.method.card')} right={<Money fils={r.payments.card} size="sm" />} />
                <ListRow title={t('payment.method.transfer')} right={<Money fils={r.payments.transfer} size="sm" />} />
                {r.payments.outside !== 0 && <ListRow title={t('payment.method.outside')} right={<Money fils={r.payments.outside} size="sm" />} />}
                <ListRow title={t('report.cashDiff')} right={<Money fils={r.cashDiffFils} size="sm" c={r.cashDiffFils ? 'red' : undefined} />} />
              </List>
            </Section>
          </SimpleGrid>
        </>
      )}
      <Group mt="xl" gap="xs">
        <Button leftSection={<IconShare size={18} />} loading={busy} onClick={() => run(share)}>
          {t('report.sendOwner')}
        </Button>
        <Button variant="default" leftSection={<IconFileTypePdf size={18} />} loading={busy} onClick={() => run(async () => openPdf(await pdf()))}>
          PDF
        </Button>
        <Button variant="default" leftSection={<IconDownload size={18} />} onClick={() => run(exportCsv)}>
          {t('report.exportAccountant')}
        </Button>
      </Group>
    </>
  );
}
