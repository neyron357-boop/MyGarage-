import { Badge, Text, UnstyledButton } from '@mantine/core';
import { IconHistory } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { hoursBetween, nowIso } from '../../domain/dates';
import { itemTitle } from '../../domain/items';
import type { Order, Settings } from '../../domain/types';

/** The car's visit before this one, and whether its work is still under the garage's warranty. */
async function previousVisit(order: Pick<Order, 'id' | 'vehicleId' | 'createdAt'>, lang: 'ru' | 'en') {
  const all = await db.orders.where('vehicleId').equals(order.vehicleId).toArray();
  const prev = all
    .filter((o) => o.id !== order.id && o.stage !== 'cancelled' && (o.closedAt ?? o.createdAt) <= order.createdAt)
    .sort((a, b) => (b.closedAt ?? b.createdAt).localeCompare(a.closedAt ?? a.createdAt))[0];
  if (!prev) return null;
  const items = await db.items.where('orderId').equals(prev.id).toArray();
  const done = items.filter((i) => i.kind !== 'discount' && i.kind !== 'fee' && (i.approvalState === 'approved' || i.done));
  return { order: prev, titles: done.map((i) => itemTitle(i, lang)).filter(Boolean) };
}

/**
 * "Был 12 д назад · Oil change, Brake pads" on the job's card when the car has been here before — the
 * last visit one tap away; within the garage's warranty period the row says so.
 */
export function PrevVisit({ order, settings, lang }: { order: Pick<Order, 'id' | 'vehicleId' | 'createdAt'>; settings: Pick<Settings, 'warrantyLaborMonths'>; lang: 'ru' | 'en' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const prev = useLiveQuery(() => previousVisit(order, lang), [order.id, order.vehicleId, lang]);
  if (!prev) return null;
  const at = prev.order.closedAt ?? prev.order.deliveredAt ?? prev.order.createdAt;
  const days = Math.max(0, Math.floor(hoursBetween(at, nowIso()) / 24));
  const ago = days < 1 ? t('job.prevToday') : days < 60 ? t('job.prevDays', { n: days }) : t('job.prevMonths', { n: Math.round(days / 30) });
  const warranty = settings.warrantyLaborMonths > 0 && days <= settings.warrantyLaborMonths * 30.5 && prev.titles.length > 0;
  return (
    <UnstyledButton className="job-line job-complaint" mt="sm" onClick={() => navigate(`/orders/${prev.order.id}`)} aria-label={t('job.prevVisit')}>
      <IconHistory size={18} stroke={1.8} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
      <Text size="sm" lineClamp={2} style={{ flex: 1 }}>
        {ago}
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
