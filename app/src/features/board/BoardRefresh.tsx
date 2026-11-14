import { Loader, VisuallyHidden } from '@mantine/core';
import { IconArrowDown } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useScreen } from '../../ui/stack';

const PULL_THRESHOLD = 64;

/** A downward pull from the top reloads the board in place. Only the indicator follows the finger. */
export function BoardRefresh({ busy, onRefresh }: { busy: boolean; onRefresh: () => void }) {
  const screen = useScreen();
  const { t } = useTranslation();
  const indicator = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroll = screen?.scroller.current;
    const mark = indicator.current;
    if (!scroll || !mark || busy) return;

    let start: { id: number; x: number; y: number } | undefined;
    let distance = 0;
    const reset = () => {
      start = undefined;
      distance = 0;
      mark.removeAttribute('data-pulling');
      mark.style.removeProperty('--pull-opacity');
      mark.style.removeProperty('--pull-y');
      mark.style.removeProperty('--pull-rotation');
    };
    const touchStart = (event: TouchEvent) => {
      reset();
      if (!screen.front() || scroll.scrollTop > 1 || event.touches.length !== 1) return;
      const { identifier, clientX, clientY } = event.touches[0];
      start = { id: identifier, x: clientX, y: clientY };
    };
    const touchMove = (event: TouchEvent) => {
      if (!start) return;
      const finger = event.touches[0];
      if (event.touches.length !== 1 || finger?.identifier !== start.id) return reset();
      const dx = Math.abs(finger.clientX - start.x);
      const dy = finger.clientY - start.y;
      if (!mark.hasAttribute('data-pulling')) {
        if (dx < 7 && Math.abs(dy) < 7) return;
        if (dy <= dx || scroll.scrollTop > 1 || !event.cancelable) return reset();
        mark.setAttribute('data-pulling', '');
      }
      if (event.cancelable) event.preventDefault();
      distance = Math.max(0, dy);
      const progress = Math.min(distance / PULL_THRESHOLD, 1);
      mark.style.setProperty('--pull-opacity', String(progress));
      mark.style.setProperty('--pull-y', `${-8 + progress * 12}px`);
      mark.style.setProperty('--pull-rotation', `${progress * 180}deg`);
    };
    const touchEnd = () => {
      const refresh = distance >= PULL_THRESHOLD && screen.front();
      reset();
      if (refresh) onRefresh();
    };
    scroll.addEventListener('touchstart', touchStart, { passive: true });
    scroll.addEventListener('touchmove', touchMove, { passive: false });
    scroll.addEventListener('touchend', touchEnd, { passive: true });
    scroll.addEventListener('touchcancel', reset, { passive: true });
    return () => {
      reset();
      scroll.removeEventListener('touchstart', touchStart);
      scroll.removeEventListener('touchmove', touchMove);
      scroll.removeEventListener('touchend', touchEnd);
      scroll.removeEventListener('touchcancel', reset);
    };
  }, [busy, onRefresh, screen]);

  if (!screen) return null;
  return createPortal(
    <div className="board-refresh" ref={indicator} data-busy={busy || undefined}>
      {busy ? <Loader size={18} color="cobalt" aria-hidden /> : <IconArrowDown className="board-refresh-arrow" size={19} stroke={2.3} aria-hidden />}
      <VisuallyHidden role="status">{busy ? t('board.refreshing') : ''}</VisuallyHidden>
    </div>,
    screen.nav,
  );
}
