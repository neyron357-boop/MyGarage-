import { ActionIcon, Text } from '@mantine/core';
import { IconCircle, IconCircleCheckFilled, IconHelpCircleFilled, IconHistory, IconRefresh, IconSparkles, IconWorldSearch } from '@tabler/icons-react';
import { useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { catalogCount } from '../../domain/ai';
import { aiAllParts, aiFindPart, aiOn, aiPartsProgress, aiWorking, aiWorkVersion, subscribeAiWork, yandexUrl } from '../../services/ai';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';

/*
 * How the garage's AI looks (v0.48.1, the user: «улучши дизайн под ИИ, качественно и профессионально»): one mark — a
 * sparkle on its own colours — wherever it acts; it twinkles while the AI works; what it found is laid out to be read
 * at a glance and taken with a tap. Styles — «The garage's AI» in styles.css.
 */

/** The AI is working on one of these (`car:<vehicleId>`, `name:<itemId>`, `find:<itemId>` — services/ai.ts). */
export function useAiWorking(...keys: string[]): boolean {
  useSyncExternalStore(subscribeAiWork, aiWorkVersion);
  return keys.some(aiWorking);
}

/** The AI's mark: a sparkle on its colours, like an app's icon; `busy` — twinkling, the AI at work. */
export function AiMark({ size = 22, busy, label }: { size?: number; busy?: boolean; label?: string }) {
  return (
    <span className="ai-mark" data-busy={busy || undefined} style={{ '--s': `${size}px` } as CSSProperties} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <IconSparkles stroke={2.2} />
    </span>
  );
}

/** On a job's line: the AI looking at it (its name, its number) — the mark twinkling after the name. */
export function AiLineWork({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const busy = useAiWorking(`name:${itemId}`, `find:${itemId}`);
  if (!busy) return null;
  return (
    <span style={{ marginLeft: 6 }} className="fade-enter">
      <AiMark size={17} busy label={t('ai.working')} />
    </span>
  );
}

/**
 * Under a job's lines (v0.52): the AI for every part at once — its mark on a narrow tile, twinkling while it works,
 * how many lines are done under it. Only where the garage's AI is.
 */
export function AiPartsTile({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  useSyncExternalStore(subscribeAiWork, aiWorkVersion);
  if (!aiOn()) return null;
  const busy = aiWorking(`all:${orderId}`);
  const p = aiPartsProgress(orderId);
  return (
    <button type="button" className="action-tile add-extra ai-parts-tile" aria-label={t('ai.allParts')} aria-busy={busy || undefined} data-ai-parts={busy ? 'busy' : ''} disabled={busy} onClick={() => void aiAllParts(orderId)}>
      <AiMark size={24} busy={busy} />
      {busy && p && <span className="ai-parts-n tnum">{p.done}/{p.total}</span>}
    </button>
  );
}

/** A part number looked up on Yandex — a round globe button (opens the browser). */
export function YandexButton({ number, size = 34 }: { number: string; size?: number }) {
  const { t } = useTranslation();
  if (!number.trim()) return null;
  return (
    <ActionIcon
      component="a"
      href={yandexUrl(number)}
      target="_blank"
      rel="noopener noreferrer"
      variant="light"
      color="gray"
      radius="xl"
      size={size}
      aria-label={t('ai.yandex')}
      title={t('ai.yandex')}
      onClick={(e) => e.stopPropagation()}
    >
      <IconWorldSearch size={Math.round(size * 0.53)} stroke={1.8} />
    </ActionIcon>
  );
}

const plain = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * The part's numbers from the catalogues (the part's sheet): while the AI looks — its mark twinkles over two shimmering
 * rows; then a row a number: the number large, the maker and what it is for under it, seen in how many catalogues
 * (green) or not checked (orange); a tap takes it into «Номер», the globe looks it up on Yandex, ↻ looks again.
 */
export function AiPartNumbers({ itemId, chosen, onPick }: { itemId: string; chosen: string; onPick: (n: string) => void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const live = useScreenLiveQuery(() => db.items.get(itemId), [itemId]);
  const busy = useAiWorking(`find:${itemId}`, `name:${itemId}`);
  const on = aiOn();
  const find = live?.aiFind;
  if (!live || (!find && !on)) return null;
  const again = () => run(async () => void (await aiFindPart(itemId, { again: true })));
  return (
    <div className="ai-block" aria-busy={busy || undefined} data-ai-numbers>
      {find || busy ? (
        <div className="ai-head">
          <AiMark busy={busy} />
          <span className="ai-text">{find?.search === 'garage' ? t('ai.ownJobs') : t('ai.catalogs')}</span>
          {on && !busy && (
            <ActionIcon variant="subtle" color="gray" radius="xl" size={32} aria-label={t('ai.again')} onClick={again}>
              <IconRefresh size={18} stroke={1.8} />
            </ActionIcon>
          )}
        </div>
      ) : (
        <button type="button" className="ai-find" onClick={again}>
          <AiMark />
          <span className="ai-text">{t('ai.find')}</span>
        </button>
      )}
      {busy && !find?.numbers.length && (
        <>
          <div className="skeleton ai-skel" />
          <div className="skeleton ai-skel" style={{ width: '72%' }} />
        </>
      )}
      {find && !busy && !find.numbers.length && (
        <Text size="sm" c="dimmed" py={6}>
          {t('ai.none')}
        </Text>
      )}
      {find?.numbers.map((n) => {
        const count = find.search !== 'model' ? catalogCount(n.seen) : 0;
        const garage = n.garage ?? 0;
        // Not seen in a catalogue nor used by the garage: a guess — orange.
        const unsure = count === 0 && garage === 0;
        const taken = !!chosen.trim() && plain(chosen) === plain(n.number);
        return (
          <div key={n.number} className="ai-num" data-unsure={unsure || undefined} data-garage={garage || undefined}>
            <button type="button" className="ai-pick" aria-pressed={taken} onClick={() => onPick(n.number)}>
              {taken ? <IconCircleCheckFilled size={22} color="var(--mantine-color-cobalt-6)" aria-hidden /> : <IconCircle size={22} stroke={1.6} color="var(--app-label-3)" aria-hidden />}
              <span className="ai-num-main">
                <span className="ai-num-no">{n.number}</span>
                {(n.brand || n.note || garage > 0) && (
                  <span className="ai-num-sub">{[garage > 0 ? t('ai.usedIn', { count: garage }) : '', n.brand, n.note].filter(Boolean).join(' · ')}</span>
                )}
              </span>
              {garage > 0 && count === 0 ? (
                <span className="ai-seen" title={t('ai.usedIn', { count: garage })} aria-label={t('ai.usedIn', { count: garage })}>
                  <IconHistory size={16} stroke={2.2} aria-hidden />
                  {garage}
                </span>
              ) : unsure ? (
                <span className="ai-seen" data-unsure title={t('ai.unsure')} aria-label={t('ai.unsure')}>
                  <IconHelpCircleFilled size={17} aria-hidden />
                </span>
              ) : (
                <span className="ai-seen" title={t('ai.seenIn', { count })} aria-label={t('ai.seenIn', { count })}>
                  <IconCircleCheckFilled size={15} aria-hidden />
                  {count}
                </span>
              )}
            </button>
            <YandexButton number={n.number} />
          </div>
        );
      })}
    </div>
  );
}

