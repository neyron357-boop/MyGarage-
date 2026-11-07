import { SegmentedControl, Stack, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { setLang } from '../i18n';
import { useLang } from './hooks';

/** Language and light/dark switches (sidebar on a PC, "More" on a phone). */
export function AppearanceControls() {
  const { t } = useTranslation();
  const lang = useLang();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Stack gap={8}>
      <SegmentedControl
        fullWidth
        value={lang}
        onChange={(v) => setLang(v === 'en' ? 'en' : 'ru')}
        aria-label={t('app.language')}
        data={[
          { value: 'ru', label: 'Русский' },
          { value: 'en', label: 'English' },
        ]}
      />
      <SegmentedControl
        fullWidth
        value={colorScheme === 'dark' ? 'dark' : 'light'}
        onChange={(v) => setColorScheme(v === 'dark' ? 'dark' : 'light')}
        aria-label={t('app.theme')}
        data={[
          { value: 'light', label: t('app.themeLight') },
          { value: 'dark', label: t('app.themeDark') },
        ]}
      />
    </Stack>
  );
}

/** Keeps the phone's status bar colour in step with the app's light/dark canvas. */
export function useStatusBarColor() {
  const scheme = useComputedColorScheme('light');
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = scheme === 'dark' ? '#000000' : '#f2f2f7';
  }, [scheme]);
}
