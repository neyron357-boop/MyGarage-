import { Switch } from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Component, lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FormRow } from '../../ui/components';
import './feedback.css';
import { fbDb } from './store';
import { useFbStrings } from './strings';

/*
 * The developer's visual feedback tool (v0.39, temporary — see README.md here): a pencil on the screen; a tap — tap
 * the element that is wrong, say it in two or three words, saved; «Мои замечания» — the list and «Экспорт для агента».
 *
 * This file is all the app loads at start (the pencil and the switch); the rest comes when the pencil is first used.
 * Off for good: VITE_FEEDBACK=off at build time. Off on this device: «Ещё → Оформление → Кнопка замечаний».
 * Removed: this folder and its two lines in `App.tsx` and `ui/Appearance.tsx`.
 */

export const FEEDBACK_BUILT = import.meta.env.VITE_FEEDBACK !== 'off';

const KEY = 'mygarage.feedback';
const POS_KEY = 'mygarage.feedback.pos';

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}
let on = readOn();
const subs = new Set<() => void>();
export function setFeedbackOn(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    // storage refused: on for this visit only
  }
  subs.forEach((f) => f());
}
export function useFeedbackOn(): boolean {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => on,
  );
}

/** The switch in «Ещё → Оформление»: the pencil shown or not, on this device. */
export function FeedbackSwitchRow() {
  const s = useFbStrings();
  const value = useFeedbackOn();
  if (!FEEDBACK_BUILT) return null;
  return (
    <FormRow label={s.settingRow}>
      <Switch checked={value} onChange={(e) => setFeedbackOn(e.currentTarget.checked)} aria-label={s.settingRow} />
    </FormRow>
  );
}

const loadUi = () => import('./ui');
const FeedbackUI = lazy(loadUi);

/** A failure of the tool never takes the app down: it just goes away until the next start. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error('feedback tool:', e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type Pos = { side: 'left' | 'right'; y: number };
function readPos(): Pos {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? '') as Pos;
    if ((p.side === 'left' || p.side === 'right') && p.y > 0 && p.y < 1) return p;
  } catch {
    // first time
  }
  return { side: 'right', y: 0.62 };
}

/**
 * A hold opens «Мои замечания» while the finger is still down, and the pencil goes: the finger is then lifted over the
 * list, and the click its release brings would open the note under it. That click goes nowhere.
 */
function swallowReleaseClick() {
  const ended = () => {
    window.removeEventListener('pointerup', ended, true);
    window.removeEventListener('touchend', ended, true);
    const until = performance.now() + 500;
    const stop = (e: Event) => {
      window.removeEventListener('click', stop, true);
      if (performance.now() > until) return;
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    window.addEventListener('click', stop, true);
    window.setTimeout(() => window.removeEventListener('click', stop, true), 500);
  };
  window.addEventListener('pointerup', ended, true);
  window.addEventListener('touchend', ended, true);
}

/** The pencil: a tap — pick mode; held (on a PC — a right click) — «Мои замечания»; dragged — moved along the edge. */
function Pencil({ count, onTap, onHold, label }: { count: number; onTap: () => void; onHold: () => void; label: string }) {
  const [pos, setPos] = useState(readPos);
  const ref = useRef<HTMLButtonElement>(null);
  const g = useRef<{ id: number; x0: number; y0: number; moved: boolean; held: boolean; timer: number } | null>(null);
  /** The click that ends a drag or a hold is not a tap. */
  const skipClick = useRef(false);
  const place = (p: Pos) => {
    const el = ref.current;
    if (!el) return;
    el.style.left = p.side === 'left' ? 'max(8px, env(safe-area-inset-left))' : '';
    el.style.right = p.side === 'right' ? 'max(8px, env(safe-area-inset-right))' : '';
    el.style.top = `${Math.round(p.y * window.innerHeight - 22)}px`;
  };
  useEffect(() => {
    place(pos);
    const re = () => place(pos);
    window.addEventListener('resize', re);
    return () => window.removeEventListener('resize', re);
  }, [pos]);
  return (
    <button
      ref={ref}
      type="button"
      className="fb-fab"
      data-fb-ui
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // A drag ended without a click (a touch moved far has none): this press starts clean.
        skipClick.current = false;
        ref.current?.setPointerCapture(e.pointerId);
        const timer = window.setTimeout(() => {
          if (g.current && !g.current.moved) {
            g.current.held = true;
            swallowReleaseClick();
            onHold();
          }
        }, 550);
        g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, held: false, timer };
        // The rest of the tool, while the finger is still down.
        void loadUi();
      }}
      onPointerMove={(e) => {
        const s = g.current;
        const el = ref.current;
        if (!s || s.id !== e.pointerId || !el) return;
        if (!s.moved && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < 8) return;
        if (!s.moved) {
          s.moved = true;
          window.clearTimeout(s.timer);
          el.setAttribute('data-drag', '');
        }
        el.style.left = `${Math.round(e.clientX - 22)}px`;
        el.style.right = '';
        el.style.top = `${Math.round(e.clientY - 22)}px`;
      }}
      onPointerUp={(e) => {
        const s = g.current;
        g.current = null;
        if (!s || s.id !== e.pointerId) return;
        window.clearTimeout(s.timer);
        ref.current?.removeAttribute('data-drag');
        skipClick.current = s.moved || s.held;
        if (s.moved) {
          const next: Pos = { side: e.clientX < window.innerWidth / 2 ? 'left' : 'right', y: Math.min(0.9, Math.max(0.08, e.clientY / window.innerHeight)) };
          try {
            localStorage.setItem(POS_KEY, JSON.stringify(next));
          } catch {
            // kept for this visit
          }
          setPos(next);
          place(next);
        }
      }}
      // The tap itself on click — the last event of a touch: the pencil goes only when the touch is over, so nothing of
      // it lands on what was under the pencil.
      onClick={() => {
        if (skipClick.current) {
          skipClick.current = false;
          return;
        }
        onTap();
      }}
      onPointerCancel={() => {
        if (g.current) window.clearTimeout(g.current.timer);
        g.current = null;
        ref.current?.removeAttribute('data-drag');
        place(pos);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!g.current?.held) onHold();
      }}
    >
      <IconPencil size={22} stroke={2.2} aria-hidden />
      {count > 0 && <span className="fb-badge">{count > 99 ? '99+' : count}</span>}
    </button>
  );
}

/** The tool, mounted once at the app's root. */
export function FeedbackTool() {
  const shown = useFeedbackOn();
  const s = useFbStrings();
  const [mode, setMode] = useState<'pick' | 'panel' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Its own database is opened a moment after the app's start, for the pencil's count only.
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setAwake(true), 2500);
    return () => window.clearTimeout(t);
  }, []);
  const count = useLiveQuery(() => (awake && shown ? fbDb().notes.where('status').equals('new').count() : 0), [awake, shown]) ?? 0;
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!FEEDBACK_BUILT || (!shown && !mode)) return null;
  return createPortal(
    <Quiet>
      {!mode && shown && <Pencil count={count} label={s.fab} onTap={() => setMode('pick')} onHold={() => setMode('panel')} />}
      {mode && (
        <Suspense fallback={null}>
          <FeedbackUI mode={mode} onMode={setMode} onToast={setToast} />
        </Suspense>
      )}
      {toast && (
        <div className="fb-toast" data-fb-ui role="status">
          {toast}
        </div>
      )}
    </Quiet>,
    document.body,
  );
}
