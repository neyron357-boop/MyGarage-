import { Badge, Box, Button, Card, Group, Paper, ScrollArea, SimpleGrid, Stack, Tabs, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate, formatDateTime, hoursBetween, shortDuration } from '../../domain/dates';
import { summarize } from '../../domain/items';
import { BOARD_STAGES } from '../../domain/stages';
import type { Stage } from '../../domain/types';
import { cashState } from '../../services/money';
import { loadOrderBundle, type OrderBundle } from '../../services/orders';
import { EmptyState, Flags, Money, PageHeader, PlateText } from '../../ui/components';
import { useLang } from '../../ui/hooks';
import { orderFlags } from '../orders/flags';

async function loadBoard() {
  const orders = await db.orders.filter((o) => o.stage !== 'closed' && o.stage !== 'cancelled').toArray();
  const bundles = (await Promise.all(orders.map((o) => loadOrderBundle(o.id)))).filter(Boolean) as OrderBundle[];
  const cash = await cashState();
  return { bundles, cash: cash.expected };
}

function OrderCard({ b }: { b: OrderBundle }) {
  const navigate = useNavigate();
  const lang = useLang();
  const { t } = useTranslation();
  const { flags, waitingHours } = orderFlags(b);
  const sum = summarize(b.items);
  const inStage = hoursBetween(b.order.stageChangedAt);
  return (
    <Card withBorder padding="sm" className="tap-card" onClick={() => navigate(`/orders/${b.order.id}`)}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <PlateText plate={b.vehicle.plate} />
        <Text size="xs" c="dimmed">
          №{b.order.number} · {shortDuration(inStage, lang)}
        </Text>
      </Group>
      <Text fw={600} mt={6} lineClamp={1}>
        {b.vehicle.make} {b.vehicle.model} {b.vehicle.year ?? ''}
      </Text>
      <Text size="sm" c="dimmed" lineClamp={1}>
        {b.customer.name}
        {b.mechanic ? ` · ${b.mechanic.name}` : ''}
      </Text>
      {b.order.stage === 'booked' && b.order.bookedFor && (
        <Text size="sm" mt={4}>
          🕒 {formatDateTime(b.order.bookedFor)}
        </Text>
      )}
      {b.order.complaint && (
        <Text size="sm" mt={4} lineClamp={2}>
          {b.order.complaint}
        </Text>
      )}
      <Box mt={6}>
        <Flags flags={flags} hours={waitingHours} warnHours={b.settings.boardWarnHours} alertHours={b.settings.boardAlertHours} />
      </Box>
      {(sum.approvedGross > 0 || sum.maxGross > 0) && (
        <Group justify="flex-end" mt={6}>
          <Text size="xs" c="dimmed">
            {t('board.approved')}
          </Text>
          <Money fils={sum.approvedGross} fw={600} size="sm" />
        </Group>
      )}
    </Card>
  );
}

export function BoardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const data = useLiveQuery(loadBoard, []);
  const mobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false });
  const [tab, setTab] = useState<string | null>('active');
  if (!data) return null;
  const { bundles } = data;
  const byStage = (s: Stage) => bundles.filter((b) => b.order.stage === s).sort((a, b) => a.order.stageChangedAt.localeCompare(b.order.stageChangedAt));
  const today = dubaiDate();
  const arriving = bundles.filter((b) => b.order.stage === 'booked' && b.order.bookedFor && dubaiDate(b.order.bookedFor) === today);
  const inShop = bundles.filter((b) => !['booked', 'delivered'].includes(b.order.stage));
  const waitingClient = bundles.filter((b) => orderFlags(b).flags.waitingClientSince).length;
  const ready = byStage('ready').length;
  const debts = bundles.filter((b) => orderFlags(b).flags.debt).length;

  const stats = (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" mb="md">
      <Paper withBorder p="sm">
        <Text size="xs" c="dimmed">{t('board.inShop')}</Text>
        <Text fw={700} size="xl">{inShop.length}</Text>
      </Paper>
      <Paper withBorder p="sm">
        <Text size="xs" c="dimmed">{t('board.waitingClient')}</Text>
        <Text fw={700} size="xl" c={waitingClient ? 'orange' : undefined}>{waitingClient}</Text>
      </Paper>
      <Paper withBorder p="sm">
        <Text size="xs" c="dimmed">{t('board.ready')}</Text>
        <Text fw={700} size="xl" c={ready ? 'green' : undefined}>{ready}</Text>
      </Paper>
      <Paper withBorder p="sm" className="tap-card" onClick={() => navigate('/money?tab=cash')}>
        <Text size="xs" c="dimmed">{t('board.cash')}</Text>
        <Money fils={data.cash} fw={700} size="xl" />
      </Paper>
    </SimpleGrid>
  );

  const arrivingBlock = arriving.length > 0 && (
    <Paper withBorder p="sm" mb="md">
      <Text fw={600} mb={6}>{t('board.arrivingToday')} ({arriving.length})</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
        {arriving.map((b) => <OrderCard key={b.order.id} b={b} />)}
      </SimpleGrid>
    </Paper>
  );

  const header = (
    <PageHeader
      title={t('board.title')}
      right={
        <Button visibleFrom="sm" leftSection={<IconPlus size={18} />} onClick={() => navigate('/orders/new')}>
          {t('nav.newOrder')}
        </Button>
      }
    />
  );

  if (bundles.length === 0)
    return (
      <>
        {header}
        {stats}
        <EmptyState>
          <Text mb="sm">{t('board.empty')}</Text>
          <Button onClick={() => navigate('/orders/new')}>{t('nav.newOrder')}</Button>
        </EmptyState>
      </>
    );

  if (mobile) {
    const active = bundles.filter((b) => b.order.stage !== 'booked' && b.order.stage !== 'delivered');
    const lists: Record<string, OrderBundle[]> = {
      active,
      booked: byStage('booked'),
      waiting: bundles.filter((b) => orderFlags(b).flags.waitingClientSince),
      ready: byStage('ready'),
      delivered: byStage('delivered'),
    };
    return (
      <>
        {header}
        {stats}
        {arrivingBlock}
        <Tabs value={tab} onChange={setTab} variant="pills" mb="sm">
          <ScrollArea type="never">
            <Tabs.List style={{ flexWrap: 'nowrap' }}>
              <Tabs.Tab value="active">{t('board.tabActive')} <Badge size="xs" variant="light">{active.length}</Badge></Tabs.Tab>
              <Tabs.Tab value="waiting">{t('board.waitingClient')} <Badge size="xs" variant="light">{lists.waiting.length}</Badge></Tabs.Tab>
              <Tabs.Tab value="ready">{t('stage.ready')} <Badge size="xs" variant="light">{lists.ready.length}</Badge></Tabs.Tab>
              <Tabs.Tab value="booked">{t('stage.booked')} <Badge size="xs" variant="light">{lists.booked.length}</Badge></Tabs.Tab>
              <Tabs.Tab value="delivered">{t('board.tabDebts')} <Badge size="xs" variant="light">{debts}</Badge></Tabs.Tab>
            </Tabs.List>
          </ScrollArea>
        </Tabs>
        <Stack gap="xs">
          {(lists[tab ?? 'active'] ?? []).length === 0 && <EmptyState>{t('board.nothing')}</EmptyState>}
          {(lists[tab ?? 'active'] ?? []).map((b) => (
            <Box key={b.order.id}>
              {tab === 'active' && (
                <Text size="xs" c="dimmed" mb={2}>
                  {t(`stage.${b.order.stage}`)}
                </Text>
              )}
              <OrderCard b={b} />
            </Box>
          ))}
        </Stack>
      </>
    );
  }

  return (
    <>
      {header}
      {stats}
      {arrivingBlock}
      <ScrollArea type="auto" offsetScrollbars>
        <Group align="flex-start" wrap="nowrap" gap="sm">
          {BOARD_STAGES.map((s) => {
            const list = byStage(s);
            return (
              <Paper key={s} withBorder p="xs" w={260} miw={260} bg="var(--mantine-color-default-hover)">
                <Group justify="space-between" mb="xs">
                  <Text fw={600} size="sm">{t(`stage.${s}`)}</Text>
                  <Badge variant="light" size="sm">{list.length}</Badge>
                </Group>
                <Stack gap="xs">
                  {list.map((b) => <OrderCard key={b.order.id} b={b} />)}
                </Stack>
              </Paper>
            );
          })}
        </Group>
      </ScrollArea>
    </>
  );
}
