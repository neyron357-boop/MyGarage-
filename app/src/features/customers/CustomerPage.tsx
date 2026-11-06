import { Alert, Avatar, Badge, Box, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCar, IconNote, IconPencil, IconPlus } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDate } from '../../domain/dates';
import { activeInvoice } from '../../domain/invoice';
import { formatPhone } from '../../domain/phone';
import { bundleAmountDue, loadOrderBundle } from '../../services/orders';
import { ContactButtons, EmptyState, Field, Kpi, List, ListRow, Money, PageHeader, PlateText, Section, StageBadge } from '../../ui/components';
import { initials } from './CustomersPage';
import { CustomerModal, VehicleModal } from './forms';

export function CustomerPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [addCar, setAddCar] = useState(false);
  const data = useLiveQuery(async () => {
    const c = await db.customers.get(id!);
    if (!c) return null;
    const [cars, orders] = await Promise.all([db.vehicles.where('customerId').equals(c.id).toArray(), db.orders.where('customerId').equals(c.id).reverse().sortBy('createdAt')]);
    const bundles = (await Promise.all(orders.map((o) => loadOrderBundle(o.id)))).filter(Boolean);
    let debt = 0;
    let spent = 0;
    for (const b of bundles) {
      if (!b) continue;
      if (['delivered', 'closed'].includes(b.order.stage)) debt += Math.max(0, bundleAmountDue(b));
      spent += activeInvoice(b.invoices)?.totalFils ?? 0;
    }
    return { c, cars, orders, debt, spent, vehicles: new Map(cars.map((v) => [v.id, v])) };
  }, [id]);
  if (data === undefined) return null;
  if (data === null) return <EmptyState title={t('err.notFound')} />;
  const { c, cars, orders, debt, spent, vehicles } = data;
  const displayName = c.type === 'company' && c.companyName ? c.companyName : c.name;
  return (
    <>
      <PageHeader
        back
        eyebrow={t(c.type === 'company' ? 'customer.company' : 'customer.individual')}
        title={displayName}
        right={
          <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEdit(true)}>
            {t('common.edit')}
          </Button>
        }
      />
      <Box className="surface" p="md">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <Avatar color={c.type === 'company' ? 'grape' : 'cobalt'} radius="xl" size={52}>
              {initials(displayName)}
            </Avatar>
            <Box style={{ minWidth: 0 }}>
              <Text fw={700} size="lg" lineClamp={2} lh={1.25}>
                {displayName}
              </Text>
              <Text size="sm" c="dimmed" className="tnum">
                {formatPhone(c.phone)}
              </Text>
            </Box>
          </Group>
          <ContactButtons phone={c.phone} whatsapp={c.whatsapp} />
        </Group>
        <SimpleGrid cols={{ base: 2, sm: 4 }} mt="md" spacing="md">
          <Field label={t('customer.docLanguage')}>{t(`lang.${c.docLanguage}`)}</Field>
          <Field label={t('customer.channel')}>{c.preferredChannel === 'call' ? t('customer.call') : c.preferredChannel === 'telegram' ? 'Telegram' : 'WhatsApp'}</Field>
          <Field label={t('customer.source')}>{c.source ? t(`source.${c.source}`) : '—'}</Field>
          <Field label="TRN">{c.trn || '—'}</Field>
        </SimpleGrid>
        {c.type === 'company' && c.companyName && (
          <Text size="sm" c="dimmed" mt="sm">
            {t('customer.contact')}: {c.name}
            {c.address ? ` · ${c.address}` : ''}
          </Text>
        )}
      </Box>
      {c.notes && (
        <Alert mt="md" color="yellow" icon={<IconNote size={18} />}>
          {c.notes}
        </Alert>
      )}
      <SimpleGrid cols={3} spacing="sm" mt="md">
        <Kpi label={t('customer.visits')} value={orders.length} />
        <Kpi label={t('customer.spent')} value={<Money fils={spent} display />} />
        <Kpi label={t('flags.debt')} value={<Money fils={debt} display />} color={debt ? 'red' : undefined} />
      </SimpleGrid>
      <Section
        title={t('customer.vehicles')}
        action={
          <Button size="compact-sm" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setAddCar(true)}>
            {t('vehicle.new')}
          </Button>
        }
      >
        {cars.length === 0 ? (
          <EmptyState icon={IconCar}>{t('customer.noCars')}</EmptyState>
        ) : (
          <List>
            {cars.map((v) => (
              <ListRow
                key={v.id}
                onClick={() => navigate(`/vehicles/${v.id}`)}
                chevron
                left={<PlateText plate={v.plate} size="sm" />}
                title={`${v.make} ${v.model}${v.year ? ` ${v.year}` : ''}`}
                subtitle={v.vin ? `VIN ${v.vin}` : undefined}
                right={
                  <Button
                    visibleFrom="xs"
                    size="compact-sm"
                    variant="light"
                    style={{ flexShrink: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/orders/new?vehicleId=${v.id}`);
                    }}
                  >
                    {t('search.newJob')}
                  </Button>
                }
              />
            ))}
          </List>
        )}
      </Section>
      <Section title={t('customer.orders')}>
        {orders.length === 0 ? (
          <EmptyState>{t('customer.noOrders')}</EmptyState>
        ) : (
          <List>
            {orders.map((o) => {
              const v = vehicles.get(o.vehicleId);
              return (
                <ListRow
                  key={o.id}
                  onClick={() => navigate(`/orders/${o.id}`)}
                  chevron
                  title={
                    <>
                      №{o.number} · {v ? `${v.make} ${v.model}` : ''}
                    </>
                  }
                  subtitle={
                    <Stack gap={4}>
                      <span>
                        {formatDate(o.createdAt)}
                        {o.complaint ? ` · ${o.complaint}` : ''}
                      </span>
                      <Group gap={6}>
                        <StageBadge stage={o.stage} size="sm" />
                        {o.warrantyOfOrderId && <Badge color="grape" size="sm">{t('flags.warranty')}</Badge>}
                      </Group>
                    </Stack>
                  }
                />
              );
            })}
          </List>
        )}
      </Section>
      <CustomerModal opened={edit} onClose={() => setEdit(false)} customer={c} />
      <VehicleModal opened={addCar} onClose={() => setAddCar(false)} customerId={c.id} />
    </>
  );
}
