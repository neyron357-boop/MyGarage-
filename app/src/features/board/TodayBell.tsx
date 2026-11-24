import { ActionIcon, Modal } from '@mantine/core';
import {
  IconAlarm,
  IconArrowBackUp,
  IconBell,
  IconBuildingFactory2,
  IconCalendarEvent,
  IconCash,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconDroplet,
  IconHourglassHigh,
  IconKey,
  IconMessageCircle,
  IconPlus,
  IconShoppingCart,
  IconTag,
  IconTruckDelivery,
  IconX,
  type Icon,
} from '@tabler/icons-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiTime, formatDate, hoursBetween, shortDuration } from '../../domain/dates';
import { itemTitle } from '../../domain/items';
import type { Task, TaskKind } from '../../domain/today';
import type { Customer, Reminder, Supplier } from '../../domain/types';
import { simpleMessage } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { setBadge } from '../../services/push';
import { doneReminder, openReminders, restoreReminder } from '../../services/reminders';
import { loadPast, markFollowedUp, markServiceReminded, tasksFor } from '../../services/today';
import { EmptyState, Money, PlateText, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { useAutoAnimate } from '../../ui/motion';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { useDueLabel } from '../job/Due';
import { ReminderSheet } from '../notify/ReminderSheet';

const NONE: Supplier[] = [];
const NO_REMINDERS: Reminder[] = [];

/** Each kind of «Сегодня» as its symbol and colour (the notifications' settings show the same — features/notify). */
export const TASK_META: Record<TaskKind, { icon: Icon; color: string }> = {
  promised: { icon: IconClock, color: 'orange' },
  answer: { icon: IconHourglassHigh, color: 'orange' },
  price: { icon: IconTag, color: 'grape' },
  order: { icon: IconShoppingCart, color: 'orange' },
  pickup: { icon: IconTruckDelivery, color: 'cobalt' },
  returnBy: { icon: IconArrowBackUp, color: 'red' },
  outsource: { icon: IconBuildingFactory2, color: 'teal' },
  collect: { icon: IconKey, color: 'green' },
  debt: { icon: IconCash, color: 'red' },
  followUp: { icon: IconMessageCircle, color: 'green' },
  service: { icon: IconDroplet, color: 'cobalt' },
  booked: { icon: IconCalendarEvent, color: 'gray' },
  reminder: { icon: IconAlarm, color: 'cobalt' },
};
const META = TASK_META;

/**
 * "Today" as a bell (v0.30, the user's call — the strip over the board is gone): a round button in the board's head with
 * how many things there are (red when one is late); a tap — a sheet like the phone's notifications: what needs the
 * manager now across all the cars (domain/today.ts), what is late first, in red. A tap on one opens its job (or the
 * message, for a customer); a customer's reminder not needed — its ×.
 */
export const TodayBell = memo(function TodayBell({ bundles }: { bundles: OrderBundle[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run } = useAction();
  const dueLabel = useDueLabel();
  const [open, setOpen] = useState(false);
  // Every past job of the last year: read again only once the board is back (not during the way back) — and first a
  // moment after the board's own cars are on it (v0.37).
  const past = useScreenLiveQuery(() => loadPast(), [bundles.length], 600, 600);
  const suppliers = useScreenLiveQuery(() => db.suppliers.toArray(), [], 600, 600) ?? NONE;
  // The manager's own reminders (v0.74): due here from their day, until done.
  const reminders = useScreenLiveQuery(() => openReminders(), [], 600, 600) ?? NO_REMINDERS;
  const [reminder, setReminder] = useState<{ r?: Reminder } | null>(null);
  // A notification tapped (v0.74) opens the app at «Сегодня»: `#/?today=1` — the list, the address clean again.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('today') !== '1') return;
    setOpen(true);
    setParams((p) => (p.delete('today'), p), { replace: true });
  }, [params, setParams]);
  const [send, setSend] = useState<{ request: SendRequest; customer: Customer; task: Task } | null>(null);
  const list = useAutoAnimate<HTMLDivElement>();
  const tasks = useMemo(() => tasksFor(bundles, past, undefined, reminders), [bundles, past, reminders]);
  const late = tasks.some((x) => x.late);
  // How many things wait — on the app's icon too (the iPhone's badge).
  useEffect(() => setBadge(tasks.length), [tasks.length]);

  const byOrder = new Map(bundles.map((b) => [b.order.id, b]));
  const vehicleOf = (task: Task) => byOrder.get(task.orderId ?? '')?.vehicle ?? past?.vehicles.get(task.vehicleId);
  const customerOf = (task: Task) => byOrder.get(task.orderId ?? '')?.customer ?? past?.customers.get(task.customerId);
  const sName = (id?: string) => suppliers.find((s) => s.id === id)?.name;
  const itemOf = (task: Task) => byOrder.get(task.orderId ?? '')?.items.find((i) => i.id === task.itemId);

  const text = (task: Task): string => {
    switch (task.kind) {
      case 'promised':
        return t('today.promised', { when: dueLabel(task.at, lang) });
      case 'answer':
        return t('today.answer', { time: shortDuration(hoursBetween(task.at), lang) });
      case 'price':
        return t('today.price');
      case 'order':
        return t('today.order', { n: task.count });
      case 'pickup':
        return sName(task.supplierId) ? t('today.pickupFrom', { who: sName(task.supplierId) }) : t('today.pickup', { n: task.count });
      case 'returnBy': {
        const i = itemOf(task);
        return t('today.returnBy', { date: formatDate(task.at.slice(0, 10)).slice(0, 5), part: i ? itemTitle(i, lang) : '' });
      }
      case 'outsource':
        return sName(task.supplierId) ? t('today.outsourceFrom', { who: sName(task.supplierId) }) : t('today.outsource');
      case 'collect':
        return t('today.collect', { time: shortDuration(hoursBetween(task.at), lang) });
      case 'debt':
        return t('today.debt');
      case 'followUp':
        return t('today.followUp');
      case 'service':
        return t('today.service');
      case 'booked':
        return t(task.late ? 'today.bookedLate' : 'today.booked', { time: dubaiTime(task.at) });
      case 'reminder':
        return task.text ?? t('reminder.title');
    }
  };

  /** The customer's message, ready: "how is the car?" or "time for a service". */
  const write = (task: Task) => {
    const customer = customerOf(task);
    const vehicle = vehicleOf(task);
    const order = past?.past.find((p) => p.order.id === task.orderId)?.order;
    if (!customer || !vehicle || !order) return;
    const ctx = { customer, vehicle, order: order as never, garageName: bundles[0]?.settings.name ?? '' };
    const tpl = task.kind === 'service' ? 'serviceDue' : 'followUp';
    setSend({ task, customer, request: { text: simpleMessage(tpl, ctx, customer.docLanguage), template: tpl, lang: customer.docLanguage, orderId: task.orderId } });
  };
  const dismiss = (task: Task) =>
    run(async () => {
      if (task.kind === 'service') await markServiceReminded(task.vehicleId);
      else if (task.orderId) await markFollowedUp(task.orderId);
      haptic('light');
    });
  const isCustomer = (task: Task) => task.kind === 'followUp' || task.kind === 'service';
  /** A reminder done from the list (a repeating one moves on to its next time), with «Отменить». */
  const done = (task: Task) =>
    run(async () => {
      if (!task.reminderId) return;
      const before = await doneReminder(task.reminderId);
      haptic('success');
      undoToast(t('reminder.doneToast'), t('common.undo'), () => void restoreReminder(before));
    });
  const go = (task: Task) => {
    if (task.kind === 'reminder') return setReminder({ r: reminders.find((r) => r.id === task.reminderId) });
    setOpen(false);
    if (isCustomer(task)) write(task);
    else if (task.kind === 'pickup') navigate('/parts?tab=pickup');
    else if (task.orderId) navigate(`/orders/${task.orderId}`);
  };

  return (
    <>
      <ActionIcon className="today-bell" variant="default" size={40} radius="xl" aria-label={`${t('today.title')}: ${tasks.length}`} data-late={late || undefined} onClick={() => setOpen(true)}>
        <IconBell size={22} stroke={2} />
        {tasks.length > 0 && (
          <span className="today-bell-n tnum" aria-hidden>
            {tasks.length}
          </span>
        )}
      </ActionIcon>
      <Modal opened={open} onClose={() => setOpen(false)} title={t('today.title')}>
        {tasks.length ? (
          <div className="today-list" ref={list}>
            {tasks.map((task) => {
              const m = META[task.kind];
              const v = vehicleOf(task);
              const color = task.late ? 'red' : m.color;
              return (
                <div
                  key={task.key}
                  className="today-note"
                  data-late={task.late || undefined}
                  role="button"
                  tabIndex={0}
                  onClick={() => go(task)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go(task))}
                  style={{ '--c': `var(--mantine-color-${color}-6)` } as React.CSSProperties}
                >
                  <span className="row-icon" style={{ background: `var(--mantine-color-${color}-6)` }} aria-hidden>
                    <m.icon size={18} stroke={2.2} />
                  </span>
                  <span className="today-note-body">
                    <span className="today-note-text">{text(task)}</span>
                    {v && <PlateText plate={v.plate} size="xs" />}
                  </span>
                  {task.kind === 'debt' && task.amountFils ? (
                    <Money fils={task.amountFils} c="red.7" fw={600} />
                  ) : task.kind === 'reminder' ? (
                    <ActionIcon variant="light" color="green" size={34} radius="xl" aria-label={t('reminder.done')} onClick={(e) => (e.stopPropagation(), void done(task))} data-reminder-tick>
                      <IconCheck size={18} stroke={2.6} />
                    </ActionIcon>
                  ) : isCustomer(task) ? (
                    <ActionIcon variant="subtle" color="gray" size={30} radius="xl" aria-label={t('today.notNeeded')} onClick={(e) => (e.stopPropagation(), void dismiss(task))}>
                      <IconX size={16} />
                    </ActionIcon>
                  ) : (
                    <IconChevronRight size={18} color="var(--app-label-3)" aria-hidden />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={IconBell} title={t('today.none')} />
        )}
        {/* A reminder of the manager's own, set where the day's things are seen (v0.74). */}
        <button type="button" className="today-add" onClick={() => setReminder({})} data-today-remind>
          <IconPlus size={18} stroke={2.4} aria-hidden />
          {t('reminder.add')}
        </button>
      </Modal>
      <SheetFor value={reminder}>{(v, o) => <ReminderSheet opened={o} onClose={() => setReminder(null)} reminder={v.r} />}</SheetFor>
      {send && (
        <SendDialog
          customer={send.customer}
          request={send.request}
          onClose={() => setSend(null)}
          onSent={() => void (send.task.kind === 'service' ? markServiceReminded(send.task.vehicleId) : send.task.orderId && markFollowedUp(send.task.orderId))}
        />
      )}
    </>
  );
});
