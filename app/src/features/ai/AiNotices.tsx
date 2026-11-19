import { notifications } from '@mantine/notifications';
import { IconCircleCheckFilled, IconHistory } from '@tabler/icons-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { dayShort, dubaiDate } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import { useLang } from '../../ui/hooks';
import { onAiNotice, type AiNotice } from '../../services/ai';
import { chime } from '../../ui/sound';
import { AiMark } from './Ai';

/**
 * What the garage's AI did by itself (v0.48, services/ai.ts), said once — as its own card (v0.48.1): its mark, what it
 * is about, the result to read at a glance (the car's values as pills; the name as it was, crossed, and as it is;
 * the number and how many catalogues have it), and «Отменить». It came by itself, so it waits its turn: it never takes
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
        } else if (n.kind === 'parts') {
          // Every part of a job (v0.52): how many lines, and what was done to them.
          title = t('ai.partsTitle', { count: n.lines });
          body = (
            <span className="ai-toast-sub" data-ai-parts-done>
              {[n.names ? t('ai.partsNames', { count: n.names }) : '', n.numbers ? t('ai.partsNumbers', { count: n.numbers }) : '', n.pictures ? t('ai.partsPictures', { count: n.pictures }) : ''].filter(Boolean).join(' · ') || t('ai.partsNothing')}
            </span>
          );
        } else if (n.kind === 'expense') {
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
        } else {
          // From the garage's own jobs (v0.49) — said so: no catalogue was asked.
          title = n.catalogs === 0 && n.garage > 0 ? t('ai.numberGarage') : t('ai.numberTitle');
          body = (
            <span className="ai-toast-main" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="ai-num-no">{n.number}</span>
              {n.catalogs > 0 && (
                <span className="ai-seen" aria-label={t('ai.seenIn', { count: n.catalogs })}>
                  <IconCircleCheckFilled size={15} aria-hidden />
                  {n.catalogs}
                </span>
              )}
              {n.garage > 0 && (
                <span className="ai-seen" aria-label={t('ai.usedIn', { count: n.garage })}>
                  <IconHistory size={15} stroke={2.2} aria-hidden />
                  {n.garage}
                </span>
              )}
            </span>
          );
        }
        // The AI has finished with a result: its sound (v0.52) — a long work finished, three notes.
        chime(n.kind === 'parts' ? 'done' : 'found');
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
    [t, lang],
  );
  return null;
}
