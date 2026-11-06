import { notifications } from '@mantine/notifications';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImmutableError } from '../db/db';
import type { Lang } from '../domain/types';
import { AppError } from '../services/errors';
import { loadOrderBundle } from '../services/orders';
import { getSettings } from '../services/settings';

export function useLang(): Lang {
  const { i18n } = useTranslation();
  return i18n.language === 'en' ? 'en' : 'ru';
}

export function useSettings() {
  return useLiveQuery(getSettings, []);
}

export function useOrderBundle(orderId: string | undefined) {
  return useLiveQuery(() => (orderId ? loadOrderBundle(orderId) : undefined), [orderId]);
}

/** Translate any thrown error into a user message. */
export function useErrorText() {
  const { t } = useTranslation();
  return useCallback(
    (e: unknown): string => {
      if (e instanceof AppError) {
        const missing = (e.params?.missing as string[] | undefined)?.map((m) => t(`missing.${m}`)).join(', ');
        return t(e.code, { ...e.params, missing });
      }
      if (e instanceof ImmutableError) return t('err.immutable');
      if (e instanceof Error && e.message === 'video_too_large') return t('err.videoTooLarge');
      return t('err.unexpected', { message: e instanceof Error ? e.message : String(e) });
    },
    [t],
  );
}

/** Run an async action with a busy flag and error/success notifications. */
export function useAction() {
  const errorText = useErrorText();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, successKey?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (successKey) notifications.show({ color: 'green', message: t(successKey) });
        return r;
      } catch (e) {
        console.error(e);
        notifications.show({ color: 'red', title: t('common.error'), message: errorText(e), autoClose: 7000 });
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [errorText, t],
  );
  return { run, busy };
}
