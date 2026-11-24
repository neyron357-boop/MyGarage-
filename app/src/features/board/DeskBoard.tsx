import {
  IconArchive,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconArtboard,
  IconBrandWhatsapp,
  IconBuildingFactory2,
  IconCar,
  IconCash,
  IconClock,
  IconExternalLink,
  IconFileInvoice,
  IconFileTypePdf,
  IconLayoutGrid,
  IconLayoutKanban,
  IconLayoutList,
  IconPackage,
  IconPin,
  IconPinnedFilled,
  IconRepeat,
  IconSparkles,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconTruckDelivery,
  IconUserDollar,
  type Icon,
} from '@tabler/icons-react';
import type { TFunction } from 'i18next';
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { dueShort, shortDuration } from '../../domain/dates';
import type { Phase } from '../../domain/flow';
import { formatPhone } from '../../domain/phone';
import type { Lang, Order } from '../../domain/types';
import { invoicePdf, openPdf, quotationPdf } from '../../services/documents';
import { openWhatsApp } from '../../services/messages';
import { prefetchBundle, type OrderBundle } from '../../services/orders';
import type { BoardTab } from '../../ui/boardView';
import { EmptyState, List, MediaImage, Money, PlateText, undoToast } from '../../ui/components';
import { DataTable, type Column, type TableSection } from '../../ui/DataTable';
import { DeskMenu, type DeskMenuItem } from '../../ui/desk';
import { arrange, CARD, cardHeight, clampWidth, pinnedFirst, placeNew, resizeStep, setDeskBoard, setPlace, toggleImportant, togglePinned, useDeskBoard, type DeskMode, type Place } from '../../ui/deskBoard';
import { useAction, useLang } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { PHASE_META } from '../job/phase';
import { DeleteJobModal } from '../orders/DeleteJob';
import { isBoardStep, jobAmount, jobFacts, type JobFacts } from './jobFacts';
import type { RowSwipe } from './JobRow';

/*
 * The board of a PC (v0.75 — the owner on v0.67's: «пересобрать этот экран полностью. Совсем не нравится»): a program
 * at a desk, not a phone's gallery made large. What it was — photos as cards with words over them, important ones twice
 * as wide in a yellow glow, a strip of every step with its zeros, a section a step with one car to a row. What it is:
 *
 * - one quiet bar: the steps that have cars as a segmented strip (a dot of the step's colour, its count), what the cars
 *   shown come to, and how to see them — «Карточки», «Список», «Холст»;
 * - cards all one size in one grid — the photo clean on top, under it the facts in a fixed order: where it stands and
 *   since when (red once too long), the car and what it is worth, its plate and whose it is, what the job is about;
 * - colour only where it means something (the step's dot and word, late — red), a hairline round a card instead of a
 *   shadow, a shadow only under the mouse; an important car — a star and a warm line, first in its step; a pinned one —
 *   first on the board; nothing grows, nothing glows;
 * - «Список»: the same cars as a table by step — for many cars at once; «Холст»: each card where it was put (v0.67).
 *
 * The values (a 12-px card with a 1-px line, a 36-px segmented strip with a 3-px inset, 12 · 13 · 14-px words, tabular
 * figures, concentric corners, two-layer shadows) follow shadcn/ui, GitHub's Primer and Vercel's interface guidelines.
 */

export type DeskJob = { b: OrderBundle; phase: Phase };
type At = { x: number; y: number };
type OnMenu = (j: DeskJob, at: At) => void;

const stepVars = (p: Phase) => ({ '--c': `var(--mantine-color-${PHASE_META[p].color}-6)`, '--c-ink': `var(--mantine-color-${PHASE_META[p].color}-light-color)` }) as CSSProperties;
const toneVars = (tone: string) => ({ '--c': `var(--mantine-color-${tone}-6)`, '--c-ink': `var(--mantine-color-${tone}-light-color)` }) as CSSProperties;

/** Whose car it is: the company, the person, else the number to call. */
const whoOf = (b: OrderBundle) => {
  const c = b.customer;
  return (c.type === 'company' && c.companyName ? c.companyName : c.name) || (c.phone ? formatPhone(c.phone) : '');
};

const own =
  <E extends SyntheticEvent>(fn?: (e: E) => void) =>
  (e: E) => {
    e.stopPropagation();
    fn?.(e);
  };

/** What else to know at a glance, each a small symbol of its colour (its name under the mouse — `DeskTips`). */
type Mark = { key: string; icon: Icon; color: string; label: string };
function marksOf(f: JobFacts, phase: Phase, t: TFunction): Mark[] {
  return (
    [
      f.find > 0 && { key: 'find', icon: IconPackage, color: 'orange', label: t('flags.waitingParts') },
      f.coming && { key: 'coming', icon: IconTruckDelivery, color: 'cobalt', label: t('flags.partsComing') },
      f.outside && { key: 'outside', icon: IconBuildingFactory2, color: 'teal', label: t('flags.outside') },
      f.flags.debt && phase !== 'debt' && { key: 'debt', icon: IconCash, color: 'red', label: t('flags.debt') },
      f.flags.warranty && { key: 'warranty', icon: IconRepeat, color: 'grape', label: t('flags.warranty') },
    ] as (Mark | false)[]
  ).filter((x): x is Mark => !!x);
}

/** Where the job stands and since when: a dot of the step's colour, its word, the time — all red once too long. */
function StepLine({ f, phase, lang, t }: { f: JobFacts; phase: Phase; lang: Lang; t: TFunction }) {
  return (
    <span className="dstep tnum" data-late={f.late || undefined} style={toneVars(f.tone)}>
      <i className="dstep-dot" aria-hidden />
      <span className="dstep-name">{f.manual ? t(`board.statusOne.${f.manual}`) : t(`job.phase.${phase}`)}</span>
      <span className="dstep-time">{f.booked ? dueShort(f.booked, lang) : shortDuration(f.hours, lang)}</span>
    </span>
  );
}

/** Parts to find, parts coming, work outside…, and the time promised (orange, red once it has passed). */
function Marks({ f, phase, t }: { f: JobFacts; phase: Phase; t: TFunction }) {
  const marks = marksOf(f, phase, t);
  if (!marks.length && !f.due) return null;
  return (
    <span className="dmarks">
      {marks.map((x) => (
        <span key={x.key} className="dmark" data-tip={x.label} style={{ color: `var(--mantine-color-${x.color}-6)` }}>
          <x.icon size={14} stroke={2.2} aria-label={x.label} />
        </span>
      ))}
      {f.due && (
        <span className="ddue tnum" data-late={f.dueLate || undefined} data-tip={`${t('job.due')}: ${f.dueText}`}>
          <IconClock size={12} stroke={2.4} aria-hidden />
          {f.dueText}
        </span>
      )}
    </span>
  );
}

/** Important and pinned, a click away (shown when on, else under the mouse); the job's paper. */
function Tools({ b, f, important, pinned, className }: { b: OrderBundle; f: JobFacts; important: boolean; pinned: boolean; className: string }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const id = b.order.id;
  return (
    <span className={className} onPointerDown={own()} onClick={own()}>
      {className === 'dlist-tools' && f.doc && (
        <button type="button" className="dtool" data-tool="doc" aria-label={t(f.doc === 'invoice' ? 'job.more.invoice' : 'job.more.quote')} onClick={() => void run(async () => openPdf(f.inv ? await invoicePdf(f.inv.id) : await quotationPdf(id)))}>
          {f.doc === 'invoice' ? <IconFileInvoice size={15} stroke={2} aria-hidden /> : <IconFileTypePdf size={15} stroke={2} aria-hidden />}
        </button>
      )}
      <button type="button" className="dtool" data-tool="important" data-on={important || undefined} aria-pressed={important} aria-label={t(important ? 'deskBoard.notImportant' : 'deskBoard.important')} onClick={() => toggleImportant(id)}>
        {important ? <IconStarFilled size={14} aria-hidden /> : <IconStar size={14} stroke={2} aria-hidden />}
      </button>
      <button type="button" className="dtool" data-tool="pin" data-on={pinned || undefined} aria-pressed={pinned} aria-label={t(pinned ? 'deskBoard.unpin' : 'deskBoard.pin')} onClick={() => togglePinned(id)}>
        {pinned ? <IconPinnedFilled size={14} aria-hidden /> : <IconPin size={14} stroke={2} aria-hidden />}
      </button>
    </span>
  );
}

type CardProps = { b: OrderBundle; phase: Phase; cover?: string; /** Changes every few minutes: "how long" and "late" move on. */ tick: number; important: boolean; pinned: boolean; onMenu: OnMenu };

/**
 * A car on the PC's board: its photo, clean, and under it what the manager asks of a car — where it stands, what it is
 * worth, whose it is, what is being done. One button the size of the card (a click opens the job, a right click — its
 * menu); the star, the pin and its paper are their own.
 */
export const DeskCard = memo(DeskCardView, (a, z) => a.b === z.b && a.phase === z.phase && a.cover === z.cover && a.tick === z.tick && a.important === z.important && a.pinned === z.pinned);

function DeskCardView({ b, phase, cover, important, pinned, onMenu }: CardProps) {
  const navigate = useNavigate();
  const lang = useLang();
  const { t } = useTranslation();
  const { run } = useAction();
  const f = jobFacts(b, phase, lang);
  const id = b.order.id;
  const who = whoOf(b);
  const docName = f.doc ? t(f.doc === 'invoice' ? 'job.more.invoice' : 'job.more.quote') : '';
  return (
    <article
      className="dcard"
      data-card={id}
      data-step={phase}
      data-important={important || undefined}
      data-pinned={pinned || undefined}
      data-doc={f.doc ?? undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ b, phase }, { x: e.clientX, y: e.clientY });
      }}
    >
      <button type="button" className="dcard-open" onPointerDown={() => prefetchBundle(id)} onClick={() => navigate(`/orders/${id}`)}>
        <span className="dcard-pic">{cover ? <MediaImage id={cover} card h="100%" w="100%" radius="0" /> : <IconCar size={44} stroke={1.3} aria-hidden />}</span>
        <span className="dcard-body">
          <span className="dcard-row dcard-status">
            <StepLine f={f} phase={phase} lang={lang} t={t} />
            <Marks f={f} phase={phase} t={t} />
          </span>
          <span className="dcard-row dcard-title">
            <span className="dcard-name dt-clip">{f.name}</span>
            {f.amount > 0 && (
              <span className="dcard-amount">
                <Money fils={f.amount} fw={600} />
              </span>
            )}
          </span>
          <span className="dcard-row dcard-sub">
            <PlateText plate={b.vehicle.plate} size="xs" />
            <span className="dcard-who dt-clip">{who}</span>
          </span>
          <span className="dcard-what dt-clip">{f.what}</span>
        </span>
      </button>
      <Tools b={b} f={f} important={important} pinned={pinned} className="dcard-tools" />
      {f.doc && (
        <button type="button" className="dcard-doc" aria-label={docName} onPointerDown={own()} onClick={own(() => void run(async () => openPdf(f.inv ? await invoicePdf(f.inv.id) : await quotationPdf(id))))}>
          {f.doc === 'invoice' ? <IconFileInvoice size={16} stroke={1.9} aria-hidden /> : <IconFileTypePdf size={16} stroke={1.9} aria-hidden />}
        </button>
      )}
    </article>
  );
}

/** A right click on a car (a card, a line, a card of the canvas): its menu where the mouse is. */
function JobMenu({ target, onClose, archive, canvas }: { target: { j: DeskJob; at: At } | null; onClose: () => void; archive: (b: OrderBundle) => RowSwipe; canvas?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run } = useAction();
  const desk = useDeskBoard();
  const [remove, setRemove] = useState<Pick<Order, 'id' | 'number'> | null>(null);
  const j = target?.j;
  let items: DeskMenuItem[] = [];
  let label = '';
  if (j) {
    const b = j.b;
    const id = b.order.id;
    const f = jobFacts(b, j.phase, lang);
    const important = desk.important.includes(id);
    const pinned = desk.pinned.includes(id);
    const off = archive(b);
    label = `№${b.order.number} · ${f.car}`.trim();
    items = [
      { key: 'open', label: t('common.open'), icon: IconExternalLink, onClick: () => navigate(`/orders/${id}`) },
      ...(f.doc ? [{ key: 'doc', label: t(f.doc === 'invoice' ? 'job.more.invoice' : 'job.more.quote'), icon: f.doc === 'invoice' ? IconFileInvoice : IconFileTypePdf, onClick: () => void run(async () => openPdf(f.inv ? await invoicePdf(f.inv.id) : await quotationPdf(id))) }] : []),
      ...(f.wa ? [{ key: 'wa', label: 'WhatsApp', icon: IconBrandWhatsapp, onClick: () => openWhatsApp(f.wa) }] : []),
      { key: 'important', label: t(important ? 'deskBoard.notImportant' : 'deskBoard.important'), icon: important ? IconStarFilled : IconStar, divided: true, onClick: () => toggleImportant(id) },
      { key: 'pin', label: t(pinned ? 'deskBoard.unpin' : 'deskBoard.pin'), icon: pinned ? IconPinnedFilled : IconPin, onClick: () => togglePinned(id) },
      ...(canvas
        ? [
            { key: 'bigger', label: t('deskBoard.bigger'), icon: IconArrowsMaximize, onClick: () => resizeStep(id, 1) },
            { key: 'smaller', label: t('deskBoard.smaller'), icon: IconArrowsMinimize, onClick: () => resizeStep(id, -1) },
          ]
        : []),
      { key: 'archive', label: off.label, icon: IconArchive, divided: true, onClick: () => off.onCommit() },
      { key: 'delete', label: t('order.delete'), icon: IconTrash, color: 'red', onClick: () => setRemove({ id, number: b.order.number }) },
    ];
  }
  return (
    <>
      <DeskMenu at={target?.at ?? null} items={items} onClose={onClose} label={label} />
      <SheetFor value={remove}>{(order, o) => <DeleteJobModal order={order} opened={o} onClose={() => setRemove(null)} />}</SheetFor>
    </>
  );
}

/**
 * «Список»: the cars as a table by step — a line a car, the same facts in columns; for a busy week, when twenty cars
 * are to be read at once. Pinned ones in a group of their own on top.
 */
function DeskList({ jobs, steps, covers, onMenu }: { jobs: DeskJob[]; steps: Phase[]; covers?: Map<string, string>; onMenu: OnMenu }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const desk = useDeskBoard();
  const pinned = new Set(desk.pinned);
  const important = new Set(desk.important);
  const facts = new Map(jobs.map((j) => [j.b.order.id, jobFacts(j.b, j.phase, lang)]));
  const of = (j: DeskJob) => facts.get(j.b.order.id)!;
  const cols: Column<DeskJob>[] = [
    {
      key: 'car',
      label: t('desk.col.car'),
      cell: (j) => {
        const cover = covers?.get(j.b.vehicle.id);
        return (
          <span className="dt-who">
            <span className="dt-thumb">{cover ? <MediaImage id={cover} h={40} w={40} radius="0" /> : <IconCar size={22} stroke={1.6} aria-hidden />}</span>
            {/* The car, and under it what the job is about: the column takes the room the others leave. */}
            <span className="dlist-car">
              <span className="dt-main dt-clip">{of(j).name}</span>
              {of(j).what && <span className="dt-sub dt-clip">{of(j).what}</span>}
            </span>
          </span>
        );
      },
    },
    { key: 'number', label: t('desk.col.number'), cell: (j) => j.b.order.number, muted: true, nowrap: true, width: 72 },
    { key: 'plate', label: t('desk.col.plate'), cell: (j) => <PlateText plate={j.b.vehicle.plate} size="xs" />, width: 128 },
    { key: 'customer', label: t('desk.col.customer'), cell: (j) => <span className="dt-clip">{whoOf(j.b)}</span>, width: '17%' },
    { key: 'step', label: t('desk.col.step'), cell: (j) => <StepLine f={of(j)} phase={j.phase} lang={lang} t={t} />, nowrap: true, width: 156 },
    { key: 'marks', label: '', cell: (j) => <Marks f={of(j)} phase={j.phase} t={t} />, nowrap: true, width: 84 },
    { key: 'amount', label: t('desk.col.amount'), cell: (j) => (of(j).amount > 0 ? <Money fils={of(j).amount} fw={600} /> : null), align: 'right', nowrap: true, width: 132 },
    { key: 'tools', label: '', cell: (j) => <Tools b={j.b} f={of(j)} important={important.has(j.b.order.id)} pinned={pinned.has(j.b.order.id)} className="dlist-tools" />, align: 'right', width: 112 },
  ];
  const head = (key: string, name: string, list: DeskJob[], vars?: CSSProperties, pin?: boolean) => {
    const sum = list.reduce((s, j) => s + of(j).amount, 0);
    return (
      <span className="dlist-head" style={vars} data-group={key}>
        {pin ? <IconPinnedFilled size={14} className="dlist-pin" aria-hidden /> : <i className="dstep-dot" aria-hidden />}
        <span>{name}</span>
        <span className="dboard-n">{list.length}</span>
        {sum > 0 && (
          <span className="dlist-sum">
            <Money fils={sum} />
          </span>
        )}
      </span>
    );
  };
  const top = pinnedFirst(jobs, (j) => j.b.order.id, desk.pinned).filter((j) => pinned.has(j.b.order.id));
  const sections: TableSection<DeskJob>[] = [
    ...(top.length ? [{ key: 'pinned', head: head('pinned', t('deskBoard.pinned'), top, undefined, true), rows: top }] : []),
    ...steps
      .map((p) => ({ p, rows: jobs.filter((j) => j.phase === p && !pinned.has(j.b.order.id)) }))
      .filter((s) => s.rows.length)
      .map((s) => ({ key: s.p, head: head(s.p, t(`job.phase.${s.p}`), s.rows, stepVars(s.p)), rows: s.rows })),
  ];
  return (
    <div className="dlist">
      <DataTable
        sections={sections}
        columns={cols}
        rowKey={(j) => j.b.order.id}
        onRow={(j) => {
          prefetchBundle(j.b.order.id);
          navigate(`/orders/${j.b.order.id}`);
        }}
        onRowMenu={onMenu}
        label={t('board.title')}
      />
    </div>
  );
}

/**
 * The board as a canvas (v0.67, the owner: «двигать, перемещать карточки, увеличивать, размещать где угодно, выделить
 * важных, увеличить важные, закреплять»): every card where the manager put it — dragged anywhere, its corner drawn out
 * for a larger card (its photo 16 : 9, its facts under it — `cardHeight`), important ones larger, pinned ones fixed where
 * they are. A new car finds a free place by itself; «Расставить» lays them all out again (pinned and important first),
 * with «Отменить». A click still opens the job; a drag does not.
 */
function DeskCanvas({ jobs, all, covers, tick, onMenu, slot }: { jobs: DeskJob[]; all: DeskJob[]; covers?: Map<string, string>; tick: number; onMenu: OnMenu; /** The bar's place for «Расставить». */ slot: HTMLElement | null }) {
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
    if ((e.target as Element).closest('.dcard-doc, .dcard-tools') && kind === 'move') return;
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
  const placed = jobs.map((j) => ({ j, p: live?.id === j.b.order.id ? live.p : desk.places[j.b.order.id] })).filter((x): x is { j: DeskJob; p: Place } => !!x.p);
  // Where cards cover each other: the one put down last on top (pinned above them all, the one under the mouse above all).
  const stack = placed.map(({ j, p }) => ({ id: j.b.order.id, z: p.z ?? 0 })).sort((a, b) => a.z - b.z).map((x) => x.id);
  const layer = (id: string) => (live?.id === id ? stack.length + 20 : pinned.has(id) ? stack.length + 10 : stack.indexOf(id) + 1);
  const height = Math.max(420, ...placed.map(({ p }) => p.y + cardHeight(p.w) + 48));
  return (
    <div className="desk-canvas" ref={box} style={{ height }} data-desk-canvas-area>
      {slot &&
        createPortal(
          <button type="button" className="dboard-act" onClick={tidy} data-desk-arrange>
            <IconSparkles size={15} stroke={2} aria-hidden />
            {t('deskBoard.arrange')}
          </button>,
          slot,
        )}
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
            <DeskCard b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} important={important.has(id)} pinned={pinned.has(id)} onMenu={onMenu} />
            {!pinned.has(id) && <span className="desk-resize" data-tip={t('deskBoard.resize')} aria-hidden onPointerDown={begin(id, 'size')} />}
          </div>
        );
      })}
    </div>
  );
}

const MODES: { mode: DeskMode; icon: Icon; word: 'cards' | 'list' | 'canvas' }[] = [
  { mode: 'cards', icon: IconLayoutGrid, word: 'cards' },
  { mode: 'list', icon: IconLayoutList, word: 'list' },
  { mode: 'canvas', icon: IconArtboard, word: 'canvas' },
];

export function DeskBoard({
  jobs,
  covers,
  archive,
  tick,
  order,
  tab,
  onTab,
  owing,
  archived,
  children,
}: {
  /** The cars on the board, the freshest first. */
  jobs: DeskJob[];
  covers?: Map<string, string>;
  /** What «В архив» does with a job (the phone's swipe left). */
  archive: (b: OrderBundle) => RowSwipe;
  tick: number;
  /** The tabs' order of «Вид»: the steps follow it, then «Долги» and «Архив» as they come in it. */
  order: BoardTab[];
  /** What is shown: all the cars, one step's, or — in place of the cars — who owes, the archive (`children`). */
  tab: 'all' | 'debts' | 'archive' | Phase;
  onTab: (f: 'all' | 'debts' | 'archive' | Phase) => void;
  /** How many customers owe; how many jobs were taken off the board by hand. */
  owing: number;
  archived: number;
  /** «Долги» or «Архив», when one of them is the tab. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const desk = useDeskBoard();
  const [menu, setMenu] = useState<{ j: DeskJob; at: At } | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const onMenu: OnMenu = (j, at) => setMenu({ j, at });
  const steps = (order as string[]).filter(isBoardStep);
  const step = isBoardStep(tab) ? tab : undefined;
  const cars = tab !== 'debts' && tab !== 'archive';
  const others = order.filter((k): k is 'debts' | 'archive' => k === 'debts' || k === 'archive');
  const count = (p: Phase) => jobs.filter((j) => j.phase === p).length;
  // One grid, no sections: the cars in the steps' order, an important one first in its step, a pinned one first of all
  // (within that — the freshest first, as the board gives them).
  const rank = new Map(steps.map((p, i) => [p, i] as const));
  const important = new Set(desk.important);
  const pinned = new Set(desk.pinned);
  const byStep = [...jobs].sort((x, y) => (rank.get(x.phase) ?? 99) - (rank.get(y.phase) ?? 99) || Number(important.has(y.b.order.id)) - Number(important.has(x.b.order.id)));
  const sorted = pinnedFirst(byStep, (j) => j.b.order.id, desk.pinned);
  const shown = step ? sorted.filter((j) => j.phase === step) : sorted;
  const sum = shown.reduce((s, j) => s + jobAmount(j.b), 0);
  return (
    <>
      <div className="dboard-bar">
        <div className="dboard-tabs" role="toolbar" aria-label={t('board.title')} data-board-steps>
          <button type="button" className="dboard-tab" data-active={tab === 'all' || undefined} aria-pressed={tab === 'all'} onClick={() => onTab('all')}>
            {t('board.all')}
            <span className="dboard-n">{jobs.length}</span>
          </button>
          {steps
            .filter((p) => count(p) > 0)
            .map((p) => (
              <button key={p} type="button" className="dboard-tab" data-step={p} style={stepVars(p)} data-active={step === p || undefined} aria-pressed={step === p} onClick={() => onTab(step === p ? 'all' : p)}>
                <i className="dstep-dot" aria-hidden />
                {t(`job.phase.${p}`)}
                <span className="dboard-n">{count(p)}</span>
              </button>
            ))}
          {/* Who owes and the archive: other lists under the same bar (v0.75 — they were buttons of the head, and the
              steps left the screen while one was open). */}
          <i className="dboard-sep" aria-hidden />
          {others.map((k) => {
            const I = k === 'debts' ? IconUserDollar : IconArchive;
            const n = k === 'debts' ? owing : archived;
            return (
              <button key={k} type="button" className="dboard-tab" data-tab={k} data-active={tab === k || undefined} aria-pressed={tab === k} onClick={() => onTab(tab === k ? 'all' : k)}>
                <I size={15} stroke={2} aria-hidden />
                {t(k === 'debts' ? 'board.tabDebts' : 'board.archive')}
                {n > 0 && <span className="dboard-n">{n}</span>}
              </button>
            );
          })}
        </div>
        {cars && sum > 0 && (
          <span className="dboard-sum" data-board-sum>
            <span>{step ? t(`job.phase.${step}`) : t('board.inShop')}</span>
            <Money fils={sum} fw={600} />
          </span>
        )}
        <div className="dboard-end" hidden={!cars}>
          <span className="dboard-slot" ref={setSlot} />
          <div className="dboard-tabs dboard-modes" role="group" aria-label={t('board.view')}>
            {MODES.map(({ mode, icon: I, word }) => (
              <button key={mode} type="button" className="dboard-tab" data-mode={mode} data-active={desk.mode === mode || undefined} aria-pressed={desk.mode === mode} onClick={() => setDeskBoard({ mode })}>
                <I size={15} stroke={2} aria-hidden />
                {t(`deskBoard.${word}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      {!cars ? (
        children
      ) : desk.mode === 'canvas' ? (
        <DeskCanvas jobs={shown} all={jobs} covers={covers} tick={tick} onMenu={onMenu} slot={slot} />
      ) : !shown.length ? (
        <EmptyState icon={IconLayoutKanban} title={t('board.emptyTitle')} />
      ) : desk.mode === 'list' ? (
        <DeskList jobs={shown} steps={steps} covers={covers} onMenu={onMenu} />
      ) : (
        <List animate className="dboard-grid">
          {shown.map((j) => (
            <DeskCard key={j.b.order.id} b={j.b} phase={j.phase} cover={covers?.get(j.b.vehicle.id)} tick={tick} important={important.has(j.b.order.id)} pinned={pinned.has(j.b.order.id)} onMenu={onMenu} />
          ))}
        </List>
      )}
      <JobMenu target={menu} onClose={() => setMenu(null)} archive={archive} canvas={desk.mode === 'canvas'} />
    </>
  );
}
