import { notifications } from '@mantine/notifications';
import { IconCircleCheckFilled } from '@tabler/icons-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { onAiNotice, type AiNotice } from '../../services/ai';
import { AiMark } from './Ai';

/**
 * What the garage's AI did by itself (v0.48, services/ai.ts), said once — as its own card (v0.48.1): its mark, what it
 * is about, the result to read at a glance (the car's values as pills; the name as it was, crossed, and as it is;
 * the number and how many catalogues have it), and «Отменить». It came by itself, so it waits its turn: it never takes
 * away the undo of what the user just did (as `undoToast` with `replace: false`).
 */
export function AiNotices() {
  const { t } = useTranslation();
  useEffect(
    () =>
      onAiNotice((n: AiNotice) => {
        const id = `ai-${Date.now()}`;
        let title: string;
        let body: ReactNode;
        if (n.kind === 'car') {
          title = t('ai.carTitle');
          const values = [n.filled.make, n.filled.model, n.filled.year, n.filled.engine, n.filled.type ? t(`vehicle.bodyTypes.${n.filled.type}`) : ''].filter(Boolean);
          body = (
            <span className="ai-pills">
              {values.map((v) => (
                <span key={String(v)} className="ai-pill">
                  {v}
                </span>
              ))}
            </span>
          );
        } else if (n.kind === 'name') {
          title = t('ai.nameTitle');
          body = (
            <>
              <span className="ai-toast-main">{n.to}</span>
              {n.from !== n.to && <span className="ai-toast-was">{n.from}</span>}
            </>
          );
        } else {
          title = t('ai.numberTitle');
          body = (
            <span className="ai-toast-main" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="ai-num-no">{n.number}</span>
              {n.catalogs > 0 && (
                <span className="ai-seen" aria-label={t('ai.seenIn', { count: n.catalogs })}>
                  <IconCircleCheckFilled size={15} aria-hidden />
                  {n.catalogs}
                </span>
              )}
            </span>
          );
        }
        notifications.show({
          id,
          className: 'ai-toast',
          autoClose: 6000,
          message: (
            <span className="ai-toast-body" data-ai-notice={n.kind}>
              <AiMark size={30} />
              <span className="ai-toast-text">
                <span className="ai-toast-title">{title}</span>
                {body}
              </span>
              <button
                type="button"
                className="ai-undo mantine-UnstyledButton-root"
                onClick={() => {
                  void n.undo();
                  notifications.hide(id);
                }}
              >
                {t('common.undo')}
              </button>
            </span>
          ),
        });
      }),
    [t],
  );
  return null;
}
