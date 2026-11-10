import { SegmentedControl, Stack, Switch, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { setLang } from '../i18n';
import { FormRow, RowGroup } from './components';
import { hapticsAvailable, iosVersion, isApple, useHaptics } from './haptics';
import { useLang } from './hooks';

function useAppearance() {
  const { t } = useTranslation();
  const lang = useLang();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return {
    lang,
    langData: [
      { value: 'ru', label: 'Русский' },
      { value: 'en', label: 'English' },
    ],
    setLang: (v: string) => setLang(v === 'en' ? 'en' : 'ru'),
    scheme: colorScheme === 'dark' ? 'dark' : colorScheme === 'auto' ? 'auto' : 'light',
    schemeData: [
      { value: 'light', label: t('app.themeLight') },
      { value: 'dark', label: t('app.themeDark') },
      { value: 'auto', label: t('app.themeAuto') },
    ],
    setScheme: (v: string) => setColorScheme(v === 'dark' ? 'dark' : v === 'auto' ? 'auto' : 'light'),
  };
}

/** Language and appearance switches, stacked (the PC sidebar). */
export function AppearanceControls() {
  const { t } = useTranslation();
  const a = useAppearance();
  return (
    <Stack gap={8}>
      <SegmentedControl fullWidth value={a.lang} onChange={a.setLang} aria-label={t('app.language')} data={a.langData} />
      <SegmentedControl fullWidth value={a.scheme} onChange={a.setScheme} aria-label={t('app.theme')} data={a.schemeData} />
    </Stack>
  );
}

/** The same as rows of an iOS settings group ("More" on a phone), with the haptics switch where the phone has them. */
export function AppearanceRows() {
  const { t } = useTranslation();
  const a = useAppearance();
  const [haptics, setHaptics] = useHaptics();
  const ios = iosVersion();
  // An iPhone older than iOS 18 has no haptics for web apps at all: say so instead of a dead switch.
  // No explaining what a switch does; only why it is missing on an old iPhone.
  const note = !hapticsAvailable() && isApple() && ios !== undefined && ios < 18 ? t('app.hapticsNeedsIos', { version: Math.floor(ios) }) : undefined;
  return (
    <RowGroup title={t('app.appearance')} note={note}>
      <FormRow label={t('app.language')}>
        <SegmentedControl value={a.lang} onChange={a.setLang} aria-label={t('app.language')} data={a.langData} />
      </FormRow>
      <FormRow label={t('app.theme')}>
        <SegmentedControl value={a.scheme} onChange={a.setScheme} aria-label={t('app.theme')} data={a.schemeData} />
      </FormRow>
      {hapticsAvailable() && (
        <FormRow label={t('app.haptics')}>
          <Switch checked={haptics} onChange={(e) => setHaptics(e.currentTarget.checked)} aria-label={t('app.haptics')} />
        </FormRow>
      )}
    </RowGroup>
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
