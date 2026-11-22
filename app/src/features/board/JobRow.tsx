import { Modal, Text } from '@mantine/core';
import {
  IconBrandWhatsapp,
  IconBuildingFactory2,
  IconCar,
  IconCash,
  IconClock,
  IconExternalLink,
  IconFileInvoice,
  IconFileTypePdf,
  IconPackage,
  IconRepeat,
  IconTrash,
  IconTruckDelivery,
  type Icon,
} from '@tabler/icons-react';
import { memo, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { dayShort, dueShort, hoursBetween, nowIso, shortDuration } from '../../domain/dates';
import type { Phase } from '../../domain/flow';
import { leftBoardAt, liveLines } from '../../domain/flow';
import { activeInvoice } from '../../domain/invoice';
import { itemAmounts, summarize } from '../../domain/items';
import { jobSummary } from '../../domain/jobSummary';
import { invoicePdf, openPdf, quotationPdf } from '../../services/documents';
import { partsToFind } from '../../services/flow';
import { openWhatsApp } from '../../services/messages';
import { bundleAmountDue, prefetchBundle, type OrderBundle } from '../../services/orders';
import { List, ListRow, MediaImage, Money, PlateText } from '../../ui/components';
import { DeskMenu } from '../../ui/desk';
import { useAction, useLang, usePhone } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { useLongPress } from '../../ui/longPress';
import { useSwipeRow } from '../../ui/swipe';
import { PHASE_META } from '../job/phase';
import { DeleteJobModal } from '../orders/DeleteJob';
import { orderFlags } from '../orders/flags';
import { IconArrowsMaximize, IconArrowsMinimize, IconPin, IconPinnedFilled, IconStar, IconStarFilled } from '@tabler/icons-react';
import { resizeStep, toggleImportant, togglePinned } from '../../ui/deskBoard';

/** What the job is worth now: the amount due on its invoice, or the total of its lines. */
export function jobAmount(b: OrderBundle): number {
  if (activeInvoice(b.invoices) || b.order.stage === 'delivered') return Math.max(0, bundleAmountDue(b));
  return liveLines(b.items).reduce((s, i) => s + itemAmounts(i).gross, 0);
}

/** What a job came to: its invoice (with VAT), or the lines the customer agreed to — a closed or cancelled job in the archive. */
export function jobTotal(b: OrderBundle): number {
  if (b.order.stage === 'cancelled') return 0;
  return activeInvoice(b.invoices)?.totalFils ?? summarize(b.items).approvedGross;
}

/** What a swipe left (and the long-press menu) does with the row: to the archive, or back to the board. */
export interface RowSwipe {
  label: string;
  icon: Icon;
  color: string;
  onCommit: () => void;
}

type RowProps = {
  b: OrderBundle;
  phase: Phase;
  cover?: string;
  swipe?: RowSwipe;
  /** Changes every few minutes: "how long" and "late" move on. */
  tick?: number;
  /**
   * `card` — the photo is the card (2 : 1); `row` — a row of a list with a small photo (v0.22): the board in
   * «Компактно», and always the archive.
   */
  variant?: 'card' | 'row';
  /** A row of the archive: the day the job left the board instead of its step and time. */
  dated?: boolean;
  /** The PC board's marks (v0.67, ui/deskBoard.ts): important — lit and larger; pinned — first, fixed on the canvas. */
  important?: boolean;
  pinned?: boolean;
  /** On the PC board's canvas: its size a step larger or smaller from the menu. */
  canvas?: boolean;
};

/**
 * A row renders again only when its job changed (the board keeps the same bundle for a job that did
 * not — `loadBoard`), its photo or step did, or the clock moved on: the board refreshing, the stack
 * moving, a swipe on another row leave it alone.
 */
/** How far in from a card's side a swipe may start (a fingertip's width). */
const EDGE = 40;

export const JobRow = memo(
  JobRowView,
  (a, z) =>
    a.b === z.b &&
    a.phase === z.phase &&
    a.cover === z.cover &&
    a.tick === z.tick &&
    a.swipe?.label === z.swipe?.label &&
    a.variant === z.variant &&
    a.dated === z.dated &&
    a.important === z.important &&
    a.pinned === z.pinned &&
    a.canvas === z.canvas,
);

function JobRowView({ b, phase, cover, swipe, variant = 'card', dated, important, pinned, canvas }: RowProps) {
  const navigate = useNavigate();
  const lang = useLang();
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const [remove, setRemove] = useState(false);
  const press = useLongPress(() => setMenu(true));
  // On a PC (v0.41) a right click opens the card's menu where the mouse is, not a sheet in the middle.
  const phone = usePhone();
  const [deskAt, setDeskAt] = useState<{ x: number; y: number } | null>(null);
  const { run } = useAction();
  // To the left — the row's own action (to the archive, back on the board); to the right (v0.30) — the customer's
  // WhatsApp, when there is a number to write to. Only from the card's edge (v0.36): a card is most of what a thumb
  // touches on the board, and a scroll that drifted sideways sent cars to the archive.
  const wa = b.customer.whatsapp || b.customer.phone;
  const openWa = () => openWhatsApp(wa);
  const sw = useSwipeRow({ trailing: swipe ? { onCommit: () => swipe.onCommit() } : undefined, leading: wa ? { onCommit: openWa } : undefined }, 92, { edge: EDGE });
  const swiping = !!swipe || !!wa;
  // A long press and a swipe on the same row: both see the finger.
  const touch = swiping
    ? {
        ...press.handlers,
        onTouchStart: (e: React.TouchEvent<HTMLElement>) => (press.handlers.onTouchStart(e), sw.handlers.onTouchStart(e)),
        onTouchMove: (e: React.TouchEvent<HTMLElement>) => (press.handlers.onTouchMove(e), sw.handlers.onTouchMove(e)),
        onTouchEnd: (e: React.TouchEvent<HTMLElement>) => (press.handlers.onTouchEnd(e), sw.handlers.onTouchEnd(e)),
        onTouchCancel: () => (press.handlers.onTouchCancel(), sw.handlers.onTouchCancel()),
      }
    : press.handlers;
  const m = PHASE_META[phase];
  const { flags, waitingHours } = orderFlags(b);
  const hours = phase === 'wait' && waitingHours !== undefined ? waitingHours : hoursBetween(b.order.stageChangedAt);
  // No answer, or no price told, for a couple of hours: the time turns red.
  // An appointment says when the car is due in (red once that time has passed), not how long it was booked.
  const booked = phase === 'booked' ? b.order.bookedFor : undefined;
  const late = ((phase === 'wait' || phase === 'price') && hours >= (b.settings.boardWarnHours ?? 2)) || (!!booked && booked < nowIso());
  const amount = jobAmount(b);
  const car = [b.vehicle.make, b.vehicle.model].filter(Boolean).join(' ');
  const working = phase === 'look' || phase === 'price' || phase === 'wait' || phase === 'work';
  const find = working && phase !== 'look' ? partsToFind(b.items).length : 0;
  // Parts on their way (ordered, not here yet), work handed outside, the time promised to the customer.
  const coming = working && !find && b.items.some((i) => i.kind === 'part' && !i.customerSupplied && !i.done && i.approvalState === 'approved' && (i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit'));
  const outside = working && b.items.some((i) => i.outsource?.state === 'out' && i.approvalState !== 'declined' && i.approvalState !== 'cancelled');
  const due = working ? b.order.promisedReadyAt : undefined;
  const dueLate = !!due && due < nowIso();
  const dueText = due ? dueShort(due, lang) : '';
  const open = () => navigate(`/orders/${b.order.id}`);
  // The step in its colour — red once it has been there too long: the first thing the card says.
  const tone = late ? 'red' : m.color;
  const stepText = `${t(`job.phase.${phase}`)} · ${booked ? dueShort(booked, lang) : shortDuration(hours, lang)}`;
  const name = car || `№${b.order.number}`;
  // What the job is about, in a line (v0.30): its work and parts by name, else the complaint.
  const what = jobSummary(b.items, b.order.complaint, b.order.docLanguage);
  // Its paper, on the card (v0.30): the invoice once issued, else the quote of its lines.
  const inv = activeInvoice(b.invoices);
  const doc = inv ? 'invoice' : liveLines(b.items).some((i) => i.kind !== 'discount') ? 'quote' : null;
  const openDoc = () => run(async () => openPdf(inv ? await invoicePdf(inv.id) : await quotationPdf(b.order.id)));
  const own =
    <E extends SyntheticEvent>(fn?: (e: E) => void) =>
    (e: E) => {
      e.stopPropagation();
      fn?.(e);
    };
  // What else to know at a glance, each as its own coloured symbol.
  type Mark = { key: string; icon: Icon; color: string; label: string };
  const marks = ([
    find > 0 && { key: 'find', icon: IconPackage, color: 'orange', label: t('flags.waitingParts') },
    coming && { key: 'coming', icon: IconTruckDelivery, color: 'cobalt', label: t('flags.partsComing') },
    outside && { key: 'outside', icon: IconBuildingFactory2, color: 'teal', label: t('flags.outside') },
    flags.debt && phase !== 'debt' && { key: 'debt', icon: IconCash, color: 'red', label: t('flags.debt') },
    flags.warranty && { key: 'warranty', icon: IconRepeat, color: 'grape', label: t('flags.warranty') },
  ] as (Mark | false)[]).filter((x): x is Mark => !!x);
  const mark = (x: Mark) => (
    <span key={x.key} className="job-card-mark" title={x.label}>
      <x.icon size={15} stroke={2.2} color={`var(--mantine-color-${x.color}-6)`} aria-label={x.label} />
    </span>
  );
  // The time promised to the customer: orange, red once it has passed.
  const dueChip = due ? (
    <span className="job-card-due tnum" data-late={dueLate || undefined}>
      <IconClock size={13} stroke={2.4} aria-hidden />
      <span aria-label={`${t('job.due')}: ${dueText}`}>{dueText}</span>
    </span>
  ) : null;
  const vars = {
    '--c': `var(--mantine-color-${tone}-6)`,
    '--c-deep': `var(--mantine-color-${tone}-filled)`,
    '--c-soft': `var(--mantine-color-${tone}-light)`,
    '--c-ink': `var(--mantine-color-${tone}-light-color)`,
  } as CSSProperties;
  const row = variant === 'row';
  // The archive's row: the day the job left the board, and what it came to (a closed one owes nothing).
  const ended = phase === 'closed' || phase === 'cancelled';
  const day = dated ? dayShort(leftBoardAt(b.order)) : undefined;
  const dayText = day ? (day.word ? t(`common.${day.word}`) : day.text) : '';
  const rowAmount = dated && ended ? jobTotal(b) : amount;
  // On the small photo: the step of a job still open (taken off by hand), a cancelled one's cross; a closed one — nothing.
  const badge = dated && phase !== 'closed' ? PHASE_META[phase] : undefined;
  const face = row ? (
    <>
      <span className="job-mini-pic">
        <span className="car-thumb">
          {cover ? <MediaImage id={cover} h={56} w={56} radius="0" /> : <IconCar size={28} stroke={1.6} aria-hidden />}
        </span>
        {badge && (
          <span className="job-mini-badge" style={{ background: `var(--mantine-color-${badge.color}-filled)` }} title={t(`job.phase.${phase}`)}>
            <badge.icon size={12} stroke={2.6} aria-label={t(`job.phase.${phase}`)} />
          </span>
        )}
      </span>
      <span className="job-mini-body">
        <span className="job-mini-line">
          <span className="job-mini-name">{name}</span>
          {dated ? (
            <span className="job-mini-date tnum">{dayText}</span>
          ) : (
            <>
              {marks.length > 0 && <span className="job-mini-marks">{marks.map(mark)}</span>}
              <span className="job-mini-step tnum" title={stepText}>
                <m.icon size={13} stroke={2.4} aria-hidden />
                {/* In a narrow row (a lane of the PC board, which names its step) only the symbol and the time. */}
                <span className="job-mini-step-name">{t(`job.phase.${phase}`)} · </span>
                {booked ? dueShort(booked, lang) : shortDuration(hours, lang)}
              </span>
            </>
          )}
        </span>
        <span className="job-mini-line">
          <PlateText plate={b.vehicle.plate} size="xs" />
          {!dated && dueChip}
          {rowAmount > 0 && (
            <span className="job-mini-amount">
              <Money fils={rowAmount} fw={600} />
            </span>
          )}
        </span>
      </span>
    </>
  ) : null;
  return (
    <>
      <div
        className={row ? 'job-row job-mini swipe-row' : 'job-row job-card swipe-row'}
        // Swiped only from its edge (v0.36): begun in its middle, a sideways drag is the board's — the tab beside (v0.38).
        data-swipe-edge={EDGE}
        // Every card the same size (the user's call, v0.17.3): a job without the car's photo has the same 2 : 1
        // card, with the car drawn on a dark ground in its place. A row (compact, the archive) — all rows one size.
        data-photo={row ? undefined : true}
        data-art={row || cover ? undefined : true}
        {...touch}
        {...(phone
          ? {}
          : {
              onContextMenu: (e: React.MouseEvent) => {
                e.preventDefault();
                setDeskAt({ x: e.clientX, y: e.clientY });
              },
            })}
        style={swiping ? { ...vars, ...sw.style } : vars}
        data-swiping={sw.dragging || undefined}
        data-past={sw.past || undefined}
        data-doc={!row && doc ? '' : undefined}
        data-important={important || undefined}
        data-pinned={pinned || undefined}
      >
        {wa && (
          <span className="swipe-action lead" style={{ background: 'var(--mantine-color-green-6)' }} aria-hidden={sw.open !== 'leading'}>
            <button
              type="button"
              className="swipe-btn"
              tabIndex={sw.open === 'leading' ? 0 : -1}
              onClick={(e) => {
                e.stopPropagation();
                sw.close();
                openWa();
              }}
            >
              <IconBrandWhatsapp size={22} stroke={1.9} aria-hidden />
              <span>WhatsApp</span>
            </button>
          </span>
        )}
        {swipe && (
          <span className="swipe-action" style={{ background: `var(--mantine-color-${swipe.color}-6)` }} aria-hidden={sw.open !== 'trailing'}>
            <button
              type="button"
              className="swipe-btn"
              tabIndex={sw.open === 'trailing' ? 0 : -1}
              onClick={(e) => {
                e.stopPropagation();
                sw.close();
                swipe.onCommit();
              }}
            >
              <swipe.icon size={22} stroke={1.9} aria-hidden />
              <span>{swipe.label}</span>
            </button>
          </span>
        )}
        <button
          type="button"
          className="job-card-open"
          // The job read whole as the finger lands (v0.37): an archive's row holds only what it shows — the job opens
          // at once all the same.
          onPointerDown={() => prefetchBundle(b.order.id)}
          onClick={() => {
            if (press.consumeClick() || sw.consumeClick()) return;
            open();
          }}
        >
          {/* The photo is the card (or, without one, the car drawn in its place): the step on it, the car and its
              money at its foot over a soft shade. A row: the photo small on the left, the same facts beside it. */}
          {row ? (
            face
          ) : (
            <>
              {cover ? (
                <MediaImage id={cover} card h="100%" w="100%" radius="0" />
              ) : (
                <span className="job-card-art" aria-hidden>
                  <IconCar size={120} stroke={1.1} />
                </span>
              )}
              <span className="job-card-shade" aria-hidden />
              <span className="job-card-top">
                <span className="job-card-step tnum">
                  <m.icon size={15} stroke={2.4} aria-hidden />
                  {stepText}
                </span>
                {marks.length > 0 && <span className="job-card-marks">{marks.map(mark)}</span>}
              </span>
              <span className="job-card-foot">
                <span className="job-card-name">{name}</span>
                {what && <span className="job-card-what">{what}</span>}
                <span className="job-card-meta">
                  <PlateText plate={b.vehicle.plate} size="sm" />
                  {dueChip}
                  {amount > 0 && (
                    <span className="job-card-amount">
                      <Money fils={amount} fw={700} />
                    </span>
                  )}
                </span>
              </span>
            </>
          )}
        </button>
        {!phone && !dated && !row && (
          // The PC board (v0.67): important and pinned a click away, at the card's top — shown when on, else under the mouse.
          <span className="desk-card-tools" onPointerDown={own()} onClick={own()} onContextMenu={own()}>
            <button type="button" className="desk-card-tool" data-on={important || undefined} data-tool="important" aria-pressed={!!important} aria-label={t(important ? 'deskBoard.notImportant' : 'deskBoard.important')} title={t(important ? 'deskBoard.notImportant' : 'deskBoard.important')} onClick={() => toggleImportant(b.order.id)}>
              {important ? <IconStarFilled size={15} aria-hidden /> : <IconStar size={15} stroke={2} aria-hidden />}
            </button>
            <button type="button" className="desk-card-tool" data-on={pinned || undefined} data-tool="pin" aria-pressed={!!pinned} aria-label={t(pinned ? 'deskBoard.unpin' : 'deskBoard.pin')} title={t(pinned ? 'deskBoard.unpin' : 'deskBoard.pin')} onClick={() => togglePinned(b.order.id)}>
              {pinned ? <IconPinnedFilled size={15} aria-hidden /> : <IconPin size={15} stroke={2} aria-hidden />}
            </button>
          </span>
        )}
        {!row && doc && (
          // The job's paper a tap away, on the card: its touches are its own (the card neither opens nor swipes).
          <button
            type="button"
            className="job-card-doc glass"
            aria-label={t(doc === 'invoice' ? 'job.more.invoice' : 'job.more.quote')}
            onTouchStart={own()}
            onTouchMove={own()}
            onTouchEnd={own()}
            onPointerDown={own()}
            onContextMenu={own()}
            onClick={own(() => void openDoc())}
          >
            {doc === 'invoice' ? <IconFileInvoice size={16} stroke={2} aria-hidden /> : <IconFileTypePdf size={16} stroke={2} aria-hidden />}
            {t(doc === 'invoice' ? 'job.more.invoice' : 'job.more.quote')}
          </button>
        )}
      </div>
      {/* The row's actions (long press), a sheet like the iPhone's context menu. */}
      <LazySheet opened={menu}>
        {(o) => (
      <Modal opened={o} onClose={() => setMenu(false)} title={`№${b.order.number} · ${car}`.trim()}>
        <List>
          <ListRow
            title={t('common.open')}
            left={<IconExternalLink size={20} stroke={1.8} />}
            chevron
            onClick={() => {
              setMenu(false);
              open();
            }}
          />
          {swipe && (
            <ListRow
              title={swipe.label}
              left={<swipe.icon size={20} stroke={1.8} color={`var(--mantine-color-${swipe.color}-6)`} />}
              onClick={() => {
                setMenu(false);
                swipe.onCommit();
              }}
            />
          )}
          <ListRow
            title={
              <Text span inherit c="red">
                {t('order.delete')}
              </Text>
            }
            left={<IconTrash size={20} stroke={1.8} color="var(--mantine-color-red-6)" />}
            onClick={() => {
              setMenu(false);
              setRemove(true);
            }}
          />
        </List>
      </Modal>
        )}
      </LazySheet>
      <LazySheet opened={remove}>{(o) => <DeleteJobModal order={b.order} opened={o} onClose={() => setRemove(false)} />}</LazySheet>
      {!phone && (
        <DeskMenu
          at={deskAt}
          onClose={() => setDeskAt(null)}
          label={`№${b.order.number} · ${car}`.trim()}
          items={[
            { key: 'open', label: t('common.open'), icon: IconExternalLink, onClick: open },
            ...(doc ? [{ key: 'doc', label: t(doc === 'invoice' ? 'job.more.invoice' : 'job.more.quote'), icon: doc === 'invoice' ? IconFileInvoice : IconFileTypePdf, onClick: () => void openDoc() }] : []),
            ...(wa ? [{ key: 'wa', label: 'WhatsApp', icon: IconBrandWhatsapp, onClick: openWa }] : []),
            ...(swipe ? [{ key: 'swipe', label: swipe.label, icon: swipe.icon, onClick: () => swipe.onCommit() }] : []),
            // The PC board's own (v0.67): important, pinned, and on the canvas — the card's size.
            ...(!dated
              ? [
                  { key: 'important', label: t(important ? 'deskBoard.notImportant' : 'deskBoard.important'), icon: important ? IconStarFilled : IconStar, divided: true, onClick: () => toggleImportant(b.order.id) },
                  { key: 'pin', label: t(pinned ? 'deskBoard.unpin' : 'deskBoard.pin'), icon: pinned ? IconPinnedFilled : IconPin, onClick: () => togglePinned(b.order.id) },
                ]
              : []),
            ...(canvas
              ? [
                  { key: 'bigger', label: t('deskBoard.bigger'), icon: IconArrowsMaximize, onClick: () => resizeStep(b.order.id, 1) },
                  { key: 'smaller', label: t('deskBoard.smaller'), icon: IconArrowsMinimize, onClick: () => resizeStep(b.order.id, -1) },
                ]
              : []),
            { key: 'delete', label: t('order.delete'), icon: IconTrash, color: 'red', divided: true, onClick: () => setRemove(true) },
          ]}
        />
      )}
    </>
  );
}
