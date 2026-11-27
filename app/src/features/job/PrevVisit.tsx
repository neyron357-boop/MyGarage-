import { Badge, Button, Text, UnstyledButton } from '@mantine/core';
import { IconArrowBackUpDouble, IconHistory } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { hoursBetween, nowIso } from '../../domain/dates';
import { itemAmounts, itemTitle } from '../../domain/items';
import { formatAed } from '../../domain/money';
import { declinedBefore } from '../../domain/together';
import { formatKm } from '../../domain/odometer';
import type { Order, Settings } from '../../domain/types';
import { addDeclinedBack } from '../../services/estimate';
import { syncStage } from '../../services/flow';
import { mileageOfJob } from '../../services/mileage';
import { haptic } from '../../ui/haptics';
import { forgetSuggestions } from './LineSheet';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';

/**
 * The day a visit was — the day the car came (v0.88, the owner: «какой день физически машина приезжала»): not when the
 * job closed (work continued later, a job opened again and closed — its visit is still the day it came).
 */
const visitDay = (o: Pick<Order, 'arrivedAt' | 'createdAt'>): string => o.arrivedAt ?? o.createdAt;

/** The car's visit before this one, and whether its work is still under the garage's warranty. */
async function previousVisit(order: Pick<Order, 'id' | 'vehicleId' | 'createdAt' | 'arrivedAt'>, lang: 'ru' | 'en') {
  const all = await db.orders.where('vehicleId').equals(order.vehicleId).toArray();
  const prev = all
    .filter((o) => o.id !== order.id && o.stage !== 'cancelled' && o.stage !== 'booked' && visitDay(o) <= visitDay(order))
    .sort((a, b) => visitDay(b).localeCompare(visitDay(a)))[0];
  if (!prev) return null;
  const [items, acts] = await Promise.all([db.items.where('orderId').equals(prev.id).toArray(), db.inspections.where('orderId').equals(prev.id).toArray()]);
  const done = items.filter((i) => i.kind !== 'discount' && i.kind !== 'fee' && (i.approvalState === 'approved' || i.done));
  // Its mileage then (v0.44): the job's own, or its act's or scanner report's.
  return { order: prev, titles: done.map((i) => itemTitle(i, lang)).filter(Boolean), km: mileageOfJob(prev, acts) };
}

/**
 * "Был 12 д назад · 118 200 км · Oil change, Brake pads" on the job's card when the car has been here before — its
 * mileage then (v0.44), the last visit one tap away; within the garage's warranty period the row says so.
 */
export function PrevVisit({ order, settings, lang }: { order: Pick<Order, 'id' | 'vehicleId' | 'createdAt' | 'arrivedAt'>; settings: Pick<Settings, 'warrantyLaborMonths'>; lang: 'ru' | 'en' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const prev = useScreenLiveQuery(() => previousVisit(order, lang), [order.id, order.vehicleId, lang]);
  if (!prev) return null;
  const at = visitDay(prev.order);
  const days = Math.max(0, Math.floor(hoursBetween(at, nowIso()) / 24));
  const ago = days < 1 ? t('job.prevToday') : days < 60 ? t('job.prevDays', { n: days }) : t('job.prevMonths', { n: Math.round(days / 30) });
  const warranty = settings.warrantyLaborMonths > 0 && days <= settings.warrantyLaborMonths * 30.5 && prev.titles.length > 0;
  return (
    <UnstyledButton className="job-line job-complaint" mt="sm" data-route={`/orders/${prev.order.id}`} onClick={() => navigate(`/orders/${prev.order.id}`)} aria-label={t('job.prevVisit')}>
      <IconHistory size={18} stroke={1.8} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
      <Text size="sm" lineClamp={2} style={{ flex: 1 }}>
        {ago}
        {prev.km !== undefined && <Text span inherit className="tnum" style={{ whiteSpace: 'nowrap' }}>{` · ${formatKm(prev.km)} ${t('unit.km')}`}</Text>}
        {prev.titles.length > 0 && <Text span inherit c="dimmed">{` · ${prev.titles.slice(0, 3).join(', ')}`}</Text>}
      </Text>
      {warranty && (
        <Badge color="grape" variant="light" size="md" style={{ flexShrink: 0 }}>
          {t('job.warranty')}
        </Badge>
      )}
    </UnstyledButton>
  );
}

/** The car's earlier visits with their lines — what the customer declined then (audit 27/11). */
async function declinedOnCar(order: Pick<Order, 'id' | 'vehicleId' | 'createdAt' | 'arrivedAt'>, onJob: string[], lang: 'ru' | 'en') {
  const all = await db.orders.where('vehicleId').equals(order.vehicleId).toArray();
  const earlier = all.filter((o) => o.id !== order.id && o.stage !== 'cancelled' && o.stage !== 'booked' && visitDay(o) <= visitDay(order));
  if (!earlier.length) return [];
  const items = await db.items.where('orderId').anyOf(earlier.map((o) => o.id)).toArray();
  const byJob = new Map<string, typeof items>();
  for (const i of items) byJob.set(i.orderId, [...(byJob.get(i.orderId) ?? []), i]);
  return declinedBefore(
    earlier.map((o) => ({ order: { id: o.id, day: visitDay(o).slice(0, 10) }, items: (byJob.get(o.id) ?? []).map((i) => ({ ...i, gross: itemAmounts(i).gross })) })),
    { id: order.id, day: visitDay(order).slice(0, 10) },
    onJob,
    lang,
  );
}

/**
 * "В прошлый раз отказался: FRONT BRAKE DISCS · 380 AED · Добавить" (audit 27/11; docs/01 §10.8): on the car's new visit,
 * what was said no to before and is still not done — one tap puts it on this job as a draft. Only while lines can be added.
 */
export function DeclinedBefore({ orderId, order, onJob, lang }: { orderId: string; order: Pick<Order, 'id' | 'vehicleId' | 'createdAt' | 'arrivedAt'>; onJob: string[]; lang: 'ru' | 'en' }) {
  const { t } = useTranslation();
  const uiLang = useLang();
  const { run, busy } = useAction();
  const list = useScreenLiveQuery(() => declinedOnCar(order, onJob, lang), [order.id, order.vehicleId, lang, onJob.join('|')]);
  if (!list?.length) return null;
  return (
    <div className="job-line job-complaint declined-before" data-declined-before>
      <IconArrowBackUpDouble size={18} stroke={1.8} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" c="dimmed">
          {t('job.declinedBefore')}
        </Text>
        {list.map((d) => (
          <div key={d.itemId} className="declined-before-row">
            <Text size="sm" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
              {d.title}
              {d.gross > 0 && <Text span inherit c="dimmed" className="tnum">{` · ${formatAed(d.gross, uiLang)}`}</Text>}
            </Text>
            <Button
              size="compact-sm"
              variant="light"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await addDeclinedBack(orderId, d.itemId);
                  await syncStage(orderId);
                  forgetSuggestions();
                  haptic('light');
                })
              }
            >
              {t('qa.add')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
