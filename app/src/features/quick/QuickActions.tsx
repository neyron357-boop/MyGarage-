import { Button, Menu } from '@mantine/core';
import { IconArrowDownLeft, IconArrowUpRight, IconCamera, IconNote, IconPlus, type Icon } from '@tabler/icons-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { haptic } from '../../ui/haptics';
import { SheetFor } from '../../ui/lazy';
import { EntrySheet, type EntryPreset } from '../money/MoneyEntry';
import { holdCarShot } from '../orders/carShot';

/*
 * Quick actions of «＋» (v0.28): a tap is a new job, as always; a press held, or a swipe up from it, brings the actions
 * up over it — the finger slides onto one and lets go there, and it runs (one movement, as the iPhone's quick actions);
 * held and let go in place, they stay for a tap. On a PC — a right click on "New job".
 *   - «Фото номера»: the camera; the photo goes to "New job", which reads the plate off it (services/plateReader.ts);
 *   - «Приход», «Расход»: the money sheet;
 *   - «Заметка»: the workshop's notes.
 * The camera opens right in the finger's lift (the iPhone opens a picker only in a touch — ui/photoPick.tsx).
 */

export type QuickKey = 'photo' | 'in' | 'out' | 'note';

/** Nearest the thumb first: from «＋» up. */
export const QUICK: { key: QuickKey; icon: Icon; color: string }[] = [
  { key: 'photo', icon: IconCamera, color: 'cobalt' },
  { key: 'in', icon: IconArrowDownLeft, color: 'green' },
  { key: 'out', icon: IconArrowUpRight, color: 'red' },
  { key: 'note', icon: IconNote, color: 'yellow' },
];

/** The actions and what they need on the page: the camera's picker and the money sheet. */
export function useQuickActions() {
  const navigate = useNavigate();
  const camera = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<EntryPreset | null>(null);
  const run = (k: QuickKey) => {
    if (k === 'photo') camera.current?.click();
    else if (k === 'in' || k === 'out') setSheet({ kind: k });
    else navigate('/notes');
  };
  const nodes = (
    <>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-quick-camera
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) navigate(`/orders/new?photo=${holdCarShot(file)}`);
        }}
      />
      <SheetFor value={sheet}>{(s, o) => <EntrySheet opened={o} onClose={() => setSheet(null)} preset={s} />}</SheetFor>
    </>
  );
  return { run, nodes };
}

/** A press held this long brings the actions up. */
const HOLD_MS = 320;
/** A finger moved up this far (px) before the hold brings them up at once. */
const SWIPE = 16;
/** A finger moved this far any other way before the hold is no press for the actions (the tap is the browser's). */
const SLOP = 10;
/** How far (px) a finger may be from an action, above or below, and still be on it. */
const REACH = 14;

interface Press {
  x: number;
  y: number;
  id: number;
  touch: boolean;
  timer?: number;
  /** The actions came up during this press. */
  opened?: boolean;
  /** The finger went somewhere after they came up (letting go in place keeps them for a tap). */
  moved?: boolean;
}

/** The phone's «＋»: a tap — a new job; held or swiped up — the quick actions. */
export function QuickPlus() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const quick = useQuickActions();
  const [open, setOpen] = useState<null | 'drag' | 'sticky'>(null);
  const [hover, setHover] = useState<QuickKey | null>(null);
  const [anchor, setAnchor] = useState<{ right: number; bottom: number }>({ right: 16, bottom: 100 });
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const hovered = useRef<QuickKey | null>(null);
  /** The action a finger let go on: it runs in the touch's end (where the iPhone lets a picker open). */
  const pending = useRef<QuickKey | null>(null);
  /** Until when a click is the end of a press that brought the actions up, not a tap. */
  const swallow = useRef(0);

  const show = (how: 'drag' | 'sticky') => {
    const r = button.current?.getBoundingClientRect();
    if (r) setAnchor({ right: Math.max(8, window.innerWidth - r.right), bottom: Math.max(8, window.innerHeight - r.top + 12) });
    setOpen(how);
    haptic('medium');
  };
  const close = () => {
    setOpen(null);
    setHover(null);
    hovered.current = null;
  };
  const point = (k: QuickKey | null) => {
    if (k === hovered.current) return;
    hovered.current = k;
    setHover(k);
    if (k) haptic('selection');
  };
  /** The action under a finger: in the column of actions (a little wider), the nearest within reach above or below. */
  const at = (x: number, y: number): QuickKey | null => {
    let best: QuickKey | null = null;
    let near = Infinity;
    for (const el of menu.current?.querySelectorAll<HTMLElement>('[data-quick]') ?? []) {
      const r = el.getBoundingClientRect();
      if (x < r.left - 32 || x > r.right + 32) continue;
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < near) (near = d), (best = el.dataset.quick as QuickKey);
    }
    return near <= REACH ? best : null;
  };
  const go = (k: QuickKey) => {
    close();
    quick.run(k);
  };

  // Escape closes them; so does the screen changing under them.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="tab-plus"
        aria-label={t('nav.newOrder')}
        aria-haspopup="menu"
        aria-expanded={!!open}
        data-open={open ? '' : undefined}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          if (open === 'sticky') return;
          const p: Press = { x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse' };
          press.current = p;
          // A mouse keeps its moves here when it leaves the button (a finger does by itself).
          if (!p.touch) e.currentTarget.setPointerCapture?.(e.pointerId);
          p.timer = window.setTimeout(() => {
            p.opened = true;
            show('drag');
          }, HOLD_MS);
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p || e.pointerId !== p.id) return;
          const dx = e.clientX - p.x;
          const dy = p.y - e.clientY;
          if (!p.opened) {
            if (dy > SWIPE && dy > Math.abs(dx)) {
              window.clearTimeout(p.timer);
              p.opened = true;
              p.moved = true;
              show('drag');
            } else if (Math.hypot(dx, dy) > SLOP) {
              window.clearTimeout(p.timer);
              press.current = null;
            }
            return;
          }
          if (Math.hypot(dx, dy) > SLOP) p.moved = true;
          point(at(e.clientX, e.clientY));
        }}
        onPointerUp={(e) => {
          const p = press.current;
          if (!p || e.pointerId !== p.id) return;
          window.clearTimeout(p.timer);
          if (!p.opened) {
            press.current = null;
            return;
          }
          swallow.current = performance.now() + 800;
          const k = at(e.clientX, e.clientY);
          if (k && p.touch) pending.current = k;
          else if (k) go(k);
          else if (!p.moved) setOpen('sticky');
          else close();
          if (!p.touch) press.current = null;
        }}
        onTouchEnd={(e) => {
          const p = press.current;
          press.current = null;
          const k = pending.current;
          pending.current = null;
          // No click after a press that brought the actions up — it would land on what they opened.
          if (p?.opened && e.cancelable) e.preventDefault();
          if (k) go(k);
        }}
        onPointerCancel={() => {
          const p = press.current;
          press.current = null;
          if (!p) return;
          window.clearTimeout(p.timer);
          if (p.opened && !p.moved) setOpen('sticky');
          else if (p.opened) close();
        }}
        onContextMenu={(e) => {
          // A right click on a PC; Android's long press: the actions, for a tap.
          e.preventDefault();
          if (open) return;
          swallow.current = performance.now() + 800;
          show('sticky');
        }}
        onClick={() => {
          if (performance.now() < swallow.current) return;
          if (open) return close();
          navigate('/orders/new');
        }}
      >
        <IconPlus size={28} stroke={2.2} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div className="quick-layer" data-mode={open}>
            <div className="quick-scrim" onClick={close} aria-hidden />
            <div ref={menu} className="quick-menu" role="menu" aria-label={t('quick.title')} style={{ right: anchor.right, bottom: anchor.bottom }}>
              {QUICK.map((q, i) => (
                <button
                  key={q.key}
                  type="button"
                  role="menuitem"
                  className="quick-item glass"
                  data-quick={q.key}
                  data-hover={hover === q.key ? '' : undefined}
                  style={{ '--i': i } as CSSProperties}
                  onClick={() => go(q.key)}
                >
                  <span className="quick-label">{t(`quick.${q.key}`)}</span>
                  <span className="row-icon" style={{ background: `var(--mantine-color-${q.color}-6)` }} aria-hidden>
                    <q.icon size={20} stroke={2} />
                  </span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
      {quick.nodes}
    </>
  );
}

/** The PC's "New job": a click — a new job; a right click — the quick actions under it. */
export function QuickNewButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const quick = useQuickActions();
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Only a right click opens it (a click is a new job): the menu's own toggling to open is not taken. */}
      <Menu opened={open} onChange={(o) => !o && setOpen(false)} position="bottom-start" width="target" shadow="md">
        <Menu.Target>
          <Button
            fullWidth
            leftSection={<IconPlus size={18} />}
            mb="lg"
            onClick={() => navigate('/orders/new')}
            onContextMenu={(e) => {
              e.preventDefault();
              setOpen(true);
            }}
          >
            {t('nav.newOrder')}
          </Button>
        </Menu.Target>
        <Menu.Dropdown aria-label={t('quick.title')}>
          {QUICK.map((q) => (
            <Menu.Item
              key={q.key}
              data-quick={q.key}
              leftSection={
                <span className="row-icon" style={{ background: `var(--mantine-color-${q.color}-6)` }} aria-hidden>
                  <q.icon size={18} stroke={2} />
                </span>
              }
              onClick={() => quick.run(q.key)}
            >
              {t(`quick.${q.key}`)}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      {quick.nodes}
    </>
  );
}
