import { ActionIcon, Box, Button, Chip, Group, SegmentedControl, SimpleGrid, Stack, Text, Textarea, TextInput, ThemeIcon, Title } from '@mantine/core';
import { IconArrowRight, IconCalendarTime, IconCar, IconPencil, IconSearch, IconUserCheck, IconUserPlus } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatPhone } from '../../domain/phone';
import type { Customer, Vehicle } from '../../domain/types';
import { createCustomer, createVehicle, findCustomerByPhone, findVehicleByPlate, type CustomerInput, type VehicleInput } from '../../services/customers';
import { createOrder } from '../../services/orders';
import { List, PageHeader, PlateText, SelectCard, StickyBar } from '../../ui/components';
import { DateTimeField } from '../../ui/DateFields';
import { useAction } from '../../ui/hooks';
import { CustomerFields, EMPTY_CUSTOMER, EMPTY_VEHICLE, VehicleFields } from '../customers/forms';
import { HitRow, useSearch } from '../search/SearchPage';

const QUICK = ['service', 'brakes', 'ac', 'checkEngine', 'suspension', 'electrics', 'noise', 'battery'];

function Card({ n, title, children, done }: { n: number; title: ReactNode; children: ReactNode; done?: boolean }) {
  return (
    <Box className="surface" p="md">
      <Group gap="sm" mb="md" wrap="nowrap">
        <ThemeIcon radius="xl" size={28} color={done ? 'green' : 'cobalt'} variant={done ? 'filled' : 'light'}>
          <Text size="sm" fw={800}>
            {n}
          </Text>
        </ThemeIcon>
        <Title order={5}>{title}</Title>
      </Group>
      {children}
    </Box>
  );
}

function DuplicateHint({ title, text, action, onPick }: { title: string; text: string; action: string; onPick: () => void }) {
  return (
    <Group className="surface-soft rise-enter" p="sm" gap="sm" wrap="nowrap" style={{ borderLeft: '3px solid var(--mantine-color-orange-5)' }}>
      <IconUserCheck size={20} color="var(--mantine-color-orange-6)" style={{ flexShrink: 0 }} />
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={600} lh={1.3}>
          {title}
        </Text>
        {text && (
          <Text size="xs" c="dimmed" className="tnum">
            {text}
          </Text>
        )}
      </Box>
      <Button size="compact-sm" variant="light" color="orange" onClick={onPick} style={{ flexShrink: 0 }}>
        {action}
      </Button>
    </Group>
  );
}

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
  const [when, setWhen] = useState<'now' | 'later'>(params.get('when') === 'later' ? 'later' : 'now');
  const [bookedFor, setBookedFor] = useState<string>();

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

  // Same phone or plate already in the base: offer to pick it instead of creating a duplicate.
  const dupCustomer = useLiveQuery(() => (mode === 'new' && !customer ? findCustomerByPhone(newC.phone) : undefined), [mode, customer, newC.phone]);
  const dupVehicle = useLiveQuery(() => (!vehicle ? findVehicleByPlate(newV.plate) : undefined), [vehicle, newV.plate.emirate, newV.plate.code, newV.plate.number]);
  const pickExisting = (c?: Customer, v?: Vehicle) => {
    if (c) setCustomer(c);
    if (v) setVehicle(v);
  };

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
      const o = await createOrder({ customerId: customer.id, vehicleId: vehicle.id, complaint, arrivedNow: when === 'now', bookedFor: when === 'later' ? bookedFor : undefined });
      navigate(when === 'now' ? `/orders/${o.id}/intake` : `/orders/${o.id}`, { replace: true });
    });
  const addQuick = (k: string) => {
    const phrase = t(`newOrder.quick.${k}`);
    setComplaint((c) => (c.includes(phrase) ? c : c ? `${c}, ${phrase.toLowerCase()}` : phrase));
  };
  const picked = customer && vehicle;

  return (
    <>
      <PageHeader back title={t('newOrder.title')} subtitle={t('newOrder.subtitle')} />
      <Stack gap="md">
        <Card n={1} title={t('newOrder.who')} done={!!picked}>
          {picked ? (
            <Group justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <PlateText plate={vehicle.plate} size="md" />
                <Box style={{ minWidth: 0 }}>
                  <Text fw={700} lineClamp={1}>
                    {vehicle.make} {vehicle.model}
                  </Text>
                  <Text size="sm" c="dimmed" lineClamp={1}>
                    {customer.name} · {formatPhone(customer.phone)}
                  </Text>
                </Box>
              </Group>
              <ActionIcon
                variant="default"
                size={38}
                aria-label={t('common.change')}
                onClick={() => {
                  setCustomer(undefined);
                  setVehicle(undefined);
                }}
              >
                <IconPencil size={18} />
              </ActionIcon>
            </Group>
          ) : (
            <Stack gap="md">
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
                  <TextInput leftSection={<IconSearch size={18} />} placeholder={t('search.placeholderShort')} value={q} onChange={(e) => setQ(e.currentTarget.value)} data-autofocus autoFocus />
                  {!!hits?.length && (
                    <List>
                      {hits.map((h) => (
                        <HitRow
                          key={(h.vehicle?.id ?? '') + h.customer.id}
                          hit={h}
                          onClick={() => {
                            if (h.activeOrder) return navigate(`/orders/${h.activeOrder.id}`);
                            setCustomer(h.customer);
                            setVehicle(h.vehicle);
                          }}
                        />
                      ))}
                    </List>
                  )}
                  {q && hits?.length === 0 && (
                    <Group justify="space-between" className="surface-soft" p="sm">
                      <Text size="sm" c="dimmed">
                        {t('search.noResults')}
                      </Text>
                      <Button size="compact-sm" variant="light" leftSection={<IconUserPlus size={16} />} onClick={() => setMode('new')}>
                        {t('newOrder.newCustomer')}
                      </Button>
                    </Group>
                  )}
                </>
              )}
              {!customer && mode === 'new' && (
                <Stack gap="lg">
                  <CustomerFields value={newC} onChange={setNewC} compact />
                  {dupCustomer && (
                    <DuplicateHint
                      title={t('newOrder.dupCustomer', { name: dupCustomer.name })}
                      text={formatPhone(dupCustomer.phone)}
                      action={t('newOrder.pickThis')}
                      onPick={() => pickExisting(dupCustomer, dupVehicle?.owner?.id === dupCustomer.id ? dupVehicle.vehicle : undefined)}
                    />
                  )}
                  <Box pt="md" style={{ borderTop: '1px solid var(--app-hairline)' }}>
                    <Group gap={8} mb="sm">
                      <IconCar size={18} />
                      <Text fw={700}>{t('newOrder.vehicle')}</Text>
                    </Group>
                    <VehicleFields value={newV} onChange={setNewV} compact />
                    {dupVehicle && (
                      <Box mt="sm">
                        <DuplicateHint
                          title={t('newOrder.dupVehicle', { car: `${dupVehicle.vehicle.make} ${dupVehicle.vehicle.model}` })}
                          text={dupVehicle.owner ? `${dupVehicle.owner.name} · ${formatPhone(dupVehicle.owner.phone)}` : ''}
                          action={t('newOrder.pickThis')}
                          onPick={() => pickExisting(dupVehicle.owner, dupVehicle.vehicle)}
                        />
                      </Box>
                    )}
                  </Box>
                  <Button onClick={createNew} loading={busy} rightSection={<IconArrowRight size={18} />}>
                    {t('newOrder.saveCustomer')}
                  </Button>
                </Stack>
              )}
              {customer && !vehicle && (
                <Stack>
                  <Text size="sm">
                    <b>{customer.name}</b>: {t('newOrder.addVehicle')}
                  </Text>
                  <VehicleFields value={newV} onChange={setNewV} compact />
                  {dupVehicle && (
                    <DuplicateHint
                      title={t('newOrder.dupVehicle', { car: `${dupVehicle.vehicle.make} ${dupVehicle.vehicle.model}` })}
                      text={dupVehicle.owner ? `${dupVehicle.owner.name} · ${formatPhone(dupVehicle.owner.phone)}` : ''}
                      action={t('newOrder.pickThis')}
                      onPick={() => pickExisting(dupVehicle.owner, dupVehicle.vehicle)}
                    />
                  )}
                  <Group grow>
                    <Button variant="default" onClick={() => setCustomer(undefined)}>
                      {t('common.back')}
                    </Button>
                    <Button onClick={addVehicleToCustomer} loading={busy}>
                      {t('common.next')}
                    </Button>
                  </Group>
                </Stack>
              )}
            </Stack>
          )}
        </Card>
        {picked && (
          <>
            <Card n={2} title={t('order.complaint')} done={!!complaint.trim()}>
              <Box className="hide-scrollbar" style={{ overflowX: 'auto' }} mb="sm">
                <Group gap={6} wrap="nowrap">
                  {QUICK.map((k) => (
                    <Chip key={k} size="sm" checked={complaint.includes(t(`newOrder.quick.${k}`))} onChange={() => addQuick(k)} style={{ flexShrink: 0 }}>
                      {t(`newOrder.quick.${k}`)}
                    </Chip>
                  ))}
                </Group>
              </Box>
              <Textarea placeholder={t('order.complaintHint')} autosize minRows={3} value={complaint} onChange={(e) => setComplaint(e.currentTarget.value)} />
            </Card>
            <Card n={3} title={t('newOrder.when')}>
              <SimpleGrid cols={2} spacing="xs">
                <SelectCard active={when === 'now'} onClick={() => setWhen('now')}>
                  <Text fw={700} size="sm">
                    {t('newOrder.arrivedNow')}
                  </Text>
                  <Text size="xs" c="dimmed" mt={2}>
                    {t('newOrder.arrivedNowHint')}
                  </Text>
                </SelectCard>
                <SelectCard active={when === 'later'} onClick={() => setWhen('later')}>
                  <Group gap={6}>
                    <IconCalendarTime size={16} />
                    <Text fw={700} size="sm">
                      {t('newOrder.bookLater')}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed" mt={2}>
                    {t('newOrder.bookLaterHint')}
                  </Text>
                </SelectCard>
              </SimpleGrid>
              {when === 'later' && (
                <Box mt="md">
                  <DateTimeField label={t('newOrder.bookedFor')} value={bookedFor} onChange={setBookedFor} />
                </Box>
              )}
            </Card>
          </>
        )}
      </Stack>
      {picked && (
        <StickyBar>
          <Button fullWidth size="lg" onClick={submit} loading={busy} disabled={when === 'later' && !bookedFor} rightSection={<IconArrowRight size={18} />}>
            {when === 'now' ? t('newOrder.startIntake') : t('newOrder.book')}
          </Button>
        </StickyBar>
      )}
    </>
  );
}
