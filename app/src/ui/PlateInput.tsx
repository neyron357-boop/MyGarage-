import { Group, Select, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { EMIRATES } from '../domain/plates';
import type { Emirate, Plate } from '../domain/types';
import { useLang } from './hooks';

export function PlateInput({ value, onChange, error }: { value: Plate; onChange: (p: Plate) => void; error?: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <Group gap="xs" align="flex-start" wrap="nowrap">
      <Select
        label={t('vehicle.emirate')}
        data={EMIRATES.map((e) => ({ value: e.code, label: e[lang] }))}
        value={value.emirate}
        onChange={(v) => v && onChange({ ...value, emirate: v as Emirate })}
        allowDeselect={false}
        style={{ flex: '1 1 40%' }}
        comboboxProps={{ withinPortal: true }}
      />
      <TextInput
        label={t('vehicle.plateCode')}
        value={value.code}
        onChange={(e) => onChange({ ...value, code: e.currentTarget.value.toUpperCase() })}
        maxLength={3}
        style={{ flex: '0 0 70px' }}
        autoCapitalize="characters"
      />
      <TextInput
        label={t('vehicle.plateNumber')}
        value={value.number}
        onChange={(e) => onChange({ ...value, number: e.currentTarget.value.replace(/\D/g, '') })}
        inputMode="numeric"
        maxLength={6}
        required
        error={error}
        style={{ flex: '1 1 30%' }}
      />
    </Group>
  );
}
