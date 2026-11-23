import { Modal } from '@mantine/core';
import { IconCalendar } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dayShort } from '../../domain/dates';
import { jobDay, lastJobDay } from '../../domain/jobDay';
import type { Invoice, Order, Payment } from '../../domain/types';
import { setJobDay } from '../../services/orders';
import { FormRow, RowGroup } from '../../ui/components';
import { DayPill } from '../../ui/DateFields';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';

/*
 * The day of a job (v0.53, the user: «добавлять работы и инвойс задним числом — забыли добавить в систему работу, которая
 * была месяц назад»): «…» → «День» (or the chip once it is an earlier day) — the day the car came; not after today, nor
 * after its first invoice or payment. A job on an earlier day has its chip on the card, its invoice offered on that day.
 */

type Job = { order: Pick<Order, 'id' | 'arrivedAt' | 'createdAt' | 'backdated'>; invoices: Pick<Invoice, 'issuedAt'>[]; payments: Pick<Payment, 'receivedAt'>[] };

export function JobDaySheet({ job, opened, onClose }: { job: Job; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  return (
    <LazySheet opened={opened}>
      {(o) => (
        <Modal opened={o} onClose={onClose} title={t('job.dayTitle')}>
          <RowGroup mt={0}>
            <FormRow label={t('job.day')}>
              <DayPill
                value={jobDay(job.order)}
                max={lastJobDay(job.invoices, job.payments)}
                label={t('job.day')}
                onChange={(day) =>
                  void run(async () => {
                    await setJobDay(job.order.id, day);
                    haptic('light');
                    onClose();
                  })
                }
              />
            </FormRow>
          </RowGroup>
        </Modal>
      )}
    </LazySheet>
  );
}

/** A job on an earlier day: its day — a chip on the card (a tap changes it; in a closed month — v0.69 — only says it). */
export function JobDayChip({ job, fixed }: { job: Job; fixed?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!job.order.backdated) return null;
  return (
    <>
      <button type="button" className="chip day-chip" disabled={fixed} onClick={() => setOpen(true)} aria-label={t('job.day')} data-job-day={jobDay(job.order)}>
        <IconCalendar size={16} stroke={2} aria-hidden />
        {(() => {
          const d = dayShort(job.order.arrivedAt ?? job.order.createdAt);
          return d.word ? t(`common.${d.word}`) : d.text;
        })()}
      </button>
      <JobDaySheet job={job} opened={open} onClose={() => setOpen(false)} />
    </>
  );
}
