import { Group, Modal, Text, ThemeIcon } from '@mantine/core';
import { IconBuildingFactory2, IconCash, IconClock, IconExternalLink, IconPackage, IconRepeat, IconTrash, IconTruckDelivery, type Icon } from '@tabler/icons-react';
import { memo, useState } from 'react';
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

/**
 * A job on the board, in one row: the car's photo with the step it is on (colour and symbol), the plate,
 * the car, how long it has been there, and its money. A tap opens it; a long press (right click) offers
 * to delete it.
 */
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
  const late = (phase === 'wait' || phase === 'price') && hours >= (b.settings.boardWarnHours ?? 2);
  const amount = jobAmount(b);
  const car = [b.vehicle.make, b.vehicle.model].filter(Boolean).join(' ');
  const working = phase === 'look' || phase === 'price' || phase === 'wait' || phase === 'work';
  const find = working && phase !== 'look' ? partsToFind(b.items).length : 0;
  // Parts on their way (ordered, not here yet), work handed outside, the time promised to the customer.
  const coming = working && !find && b.items.some((i) => i.kind === 'part' && !i.customerSupplied && !i.done && i.approvalState === 'approved' && (i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit'));
  const outside = working && b.items.some((i) => i.outsource?.state === 'out' && i.approvalState !== 'declined' && i.approvalState !== 'cancelled');
  const due = working ? b.order.promisedReadyAt : undefined;
  const dueLate = !!due && due < nowIso();
  // Short enough to stand beside the plate: the time today, the weekday and the time on another day.
  const dueText = due ? dueShort(due, lang) : '';
  const open = () => navigate(`/orders/${b.order.id}`);
  return (
    <>
      <div
        className="list-row clickable job-row swipe-row"
        {...touch}
        style={swipe ? sw.style : undefined}
        data-swiping={sw.dragging || undefined}
        data-past={sw.past || undefined}
        onClick={() => {
          if (press.consumeClick() || sw.consumeClick()) return;
          open();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        aria-label={`№${b.order.number} ${car}`}
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
        {cover ? (
          <span className="job-thumb">
            <MediaImage id={cover} h={48} w={48} radius="0" />
            <span className="job-thumb-phase" style={{ background: `var(--mantine-color-${m.color}-6)` }} aria-label={t(`job.phase.${phase}`)}>
              <m.icon size={13} stroke={2.4} />
            </span>
          </span>
        ) : (
          // The same 48 pt square as a photo: the plates of all the rows line up.
          <ThemeIcon variant="light" color={m.color} size={48} radius={12} style={{ flexShrink: 0 }}>
            <m.icon size={23} stroke={1.8} />
          </ThemeIcon>
        )}
        <div className="body">
          <Group gap={8} wrap="nowrap" justify="space-between">
            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
              <PlateText plate={b.vehicle.plate} size="sm" />
              {/* The time promised to the customer, beside the plate; red once it has passed. */}
              {due && (
                <Text size="sm" c={dueLate ? 'red.7' : 'orange.7'} fw={600} className="tnum row-due" aria-label={t('job.due')}>
                  <IconClock size={14} stroke={2.2} aria-hidden />
                  {dueText}
                </Text>
              )}
            </Group>
            {amount > 0 && <Money fils={amount} c={phase === 'debt' ? 'red.7' : undefined} />}
          </Group>
          <Group gap={6} wrap="nowrap" mt={3} style={{ minWidth: 0 }}>
            <Text size="sm" lineClamp={1} style={{ minWidth: 0 }}>
              {car || `№${b.order.number}`}
            </Text>
            <Text size="sm" c={late ? 'red.7' : 'dimmed'} fw={late ? 600 : undefined} style={{ flexShrink: 0 }} className="tnum">
              · {t(`job.phase.${phase}`)} {shortDuration(hours, lang)}
            </Text>
            {find > 0 && <IconPackage size={15} stroke={2} color="var(--mantine-color-orange-6)" style={{ flexShrink: 0 }} aria-label={t('flags.waitingParts')} />}
            {coming && <IconTruckDelivery size={15} stroke={2} color="var(--mantine-color-cobalt-6)" style={{ flexShrink: 0 }} aria-label={t('flags.partsComing')} />}
            {outside && <IconBuildingFactory2 size={15} stroke={2} color="var(--mantine-color-teal-6)" style={{ flexShrink: 0 }} aria-label={t('flags.outside')} />}
            {flags.debt && phase !== 'debt' && <IconCash size={15} stroke={2} color="var(--mantine-color-red-6)" style={{ flexShrink: 0 }} aria-label={t('flags.debt')} />}
            {flags.warranty && <IconRepeat size={15} stroke={2} color="var(--mantine-color-grape-6)" style={{ flexShrink: 0 }} aria-label={t('flags.warranty')} />}
          </Group>
        </div>
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
