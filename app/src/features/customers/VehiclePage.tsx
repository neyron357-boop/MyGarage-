import { Button, Card, Group, Select, Stack, Text, Title } from '@mantine/core';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDate } from '../../domain/dates';
import { itemTitle } from '../../domain/items';
import { formatPlate } from '../../domain/plates';
import { changeVehicleOwner } from '../../services/customers';
import { PageHeader, StageBadge } from '../../ui/components';
import { useAction, useLang } from '../../ui/hooks';
import { VehicleModal } from './forms';

export function VehiclePage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run } = useAction();
  const [edit, setEdit] = useState(false);
  const [ownerPick, setOwnerPick] = useState<string | null>(null);
  const data = useLiveQuery(async () => {
    const v = await db.vehicles.get(id!);
    if (!v) return undefined;
    const [owner, orders, owners, customers] = await Promise.all([
      db.customers.get(v.customerId),
      db.orders.where('vehicleId').equals(v.id).reverse().sortBy('createdAt'),
      db.ownerships.where('vehicleId').equals(v.id).toArray(),
      db.customers.toArray(),
    ]);
    const orderIds = orders.map((o) => o.id);
    const declined = (await db.items.where('orderId').anyOf(orderIds).toArray()).filter((i) => i.approvalState === 'declined');
    const mileage = (await db.inspections.where('orderId').anyOf(orderIds).toArray()).filter((i) => i.mileageKm !== undefined && i.locked);
    return { v, owner, orders, owners, customers, declined, mileage };
  }, [id]);
  if (!data) return null;
  const { v, owner, orders, owners, customers, declined, mileage } = data;
  return (
    <>
      <PageHeader
        title={`${v.make} ${v.model} ${v.year ?? ''}`}
        subtitle={formatPlate(v.plate, lang) + (v.vin ? ` · VIN ${v.vin}` : '')}
        back
        right={<Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEdit(true)}>{t('common.edit')}</Button>}
      />
      <Group mb="md">
        <Button leftSection={<IconPlus size={18} />} onClick={() => navigate(`/orders/new?vehicleId=${v.id}`)}>{t('nav.newOrder')}</Button>
        {owner && <Button variant="light" onClick={() => navigate(`/customers/${owner.id}`)}>{owner.name}</Button>}
      </Group>
      {declined.length > 0 && (
        <Card withBorder mb="md" bg="var(--mantine-color-yellow-light)">
          <Title order={6} mb={4}>{t('vehicle.declinedRecs')}</Title>
          {declined.map((i) => <Text key={i.id} size="sm">• {itemTitle(i, lang)} ({formatDate(i.createdAt)})</Text>)}
        </Card>
      )}
      {mileage.length > 0 && (
        <Text size="sm" c="dimmed" mb="md">
          {t('vehicle.mileageHistory')}: {mileage.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((m) => `${formatDate(m.createdAt)} — ${m.mileageKm} km`).join(' · ')}
        </Text>
      )}
      <Title order={5} mb="xs">{t('customer.orders')}</Title>
      <Stack gap="xs" mb="md">
        {orders.map((o) => (
          <Card key={o.id} withBorder padding="sm" className="tap-card" onClick={() => navigate(`/orders/${o.id}`)}>
            <Group justify="space-between">
              <Text size="sm">№{o.number} · {formatDate(o.createdAt)} · {o.complaint}</Text>
              <StageBadge stage={o.stage} />
            </Group>
          </Card>
        ))}
      </Stack>
      <Title order={5} mb="xs">{t('vehicle.owners')}</Title>
      {owners.map((o) => (
        <Text key={o.id} size="sm">{customers.find((c) => c.id === o.customerId)?.name} · {formatDate(o.from)} – {o.to ? formatDate(o.to) : t('vehicle.now')}</Text>
      ))}
      <Group mt="sm" align="flex-end">
        <Select label={t('vehicle.changeOwner')} data={customers.filter((c) => c.id !== v.customerId).map((c) => ({ value: c.id, label: c.name }))} value={ownerPick} onChange={setOwnerPick} searchable w={260} />
        <Button variant="default" disabled={!ownerPick} onClick={() => ownerPick && run(() => changeVehicleOwner(v.id, ownerPick), 'common.saved')}>{t('common.save')}</Button>
      </Group>
      <VehicleModal opened={edit} onClose={() => setEdit(false)} vehicle={v} />
    </>
  );
}
