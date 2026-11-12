import { Badge } from '@mantine/core';
import { IconArchive, IconCalendarTime, IconCash, IconEye, IconHourglassHigh, IconKey, IconTag, IconTool, IconX, type Icon } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { Phase } from '../../domain/flow';

/** How each step of a job looks: one colour and one symbol, on the board and on the job. */
export const PHASE_META: Record<Phase, { color: string; icon: Icon }> = {
  booked: { color: 'gray', icon: IconCalendarTime },
  look: { color: 'cobalt', icon: IconEye },
  price: { color: 'grape', icon: IconTag },
  wait: { color: 'orange', icon: IconHourglassHigh },
  work: { color: 'teal', icon: IconTool },
  pay: { color: 'green', icon: IconCash },
  out: { color: 'green', icon: IconKey },
  debt: { color: 'red', icon: IconCash },
  closed: { color: 'gray', icon: IconArchive },
  cancelled: { color: 'gray', icon: IconX },
};

/** The steps a car in the workshop goes through, in order (board filters, columns). */
export const BOARD_PHASES: Phase[] = ['look', 'price', 'wait', 'work', 'pay', 'out'];

/**
 * Where the job is on its way, at a glance: six short segments (look · price · wait · work · pay · out),
 * filled up to the step it is on, that one wider. When the job moves on, the fill runs to the next
 * segment. Not for appointments and closed jobs (they are not on the way).
 */
export function PhaseTrack({ phase }: { phase: Phase }) {
  const { t } = useTranslation();
  const at = BOARD_PHASES.indexOf(phase === 'debt' ? 'out' : phase);
  if (at < 0) return null;
  return (
    <div className="phase-track" role="img" aria-label={`${t(`job.phase.${phase}`)} · ${at + 1}/${BOARD_PHASES.length}`} style={{ '--phase': `var(--mantine-color-${PHASE_META[phase].color}-6)` } as React.CSSProperties}>
      {BOARD_PHASES.map((p, i) => (
        <span key={p} data-on={i <= at || undefined} data-now={i === at || undefined} style={{ transitionDelay: `${i * 40}ms` }} />
      ))}
    </div>
  );
}

export function PhasePill({ phase, size = 'lg' }: { phase: Phase; size?: 'sm' | 'md' | 'lg' }) {
  const { t } = useTranslation();
  const m = PHASE_META[phase];
  return (
    <Badge color={m.color} variant="light" size={size} leftSection={<m.icon size={size === 'sm' ? 12 : 15} stroke={2} />} style={{ flexShrink: 0 }}>
      {t(`job.phase.${phase}`)}
    </Badge>
  );
}
