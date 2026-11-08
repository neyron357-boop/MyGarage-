import { useEffect } from 'react';
import { layers } from './historyLayer';

const OVERLAY = '.mantine-Modal-content, .mantine-Drawer-content';

/**
 * Phones: the system Back button (or the back swipe) closes an open sheet instead of leaving the
 * screen with a half-filled form behind it. When a sheet appears we add one history entry with the
 * same address; Back pops it and we close the sheet (Mantine closes sheets on Escape). When the sheet
 * is closed with ×/Cancel/Save, that extra entry is removed again.
 */
export function useBackClosesSheets(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    // Sheets on screen in the order they opened; `popped` = closing was started by Back.
    const tracked = new Map<Element, { popped: boolean }>();
    let ignorePops = 0;
    let frame = 0;

    const sync = () => {
      frame = 0;
      for (const el of document.querySelectorAll(OVERLAY)) {
        if (tracked.has(el)) continue;
        tracked.set(el, { popped: false });
        history.pushState({ ...(history.state ?? {}), mgSheet: true }, '');
      }
      for (const [el, st] of tracked) {
        if (el.isConnected) continue;
        tracked.delete(el);
        // Closed from inside the sheet: drop our entry, unless a button already navigated away.
        if (!st.popped && history.state?.mgSheet) {
          ignorePops++;
          history.back();
        }
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };

    const onPop = () => {
      if (ignorePops > 0) {
        ignorePops--;
        return;
      }
      // A camera or photo viewer over the sheet handles Back itself (or just removed its own step).
      if (layers.open > 0 || Date.now() < layers.ignorePopsUntil) return;
      const open = [...tracked.values()].filter((s) => !s.popped);
      const top = open[open.length - 1];
      if (!top) return;
      top.popped = true;
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };

    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', onPop);
    return () => {
      mo.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('popstate', onPop);
    };
  }, [enabled]);
}
