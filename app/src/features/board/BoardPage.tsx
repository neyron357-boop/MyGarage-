import { Badge, Box, Button, Group, Text, Tooltip } from '@mantine/core';
import { IconLayoutKanban, IconPlus } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { TZ } from '../../domain/dates';
import type { Phase } from '../../domain/flow';
import { phaseOf } from '../../services/flow';
import { loadOrderBundle, type OrderBundle } from '../../services/orders';
import { EmptyState, List, PageHeader, PageSkeleton, ScrollTabs } from '../../ui/components';
import { useLang, usePhone } from '../../ui/hooks';
import { PHASE_META } from '../job/phase';
import { InsecureWarning } from './BoardNotices';
import { JobRow } from './JobRow';
import { coverIndex } from '../../services/cover';

async function loadBoard() {
  const orders = await db.orders.filter((o) => o.stage !== 'closed' && o.stage !== 'cancelled').toArray();
  return (await Promise.all(orders.map((o) => loadOrderBundle(o.id)))).filter(Boolean) as OrderBundle[];
}

/** The steps of a job in the order the day goes: cars to look at first, debts last. */
const STEPS: Phase[] = ['look', 'price', 'wait', 'work', 'pay', 'out', 'booked', 'debt'];
type Job = { b: OrderBundle; phase: Phase };

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

/** PC board: one lane per step; empty steps fold into thin strips so busy lanes get the width. */
function Kanban({ jobs, covers }: { jobs: Job[]; covers?: Map<string, string> }) {
  const { t } = useTranslation();
  const ref = useEdgeFade();
  const lanes = STEPS.map((p) => ({ p, list: jobs.filter((j) => j.phase === p) }));
  const cols = lanes.map((l) => (l.list.length ? 'minmax(280px, 1fr)' : '46px')).join(' ');
  return (
    <div className="kanban edge-fade" ref={ref} style={{ gridTemplateColumns: cols, gridAutoFlow: 'initial' }}>
      {lanes.map(({ p, list }) => {
        const m = PHASE_META[p];
        const name = t(`job.phase.${p}`);
        if (!list.length)
          return (
            <Tooltip key={p} label={`${name} · 0`} position="top">
              <div className="kanban-fold" aria-label={`${name}: 0`}>
                <span className="stage-dot" style={{ background: `var(--mantine-color-${m.color}-6)` }} />
                <span className="fold-label">{name}</span>
              </div>
            </Tooltip>
          );
        return (
          <div key={p} className="kanban-col">
            <Group justify="space-between" mb="xs" px={4} wrap="nowrap">
              <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                <span className="stage-dot" style={{ background: `var(--mantine-color-${m.color}-6)` }} />
                <Text fw={700} size="sm" truncate>
                  {name}
                </Text>
              </Group>
              <Badge variant="default" size="sm" radius="xl" className="tnum">
                {list.length}
              </Badge>
            </Group>
            <List>
              {list.map((j) => (
                <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} />
              ))}
            </List>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The workshop at a glance: every car as one row, in the order of the day — look, price, wait, work,
 * pay. The chips on top count the cars on each step and filter the list.
 */
export function BoardPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const bundles = useLiveQuery(loadBoard, []);
  const covers = useLiveQuery(() => coverIndex(bundles?.map((b) => b.vehicle.id) ?? []), [bundles]);
  const mobile = usePhone();
  const [filter, setFilter] = useState<'all' | Phase>('all');
  if (!bundles) return <PageSkeleton />;
  const jobs: Job[] = bundles
    .map((b) => ({ b, phase: phaseOf(b) }))
    .filter((j) => STEPS.includes(j.phase))
    .sort((x, y) => STEPS.indexOf(x.phase) - STEPS.indexOf(y.phase) || x.b.order.stageChangedAt.localeCompare(y.b.order.stageChangedAt));
  const dateLabel = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date());
  const header = <PageHeader eyebrow={dateLabel} title={t('board.title')} />;

  if (jobs.length === 0)
    return (
      <>
        {header}
        <InsecureWarning />
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
          />
        </Box>
      </>
    );

  const count = (p: Phase) => jobs.filter((j) => j.phase === p).length;
  const shown = filter === 'all' || count(filter) === 0 ? jobs : jobs.filter((j) => j.phase === filter);
  return (
    <>
      {header}
      <InsecureWarning />
      {mobile ? (
        <>
          <ScrollTabs
            value={filter !== 'all' && count(filter) === 0 ? 'all' : filter}
            onChange={(v) => setFilter(v as 'all' | Phase)}
            items={[{ value: 'all', label: t('board.all'), count: jobs.length }, ...STEPS.filter((p) => count(p) > 0).map((p) => ({ value: p, label: t(`job.phase.${p}`), count: count(p) }))]}
          />
          <List>
            {shown.map((j) => (
              <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} />
            ))}
          </List>
        </>
      ) : (
        <Kanban jobs={jobs} covers={covers} />
      )}
    </>
  );
}
