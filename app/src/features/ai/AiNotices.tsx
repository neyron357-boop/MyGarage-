import { notifications } from '@mantine/notifications';
import { IconCar } from '@tabler/icons-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { dayShort, dubaiDate } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import { useLang } from '../../ui/hooks';
import { onAiNotice, type AiNotice } from '../../services/ai';
import { openRoute } from '../../ui/openRoute';
import { chime } from '../../ui/sound';
import { AiMark } from './Ai';

/**
 * What the garage's AI did by itself (v0.48, services/ai.ts), said once — as its own card (v0.48.1): its mark, what it
 * is about, the result to read at a glance (the car's values as pills; the name as it was, crossed, and as it is;
 * a receipt's sum, seller and day), and «Отменить». It came by itself, so it waits its turn: it never takes
 * away the undo of what the user just did (as `undoToast` with `replace: false`).
 */
export function AiNotices() {
  const { t } = useTranslation();
  const lang = useLang();
  const day = (date: string) => {
    const d = dayShort(`${date}T12:00:00+04:00`, `${dubaiDate()}T12:00:00+04:00`);
    return d.word ? t(`common.${d.word}`) : d.text;
  };
  useEffect(
    () =>
      onAiNotice((n: AiNotice) => {
        const id = `ai-${Date.now()}`;
        let title: string;
        let body: ReactNode;
        // Said by the garage's own car of the same VIN (v0.88): not the AI's — no mark of it, no sound.
        const garage = n.kind === 'car' && n.from === 'garage';
        if (n.kind === 'car') {
          // Seen on the car's photo (v0.89): the AI's, its mark and sound.
          title = garage ? t('ai.carGarage') : n.from === 'photo' ? t('ai.carPhoto') : t('ai.carTitle');
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
        } else if (n.kind === 'request') {
          // A customer's request in WhatsApp made a job of «Заявки» (v0.90, #69): a tap — the job.
          title = t('ai.requestTitle');
          body = (
            <button type="button" className="ai-toast-main ai-toast-link" data-ai-request={n.orderId} onClick={() => (openRoute(`/orders/${n.orderId}`), notifications.hide(id))}>
              {[`№${n.number}`, n.car].filter(Boolean).join(' · ')}
            </button>
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
          // A receipt recorded as an expense (v0.50): the sum and the seller, the job it went to (or none — a tap away in the sheet).
          title = n.close ? t('ai.receiptClose') : t('ai.receiptTitle');
          body = (
            <>
              <span className="ai-toast-main">{[formatAed(n.amountFils, lang), n.vendor].filter(Boolean).join(' · ')}</span>
              <span className="ai-toast-sub">
                {/* The receipt's day (v0.50.2): a digit hidden or its year put right — orange, to look at. */}
                <span className={n.dateSure ? undefined : 'ai-unsure'} data-receipt-date={n.date}>
                  {day(n.date)}
                  {n.dateSure ? '' : '?'}
                </span>
                {' · '}
                {[n.job ? `№${n.job.number}${n.job.car ? ` · ${n.job.car}` : ''}` : t('ai.receiptNoJob'), n.supplier?.added ? t('ai.receiptSupplierNew') : '', t('ai.receiptItems', { count: n.items })].filter(Boolean).join(' · ')}
              </span>
            </>
          );
        }
        // The AI has finished with a result: its sound (v0.52).
        if (!garage) chime('found');
        const undo = n.undo;
        notifications.show({
          id,
          className: 'ai-toast',
          autoClose: 6000,
          message: (
            <span className="ai-toast-body" data-ai-notice={garage ? 'garage' : n.kind}>
              {garage ? (
                <span className="ai-garage-mark" aria-hidden>
                  <IconCar size={20} stroke={2} />
                </span>
              ) : (
                <AiMark size={30} />
              )}
              <span className="ai-toast-text">
                <span className="ai-toast-title">{title}</span>
                {body}
              </span>
              {undo && (
                <button
                  type="button"
                  className="ai-undo mantine-UnstyledButton-root"
                  onClick={() => {
                    void undo();
                    notifications.hide(id);
                  }}
                >
                  {t('common.undo')}
                </button>
              )}
            </span>
          ),
        });
      }),
    [t, lang],
  );
  return null;
}
