import { Badge } from '@mantine/core';
import { IconArchive, IconCalendarTime, IconCash, IconEye, IconHourglassHigh, IconKey, IconTag, IconTool, IconX, type Icon } from '@tabler/icons-react';
import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Phase } from '../../domain/flow';
import type { Stage } from '../../domain/types';
import { phaseOf } from '../../services/flow';
import { loadOrderBundle } from '../../services/orders';
import { useScreenLiveQuery } from '../../ui/hooks';

/**
 * How each step of a job looks: one colour of the iOS palette and one symbol — the board's filters and rows,
 * the job's pill, track and the glow over its screen (with a second, neighbouring hue `glow`). The colour
 * says where the car is before any word.
 */
export const PHASE_META: Record<Phase, { color: string; glow: string; icon: Icon }> = {
  booked: { color: 'gray', glow: 'gray', icon: IconCalendarTime },
  look: { color: 'indigo', glow: 'cyan', icon: IconEye },
  price: { color: 'grape', glow: 'pink', icon: IconTag },
  wait: { color: 'orange', glow: 'yellow', icon: IconHourglassHigh },
  work: { color: 'blue', glow: 'cyan', icon: IconTool },
  pay: { color: 'green', glow: 'teal', icon: IconCash },
  out: { color: 'teal', glow: 'green', icon: IconKey },
  debt: { color: 'red', glow: 'orange', icon: IconCash },
  closed: { color: 'gray', glow: 'gray', icon: IconArchive },
  cancelled: { color: 'gray', glow: 'gray', icon: IconX },
};

/**
 * The screen of a job glows in the colour of its step: the two hues go on the screen's own body (phone) or
 * the page (PC) as the variables its glow is painted with — a style write, no selector watching the page.
 */
export function usePhaseGlow(ref: React.RefObject<HTMLElement | null>, phase: Phase | undefined) {
  useLayoutEffect(() => {
    const host = ref.current?.closest<HTMLElement>('.screen-body, .page-shell');
    if (!host || !phase) return;
    const m = PHASE_META[phase];
    host.style.setProperty('--glow', `var(--mantine-color-${m.color}-6)`);
    host.style.setProperty('--glow-2', `var(--mantine-color-${m.glow}-6)`);
    return () => {
      host.style.removeProperty('--glow');
      host.style.removeProperty('--glow-2');
    };
  }, [ref, phase]);
}

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

export function PhasePill({ phase, size = 'lg', filled }: { phase: Phase; size?: 'sm' | 'md' | 'lg'; /** Solid colour, white words (the job's own head). */ filled?: boolean }) {
  const { t } = useTranslation();
  const m = PHASE_META[phase];
  return (
    <Badge color={m.color} variant={filled ? 'filled' : 'light'} size={size} className={filled ? 'phase-pill-filled' : undefined} leftSection={<m.icon size={size === 'sm' ? 12 : 15} stroke={2} />} style={{ flexShrink: 0 }}>
      {t(`job.phase.${phase}`)}
    </Badge>
  );
}

/**
 * Where a job stands, in the board's words wherever it is listed (search, a customer's or a car's
 * visits): its step, colour and symbol, while it is open; closed or cancelled as such.
 */
export function OrderStatus({ orderId, stage }: { orderId: string; stage: Stage }) {
  const ended = stage === 'closed' || stage === 'cancelled';
  const phase = useScreenLiveQuery(async () => {
    if (ended) return stage as Phase;
    const b = await loadOrderBundle(orderId);
    return b ? phaseOf(b) : null;
  }, [orderId, stage]);
  // The pill's room is kept while the step is read (no jump of the row).
  if (!phase) return <span className="phase-pill-space" aria-hidden />;
  return <PhaseTag phase={phase} />;
}

/** A job's step as a board row shows it: a small capsule of its colour with its symbol (lists, search). */
export function PhaseTag({ phase, children }: { phase: Phase; /** After the name ("· 3 ч"). */ children?: React.ReactNode }) {
  const { t } = useTranslation();
  const m = PHASE_META[phase];
  return (
    <span className="row-phase tnum" style={{ background: `var(--mantine-color-${m.color}-light)`, color: `var(--mantine-color-${m.color}-light-color)` }}>
      <m.icon size={13} stroke={2.4} aria-hidden />
      {t(`job.phase.${phase}`)}
      {children}
    </span>
  );
}
