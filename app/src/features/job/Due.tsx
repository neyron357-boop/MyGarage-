import { Button, Modal, Stack } from '@mantine/core';
import { IconClock } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dubaiAt, dubaiDate, dubaiTime, nowIso, shiftDay, whenParts } from '../../domain/dates';
import type { Lang, Order } from '../../domain/types';
import { updateOrder } from '../../services/orders';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';

/** "к 18:00", "завтра к 12:00", "пт к 18:00" — when the car was promised, short. */
export function useDueLabel() {
  const { t } = useTranslation();
  return (iso: string, lang: Lang) => {
    const w = whenParts(iso, lang);
    return w.day ? t('job.dueAtDay', { day: w.day, time: w.time }) : t('job.dueAt', { time: w.time });
  };
}

/** The hours offered for "other time": the working day. */
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Quick choices of when the car will be ready: in two hours, this evening, tomorrow… */
function quickTimes(now = nowIso()) {
  const today = dubaiDate(now);
  const hour = Number(dubaiTime(now).slice(0, 2));
  const out: { key: string; iso: string }[] = [];
  // Two hours from now, on the half hour, within the working day.
  const soon = new Date(new Date(now).getTime() + 2 * 3600000);
  soon.setUTCMinutes(soon.getUTCMinutes() < 30 ? 30 : 60, 0, 0);
  if (dubaiDate(soon.toISOString()) === today && hour < 19) out.push({ key: 'in2h', iso: soon.toISOString() });
  if (hour < 17) out.push({ key: 'today18', iso: dubaiAt(today, 18) });
  out.push({ key: 'tomorrow12', iso: dubaiAt(shiftDay(today, 1), 12) });
  out.push({ key: 'tomorrow18', iso: dubaiAt(shiftDay(today, 1), 18) });
  out.push({ key: 'after18', iso: dubaiAt(shiftDay(today, 2), 18) });
  return out;
}

const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/**
 * When the car was promised — a chip on the job's card: one tap, then a time from the chips (in two
 * hours, today at six, tomorrow…) or any day and hour. Late — the chip turns red (and the board row).
 * The sheet and its days are made only when it is opened (the job opens without them).
 */
export function DueChip({ order, lang }: { order: Pick<Order, 'id' | 'promisedReadyAt'>; lang: Lang }) {
  const { t } = useTranslation();
  const label = useDueLabel();
  const [open, setOpen] = useState(false);
  const due = order.promisedReadyAt;
  const late = !!due && due < nowIso();
  return (
    <>
      <button type="button" className="chip due-chip" data-state={late ? 'late' : due ? 'set' : 'empty'} onClick={() => setOpen(true)} aria-label={t('job.due')}>
        <IconClock size={16} stroke={2} aria-hidden />
        {due ? label(due, lang) : t('job.due')}
      </button>
      <LazySheet opened={open}>
        {(o) => (
          <Modal opened={o} onClose={() => setOpen(false)} title={t('job.dueTitle')}>
            <DueChoices order={order} lang={lang} onDone={() => setOpen(false)} />
          </Modal>
        )}
      </LazySheet>
    </>
  );
}

function DueChoices({ order, lang, onDone }: { order: Pick<Order, 'id' | 'promisedReadyAt'>; lang: Lang; onDone: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const today = dubaiDate();
  // The day picked for "other time": the promised one, or today (tomorrow once the working day is over).
  const [day, setDay] = useState(() => (order.promisedReadyAt ? dubaiDate(order.promisedReadyAt) : Number(dubaiTime(nowIso()).slice(0, 2)) >= 19 ? shiftDay(today, 1) : today));
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, n) => {
        const d = shiftDay(today, n);
        return { day: d, label: capital(n === 0 ? t('offer.days0') : whenParts(dubaiAt(d, 12), lang).day) };
      }),
    [today, lang, t],
  );
  const quick = useMemo(() => quickTimes(), []);
  const due = order.promisedReadyAt;
  const now = nowIso();
  const set = (iso: string | undefined) =>
    run(async () => {
      await updateOrder(order.id, { promisedReadyAt: iso });
      haptic('selection');
      onDone();
    });
  // "Сегодня 18:00", "Завтра 12:00", "Сб 18:00"; in two hours — the words and the time beside them.
  const chip = (key: string, iso: string) => {
    const w = whenParts(iso, lang);
    if (key === 'in2h') return { label: t('job.dueQuick.in2h'), note: w.time };
    return { label: `${capital(w.day || t('offer.days0'))} ${w.time}`, note: '' };
  };
  return (
    <Stack gap="md">
      <div className="chip-row wrap">
        {quick.map((q) => {
          const c = chip(q.key, q.iso);
          return (
            <button key={q.key} type="button" className="chip" data-active={due === q.iso} onClick={() => set(q.iso)}>
              {c.label}
              {c.note && <span className="chip-note">{c.note}</span>}
            </button>
          );
        })}
      </div>
      {/* Any other day and hour, two taps: the day, then the time (Dubai time). */}
      <div>
        <div className="group-title">{t('job.dueOther')}</div>
        <div className="chip-row wrap" aria-label={t('job.dueDay')}>
          {days.map((d) => (
            <button key={d.day} type="button" className="chip" data-active={day === d.day} onClick={() => (setDay(d.day), haptic('selection'))}>
              {d.label}
            </button>
          ))}
        </div>
        <div className="chip-row wrap" style={{ marginTop: 10 }} aria-label={t('job.dueTime')}>
          {HOURS.map((h) => {
            const iso = dubaiAt(day, h);
            return (
              <button key={h} type="button" className="chip tnum" data-active={due === iso} disabled={iso < now} onClick={() => set(iso)}>
                {`${String(h).padStart(2, '0')}:00`}
              </button>
            );
          })}
        </div>
      </div>
      {due && (
        <Button variant="subtle" color="red" loading={busy} onClick={() => set(undefined)}>
          {t('job.dueClear')}
        </Button>
      )}
    </Stack>
  );
}
