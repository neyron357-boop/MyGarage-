import { ActionIcon, Box, Button, Group, Modal, Stack } from '@mantine/core';
import { IconAdjustmentsHorizontal, IconArchive, IconArrowBackUp, IconCheck, IconFilter, IconFilterFilled, IconLayoutGrid, IconX, IconCar, IconExternalLink, IconLayoutKanban, IconPlus, IconUserDollar } from '@tabler/icons-react';
import { boardMatches } from '../../domain/boardSearch';
import { jobOpenedAt } from '../../ui/recentJobs';
import { SearchResults } from '../search/SearchPage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { stepMainTab } from '../../ui/mainSwipe';
import { hintNavigation } from '../../ui/stack';
import { useTabSwipe } from '../../ui/tabSwipe';
import { pinnedFirst, useDeskBoard } from '../../ui/deskBoard';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { dayLong, dayShort } from '../../domain/dates';
import { lastChange, leftBoardAt, type Phase } from '../../domain/flow';
import { BOARD_STATUSES, boardStatusOf, STATUS_PHASE, type BoardStatus } from '../../domain/boardStatus';
import { haptic } from '../../ui/haptics';
import { notifications } from '@mantine/notifications';
import { formatPhone } from '../../domain/phone';
import { coverIndex } from '../../services/cover';
import { loadDebtors } from '../../services/debts';
import { archiveJob, phaseOf, setBoardStatus } from '../../services/flow';
import { bundleAmountDue, loadOrderBundle, loadRowBundles, prefetchBundle, type OrderBundle } from '../../services/orders';
import { useBoardView, type BoardTab } from '../../ui/boardView';
import { EmptyState, List, ListRow, MediaImage, Money, PageHeader, PageSkeleton, PlateText, SearchField, StickyBar, undoToast, type TabItem } from '../../ui/components';
import { DataTable, type Column } from '../../ui/DataTable';
import { DeskMenu, type DeskMenuItem } from '../../ui/desk';
import { openTab } from '../../ui/deskTabs';
import { useAction, useLang, usePhone, useScreenLiveQuery } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { checkForUpdate } from '../../ui/pwa';
import { usePullRefresh } from '../../ui/pullRefresh';
import { PHASE_META, PhaseTag, usePhaseGlow } from '../job/phase';
import { DebtorList } from '../money/Debts';
import { InsecureWarning } from './BoardNotices';
import { BoardViewSheet } from './BoardViewSheet';
import { DeskBoard } from './DeskBoard';
import { BOARD_STEPS as STEPS, isBoardStep as isStep, jobAmount, jobTotal } from './jobFacts';
import { JobRow, type RowSwipe } from './JobRow';
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

/** v0.70: the tabs the manager puts jobs in — «В работе», «Ожидание», «Заявки» (domain/boardStatus.ts). */
type StatusTab = 'inwork' | 'waiting' | 'requests';
type Filter = 'all' | 'archive' | 'debts' | StatusTab | Phase;
const STATUS_OF: Record<StatusTab, BoardStatus> = { inwork: 'work', waiting: 'wait', requests: 'request' };
const TAB_OF: Record<BoardStatus, StatusTab> = { work: 'inwork', wait: 'waiting', request: 'requests' };
const isStatusTab = (k: string): k is StatusTab => k in STATUS_OF;

type Job = { b: OrderBundle; phase: Phase };

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
    { key: 'amount', label: t('desk.col.amount'), cell: (j) => (amount(j) > 0 ? <Money fils={amount(j)} fw={600} /> : null), sort: amount, desc: true, align: 'right', nowrap: true, width: 150 },
    {
      key: 'back',
      label: '',
      width: 64,
      align: 'right',
      cell: (j) =>
        byHand.has(j.b.order.id) ? (
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
        ) : null,
    },
  ];
  const items: DeskMenuItem[] = menu
    ? [
        { key: 'open', label: t('common.open'), icon: IconExternalLink, onClick: () => open(menu.j) },
        // The PC's own tabs (v0.89).
        { key: 'tab', label: t('desk.openInTab'), icon: IconExternalLink, onClick: () => void openTab(`/orders/${menu.j.b.order.id}`) },
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
 * The board's filters on a phone (v0.81, the user's brief: ««В работе», «В ожидании», «Заявки» и «Архив» доступны через
 * «Фильтры»… для обычного просмотра выбор статуса не требуется»): a sheet of them — each with its cars' count, the one
 * shown ticked — and «Вид» at its foot.
 */
function FilterSheet({ opened, onClose, tabs, value, onPick, onView }: { opened: boolean; onClose: () => void; tabs: TabItem[]; value: string; onPick: (v: string) => void; onView: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={t('board.filters')} classNames={{ content: 'sheet-grouped' }}>
      <List>
        {tabs.map((x) => {
          const I = x.icon ?? IconLayoutGrid;
          return (
            <ListRow
              key={x.value}
              left={
                <span className="row-icon board-filter-icon" style={{ '--c': x.color ? `var(--mantine-color-${x.color}-6)` : 'var(--mantine-color-gray-6)' } as React.CSSProperties}>
                  <I size={17} stroke={2.1} aria-hidden />
                </span>
              }
              title={x.label}
              right={
                <Group gap={10} wrap="nowrap">
                  {x.count !== undefined && <span className="filter-count tnum">{x.count}</span>}
                  {x.value === value ? <IconCheck size={20} stroke={2.4} color="var(--mantine-color-cobalt-6)" aria-label={t('board.filterOn')} /> : <span style={{ width: 20 }} />}
                </Group>
              }
              onClick={() => {
                onPick(x.value);
                onClose();
              }}
            />
          );
        })}
      </List>
      <Button mt="md" variant="subtle" fullWidth leftSection={<IconAdjustmentsHorizontal size={18} />} onClick={onView}>
        {t('board.view')}
      </Button>
    </Modal>
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
  // The board's own search (v0.81): a plate, a name, a phone — the board's cars first, the rest of the base under them.
  const [q, setQ] = useState('');
  const finding = q.trim().length > 0;
  const [filtersOpen, setFiltersOpen] = useState(false);
  // How the board looks on this device: large cards or rows, the tabs' order and the steps left out («Вид»).
  const view = useBoardView();
  // Cars pinned to the top on this phone (v0.73): first in every tab, the one pinned last on top.
  const pins = useDeskBoard().pinned;
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
  // The freshest first: the job something last happened on — or opened last on this device (v0.81) — is on top.
  const recency = (j: Job) => {
    const changed = lastChange(j.b);
    const seen = jobOpenedAt(j.b.order.id);
    return seen && seen > changed ? seen : changed;
  };
  const fresh = (x: Job, y: Job) => recency(y).localeCompare(recency(x));
  const all: Job[] = (data?.bundles ?? []).map((b) => ({ b, phase: phaseOf(b) })).filter((j) => STEPS.includes(j.phase));
  const jobs = all.filter((j) => !j.b.order.archivedAt).sort(fresh);
  // The archive: the jobs taken off by hand, the latest taken off first.
  const archived = all.filter((j) => !!j.b.order.archivedAt).sort((x, y) => leftBoardAt(y.b.order).localeCompare(leftBoardAt(x.b.order)));
  const count = (p: Phase) => jobs.filter((j) => j.phase === p).length;
  // A step is a tab while it has cars and is not left out («Вид»); the one picked counts only while it is a tab.
  const hidden = new Set<string>(view.hidden);
  const stepShown = (p: Phase) => count(p) > 0 && !hidden.has(p);
  const phaseFilter = isStep(filter) && stepShown(filter) ? filter : undefined;
  // v0.70: a tab of the manager's (shown unless left out in «Вид») — its jobs, wherever their step is.
  const statusFilter = isStatusTab(filter) && !hidden.has(filter) ? STATUS_OF[filter] : undefined;
  const statusOf = (j: Job) => boardStatusOf(j.b.order, j.phase);
  const statusCount = (s: BoardStatus) => jobs.filter((j) => statusOf(j) === s).length;
  // Picking jobs to put in a tab (v0.70): «Выбрать» in the head, then the tab at the foot.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const pick = useCallback((id: string) => {
    haptic('selection');
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  // «Выбрать несколько» from a card's menu (v0.99, audit Д1): the head's checklist button looked like «Сегодня» and put the
  // board into picking by surprise.
  const startPick = useCallback(
    (id: string) => {
      setPicking(true);
      pick(id);
    },
    [pick],
  );
  const endPick = () => {
    setPicking(false);
    setPicked(new Set());
  };
  const putIn = (s: BoardStatus) =>
    void run(async () => {
      const n = await setBoardStatus([...picked], s);
      haptic('success');
      notifications.show({ color: 'green', message: t('board.movedTo', { n, tab: t(`board.statusOne.${s}`) }) });
      endPick();
    });
  // On a PC every step is in its strip (v0.42): one picked counts while it has cars, whatever «Вид» leaves out on a phone.
  const deskStep = !mobile && isStep(filter) && count(filter) > 0 ? filter : undefined;
  // Its last car gone, or the step left out: the board is back on «Все» (and stays there when a car comes).
  const lost = !!data && ((isStep(filter) && !(mobile ? phaseFilter : deskStep)) || (isStatusTab(filter) && (!mobile || hidden.has(filter))));
  useEffect(() => {
    if (lost) setFilter('all');
  }, [lost]);
  // A step picked: the screen glows in its colours, as a job on that step does (debts — in red).
  const glowRef = useRef<HTMLSpanElement>(null);
  usePhaseGlow(glowRef, debtsTab ? 'debt' : statusFilter ? STATUS_PHASE[statusFilter] : phaseFilter);
  // The tabs are pages (v0.68, the user: «свайпы должны быть между этими вкладками»): a sideways swipe — the next tab, in
  // the strip's order; past the first or the last — the tab bar's place beside the board (as Money's pages). A card's
  // own swipes stay at its edges.
  const tabOrder = view.order.filter((k) => k === 'all' || k === 'archive' || ((k === 'debts' || isStatusTab(k)) && !hidden.has(k)) || (isStep(k) && stepShown(k)));
  const tabNow = archive ? 'archive' : debtsTab ? 'debts' : statusFilter ? TAB_OF[statusFilter] : (phaseFilter ?? 'all');
  // v0.81: the filters are a sheet, not a strip — a sideways swipe on the board is the tab bar's (Money beside it).
  const sw = useTabSwipe(mobile ? [tabNow] : tabOrder, tabNow, (v) => setFilter(v as Filter), (dir) => void stepMainTab(navigate, hintNavigation, '/', dir));
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
  // The board's lists in the order of «Вид»: «Все», the manager's tabs, the steps that have cars and are not left out,
  // «Долги», «Архив» — a PC's bar, a phone's «Фильтры» (v0.81: no strip on a phone).
  const tabItem = (k: BoardTab): TabItem | null => {
    if (k === 'all') return { value: 'all', label: t('board.all'), count: jobs.length };
    if (k === 'debts') return hidden.has('debts') ? null : { value: 'debts', label: t('board.tabDebts'), count: owing || undefined, color: PHASE_META.debt.color, icon: IconUserDollar };
    if (isStatusTab(k)) {
      if (hidden.has(k)) return null;
      const s = STATUS_OF[k];
      const m = PHASE_META[STATUS_PHASE[s]];
      return { value: k, label: t(`board.status.${s}`), count: statusCount(s) || undefined, color: m.color, icon: m.icon };
    }
    if (k === 'archive') return { value: 'archive', label: t('board.archive'), count: archived.length || undefined, icon: IconArchive };
    return isStep(k) && stepShown(k) ? { value: k, label: t(`job.phase.${k}`), count: count(k), color: PHASE_META[k].color, icon: PHASE_META[k].icon } : null;
  };
  const filterTabs = () => view.order.map(tabItem).filter((x): x is TabItem => !!x);
  // «Вид»: a round glass button in the head (phone), after «Долги» and «Архив» (PC).
  const viewButton = (
    <ActionIcon variant="default" size={40} radius="xl" aria-label={t('board.view')} onClick={() => setViewOpen(true)}>
      <IconAdjustmentsHorizontal size={22} stroke={2} />
    </ActionIcon>
  );
  const header = (
    <>
      {pull}
      <PageHeader
        // Picking jobs for a tab (v0.70): how many in place of the date.
        eyebrow={picking ? (picked.size ? t('board.picked', { n: picked.size }) : t('board.pickHint')) : dateLabel}
        title={t('board.title')}
        right={
          mobile ? (
            <Group gap="xs" wrap="nowrap">
              {/* Several jobs into a tab at once (v0.70). */}
              {picking && (
                <ActionIcon variant="filled" size={40} radius="xl" aria-label={t('common.cancel')} onClick={endPick} data-board-pick>
                  <IconX size={22} stroke={2} />
                </ActionIcon>
              )}
              <TodayBell bundles={bundles} />
              {/* «Фильтры» (v0.81): «Все» unless one is picked — then it is lit. */}
              <ActionIcon variant={filter !== 'all' ? 'filled' : 'default'} size={40} radius="xl" aria-label={t('board.filters')} onClick={() => setFiltersOpen(true)} data-board-filters>
                {filter !== 'all' ? <IconFilterFilled size={20} /> : <IconFilter size={22} stroke={2} />}
              </ActionIcon>
            </Group>
          ) : (
            // (v0.75: «Долги» and «Архив» are tabs of the board's own bar on a PC.)
            <Group gap="xs" wrap="nowrap">
              <TodayBell bundles={bundles} />
              {viewButton}
            </Group>
          )
        }
      />
      <LazySheet opened={viewOpen}>{(o) => <BoardViewSheet opened={o} onClose={() => setViewOpen(false)} />}</LazySheet>
      {mobile && (
        <LazySheet opened={filtersOpen}>
          {(o) => (
            <FilterSheet
              opened={o}
              onClose={() => setFiltersOpen(false)}
              tabs={filterTabs()}
              value={tabNow}
              onPick={(v) => {
                setFilter(v as Filter);
                haptic('selection');
              }}
              onView={() => {
                setFiltersOpen(false);
                setViewOpen(true);
              }}
            />
          )}
        </LazySheet>
      )}
    </>
  );
  // The search on top of the board (a phone): a plate, a name, a phone.
  const findBar = mobile ? (
    <Box mb="md" className="board-find">
      <SearchField value={q} onChange={setQ} placeholder={t('board.findPlaceholder')} />
    </Box>
  ) : null;

  const debtList = !debtors ? <PageSkeleton /> : debtors.length ? <DebtorList debtors={debtors} /> : <EmptyState icon={IconUserDollar} title={t('debt.none')} />;

  // The archive (v0.22): smaller rows with their date — on top the jobs taken off the board by hand (a swipe
  // puts one back), under them the closed ones; each part the latest first.
  const archiveList =
    archived.length + done.length > 0 ? (
      <Stack gap="lg">
        {archived.length > 0 && (
          <div>
          <div className="group-title">
            {t('board.byHand')} <span className="count">{archived.length}</span>
          </div>
          <List animate className="mini-list">
            {archived.map((j) => (
              <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} swipe={back(j.b)} variant="row" dated />
            ))}
          </List>
          </div>
        )}
        {done.length > 0 && (
          <div>
          {archived.length > 0 && <div className="group-title">{t('board.closedOnes')}</div>}
          <List animate className="mini-list">
            {done.map((j) => (
              <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} variant="row" dated />
            ))}
          </List>
          </div>
        )}
      </Stack>
    ) : closed ? (
      <EmptyState icon={IconArchive} title={t('board.archiveEmpty')} />
    ) : (
      <PageSkeleton />
    );

  if (jobs.length === 0 && archived.length === 0 && !archive && !debtsTab && !finding)
    return (
      <>
        {header}
        <InsecureWarning />
        {findBar}
        <Box mt="xl">
          <EmptyState
            icon={IconLayoutKanban}
            title={t('board.emptyTitle')}
            action={
              <Group justify="center">
                <Button leftSection={<IconPlus size={18} />} data-route={'/orders/new'} onClick={() => navigate('/orders/new')}>
                  {t('nav.newOrder')}
                </Button>
                <Button variant="default" data-route={'/settings?tab=data'} onClick={() => navigate('/settings?tab=data')}>
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

  const shown = pinnedFirst(statusFilter ? jobs.filter((j) => statusOf(j) === statusFilter) : phaseFilter ? jobs.filter((j) => j.phase === phaseFilter) : jobs, (j) => j.b.order.id, mobile ? pins : []);
  const pinnedIds = new Set(mobile ? pins : []);
  // Searching (v0.81): the board's cars that match — whatever the filter, those taken off the board too — freshest first.
  const found = finding
    ? [...jobs, ...archived].filter((j) =>
        boardMatches(
          { number: j.b.order.number, plate: j.b.vehicle.plate, make: j.b.vehicle.make, model: j.b.vehicle.model, name: j.b.customer.name, company: j.b.customer.companyName, phone: j.b.customer.phone, driver: j.b.order.driver?.name },
          q,
        ),
      )
    : [];
  const foundIds = new Set(found.map((j) => j.b.order.id));
  const picked1 = filter !== 'all' ? filterTabs().find((x) => x.value === tabNow) : undefined;
  return (
    <>
      <span ref={glowRef} hidden />
      {header}
      <InsecureWarning />
      {mobile ? (
        <>
          {findBar}
          {/* A filter picked (v0.81): said under the search, × — back to «Все». */}
          {picked1 && !finding && (
            <div className="board-filter-on rise-enter">
              <button type="button" className="chip" data-active="true" onClick={() => setFiltersOpen(true)}>
                {picked1.label}
                {picked1.count !== undefined && <span className="chip-count">{picked1.count}</span>}
              </button>
              <ActionIcon size={32} radius="xl" variant="subtle" color="gray" aria-label={t('board.filterOff')} onClick={() => (setFilter('all'), haptic('selection'))}>
                <IconX size={18} />
              </ActionIcon>
            </div>
          )}
          {finding ? (
            // The board's cars that match, then the rest of the base (closed jobs, cars, customers, suppliers).
            <div className="tab-panel board-found">
              {found.length > 0 && (
                <List animate className="mini-list">
                  {found.map((j) => (
                    <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} variant="row" status={statusOf(j)} />
                  ))}
                </List>
              )}
              <Box mt={found.length ? 'xl' : 0}>
                <SearchResults q={q} exclude={foundIds} quiet={found.length > 0} />
              </Box>
            </div>
          ) : (
          <div key={tabNow} ref={sw.panel} className="tab-panel">
            {debtsTab ? (
              debtList
            ) : archive ? (
              archiveList
            ) : shown.length ? (
              <List animate className={compact ? 'mini-list' : 'board-cards'}>
                {shown.map((j) => (
                  <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} swipe={picking ? undefined : toArchive(j.b)} variant={compact ? 'row' : 'card'} picking={picking} picked={picked.has(j.b.order.id)} onPick={pick} onStartPick={startPick} status={statusOf(j)} pinned={pinnedIds.has(j.b.order.id) || undefined} />
                ))}
              </List>
            ) : (
              <EmptyState icon={IconLayoutKanban} title={t('board.emptyTitle')} />
            )}
          </div>
          )}
          {picking && (
            // The jobs picked into a tab (v0.70): its three buttons at the foot (how many — in the head).
            <StickyBar>
              <Group gap={8} grow wrap="nowrap" data-board-put>
                  {BOARD_STATUSES.map((s) => {
                    const m = PHASE_META[STATUS_PHASE[s]];
                    return (
                      <Button key={s} color={m.color} disabled={!picked.size} leftSection={<m.icon size={18} />} onClick={() => putIn(s)} data-put={s}>
                        {t(`board.statusOne.${s}`)}
                      </Button>
                    );
                  })}
              </Group>
            </StickyBar>
          )}
        </>
      ) : (
        // A PC (v0.75, DeskBoard.tsx): one bar — the steps, «Долги», «Архив» — and under it the cars, or one of those lists.
        <DeskBoard jobs={jobs} covers={covers} archive={toArchive} tick={tick} order={view.order} tab={debtsTab ? 'debts' : archive ? 'archive' : (deskStep ?? 'all')} onTab={setFilter} owing={owing} archived={archived.length}>
          {debtsTab ? (
            <Box maw={920}>{debtList}</Box>
          ) : archive ? (
            // On a PC the archive is a table (v0.41): every job one line, sorted by a click on a head.
            archived.length + done.length > 0 ? (
              <DeskArchive jobs={[...archived, ...done]} byHand={new Set(archived.map((j) => j.b.order.id))} covers={covers} onBack={(b) => back(b).onCommit()} />
            ) : (
              <Box maw={720}>{archiveList}</Box>
            )
          ) : null}
        </DeskBoard>
      )}
    </>
  );
}
