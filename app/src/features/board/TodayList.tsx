import { ActionIcon, Text, ThemeIcon } from '@mantine/core';
import {
  IconArrowBackUp,
  IconBuildingFactory2,
  IconCash,
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
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDate, hoursBetween, shortDuration } from '../../domain/dates';
import { itemTitle } from '../../domain/items';
import type { Task, TaskKind } from '../../domain/today';
import type { Customer } from '../../domain/types';
import { simpleMessage } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { loadPast, markFollowedUp, markServiceReminded, tasksFor } from '../../services/today';
import { List, ListRow, Money, PlateText } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { useDueLabel } from '../job/Due';

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
 * "Today" on top of the board: what needs the manager now across all the cars, one short line each —
 * promised for 18:00, no answer for 3 h, parts to order or collect, a part to return by Friday, work
 * outside due back, a car not collected, an overdue debt, and the customers to write to. A tap opens
 * the job (or the message, for a customer). Three show; the rest behind "More".
 */
export function TodayList({ bundles, limit = 3 }: { bundles: OrderBundle[]; limit?: number }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run } = useAction();
  const dueLabel = useDueLabel();
  const past = useLiveQuery(() => loadPast(), [bundles.length]);
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), []) ?? [];
  const [all, setAll] = useState(false);
  const [send, setSend] = useState<{ request: SendRequest; customer: Customer; task: Task } | null>(null);
  const tasks = tasksFor(bundles, past);
  if (!tasks.length) return null;

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

  const shown = all ? tasks : tasks.slice(0, limit);
  return (
    <div className="today" aria-label={t('today.title')}>
      <div className="group-title">
        {t('today.title')} · {tasks.length}
      </div>
      <List>
        {shown.map((task) => {
          const m = META[task.kind];
          const v = vehicleOf(task);
          const customer = task.kind === 'followUp' || task.kind === 'service';
          return (
            <ListRow
              key={task.key}
              left={
                <ThemeIcon variant="light" color={task.late ? 'red' : m.color} size={36} radius="xl" style={{ flexShrink: 0 }}>
                  <m.icon size={19} stroke={1.9} />
                </ThemeIcon>
              }
              title={
                <Text span inherit c={task.late ? 'red.7' : undefined}>
                  {text(task)}
                </Text>
              }
              subtitle={v ? <PlateText plate={v.plate} size="xs" /> : undefined}
              right={
                task.kind === 'debt' && task.amountFils ? (
                  <Money fils={task.amountFils} c="red.7" />
                ) : customer ? (
                  <ActionIcon variant="subtle" color="gray" size={36} radius="xl" aria-label={t('today.notNeeded')} onClick={(e) => (e.stopPropagation(), void dismiss(task))}>
                    <IconX size={18} />
                  </ActionIcon>
                ) : undefined
              }
              chevron={!customer && task.kind !== 'debt'}
              onClick={() => (customer ? write(task) : task.kind === 'pickup' ? navigate('/parts?tab=pickup') : task.orderId && navigate(`/orders/${task.orderId}`))}
            />
          );
        })}
        {tasks.length > limit && (
          <ListRow
            title={
              <Text span inherit c="cobalt.6">
                {all ? t('today.less') : t('today.more', { n: tasks.length - limit })}
              </Text>
            }
            onClick={() => setAll((a) => !a)}
          />
        )}
      </List>
      {send && (
        <SendDialog
          customer={send.customer}
          request={send.request}
          onClose={() => setSend(null)}
          onSent={() => void (send.task.kind === 'service' ? markServiceReminded(send.task.vehicleId) : send.task.orderId && markFollowedUp(send.task.orderId))}
        />
      )}
    </div>
  );
}
