import { Box, Group, Select, Text, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { EMIRATES } from '../domain/plates';
import type { Emirate, Plate } from '../domain/types';
import { PlateText } from './components';
import { useLang } from './hooks';

/** Emirate + code + number, with a live preview of the plate. */
export function PlateInput({ value, onChange, error }: { value: Plate; onChange: (p: Plate) => void; error?: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <Box>
      <Group gap="xs" align="flex-start" wrap="nowrap">
        <Select
          label={t('vehicle.emirate')}
          data={EMIRATES.map((e) => ({ value: e.code, label: e[lang] }))}
          value={value.emirate}
          onChange={(v) => v && onChange({ ...value, emirate: v as Emirate })}
          allowDeselect={false}
          style={{ flex: '1 1 42%' }}
        />
        <TextInput
          label={t('vehicle.plateCode')}
          value={value.code}
          onChange={(e) => onChange({ ...value, code: e.currentTarget.value.toUpperCase() })}
          maxLength={3}
          style={{ flex: '0 0 76px' }}
          autoCapitalize="characters"
          styles={{ input: { fontFamily: 'var(--font-display)', fontSize: 18, textAlign: 'center' } }}
        />
        <TextInput
          label={t('vehicle.plateNumber')}
          value={value.number}
          onChange={(e) => onChange({ ...value, number: e.currentTarget.value.replace(/\D/g, '') })}
          inputMode="numeric"
          maxLength={6}
          required
          error={error}
          style={{ flex: '1 1 34%' }}
          styles={{ input: { fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.06em' } }}
        />
      </Group>
      {value.number && (
        <Group gap={8} mt={8}>
          <Text size="xs" c="dimmed">
            {t('vehicle.platePreview')}
          </Text>
          <PlateText plate={value} size="sm" />
        </Group>
      )}
    </Box>
  );
}
