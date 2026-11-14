import type { ComboboxItem, OptionsFilter } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ImmutableError } from '../db/db';
import type { Lang } from '../domain/types';
import { AppError } from '../services/errors';
import { loadOrderBundle, seenBundle } from '../services/orders';
import { getSettings } from '../services/settings';
import { haptic } from './haptics';
import { useScreen } from './stack';

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

/**
 * useLiveQuery that rests while its screen is not in front (the board under a job, a job under its
 * details): nothing is read or re-rendered for a screen nobody sees. Back in front it reads again;
 * meanwhile its last result stands (and shows under the finger during the swipe back).
 *
 * `wakeAfter` (ms) — a heavy read (every past job, the search index) waits that long after the screen is
 * back in front: the way back slides on, the read follows.
 */
export function useScreenLiveQuery<T>(query: () => Promise<T> | T, deps: unknown[], wakeAfter = 0): T | undefined {
  const screen = useScreen() ?? ALWAYS_FRONT;
  // Renders again only when the screen comes back to the front (stepping back renders nothing).
  const wakes = useSyncExternalStore(screen.watch, screen.wakes);
  const [caught, setCaught] = useState(wakes);
  useEffect(() => {
    if (!wakeAfter || caught === wakes) return;
    const t = window.setTimeout(() => setCaught(wakes), wakeAfter);
    return () => window.clearTimeout(t);
  }, [wakeAfter, wakes, caught]);
  const turn = wakeAfter ? caught : wakes;
  const last = useRef<T | undefined>(undefined);
  // Behind another screen a change in the database runs this once more: it reads nothing (so it is
  // not run again) and keeps what it had. A screen first mounted behind (after going back) reads once.
  const live = useLiveQuery(() => (screen.front() || last.current === undefined ? query() : last.current), [turn, ...deps]);
  if (live !== undefined) last.current = live;
  return live ?? last.current;
}
const ALWAYS_FRONT = { front: () => true, wakes: () => 0, watch: () => () => {} };

export function useOrderBundle(orderId: string | undefined) {
  const live = useScreenLiveQuery(() => (orderId ? loadOrderBundle(orderId) : undefined), [orderId]);
  // What was read a moment ago (by the board, by the last visit) shows at once; the live read follows.
  if (live && live.order.id === orderId) return live;
  return orderId ? seenBundle(orderId) : undefined;
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

/**
 * Run an async action with a busy flag and error/success notifications.
 *
 * `exclusive`: for actions whose repeat makes a second record (a job, a payment, a debt) — while one
 * runs, another call of this hook does nothing (a double tap, Enter and a tap together). Not for hooks
 * that serve several actions or saves that overlap on purpose (a field's blur-save and the chip tapped
 * in the same touch, keystrokes): there a dropped call would lose the user's input.
 */
export function useAction({ exclusive = false }: { exclusive?: boolean } = {}) {
  const errorText = useErrorText();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // In flight right now: set at once, not on the next render.
  const inflight = useRef(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, successKey?: string): Promise<T | undefined> => {
      if (exclusive && inflight.current) return undefined;
      inflight.current = true;
      setBusy(true);
      try {
        const r = await fn();
        if (successKey) notifications.show({ color: 'green', message: t(successKey), icon: createElement(IconCheck, { size: 18, stroke: 2.6 }) });
        return r;
      } catch (e) {
        console.error(e);
        notifications.show({ color: 'red', title: t('common.error'), message: errorText(e), autoClose: 7000, icon: createElement(IconAlertTriangle, { size: 18 }) });
        haptic('error');
        return undefined;
      } finally {
        inflight.current = false;
        setBusy(false);
      }
    },
    [errorText, t, exclusive],
  );
  return { run, busy };
}

/**
 * Autocomplete filter: suggestions appear only once something is typed (an empty field must not
 * cover the phone screen with a list), best matches — those starting with the text — first.
 */
export const typedOnly: OptionsFilter = ({ options, search, limit }) => {
  const q = search.trim().toLowerCase();
  if (!q) return [];
  // What is already typed in full is not offered again (the list would only cover the form).
  const items = options.filter((o): o is ComboboxItem => 'value' in o && o.label.toLowerCase() !== q);
  const starts = items.filter((o) => o.label.toLowerCase().startsWith(q));
  const contains = items.filter((o) => !o.label.toLowerCase().startsWith(q) && o.label.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
};
