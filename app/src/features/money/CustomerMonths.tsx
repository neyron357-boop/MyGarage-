import { Button, Modal, Stack, Text } from '@mantine/core';
import { IconCalendarCheck, IconCalendarDollar, IconCar, IconCash, IconChevronDown, IconFileInvoice, IconLock, IconLockOpen, IconPlus } from '@tabler/icons-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { dayHeading, dubaiDate, formatDate, monthLong, monthRange } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import type { HistoryInvoice } from '../../domain/types';
import { dayIn, type MonthWork, type WorkMonth } from '../../domain/workMonths';
import { statementPdf } from '../../services/debtDocs';
import { openPdf } from '../../services/documents';
import { setMonthLocked } from '../../services/monthLock';
import { loadWorkMonths, type WorkMonthsView } from '../../services/workMonths';
import { ConfirmModal, EmptyState, List, ListRow, Money, PageHeader, PageSkeleton, PlateLine } from '../../ui/components';
import { DeskSplit, useDesk } from '../../ui/desk';
import { haptic } from '../../ui/haptics';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { PHASE_META, PhaseTag } from '../job/phase';
import { customerName } from './Debts';
import { EntrySheet, type EntryPreset } from './MoneyEntry';

/*
 * A customer's works by month (v0.69, the user: «удобное пространство для просмотра всех работ по месяцам, возможность
 * открыть каждую работу и редактировать; замок на месяцы, которые нельзя редактировать; каждый месяц — список, нажал —
 * открылись все работы по датам; плюс для быстрого добавления упущенных работ… это важно для финанса»). From «Долги»:
 * a customer's month, or its tile «По месяцам». Every month of its account, the newest first — what its invoices came
 * to, what is left, closed or not; a month opens its works by day (a job — its screen, where it is changed; an invoice
 * from before the app — its lines), and what is done with a month: close it (`setMonthLocked`), add a job forgotten
 * (New job on that customer and a day of the month), take its payment, its statement. On a PC: the months beside the
 * month open.
 */

const tint = (color: string) => ({ background: `var(--mantine-color-${color}-6)` });

/** The month's mark: closed — a lock; owing — red; paid — teal. */
function MonthIcon({ m }: { m: WorkMonth }) {
  const [I, c] = m.locked ? [IconLock, 'gray'] : m.leftFils > 0 ? [IconCalendarDollar, 'red'] : [IconCalendarCheck, 'teal'];
  return (
    <span className="row-icon" style={tint(c)} aria-hidden>
      <I size={19} stroke={2} />
    </span>
  );
}

/** One work of a month: the car, its numbers, what it came to and what is left of it — a tap opens it. */
function WorkRow({ w, view, onHistory }: { w: MonthWork; view: WorkMonthsView; onHistory: (h: HistoryInvoice) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const job = w.orderId ? view.jobs.get(w.orderId) : undefined;
  const h = w.historyId ? view.history.get(w.historyId) : undefined;
  const v = job?.vehicle;
  const car = v ? [v.make, v.model].filter(Boolean).join(' ') : h ? h.vehicleText : w.label;
  // An invoice from before the app of a job carried over: its job; else its lines.
  const open = () => (w.orderId ? navigate(`/orders/${w.orderId}`) : h?.orderId ? navigate(`/orders/${h.orderId}`) : h && onHistory(h));
  const phase = w.kind === 'open' ? job?.phase : undefined;
  const meta = phase ? PHASE_META[phase] : undefined;
  const [Icon, color] = meta ? [meta.icon, meta.color] : w.kind === 'history' ? [IconFileInvoice, 'gray'] : [IconCar, 'cobalt'];
  const numbers = [job ? `№${job.order.number}` : '', w.number && w.number !== `Job #${job?.order.number}` ? w.number : '', w.kind === 'history' ? t('months.before') : ''].filter(Boolean).join(' · ');
  return (
    <ListRow
      chevron
      onClick={open}
      left={
        <span className="row-icon" style={tint(color)} aria-hidden>
          <Icon size={18} stroke={2} />
        </span>
      }
      title={car || t('months.noCar')}
      subtitle={
        <Stack gap={2} align="flex-start">
          <PlateLine plate={v?.plate}>{numbers}</PlateLine>
          {phase && <PhaseTag phase={phase} />}
        </Stack>
      }
      right={
        <span className="work-sum" data-work={w.kind}>
          <Money fils={w.totalFils} size="sm" c={w.kind === 'open' ? 'dimmed' : undefined} />
          {w.kind !== 'open' &&
            (w.leftFils > 0 ? (
              <Text span size="xs" c="red.7" className="tnum">
                {w.leftFils < w.totalFils ? t('months.left', { sum: formatAed(w.leftFils) }) : t('months.unpaid')}
              </Text>
            ) : (
              <Text span size="xs" c="teal.7">
                {w.paidOn ? t('months.paidOn', { date: formatDate(w.paidOn).slice(0, 5) }) : t('months.paid')}
              </Text>
            ))}
        </span>
      }
    />
  );
}

/** An open month: what is done with it, then its works by day. */
function MonthPanel({ m, view, onPay, onHistory, onUnlock }: { m: WorkMonth; view: WorkMonthsView; onPay: (m: WorkMonth) => void; onHistory: (h: HistoryInvoice) => void; onUnlock: (month: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [from, to] = monthRange(m.month);
  const days = new Map<string, MonthWork[]>();
  for (const w of m.works) days.set(w.date, [...(days.get(w.date) ?? []), w]);
  const lock = () =>
    m.locked
      ? onUnlock(m.month)
      : void run(async () => {
          await setMonthLocked(view.customer.id, m.month, true);
          haptic('success');
        }, 'months.closed');
  const add = () => navigate(`/orders/new?customerId=${view.customer.id}&day=${dayIn(m.month, dubaiDate())}`);
  const statement = () => run(async () => openPdf(await statementPdf(view.customer.id, { from, to })));
  return (
    <div className="month-panel rise-enter" data-month-panel={m.month}>
      {m.locked && (
        <div className="month-locked" data-month-locked>
          <IconLock size={16} stroke={2.2} aria-hidden />
          <span>{t('months.lockedNote')}</span>
        </div>
      )}
      <div className="debt-actions month-actions" data-n={m.leftFils > 0 ? 4 : 3}>
        <button type="button" className="action-tile" disabled={busy} onClick={lock} data-month-lock={m.locked ? 'open' : 'close'}>
          <span className="tile-icon" style={{ '--c': `var(--mantine-color-${m.locked ? 'gray' : 'indigo'}-6)` } as React.CSSProperties}>
            {m.locked ? <IconLockOpen size={21} stroke={1.9} aria-hidden /> : <IconLock size={21} stroke={1.9} aria-hidden />}
          </span>
          <span>{m.locked ? t('months.unlock') : t('months.lock')}</span>
        </button>
        {/* A job forgotten: New job on this customer, on a day of this month (not into a closed one). */}
        <button type="button" className="action-tile" disabled={m.locked} onClick={add} data-month-add>
          <span className="tile-icon" style={{ '--c': 'var(--mantine-color-cobalt-6)' } as React.CSSProperties}>
            <IconPlus size={21} stroke={2.1} aria-hidden />
          </span>
          <span>{t('months.add')}</span>
        </button>
        {m.leftFils > 0 && (
          <button type="button" className="action-tile" onClick={() => onPay(m)} data-month-pay>
            <span className="tile-icon" style={{ '--c': 'var(--mantine-color-green-6)' } as React.CSSProperties}>
              <IconCash size={21} stroke={1.9} aria-hidden />
            </span>
            <span>{t('debt.takeShort')}</span>
          </button>
        )}
        <button type="button" className="action-tile" disabled={busy} onClick={() => void statement()}>
          <span className="tile-icon" style={{ '--c': 'var(--mantine-color-grape-6)' } as React.CSSProperties}>
            <IconFileInvoice size={21} stroke={1.9} aria-hidden />
          </span>
          <span>{t('debt.statement')}</span>
        </button>
      </div>
      {[...days].map(([day, works]) => {
        const head = dayHeading(day, lang);
        return (
          <Fragment key={day}>
            <div className="group-title month-day">{head.word ? t(`common.${head.word}`) : head.text}</div>
            <List>
              {works.map((w) => (
                <WorkRow key={w.key} w={w} view={view} onHistory={onHistory} />
              ))}
            </List>
          </Fragment>
        );
      })}
    </div>
  );
}

/** An invoice from before the app: as printed — its lines and sums (it is a document: looked at, not changed). */
function HistorySheet({ h, opened, onClose }: { h: HistoryInvoice; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={`${h.number} · ${formatDate(h.date)}`}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {[h.vehicleText, h.plate].filter(Boolean).join(' · ')}
        </Text>
        <List>
          {h.lines.map((l, i) => (
            <ListRow key={i} title={l.description} subtitle={l.qty !== 1 ? `${l.qty} × ${formatAed(l.unitNetFils)}` : undefined} right={<Money fils={l.grossFils} size="sm" />} />
          ))}
          <ListRow title={<Text span c="dimmed" inherit>VAT</Text>} right={<Money fils={h.vatFils} size="sm" c="dimmed" />} />
          <ListRow title={<Text span fw={700} inherit>{t('job.total')}</Text>} right={<Money fils={h.totalFils} fw={700} />} />
        </List>
      </Stack>
    </Modal>
  );
}

export function CustomerMonthsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const desk = useDesk();
  const navigate = useNavigate();
  const { run } = useAction();
  const [params, setParams] = useSearchParams();
  const who = params.get('who') ?? '';
  const asked = params.get('month');
  const view = useScreenLiveQuery(async () => (who ? ((await loadWorkMonths(who)) ?? null) : null), [who]);
  const [pay, setPay] = useState<EntryPreset | null>(null);
  const [history, setHistory] = useState<HistoryInvoice | null>(null);
  const [unlock, setUnlock] = useState<string | null>(null);
  if (view === undefined) return <PageSkeleton />;
  if (view === null) return <EmptyState title={t('err.notFound')} />;
  const months = view.months;
  // On a PC one month is always open beside the list (the one asked, else the newest); on a phone — the one tapped.
  const shown = asked && months.some((m) => m.month === asked) ? asked : desk ? months[0]?.month : undefined;
  const pick = (month: string) => {
    haptic('selection');
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (!desk && n.get('month') === month) n.delete('month');
      else n.set('month', month);
      return n;
    }, { replace: true });
  };
  const onPay = (m: WorkMonth) => setPay({ debt: { customerId: view.customer.id, months: [m.month] }, amountFils: m.leftFils });
  const panel = (m: WorkMonth) => <MonthPanel m={m} view={view} onPay={onPay} onHistory={setHistory} onUnlock={setUnlock} />;
  const today = dubaiDate();
  // A month's row: its name, how many works, what is left of it (or what it came to, paid).
  const row = (m: WorkMonth) => {
    const open = m.month === shown;
    const count = m.works.length - m.open;
    return (
            <ListRow
              key={m.month}
              onClick={() => pick(m.month)}
              selected={desk && open}
              left={<MonthIcon m={m} />}
              title={
                <Text span inherit fw={600} data-work-month={m.month}>
                  {monthLong(m.month, lang)}
                </Text>
              }
              subtitle={[count ? t('months.works', { count }) : '', m.leftFils > 0 && m.totalFils > m.leftFils ? t('debt.ofTotal', { sum: formatAed(m.totalFils) }) : '', m.open ? t('months.inWork', { count: m.open }) : ''].filter(Boolean).join(' · ') || undefined}
              right={
                <span className="month-sum">
                  {m.leftFils > 0 ? <Money fils={m.leftFils} size="sm" c="red" fw={600} /> : m.totalFils > 0 ? <Money fils={m.totalFils} size="sm" c="dimmed" /> : null}
                  {!desk && <IconChevronDown size={18} color="var(--app-label-3)" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform var(--dur-2) var(--ease-out)' }} aria-hidden />}
                </span>
              }
            />
    );
  };
  // On a PC the months are one list beside the month open; on a phone each month is a card, the one open — its works under it.
  const list = !months.length ? (
    <EmptyState icon={IconCalendarDollar} title={t('months.empty')} />
  ) : desk ? (
    <List className="months-list">{months.map(row)}</List>
  ) : (
    <Stack gap={10} className="months-list">
      {months.map((m) => (
        <Fragment key={m.month}>
          <List className="month-card">{row(m)}</List>
          {m.month === shown && panel(m)}
        </Fragment>
      ))}
    </Stack>
  );
  const open = months.find((m) => m.month === shown);
  return (
    <>
      <PageHeader
        back
        eyebrow={customerName(view.customer) || t('customer.noName')}
        title={t('months.title')}
        right={
          // A job forgotten, this month (a month of the list — its «＋»).
          <Button variant="light" leftSection={<IconPlus size={18} />} onClick={() => navigate(`/orders/new?customerId=${view.customer.id}&day=${today}`)} data-months-add>
            {t('months.addShort')}
          </Button>
        }
      />
      <div className="months-total">
        <span>{t('months.owes')}</span>
        <Money fils={view.leftFils} c={view.leftFils > 0 ? 'red' : 'teal'} fw={700} roll />
      </div>
      <DeskSplit
        desk={desk}
        className="months-split"
        side={list}
        main={
          // On a phone the month open is under its own card (in the list).
          desk && open ? (
            <>
              <div className="months-open-title">
                <Text fw={700} fz={22}>
                  {monthLong(open.month, lang)}
                </Text>
                <Text c="dimmed" size="sm">
                  {open.leftFils > 0 ? t('months.leftOf', { left: formatAed(open.leftFils), of: formatAed(open.totalFils) }) : open.totalFils > 0 ? t('months.allPaid', { sum: formatAed(open.totalFils) }) : ''}
                </Text>
              </div>
              {panel(open)}
            </>
          ) : null
        }
      />
      <SheetFor value={pay}>{(p, o) => <EntrySheet opened={o} onClose={() => setPay(null)} preset={p} />}</SheetFor>
      <SheetFor value={history}>{(h, o) => <HistorySheet h={h} opened={o} onClose={() => setHistory(null)} />}</SheetFor>
      <ConfirmModal
        opened={!!unlock}
        onClose={() => setUnlock(null)}
        title={unlock ? t('months.unlockTitle', { month: monthLong(unlock, lang) }) : ''}
        confirmLabel={t('months.unlock')}
        icon={<IconLockOpen size={20} />}
        onConfirm={() =>
          run(async () => {
            if (unlock) await setMonthLocked(view.customer.id, unlock, false);
            setUnlock(null);
            haptic('light');
          })
        }
      >
        {t('months.unlockText')}
      </ConfirmModal>
    </>
  );
}
