import { useCallback, useEffect, useRef } from 'react';

const openLayers: Record<string, number> = {};

/**
 * Shared with the sheet Back handling (`backCloses`): while a full-screen layer is open, Back is
 * the layer's; and the history step a layer removes when it closes itself is not a Back for a sheet
 * that is open underneath it.
 */
export const layers = {
  get open() {
    return Object.values(openLayers).reduce((a, b) => a + b, 0);
  },
  ignorePopsUntil: 0,
};

function popOwnEntry() {
  layers.ignorePopsUntil = Date.now() + 600;
  history.back();
}

/**
 * A full-screen layer (camera, photo viewer) that the phone's Back button closes, like a sheet:
 * opening adds one history entry with the same address, Back pops it and calls `onBack`.
 * Returns `release()` — call it when the layer closes from inside, it removes that entry.
 * Safe with React's double mount in development and when the layer is unmounted from outside.
 */
export function useHistoryLayer(key: string, onBack: () => void): () => void {
  const cb = useRef(onBack);
  cb.current = onBack;
  const done = useRef(false);

  useEffect(() => {
    openLayers[key] = (openLayers[key] ?? 0) + 1;
    if (!history.state?.[key]) history.pushState({ ...(history.state ?? {}), [key]: true }, '');
    const onPop = () => {
      if (done.current || history.state?.[key]) return;
      done.current = true;
      cb.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      openLayers[key]--;
      // Unmounted without closing (or React re-mounting it): drop the entry unless it came back.
      window.setTimeout(() => {
        if (openLayers[key] || done.current || !history.state?.[key]) return;
        done.current = true;
        popOwnEntry();
      }, 0);
    };
  }, [key]);

  return useCallback(() => {
    if (done.current) return;
    done.current = true;
    if (history.state?.[key]) popOwnEntry();
  }, [key]);
}

/** Keep the page underneath from scrolling while a full-screen layer is open. */
export function useLockScroll() {
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev;
    };
  }, []);
}
