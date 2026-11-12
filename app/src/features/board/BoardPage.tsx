import { Badge, Box, Button, Group, Text, Tooltip } from '@mantine/core';
import { IconArchive, IconArrowBackUp, IconLayoutKanban, IconPlus } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { TZ } from '../../domain/dates';
import { lastChange, type Phase } from '../../domain/flow';
import { archiveJob, phaseOf } from '../../services/flow';
import { loadOrderBundle, type OrderBundle } from '../../services/orders';
import { EmptyState, List, PageHeader, PageSkeleton, ScrollTabs, undoToast } from '../../ui/components';
import { useAction, useLang, usePhone } from '../../ui/hooks';
import { PHASE_META } from '../job/phase';
import { InsecureWarning } from './BoardNotices';
import { JobRow, type RowSwipe } from './JobRow';
import { TodayList } from './TodayList';
import { coverIndex } from '../../services/cover';

async function loadBoard() {
  const orders = await db.orders.filter((o) => o.stage !== 'closed' && o.stage !== 'cancelled').toArray();
  return (await Promise.all(orders.map((o) => loadOrderBundle(o.id)))).filter(Boolean) as OrderBundle[];
}

/** The archive's second part: the latest closed jobs of the app (not the history carried over). */
async function loadClosed() {
  const orders = (await db.orders.filter((o) => (o.stage === 'closed' || o.stage === 'cancelled') && !o.imported?.history).toArray())
    .sort((a, b) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt))
    .slice(0, 60);
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
function Kanban({ jobs, covers, swipe }: { jobs: Job[]; covers?: Map<string, string>; swipe: (b: OrderBundle) => RowSwipe }) {
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
                <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} swipe={swipe(j.b)} />
              ))}
            </List>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The workshop at a glance: every car as one row, the one something last happened on first. The chips
 * on top count the cars on each step (look, price, wait, work, pay…) and filter the list.
 */
export function BoardPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run } = useAction();
  const bundles = useLiveQuery(loadBoard, []);
  const mobile = usePhone();
  const [filter, setFilter] = useState<'all' | 'archive' | Phase>('all');
  const archive = filter === 'archive';
  const closed = useLiveQuery(() => (archive ? loadClosed() : Promise.resolve([] as OrderBundle[])), [archive]);
  const covers = useLiveQuery(() => coverIndex([...(bundles ?? []), ...(closed ?? [])].map((b) => b.vehicle.id)), [bundles, closed]);
  if (!bundles) return <PageSkeleton />;
  // The freshest first: the job something last happened on is on top.
  const fresh = (x: Job, y: Job) => lastChange(y.b).localeCompare(lastChange(x.b));
  const all: Job[] = bundles.map((b) => ({ b, phase: phaseOf(b) })).filter((j) => STEPS.includes(j.phase));
  const jobs = all.filter((j) => !j.b.order.archivedAt).sort(fresh);
  const archived = all.filter((j) => !!j.b.order.archivedAt).sort(fresh);
  const done: Job[] = (closed ?? []).map((b) => ({ b, phase: phaseOf(b) }));

  // A swipe left: off the board (with Undo), or — in the archive — back on it.
  const toArchive = (b: OrderBundle): RowSwipe => ({
    label: t('board.toArchive'),
    icon: IconArchive,
    color: 'grape',
    onCommit: () =>
      void run(async () => {
        await archiveJob(b.order.id, true);
        undoToast(t('board.archived', { n: b.order.number }), t('common.undo'), () => void archiveJob(b.order.id, false));
      }),
  });
  const back = (b: OrderBundle): RowSwipe => ({
    label: t('board.unarchive'),
    icon: IconArrowBackUp,
    color: 'cobalt',
    onCommit: () => void run(() => archiveJob(b.order.id, false), 'board.unarchived'),
  });

  const dateLabel = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date());
  const header = (
    <PageHeader
      eyebrow={dateLabel}
      title={t('board.title')}
      right={
        !mobile && (
          <Button variant={archive ? 'filled' : 'default'} leftSection={<IconArchive size={18} />} onClick={() => setFilter(archive ? 'all' : 'archive')}>
            {t('board.archive')}
            {archived.length > 0 ? ` · ${archived.length}` : ''}
          </Button>
        )
      }
    />
  );

  const archiveList =
    archived.length + done.length > 0 ? (
      <List>
        {archived.map((j) => (
          <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} swipe={back(j.b)} />
        ))}
        {done.map((j) => (
          <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} />
        ))}
      </List>
    ) : closed ? (
      <EmptyState icon={IconArchive} title={t('board.archiveEmpty')} />
    ) : (
      <PageSkeleton />
    );

  if (jobs.length === 0 && archived.length === 0 && !archive)
    return (
      <>
        {header}
        <InsecureWarning />
        <TodayList bundles={bundles} />
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
        {mobile && (
          <Group justify="center" mt="md">
            <Button variant="subtle" leftSection={<IconArchive size={18} />} onClick={() => setFilter('archive')}>
              {t('board.archive')}
            </Button>
          </Group>
        )}
      </>
    );

  const count = (p: Phase) => jobs.filter((j) => j.phase === p).length;
  const phaseFilter = filter !== 'all' && filter !== 'archive' && count(filter) > 0 ? filter : undefined;
  const shown = phaseFilter ? jobs.filter((j) => j.phase === phaseFilter) : jobs;
  return (
    <>
      {header}
      <InsecureWarning />
      {!archive && (mobile ? <TodayList bundles={bundles} /> : <Box maw={720}><TodayList bundles={bundles} limit={5} /></Box>)}
      {mobile ? (
        <>
          <ScrollTabs
            value={archive ? 'archive' : phaseFilter ?? 'all'}
            onChange={(v) => setFilter(v as 'all' | 'archive' | Phase)}
            items={[
              { value: 'all', label: t('board.all'), count: jobs.length },
              ...STEPS.filter((p) => count(p) > 0).map((p) => ({ value: p, label: t(`job.phase.${p}`), count: count(p) })),
              { value: 'archive', label: t('board.archive'), count: archived.length || undefined },
            ]}
          />
          {archive ? (
            archiveList
          ) : shown.length ? (
            <List>
              {shown.map((j) => (
                <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} swipe={toArchive(j.b)} />
              ))}
            </List>
          ) : (
            <EmptyState icon={IconLayoutKanban} title={t('board.emptyTitle')} />
          )}
        </>
      ) : archive ? (
        <Box maw={720}>{archiveList}</Box>
      ) : (
        <Kanban jobs={jobs} covers={covers} swipe={toArchive} />
      )}
    </>
  );
}
