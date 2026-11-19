import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { onAiNotice, type AiNotice } from '../../services/ai';
import { undoToast } from '../../ui/components';

/**
 * What the garage's AI did by itself (v0.48, services/ai.ts): said once, with «Отменить». It came by itself, so it waits
 * its turn (`replace: false`): it never takes away the undo of what the user just did.
 */
export function AiNotices() {
  const { t } = useTranslation();
  useEffect(
    () =>
      onAiNotice((n: AiNotice) => {
        const text =
          n.kind === 'car'
            ? t('ai.car', {
                what: [n.filled.make, n.filled.model, n.filled.year, n.filled.engine, n.filled.type ? t(`vehicle.bodyTypes.${n.filled.type}`) : '']
                  .filter(Boolean)
                  .join(' · '),
              })
            : n.kind === 'name'
              ? t('ai.name', { to: n.to })
              : t('ai.number', { number: n.number });
        undoToast(text, t('common.undo'), () => void n.undo(), { replace: false });
      }),
    [t],
  );
  return null;
}
