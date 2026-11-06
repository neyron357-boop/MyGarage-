import { Button, Group, Modal, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Customer, Plate, Vehicle } from '../../domain/types';
import { createCustomer, createVehicle, updateCustomer, updateVehicle, type CustomerInput, type VehicleInput } from '../../services/customers';
import { PlateInput } from '../../ui/PlateInput';
import { useAction } from '../../ui/hooks';

export const EMPTY_CUSTOMER: CustomerInput = {
  name: '',
  phone: '',
  preferredChannel: 'whatsapp',
  docLanguage: 'ru',
  type: 'individual',
};

export const EMPTY_VEHICLE: VehicleInput = { plate: { emirate: 'DXB', code: '', number: '' }, make: '', model: '' };

export function CustomerFields({ value, onChange, compact }: { value: CustomerInput; onChange: (v: CustomerInput) => void; compact?: boolean }) {
  const { t } = useTranslation();
  const set = <K extends keyof CustomerInput>(k: K, v: CustomerInput[K]) => onChange({ ...value, [k]: v });
  return (
    <Stack gap="sm">
      <TextInput label={t('customer.name')} required value={value.name} onChange={(e) => set('name', e.currentTarget.value)} />
      <TextInput
        label={t('customer.phone')}
        required
        type="tel"
        placeholder="050 123 4567"
        value={value.phone}
        onChange={(e) => set('phone', e.currentTarget.value)}
      />
      <div>
        <Text size="sm" fw={500} mb={4}>{t('customer.docLanguage')}</Text>
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
        <Text size="sm" fw={500} mb={4}>{t('customer.channel')}</Text>
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
      {!compact && (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label={t('customer.whatsapp')} description={t('customer.whatsappHint')} type="tel" value={value.whatsapp ?? ''} onChange={(e) => set('whatsapp', e.currentTarget.value)} />
            <TextInput label={t('customer.telegram')} value={value.telegram ?? ''} onChange={(e) => set('telegram', e.currentTarget.value)} />
          </SimpleGrid>
          <div>
            <Text size="sm" fw={500} mb={4}>{t('customer.type')}</Text>
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
              <TextInput label={t('customer.companyName')} value={value.companyName ?? ''} onChange={(e) => set('companyName', e.currentTarget.value)} />
              <TextInput label="TRN" description={t('customer.trnHint')} value={value.trn ?? ''} onChange={(e) => set('trn', e.currentTarget.value)} />
              <TextInput label={t('customer.address')} value={value.address ?? ''} onChange={(e) => set('address', e.currentTarget.value)} />
              <TextInput label="Email" type="email" value={value.email ?? ''} onChange={(e) => set('email', e.currentTarget.value)} />
            </SimpleGrid>
          )}
          <Select
            label={t('customer.source')}
            clearable
            value={value.source ?? null}
            onChange={(v) => set('source', (v ?? undefined) as CustomerInput['source'])}
            data={['referral', 'google_maps', 'social', 'signage', 'repeat', 'other'].map((s) => ({ value: s, label: t(`source.${s}`) }))}
          />
          <Textarea label={t('common.notes')} autosize minRows={2} value={value.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value)} />
        </>
      )}
    </Stack>
  );
}

export function VehicleFields({ value, onChange, compact }: { value: VehicleInput; onChange: (v: VehicleInput) => void; compact?: boolean }) {
  const { t } = useTranslation();
  const set = <K extends keyof VehicleInput>(k: K, v: VehicleInput[K]) => onChange({ ...value, [k]: v });
  return (
    <Stack gap="sm">
      <PlateInput value={value.plate} onChange={(p: Plate) => set('plate', p)} />
      <SimpleGrid cols={2}>
        <TextInput label={t('vehicle.make')} required placeholder="Toyota" value={value.make} onChange={(e) => set('make', e.currentTarget.value)} />
        <TextInput label={t('vehicle.model')} required placeholder="Camry" value={value.model} onChange={(e) => set('model', e.currentTarget.value)} />
      </SimpleGrid>
      {!compact && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3 }}>
            <TextInput label={t('vehicle.year')} inputMode="numeric" value={value.year?.toString() ?? ''} onChange={(e) => set('year', Number(e.currentTarget.value.replace(/\D/g, '')) || undefined)} />
            <TextInput label={t('vehicle.engine')} value={value.engine ?? ''} onChange={(e) => set('engine', e.currentTarget.value)} />
            <TextInput label={t('vehicle.color')} value={value.color ?? ''} onChange={(e) => set('color', e.currentTarget.value)} />
          </SimpleGrid>
          <TextInput label="VIN" maxLength={17} value={value.vin ?? ''} onChange={(e) => set('vin', e.currentTarget.value.toUpperCase())} />
          <Textarea label={t('common.notes')} autosize minRows={2} value={value.notes ?? ''} onChange={(e) => set('notes', e.currentTarget.value)} />
        </>
      )}
    </Stack>
  );
}

export function CustomerModal({ opened, onClose, customer, onSaved }: { opened: boolean; onClose: () => void; customer?: Customer; onSaved?: (c: Customer) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [v, setV] = useState<CustomerInput>(EMPTY_CUSTOMER);
  useEffect(() => {
    if (opened) setV(customer ? { ...customer } : EMPTY_CUSTOMER);
  }, [opened, customer]);
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
      <CustomerFields value={v} onChange={setV} />
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={save} loading={busy}>{t('common.save')}</Button>
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
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={save} loading={busy}>{t('common.save')}</Button>
      </Group>
    </Modal>
  );
}
