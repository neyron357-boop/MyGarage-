import { Button, Group, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload, IconFileTypePdf, IconShare } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { addDays, dubaiDate, formatDate, nowIso } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import { computeReport } from '../../domain/reports';
import { downloadBlob, toCsv } from '../../services/backup';
import { openPdf } from '../../services/documents';
import { Money, PageHeader } from '../../ui/components';
import { useAction, useLang } from '../../ui/hooks';

type Period = 'today' | 'week' | 'month' | 'custom';

function range(p: Period, from: string, to: string): [string, string] {
  const today = dubaiDate();
  if (p === 'today') return [today, today];
  if (p === 'week') return [dubaiDate(addDays(nowIso(), -6)), today];
  if (p === 'month') return [today.slice(0, 8) + '01', today];
  return [from || today, to || today];
}

export function ReportsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [f, tt] = range(period, from, to);
  const data = useLiveQuery(async () => {
    const [orders, invoices, items, expenses, payments, closings, cats] = await Promise.all([
      db.orders.toArray(),
      db.invoices.toArray(),
      db.items.toArray(),
      db.expenses.toArray(),
      db.payments.toArray(),
      db.cashClosings.toArray(),
      db.expenseCategories.toArray(),
    ]);
    return { report: computeReport({ from: f, to: tt, orders, invoices, items, expenses, payments, closings }), invoices, payments, expenses, cats, orders };
  }, [f, tt]);
  if (!data) return null;
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
    await downloadBlob(
      toCsv([
        ['number', 'type', 'date', 'buyer', 'buyer_trn', 'net_aed', 'vat_aed', 'total_aed', 'status'],
        ...inv.map((i) => [i.number, i.type, formatDate(i.issuedAt), i.buyer.name, i.buyer.trn, (i.subtotalFils / 100).toFixed(2), (i.vatFils / 100).toFixed(2), (i.totalFils / 100).toFixed(2), i.status]),
      ]),
      `invoices-${f}-${tt}.csv`,
    );
    const ex = data.expenses.filter((e) => e.date >= f && e.date <= tt);
    await downloadBlob(
      toCsv([
        ['date', 'category', 'vendor', 'method', 'gross_aed', 'vat_aed', 'note'],
        ...ex.map((e) => [formatDate(e.date), catName(e.categoryId), e.vendor, e.method, (e.amountFils / 100).toFixed(2), (e.vatFils / 100).toFixed(2), e.note]),
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
  const tile = (label: string, fils: number, color?: string) => (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed">{label}</Text>
      <Money fils={fils} fw={700} size="lg" c={color} />
    </Paper>
  );
  return (
    <>
      <PageHeader title={t('report.title')} />
      <Stack>
        <SegmentedControl fullWidth value={period} onChange={(v) => setPeriod(v as Period)} data={(['today', 'week', 'month', 'custom'] as const).map((p) => ({ value: p, label: t(`report.period.${p}`) }))} />
        {period === 'custom' && (
          <Group grow>
            <TextInput type="date" label={t('common.from')} value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
            <TextInput type="date" label={t('common.to')} value={to} onChange={(e) => setTo(e.currentTarget.value)} />
          </Group>
        )}
        <Text size="sm" c="dimmed">{formatDate(f)} – {formatDate(tt)}</Text>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
          <Paper withBorder p="sm"><Text size="xs" c="dimmed">{t('report.received')}</Text><Text fw={700} size="lg">{r.ordersReceived}</Text></Paper>
          <Paper withBorder p="sm"><Text size="xs" c="dimmed">{t('report.delivered')}</Text><Text fw={700} size="lg">{r.ordersDelivered}</Text></Paper>
          {tile(t('report.revenueGross'), r.revenueGross)}
          {tile(t('report.avgTicket'), r.averageTicketGross)}
          {tile(t('report.revenueNet'), r.revenueNet)}
          {tile(t('report.partsCost'), r.partsCostNet)}
          {tile(t('report.expensesNet'), r.expensesNet)}
          {tile(t('report.grossProfit'), r.grossProfit, r.grossProfit >= 0 ? 'green' : 'red')}
        </SimpleGrid>
        <Paper withBorder p="sm">
          <Title order={6} mb="xs">{t('report.breakdown')}</Title>
          <Table>
            <Table.Tbody>
              <Table.Tr><Table.Td>{t('item.kind.labor')}</Table.Td><Table.Td ta="right">{formatAed(r.laborNet, lang)}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td>{t('item.kind.part')}</Table.Td><Table.Td ta="right">{formatAed(r.partsNet, lang)}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td>{t('report.other')}</Table.Td><Table.Td ta="right">{formatAed(r.otherNet, lang)}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td>{t('report.vatOutput')}</Table.Td><Table.Td ta="right">{formatAed(r.vatOutput, lang)}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td>{t('report.vatInput')}</Table.Td><Table.Td ta="right">{formatAed(r.vatInput, lang)}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td>{t('report.vatPayable')}</Table.Td><Table.Td ta="right"><b>{formatAed(r.vatOutput - r.vatInput, lang)}</b></Table.Td></Table.Tr>
              <Table.Tr><Table.Td>{t('payment.method.cash')}</Table.Td><Table.Td ta="right">{formatAed(r.payments.cash, lang)}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td>{t('payment.method.card')}</Table.Td><Table.Td ta="right">{formatAed(r.payments.card, lang)}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td>{t('payment.method.transfer')}</Table.Td><Table.Td ta="right">{formatAed(r.payments.transfer, lang)}</Table.Td></Table.Tr>
              <Table.Tr><Table.Td>{t('report.cashDiff')}</Table.Td><Table.Td ta="right" c={r.cashDiffFils ? 'red' : undefined}>{formatAed(r.cashDiffFils, lang)}</Table.Td></Table.Tr>
            </Table.Tbody>
          </Table>
        </Paper>
        <Paper withBorder p="sm">
          <Title order={6} mb="xs">{t('expense.byCategory')}</Title>
          {r.expensesByCategory.length === 0 && <Text size="sm" c="dimmed">—</Text>}
          {r.expensesByCategory.map((c) => (
            <Group key={c.categoryId} justify="space-between"><Text size="sm">{catName(c.categoryId)}</Text><Money fils={c.gross} size="sm" /></Group>
          ))}
        </Paper>
        <Group>
          <Button leftSection={<IconFileTypePdf size={18} />} loading={busy} onClick={() => run(async () => openPdf(await pdf()))}>PDF</Button>
          <Button variant="light" leftSection={<IconShare size={18} />} loading={busy} onClick={() => run(share)}>{t('report.sendOwner')}</Button>
          <Button variant="default" leftSection={<IconDownload size={18} />} onClick={() => run(exportCsv)}>{t('report.exportAccountant')}</Button>
        </Group>
        <Text size="xs" c="dimmed">{t('report.note')}</Text>
      </Stack>
    </>
  );
}
