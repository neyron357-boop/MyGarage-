import { ActionIcon } from '@mantine/core';
import { IconSparkles, IconWorldSearch } from '@tabler/icons-react';
import { useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { aiWorking, aiWorkVersion, subscribeAiWork, yandexUrl } from '../../services/ai';

/*
 * How the garage's AI looks (v0.48.1, the user: «улучши дизайн под ИИ, качественно и профессионально»): one mark — a
 * sparkle on its own colours — wherever it acts; it twinkles while the AI works. Styles — «The garage's AI» in styles.css.
 */

/** The AI is working on one of these (`car:<vehicleId>`, `name:<itemId>` — services/ai.ts). */
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

/** On a job's line: the AI looking at the part's name — the mark twinkling after the name. */
export function AiLineWork({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const busy = useAiWorking(`name:${itemId}`);
  if (!busy) return null;
  return (
    <span style={{ marginLeft: 6 }} className="fade-enter ai-line-work">
      <AiMark size={17} busy label={t('ai.working')} />
    </span>
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
