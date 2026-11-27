import { ActionIcon, Modal } from '@mantine/core';
import {
  IconClockPause,
  IconAlarm,
  IconArrowBackUpDouble,
  IconCalendarTime,
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
  IconLicense,
  IconMessageCircle,
  IconPlus,
  IconSend,
  IconShoppingCart,
  IconTruckDelivery,
  IconX,
  type Icon,
} from '@tabler/icons-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate, dubaiTime, formatDate, hoursBetween, shortDuration } from '../../domain/dates';
import { itemTitle } from '../../domain/items';
import { formatKm } from '../../domain/odometer';
import { CUSTOMER_KINDS, type Task, type TaskKind } from '../../domain/today';
import type { Customer, Reminder, Supplier } from '../../domain/types';
import { simpleMessage } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { setBadge } from '../../services/push';
import { doneReminder, openReminders, restoreReminder } from '../../services/reminders';
import { customerMessage, loadPast, tasksFor } from '../../services/today';
import { markCustomerDone, writeAllToday, type TodayMessage } from '../../services/todayBatch';
import { waCan } from '../../services/whatsapp';
import { EmptyState, Money, PlateText, UNDO_MS, undoToast } from '../../ui/components';
import { snooze, unsnooze, useSnoozed, type SnoozeFor } from '../../ui/todaySnooze';
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
  declined: { icon: IconArrowBackUpDouble, color: 'violet' },
  bookedTomorrow: { icon: IconCalendarTime, color: 'indigo' },
  mulkiya: { icon: IconLicense, color: 'teal' },
};
const META = TASK_META;

/**
 * "Today" as a bell (v0.30, the user's call — the strip over the board is gone): a round button in the board's head with
 * how many things there are (red when one is late); a tap — a sheet like the phone's notifications: what needs the
 * manager now across all the cars (domain/today.ts), what is late first, in red. A tap on one opens its job (or the
 * message, for a customer); a customer's reminder not needed — its ×.
 */
type Section = 'now' | 'today' | 'customers';
/** «Сейчас» — late; «Сегодня» — the cars' own things and reminders; «Клиентам» — the calls to customers. */
function sectionsOf(tasks: Task[]): [Section, Task[]][] {
  const by: Record<Section, Task[]> = { now: [], today: [], customers: [] };
  for (const x of tasks) by[x.late ? 'now' : CUSTOMER_KINDS.includes(x.kind) ? 'customers' : 'today'].push(x);
  return (['now', 'today', 'customers'] as const).filter((k) => by[k].length).map((k) => [k, by[k]]);
}

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
  // Put off for a while on this device (v0.99, audit Д25), or taken off a moment ago with «Отменить» still possible (Д24).
  const snoozed = useSnoozed();
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const all = useMemo(() => tasksFor(bundles, past, undefined, reminders), [bundles, past, reminders]);
  const tasks = useMemo(() => all.filter((x) => !snoozed[x.key] && !leaving.has(x.key)), [all, snoozed, leaving]);
  const late = tasks.some((x) => x.late);
  // The number on the bell and the app's icon (v0.99, audit Д26): what is late and the cars' own things — not the calls to
  // customers («Как машина?», «Пора на ТО»), which kept it above zero always, so the eye stopped seeing it.
  const counted = tasks.filter((x) => x.late || !CUSTOMER_KINDS.includes(x.kind)).length;
  useEffect(() => setBadge(counted), [counted]);
  const [snoozing, setSnoozing] = useState<Task | null>(null);

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
        return task.kmNow ? t('today.serviceKm', { km: formatKm(task.kmNow) }) : t('today.service');
      case 'booked':
        return t(task.late ? 'today.bookedLate' : 'today.booked', { time: dubaiTime(task.at) });
      case 'reminder':
        return task.text ?? t('reminder.title');
      case 'declined':
        return t('today.declined');
      case 'bookedTomorrow':
        return t('today.bookedTomorrow', { time: dubaiTime(byOrder.get(task.orderId ?? '')?.order.bookedFor ?? task.at) });
      case 'mulkiya':
        return t('today.mulkiya', { date: formatDate(task.expires) });
    }
  };

  /**
   * The customer's message, ready: "how is the car?" (with the review link to everyone, audit 27/11 — Google forbids
   * asking only the happy ones), "time for a service", the lines declined last time, tomorrow's booking.
   */
  const prepare = (task: Task): { customer: Customer; request: SendRequest } | undefined => {
    const customer = customerOf(task);
    const vehicle = vehicleOf(task);
    const was = past?.past.find((p) => p.order.id === task.orderId);
    const order = byOrder.get(task.orderId ?? '')?.order ?? was?.order;
    if (!customer || !vehicle || !order) return undefined;
    const settings = bundles[0]?.settings;
    const ctx = { customer, vehicle, order: order as never, garageName: settings?.name ?? '' };
    const docLang = customer.docLanguage;
    const msg = customerMessage(task, docLang, settings?.googleMapsUrl, was?.items ?? [], byOrder.get(task.orderId ?? '')?.order.bookedFor);
    return { customer, request: { text: simpleMessage(msg.tpl, ctx, docLang, msg.vars), template: msg.tpl, lang: docLang, orderId: task.orderId } };
  };
  const write = (task: Task) => {
    const ready = prepare(task);
    if (ready) setSend({ task, ...ready });
  };
  /** Sent, or not needed: the customer's thing leaves «Сегодня». */
  const markDone = (task: Task) => markCustomerDone(task);
  /**
   * The morning's customer messages in one go (audit 27/11): each ready message — to «Проверить и отправить», all of
   * them together; what went leaves the list there.
   */
  const batch: TodayMessage[] = waCan()
    ? tasks.filter((task) => CUSTOMER_KINDS.includes(task.kind)).flatMap((task) => {
        const ready = prepare(task);
        const phone = ready?.customer.whatsapp || ready?.customer.phone;
        if (!ready || !phone) return [];
        const v = vehicleOf(task);
        return [{ task, phone, text: ready.request.text, template: ready.request.template, lang: ready.request.lang, title: [ready.customer.name || ready.customer.companyName, [v?.make, v?.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') }];
      })
    : [];
  const writeAll = () =>
    run(async () => {
      await writeAllToday(batch, dubaiDate());
      setOpen(false);
    });
  // «Не нужно» with «Отменить» (v0.99, audit Д24): out of the list at once, written after the toast is gone.
  const dismiss = (task: Task) => {
    haptic('light');
    setLeaving((s) => new Set(s).add(task.key));
    const timer = window.setTimeout(() => void run(() => markDone(task)), UNDO_MS);
    undoToast(t('today.dismissed'), t('common.undo'), () => {
      window.clearTimeout(timer);
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(task.key);
        return n;
      });
    });
  };
  const putOff = (task: Task, how: SnoozeFor) => {
    snooze(task.key, how);
    setSnoozing(null);
    haptic('light');
    undoToast(t(`today.snoozed.${how}`), t('common.undo'), () => unsnooze(task.key));
  };
  const isCustomer = (task: Task) => CUSTOMER_KINDS.includes(task.kind);
  const whoOf = (task: Task) => {
    const c = customerOf(task);
    return c ? (c.type === 'company' && c.companyName) || c.name : '';
  };
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
            {/* v0.99 (audit Д22): what is late first, then the cars' things, then the customers' — and «Написать всем» heads them. */}
            {sectionsOf(tasks).flatMap(([section, list]) => [
              <div key={`h-${section}`} className="group-title today-section" data-today-section={section}>
                {t(`today.section.${section}`)} <span className="count">{list.length}</span>
              </div>,
              ...(section === 'customers' && batch.length > 1
                ? [
                    <button key="batch" type="button" className="today-add today-batch" onClick={writeAll} data-today-batch>
                      <IconSend size={18} stroke={2.2} aria-hidden />
                      {t('today.writeAll', { n: batch.length })}
                    </button>,
                  ]
                : []),
              ...list.map((task) => {
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
                    {/* Which car and whose (v0.99, audit Д20): a plate alone had to be remembered. */}
                    {v && (
                      <span className="today-note-sub">
                        <PlateText plate={v.plate} size="xs" />
                        <span className="today-note-who">{[[v.make, v.model].filter(Boolean).join(' '), whoOf(task)].filter(Boolean).join(' · ')}</span>
                      </span>
                    )}
                  </span>
                  {task.kind !== 'reminder' && !isCustomer(task) && (
                    <ActionIcon variant="subtle" color="gray" size={34} radius="xl" aria-label={t('today.snooze')} onClick={(e) => (e.stopPropagation(), setSnoozing(task))} data-today-snooze>
                      <IconClockPause size={18} />
                    </ActionIcon>
                  )}
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
              }),
            ])}
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
      <SheetFor value={snoozing}>
        {(task, o) => (
          <Modal opened={o} onClose={() => setSnoozing(null)} title={t('today.snooze')}>
            <div className="chip-row wrap" data-today-snooze-sheet>
              {(['hour', 'evening', 'tomorrow'] as const).map((how) => (
                <button key={how} type="button" className="chip" onClick={() => putOff(task, how)} data-snooze={how}>
                  {t(`today.snoozeFor.${how}`)}
                </button>
              ))}
            </div>
          </Modal>
        )}
      </SheetFor>
      {send && (
        <SendDialog
          customer={send.customer}
          request={send.request}
          onClose={() => setSend(null)}
          onSent={() => void markDone(send.task)}
        />
      )}
    </>
  );
});
