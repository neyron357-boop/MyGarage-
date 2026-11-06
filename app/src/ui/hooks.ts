import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { createElement, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImmutableError } from '../db/db';
import type { Lang } from '../domain/types';
import { AppError } from '../services/errors';
import { loadOrderBundle } from '../services/orders';
import { getSettings } from '../services/settings';
import { haptic } from './clipboard';

export const PHONE_QUERY = '(max-width: 48em)';

/** True on phone-sized screens (the layout switches at 768 px). */
export function usePhone(): boolean {
  return useMediaQuery(PHONE_QUERY, true, { getInitialValueInEffect: false }) ?? true;
}

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
      if (e instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(e.message)) return t('crash.updateText');
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
        if (successKey) notifications.show({ color: 'green', message: t(successKey), icon: createElement(IconCheck, { size: 18, stroke: 2.6 }) });
        return r;
      } catch (e) {
        console.error(e);
        notifications.show({ color: 'red', title: t('common.error'), message: errorText(e), autoClose: 7000, icon: createElement(IconAlertTriangle, { size: 18 }) });
        haptic([30, 40, 30]);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [errorText, t],
  );
  return { run, busy };
}
