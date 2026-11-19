import { useEffect } from 'react';
import { project, rubber, springEase, translateYNow, Velocity } from './fling';

const reduceQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
const overlayOf = (c: HTMLElement) => c.closest('.mantine-Modal-root')?.querySelector<HTMLElement>('.mantine-Modal-overlay') ?? null;

/**
 * Phones: drag a bottom sheet down by its header (where the grab handle is) to close it, like the native sheets in
 * iOS and Android. v0.57 (the Apple audit): the sheet stays under the finger 1:1, up it gives way like a rubber
 * band; let go, and the finger's speed decides — a slow drag past a third of it (at most 140 px) closes it, a flick
 * that would carry it there too, a finger going back up keeps it — and carries on into the motion: a spring at that speed
 * (WAAPI, ui/fling.ts), the dim fading with it. A sheet caught on its way back is taken from where it is.
 */
export function useSheetSwipe(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let content: HTMLElement | null = null;
    let header: HTMLElement | null = null;
    let grab = 0;
    let y = 0;
    let pointer = -1;
    const speed = new Velocity();
    // The spring now running on a sheet, and its dim fading (both taken over by the next grab).
    const running = new WeakMap<HTMLElement, Animation>();
    const dims = new WeakMap<HTMLElement, Animation>();

    const place = (el: HTMLElement, at: number) => {
      el.style.transform = at ? `translateY(${at}px)` : 'translateY(0)';
    };
    const down = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const h = target?.closest?.('.mg-sheet .mantine-Modal-header') as HTMLElement | null;
      if (!h || target?.closest('button, a, input, textarea, select')) return;
      const c = h.closest('.mantine-Modal-content') as HTMLElement | null;
      if (!c) return;
      // Caught on its way back: from where it is now, not from where it was going.
      const now = translateYNow(c);
      running.get(c)?.cancel();
      running.delete(c);
      dims.get(c)?.cancel();
      dims.delete(c);
      content = c;
      header = h;
      y = Math.max(0, now);
      grab = e.clientY - y;
      pointer = e.pointerId;
      speed.reset(e.clientY, e.timeStamp);
      c.style.transition = 'none';
      place(c, y);
    };
    const move = (e: PointerEvent) => {
      if (!content || e.pointerId !== pointer) return;
      speed.add(e.clientY, e.timeStamp);
      const dy = e.clientY - grab;
      // Down — with the finger; up — a sheet has nowhere to go: it gives way less and less.
      y = dy >= 0 ? dy : rubber(dy, content.offsetHeight || 600);
      place(content, Math.round(y));
    };
    const up = (e: PointerEvent) => {
      if (!content || e.pointerId !== pointer) return;
      const c = content;
      content = null;
      pointer = -1;
      const v = e.type === 'pointercancel' ? 0 : speed.now(e.timeStamp);
      const h = c.offsetHeight || 600;
      const close = header?.querySelector('.mantine-Modal-close') as HTMLButtonElement | null;
      // The line: a third of the sheet, 140 px at most — passed by the finger, or by where its flick (from 0.35 px/ms,
      // as the tab pages' fling) would carry the sheet.
      const line = Math.min(h / 3, 140);
      const shut = !!close && e.type !== 'pointercancel' && v > -0.05 && (y > line || (v > 0.35 && y + project(v) > line));
      const to = shut ? h + 48 : 0;
      // A tap on the header (nothing moved): nothing to settle.
      if (!shut && Math.abs(y) < 0.5) {
        place(c, 0);
        c.style.transition = '';
        return;
      }
      const reduced = reduceQuery?.matches === true;
      const { easing, ms } = reduced ? { easing: 'ease-out', ms: 160 } : springEase(y, to, v, shut ? 0.42 : 0.34);
      const a = c.animate([{ transform: `translateY(${y}px)` }, { transform: `translateY(${to}px)` }], { duration: ms, easing, fill: 'forwards' });
      running.set(c, a);
      if (shut) {
        const overlay = overlayOf(c);
        const dim = overlay?.animate([{ opacity: getComputedStyle(overlay).opacity }, { opacity: 0 }], { duration: Math.min(ms, 280), easing: 'ease-out', fill: 'forwards' });
        if (dim) dims.set(c, dim);
      }
      a.finished.then(
        () => {
          if (running.get(c) !== a) return;
          running.delete(c);
          dims.delete(c);
          place(c, to);
          a.cancel();
          if (shut) {
            // Out of sight already: Mantine's own way out (to 100 %, fading) has nothing left to show.
            c.style.opacity = '0';
            close!.click();
            // The sheet did not close after all (it asks about unsaved changes first): it comes back up.
            window.setTimeout(() => {
              if (!c.isConnected || getComputedStyle(c).pointerEvents === 'none') return;
              c.style.opacity = '';
              for (const x of overlayOf(c)?.getAnimations() ?? []) x.cancel();
              const back = c.animate([{ transform: `translateY(${to}px)` }, { transform: 'translateY(0)' }], { duration: 320, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
              place(c, 0);
              void back.finished.then(() => (c.style.transition = ''), () => undefined);
            }, 80);
          } else c.style.transition = '';
        },
        () => undefined,
      );
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
