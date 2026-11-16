import { useEffect } from 'react';

/**
 * Escape — and the phone's Back, which ui/backCloses.ts sends as Escape — closes only the sheet on top (v0.24). Mantine
 * closes every open modal on Escape, so a supplier's card held open over a part's sheet took the part's sheet, and what
 * was typed in it, away too. Sheets have `closeOnEscape` off (ui/theme.ts); here the one on top — the last in the page,
 * they share one layer — is closed by its own ×, else by a tap on its backdrop (a date's calendar has no ×). A field that
 * keeps Escape for its own list (`data-mantine-stop-propagation`) keeps it.
 */
export function useEscapeClosesTopSheet() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.getAttribute?.('data-mantine-stop-propagation') === 'true') return;
      const open = [...document.querySelectorAll<HTMLElement>('.mantine-Modal-root')].filter((r) => r.querySelector('.mantine-Modal-content'));
      const top = open[open.length - 1];
      (top?.querySelector<HTMLElement>('.mantine-Modal-close') ?? top?.querySelector<HTMLElement>('.mantine-Modal-overlay'))?.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
