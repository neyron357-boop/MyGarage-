import { ActionIcon, Box, Button, Group, Modal, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconBrandWhatsapp, IconCar, IconPencil, IconPhone, IconSteeringWheel, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '../../domain/dates';
import type { DriverTyped } from '../../domain/drivers';
import { formatPhone, normalizePhone } from '../../domain/phone';
import type { Driver, JobDriver, Order } from '../../domain/types';
import { archiveDriver, clearJobDriver, companyDrivers, driverJobs, restoreDriver, restoreJobDriver, setJobDriver, suggestDrivers, updateDriver } from '../../services/drivers';
import { whatsappUrl } from '../../services/messages';
import { ContactTiles, FormRow, List, ListRow, PersonAvatar, PlateText, RowGroup, Section, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { LazySheet, SheetFor } from '../../ui/lazy';

/*
 * Who brought the car (v0.43) — a company's driver: on the job's card under the customer, picked in one tap from the
 * company's drivers (or typed and added), shown on the company's page with the jobs each one brought. The customer
 * and the money are not touched: the driver is only who came with the car.
 */

/** A driver's name, or his phone when the name was not given. */
function nameOf(d: { name: string; phone: string }, noName: string): string {
  return d.name || (d.phone ? formatPhone(d.phone) : noName);
}

/** One driver offered under the fields: who he is, a car if he brought this one, «Выбрать» (or «Уже в базе»). */
function Suggestion({ d, car, exact, onPick }: { d: Driver; car: boolean; exact: boolean; onPick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="suggest rise-enter" onClick={onPick}>
      <PersonAvatar name={d.name} size={32} />
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={600} lineClamp={1}>
          {d.name || t('driver.noName')}
        </Text>
        {d.phone && (
          <Text size="xs" c="dimmed" className="tnum" lineClamp={1}>
            {formatPhone(d.phone)}
          </Text>
        )}
      </Box>
      {car && <IconCar size={18} stroke={1.9} color="var(--mantine-color-cobalt-6)" aria-label={t('driver.thisCar')} style={{ flexShrink: 0 }} />}
      <Text size="sm" c="cobalt.6" fw={600} style={{ flexShrink: 0 }}>
        {exact ? t('driver.inBase') : t('newOrder.useThis')}
      </Text>
    </button>
  );
}

/**
 * The driver's name and phone, and under them the drivers to pick: nothing typed — the company's own (who brought this
 * car first); typing — those whose name or phone has it (a part of the number too), the company's first. One tap picks.
 */
export function DriverFields({
  value,
  onChange,
  onPick,
  customerId,
  vehicleId,
  except,
  suggest = true,
}: {
  value: DriverTyped;
  onChange: (v: DriverTyped) => void;
  onPick: (d: Driver) => void;
  customerId?: string;
  vehicleId?: string;
  /** The job's own driver: shown above, not offered. */
  except?: string;
  suggest?: boolean;
}) {
  const { t } = useTranslation();
  const found = useScreenLiveQuery(() => (suggest ? suggestDrivers(value, { customerId, vehicleId, except }) : []), [suggest, value.name, value.phone, customerId, vehicleId, except]) ?? [];
  const exact = value.phone.trim() ? normalizePhone(value.phone) : null;
  return (
    <>
      <RowGroup mt={0}>
        <FormRow label={t('driver.name')}>
          <TextInput aria-label={`${t('driver.title')}: ${t('driver.name')}`} placeholder={t('driver.namePlaceholder')} value={value.name} onChange={(e) => onChange({ ...value, name: e.currentTarget.value })} autoComplete="off" autoCapitalize="words" w="100%" />
        </FormRow>
        <FormRow label={t('driver.phone')}>
          <TextInput aria-label={`${t('driver.title')}: ${t('driver.phone')}`} type="tel" inputMode="tel" placeholder="050 123 4567" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.currentTarget.value })} autoComplete="off" w="100%" />
        </FormRow>
      </RowGroup>
      {found.length > 0 && (
        <Stack gap={8} mt={10} aria-label={t('driver.list')}>
          {found.map(({ driver: d, car }) => (
            <Suggestion key={d.id} d={d} car={car} exact={!!exact && d.phone === exact} onPick={() => onPick(d)} />
          ))}
        </Stack>
      )}
    </>
  );
}

/** The driver picked for a job not made yet («Новый заказ»): his name and phone, ✕ — another one. */
export function PickedDriver({ driver, onClear }: { driver: DriverTyped; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <Box className="surface rise-enter" p="md">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <PersonAvatar name={driver.name} size={36} />
          <Box style={{ minWidth: 0 }}>
            <Text fw={500} lineClamp={1}>
              {nameOf(driver, t('driver.noName'))}
            </Text>
            {driver.name && driver.phone && (
              <Text size="sm" c="dimmed" className="tnum" lineClamp={1}>
                {formatPhone(driver.phone)}
              </Text>
            )}
          </Box>
        </Group>
        <Button variant="subtle" color="gray" size="compact-md" aria-label={t('common.change')} onClick={onClear}>
          <IconX size={18} />
        </Button>
      </Group>
    </Box>
  );
}

/**
 * The job's driver on its card, under the customer: his name and phone, WhatsApp and a call; a tap — his sheet. A
 * company's open job without one shows «Водитель» to add him (a private customer's job — nothing: «…» has it).
 */
export function DriverLine({ driver, company, open, onOpen }: { driver?: JobDriver; company: boolean; open: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  if (!driver) {
    if (!company || !open) return null;
    return (
      <UnstyledButton className="job-line job-complaint job-driver" mt="sm" onClick={onOpen} aria-label={t('driver.title')}>
        <IconSteeringWheel size={18} stroke={1.8} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
        <Text size="sm" c="dimmed">
          {t('driver.title')}
        </Text>
      </UnstyledButton>
    );
  }
  return (
    <Group justify="space-between" wrap="nowrap" mt="sm" gap="sm">
      <UnstyledButton className="job-line job-complaint job-driver" onClick={onOpen} aria-label={t('driver.title')}>
        <IconSteeringWheel size={18} stroke={1.8} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
        <Box style={{ minWidth: 0 }}>
          <Text size="sm" fw={500} c="var(--mantine-color-text)" lineClamp={1}>
            {nameOf(driver, t('driver.noName'))}
          </Text>
          {driver.name && driver.phone && (
            <Text size="xs" c="dimmed" className="tnum" lineClamp={1}>
              {formatPhone(driver.phone)}
            </Text>
          )}
        </Box>
      </UnstyledButton>
      {driver.phone && (
        <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
          <ActionIcon component="a" href={whatsappUrl(driver.phone, '')} target="_blank" rel="noopener" variant="light" color="green" size={36} radius="xl" aria-label="WhatsApp">
            <IconBrandWhatsapp size={19} />
          </ActionIcon>
          <ActionIcon component="a" href={`tel:${driver.phone}`} variant="light" color="green" size={36} radius="xl" aria-label={t('customer.call')}>
            <IconPhone size={18} />
          </ActionIcon>
        </Group>
      )}
    </Group>
  );
}

type JobFor = Pick<Order, 'id' | 'customerId' | 'vehicleId' | 'driver'>;

/**
 * Who brought the car on this job: the company's drivers to pick with one tap, a new one typed and added, the current
 * one's name or phone changed (✎ — the list follows, the jobs before keep theirs), or off the job («Отменить»).
 */
export function DriverSheet({ order, opened, onClose }: { order: JobFor; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  // Every opening starts afresh — nothing typed, not editing: LazySheet keeps what it made after the first opening.
  const [round, setRound] = useState(0);
  const [was, setWas] = useState(opened);
  if (opened !== was) {
    setWas(opened);
    if (opened) setRound((r) => r + 1);
  }
  return (
    <LazySheet opened={opened}>
      {(o) => (
        <Modal opened={o} onClose={onClose} title={t('driver.title')}>
          <DriverChoices key={round} order={order} onDone={onClose} />
        </Modal>
      )}
    </LazySheet>
  );
}

function DriverChoices({ order, onDone }: { order: JobFor; onDone: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const cur = order.driver;
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState<DriverTyped>({ name: '', phone: '' });
  const pick = (d: Driver) =>
    run(async () => {
      await setJobDriver(order.id, { id: d.id, name: d.name, phone: d.phone });
      haptic('selection');
      onDone();
    });
  const save = () =>
    run(async () => {
      await setJobDriver(order.id, editing && cur ? { id: cur.id, ...typed } : typed, { edit: editing });
      haptic('success');
      onDone();
    });
  const remove = () =>
    run(async () => {
      const had = await clearJobDriver(order.id);
      haptic('light');
      onDone();
      if (had) undoToast(t('driver.removed'), t('common.undo'), () => void restoreJobDriver(order.id, had));
    });
  const ready = !!(typed.name.trim() || typed.phone.trim());
  return (
    <Stack gap="md">
      {cur && !editing && (
        <Group className="surface" p="sm" gap="sm" wrap="nowrap" justify="space-between">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <PersonAvatar name={cur.name} size={40} />
            <Box style={{ minWidth: 0 }}>
              <Text fw={600} lineClamp={1}>
                {nameOf(cur, t('driver.noName'))}
              </Text>
              {cur.name && cur.phone && (
                <Text size="sm" c="dimmed" className="tnum" lineClamp={1}>
                  {formatPhone(cur.phone)}
                </Text>
              )}
            </Box>
          </Group>
          <ActionIcon
            variant="light"
            size={40}
            radius="xl"
            aria-label={t('driver.edit')}
            onClick={() => {
              setTyped({ name: cur.name, phone: cur.phone ? formatPhone(cur.phone) : '' });
              setEditing(true);
            }}
          >
            <IconPencil size={18} />
          </ActionIcon>
        </Group>
      )}
      <Box>
        <DriverFields value={typed} onChange={setTyped} onPick={(d) => void pick(d)} customerId={order.customerId} vehicleId={order.vehicleId} except={cur?.id} suggest={!editing} />
      </Box>
      <Button fullWidth loading={busy} disabled={!ready} onClick={() => void save()}>
        {editing ? t('common.save') : t('driver.add')}
      </Button>
      {editing && (
        <Button
          variant="default"
          onClick={() => {
            setEditing(false);
            setTyped({ name: '', phone: '' });
          }}
        >
          {t('common.cancel')}
        </Button>
      )}
      {cur && !editing && (
        <Button variant="subtle" color="red" loading={busy} onClick={() => void remove()}>
          {t('driver.remove')}
        </Button>
      )}
    </Stack>
  );
}

/**
 * A driver in the list: his name and phone to change (the jobs he brought keep theirs), how to reach him, the jobs he
 * brought (any car, any company — a tap opens one); off the list («Отменить»: back on it).
 */
export function DriverCard({ driver, opened, onClose }: { driver: Driver; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={t('driver.title')}>
      <DriverCardBody driver={driver} onDone={onClose} />
    </Modal>
  );
}

function DriverCardBody({ driver, onDone }: { driver: Driver; onDone: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [typed, setTyped] = useState<DriverTyped>({ name: driver.name, phone: driver.phone ? formatPhone(driver.phone) : '' });
  const jobs = useScreenLiveQuery(() => driverJobs(driver.id), [driver.id]) ?? [];
  const changed = typed.name.replace(/\s+/g, ' ').trim() !== driver.name || (typed.phone.trim() ? normalizePhone(typed.phone) : '') !== driver.phone;
  const save = () =>
    run(async () => {
      await updateDriver(driver.id, typed);
      haptic('success');
      onDone();
    });
  const off = () =>
    run(async () => {
      await archiveDriver(driver.id);
      haptic('light');
      onDone();
      undoToast(t('driver.offListed'), t('common.undo'), () => void restoreDriver(driver.id));
    });
  return (
    <Stack gap="md">
      <RowGroup mt={0}>
        <FormRow label={t('driver.name')}>
          <TextInput aria-label={`${t('driver.title')}: ${t('driver.name')}`} placeholder={t('driver.namePlaceholder')} value={typed.name} onChange={(e) => setTyped({ ...typed, name: e.currentTarget.value })} autoComplete="off" autoCapitalize="words" w="100%" />
        </FormRow>
        <FormRow label={t('driver.phone')}>
          <TextInput aria-label={`${t('driver.title')}: ${t('driver.phone')}`} type="tel" inputMode="tel" placeholder="050 123 4567" value={typed.phone} onChange={(e) => setTyped({ ...typed, phone: e.currentTarget.value })} autoComplete="off" w="100%" />
        </FormRow>
      </RowGroup>
      {driver.phone && <ContactTiles phone={driver.phone} />}
      {changed && (
        <Button fullWidth loading={busy} disabled={!typed.name.trim() && !typed.phone.trim()} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      )}
      {jobs.length > 0 && (
        <Box>
          <div className="group-title">
            {t('driver.jobsTitle')} <span className="count">{jobs.length}</span>
          </div>
          <List>
            {jobs.map(({ order: o, vehicle: v }) => (
              <ListRow
                key={o.id}
                chevron
                onClick={() => {
                  onDone();
                  navigate(`/orders/${o.id}`);
                }}
                left={v ? <PlateText plate={v.plate} size="sm" /> : undefined}
                title={`№${o.number}${v ? ` · ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}`}
                // The phone he had then, when it is not the one he has now: the job kept it.
                subtitle={[formatDate(o.arrivedAt || o.createdAt), o.driver && o.driver.phone !== driver.phone && o.driver.phone ? formatPhone(o.driver.phone) : ''].filter(Boolean).join(' · ')}
              />
            ))}
          </List>
        </Box>
      )}
      <Button variant="subtle" color="red" loading={busy} onClick={() => void off()}>
        {t('driver.offList')}
      </Button>
    </Stack>
  );
}

/** The drivers who brought this customer's cars (a company's page): the latest first; a tap — his card. */
export function CustomerDrivers({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  const list = useScreenLiveQuery(() => companyDrivers(customerId), [customerId], 0, 150);
  const [card, setCard] = useState<Driver | null>(null);
  if (!list?.length) return null;
  return (
    <>
      <Section title={t('driver.list')}>
        <List>
          {list.map((x) => (
            <ListRow
              key={x.driver.id}
              chevron
              onClick={() => setCard(x.driver)}
              left={<PersonAvatar name={x.driver.name} size={36} />}
              title={nameOf(x.driver, t('driver.noName'))}
              subtitle={[x.driver.name && x.driver.phone ? formatPhone(x.driver.phone) : '', t('driver.jobs', { count: x.jobs }), x.cars > 1 ? t('driver.cars', { count: x.cars }) : ''].filter(Boolean).join(' · ')}
            />
          ))}
        </List>
      </Section>
      <SheetFor value={card}>{(d, o) => <DriverCard driver={d} opened={o} onClose={() => setCard(null)} />}</SheetFor>
    </>
  );
}
