import { Box, Button, Collapse, Group, Modal, SegmentedControl, Select, SimpleGrid, Stack, Text, Textarea, TextInput, UnstyledButton } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { formatPhone } from '../../domain/phone';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Customer, Plate, Vehicle } from '../../domain/types';
import { createCustomer, createVehicle, suggestCustomers, updateCustomer, updateVehicle, type CustomerInput, type VehicleInput } from '../../services/customers';
import { setJobCustomer } from '../../services/orders';
import { PersonAvatar } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { PlateInput } from '../../ui/PlateInput';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';

export const EMPTY_CUSTOMER: CustomerInput = {
  name: '',
  phone: '',
  preferredChannel: 'whatsapp',
  // Documents for customers are in English unless the customer asks for Russian.
  docLanguage: 'en',
  type: 'individual',
};

export const EMPTY_VEHICLE: VehicleInput = { plate: { emirate: 'DXB', code: '', number: '' }, make: '', model: '' };

function Label({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" fw={500} mb={6}>
      {children}
    </Text>
  );
}

function More({ label, children, open: initial = false }: { label: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <Box>
      <UnstyledButton onClick={() => setOpen((o) => !o)} py={4}>
        <Group gap={6}>
          <Text size="sm" fw={600} c="cobalt.6">
            {label}
          </Text>
          <IconChevronDown size={16} color="var(--mantine-color-cobalt-6)" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <Box pt="sm">{children}</Box>
      </Collapse>
    </Box>
  );
}

export function CustomerFields({ value, onChange, compact, after }: { value: CustomerInput; onChange: (v: CustomerInput) => void; compact?: boolean; after?: ReactNode }) {
  const { t } = useTranslation();
  const set = <K extends keyof CustomerInput>(k: K, v: CustomerInput[K]) => onChange({ ...value, [k]: v });
  const extra = (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label={t('customer.whatsapp')} description={t('customer.whatsappHint')} type="tel" value={value.whatsapp ?? ''} onChange={(e) => set('whatsapp', e.currentTarget.value)} />
        <TextInput label={t('customer.telegram')} value={value.telegram ?? ''} onChange={(e) => set('telegram', e.currentTarget.value)} />
      </SimpleGrid>
      <div>
        <Label>{t('customer.type')}</Label>
        <SegmentedControl
          fullWidth
          value={value.type}
          onChange={(v) => set('type', v as CustomerInput['type'])}
          data={[
            { value: 'individual', label: t('customer.individual') },
            { value: 'company', label: t('customer.company') },
          ]}
        />
      </div>
      {value.type === 'company' && (
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label={t('customer.companyName')} value={value.companyName ?? ''} onChange={(e) => set('companyName', e.currentTarget.value)} autoCapitalize="words" />
          <TextInput label="TRN" description={t('customer.trnHint')} value={value.trn ?? ''} onChange={(e) => set('trn', e.currentTarget.value)} />
          <TextInput label={t('customer.address')} value={value.address ?? ''} onChange={(e) => set('address', e.currentTarget.value)} />
          <TextInput label="Email" type="email" value={value.email ?? ''} onChange={(e) => set('email', e.currentTarget.value)} />
        </SimpleGrid>
      )}
      <Select
        label={t('customer.source')}
        placeholder={t('common.notSet')}
        clearable
        value={value.source ?? null}
        onChange={(v) => set('source', (v ?? undefined) as CustomerInput['source'])}
        data={['referral', 'google_maps', 'social', 'signage', 'repeat', 'other'].map((s) => ({ value: s, label: t(`source.${s}`) }))}
      />
      <Textarea label={t('common.notes')} placeholder={t('customer.notesHint')} autosize minRows={2} value={value.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value)} />
    </Stack>
  );
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label={t('customer.name')} required value={value.name} onChange={(e) => set('name', e.currentTarget.value)} data-autofocus autoCapitalize="words" autoComplete="off" />
        <TextInput label={t('customer.phone')} required type="tel" inputMode="tel" placeholder="050 123 4567" value={value.phone} onChange={(e) => set('phone', e.currentTarget.value)} />
      </SimpleGrid>
      {after}
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <div>
          <Label>{t('customer.docLanguage')}</Label>
          <SegmentedControl
            fullWidth
            value={value.docLanguage}
            onChange={(v) => set('docLanguage', v as CustomerInput['docLanguage'])}
            data={[
              { value: 'ru', label: 'Русский' },
              { value: 'en', label: 'English' },
            ]}
          />
        </div>
        <div>
          <Label>{t('customer.channel')}</Label>
          <SegmentedControl
            fullWidth
            value={value.preferredChannel}
            onChange={(v) => set('preferredChannel', v as CustomerInput['preferredChannel'])}
            data={[
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'telegram', label: 'Telegram' },
              { value: 'call', label: t('customer.call') },
            ]}
          />
        </div>
      </SimpleGrid>
      {compact ? <More label={t('customer.moreFields')}>{extra}</More> : extra}
    </Stack>
  );
}

export function VehicleFields({ value, onChange, compact }: { value: VehicleInput; onChange: (v: VehicleInput) => void; compact?: boolean }) {
  const { t } = useTranslation();
  const set = <K extends keyof VehicleInput>(k: K, v: VehicleInput[K]) => onChange({ ...value, [k]: v });
  const extra = (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 2, sm: 3 }}>
        <TextInput label={t('vehicle.year')} inputMode="numeric" value={value.year?.toString() ?? ''} onChange={(e) => set('year', Number(e.currentTarget.value.replace(/\D/g, '')) || undefined)} />
        <TextInput label={t('vehicle.engine')} placeholder="2.5" value={value.engine ?? ''} onChange={(e) => set('engine', e.currentTarget.value)} />
        <TextInput label={t('vehicle.color')} value={value.color ?? ''} onChange={(e) => set('color', e.currentTarget.value)} />
      </SimpleGrid>
      <TextInput label="VIN" maxLength={17} value={value.vin ?? ''} onChange={(e) => set('vin', e.currentTarget.value.toUpperCase())} styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', letterSpacing: '0.06em' } }} />
      <Textarea label={t('common.notes')} autosize minRows={2} value={value.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value)} />
    </Stack>
  );
  return (
    <Stack gap="md">
      <PlateInput value={value.plate} onChange={(p: Plate) => set('plate', p)} />
      <SimpleGrid cols={2}>
        <TextInput label={t('vehicle.make')} required placeholder="Toyota" value={value.make} onChange={(e) => set('make', e.currentTarget.value)} />
        <TextInput label={t('vehicle.model')} required placeholder="Camry" value={value.model} onChange={(e) => set('model', e.currentTarget.value)} />
      </SimpleGrid>
      {compact ? <More label={t('vehicle.moreFields')}>{extra}</More> : extra}
    </Stack>
  );
}

/**
 * A customer's card to fill in or change. The name or phone typed may be someone already in the base:
 * on a job (`orderId`) they show under the fields — one tap, the job (and its car) is theirs; a new
 * customer (`onPick`) — one tap opens the one that is there instead of making a second.
 */
export function CustomerModal({ opened, onClose, customer, onSaved, orderId, onPick }: { opened: boolean; onClose: () => void; customer?: Customer; onSaved?: (c: Customer) => void; orderId?: string; onPick?: (c: Customer) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [v, setV] = useState<CustomerInput>(EMPTY_CUSTOMER);
  useEffect(() => {
    if (opened) setV(customer ? { ...customer } : EMPTY_CUSTOMER);
  }, [opened, customer]);
  // Only what was typed here is looked up (not the name the card opened with).
  const typedName = v.name !== (customer?.name ?? '') ? v.name : '';
  const typedPhone = v.phone !== (customer?.phone ?? '') ? v.phone : '';
  const found = useScreenLiveQuery(() => ((orderId || onPick) && opened ? suggestCustomers(typedPhone, typedName, 3, customer?.id) : []), [orderId, opened, typedName, typedPhone, customer?.id]) ?? [];
  const pick = (c: Customer) =>
    run(async () => {
      if (orderId) {
        await setJobCustomer(orderId, c.id);
        haptic('success');
      } else onPick?.(c);
      onClose();
    });
  const suggestions = found.length > 0 && (
    <Stack gap={8}>
      {found.map((c) => (
        <button key={c.id} type="button" className="suggest rise-enter" onClick={() => void pick(c)}>
          <PersonAvatar name={(c.type === 'company' && c.companyName) || c.name} company={c.type === 'company'} size={32} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={600} lineClamp={1}>
              {(c.type === 'company' && c.companyName) || c.name || t('customer.noName')}
            </Text>
            {c.phone && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {formatPhone(c.phone)}
              </Text>
            )}
          </span>
          <Text size="sm" c="cobalt.6" fw={600} style={{ flexShrink: 0 }}>
            {t('newOrder.useThis')}
          </Text>
        </button>
      ))}
    </Stack>
  );
  const save = () =>
    run(async () => {
      if (customer) {
        await updateCustomer(customer.id, v);
        onSaved?.({ ...customer, ...v });
      } else onSaved?.(await createCustomer(v));
      onClose();
    }, 'common.saved');
  return (
    <Modal opened={opened} onClose={onClose} title={customer ? t('customer.edit') : t('customer.new')} size="lg">
      <CustomerFields value={v} onChange={setV} after={suggestions || undefined} />
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={save} loading={busy}>
          {t('common.save')}
        </Button>
      </Group>
    </Modal>
  );
}

export function VehicleModal({ opened, onClose, vehicle, customerId, onSaved }: { opened: boolean; onClose: () => void; vehicle?: Vehicle; customerId?: string; onSaved?: (v: Vehicle) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [v, setV] = useState<VehicleInput>(EMPTY_VEHICLE);
  useEffect(() => {
    if (opened) setV(vehicle ? { ...vehicle } : EMPTY_VEHICLE);
  }, [opened, vehicle]);
  const save = () =>
    run(async () => {
      if (vehicle) {
        await updateVehicle(vehicle.id, v);
        onSaved?.({ ...vehicle, ...v });
      } else if (customerId) onSaved?.(await createVehicle(customerId, v));
      onClose();
    }, 'common.saved');
  return (
    <Modal opened={opened} onClose={onClose} title={vehicle ? t('vehicle.edit') : t('vehicle.new')} size="lg">
      <VehicleFields value={v} onChange={setV} />
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button onClick={save} loading={busy}>
          {t('common.save')}
        </Button>
      </Group>
    </Modal>
  );
}
