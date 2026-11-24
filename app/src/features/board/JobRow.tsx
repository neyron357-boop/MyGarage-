import { Modal, Text } from '@mantine/core';
import {
  IconBrandWhatsapp,
  IconBuildingFactory2,
  IconCar,
  IconCash,
  IconCheck,
  IconCircle,
  IconCircleCheckFilled,
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
import { dayShort, dueShort, shortDuration } from '../../domain/dates';
import type { Phase } from '../../domain/flow';
import { leftBoardAt } from '../../domain/flow';
import { invoicePdf, openPdf, quotationPdf } from '../../services/documents';
import { setBoardStatus } from '../../services/flow';
import { haptic } from '../../ui/haptics';
import { useOpenChat } from '../whatsapp/openChat';
import { prefetchBundle, type OrderBundle } from '../../services/orders';
import { List, ListRow, MediaImage, Money, PlateText } from '../../ui/components';
import { DeskMenu } from '../../ui/desk';
import { useAction, useLang, usePhone } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { useLongPress } from '../../ui/longPress';
import { useSwipeRow } from '../../ui/swipe';
import { PHASE_META } from '../job/phase';
import { BOARD_STATUSES, STATUS_PHASE, type BoardStatus } from '../../domain/boardStatus';
import { DeleteJobModal } from '../orders/DeleteJob';
import { IconPin, IconPinnedFilled, IconPinnedOff } from '@tabler/icons-react';
import { togglePinned } from '../../ui/deskBoard';
import { jobFacts, jobTotal } from './jobFacts';

export { jobAmount, jobTotal } from './jobFacts';

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
  /** Pinned to the top of the phone's board (v0.73, ui/deskBoard.ts): a pin among its marks. */
  pinned?: boolean;
  /** The board picking jobs to put in a tab (v0.70): a tap picks it (a mark on it), it does not open. */
  picking?: boolean;
  picked?: boolean;
  onPick?: (orderId: string) => void;
  /** The tab of the board it is in (v0.70) — offered in its long-press menu. */
  status?: BoardStatus;
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
    a.pinned === z.pinned &&
    a.picking === z.picking &&
    a.picked === z.picked &&
    a.status === z.status,
);

function JobRowView({ b, phase, cover, swipe, variant = 'card', dated, pinned, picking, picked, onPick, status }: RowProps) {
  const navigate = useNavigate();
  const lang = useLang();
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const [remove, setRemove] = useState(false);
  const press = useLongPress(() => !picking && setMenu(true));
  // On a PC (v0.41) a right click opens the card's menu where the mouse is, not a sheet in the middle.
  const phone = usePhone();
  const [deskAt, setDeskAt] = useState<{ x: number; y: number } | null>(null);
  const { run } = useAction();
  // To the left — the row's own action (to the archive, back on the board); to the right (v0.30) — the customer's
  // WhatsApp, when there is a number to write to. Only from the card's edge (v0.36): a card is most of what a thumb
  // touches on the board, and a scroll that drifted sideways sent cars to the archive.
  // What the card says, read off the job's facts (jobFacts.ts — the PC's card reads the same).
  const { manual, m, flags, hours, booked, amount, car, find, coming, outside, due, dueLate, dueText, tone, name, what, inv, doc, wa } = jobFacts(b, phase, lang);
  // The customer's chat in the app while the garage's WhatsApp is linked (v0.80), WhatsApp itself when not.
  const openChat = useOpenChat();
  const openWa = () => openChat(wa);
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
  const stepName = manual ? t(`board.statusOne.${manual}`) : t(`job.phase.${phase}`);
  const open = () => navigate(`/orders/${b.order.id}`);
  const stepText = `${stepName} · ${booked ? dueShort(booked, lang) : shortDuration(hours, lang)}`;
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
    // Pinned to the top on a phone (v0.73; the PC shows it at the card's top, under the mouse).
    phone && pinned && { key: 'pin', icon: IconPinnedFilled, color: 'cobalt', label: t('deskBoard.pinned') },
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
                <span className="job-mini-step-name">{stepName} · </span>
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
        data-pinned={pinned || undefined}
        data-picking={picking || undefined}
        data-picked={picked || undefined}
      >
        {picking && (
          <span className="job-pick" aria-hidden>
            {picked ? <IconCircleCheckFilled size={26} /> : <IconCircle size={26} stroke={1.8} />}
          </span>
        )}
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
            if (picking) return onPick?.(b.order.id);
            open();
          }}
          aria-pressed={picking ? !!picked : undefined}
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
          {/* Pinned to the top of the board (v0.73, the owner's note: «закреплять автомобили первой позиции»). */}
          {!dated && (
            <ListRow
              title={<span data-pin-toggle={pinned ? 'off' : 'on'}>{t(pinned ? 'deskBoard.unpin' : 'deskBoard.pinTop')}</span>}
              left={pinned ? <IconPinnedOff size={20} stroke={1.8} color="var(--mantine-color-cobalt-6)" /> : <IconPin size={20} stroke={1.8} color="var(--mantine-color-cobalt-6)" />}
              onClick={() => {
                setMenu(false);
                togglePinned(b.order.id);
                haptic('success');
              }}
            />
          )}
          {/* The board's tab it is in (v0.70): one tap puts it in another. */}
          {status &&
            BOARD_STATUSES.map((st) => {
              const sm = PHASE_META[STATUS_PHASE[st]];
              return (
                <ListRow
                  key={st}
                  title={t(`board.statusOne.${st}`)}
                  left={<sm.icon size={20} stroke={1.8} color={`var(--mantine-color-${sm.color}-6)`} />}
                  right={st === status ? <IconCheck size={20} stroke={2.4} color="var(--mantine-color-cobalt-6)" aria-label={t('board.current')} /> : undefined}
                  onClick={() => {
                    setMenu(false);
                    if (st !== status) void run(async () => (await setBoardStatus([b.order.id], st), haptic('success')));
                  }}
                />
              );
            })}
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
            { key: 'delete', label: t('order.delete'), icon: IconTrash, color: 'red', divided: true, onClick: () => setRemove(true) },
          ]}
        />
      )}
    </>
  );
}
