import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { IconCheck, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { nowIso } from '../../domain/dates';
import { quickTimes } from '../../domain/notify';
import type { Reminder } from '../../domain/types';
import { addReminder, doneReminder, removeReminder, restoreReminder, updateReminder } from '../../services/reminders';
import { PlateText, undoToast } from '../../ui/components';
import { DateTimeField } from '../../ui/DateFields';
import { haptic } from '../../ui/haptics';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';

const REPEATS: (Reminder['repeat'] | undefined)[] = [undefined, 'day', 'week', 'month'];

/**
 * A reminder, new or opened (v0.74, the user: «добавить также напоминалки»): its words, when — a tap on «Через час»,
 * «Вечером», «Завтра утром», «Через неделю», or any day and time — and whether it comes again. Opened from a job, it is
 * that job's. One already set can be done (it leaves «Сегодня»; a repeating one moves on) or deleted, each with «Отменить».
 */
export function ReminderSheet({ opened, onClose, orderId, reminder }: { opened: boolean; onClose: () => void; orderId?: string; reminder?: Reminder }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [text, setText] = useState('');
  const [at, setAt] = useState('');
  const [repeat, setRepeat] = useState<Reminder['repeat']>();
  const [quick, setQuick] = useState(() => quickTimes(nowIso()));
  // Each opening starts afresh (a sheet is kept between openings): the reminder's own, or empty and «in an hour».
  const [was, setWas] = useState(false);
  if (opened !== was) {
    setWas(opened);
    if (opened) {
      const now = quickTimes(nowIso());
      setQuick(now);
      setText(reminder?.text ?? '');
      setAt(reminder?.at ?? now[0].at);
      setRepeat(reminder?.repeat);
    }
  }
  const jobId = reminder?.orderId ?? orderId;
  const car = useScreenLiveQuery(async () => {
    if (!jobId || !opened) return null;
    const order = await db.orders.get(jobId);
    const vehicle = order ? await db.vehicles.get(order.vehicleId) : undefined;
    return vehicle ? { vehicle, number: order!.number } : null;
  }, [jobId, opened]);
  const ok = !!text.trim() && !!at;
  const save = () =>
    ok &&
    run(async () => {
      if (reminder) await updateReminder(reminder.id, { text, at, repeat, orderId: reminder.orderId });
      else await addReminder({ text, at, repeat, orderId });
      haptic('success');
      onClose();
    }, 'common.saved');
  const done = () =>
    reminder &&
    run(async () => {
      const before = await doneReminder(reminder.id);
      haptic('success');
      onClose();
      undoToast(t('reminder.doneToast'), t('common.undo'), () => void restoreReminder(before));
    });
  const remove = () =>
    reminder &&
    run(async () => {
      const before = await removeReminder(reminder.id);
      onClose();
      if (before) undoToast(t('reminder.removed'), t('common.undo'), () => void restoreReminder(before));
    });
  return (
    <Modal opened={opened} onClose={onClose} title={t('reminder.title')}>
      <Stack gap="md" data-reminder-sheet>
        {car && (
          <Group gap="sm" wrap="nowrap" className="surface-soft reminder-job" onClick={() => (onClose(), navigate(`/orders/${jobId}`))} role="button" tabIndex={0}>
            <PlateText plate={car.vehicle.plate} size="xs" />
            <Text size="sm" fw={600} lineClamp={1}>
              {[car.vehicle.make, car.vehicle.model].filter(Boolean).join(' ')}
            </Text>
            <Text size="sm" c="dimmed" className="tnum" ml="auto">
              №{car.number}
            </Text>
          </Group>
        )}
        <TextInput
          aria-label={t('reminder.placeholder')}
          placeholder={t('reminder.placeholder')}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
          maxLength={200}
          enterKeyHint="done"
          data-autofocus
          autoComplete="off"
        />
        <div>
          <div className="chip-row wrap" role="group" aria-label={t('reminder.when')}>
            {quick.map((q) => (
              <button key={q.key} type="button" className="chip" data-active={at === q.at} onClick={() => setAt(q.at)} data-when={q.key}>
                {t(`reminder.in.${q.key}`)}
              </button>
            ))}
          </div>
          <DateTimeField label={undefined} value={at || undefined} onChange={(v) => setAt(v ?? '')} />
        </div>
        <div className="chip-row wrap" role="group" aria-label={t('reminder.repeatLabel')}>
          {REPEATS.map((r) => (
            <button key={r ?? 'none'} type="button" className="chip" data-active={repeat === r} onClick={() => setRepeat(r)} data-repeat-kind={r ?? 'none'}>
              {t(`reminder.repeat.${r ?? 'none'}`)}
            </button>
          ))}
        </div>
        <Button fullWidth size="md" disabled={!ok} loading={busy} onClick={() => void save()} data-reminder-save>
          {t('common.save')}
        </Button>
        {reminder && (
          <Group grow gap="sm">
            <Button variant="light" color="green" leftSection={<IconCheck size={18} />} onClick={() => void done()} data-reminder-done>
              {t('reminder.done')}
            </Button>
            <Button variant="light" color="red" leftSection={<IconTrash size={18} />} onClick={() => void remove()}>
              {t('common.delete')}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
