import { ActionIcon, Box, Button, Group, Stack } from '@mantine/core';
import { IconAdjustmentsHorizontal, IconArchive, IconArrowBackUp, IconListCheck, IconX, IconCar, IconExternalLink, IconLayoutBoardSplit, IconLayoutGrid, IconLayoutKanban, IconPinnedFilled, IconPlus, IconSparkles, IconUserDollar } from '@tabler/icons-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { stepMainTab } from '../../ui/mainSwipe';
import { hintNavigation } from '../../ui/stack';
import { useTabSwipe } from '../../ui/tabSwipe';
import { arrange, CARD, clampWidth, pinnedFirst, placeNew, setDeskBoard, setPlace, useDeskBoard, type Place } from '../../ui/deskBoard';
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
import { EmptyState, List, MediaImage, Money, PageHeader, PageSkeleton, PlateText, ScrollTabs, StickyBar, undoToast, type TabItem } from '../../ui/components';
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
/** v0.70: the tabs the manager puts jobs in — «В работе», «Ожидание», «Заявки» (domain/boardStatus.ts). */
type StatusTab = 'inwork' | 'waiting' | 'requests';
type Filter = 'all' | 'archive' | 'debts' | StatusTab | Phase;
const STATUS_OF: Record<StatusTab, BoardStatus> = { inwork: 'work', waiting: 'wait', requests: 'request' };
const TAB_OF: Record<BoardStatus, StatusTab> = { work: 'inwork', wait: 'waiting', request: 'requests' };
const isStatusTab = (k: string): k is StatusTab => k in STATUS_OF;

type Job = { b: OrderBundle; phase: Phase };
const isStep = (k: string): k is Phase => (STEPS as string[]).includes(k);

/** The colours of a step for its strip button and its section: `--c` bright, `--c-ink` its words on a tint. */
const stepVars = (p: Phase) => ({ '--c': `var(--mantine-color-${PHASE_META[p].color}-6)`, '--c-ink': `var(--mantine-color-${PHASE_META[p].color}-light-color)` }) as CSSProperties;

/**
 * PC board (v0.42): every step that has cars is a section — its name, how many cars, what they come to — and its cars
 * a grid of cards the size of the phone's. A card never grows with the window: one busy step no longer stretches its
 * cars over the whole screen (v0.41's lanes did — one car to a screen). On top, a strip of every step in the board's
 * order («Вид»), the empty ones too, greyed: the way through the garage at a glance; a click shows that step alone.
 */
function DeskBoard({
  jobs,
  covers,
  swipe,
  tick,
  order,
  compact,
  step,
  onStep,
}: {
  jobs: Job[];
  covers?: Map<string, string>;
  swipe: (b: OrderBundle) => RowSwipe;
  tick: number;
  order: BoardTab[];
  compact: boolean;
  step?: Phase;
  onStep: (f: Filter) => void;
}) {
  const { t } = useTranslation();
  const desk = useDeskBoard();
  const pinnedSet = new Set(desk.pinned);
  const importantSet = new Set(desk.important);
  const lanes = (order.filter((k) => isStep(k)) as Phase[]).map((p) => ({ p, list: jobs.filter((j) => j.phase === p) }));
  // v0.67: pinned cards in a section of their own on top (their step's section does not repeat them).
  const pinnedJobs = jobs.filter((j) => pinnedSet.has(j.b.order.id) && (!step || j.phase === step));
  const shown = lanes.map((l) => ({ ...l, list: l.list.filter((j) => !pinnedSet.has(j.b.order.id)) })).filter((l) => l.list.length && (!step || l.p === step));
  const canvas = desk.mode === 'canvas';
  const card = (j: Job) => (
    <JobRow
      key={j.b.order.id}
      b={j.b}
      phase={j.phase}
      cover={covers?.get(j.b.vehicle.id)}
      tick={tick}
      swipe={swipe(j.b)}
      variant={compact ? 'row' : 'card'}
      important={importantSet.has(j.b.order.id)}
      pinned={pinnedSet.has(j.b.order.id)}
    />
  );
  return (
    <>
      <div className="desk-steps" role="toolbar" aria-label={t('board.title')}>
        <button type="button" className="desk-step" data-active={!step || undefined} onClick={() => onStep('all')}>
          <span>{t('board.all')}</span>
          <span className="desk-step-n">{jobs.length}</span>
        </button>
        {lanes.map(({ p, list }) => {
          const m = PHASE_META[p];
          return (
            <button
              key={p}
              type="button"
              className="desk-step"
              style={stepVars(p)}
              data-active={step === p || undefined}
              data-empty={!list.length || undefined}
              disabled={!list.length}
              aria-pressed={step === p}
              onClick={() => onStep(step === p ? 'all' : p)}
            >
              <m.icon size={15} stroke={2.2} aria-hidden />
              <span>{t(`job.phase.${p}`)}</span>
              <span className="desk-step-n">{list.length}</span>
            </button>
          );
        })}
        {/* v0.67: the board by step, or a canvas laid out by hand. */}
        <span className="desk-modes" role="group" aria-label={t('board.view')}>
          <button type="button" className="desk-mode" data-active={!canvas || undefined} aria-pressed={!canvas} onClick={() => setDeskBoard({ mode: 'steps' })}>
            <IconLayoutBoardSplit size={15} stroke={2.2} aria-hidden />
            {t('deskBoard.steps')}
          </button>
          <button type="button" className="desk-mode" data-active={canvas || undefined} aria-pressed={canvas} data-desk-canvas onClick={() => setDeskBoard({ mode: 'canvas' })}>
            <IconLayoutGrid size={15} stroke={2.2} aria-hidden />
            {t('deskBoard.canvas')}
          </button>
        </span>
      </div>
      {canvas ? (
        <DeskCanvas jobs={step ? jobs.filter((j) => j.phase === step) : jobs} all={jobs} covers={covers} swipe={swipe} tick={tick} />
      ) : (
        <>
      {!shown.length && !pinnedJobs.length && <EmptyState icon={IconLayoutKanban} title={t('board.emptyTitle')} />}
      {pinnedJobs.length > 0 && (
        <section className="desk-lane desk-lane-pinned" data-lane="pinned" aria-label={t('deskBoard.pinned')}>
          <header className="desk-lane-head">
            <IconPinnedFilled size={16} className="desk-lane-pin" aria-hidden />
            <span className="desk-lane-name">{t('deskBoard.pinned')}</span>
            <span className="desk-lane-count">{pinnedJobs.length}</span>
          </header>
          <List animate className={compact ? 'desk-grid mini-list' : 'desk-grid board-cards'}>
            {pinnedJobs.map(card)}
          </List>
        </section>
      )}
      {shown.map(({ p, list }) => {
        const sum = list.reduce((s, j) => s + jobAmount(j.b), 0);
        return (
          <section key={p} className="desk-lane" data-lane={p} style={stepVars(p)} aria-label={t(`job.phase.${p}`)}>
            <header className="desk-lane-head">
              <span className="stage-dot" style={{ background: 'var(--c)' }} />
              <span className="desk-lane-name">{t(`job.phase.${p}`)}</span>
              <span className="desk-lane-count">{list.length}</span>
              {sum > 0 && (
                <span className="desk-lane-sum">
                  <Money fils={sum} />
                </span>
              )}
            </header>
            <List animate className={compact ? 'desk-grid mini-list' : 'desk-grid board-cards'}>
              {list.map(card)}
            </List>
          </section>
        );
      })}
        </>
      )}
    </>
  );
}

/**
 * The board as a canvas (v0.67, the owner: «двигать, перемещать карточки, увеличивать, размещать где угодно, выделить
 * важных, увеличить важные, закреплять»): every card where the manager put it — dragged anywhere, its corner drawn out
 * for a larger card (its height half its width, as every card's), important ones lit and larger, pinned ones fixed where
 * they are. A new car finds a free place by itself; «Расставить» lays them all out again (pinned and important first),
 * with «Отменить». A click still opens the job; a drag does not.
 */
function DeskCanvas({ jobs, all, covers, swipe, tick }: { jobs: Job[]; all: Job[]; covers?: Map<string, string>; swipe: (b: OrderBundle) => RowSwipe; tick: number }) {
  const { t } = useTranslation();
  const desk = useDeskBoard();
  const box = useRef<HTMLDivElement>(null);
  // Measured before anything is placed (a guess would lay the first cards out past the canvas's edge).
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // The room for cards: the canvas less its margin on each side (12 px).
    setWidth(Math.floor(el.clientWidth) - 24);
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width) - 24));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pinned = new Set(desk.pinned);
  const important = new Set(desk.important);
  const widthOf = (id: string) => (important.has(id) ? CARD.l : CARD.s);
  // Pinned first, then important, then the board's own order (the freshest first).
  const ordered = [...all].sort((x, y) => Number(pinned.has(y.b.order.id)) - Number(pinned.has(x.b.order.id)) || Number(important.has(y.b.order.id)) - Number(important.has(x.b.order.id)));
  const ids = ordered.map((j) => j.b.order.id);
  const missing = ids.filter((id) => !desk.places[id]);
  // A car new on the board: a free place found and kept — the others do not move, and none is let go here (a board read
  // a moment short of its cars must not lose their places; «Расставить» starts afresh).
  useEffect(() => {
    if (!width || !missing.length) return;
    const had = Object.keys(desk.places).length > 0;
    // The first time on the canvas: all laid out in rows; later a new car takes a free place, the others stay.
    setDeskBoard({ places: had ? { ...desk.places, ...placeNew(missing, desk.places, width, widthOf) } : arrange(ids, width, widthOf) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(','), width]);

  // A card under the mouse: moved (or its corner drawn out) — written to the store once let go, on the canvas's step.
  const [live, setLive] = useState<{ id: string; p: Place } | null>(null);
  const dragged = useRef(false);
  const begin = (id: string, kind: 'move' | 'size') => (e: ReactPointerEvent) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    if ((e.target as Element).closest('.job-card-doc, .desk-card-tools, .swipe-action') && kind === 'move') return;
    const from = desk.places[id];
    if (!from || (pinned.has(id) && kind === 'move')) return;
    if (kind === 'size') e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let now: Place = from;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      // Within the canvas's width (it grows downwards only: the page never scrolls sideways).
      now = kind === 'move' ? { ...from, x: Math.min(Math.max(0, width - from.w), Math.max(0, from.x + dx)), y: Math.max(0, from.y + dy) } : { ...from, w: Math.min(clampWidth(from.w + dx), Math.max(CARD.min, width - from.x)) };
      setLive({ id, p: now });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (moved) {
        dragged.current = true;
        setPlace(id, now);
      }
      setLive(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  const tidy = () => {
    const before = desk.places;
    setDeskBoard({ places: arrange(ids, width, widthOf) });
    undoToast(t('deskBoard.arranged'), t('common.undo'), () => setDeskBoard({ places: before }));
  };
  const placed = jobs.map((j) => ({ j, p: live?.id === j.b.order.id ? live.p : desk.places[j.b.order.id] })).filter((x): x is { j: Job; p: Place } => !!x.p);
  // Where cards cover each other: the one put down last on top (pinned above them all, the one under the mouse above all).
  const stack = placed.map(({ j, p }) => ({ id: j.b.order.id, z: p.z ?? 0 })).sort((a, b) => a.z - b.z).map((x) => x.id);
  const layer = (id: string) => (live?.id === id ? stack.length + 20 : pinned.has(id) ? stack.length + 10 : stack.indexOf(id) + 1);
  const height = Math.max(420, ...placed.map(({ p }) => p.y + p.w / 2 + 60));
  return (
    <>
      <div className="desk-canvas-bar">
        <Button variant="default" size="sm" leftSection={<IconSparkles size={16} />} onClick={tidy} data-desk-arrange>
          {t('deskBoard.arrange')}
        </Button>
      </div>
      <div className="desk-canvas" ref={box} style={{ height }} data-desk-canvas-area>
        {placed.map(({ j, p }) => {
          const id = j.b.order.id;
          return (
            <div
              key={id}
              className="desk-canvas-card"
              data-dragging={live?.id === id || undefined}
              data-pinned={pinned.has(id) || undefined}
              data-important={important.has(id) || undefined}
              data-card={id}
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: p.w, zIndex: layer(id) }}
              onPointerDown={begin(id, 'move')}
              onClickCapture={(e) => {
                // A card let go after a drag: not opened.
                if (!dragged.current) return;
                dragged.current = false;
                e.preventDefault();
                e.stopPropagation();
              }}
              onDragStart={(e) => e.preventDefault()}
            >
              <JobRow b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} swipe={swipe(j.b)} variant="card" important={important.has(id)} pinned={pinned.has(id)} canvas />
              {!pinned.has(id) && <span className="desk-resize" title={t('deskBoard.resize')} aria-hidden onPointerDown={begin(id, 'size')} />}
            </div>
          );
        })}
      </div>
    </>
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
  const sw = useTabSwipe(tabOrder, tabNow, (v) => setFilter(v as Filter), (dir) => void stepMainTab(navigate, hintNavigation, '/', dir));
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
        // Picking jobs for a tab (v0.70): how many in place of the date.
        eyebrow={picking ? (picked.size ? t('board.picked', { n: picked.size }) : t('board.pickHint')) : dateLabel}
        title={t('board.title')}
        right={
          mobile ? (
            <Group gap="xs" wrap="nowrap">
              {/* Several jobs into a tab at once (v0.70). */}
              <ActionIcon variant={picking ? 'filled' : 'default'} size={40} radius="xl" aria-label={t(picking ? 'common.cancel' : 'board.pick')} onClick={() => (picking ? endPick() : setPicking(true))} data-board-pick>
                {picking ? <IconX size={22} stroke={2} /> : <IconListCheck size={22} stroke={2} />}
              </ActionIcon>
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

  const shown = pinnedFirst(statusFilter ? jobs.filter((j) => statusOf(j) === statusFilter) : phaseFilter ? jobs.filter((j) => j.phase === phaseFilter) : jobs, (j) => j.b.order.id, mobile ? pins : []);
  const pinnedIds = new Set(mobile ? pins : []);
  // The strip in the order of «Вид»: «Все», the steps that have cars and are not left out, «Долги», «Архив».
  const tabItem = (k: BoardTab): TabItem | null => {
    if (k === 'all') return { value: 'all', label: t('board.all'), count: jobs.length };
    if (k === 'debts') return hidden.has('debts') ? null : { value: 'debts', label: t('board.tabDebts'), count: owing || undefined, color: PHASE_META.debt.color, icon: IconUserDollar };
    if (isStatusTab(k)) {
      if (hidden.has(k)) return null;
      const s = STATUS_OF[k];
      const m = PHASE_META[STATUS_PHASE[s]];
      return { value: k, label: t(`board.status.${s}`), count: statusCount(s) || undefined, color: m.color, icon: m.icon };
    }
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
          <ScrollTabs value={tabNow} onChange={(v) => setFilter(v as Filter)} onHold={() => setViewOpen(true)} items={tabs} />
          <div key={tabNow} ref={sw.panel} className="tab-panel">
            {debtsTab ? (
              debtList
            ) : archive ? (
              archiveList
            ) : shown.length ? (
              <List animate className={compact ? 'mini-list' : 'board-cards'}>
                {shown.map((j) => (
                  <JobRow key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} swipe={picking ? undefined : toArchive(j.b)} variant={compact ? 'row' : 'card'} picking={picking} picked={picked.has(j.b.order.id)} onPick={pick} status={statusOf(j)} pinned={pinnedIds.has(j.b.order.id) || undefined} />
                ))}
              </List>
            ) : (
              <EmptyState icon={IconLayoutKanban} title={t('board.emptyTitle')} />
            )}
          </div>
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
        <DeskBoard jobs={jobs} covers={covers} swipe={toArchive} tick={tick} order={view.order} compact={compact} step={deskStep} onStep={setFilter} />
      )}
    </>
  );
}
