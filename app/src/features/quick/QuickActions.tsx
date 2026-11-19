import { Button, Kbd, Menu } from '@mantine/core';
import { IconArrowDownLeft, IconArrowUpRight, IconCamera, IconNote, IconPlus, type Icon } from '@tabler/icons-react';
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { liveCameraAvailable } from '../../ui/camera';
import { haptic } from '../../ui/haptics';
import { LiveCamera } from '../../ui/LiveCamera';
import { PlateScan, type ScanTally } from './PlateScan';
import { SheetFor } from '../../ui/lazy';
import { EntrySheet, type EntryPreset } from '../money/MoneyEntry';
import { holdCarShot } from '../orders/carShot';
import { EntryDetails } from '../money/LedgerTab';
import { AiMark } from '../ai/Ai';
import { useLang, useScreenLiveQuery } from '../../ui/hooks';
import { scanReceipt, type JobOption } from '../../services/receipts';
import { expenseEntry } from '../../domain/ledger';
import { db } from '../../db/db';
import { notifications } from '@mantine/notifications';

/*
 * Quick actions of «＋» (v0.28): a tap is a new job, as always; a press held, or a swipe up from it, brings the actions
 * up over it — the finger slides onto one and lets go there, and it runs (one movement, as the iPhone's quick actions);
 * held and let go in place, they stay for a tap. On a PC — a right click on "New job".
 *   - «Фото номера»: the camera inside the app (ui/LiveCamera.tsx, v0.31 — the phone's own opens only for a tap, not
 *     where a slide lets go); the photo goes to "New job", which reads the plate off it (services/plateReader.ts);
 *   - «Приход», «Расход»: the money sheet;
 *   - «Заметка»: the workshop's notes.
 * The actions run right in the finger's lift (touchend).
 */

export type QuickKey = 'photo' | 'in' | 'out' | 'note';

/** Nearest the thumb first: from «＋» up. */
export const QUICK: { key: QuickKey; icon: Icon; color: string }[] = [
  { key: 'photo', icon: IconCamera, color: 'cobalt' },
  { key: 'in', icon: IconArrowDownLeft, color: 'green' },
  { key: 'out', icon: IconArrowUpRight, color: 'red' },
  { key: 'note', icon: IconNote, color: 'yellow' },
];

/**
 * The actions and what they need on the page: the cameras, the money sheet. `live` — the phone's «＋»: «Фото номера»
 * is the camera inside the app (v0.31: it opens where a finger lets go after a slide, which the phone's own camera
 * does not — only for a tap); without one (plain http) and on a PC — the phone's camera / the file picker.
 */
export function useQuickActions(live = false) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const camera = useRef<HTMLInputElement>(null);
  const receiptInput = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<EntryPreset | null>(null);
  const [cam, setCam] = useState<false | 'plate' | 'receipt'>(false);
  // A receipt being read on the server (v0.50): a pill says so; the expense's sheet opens once it is recorded.
  const [scanning, setScanning] = useState(false);
  const [recorded, setRecorded] = useState<{ id: string; others: JobOption[] } | null>(null);
  // What the camera read off its frames while it was aimed (v0.33): the plate goes with the photo when they agreed.
  const seen = useRef<ScanTally | undefined>(undefined);
  /** The car's photo into "New job" (with the plate the frames agreed on: it is in the job's form at once). */
  const shot = (file: File) => {
    const t = seen.current;
    seen.current = undefined;
    setCam(false);
    const plate = t?.stable ? { emirate: t.emirate, code: t.code, number: t.number, sure: true, codeSure: t.codeFrames >= 2, box: t.box } : undefined;
    navigate(`/orders/new?photo=${holdCarShot(file, plate)}`);
  };
  /**
   * A supplier's receipt photographed (v0.50): read on the garage's server, recorded as an expense in «Запчасти» with
   * the photo, tied to the job its parts are for — and its sheet opens for a look (the job, the sum, the way: a tap
   * each). Not read (no server, an unreadable paper) — the plain expense sheet, the photo already attached.
   */
  const receipt = (file: File) => {
    setCam(false);
    setScanning(true);
    void scanReceipt(file)
      .then((r) => {
        if (r.expense) {
          haptic('success');
          setRecorded({ id: r.expense.id, others: r.others });
        } else {
          // Fuel, food, another kind of paper: read, but which category is the manager's call — the sheet, filled in, no word.
          if (r.failed !== 'kind') notifications.show({ color: 'orange', message: t(r.failed === 'unsure' ? 'ai.receiptCheck' : 'ai.receiptFailed') });
          setSheet({ kind: 'out', receipt: file, expense: r.fields ? { amountFils: r.fields.amountFils || undefined, vatFils: r.fields.vatFils || undefined, vendor: r.fields.vendor, note: r.fields.note, date: r.fields.date } : undefined });
        }
      })
      .finally(() => setScanning(false));
  };
  /**
   * `slide` — the finger slid onto the action and let go there (the phone opens its own camera only for a tap).
   * «Расход» (v0.50.2, the user: «каждый раз запрашивается разрешение камеры»): by a tap — the phone's own camera, which
   * never asks (a home-screen web app on the iPhone is asked again a minute after the app's camera was let go, and at
   * every launch); by a slide — the app's camera (kept a few minutes after it closes — ui/camera.ts — so the next
   * receipt is not asked about again). Cancelled, or the camera's × — the sheet to type one without a paper.
   */
  const run = (k: QuickKey, slide = false) => {
    if (k === 'photo') {
      if (live && liveCameraAvailable()) setCam('plate');
      else camera.current?.click();
    } else if (k === 'out') {
      if (slide && live && liveCameraAvailable()) setCam('receipt');
      else receiptInput.current?.click();
    } else if (k === 'in') setSheet({ kind: k });
    else navigate('/notes');
  };
  // The phone's own camera closed without a photo: the sheet to type the expense.
  useEffect(() => {
    const el = receiptInput.current;
    if (!el) return;
    const cancelled = () => setSheet({ kind: 'out' });
    el.addEventListener('cancel', cancelled);
    return () => el.removeEventListener('cancel', cancelled);
  }, []);
  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) shot(file);
  };
  const pickedReceipt = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) receipt(file);
  };
  const nodes = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden data-quick-camera onChange={picked} />
      <input ref={receiptInput} type="file" accept="image/*" capture="environment" hidden data-quick-receipt onChange={pickedReceipt} />
      {cam === 'plate' && (
        <LiveCamera
          label={t('quick.photo')}
          onShot={shot}
          onClose={() => ((seen.current = undefined), setCam(false))}
          overlay={(video, live, shoot) => <PlateScan video={video} live={live} onTally={(x) => (seen.current = x)} onTap={shoot} />}
        />
      )}
      {cam === 'receipt' && <LiveCamera label={t('ai.receiptCamera')} onShot={receipt} onClose={() => (setCam(false), setSheet({ kind: 'out' }))} />}
      {scanning && (
        <div className="ai-scan-pill glass" role="status" data-ai-scanning>
          <AiMark size={20} busy />
          <span>{t('ai.receiptReading')}</span>
        </div>
      )}
      <SheetFor value={sheet}>{(s, o) => <EntrySheet opened={o} onClose={() => setSheet(null)} preset={s} />}</SheetFor>
      <SheetFor value={recorded}>{(r, o) => <RecordedExpense id={r.id} others={r.others} opened={o} onClose={() => setRecorded(null)} />}</SheetFor>
    </>
  );
  return { run, nodes };
}

/** The expense just recorded off a receipt, in its own sheet (the book's — the job, the category, the sum, the photo). */
function RecordedExpense({ id, others, opened, onClose }: { id: string; others: JobOption[]; opened: boolean; onClose: () => void }) {
  const lang = useLang();
  const data = useScreenLiveQuery(async () => {
    const [expense, cats] = await Promise.all([db.expenses.get(id), db.expenseCategories.toArray()]);
    return { expense, cats };
  }, [id]);
  // Taken back («Отменить» on the card) while its sheet is up: the sheet goes (a live read keeps its last value, so «gone» is a value).
  const gone = !!data && !data.expense;
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (gone) close.current();
  }, [gone]);
  const expense = data?.expense;
  if (!data || !expense) return null;
  const cat = data.cats.find((c) => c.id === expense.categoryId);
  // The other likely jobs, a tap each (v0.50.2) — not the one it is on now.
  const suggest = others.filter((o) => o.orderId !== expense.orderId);
  return <EntryDetails entry={{ ...expenseEntry(expense), cashAfter: 0, cardAfter: 0 }} label={cat ? (lang === 'ru' ? cat.nameRu : cat.nameEn) : ''} onClose={onClose} cats={data.cats} opened={opened} suggest={suggest} />;
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
  const quick = useQuickActions(true);
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
  const go = (k: QuickKey, slide = false) => {
    close();
    quick.run(k, slide);
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
          else if (k) go(k, true);
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
          if (k) go(k, true);
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
            // Its key (v0.41): N, from anywhere on the PC (ui/desk.tsx).
            rightSection={<Kbd className="desk-kbd-on-fill">N</Kbd>}
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
