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
    // Entries of sheets closed from inside while a full-screen layer was opened over them (v0.90: «…» → «Смета» — the
    // sheet closes, the PDF viewer opens before it is gone): under the layer's own entry, dropped once it has gone.
    let pending = 0;

    const sync = () => {
      frame = 0;
      for (const el of document.querySelectorAll(OVERLAY)) {
        if (tracked.has(el)) continue;
        tracked.set(el, { popped: false });
        history.pushState({ ...(history.state ?? {}), mgSheet: true }, '');
      }
      let drop = 0;
      for (const [el, st] of tracked) {
        if (el.isConnected) continue;
        tracked.delete(el);
        if (!st.popped) drop++;
      }
      // Closed from inside the sheet: drop our entries, unless a button already navigated away — several sheets closed
      // together (a sheet and the list it was opened from) in one step: two history.back() in a row may be taken as one.
      // A layer over them (a viewer, the camera): its own entry is on top — theirs go when it has (or Back would close it).
      pending += drop;
      if (pending && layers.open > 0) return;
      if (pending && history.state?.mgSheet) {
        ignorePops++;
        history.go(-pending);
      }
      pending = 0;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };

    const onPop = () => {
      // A layer that just went: the entries of sheets closed under it go now.
      if (pending) schedule();
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
