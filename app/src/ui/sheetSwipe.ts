import { useEffect } from 'react';

/**
 * Phones: drag a bottom sheet down by its header (where the grab handle is) to close it, like the
 * native sheets in iOS and Android. Short drags spring back.
 */
export function useSheetSwipe(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let content: HTMLElement | null = null;
    let header: HTMLElement | null = null;
    let startY = 0;
    let dy = 0;
    let pointer = -1;

    const down = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const h = target?.closest?.('.mg-sheet .mantine-Modal-header') as HTMLElement | null;
      if (!h || target?.closest('button, a, input, textarea, select')) return;
      content = h.closest('.mantine-Modal-content');
      if (!content) return;
      header = h;
      startY = e.clientY;
      dy = 0;
      pointer = e.pointerId;
      content.style.transition = 'none';
    };
    const move = (e: PointerEvent) => {
      if (!content || e.pointerId !== pointer) return;
      dy = Math.max(0, e.clientY - startY);
      // A little resistance makes the sheet feel attached to the finger.
      content.style.transform = `translateY(${Math.round(dy * 0.9)}px)`;
    };
    const up = (e: PointerEvent) => {
      if (!content || e.pointerId !== pointer) return;
      const c = content;
      content = null;
      c.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      const close = header?.querySelector('.mantine-Modal-close') as HTMLButtonElement | null;
      if (dy > 90 && close) {
        c.style.transform = 'translateY(100%)';
        close.click();
      } else {
        c.style.transform = '';
      }
      window.setTimeout(() => {
        c.style.transition = '';
      }, 240);
    };
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [enabled]);
}
