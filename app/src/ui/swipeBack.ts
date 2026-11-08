import { useEffect, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { haptic } from './haptics';
import { layers } from './historyLayer';
import { presetNavigation, TAB_ROOTS } from './router';

/** Where the gesture starts: a strip along the left edge, like the iPhone's. */
const EDGE = 28;

/**
 * Swipe from the left edge to go back, as in every iPhone app. The screen follows the finger; let go
 * past a third of the width (or with a flick) and it leaves, otherwise it springs back. An installed
 * iPhone web app has no system back gesture, so this is the one it gets.
 *
 * Not on the tab bar's own screens (nothing to go back to), and not while a sheet or a full-screen
 * layer (camera, photo viewer) is open — those have their own Back.
 */
export function useSwipeBack(ref: RefObject<HTMLElement>, enabled: boolean) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const canGoBack = () =>
      (window.history.state?.idx ?? 0) > 0 && !TAB_ROOTS.has(pathname) && layers.open === 0 && !document.querySelector('.mantine-Modal-content, .mantine-Drawer-content');

    let id = -1;
    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    let dx = 0;
    let lock: 'h' | 'v' | null = null;
    const width = () => el.clientWidth || window.innerWidth;

    const clear = () => {
      el.classList.remove('swiping');
      el.style.transition = '';
      el.style.transform = '';
      el.style.removeProperty('--swipe-p');
    };
    const finger = (e: TouchEvent) => Array.from(e.changedTouches).find((t) => t.identifier === id);

    const start = (e: TouchEvent) => {
      if (id !== -1 || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE || !canGoBack()) return;
      id = t.identifier;
      x0 = t.clientX;
      y0 = t.clientY;
      t0 = e.timeStamp;
      dx = 0;
      lock = null;
    };
    const move = (e: TouchEvent) => {
      if (id === -1) return;
      const t = finger(e);
      if (!t) return;
      const mx = t.clientX - x0;
      const my = t.clientY - y0;
      if (!lock) {
        if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
        lock = Math.abs(mx) > Math.abs(my) * 1.2 ? 'h' : 'v';
        if (lock === 'v') return;
        el.classList.add('swiping');
        el.style.transition = 'none';
      }
      if (lock !== 'h') return;
      if (e.cancelable) e.preventDefault();
      dx = Math.max(0, mx);
      el.style.transform = `translate3d(${dx}px, 0, 0)`;
      el.style.setProperty('--swipe-p', String(dx / width()));
    };
    const end = (e: TouchEvent) => {
      if (id === -1 || !finger(e)) return;
      const wasDrag = lock === 'h';
      const progress = dx / width();
      const speed = dx / Math.max(1, e.timeStamp - t0); // px per ms
      id = -1;
      lock = null;
      if (!wasDrag) return;
      if (e.type !== 'touchcancel' && (progress > 0.33 || speed > 0.6)) {
        haptic('light');
        // The screen stays where the finger left it; the transition takes it the rest of the way.
        presetNavigation('pop', progress);
        navigate(-1);
        // No route change (nothing to go back to after all): put the screen back.
        window.setTimeout(() => {
          if (el.isConnected && el.classList.contains('swiping')) clear();
        }, 450);
        return;
      }
      el.style.transition = 'transform 340ms cubic-bezier(0.32, 0.72, 0, 1)';
      el.style.transform = '';
      const done = () => {
        el.removeEventListener('transitionend', done);
        clear();
      };
      el.addEventListener('transitionend', done);
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      clear();
    };
  }, [enabled, pathname, navigate, ref]);
}
