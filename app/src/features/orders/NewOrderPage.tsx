import { Button, Card, Divider, Group, Paper, SegmentedControl, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import type { Customer, Vehicle } from '../../domain/types';
import { createCustomer, createVehicle, type CustomerInput, type VehicleInput } from '../../services/customers';
import { createOrder } from '../../services/orders';
import { PageHeader, PlateText } from '../../ui/components';
import { useAction } from '../../ui/hooks';
import { CustomerFields, EMPTY_CUSTOMER, EMPTY_VEHICLE, VehicleFields } from '../customers/forms';
import { HitCard, useSearch } from '../search/SearchPage';

export function NewOrderPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { run, busy } = useAction();
  const [q, setQ] = useState('');
  const hits = useSearch(q);
  const [customer, setCustomer] = useState<Customer>();
  const [vehicle, setVehicle] = useState<Vehicle>();
  const [mode, setMode] = useState<'find' | 'new'>('find');
  const [newC, setNewC] = useState<CustomerInput>(EMPTY_CUSTOMER);
  const [newV, setNewV] = useState<VehicleInput>(EMPTY_VEHICLE);
  const [complaint, setComplaint] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [bookedFor, setBookedFor] = useState('');

  const preVehicle = useLiveQuery(async () => {
    const id = params.get('vehicleId');
    if (!id) return undefined;
    const v = await db.vehicles.get(id);
    const c = v ? await db.customers.get(v.customerId) : undefined;
    return v && c ? { v, c } : undefined;
  }, [params]);
  useEffect(() => {
    if (preVehicle) {
      setVehicle(preVehicle.v);
      setCustomer(preVehicle.c);
    }
  }, [preVehicle]);

  const createNew = () =>
    run(async () => {
      const c = await createCustomer(newC);
      const v = await createVehicle(c.id, newV);
      setCustomer(c);
      setVehicle(v);
    });

  const addVehicleToCustomer = () =>
    run(async () => {
      if (!customer) return;
      setVehicle(await createVehicle(customer.id, newV));
    });

  const submit = () =>
    run(async () => {
      if (!customer || !vehicle) return;
      const o = await createOrder({
        customerId: customer.id,
        vehicleId: vehicle.id,
        complaint,
        arrivedNow: when === 'now',
        bookedFor: when === 'later' && bookedFor ? new Date(bookedFor).toISOString() : undefined,
      });
      navigate(when === 'now' ? `/orders/${o.id}/intake` : `/orders/${o.id}`, { replace: true });
    });

  return (
    <>
      <PageHeader title={t('newOrder.title')} back />
      {!customer || !vehicle ? (
        <Stack>
          {!customer && (
            <SegmentedControl
              fullWidth
              value={mode}
              onChange={(v) => setMode(v as 'find' | 'new')}
              data={[
                { value: 'find', label: t('newOrder.findExisting') },
                { value: 'new', label: t('newOrder.newCustomer') },
              ]}
            />
          )}
          {!customer && mode === 'find' && (
            <>
              <TextInput size="md" autoFocus leftSection={<IconSearch />} placeholder={t('search.placeholder')} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
              <Stack gap="xs">
                {hits?.map((h) => (
                  <HitCard
                    key={(h.vehicle?.id ?? '') + h.customer.id}
                    hit={h}
                    onClick={() => {
                      if (h.activeOrder) return navigate(`/orders/${h.activeOrder.id}`);
                      setCustomer(h.customer);
                      setVehicle(h.vehicle);
                    }}
                  />
                ))}
                {q && hits?.length === 0 && <Text c="dimmed">{t('search.noResults')}</Text>}
              </Stack>
            </>
          )}
          {!customer && mode === 'new' && (
            <Paper withBorder p="md">
              <Title order={5} mb="sm">{t('newOrder.customer')}</Title>
              <CustomerFields value={newC} onChange={setNewC} compact />
              <Divider my="md" />
              <Title order={5} mb="sm">{t('newOrder.vehicle')}</Title>
              <VehicleFields value={newV} onChange={setNewV} compact />
              <Button fullWidth mt="md" onClick={createNew} loading={busy}>{t('common.next')}</Button>
            </Paper>
          )}
          {customer && !vehicle && (
            <Paper withBorder p="md">
              <Text mb="sm">{customer.name}: {t('newOrder.addVehicle')}</Text>
              <VehicleFields value={newV} onChange={setNewV} compact />
              <Group mt="md" grow>
                <Button variant="default" onClick={() => setCustomer(undefined)}>{t('common.back')}</Button>
                <Button onClick={addVehicleToCustomer} loading={busy}>{t('common.next')}</Button>
              </Group>
            </Paper>
          )}
        </Stack>
      ) : (
        <Stack>
          <Card withBorder>
            <Group justify="space-between">
              <div>
                <Group gap="xs"><PlateText plate={vehicle.plate} /><Text fw={600}>{vehicle.make} {vehicle.model}</Text></Group>
                <Text size="sm" c="dimmed">{customer.name}</Text>
              </div>
              <Button variant="subtle" size="xs" onClick={() => { setCustomer(undefined); setVehicle(undefined); }}>{t('common.change')}</Button>
            </Group>
          </Card>
          <Textarea label={t('order.complaint')} description={t('order.complaintHint')} autosize minRows={3} value={complaint} onChange={(e) => setComplaint(e.currentTarget.value)} />
          <SegmentedControl
            fullWidth
            value={when}
            onChange={(v) => setWhen(v as 'now' | 'later')}
            data={[
              { value: 'now', label: t('newOrder.arrivedNow') },
              { value: 'later', label: t('newOrder.bookLater') },
            ]}
          />
          {when === 'later' && <TextInput type="datetime-local" label={t('newOrder.bookedFor')} value={bookedFor} onChange={(e) => setBookedFor(e.currentTarget.value)} />}
          <Button size="lg" onClick={submit} loading={busy}>
            {when === 'now' ? t('newOrder.startIntake') : t('newOrder.book')}
          </Button>
        </Stack>
      )}
    </>
  );
}
