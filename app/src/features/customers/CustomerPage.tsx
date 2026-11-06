import { Badge, Button, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconBrandWhatsapp, IconPencil, IconPhone, IconPlus } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDate } from '../../domain/dates';
import { formatPhone } from '../../domain/phone';
import { whatsappUrl } from '../../services/messages';
import { loadOrderBundle, bundleAmountDue } from '../../services/orders';
import { Money, PageHeader, PlateText, StageBadge } from '../../ui/components';
import { CustomerModal, VehicleModal } from './forms';

export function CustomerPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [addCar, setAddCar] = useState(false);
  const data = useLiveQuery(async () => {
    const c = await db.customers.get(id!);
    if (!c) return undefined;
    const [cars, orders] = await Promise.all([db.vehicles.where('customerId').equals(c.id).toArray(), db.orders.where('customerId').equals(c.id).reverse().sortBy('createdAt')]);
    const bundles = await Promise.all(orders.map((o) => loadOrderBundle(o.id)));
    const debt = bundles.reduce((s, b) => s + (b && ['delivered', 'closed'].includes(b.order.stage) ? Math.max(0, bundleAmountDue(b)) : 0), 0);
    return { c, cars, orders, debt };
  }, [id]);
  if (!data) return null;
  const { c, cars, orders, debt } = data;
  return (
    <>
      <PageHeader
        title={c.type === 'company' && c.companyName ? c.companyName : c.name}
        subtitle={`${formatPhone(c.phone)} · ${t(`lang.${c.docLanguage}`)}`}
        back
        right={<Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEdit(true)}>{t('common.edit')}</Button>}
      />
      <Group mb="md">
        <Button component="a" href={whatsappUrl(c.whatsapp || c.phone, '')} target="_blank" color="green" leftSection={<IconBrandWhatsapp size={18} />}>WhatsApp</Button>
        <Button component="a" href={`tel:${c.phone}`} variant="default" leftSection={<IconPhone size={18} />}>{t('customer.call')}</Button>
        {debt > 0 && <Badge color="red" size="lg">{t('flags.debt')}: <Money fils={debt} /></Badge>}
      </Group>
      {c.notes && <Text mb="md" c="dimmed">{c.notes}</Text>}
      {c.trn && <Text mb="md" size="sm">TRN: {c.trn}</Text>}
      <Group justify="space-between" mb="xs">
        <Title order={5}>{t('customer.vehicles')}</Title>
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setAddCar(true)}>{t('vehicle.new')}</Button>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} mb="md">
        {cars.map((v) => (
          <Card key={v.id} withBorder padding="sm" className="tap-card" onClick={() => navigate(`/vehicles/${v.id}`)}>
            <Group gap="xs"><PlateText plate={v.plate} /><Text fw={600}>{v.make} {v.model} {v.year ?? ''}</Text></Group>
          </Card>
        ))}
      </SimpleGrid>
      <Title order={5} mb="xs">{t('customer.orders')}</Title>
      <Stack gap="xs">
        {orders.map((o) => (
          <Card key={o.id} withBorder padding="sm" className="tap-card" onClick={() => navigate(`/orders/${o.id}`)}>
            <Group justify="space-between">
              <Text size="sm">№{o.number} · {formatDate(o.createdAt)} · {o.complaint}</Text>
              <StageBadge stage={o.stage} />
            </Group>
          </Card>
        ))}
      </Stack>
      <CustomerModal opened={edit} onClose={() => setEdit(false)} customer={c} />
      <VehicleModal opened={addCar} onClose={() => setAddCar(false)} customerId={c.id} />
    </>
  );
}
