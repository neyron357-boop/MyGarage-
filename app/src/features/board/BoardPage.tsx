import { ActionIcon, Box, Button, Group, Stack, Tooltip } from '@mantine/core';
import { IconAdjustmentsHorizontal, IconArchive, IconArrowBackUp, IconCar, IconExternalLink, IconLayoutKanban, IconPlus, IconUserDollar } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { dayLong, dayShort } from '../../domain/dates';
import { lastChange, leftBoardAt, type Phase } from '../../domain/flow';
import { formatPhone } from '../../domain/phone';
import { coverIndex } from '../../services/cover';
import { loadDebtors } from '../../services/debts';
import { archiveJob, phaseOf } from '../../services/flow';
import { bundleAmountDue, loadOrderBundle, loadRowBundles, prefetchBundle, type OrderBundle } from '../../services/orders';
import { useBoardView, type BoardTab } from '../../ui/boardView';
import { EmptyState, List, MediaImage, Money, PageHeader, PageSkeleton, PlateText, ScrollTabs, undoToast, type TabItem } from '../../ui/components';
import { DataTable, type Column } from '../../ui/DataTable';
import { DeskMenu, type DeskMenuItem } from '../../ui/desk';
import { useAction, useLang, usePhone, useScreenLiveQuery } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { checkForUpdate } from '../../ui/pwa';
import { usePullRefresh } from '../../ui/pullRefresh';
import { PHASE_META, PhaseTag, usePhaseGlow } from '../job/phase';
import { DebtorList } from '../money/Debts';
import { InsecureWarning } from './BoardNotices';
import { BoardViewSheet } from './BoardViewSheet';
import { jobAmount, jobTotal, JobRow, type RowSwipe } from './JobRow';
import { TodayBell } from './TodayBell';

/** The board as it was read last: coming back to it shows the cars at once, the live read follows. */
let lastBoard: { bundles: OrderBundle[]; covers: Map<string, string> } | undefined;

/*
 * A job that did not change keeps the very bundle the board already shows, so its row is not rendered
 * again (`JobRow` compares bundles by identity). What the row reads of the settings is part of it; the
 * rest of them (the logo…) is not.
 */
const kept = new Map<string, { sig: string; b: OrderBundle }>();
const signature = ({ settings, ...rest }: OrderBundle) => JSON.stringify([rest, settings.boardWarnHours ?? null]);
function keep(b: OrderBundle): OrderBundle {
  const sig = signature(b);
  const had = kept.get(b.order.id);
  if (had && had.sig === sig) return had.b;
  kept.set(b.order.id, { sig, b });
  return b;
}

async function loadBoard(showArchive: boolean) {
  // The jobs not closed, by the stage's index (v0.37: the closed history is not read).
  const orders = await db.orders.where('stage').noneOf(['closed', 'cancelled']).toArray();
  const [open, closed] = await Promise.all([Promise.all(orders.map((o) => loadOrderBundle(o.id))), showArchive ? loadClosed() : undefined]);
  const bundles = open.filter((b): b is OrderBundle => !!b).map(keep);
  const covers = await coverIndex([...bundles, ...(closed ?? [])].map((b) => b.vehicle.id));
  const ids = new Set(orders.map((o) => o.id));
  for (const id of kept.keys()) if (!ids.has(id)) kept.delete(id);
  lastBoard = { bundles, covers };
  return { ...lastBoard, closed };
}

/**
 * The archive's second part: the latest closed jobs of the app (not the history carried over), the newest by the
 * day they left the board (`leftBoardAt` — the date on their row). A job closed with money still due is not
 * there — it is under "Debts" until it is paid, then back here as any other.
 */
async function loadClosed() {
  const orders = (await db.orders.filter((o) => (o.stage === 'closed' || o.stage === 'cancelled') && !o.imported?.history).toArray())
    .sort((a, b) => leftBoardAt(b).localeCompare(leftBoardAt(a)))
    .slice(0, 60);
  // As their rows show them (v0.37: not their journals, notes and photos — the most of a job).
  return ((await loadRowBundles(orders)).filter(Boolean) as OrderBundle[]).filter((b) => !(bundleAmountDue(b) > 0));
}

/**
 * The steps of a car in the workshop in the order the day goes: cars to look at first. A car gone with money due
 * is not one of them — it is under "Debts", one card per customer.
 */
const STEPS: Phase[] = ['look', 'price', 'wait', 'work', 'pay', 'out', 'booked'];
type Filter = 'all' | 'archive' | 'debts' | Phase;
type Job = { b: OrderBundle; phase: Phase };
const isStep = (k: string): k is Phase => (STEPS as string[]).includes(k);

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

/** Where each lane of the PC board was scrolled to: back from a job, the lanes are where they were (v0.41). */
const laneScroll = new Map<string, number>();

/**
 * PC board: one lane per step, in the order of the board's tabs («Вид»); empty steps fold into thin strips so busy
 * lanes get the width. A step hidden from the phone's strip keeps its lane — a lane holds cars. v0.41: the lanes are
 * the height of the window and each scrolls by itself (desk.css); a lane's head says how many cars and what they
 * come to.
 */
function Kanban({ jobs, covers, swipe, tick, order, compact }: { jobs: Job[]; covers?: Map<string, string>; swipe: (b: OrderBundle) => RowSwipe; tick: number; order: BoardTab[]; compact: boolean }) {
  const { t } = useTranslation();
  const ref = useEdgeFade();
  const lanes = (order.filter((k) => isStep(k)) as Phase[]).map((p) => ({ p, list: jobs.filter((j) => j.phase === p) }));
  // Every step's lane in sight at 1440 (four busy, three folded): a busy lane from 224 px, a folded one 40.
  const cols = lanes.map((l) => (l.list.length ? `minmax(${compact ? 212 : 224}px, 1fr)` : '40px')).join(' ');
  // Each lane's scroll is kept as it moves, and put back when the board comes back.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft = laneScroll.get('') ?? 0;
    el.querySelectorAll<HTMLElement>('.kanban-col[data-lane] > .list').forEach((list) => {
      list.scrollTop = laneScroll.get(list.parentElement!.dataset.lane!) ?? 0;
    });
    const onScroll = (e: Event) => {
      const at = e.target as HTMLElement;
      if (at === el) laneScroll.set('', el.scrollLeft);
      else if (at.parentElement?.dataset.lane) laneScroll.set(at.parentElement.dataset.lane, at.scrollTop);
    };
    el.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => el.removeEventListener('scroll', onScroll, { capture: true });
  }, [ref]);
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
        const sum = list.reduce((s, j) => s + jobAmount(j.b), 0);
        return (
          <div key={p} className="kanban-col" data-lane={p} style={{ '--c': `var(--mantine-color-${m.color}-6)`, '--c-ink': `var(--mantine-color-${m.color}-light-color)` } as CSSProperties}>
            <div className="kanban-head">
              <span className="stage-dot" style={{ background: 'var(--c)' }} />
              <span className="kanban-name">{name}</span>
              <span className="kanban-count">{list.length}</span>
              {sum > 0 && (
                <span className="kanban-sum">
                  <Money fils={sum} />
                </span>
              )}
            </div>
            <List animate className={compact ? 'mini-list' : 'board-cards'}>
              {list.map((j) => (
                <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} swipe={swipe(j.b)} variant={compact ? 'row' : 'card'} />
              ))}
            </List>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The archive on a PC (v0.41): one table — the day each job left the board, its number, the car, its customer, where
 * it stands, what it came to; a click on a head sorts (the latest first). A job taken off by hand goes back with ↩ or
 * from its right click's menu.
 */
function DeskArchive({ jobs, byHand, covers, onBack }: { jobs: Job[]; byHand: Set<string>; covers?: Map<string, string>; onBack: (b: OrderBundle) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; j: Job } | null>(null);
  const open = (j: Job) => navigate(`/orders/${j.b.order.id}`);
  const name = (j: Job) => [j.b.vehicle.make, j.b.vehicle.model].filter(Boolean).join(' ') || `№${j.b.order.number}`;
  const who = (j: Job) => {
    const c = j.b.customer;
    return (c.type === 'company' && c.companyName ? c.companyName : c.name) || (c.phone ? formatPhone(c.phone) : '');
  };
  // What it came to (a closed one owes nothing), or what is left of it (one taken off by hand).
  const amount = (j: Job) => (j.phase === 'closed' || j.phase === 'cancelled' ? jobTotal(j.b) : jobAmount(j.b));
  const day = (j: Job) => {
    const d = dayShort(leftBoardAt(j.b.order));
    return d.word ? t(`common.${d.word}`) : d.text;
  };
  const cols: Column<Job>[] = [
    { key: 'left', label: t('desk.col.left'), cell: day, sort: (j) => leftBoardAt(j.b.order), desc: true, muted: true, nowrap: true, width: 112 },
    { key: 'number', label: t('desk.col.number'), cell: (j) => j.b.order.number, sort: (j) => j.b.order.number, desc: true, muted: true, width: 84 },
    {
      key: 'car',
      label: t('desk.col.car'),
      sort: name,
      cell: (j) => {
        const cover = covers?.get(j.b.vehicle.id);
        return (
          <span className="dt-who">
            <span className="dt-thumb">{cover ? <MediaImage id={cover} h={40} w={40} radius="0" /> : <IconCar size={22} stroke={1.6} aria-hidden />}</span>
            <span className="dt-main dt-clip">{name(j)}</span>
          </span>
        );
      },
    },
    { key: 'plate', label: t('desk.col.plate'), cell: (j) => <PlateText plate={j.b.vehicle.plate} size="xs" />, width: 150 },
    { key: 'customer', label: t('desk.col.customer'), cell: (j) => <span className="dt-clip">{who(j)}</span>, sort: who },
    { key: 'step', label: t('desk.col.step'), cell: (j) => <PhaseTag phase={j.phase} />, sort: (j) => t(`job.phase.${j.phase}`), width: 150 },
    { key: 'amount', label: t('desk.col.amount'), cell: (j) => (amount(j) > 0 ? <Money fils={amount(j)} fw={650} /> : null), sort: amount, desc: true, align: 'right', nowrap: true, width: 150 },
    {
      key: 'back',
      label: '',
      width: 64,
      align: 'right',
      cell: (j) =>
        byHand.has(j.b.order.id) ? (
          <Tooltip label={t('board.unarchive')}>
            <ActionIcon
              variant="light"
              size={34}
              radius="xl"
              aria-label={t('board.unarchive')}
              onClick={(e) => {
                e.stopPropagation();
                onBack(j.b);
              }}
            >
              <IconArrowBackUp size={18} />
            </ActionIcon>
          </Tooltip>
        ) : null,
    },
  ];
  const items: DeskMenuItem[] = menu
    ? [
        { key: 'open', label: t('common.open'), icon: IconExternalLink, onClick: () => open(menu.j) },
        ...(byHand.has(menu.j.b.order.id) ? [{ key: 'back', label: t('board.unarchive'), icon: IconArrowBackUp, onClick: () => onBack(menu.j.b) }] : []),
      ]
    : [];
  return (
    <>
      <DataTable
        rows={jobs}
        columns={cols}
        rowKey={(j) => j.b.order.id}
        onRow={(j) => {
          prefetchBundle(j.b.order.id);
          open(j);
        }}
        onRowMenu={(j, at) => setMenu({ j, at })}
        initialSort={{ key: 'left', dir: -1 }}
        sortId="archive"
        label={t('board.archive')}
      />
      <DeskMenu at={menu?.at ?? null} items={items} onClose={() => setMenu(null)} />
    </>
  );
}

/**
 * The workshop at a glance: every car as one card, newest activity first. The chips
 * on top count the cars on each step (look, price, wait, work, pay…) and filter the list.
 */
export function BoardPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run } = useAction();
  const mobile = usePhone();
  const [filter, setFilter] = useState<Filter>('all');
  // How the board looks on this device: large cards or rows, the tabs' order and the steps left out («Вид»).
  const view = useBoardView();
  const [viewOpen, setViewOpen] = useState(false);
  const compact = view.size === 'compact';
  // Pull to refresh (the phone): the board read again, and a new version of the app looked for — it shows
  // its "Update" bar when there is one.
  const [refresh, setRefresh] = useState(0);
  const pull = usePullRefresh(() => {
    setRefresh((n) => n + 1);
    return checkForUpdate();
  });
  const archive = filter === 'archive';
  const debtsTab = filter === 'debts';
  const live = useScreenLiveQuery(() => loadBoard(archive), [archive, refresh]);
  const data = live ?? lastBoard;
  // Who owes: one card per customer — the same cards and sums as "Money → Debts". Read once the board's cars are (the
  // cars first — v0.37), and back on the board a moment after them.
  const debtors = useScreenLiveQuery(() => (data ? loadDebtors() : undefined), [refresh, !!data], 300);
  // Every five minutes the rows' "how long" moves on (a row is not rendered again otherwise).
  const tick = Math.floor(Date.now() / 300_000);
  // The freshest first: the job something last happened on is on top.
  const fresh = (x: Job, y: Job) => lastChange(y.b).localeCompare(lastChange(x.b));
  const all: Job[] = (data?.bundles ?? []).map((b) => ({ b, phase: phaseOf(b) })).filter((j) => STEPS.includes(j.phase));
  const jobs = all.filter((j) => !j.b.order.archivedAt).sort(fresh);
  // The archive: the jobs taken off by hand, the latest taken off first.
  const archived = all.filter((j) => !!j.b.order.archivedAt).sort((x, y) => leftBoardAt(y.b.order).localeCompare(leftBoardAt(x.b.order)));
  const count = (p: Phase) => jobs.filter((j) => j.phase === p).length;
  // A step is a tab while it has cars and is not left out («Вид»); the one picked counts only while it is a tab.
  const hidden = new Set<string>(view.hidden);
  const stepShown = (p: Phase) => count(p) > 0 && !hidden.has(p);
  const phaseFilter = isStep(filter) && stepShown(filter) ? filter : undefined;
  // Its last car gone, or the step left out: the board is back on «Все» (and stays there when a car comes).
  const lost = !!data && isStep(filter) && !phaseFilter;
  useEffect(() => {
    if (lost) setFilter('all');
  }, [lost]);
  // A step picked: the screen glows in its colours, as a job on that step does (debts — in red).
  const glowRef = useRef<HTMLSpanElement>(null);
  usePhaseGlow(glowRef, debtsTab ? 'debt' : phaseFilter);
  if (!data) return <PageSkeleton />;
  const { bundles, covers } = data;
  const closed = live?.closed;
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

  const dateLabel = dayLong(new Date(), lang);
  const owing = debtors?.length ?? 0;
  // «Вид»: a round glass button in the head (phone), after «Долги» and «Архив» (PC).
  const viewButton = (
    <ActionIcon variant="default" size={40} radius="xl" aria-label={t('board.view')} onClick={() => setViewOpen(true)}>
      <IconAdjustmentsHorizontal size={22} stroke={2} />
    </ActionIcon>
  );
  const pcButtons = {
    debts: (
      <Button key="debts" variant={debtsTab ? 'filled' : 'default'} color={debtsTab ? 'red' : undefined} leftSection={<IconUserDollar size={18} />} onClick={() => setFilter(debtsTab ? 'all' : 'debts')}>
        {t('board.tabDebts')}
        {owing > 0 ? ` · ${owing}` : ''}
      </Button>
    ),
    archive: (
      <Button key="archive" variant={archive ? 'filled' : 'default'} leftSection={<IconArchive size={18} />} onClick={() => setFilter(archive ? 'all' : 'archive')}>
        {t('board.archive')}
        {archived.length > 0 ? ` · ${archived.length}` : ''}
      </Button>
    ),
  };
  const header = (
    <>
      {pull}
      <PageHeader
        eyebrow={dateLabel}
        title={t('board.title')}
        right={
          mobile ? (
            <Group gap="xs" wrap="nowrap">
              <TodayBell bundles={bundles} />
              {viewButton}
            </Group>
          ) : (
            <Group gap="xs" wrap="nowrap">
              {view.order.filter((k): k is 'debts' | 'archive' => k === 'debts' || k === 'archive').map((k) => pcButtons[k])}
              <TodayBell bundles={bundles} />
              {viewButton}
            </Group>
          )
        }
      />
      <LazySheet opened={viewOpen}>{(o) => <BoardViewSheet opened={o} onClose={() => setViewOpen(false)} />}</LazySheet>
    </>
  );

  const debtList = !debtors ? <PageSkeleton /> : debtors.length ? <DebtorList debtors={debtors} /> : <EmptyState icon={IconUserDollar} title={t('debt.none')} />;

  // The archive (v0.22): smaller rows with their date — on top the jobs taken off the board by hand (a swipe
  // puts one back), under them the closed ones; each part the latest first.
  const archiveList =
    archived.length + done.length > 0 ? (
      <Stack gap="lg">
        {archived.length > 0 && (
          <List animate className="mini-list">
            {archived.map((j) => (
              <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} swipe={back(j.b)} variant="row" dated />
            ))}
          </List>
        )}
        {done.length > 0 && (
          <List animate className="mini-list">
            {done.map((j) => (
              <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} variant="row" dated />
            ))}
          </List>
        )}
      </Stack>
    ) : closed ? (
      <EmptyState icon={IconArchive} title={t('board.archiveEmpty')} />
    ) : (
      <PageSkeleton />
    );

  if (jobs.length === 0 && archived.length === 0 && !archive && !debtsTab)
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
        {mobile && (
          <Group justify="center" mt="md">
            {owing > 0 && (
              <Button variant="subtle" color="red" leftSection={<IconUserDollar size={18} />} onClick={() => setFilter('debts')}>
                {t('board.tabDebts')} · {owing}
              </Button>
            )}
            <Button variant="subtle" leftSection={<IconArchive size={18} />} onClick={() => setFilter('archive')}>
              {t('board.archive')}
            </Button>
          </Group>
        )}
      </>
    );

  const shown = phaseFilter ? jobs.filter((j) => j.phase === phaseFilter) : jobs;
  // The strip in the order of «Вид»: «Все», the steps that have cars and are not left out, «Долги», «Архив».
  const tabItem = (k: BoardTab): TabItem | null => {
    if (k === 'all') return { value: 'all', label: t('board.all'), count: jobs.length };
    if (k === 'debts') return { value: 'debts', label: t('board.tabDebts'), count: owing || undefined, color: PHASE_META.debt.color, icon: IconUserDollar };
    if (k === 'archive') return { value: 'archive', label: t('board.archive'), count: archived.length || undefined };
    return isStep(k) && stepShown(k) ? { value: k, label: t(`job.phase.${k}`), count: count(k), color: PHASE_META[k].color, icon: PHASE_META[k].icon } : null;
  };
  const tabs = view.order.map(tabItem).filter((x): x is TabItem => !!x);
  return (
    <>
      <span ref={glowRef} hidden />
      {header}
      <InsecureWarning />
      {mobile ? (
        <>
          {/* A long press on a tab opens «Вид» — where the tabs are dragged into another order. */}
          <ScrollTabs value={archive ? 'archive' : debtsTab ? 'debts' : phaseFilter ?? 'all'} onChange={(v) => setFilter(v as Filter)} onHold={() => setViewOpen(true)} items={tabs} />
          {debtsTab ? (
            debtList
          ) : archive ? (
            archiveList
          ) : shown.length ? (
            <List animate className={compact ? 'mini-list' : 'board-cards'}>
              {shown.map((j) => (
                <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} swipe={toArchive(j.b)} variant={compact ? 'row' : 'card'} />
              ))}
            </List>
          ) : (
            <EmptyState icon={IconLayoutKanban} title={t('board.emptyTitle')} />
          )}
        </>
      ) : debtsTab ? (
        <Box maw={920}>{debtList}</Box>
      ) : archive ? (
        // On a PC the archive is a table (v0.41): every job one line, sorted by a click on a head.
        archived.length + done.length > 0 ? (
          <DeskArchive jobs={[...archived, ...done]} byHand={new Set(archived.map((j) => j.b.order.id))} covers={covers} onBack={(b) => back(b).onCommit()} />
        ) : (
          <Box maw={720}>{archiveList}</Box>
        )
      ) : (
        <Kanban jobs={jobs} covers={covers} swipe={toArchive} tick={tick} order={view.order} compact={compact} />
      )}
    </>
  );
}
