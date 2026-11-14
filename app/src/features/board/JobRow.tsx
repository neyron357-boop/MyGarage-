import { Modal, Text } from '@mantine/core';
import { IconBuildingFactory2, IconCash, IconClock, IconExternalLink, IconPackage, IconRepeat, IconTrash, IconTruckDelivery, type Icon } from '@tabler/icons-react';
import { memo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { dueShort, hoursBetween, nowIso, shortDuration } from '../../domain/dates';
import type { Phase } from '../../domain/flow';
import { liveLines } from '../../domain/flow';
import { activeInvoice } from '../../domain/invoice';
import { itemAmounts } from '../../domain/items';
import { partsToFind } from '../../services/flow';
import { bundleAmountDue, type OrderBundle } from '../../services/orders';
import { List, ListRow, MediaImage, Money, PlateText } from '../../ui/components';
import { useLang } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { useLongPress } from '../../ui/longPress';
import { useSwipeAction } from '../../ui/swipe';
import { PHASE_META } from '../job/phase';
import { DeleteJobModal } from '../orders/DeleteJob';
import { orderFlags } from '../orders/flags';

/** What the job is worth now: the amount due on its invoice, or the total of its lines. */
export function jobAmount(b: OrderBundle): number {
  if (activeInvoice(b.invoices) || b.order.stage === 'delivered') return Math.max(0, bundleAmountDue(b));
  return liveLines(b.items).reduce((s, i) => s + itemAmounts(i).gross, 0);
}

/** What a swipe left (and the long-press menu) does with the row: to the archive, or back to the board. */
export interface RowSwipe {
  label: string;
  icon: Icon;
  color: string;
  onCommit: () => void;
}

type RowProps = { b: OrderBundle; phase: Phase; cover?: string; swipe?: RowSwipe; /** Changes every few minutes: "how long" and "late" move on. */ tick?: number };

/**
 * A row renders again only when its job changed (the board keeps the same bundle for a job that did
 * not — `loadBoard`), its photo or step did, or the clock moved on: the board refreshing, the stack
 * moving, a swipe on another row leave it alone.
 */
export const JobRow = memo(JobRowView, (a, z) => a.b === z.b && a.phase === z.phase && a.cover === z.cover && a.tick === z.tick && a.swipe?.label === z.swipe?.label);

function JobRowView({ b, phase, cover, swipe }: RowProps) {
  const navigate = useNavigate();
  const lang = useLang();
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const [remove, setRemove] = useState(false);
  const press = useLongPress(() => setMenu(true));
  const sw = useSwipeAction(() => swipe?.onCommit());
  // A long press and a swipe on the same row: both see the finger.
  const touch = swipe
    ? {
        ...press.handlers,
        onTouchStart: (e: React.TouchEvent<HTMLElement>) => (press.handlers.onTouchStart(e), sw.handlers.onTouchStart(e)),
        onTouchMove: (e: React.TouchEvent<HTMLElement>) => (press.handlers.onTouchMove(e), sw.handlers.onTouchMove(e)),
        onTouchEnd: () => (press.handlers.onTouchEnd(), sw.handlers.onTouchEnd()),
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
  const vars = { '--c': `var(--mantine-color-${tone}-6)`, '--c-deep': `var(--mantine-color-${tone}-filled)` } as CSSProperties;
  return (
    <>
      <div
        className="job-row job-card swipe-row"
        data-photo={cover ? true : undefined}
        {...touch}
        style={swipe ? { ...vars, ...sw.style } : vars}
        data-swiping={sw.dragging || undefined}
        data-past={sw.past || undefined}
      >
        {swipe && (
          <span className="swipe-action" style={{ background: `var(--mantine-color-${swipe.color}-6)` }} aria-hidden={!sw.open}>
            <button
              type="button"
              className="swipe-btn"
              tabIndex={sw.open ? 0 : -1}
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
          onClick={() => {
            if (press.consumeClick() || sw.consumeClick()) return;
            open();
          }}
        >
          {cover ? (
            // The photo is the card: the step on it, the car and its money at its foot over a soft shade.
            <>
              <MediaImage id={cover} card h="100%" w="100%" radius="0" />
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
          ) : (
            // No photo yet: a compact card — the step's symbol in its colour, then the same facts.
            <span className="job-card-row">
              <span className="job-card-icon">
                <m.icon size={23} stroke={2} aria-hidden />
              </span>
              <span className="job-card-body">
                <span className="job-card-line">
                  <span className="job-card-name">{name}</span>
                  {amount > 0 && (
                    <span className="job-card-amount">
                      <Money fils={amount} fw={700} c={phase === 'debt' ? 'red.7' : undefined} />
                    </span>
                  )}
                </span>
                <span className="job-card-line">
                  <PlateText plate={b.vehicle.plate} size="sm" />
                  <span className="job-card-pill tnum">{stepText}</span>
                  {dueChip}
                  {marks.length > 0 && <span className="job-card-marks">{marks.map(mark)}</span>}
                </span>
              </span>
            </span>
          )}
        </button>
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
    </>
  );
}
