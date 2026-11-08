import { Loader } from '@mantine/core';
import { IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { mediaUrl } from '../services/media';
import { useHistoryLayer, useLockScroll } from './historyLayer';

export interface ViewerItem {
  id: string;
  title?: string;
  caption?: ReactNode;
}

function useFullUrl(id?: string) {
  const [url, setUrl] = useState<string>();
  const [thumb, setThumb] = useState<string>();
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    setThumb(undefined);
    if (!id) return;
    // The small picture first (instant), the full one as soon as it is read.
    void mediaUrl(id, true).then((u) => alive && setThumb(u));
    void mediaUrl(id, false).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return url ?? thumb;
}

type Pt = { x: number; y: number };
type View = { scale: number; x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const SLIDE_MS = 220;

/**
 * Full-screen photo viewer, like the phone's gallery: swipe between photos, pinch or double-tap to
 * zoom, drag down to close, tap to hide the bars. Back closes it too.
 */
export function PhotoViewer({
  items,
  index,
  onIndex,
  onClose,
  actions,
}: {
  items: ViewerItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  actions?: (item: ViewerItem) => ReactNode;
}) {
  const { t } = useTranslation();
  const item = items[index];
  const url = useFullUrl(item?.id);
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [slide, setSlide] = useState({ x: 0, y: 0, animate: true });
  const [chrome, setChrome] = useState(true);
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ start: Pt; view: View; pinch?: { d: number; mid: Pt }; axis?: 'x' | 'y'; moved: boolean; t: number } | null>(null);
  const lastTap = useRef(0);
  const busy = useRef(false);

  // Page underneath stays put; Back and Escape close the viewer.
  useLockScroll();
  const release = useHistoryLayer('mgViewer', onClose);
  const close = useCallback(() => {
    release();
    onClose();
  }, [release, onClose]);
  const closeRef = useRef(close);
  closeRef.current = close;

  // Photos removed while open: stay on the nearest one, close when none is left.
  useEffect(() => {
    if (items.length === 0) closeRef.current();
    else if (index >= items.length) onIndex(items.length - 1);
  }, [items.length, index, onIndex]);

  /** Slide the current photo out and the next one in from the other side. */
  const go = useCallback(
    (d: 1 | -1) => {
      const n = index + d;
      if (busy.current || n < 0 || n >= items.length) return;
      busy.current = true;
      const w = stage.current?.clientWidth ?? window.innerWidth;
      setSlide({ x: -d * w, y: 0, animate: true });
      window.setTimeout(() => {
        setView({ scale: 1, x: 0, y: 0 });
        onIndex(n);
        setSlide({ x: d * w * 0.35, y: 0, animate: false });
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setSlide({ x: 0, y: 0, animate: true });
            busy.current = false;
          }),
        );
      }, SLIDE_MS * 0.7);
    },
    [index, items.length, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const clampView = (v: View): View => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || v.scale <= 1.01) return { scale: 1, x: 0, y: 0 };
    const mx = (box.width * (v.scale - 1)) / 2;
    const my = (box.height * (v.scale - 1)) / 2;
    return { scale: Math.min(4, v.scale), x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
  };

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    stage.current?.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current = { start: pts[0], view, pinch: { d: dist(pts[0], pts[1]), mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } }, moved: true, t: Date.now() };
      setSlide({ x: 0, y: 0, animate: true });
    } else if (pts.length === 1) {
      gesture.current = { start: pts[0], view, moved: false, t: Date.now() };
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g || busy.current) return;
    const pts = [...pointers.current.values()];
    if (g.pinch && pts.length >= 2) {
      const d = dist(pts[0], pts[1]);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const scale = Math.max(1, Math.min(4, (g.view.scale * d) / g.pinch.d));
      setView(clampView({ scale, x: g.view.x + (mid.x - g.pinch.mid.x), y: g.view.y + (mid.y - g.pinch.mid.y) }));
      return;
    }
    const dx = e.clientX - g.start.x;
    const dy = e.clientY - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > 8) g.moved = true;
    if (!g.moved) return;
    if (g.view.scale > 1) {
      setView(clampView({ scale: g.view.scale, x: g.view.x + dx, y: g.view.y + dy }));
      return;
    }
    if (!g.axis) g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (g.axis === 'x') {
      // Resistance past the first and the last photo.
      const edge = (dx > 0 && index === 0) || (dx < 0 && index === items.length - 1) ? 0.3 : 1;
      setSlide({ x: dx * edge, y: 0, animate: false });
    } else {
      setSlide({ x: 0, y: dy > 0 ? dy : dy * 0.25, animate: false });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) {
      // One finger left after a pinch: carry on as a pan from here.
      const rest = [...pointers.current.values()][0];
      gesture.current = { start: rest, view, moved: true, t: Date.now() };
      return;
    }
    gesture.current = null;
    if (!g) return;
    if (!g.moved) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        // Double tap: zoom in where tapped, or back to the whole photo.
        lastTap.current = 0;
        const box = stage.current?.getBoundingClientRect();
        if (view.scale > 1 || !box) setView({ scale: 1, x: 0, y: 0 });
        else setView(clampView({ scale: 2.5, x: (box.left + box.width / 2 - e.clientX) * 1.5, y: (box.top + box.height / 2 - e.clientY) * 1.5 }));
      } else {
        lastTap.current = now;
        window.setTimeout(() => {
          if (lastTap.current === now) setChrome((c) => !c);
        }, 300);
      }
      return;
    }
    if (g.view.scale > 1) return;
    const fast = Date.now() - g.t < 260;
    if (g.axis === 'y') {
      if (slide.y > 140 || (fast && slide.y > 50)) return close();
      setSlide({ x: 0, y: 0, animate: true });
      return;
    }
    const w = stage.current?.clientWidth ?? window.innerWidth;
    const limit = fast ? 30 : w * 0.22;
    const dir = slide.x < -limit ? 1 : slide.x > limit ? -1 : 0;
    if (dir && index + dir >= 0 && index + dir < items.length) go(dir as 1 | -1);
    else setSlide({ x: 0, y: 0, animate: true });
  };

  if (!item) return null;
  const fade = slide.y > 0 ? Math.max(0.3, 1 - slide.y / 420) : 1;
  const shrink = slide.y > 0 ? Math.max(0.82, 1 - slide.y / 1400) : 1;
  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={item.title} style={{ background: `rgba(0, 0, 0, ${fade})` }} data-chrome={chrome && slide.y === 0}>
      <div className="viewer-top">
        <button type="button" className="cam-icon" onClick={() => close()} aria-label={t('camera.close')}>
          <IconX size={22} />
        </button>
        <div className="cam-title">
          {item.title && <div className="cam-title-main">{item.title}</div>}
          {items.length > 1 && <div className="cam-title-sub">{t('camera.of', { n: index + 1, total: items.length })}</div>}
        </div>
        <span className="cam-icon-spacer" />
      </div>
      <div className="viewer-stage" ref={stage} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="viewer-slide" data-animate={slide.animate} style={{ transform: `translate3d(${slide.x}px, ${slide.y}px, 0) scale(${shrink})` }}>
          {url ? (
            <img
              key={item.id}
              src={url}
              alt=""
              draggable={false}
              className="viewer-img"
              data-animate={!gesture.current}
              style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
            />
          ) : (
            <Loader color="white" />
          )}
        </div>
        {index > 0 && (
          <button type="button" className="viewer-nav prev" onClick={() => go(-1)} aria-label={t('common.back')}>
            <IconChevronLeft size={26} />
          </button>
        )}
        {index < items.length - 1 && (
          <button type="button" className="viewer-nav next" onClick={() => go(1)} aria-label={t('common.next')}>
            <IconChevronRight size={26} />
          </button>
        )}
      </div>
      {(item.caption || actions) && (
        <div className="viewer-bottom">
          {item.caption && <div className="viewer-caption">{item.caption}</div>}
          {actions && <div className="viewer-actions">{actions(item)}</div>}
        </div>
      )}
    </div>,
    document.body,
  );
}
