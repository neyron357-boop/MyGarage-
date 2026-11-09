import { Badge, Box, Button, Group, SimpleGrid, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core';
import {
  IconAlarm,
  IconBellRinging,
  IconCalendarTime,
  IconCash,
  IconClipboardList,
  IconHourglassHigh,
  IconLayoutKanban,
  IconPackage,
  IconParking,
  IconPlus,
  type Icon,
} from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate, formatDate, formatDateTime, TZ } from '../../domain/dates';
import { BOARD_STAGES } from '../../domain/stages';
import type { Stage } from '../../domain/types';
import { cashState } from '../../services/money';
import { bundleAmountDue, loadOrderBundle, type OrderBundle } from '../../services/orders';
import { EmptyState, Kpi, List, ListRow, Money, PageHeader, PageSkeleton, PlateText, ScrollTabs, Section, STAGE_META } from '../../ui/components';
import { useLang, usePhone } from '../../ui/hooks';
import { orderFlags } from '../orders/flags';
import { JobCard } from '../orders/JobCard';
import { attentionItems, type AttentionItem, type AttentionKind } from './attention';
import { InsecureWarning, SetupChecklist } from './BoardNotices';

async function loadBoard() {
  const orders = await db.orders.filter((o) => o.stage !== 'closed' && o.stage !== 'cancelled').toArray();
  const bundles = (await Promise.all(orders.map((o) => loadOrderBundle(o.id)))).filter(Boolean) as OrderBundle[];
  const cash = await cashState();
  return { bundles, cash: cash.expected };
}

const ATTENTION_ICON: Record<AttentionKind, { icon: Icon; color: string; tab?: string }> = {
  waitingClient: { icon: IconHourglassHigh, color: 'orange', tab: 'approvals' },
  estimateExpired: { icon: IconAlarm, color: 'red', tab: 'approvals' },
  notifyReady: { icon: IconBellRinging, color: 'green' },
  storage: { icon: IconParking, color: 'red' },
  pickupParts: { icon: IconPackage, color: 'orange', tab: 'work' },
  noShow: { icon: IconCalendarTime, color: 'gray' },
  intakeUnfinished: { icon: IconClipboardList, color: 'indigo' },
  debtOverdue: { icon: IconCash, color: 'red', tab: 'payments' },
};

function AttentionRow({ a }: { a: AttentionItem }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const m = ATTENTION_ICON[a.kind];
  const params = { ...a.params, time: a.params.time ? formatDateTime(String(a.params.time)).slice(11) : '', date: a.params.date ? formatDate(String(a.params.date)) : '' };
  return (
    <ListRow
      onClick={() => navigate(`/orders/${a.orderId}${m.tab ? `?tab=${m.tab}` : ''}`)}
      chevron
      left={
        <ThemeIcon variant="light" color={m.color} size={40} radius="md">
          <m.icon size={21} stroke={1.8} />
        </ThemeIcon>
      }
      title={t(`attention.${a.kind}`, params)}
      subtitle={
        <Group gap={6} wrap="nowrap">
          <PlateText plate={a.bundle.vehicle.plate} size="xs" />
          <Text span size="xs" c="dimmed" lineClamp={1}>
            {a.bundle.vehicle.make} {a.bundle.vehicle.model} · {a.bundle.customer.name}
          </Text>
        </Group>
      }
    />
  );
}

type Filter = 'active' | 'waiting' | 'parts' | 'ready' | 'booked' | 'delivered';

/** Fades the edge of a horizontal scroller where more content is hidden. */
function useEdgeFade() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.dataset.fadeLeft = String(el.scrollLeft > 4);
      el.dataset.fadeRight = String(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);
  return ref;
}

/** PC board: one lane per stage; empty stages fold into thin strips so busy lanes get the width. */
function Kanban({ byStage }: { byStage: (s: Stage) => OrderBundle[] }) {
  const { t } = useTranslation();
  const ref = useEdgeFade();
  const lanes = BOARD_STAGES.map((s) => ({ s, list: byStage(s) }));
  const cols = lanes.map((l) => (l.list.length ? 'minmax(236px, 1fr)' : '46px')).join(' ');
  return (
    <div className="kanban edge-fade" ref={ref} style={{ gridTemplateColumns: cols, gridAutoFlow: 'initial' }}>
      {lanes.map(({ s, list }) => {
        const m = STAGE_META[s];
        if (!list.length)
          return (
            <Tooltip key={s} label={`${t(`stage.${s}`)} · 0`} position="top">
              <div className="kanban-fold" aria-label={`${t(`stage.${s}`)}: 0`}>
                <span className="stage-dot" style={{ background: `var(--mantine-color-${m.color}-6)` }} />
                <span className="fold-label">{t(`stage.${s}`)}</span>
              </div>
            </Tooltip>
          );
        return (
          <div key={s} className="kanban-col">
            <Group justify="space-between" mb="xs" px={4} wrap="nowrap">
              <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                <span className="stage-dot" style={{ background: `var(--mantine-color-${m.color}-6)` }} />
                <Text fw={700} size="sm" truncate>
                  {t(`stage.${s}`)}
                </Text>
              </Group>
              <Badge variant="default" size="sm" radius="xl" className="tnum">
                {list.length}
              </Badge>
            </Group>
            <div className="lane stagger">
              {list.map((b) => (
                <JobCard key={b.order.id} b={b} showStage={false} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BoardPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const data = useLiveQuery(loadBoard, []);
  const mobile = usePhone();
  const [filter, setFilter] = useState<Filter>('active');
  if (!data) return <PageSkeleton />;
  const { bundles } = data;
  const byStage = (s: Stage) => bundles.filter((b) => b.order.stage === s).sort((a, b) => a.order.stageChangedAt.localeCompare(b.order.stageChangedAt));
  const today = dubaiDate();
  const dateLabel = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date());
  const arriving = bundles.filter((b) => b.order.stage === 'booked' && b.order.bookedFor && dubaiDate(b.order.bookedFor) === today);
  const inShop = bundles.filter((b) => !['booked', 'delivered'].includes(b.order.stage));
  const waiting = bundles.filter((b) => orderFlags(b).flags.waitingClientSince);
  const ready = byStage('ready');
  const attention = attentionItems(bundles);

  const header = <PageHeader eyebrow={dateLabel} title={t('board.title')} />;

  const kpis = (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
      <Kpi label={t('board.inShop')} value={inShop.length} hint={arriving.length ? t('board.inShopHint', { n: arriving.length }) : undefined} onClick={mobile && inShop.length ? () => setFilter('active') : undefined} />
      <Kpi label={t('board.waitingClient')} value={waiting.length} color={waiting.length ? 'orange' : undefined} onClick={mobile && waiting.length ? () => setFilter('waiting') : undefined} />
      <Kpi label={t('board.ready')} value={ready.length} color={ready.length ? 'green' : undefined} onClick={mobile && ready.length ? () => setFilter('ready') : undefined} />
      <Kpi label={t('board.cash')} value={<Money fils={data.cash} display />} onClick={() => navigate('/money?tab=cash')} />
    </SimpleGrid>
  );

  if (bundles.length === 0)
    return (
      <>
        {header}
        <InsecureWarning />
        <SetupChecklist />
        {kpis}
        <Box mt="xl">
          <EmptyState
            icon={IconLayoutKanban}
            title={t('board.emptyTitle')}
            action={
              <Group justify="center">
                <Button leftSection={<IconPlus size={18} />} onClick={() => navigate('/orders/new')}>
                  {t('nav.newOrder')}
                </Button>
                <Button variant="default" onClick={() => navigate('/settings?tab=data')}>
                  {t('board.tryDemo')}
                </Button>
              </Group>
            }
          >
            {t('board.empty')}
          </EmptyState>
        </Box>
      </>
    );

  const attentionBlock = attention.length > 0 && (
    <Section
      title={
        <Group gap={8}>
          {t('board.attention')}
          <Badge color="red" variant="filled" size="sm" circle className="pop-in">
            {attention.length}
          </Badge>
        </Group>
      }
      description={t('board.attentionHint')}
    >
      <List>
        {attention.slice(0, 6).map((a) => (
          <AttentionRow key={a.kind + a.orderId} a={a} />
        ))}
      </List>
    </Section>
  );

  const arrivingBlock = arriving.length > 0 && (
    <Section title={`${t('board.arrivingToday')} · ${arriving.length}`}>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" className="stagger">
        {arriving.map((b) => (
          <JobCard key={b.order.id} b={b} showStage={false} />
        ))}
      </SimpleGrid>
    </Section>
  );

  if (mobile) {
    const lists: Record<Filter, OrderBundle[]> = {
      active: inShop.sort((a, b) => STAGE_META[a.order.stage].step - STAGE_META[b.order.stage].step),
      waiting,
      parts: bundles.filter((b) => orderFlags(b).flags.waitingParts && b.order.stage !== 'booked'),
      ready,
      booked: byStage('booked'),
      delivered: bundles.filter((b) => b.order.stage === 'delivered' && bundleAmountDue(b) > 0),
    };
    const list = lists[filter];
    return (
      <>
        {header}
        <InsecureWarning />
        {kpis}
        {/* The backup reminder lives in More and Settings → Data, not on the board. */}
        <Box mt="lg">
          <SetupChecklist compact />
        </Box>
        {attentionBlock}
        {arrivingBlock}
        <Section title={t('board.jobs')}>
          <ScrollTabs
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            items={[
              { value: 'active', label: t('board.tabActive'), count: lists.active.length },
              { value: 'waiting', label: t('board.waitingClient'), count: lists.waiting.length },
              { value: 'parts', label: t('flags.waitingParts'), count: lists.parts.length },
              { value: 'ready', label: t('stage.ready'), count: lists.ready.length },
              { value: 'booked', label: t('stage.booked'), count: lists.booked.length },
              { value: 'delivered', label: t('board.tabDebts'), count: lists.delivered.length },
            ]}
          />
          <Stack gap="sm" key={filter} className="stagger tab-panel">
            {list.length === 0 && <EmptyState>{t('board.nothing')}</EmptyState>}
            {list.map((b) => (
              <JobCard key={b.order.id} b={b} />
            ))}
          </Stack>
        </Section>
      </>
    );
  }

  return (
    <>
      {header}
      <InsecureWarning />
      {kpis}
      <Box mt="lg">
        <SetupChecklist compact />
      </Box>
      {attentionBlock}
      {arrivingBlock}
      <Section title={t('board.jobs')} description={t('board.kanbanHint')}>
        <Kanban byStage={byStage} />
      </Section>
    </>
  );
}
