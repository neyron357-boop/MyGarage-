import { Badge, Box, Button, Group, ScrollArea, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate, formatDate, formatDateTime, TZ } from '../../domain/dates';
import { BOARD_STAGES } from '../../domain/stages';
import type { Stage } from '../../domain/types';
import { cashState } from '../../services/money';
import { bundleAmountDue, loadOrderBundle, type OrderBundle } from '../../services/orders';
import { EmptyState, Kpi, List, ListRow, Money, PageHeader, PlateText, ScrollTabs, Section, STAGE_META } from '../../ui/components';
import { useLang } from '../../ui/hooks';
import { orderFlags } from '../orders/flags';
import { JobCard } from '../orders/JobCard';
import { attentionItems, type AttentionItem, type AttentionKind } from './attention';

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

export function BoardPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const data = useLiveQuery(loadBoard, []);
  const mobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false });
  const [filter, setFilter] = useState<Filter>('active');
  if (!data) return null;
  const { bundles } = data;
  const byStage = (s: Stage) => bundles.filter((b) => b.order.stage === s).sort((a, b) => a.order.stageChangedAt.localeCompare(b.order.stageChangedAt));
  const today = dubaiDate();
  const dateLabel = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date());
  const arriving = bundles.filter((b) => b.order.stage === 'booked' && b.order.bookedFor && dubaiDate(b.order.bookedFor) === today);
  const inShop = bundles.filter((b) => !['booked', 'delivered'].includes(b.order.stage));
  const waiting = bundles.filter((b) => orderFlags(b).flags.waitingClientSince);
  const ready = byStage('ready');
  const attention = attentionItems(bundles);

  const header = (
    <PageHeader
      eyebrow={dateLabel}
      title={t('board.title')}
    />
  );

  const kpis = (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
      <Kpi label={t('board.inShop')} value={inShop.length} hint={t('board.inShopHint', { n: arriving.length })} />
      <Kpi label={t('board.waitingClient')} value={waiting.length} color={waiting.length ? 'orange' : undefined} onClick={waiting.length ? () => setFilter('waiting') : undefined} />
      <Kpi label={t('board.ready')} value={ready.length} color={ready.length ? 'green' : undefined} onClick={ready.length ? () => setFilter('ready') : undefined} />
      <Kpi label={t('board.cash')} value={<Money fils={data.cash} display />} onClick={() => navigate('/money?tab=cash')} />
    </SimpleGrid>
  );

  if (bundles.length === 0)
    return (
      <>
        {header}
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
          <Badge color="red" variant="filled" size="sm" circle>
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
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
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
        {kpis}
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
          <Stack gap="sm">
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
      {kpis}
      {attentionBlock}
      {arrivingBlock}
      <Section title={t('board.jobs')}>
        <ScrollArea type="auto" offsetScrollbars>
          <Group align="flex-start" wrap="nowrap" gap="md" pb="sm">
            {BOARD_STAGES.map((s) => {
              const list = byStage(s);
              const m = STAGE_META[s];
              return (
                <Box key={s} w={272} miw={272}>
                  <Group justify="space-between" mb="xs" px={4}>
                    <Group gap={8} wrap="nowrap">
                      <span className="stage-dot" style={{ background: `var(--mantine-color-${m.color}-6)` }} />
                      <Text fw={700} size="sm">
                        {t(`stage.${s}`)}
                      </Text>
                    </Group>
                    <Text size="sm" c="dimmed" fw={600} className="tnum">
                      {list.length}
                    </Text>
                  </Group>
                  <Stack gap="sm" p={6} style={{ background: 'color-mix(in srgb, var(--app-hairline) 45%, transparent)', borderRadius: 16, minHeight: 120 }}>
                    {list.map((b) => (
                      <JobCard key={b.order.id} b={b} showStage={false} />
                    ))}
                    {list.length === 0 && (
                      <Text size="xs" c="dimmed" ta="center" py="lg">
                        —
                      </Text>
                    )}
                  </Stack>
                </Box>
              );
            })}
          </Group>
        </ScrollArea>
      </Section>
    </>
  );
}
