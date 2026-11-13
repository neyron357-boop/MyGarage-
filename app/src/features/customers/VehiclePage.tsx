import { Alert, Box, Button, Group, Select, SimpleGrid, Stack, Text, Timeline } from '@mantine/core';
import { IconAlertTriangle, IconGauge, IconPencil, IconPlus, IconUser } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDate } from '../../domain/dates';
import { itemAmounts, itemTitle } from '../../domain/items';
import { changeVehicleOwner } from '../../services/customers';
import { EmptyState, Field, Kpi, List, ListRow, Money, PageHeader, PageSkeleton, PlateText, Section } from '../../ui/components';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { VehicleModal } from './forms';
import { OrderStatus } from '../job/phase';
import { LinkedMoney } from '../money/MoneyEntry';

export function VehiclePage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run } = useAction();
  const [edit, setEdit] = useState(false);
  const [ownerPick, setOwnerPick] = useState<string | null>(null);
  const data = useScreenLiveQuery(async () => {
    const v = await db.vehicles.get(id!);
    if (!v) return null;
    const [owner, orders, owners, customers] = await Promise.all([
      db.customers.get(v.customerId),
      db.orders.where('vehicleId').equals(v.id).reverse().sortBy('createdAt'),
      db.ownerships.where('vehicleId').equals(v.id).toArray(),
      db.customers.toArray(),
    ]);
    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length ? await db.items.where('orderId').anyOf(orderIds).toArray() : [];
    const declined = items.filter((i) => i.approvalState === 'declined');
    const decisions = orderIds.length ? await db.decisions.where('orderId').anyOf(orderIds).toArray() : [];
    const mileage = (orderIds.length ? await db.inspections.where('orderId').anyOf(orderIds).toArray() : []).filter((i) => i.mileageKm !== undefined && i.locked).sort((a, c) => (a.signedAt ?? '').localeCompare(c.signedAt ?? ''));
    return { v, owner, orders, owners, customers, declined, decisions, mileage };
  }, [id]);
  if (data === undefined) return <PageSkeleton variant="detail" />;
  if (data === null) return <EmptyState title={t('err.notFound')} />;
  const { v, owner, orders, owners, customers, declined, decisions, mileage } = data;
  const lastKm = mileage[mileage.length - 1]?.mileageKm;
  const declinedAt = (itemId: string) => decisions.filter((d) => d.itemId === itemId && d.decision === 'decline').pop()?.decidedAt;
  return (
    <>
      <PageHeader
        back
        eyebrow={t('vehicle.card')}
        title={`${v.make} ${v.model}${v.year ? ` ${v.year}` : ''}`}
        right={
          <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEdit(true)}>
            {t('common.edit')}
          </Button>
        }
      />
      <Box className="surface" p="md">
        <Group justify="space-between" align="flex-start">
          <PlateText plate={v.plate} size="lg" />
          <Button leftSection={<IconPlus size={18} />} onClick={() => navigate(`/orders/new?vehicleId=${v.id}`)}>
            {t('search.newJob')}
          </Button>
        </Group>
        <SimpleGrid cols={{ base: 2, sm: 4 }} mt="md" spacing="md">
          <Field label="VIN">
            <Text span ff="monospace" size="sm">
              {v.vin || '—'}
            </Text>
          </Field>
          <Field label={t('vehicle.engine')}>{v.engine || '—'}</Field>
          <Field label={t('vehicle.color')}>{v.color || '—'}</Field>
          <Field label={t('vehicle.owner')}>
            {owner ? (
              <Text span size="sm" fw={600} c="cobalt.6" style={{ cursor: 'pointer' }} onClick={() => navigate(`/customers/${owner.id}`)}>
                {owner.name}
              </Text>
            ) : (
              '—'
            )}
          </Field>
        </SimpleGrid>
      </Box>
      <SimpleGrid cols={2} spacing="sm" mt="md">
        <Kpi label={t('customer.visitsTitle')} value={orders.length} />
        <Kpi label={t('vehicle.lastMileage')} value={lastKm !== undefined ? `${lastKm.toLocaleString('ru-RU')} ${t('unit.km')}` : '—'} />
      </SimpleGrid>
      {declined.length > 0 && (
        <Section title={t('vehicle.declinedRecs')} description={t('vehicle.declinedHint')}>
          <Alert color="orange" icon={<IconAlertTriangle size={18} />} p="sm">
            <Stack gap={6}>
              {declined.map((i) => (
                <Group key={i.id} justify="space-between" wrap="nowrap">
                  <Text size="sm">{itemTitle(i, lang)}</Text>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                    <Money fils={itemAmounts(i).gross} /> · {formatDate(declinedAt(i.id) ?? i.createdAt)}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Alert>
        </Section>
      )}
      <Section title={t('customer.orders')}>
        {orders.length === 0 ? (
          <EmptyState>{t('customer.noOrders')}</EmptyState>
        ) : (
          <List>
            {orders.map((o) => (
              <ListRow key={o.id} onClick={() => navigate(`/orders/${o.id}`)} chevron title={`№${o.number} · ${formatDate(o.createdAt)}`} subtitle={o.complaint || undefined} right={<OrderStatus orderId={o.id} stage={o.stage} />} />
            ))}
          </List>
        )}
      </Section>
      <Box mt="lg">
        <LinkedMoney link={{ vehicleId: v.id, customerId: v.customerId }} by="vehicleId" />
      </Box>
      {mileage.length > 0 && (
        <Section title={t('vehicle.mileageHistory')}>
          <Box className="surface" p="md">
            <Timeline bulletSize={22} lineWidth={2} active={mileage.length}>
              {mileage.map((m) => (
                <Timeline.Item key={m.id} bullet={<IconGauge size={12} />} title={`${m.mileageKm?.toLocaleString('ru-RU')} ${t('unit.km')}`}>
                  <Text size="xs" c="dimmed">
                    {formatDate(m.signedAt)} · {t(m.kind === 'intake' ? 'intake.title' : 'handover.title')}
                  </Text>
                </Timeline.Item>
              ))}
            </Timeline>
          </Box>
        </Section>
      )}
      <Section title={t('vehicle.owners')}>
        <Box className="surface" p="md">
          <Stack gap={6}>
            {owners.map((o) => (
              <Group key={o.id} gap="xs" wrap="nowrap">
                <IconUser size={16} color="var(--mantine-color-dimmed)" />
                <Text size="sm">
                  {customers.find((c) => c.id === o.customerId)?.name} · {formatDate(o.from)} – {o.to ? formatDate(o.to) : t('vehicle.now')}
                </Text>
              </Group>
            ))}
          </Stack>
          <Group mt="md" align="flex-end" wrap="nowrap">
            <Select
              style={{ flex: 1 }}
              label={t('vehicle.changeOwner')}
              placeholder={t('vehicle.pickOwner')}
              data={customers.filter((c) => c.id !== v.customerId).map((c) => ({ value: c.id, label: c.name }))}
              value={ownerPick}
              onChange={setOwnerPick}
              searchable
            />
            <Button variant="default" disabled={!ownerPick} onClick={() => ownerPick && run(() => changeVehicleOwner(v.id, ownerPick), 'common.saved')}>
              {t('common.save')}
            </Button>
          </Group>
        </Box>
      </Section>
      <VehicleModal opened={edit} onClose={() => setEdit(false)} vehicle={v} />
    </>
  );
}
