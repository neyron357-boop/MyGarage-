import { useRef } from 'react';
import { haptic } from './haptics';

/**
 * Long press, the iPhone's way to the actions of a card (and right click on a PC). Moving the finger
 * (scrolling) cancels it; the click that ends a long press does not open the card (`consumeClick`).
 */
export function useLongPress(onLong: () => void, ms = 450) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  return {
    handlers: {
      onTouchStart: (e: React.TouchEvent) => {
        clear();
        fired.current = false;
        if (e.touches.length !== 1) return;
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        timer.current = window.setTimeout(() => {
          timer.current = undefined;
          fired.current = true;
          haptic('medium');
          onLong();
        }, ms);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const s = start.current;
        const t = e.touches[0];
        if (s && t && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10) clear();
      },
      onTouchEnd: clear,
      onTouchCancel: clear,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        clear();
        fired.current = true;
        onLong();
      },
    },
    /** True once after a long press: the click that follows it must not do the tap's action. */
    consumeClick: () => {
      const f = fired.current;
      fired.current = false;
      return f;
    },
  };
}
