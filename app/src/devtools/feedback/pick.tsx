import { IconArrowsVertical, IconCamera, IconListDetails, IconLoader2, IconPencil, IconPhoto, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Annotator } from './annotator';
import { captureBroken, captureScreen, fileToShot } from './capture';
import { chainOf, describe, elementAt, elementInfo, frontScreen, meaningful, OURS, pageInfo, rectOf, viewportInfo } from './context';
import { Btn, Chip, useEscape, useKeyboardInset, useObjectUrl } from './parts';
import { frameMark, renumber, thumbOf } from './render';
import { addNote, type NewNote } from './store';
import type { FbStrings } from './strings';
import type { FbMark, FbPage, FbRect, FbViewport, Shot } from './types';

/*
 * Pick mode. The page under it is still (every touch, click and press stops at the window — nothing in the app runs),
 * but it scrolls. A tap frames what it means (a control, a row, a card — «Шире» / «Уже» to change it) and opens the
 * note: a few words (or a ready chip), saved — and the app is as before.
 *
 * Light, because it froze the iPhone (v0.40.1): opening it draws a bar and listens at the window — nothing is read from
 * the page, no screenshot is taken, nothing runs every frame. The frame round an element moves only when something
 * moves (a scroll, the keyboard, a resize); a mouse is followed at most once a frame. A screenshot is taken only when
 * asked — «Снимок» on the note (or its empty picture), «Весь экран» — with the keyboard put away first (it changes the
 * screen under the picture); one that failed is not tried again by itself: the phone's photos instead.
 */

/** What the note is about, and the screen as it was when it was chosen (a keyboard opened since changes nothing). */
type Target = ({ kind: 'element'; chain: Element[]; rects: FbRect[]; i: number } | { kind: 'screen' }) & { page: FbPage; viewport: FbViewport; id: number };

const frames = (n: number) => new Promise<void>((done) => (n <= 0 ? done() : requestAnimationFrame(() => void frames(n - 1).then(done))));

/** The keyboard put away and the app back to its whole height (the picture is of the screen without it): ≤ 0.7 s. */
async function keyboardAway(): Promise<void> {
  const vv = window.visualViewport;
  const up = () => document.documentElement.classList.contains('kb') || (!!vv && window.innerHeight - vv.height > 80);
  const t0 = performance.now();
  while (up() && performance.now() - t0 < 700) await new Promise((r) => window.setTimeout(r, 50));
  // The app lays itself out again after the keyboard.
  await frames(2);
}

/** A small screenshot with its frames, in the note's sheet; without one — what a tap on it does (take one, or a photo). */
function ShotThumb({ shot, marks, busy, failed, onTap }: { shot?: Shot; marks: FbMark[]; busy: boolean; failed: boolean; onTap: () => void }) {
  const url = useObjectUrl(shot?.blob);
  return (
    <button type="button" className="fb-shot" onClick={onTap} aria-label="screenshot">
      {url && shot ? (
        <>
          <img src={url} alt="" />
          {marks
            .filter((m) => m.kind === 'rect')
            .map((m) => (
              <span
                key={m.n}
                className="fb-shot-frame"
                style={{ left: `${Math.min(m.x1, m.x2) * 100}%`, top: `${Math.min(m.y1, m.y2) * 100}%`, width: `${Math.abs(m.x2 - m.x1) * 100}%`, height: `${Math.abs(m.y2 - m.y1) * 100}%` }}
              />
            ))}
        </>
      ) : (
        <span className="fb-shot-state">{busy ? <IconLoader2 size={22} className="fb-spin" /> : failed ? <IconPhoto size={22} /> : <IconCamera size={22} />}</span>
      )}
    </button>
  );
}

/** The frame round an element: placed when it is shown and when something moves (a scroll, the keyboard, a resize). */
function useFrame(s: FbStrings) {
  const frame = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const on = useRef<Element | null>(null);
  const raf = useRef(0);
  const flags = useRef({ below: false, right: false });
  const place = useCallback(() => {
    raf.current = 0;
    const el = frame.current;
    const target = on.current;
    if (!el) return;
    if (!target || !target.isConnected) {
      el.style.display = 'none';
      return;
    }
    const r = target.getBoundingClientRect();
    el.style.display = r.width || r.height ? '' : 'none';
    el.style.transform = `translate(${r.left - 3}px, ${r.top - 3}px)`;
    el.style.width = `${r.width + 6}px`;
    el.style.height = `${r.height + 6}px`;
    // Its words keep inside the screen: below the frame at the top, by its right edge when it is on the right.
    const below = r.top < 34;
    const right = r.left + r.width / 2 > window.innerWidth / 2;
    if (below !== flags.current.below) el.toggleAttribute('data-below', (flags.current.below = below));
    if (right !== flags.current.right) el.toggleAttribute('data-right', (flags.current.right = right));
  }, []);
  const show = useCallback(
    (target: Element | null) => {
      if (on.current !== target) {
        on.current = target;
        if (label.current) label.current.textContent = target ? describe(target, s) : '';
      }
      place();
    },
    [place, s],
  );
  useEffect(() => {
    const schedule = () => {
      if (on.current && !raf.current) raf.current = requestAnimationFrame(place);
    };
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    // The screen under it changes its size (the keyboard came or went: the app keeps itself above it).
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
    const screen = frontScreen();
    if (ro && screen) ro.observe(screen);
    return () => {
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      ro?.disconnect();
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [place]);
  return { frame, label, show };
}

export function PickLayer({ s, onExit, onPanel, onSaved, newCount }: { s: FbStrings; onExit: () => void; onPanel: () => void; onSaved: (n: number) => void; newCount: number }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useKeyboardInset(root);
  const [target, setTarget] = useState<Target | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [shooting, setShooting] = useState(false);
  const [failed, setFailed] = useState(captureBroken);
  const [marks, setMarks] = useState<FbMark[]>([]);
  const [comment, setComment] = useState('');
  const [annot, setAnnot] = useState(false);
  const [barTop, setBarTop] = useState(false);
  const [saving, setSaving] = useState(false);
  const text = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const { frame, label, show } = useFrame(s);
  const live = useRef({ target, annot });
  live.current = { target, annot };
  const picks = useRef(0);
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** The frame round the element on the screenshot (the auto mark), for the element chosen now. */
  const withFrame = useCallback((list: FbMark[], t: Target | null, sh: Shot | null): FbMark[] => {
    if (!t || t.kind !== 'element' || !sh?.scale) return renumber(list.filter((m) => !m.auto));
    const f = frameMark(t.rects[t.i], sh.scale, sh.width, sh.height);
    const at = list.findIndex((m) => m.auto);
    return at >= 0 ? list.map((m, k) => (k === at ? { ...f, n: m.n, comment: m.comment } : m)) : renumber([f, ...list]);
  }, []);

  // A screenshot came (or a photo replaced it), or «Шире» / «Уже»: the frame goes on it.
  useEffect(() => {
    if (target?.kind === 'element') setMarks((l) => withFrame(l, target, shot));
  }, [shot, target, withFrame]);

  // The frame: round the element chosen, or (none chosen) what is under the finger or the mouse.
  useLayoutEffect(() => show(target?.kind === 'element' ? target.chain[target.i] : null), [target, show]);

  const pickAt = (x: number, y: number) => {
    const hit = elementAt(x, y);
    if (!hit) return;
    const chain = chainOf(meaningful(hit));
    setTarget({ kind: 'element', chain, rects: chain.map(rectOf), i: 0, page: pageInfo(s), viewport: viewportInfo(), id: ++picks.current });
    setComment('');
    setShot(null);
    setMarks([]);
    // The keyboard in the tap itself (the iPhone gives it no other way).
    text.current?.focus({ preventScroll: true });
  };
  const pickRef = useRef(pickAt);
  pickRef.current = pickAt;
  const hoverAt = (x: number, y: number) => {
    const hit = elementAt(x, y);
    show(hit ? meaningful(hit) : null);
  };
  const hoverRef = useRef(hoverAt);
  hoverRef.current = hoverAt;

  // Every touch, click and press stops at the window: nothing under the tool reacts. Scrolling still works.
  useEffect(() => {
    const mine = (t: EventTarget | null) => t instanceof Element && (t.id === 'mg-haptic' || !!t.closest(OURS));
    const halt = (e: Event) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    let touch: { x: number; y: number; t: number; moved: boolean } | null = null;
    let lastTouch = -1e9;
    let lastPointer = '';
    let mouse: { x: number; y: number } | null = null;
    let hoverFrame = 0;
    const opened = performance.now();
    const onTouchStart = (e: TouchEvent) => {
      if (mine(e.target)) return void (touch = null);
      halt(e);
      const t = e.touches[0];
      touch = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, t: e.timeStamp, moved: false } : null;
      if (touch && !live.current.target) hoverRef.current(touch.x, touch.y);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (mine(e.target)) return;
      halt(e);
      const t = e.touches[0];
      if (touch && !touch.moved && t && Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > 10) {
        touch.moved = true;
        if (!live.current.target) show(null);
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      lastTouch = e.timeStamp;
      if (mine(e.target)) return;
      halt(e);
      // No click, no focus, no follow-up on what is under the finger.
      if (e.cancelable) e.preventDefault();
      const s0 = touch;
      touch = null;
      const t = e.changedTouches[0];
      if (!s0 || s0.moved || !t || e.timeStamp - s0.t > 900) return;
      pickRef.current(t.clientX, t.clientY);
    };
    const onClick = (e: MouseEvent) => {
      if (mine(e.target)) return;
      halt(e);
      e.preventDefault();
      // A touch picks on its end; its click (and a click that comes as the mode opens) picks nothing.
      if (lastPointer === 'touch' || e.timeStamp - lastTouch < 800 || performance.now() - opened < 400 || e.detail === 0) return;
      pickRef.current(e.clientX, e.clientY);
    };
    // A mouse is followed at most once a frame (a finger shows what it is on as it touches, above).
    const onMove = (e: PointerEvent) => {
      if (mine(e.target)) return;
      halt(e);
      if (e.pointerType !== 'mouse' || live.current.target) return;
      mouse = { x: e.clientX, y: e.clientY };
      if (!hoverFrame)
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = 0;
          if (mouse && !live.current.target) hoverRef.current(mouse.x, mouse.y);
        });
    };
    const block = (e: Event) => {
      if (e.type === 'pointerdown') lastPointer = (e as PointerEvent).pointerType;
      if (mine(e.target)) return;
      halt(e);
      if (e.cancelable) e.preventDefault();
    };
    const blocked = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'auxclick', 'touchcancel'] as const;
    window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    window.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    window.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    window.addEventListener('click', onClick, true);
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    for (const t of blocked) window.addEventListener(t, block, true);
    return () => {
      window.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('touchmove', onTouchMove, true);
      window.removeEventListener('touchend', onTouchEnd, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('pointermove', onMove, true);
      for (const t of blocked) window.removeEventListener(t, block, true);
      cancelAnimationFrame(hoverFrame);
    };
  }, [show]);

  /** The screenshot, asked for: the keyboard away first; then, if this is still the note it was asked for, it is its. */
  const takeShot = async () => {
    const t = live.current.target;
    if (!t || busy.current) return;
    busy.current = true;
    setShooting(true);
    text.current?.blur();
    try {
      await keyboardAway();
      const now = live.current.target;
      if (!alive.current || now?.id !== t.id) return;
      // Where the element is at this moment: its frame goes on the picture as it is.
      const rects = now.kind === 'element' ? now.chain.map(rectOf) : undefined;
      const sh = await captureScreen();
      if (!alive.current || live.current.target?.id !== t.id) return;
      if (rects) setTarget((x) => (x && x.id === t.id && x.kind === 'element' ? { ...x, rects } : x));
      setShot(sh);
    } catch (e) {
      console.warn('feedback: no screenshot', e);
      if (alive.current) setFailed(true);
    } finally {
      busy.current = false;
      if (alive.current) setShooting(false);
    }
  };

  /** «Весь экран»: the screenshot (marks on it next), or — none to be had — the note with «Из галереи». */
  const wholeScreen = async () => {
    // No screenshot to be had: one from the phone's photos (the picker opens only in the tap itself).
    if (failed) return file.current?.click();
    if (busy.current) return;
    busy.current = true;
    setShooting(true);
    show(null);
    const t: Target = { kind: 'screen', page: pageInfo(s), viewport: viewportInfo(), id: ++picks.current };
    try {
      const sh = await captureScreen().catch((e: unknown) => {
        console.warn('feedback: no screenshot', e);
        return null;
      });
      // Gone, or an element chosen meanwhile: that is the note now.
      if (!alive.current || live.current.target) return;
      if (!sh) setFailed(true);
      setTarget(t);
      setShot(sh);
      setMarks([]);
      setComment('');
      setAnnot(!!sh);
    } finally {
      busy.current = false;
      if (alive.current) setShooting(false);
    }
  };

  const close = () => {
    setTarget(null);
    setAnnot(false);
    text.current?.blur();
  };
  useEscape(useCallback(() => (live.current.annot ? setAnnot(false) : live.current.target ? close() : onExit()), [onExit]));

  const step = (d: 1 | -1) =>
    setTarget((t) => {
      if (!t || t.kind !== 'element') return t;
      const i = Math.min(t.chain.length - 1, Math.max(0, t.i + d));
      return i === t.i ? t : { ...t, i };
    });

  const addWords = (w: string) => setComment((c) => (c.trim() ? `${c.trim().replace(/[.,;]$/, '')}, ${w.toLowerCase()}` : w));

  const save = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const el = target.kind === 'element' ? target.chain[target.i] : undefined;
      const list = renumber(marks);
      const note: NewNote = {
        kind: target.kind,
        comment: comment.trim(),
        page: target.page,
        element: target.kind === 'element' && el ? elementInfo(el, target.rects[target.i], s) : undefined,
        viewport: target.viewport,
        marks: list,
        appVersion: __APP_VERSION__,
      };
      const thumb = shot ? await thumbOf(shot, list).catch(() => undefined) : undefined;
      const saved = await addNote(note, shot ?? undefined, thumb);
      onSaved(saved.n);
    } catch (e) {
      // Kept on the screen as it is: the words are not lost, «Сохранить» can be tapped again.
      console.error('feedback: not saved', e);
    } finally {
      setSaving(false);
    }
  };

  const canSave = !saving && !shooting && (!!comment.trim() || marks.some((m) => !m.auto));
  const open = !!target && !annot;
  const title = target ? (target.kind === 'element' ? describe(target.chain[target.i], s) : s.whole) : '';
  const own = marks.filter((m) => !m.auto).length;

  return (
    <div className="fb-layer" data-fb-ui ref={setRoot} data-shot={shooting ? 'busy' : shot ? (shot.source === 'gallery' ? 'gallery' : 'ok') : failed ? 'fail' : 'none'}>
      <div className="fb-edge" />
      <div className="fb-frame" ref={frame} style={{ display: 'none' }}>
        <span className="fb-frame-label" ref={label} />
      </div>

      {!target && (
        <div className="fb-bar" data-top={barTop || undefined} style={{ flexWrap: 'wrap' }}>
          <Btn round onClick={onExit} aria-label={s.exit}>
            <IconX size={21} />
          </Btn>
          <div className="fb-bar-hint">{s.hint}</div>
          <Btn round onClick={() => setBarTop((v) => !v)} aria-label={s.moveBar}>
            <IconArrowsVertical size={20} />
          </Btn>
          <div style={{ display: 'flex', gap: 6, width: '100%' }}>
            <Btn style={{ flex: 1 }} disabled={shooting} onClick={() => void wholeScreen()}>
              {shooting ? <IconLoader2 size={19} className="fb-spin" /> : failed ? <IconPhoto size={19} /> : <IconCamera size={19} />}
              {s.whole}
            </Btn>
            <Btn style={{ flex: 1 }} onClick={onPanel}>
              <IconListDetails size={19} />
              {s.mine}
              {newCount > 0 ? ` · ${newCount}` : ''}
            </Btn>
          </div>
        </div>
      )}

      {/* The note: always there (off the screen when closed) — a tap's focus needs its field to exist already. */}
      <div className="fb-sheet" data-open={open || undefined} data-ready>
        <div className="fb-head">
          <ShotThumb
            shot={shot ?? undefined}
            marks={marks}
            busy={shooting}
            failed={failed}
            onTap={() => (shot ? setAnnot(true) : failed ? file.current?.click() : void takeShot())}
          />
          <div className="fb-head-text">
            <div className="fb-title">{title}</div>
            <div className="fb-sub">{target ? [target.page.name, target.page.sheet].filter(Boolean).join(' · ') : ''}</div>
          </div>
          <Btn round onClick={close} aria-label={s.close}>
            <IconX size={20} />
          </Btn>
        </div>
        <div className="fb-row" style={{ flexWrap: 'wrap' }}>
          {target?.kind === 'element' && (
            <>
              <Btn disabled={target.i >= target.chain.length - 1} onClick={() => step(1)}>
                {s.wider}
              </Btn>
              <Btn disabled={target.i === 0} onClick={() => step(-1)}>
                {s.narrower}
              </Btn>
            </>
          )}
          {shot ? (
            <Btn onClick={() => setAnnot(true)}>
              <IconPencil size={18} />
              {s.marks}
              {own ? ` · ${own}` : ''}
            </Btn>
          ) : failed ? (
            <Btn onClick={() => file.current?.click()}>
              <IconPhoto size={18} />
              {s.gallery}
            </Btn>
          ) : (
            <>
              <Btn disabled={shooting} onClick={() => void takeShot()}>
                {shooting ? <IconLoader2 size={18} className="fb-spin" /> : <IconCamera size={18} />}
                {s.snapshot}
              </Btn>
              <Btn round disabled={shooting} onClick={() => file.current?.click()} aria-label={s.gallery}>
                <IconPhoto size={19} />
              </Btn>
            </>
          )}
          {failed && !shot && <span className="fb-sub">{s.noShot}</span>}
        </div>
        <div className="fb-scroll-row">
          {s.quick.map((q) => (
            <Chip key={q} onClick={() => addWords(q)}>
              {q}
            </Chip>
          ))}
        </div>
        <textarea
          ref={text}
          className="fb-text"
          rows={2}
          value={comment}
          readOnly={shooting}
          placeholder={shooting ? s.shooting : s.placeholder}
          onChange={(e) => setComment(e.currentTarget.value)}
          enterKeyHint="done"
          aria-label={s.comment}
          tabIndex={open ? 0 : -1}
        />
        <div className="fb-row">
          <Btn primary wide disabled={!canSave} onClick={() => void save()}>
            {saving ? <IconLoader2 size={20} className="fb-spin" /> : null}
            {s.save}
          </Btn>
        </div>
      </div>

      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!f) return;
          const g = await fileToShot(f).catch((err: unknown) => {
            console.warn('feedback: the photo is not read', err);
            return null;
          });
          if (!g || !alive.current) return;
          setShot(g);
          if (!live.current.target) {
            // «Весь экран» with no screenshot of its own: the photo is the screen.
            setTarget({ kind: 'screen', page: pageInfo(s), viewport: viewportInfo(), id: ++picks.current });
            setMarks([]);
            setComment('');
            setAnnot(true);
          }
        }}
      />

      {annot && shot && (
        <Annotator
          s={s}
          shot={shot}
          marks={marks}
          onCancel={() => {
            setAnnot(false);
            if (target?.kind === 'screen' && !marks.length && !comment) setTarget(null);
          }}
          onDone={(list) => {
            setMarks(renumber(list));
            setAnnot(false);
          }}
        />
      )}
    </div>
  );
}
