import { Alert, Box, Button, Group, Modal, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconFileImport, IconFileText, IconReportAnalytics } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { dubaiDate, formatDate } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import { tableDiff, type MonthRow } from '../../domain/historyInvoices';
import type { HistoryPlan, PlanDoc } from '../../domain/historyPlan';
import type { Customer } from '../../domain/types';
import { applyHistoryImport, expectedTable, planHistoryImport, readHistoryPdf, type HistoryImportResult } from '../../services/historyImport';
import { MonthField, DayPill } from '../../ui/DateFields';
import { shareOrDownload } from '../../ui/share';
import { List, ListRow, Money, Section } from '../../ui/components';
import { useAction, useErrorText, useLang, usePhone, useScreenLiveQuery } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';

/*
 * A customer's invoices from before this app (v0.45): on a company's card — how many, which months, their sum; the PDFs
 * brought in from here (services/historyImport.ts): chosen, read on the device, the month table and what does not agree
 * shown before anything is written; «Импортировать» writes all of it or none.
 */

/** "05/2026"; the whole — "Всего". */
const monthLabel = (m: string, all: string) => (m === 'all' ? all : `${m.slice(5, 7)}/${m.slice(0, 4)}`);

export function CustomerHistory({ customer }: { customer: Customer }) {
  const { t } = useTranslation();
  const [importing, setImporting] = useState(false);
  const [reporting, setReporting] = useState(false);
  // The sheet starts afresh each time it opens (a result or a check left from before is not shown again).
  const [round, setRound] = useState(0);
  const stats = useScreenLiveQuery(
    async () => {
      const list = await db.historyInvoices.where('customerId').equals(customer.id).toArray();
      const days = list.map((i) => i.date).sort();
      // The last day an invoice was given — one from before or this app's own (a report opens on its month).
      const orders = await db.orders.where('customerId').equals(customer.id).primaryKeys();
      const own = orders.length ? (await db.invoices.where('orderId').anyOf(orders).toArray()).filter((i) => i.type !== 'credit_note' && i.status === 'issued').map((i) => dubaiDate(i.issuedAt)) : [];
      const last = [...days, ...own].sort().pop();
      return { n: list.length, from: days[0], to: days[days.length - 1], total: list.reduce((a, i) => a + i.totalFils, 0), cars: new Set(list.map((i) => i.vehicleId)).size, last, own: own.length };
    },
    [customer.id],
    undefined,
    150,
  );
  if (!stats || (customer.type !== 'company' && !stats.n)) return null;
  return (
    <>
      <Section title={t('history.title')}>
        <List>
          {stats.n > 0 && (
            <ListRow
              left={<IconFileText size={22} stroke={1.8} />}
              title={t('history.count', { count: stats.n })}
              subtitle={[`${formatDate(stats.from!)} – ${formatDate(stats.to!)}`, t('history.carsCount', { count: stats.cars })].join(' · ')}
              right={<Money fils={stats.total} fw={600} />}
            />
          )}
          {(stats.n > 0 || stats.own > 0) && <ListRow left={<IconReportAnalytics size={22} stroke={1.8} />} title={t('history.report')} chevron onClick={() => setReporting(true)} />}
          <ListRow
            left={<IconFileImport size={22} stroke={1.8} />}
            title={t('history.import')}
            chevron
            onClick={() => {
              setRound((n) => n + 1);
              setImporting(true);
            }}
          />
        </List>
      </Section>
      <LazySheet opened={reporting}>{(o) => <ReportSheet customer={customer} opened={o} onClose={() => setReporting(false)} lastDay={stats.last} />}</LazySheet>
      <LazySheet opened={importing}>{(o) => <HistoryImportSheet key={round} customer={customer} opened={o} onClose={() => setImporting(false)} />}</LazySheet>
    </>
  );
}

/** The last day of a month (YYYY-MM). */
const monthEnd = (m: string) => `${m}-${String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()).padStart(2, '0')}`;

/**
 * The customer's report of a month (the one its last invoice is of, at first) or of any period: one PDF — the summary,
 * then each invoice (pdf/customerReport.tsx).
 */
function ReportSheet({ customer, opened, onClose, lastDay }: { customer: Customer; opened: boolean; onClose: () => void; lastDay?: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [mode, setMode] = useState<'month' | 'period'>('month');
  const [month, setMonth] = useState((lastDay ?? dubaiDate()).slice(0, 7));
  const [from, setFrom] = useState(`${(lastDay ?? dubaiDate()).slice(0, 7)}-01`);
  const [to, setTo] = useState(lastDay ?? dubaiDate());
  const period = mode === 'month' ? { from: `${month}-01`, to: monthEnd(month) } : { from: from <= to ? from : to, to: from <= to ? to : from };
  const key = `${period.from}|${period.to}`;
  // The PDF of the period chosen is made as soon as it is chosen: a phone shares a file only in the tap itself (iOS
  // refuses it after a wait), so the button hands over one made already.
  const [made, setMade] = useState<{ key: string; file?: File; count: number; error?: string } | null>(null);
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    const wait = window.setTimeout(() => {
      void (async () => {
        try {
          const { renderCustomerReport } = await import('../../pdf/customerReport');
          const r = await renderCustomerReport(customer.id, period.from, period.to);
          const name = `${customer.companyName || customer.name} — ${r.title}.pdf`.replace(/[\\/:*?"<>|]/g, ' ');
          if (alive) setMade({ key, count: r.items.length, ...(r.items.length ? { file: new File([r.blob], name, { type: 'application/pdf' }) } : {}) });
        } catch (e) {
          if (alive) setMade({ key, count: 0, error: errorText(e) });
        }
      })();
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(wait);
    };
    // The period's key says all of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, key, customer.id]);
  const ready = made?.key === key ? made : null;
  const pdf = () => ready?.file && shareOrDownload(ready.file);
  return (
    <Modal opened={opened} onClose={onClose} title={t('history.report')}>
      <Stack gap="md">
        <SegmentedControl
          fullWidth
          value={mode}
          onChange={(v) => setMode(v as 'month' | 'period')}
          data={[
            { value: 'month', label: t('history.month') },
            { value: 'period', label: t('history.period') },
          ]}
        />
        {mode === 'month' ? (
          <MonthField value={month} onChange={setMonth} />
        ) : (
          <Group grow>
            <DayPill value={from} onChange={setFrom} label={t('history.from')} />
            <DayPill value={to} onChange={setTo} label={t('history.to')} />
          </Group>
        )}
        {ready?.error ? (
          <Text size="sm" c="red.7">
            {ready.error}
          </Text>
        ) : null}
        <Button size="md" leftSection={<IconFileText size={18} />} loading={!ready} disabled={!!ready && !ready.file} onClick={pdf}>
          {ready && !ready.file && !ready.error ? t('history.nothingInPeriod') : ready?.file ? t('history.pdfCount', { n: ready.count }) : t('history.pdf')}
        </Button>
      </Stack>
    </Modal>
  );
}

/** The month table: invoices, lines, net, VAT, total by month and in all; against the expected one when there is one. */
function MonthTable({ table, expected }: { table: MonthRow[]; expected?: MonthRow[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  const phone = usePhone();
  const aed = (fils: number) => formatAed(fils, lang, false);
  // Each figure on one line (a phone's narrow table: smaller, and sideways if it must).
  return (
    <Table.ScrollContainer minWidth={330} type="native">
      <Table className="tnum history-table" fz={phone ? 'xs' : 'sm'} verticalSpacing={4} horizontalSpacing={phone ? 4 : 6} style={{ whiteSpace: 'nowrap' }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('history.month')}</Table.Th>
            <Table.Th ta="right">{t('history.invoices')}</Table.Th>
            <Table.Th ta="right">{t('history.lines')}</Table.Th>
            <Table.Th ta="right">{t('history.net')}</Table.Th>
            <Table.Th ta="right">{t('history.vat')}</Table.Th>
            <Table.Th ta="right">{t('history.total')}</Table.Th>
            {expected && <Table.Th />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {table.map((r) => {
            const w = expected?.find((x) => x.month === r.month);
            const same = w ? tableDiff([r], [w]).length === 0 : undefined;
            return (
              <Table.Tr key={r.month} fw={r.month === 'all' ? 700 : undefined}>
                <Table.Td>{monthLabel(r.month, t('history.all'))}</Table.Td>
                <Table.Td ta="right">{r.invoices}</Table.Td>
                <Table.Td ta="right">{r.lines}</Table.Td>
                <Table.Td ta="right">{aed(r.netFils)}</Table.Td>
                <Table.Td ta="right">{aed(r.vatFils)}</Table.Td>
                <Table.Td ta="right">{aed(r.totalFils)}</Table.Td>
                {expected && <Table.Td c={same ? 'green.7' : 'red.7'}>{same ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />}</Table.Td>}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function HistoryImportSheet({ customer, opened, onClose }: { customer: Customer; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const files = useRef<HTMLInputElement>(null);
  const expectFile = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<{ done: number; of: number } | null>(null);
  const [plan, setPlan] = useState<HistoryPlan | null>(null);
  const [expected, setExpected] = useState<MonthRow[] | undefined>();
  const [result, setResult] = useState<HistoryImportResult | null>(null);
  const [showFlags, setShowFlags] = useState(false);

  const read = (list: FileList | null) =>
    void run(async () => {
      const pdfs = [...(list ?? [])].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
      if (!pdfs.length) return;
      setResult(null);
      setPlan(null);
      const docs: PlanDoc[] = [];
      setReading({ done: 0, of: pdfs.length });
      try {
        for (const f of pdfs) {
          docs.push(await readHistoryPdf(f, f.name));
          setReading({ done: docs.length, of: pdfs.length });
        }
        setPlan(await planHistoryImport(customer.id, docs));
      } finally {
        setReading(null);
      }
    });
  const readExpected = (list: FileList | null) =>
    void run(async () => {
      const f = list?.[0];
      if (f) setExpected(expectedTable(await f.text()));
    });
  const apply = () =>
    void run(async () => {
      if (!plan) return;
      setResult(await applyHistoryImport(customer.id, plan, expected));
      setPlan(null);
    });

  const flagged = plan?.invoices.filter((i) => i.flags?.length) ?? [];
  const odd = plan?.rows.filter((r) => r.kind === 'row' && r.status !== 'ok') ?? [];
  const missing = odd.filter((r) => r.status === 'missing').length;
  const matches = expected && plan ? tableDiff(plan.table, expected).length === 0 : undefined;
  const nothing = plan && !plan.write.invoices.length && !plan.write.rows.length && !plan.vehicles.length;
  return (
    <Modal opened={opened} onClose={onClose} title={t('history.importTitle')} size="lg">
      <Stack gap="md">
        <input ref={files} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => (read(e.currentTarget.files), (e.currentTarget.value = ''))} />
        <input ref={expectFile} type="file" accept="application/json,.json" hidden onChange={(e) => (readExpected(e.currentTarget.files), (e.currentTarget.value = ''))} />
        {!plan && !result && (
          <Button size="md" leftSection={<IconFileImport size={18} />} loading={!!reading} onClick={() => files.current?.click()}>
            {reading ? t('history.reading', { done: reading.done, of: reading.of }) : t('history.pick')}
          </Button>
        )}
        {plan && (
          <>
            <MonthTable table={plan.table} expected={expected} />
            <Box className="history-facts">
              <Text size="sm">{t('history.jobs', { n: plan.invoices.filter((i) => i.orderId).length, of: plan.invoices.length })}</Text>
              <Text size="sm">{t('history.cars', { n: plan.cars, added: plan.newCars })}</Text>
              <Text size="sm">{t('history.summaryOdd', { n: odd.length - missing, missing })}</Text>
              {flagged.length > 0 && (
                <Button variant="subtle" size="compact-sm" px={0} onClick={() => setShowFlags((x) => !x)}>
                  {t('history.flags', { n: flagged.length })}
                </Button>
              )}
            </Box>
            {showFlags && (
              <Stack gap={4} className="history-flags">
                {flagged.map((i) => (
                  <Text key={i.id} size="xs">
                    <b>{`${i.numberKind === 'job' ? 'Job' : 'Inv'} ${i.number}`}</b> · {formatDate(i.date)} · {i.plate} — {i.flags!.map((f) => `${t(`history.flag.${f.code}`)}: ${f.text}`).join('; ')}
                  </Text>
                ))}
              </Stack>
            )}
            {plan.problems.length > 0 && (
              <Alert color="red" icon={<IconAlertTriangle size={18} />} title={t('history.problemsTitle', { n: plan.problems.length })}>
                <Stack gap={2}>
                  {plan.problems.slice(0, 12).map((p) => (
                    <Text key={p} size="xs">
                      {p}
                    </Text>
                  ))}
                </Stack>
              </Alert>
            )}
            {matches !== undefined && (
              <Text size="sm" c={matches ? 'green.7' : 'red.7'} fw={600}>
                {matches ? t('history.expectedOk') : t('history.expectedNo')}
              </Text>
            )}
            <Group grow>
              <Button variant="default" onClick={() => expectFile.current?.click()}>
                {t('history.expected')}
              </Button>
              <Button variant="default" onClick={() => files.current?.click()}>
                {t('history.again')}
              </Button>
            </Group>
            <Button size="md" disabled={plan.problems.length > 0 || matches === false || !!nothing} loading={busy} onClick={apply}>
              {nothing ? t('history.nothing') : t('history.apply', { n: plan.write.invoices.length })}
            </Button>
          </>
        )}
        {result && (
          <>
            <Alert color="green" icon={<IconCheck size={18} />} title={t('history.done', { n: result.invoices })}>
              {t('history.doneMore', { rows: result.rows, cars: result.cars })}
            </Alert>
            <MonthTable table={result.table} expected={expected} />
            <Button variant="default" onClick={onClose}>
              {t('common.close')}
            </Button>
          </>
        )}
      </Stack>
    </Modal>
  );
}
