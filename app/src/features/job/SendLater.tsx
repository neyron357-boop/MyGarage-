import { Button, Modal, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { IconClock } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dubaiTime } from '../../domain/dates';
import { laterAt, laterChoices, laterStart } from '../../domain/sendLater';

/**
 * «Отправить позже» (v0.91.7, task #76, the owner: «если нажать и удержать — окно с установкой таймера отправки, чтобы
 * вставить время, когда сообщение должно отправиться автоматически»): a moment a tap away (in 30 minutes, an hour, two,
 * this evening, tomorrow morning) or a time typed for today or tomorrow — Dubai's; the garage's server sends it then.
 */
export function SendLaterSheet({ opened, onClose, n, onPick }: { opened: boolean; onClose: () => void; n: number; onPick: (at: number) => void }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const [time, setTime] = useState(() => laterStart(Date.now()));
  useEffect(() => {
    if (!opened) return;
    const n0 = Date.now();
    setNow(n0);
    setDay('today');
    setTime(laterStart(n0));
  }, [opened]);
  const choices = useMemo(() => laterChoices(now), [now]);
  const typed = laterAt(day, time, Date.now());
  const label = (key: string, at: number) => (key === 'evening' || key === 'morning' ? t(`later.${key}`, { time: dubaiTime(new Date(at).toISOString()) }) : t(`later.${key}`));
  return (
    <Modal opened={opened} onClose={onClose} title={t('later.title')} classNames={{ content: 'sheet-grouped' }}>
      <Stack gap="md">
        <div className="chip-row wrap" data-later-choices>
          {choices.map((c) => (
            <button key={c.key} type="button" className="chip" onClick={() => onPick(c.at)} data-later={c.key}>
              {label(c.key, c.at)}
            </button>
          ))}
        </div>
        <Text fw={600} size="sm" c="dimmed">
          {t('later.exact')}
        </Text>
        <SegmentedControl
          fullWidth
          value={day}
          onChange={(v) => setDay(v as 'today' | 'tomorrow')}
          data={[
            { value: 'today', label: t('later.today') },
            { value: 'tomorrow', label: t('later.tomorrow') },
          ]}
        />
        <TextInput type="time" value={time} onChange={(e) => setTime(e.currentTarget.value)} leftSection={<IconClock size={18} />} error={time && !typed ? t('later.past') : undefined} data-later-time />
        <Button size="lg" leftSection={<IconClock size={18} />} disabled={!typed} onClick={() => typed && onPick(typed)} data-later-go>
          {typed ? t('later.go', { time: dubaiTime(new Date(typed).toISOString()), n }) : t('later.pick')}
        </Button>
      </Stack>
    </Modal>
  );
}
