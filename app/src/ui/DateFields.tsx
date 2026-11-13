import { ActionIcon } from '@mantine/core';
import { DatePickerInput, DateTimePicker, MonthPickerInput } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { IconCalendar, IconCalendarTime, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { monthKey } from '../domain/dates';

const pad = (n: number) => String(n).padStart(2, '0');
const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromDay = (s?: string) => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

function useDropdown() {
  const mobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false });
  return mobile ? ('modal' as const) : ('popover' as const);
}

/** Date and time; stores an ISO timestamp. */
export function DateTimeField({ label, value, onChange, description, disabled, placeholder }: { label: ReactNode; value?: string; onChange: (iso: string | undefined) => void; description?: ReactNode; disabled?: boolean; placeholder?: string }) {
  return (
    <DateTimePicker
      label={label}
      description={description}
      disabled={disabled}
      value={value ? new Date(value) : null}
      onChange={(d) => onChange(d ? d.toISOString() : undefined)}
      valueFormat="DD/MM/YYYY HH:mm"
      placeholder={placeholder}
      clearable
      dropdownType={useDropdown()}
      leftSection={<IconCalendarTime size={18} />}
      size="md"
      timeInputProps={{ 'aria-label': 'time' }}
      submitButtonProps={{ 'aria-label': 'ok' }}
    />
  );
}

/** Calendar date; stores YYYY-MM-DD. */
export function DateField({ label, value, onChange, description, required }: { label: ReactNode; value?: string; onChange: (day: string) => void; description?: ReactNode; required?: boolean }) {
  return (
    <DatePickerInput
      label={label}
      description={description}
      required={required}
      value={fromDay(value)}
      onChange={(d) => d && onChange(toDay(d))}
      valueFormat="DD/MM/YYYY"
      dropdownType={useDropdown()}
      leftSection={<IconCalendar size={18} />}
      size="md"
    />
  );
}

/**
 * Month; stores YYYY-MM. The month in the middle (a tap picks any), the one before and after one tap
 * away on each side — the way a banking app pages through its statements. No month after this one.
 */
export function MonthField({ value, onChange, label }: { value: string; onChange: (month: string) => void; label?: ReactNode }) {
  const { t } = useTranslation();
  const dropdownType = useDropdown();
  const step = (n: number) => {
    const [y, m] = value.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };
  const last = value >= monthKey();
  return (
    <div className="month-field">
      <ActionIcon variant="subtle" size={40} radius="xl" aria-label={t('common.prevMonth')} onClick={() => step(-1)}>
        <IconChevronLeft size={22} stroke={2.2} />
      </ActionIcon>
      <MonthPickerInput
        label={label}
        value={fromDay(`${value}-01`)}
        onChange={(d) => d && onChange(toDay(d).slice(0, 7))}
        valueFormat="MMMM YYYY"
        maxDate={new Date()}
        dropdownType={dropdownType}
        size="md"
        variant="unstyled"
        classNames={{ input: 'month-field-input' }}
      />
      <ActionIcon variant="subtle" size={40} radius="xl" aria-label={t('common.nextMonth')} onClick={() => step(1)} disabled={last}>
        <IconChevronRight size={22} stroke={2.2} />
      </ActionIcon>
    </div>
  );
}
