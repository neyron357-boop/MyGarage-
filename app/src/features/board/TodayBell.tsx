import { ActionIcon, Modal } from '@mantine/core';
import {
  IconArrowBackUp,
  IconBell,
  IconBuildingFactory2,
  IconCash,
  IconChevronRight,
  IconClock,
  IconDroplet,
  IconHourglassHigh,
  IconKey,
  IconMessageCircle,
  IconShoppingCart,
  IconTag,
  IconTruckDelivery,
  IconX,
  type Icon,
} from '@tabler/icons-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDate, hoursBetween, shortDuration } from '../../domain/dates';
import { itemTitle } from '../../domain/items';
import type { Task, TaskKind } from '../../domain/today';
import type { Customer, Supplier } from '../../domain/types';
import { simpleMessage } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { loadPast, markFollowedUp, markServiceReminded, tasksFor } from '../../services/today';
import { EmptyState, Money, PlateText } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { useAutoAnimate } from '../../ui/motion';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { useDueLabel } from '../job/Due';

const NONE: Supplier[] = [];

const META: Record<TaskKind, { icon: Icon; color: string }> = {
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
};

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
  // Every past job of the last year: read again only once the board is back (not during the way back).
  const past = useScreenLiveQuery(() => loadPast(), [bundles.length], 600);
  const suppliers = useScreenLiveQuery(() => db.suppliers.toArray(), [], 600) ?? NONE;
  const [send, setSend] = useState<{ request: SendRequest; customer: Customer; task: Task } | null>(null);
  const list = useAutoAnimate<HTMLDivElement>();
  const tasks = useMemo(() => tasksFor(bundles, past), [bundles, past]);
  const late = tasks.some((x) => x.late);

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
  const go = (task: Task) => {
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
                    <Money fils={task.amountFils} c="red.7" fw={650} />
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
      </Modal>
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
