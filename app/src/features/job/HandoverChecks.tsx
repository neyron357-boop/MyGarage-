import { IconCheck } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { Order } from '../../domain/types';
import { saveQc } from '../../services/orders';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';

/** What is worth a look before the car goes back: none of it is required. */
export const HANDOVER_CHECKS = ['test_drive', 'no_leaks', 'washed', 'codes_cleared'] as const;

/**
 * Before handing the car over, four chips — test drive, no leaks, washed, codes cleared: a tap marks one
 * (they go into the work report). Nothing is required and "Hand over" stays one tap.
 */
export function HandoverChecks({ order }: { order: Pick<Order, 'id' | 'qcChecks'> }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const checks = order.qcChecks ?? {};
  const toggle = (c: string) =>
    run(async () => {
      await saveQc(order.id, { ...checks, [c]: !checks[c] });
      haptic('selection');
    });
  return (
    <div className="handover-checks">
      <div className="group-title">{t('qc.before')}</div>
      <div className="chip-row wrap">
        {HANDOVER_CHECKS.map((c) => (
          <button key={c} type="button" className="chip" data-active={!!checks[c]} aria-pressed={!!checks[c]} onClick={() => void toggle(c)}>
            {checks[c] && <IconCheck size={16} stroke={2.6} style={{ marginRight: 4, verticalAlign: -3 }} aria-hidden />}
            {t(`qc.${c}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
