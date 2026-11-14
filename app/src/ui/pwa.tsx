import { Button, CloseButton, Group, Text, ThemeIcon } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconRefresh } from '@tabler/icons-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

/* ---------------- Install ---------------- */

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  // Chrome/Edge/Android fire this once the app is installable; keep it for our own "Install" button.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emit();
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether the app can be installed right now and how. */
export function useInstall() {
  const prompt = useSyncExternalStore(subscribe, () => deferredPrompt);
  const standalone = isStandalone();
  return {
    standalone,
    /** Chrome/Edge/Android: our button opens the browser's install dialog. */
    canPrompt: !!prompt && !standalone,
    /** iPhone/iPad Safari: no dialog, the user adds the app from the Share menu. */
    iosManual: isIos() && !standalone,
    install: async () => {
      if (!deferredPrompt) return false;
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
      deferredPrompt = null;
      emit();
      return choice.outcome === 'accepted';
    },
  };
}

/* ---------------- Updates ---------------- */

const OFFLINE_SHOWN_KEY = 'mygarage.offlineReadyShown';

/**
 * Look for a new version of the app now (pull to refresh): when there is one, it downloads and the
 * "Update" bar shows (`PwaUpdater`). Quietly nothing without a service worker (dev, plain http).
 */
export async function checkForUpdate(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    // offline, or no service worker: nothing to look for
  }
}

/**
 * Service worker updates: a new version downloads in the background and is applied only when the
 * user taps "Update", so nobody loses a signature in progress. Also catches the case when an old
 * open tab cannot load a part of the app that a newer version replaced.
 */
export function PwaUpdater() {
  const { t } = useTranslation();
  const [stale, setStale] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for a new version every hour while the app stays open all day.
      if (reg) setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
    },
  });

  useEffect(() => {
    if (!offlineReady) return;
    try {
      if (localStorage.getItem(OFFLINE_SHOWN_KEY)) return;
      localStorage.setItem(OFFLINE_SHOWN_KEY, '1');
    } catch {
      // ignore
    }
    notifications.show({ color: 'green', message: t('pwa.offlineReady'), autoClose: 4000 });
  }, [offlineReady, t]);

  useEffect(() => {
    const onPreloadError = (e: Event) => {
      e.preventDefault();
      setStale(true);
    };
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => window.removeEventListener('vite:preloadError', onPreloadError);
  }, []);

  if (!needRefresh && !stale) return null;
  return (
    <div className="update-bar no-print" role="status">
      <Group gap="sm" wrap="nowrap" align="center">
        <ThemeIcon color="cobalt" variant="filled" radius="xl" size={34}>
          <IconRefresh size={18} />
        </ThemeIcon>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text fw={700} size="sm">
            {t('pwa.updateTitle')}
          </Text>
          <Text size="xs" c="dimmed">
            {t('pwa.updateText')}
          </Text>
        </div>
        <Button size="compact-md" onClick={() => (needRefresh ? void updateServiceWorker(true) : window.location.reload())}>
          {t('pwa.update')}
        </Button>
        {needRefresh && <CloseButton aria-label={t('pwa.later')} onClick={() => setNeedRefresh(false)} />}
      </Group>
    </div>
  );
}
