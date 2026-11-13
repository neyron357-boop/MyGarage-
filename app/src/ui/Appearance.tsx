import { SegmentedControl, Stack, Switch, useComputedColorScheme } from '@mantine/core';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { setLang } from '../i18n';
import { FormRow, RowGroup } from './components';
import { hapticsAvailable, iosVersion, isApple, useHaptics } from './haptics';
import { useLang } from './hooks';
import { ACCENTS, ACCENT_COLOR, setAccent, useAccent } from './accent';
import { setSchemePref, useSchemePref } from './scheme';

function useAppearance() {
  const { t } = useTranslation();
  const lang = useLang();
  const scheme = useSchemePref();
  return {
    lang,
    langData: [
      { value: 'ru', label: 'Русский' },
      { value: 'en', label: 'English' },
    ],
    setLang: (v: string) => setLang(v === 'en' ? 'en' : 'ru'),
    scheme,
    schemeData: [
      { value: 'light', label: t('app.themeLight') },
      { value: 'dark', label: t('app.themeDark') },
      { value: 'auto', label: t('app.themeAuto') },
    ],
    // Auto: light by day, dark by night (sunrise and sunset in Dubai).
    setScheme: (v: string) => setSchemePref(v === 'dark' ? 'dark' : v === 'auto' ? 'auto' : 'light'),
  };
}

/** The accent colour: a row of round swatches, the chosen one ringed (like the iPhone's own colour pickers). */
export function AccentPicker() {
  const { t } = useTranslation();
  const accent = useAccent();
  return (
    <div className="accent-swatches" role="radiogroup" aria-label={t('app.accent')}>
      {ACCENTS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          className="accent-swatch"
          aria-checked={a === accent}
          aria-label={t(`app.accents.${a}`)}
          data-active={a === accent || undefined}
          style={{ '--c': `var(--mantine-color-${ACCENT_COLOR[a]}-6)` } as React.CSSProperties}
          onClick={() => setAccent(a)}
        />
      ))}
    </div>
  );
}

/** Language and appearance switches, stacked (the PC sidebar). */
export function AppearanceControls() {
  const { t } = useTranslation();
  const a = useAppearance();
  return (
    <Stack gap={8}>
      <SegmentedControl fullWidth value={a.lang} onChange={a.setLang} aria-label={t('app.language')} data={a.langData} />
      <SegmentedControl fullWidth value={a.scheme} onChange={a.setScheme} aria-label={t('app.theme')} data={a.schemeData} />
      <AccentPicker />
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
      <FormRow label={t('app.accent')}>
        <AccentPicker />
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
