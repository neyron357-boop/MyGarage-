import { IconArrowsVertical, IconCamera, IconCameraOff, IconListDetails, IconLoader2, IconPencil, IconPhoto, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Annotator } from './annotator';
import { captureScreen, fileToShot } from './capture';
import { chainOf, describe, elementAt, elementInfo, meaningful, OURS, pageInfo, rectOf, viewportInfo } from './context';
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
 * The screenshot is taken as the mode opens (the screen as it is, without the tool) and again when a scroll stops, so
 * that a tap usually finds it ready: then the field gets the keyboard in the tap itself (the iPhone gives it no other
 * way). Taken while a tap waits, the field waits too — the keyboard would change the screen under the picture.
 */

type Cap = { state: 'busy' } | { state: 'ok'; shot: Shot } | { state: 'fail' };
/** What the note is about, and the screen as it was when it was chosen (a keyboard opened since changes nothing). */
type Target = ({ kind: 'element'; chain: Element[]; rects: FbRect[]; i: number } | { kind: 'screen' }) & { page: FbPage; viewport: FbViewport };

/** A small screenshot with its frames, in the note's sheet. */
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
        <span className="fb-shot-state">{busy ? <IconLoader2 size={22} className="fb-spin" /> : failed ? <IconCameraOff size={22} /> : <IconCamera size={22} />}</span>
      )}
    </button>
  );
}

export function PickLayer({ s, onExit, onPanel, onSaved, newCount }: { s: FbStrings; onExit: () => void; onPanel: () => void; onSaved: (n: number) => void; newCount: number }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useKeyboardInset(root);
  const [cap, setCap] = useState<Cap>({ state: 'busy' });
  const [target, setTarget] = useState<Target | null>(null);
  const [hover, setHover] = useState<Element | null>(null);
  const [marks, setMarks] = useState<FbMark[]>([]);
  const [gallery, setGallery] = useState<Shot | null>(null);
  const [comment, setComment] = useState('');
  const [annot, setAnnot] = useState(false);
  const [barTop, setBarTop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wantScreen, setWantScreen] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  /** Scrolls since the mode opened, and the count the screenshot was taken at (a scroll since — it is old). */
  const epoch = useRef(0);
  const shotAt = useRef(-1);
  const live = useRef({ cap, target, annot });
  live.current = { cap, target, annot };

  /** The latest screenshot asked for: only it may say how it went (an older one still running is forgotten). */
  const run = useRef(0);
  const shoot = useCallback(async () => {
    const at = epoch.current;
    const me = ++run.current;
    setCap({ state: 'busy' });
    try {
      const shot = await captureScreen();
      if (me !== run.current || epoch.current !== at) return;
      shotAt.current = at;
      setCap({ state: 'ok', shot });
    } catch (e) {
      console.warn('feedback: no screenshot', e);
      if (me === run.current) setCap({ state: 'fail' });
    }
  }, []);

  useEffect(() => {
    void shoot();
    let t = 0;
    const onScroll = (e: Event) => {
      const el = e.target instanceof Element ? e.target : null;
      // The tool's own scroll, or the screen held still under a note being written, changes nothing.
      if (el?.closest(OURS) || live.current.target || live.current.annot) return;
      epoch.current++;
      window.clearTimeout(t);
      t = window.setTimeout(() => void shoot(), 350);
    };
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.clearTimeout(t);
      // Gone (or, in development, mounted twice on purpose): what it was taking is not waited for.
      run.current++;
    };
  }, [shoot]);

  const shot = gallery ?? (cap.state === 'ok' ? cap.shot : undefined);
  const ready = (c: Cap) => c.state === 'fail' || (c.state === 'ok' && shotAt.current === epoch.current);
  const waiting = !gallery && !ready(cap);

  /** The frame round the element on the screenshot (the auto mark), for the element chosen now. */
  const withFrame = useCallback((list: FbMark[], t: Target | null, sh: Shot | undefined): FbMark[] => {
    if (!t || t.kind !== 'element' || !sh?.scale) return renumber(list.filter((m) => !m.auto));
    const f = frameMark(t.rects[t.i], sh.scale, sh.width, sh.height);
    const at = list.findIndex((m) => m.auto);
    return at >= 0 ? list.map((m, k) => (k === at ? { ...f, n: m.n, comment: m.comment } : m)) : renumber([f, ...list]);
  }, []);

  // The screenshot came after the tap (or a photo replaced it): the frame goes on it.
  useEffect(() => {
    if (target?.kind === 'element') setMarks((l) => withFrame(l, target, shot));
  }, [shot, target, withFrame]);

  const pickAt = (x: number, y: number) => {
    const hit = elementAt(x, y);
    if (!hit) return;
    const chain = chainOf(meaningful(hit));
    const t: Target = { kind: 'element', chain, rects: chain.map(rectOf), i: 0, page: pageInfo(s), viewport: viewportInfo() };
    setTarget(t);
    setHover(null);
    setComment('');
    setGallery(null);
    setMarks([]);
    // The keyboard in the tap itself — only over a screenshot already taken.
    if (ready(live.current.cap)) text.current?.focus({ preventScroll: true });
  };
  const pickRef = useRef(pickAt);
  pickRef.current = pickAt;
  const hoverAt = (x: number, y: number) => {
    const hit = elementAt(x, y);
    setHover(hit ? meaningful(hit) : null);
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
      if (touch && t && Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > 10) {
        touch.moved = true;
        if (!live.current.target) setHover(null);
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
    const onMove = (e: PointerEvent) => {
      if (mine(e.target)) return;
      halt(e);
      if (e.pointerType === 'mouse' && !live.current.target) hoverRef.current(e.clientX, e.clientY);
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
    window.addEventListener('pointermove', onMove, true);
    for (const t of blocked) window.addEventListener(t, block, true);
    return () => {
      window.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('touchmove', onTouchMove, true);
      window.removeEventListener('touchend', onTouchEnd, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('pointermove', onMove, true);
      for (const t of blocked) window.removeEventListener(t, block, true);
    };
  }, []);

  // The frame follows its element (a scroll, the keyboard), each frame while there is one.
  const framed = target?.kind === 'element' ? target.chain[target.i] : hover;
  const label = useMemo(() => (framed ? describe(framed, s) : ''), [framed, s]);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    if (!framed) {
      el.style.display = 'none';
      return;
    }
    let raf = 0;
    const place = () => {
      const r = framed.getBoundingClientRect();
      el.style.display = r.width || r.height ? '' : 'none';
      el.style.left = `${r.left - 3}px`;
      el.style.top = `${r.top - 3}px`;
      el.style.width = `${r.width + 6}px`;
      el.style.height = `${r.height + 6}px`;
      if (r.top < 34) el.setAttribute('data-below', '');
      else el.removeAttribute('data-below');
      // Its words keep inside the screen: by the frame's right edge when the frame is on the right.
      if (r.left + r.width / 2 > window.innerWidth / 2) el.setAttribute('data-right', '');
      else el.removeAttribute('data-right');
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [framed]);

  // «Весь экран»: the screenshot as it is (waited for, if it is being taken), marks on it, then its words.
  useEffect(() => {
    if (!wantScreen) return;
    if (cap.state === 'busy') return;
    setWantScreen(false);
    setHover(null);
    setTarget({ kind: 'screen', page: pageInfo(s), viewport: viewportInfo() });
    setMarks([]);
    setComment('');
    setGallery(null);
    // No screenshot after all: the note's sheet, with «Из галереи» on it.
    setAnnot(cap.state === 'ok');
  }, [wantScreen, cap, s]);

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
      const saved = await addNote(note, shot, thumb);
      onSaved(saved.n);
    } catch (e) {
      // Kept on the screen as it is: the words are not lost, «Сохранить» can be tapped again.
      console.error('feedback: not saved', e);
    } finally {
      setSaving(false);
    }
  };

  const canSave = !saving && (!!comment.trim() || marks.some((m) => !m.auto));
  const open = !!target && !annot;
  const title = target ? (target.kind === 'element' ? describe(target.chain[target.i], s) : s.whole) : '';

  return (
    <div className="fb-layer" data-fb-ui ref={setRoot} data-shot={gallery ? 'gallery' : cap.state}>
      <div className="fb-edge" />
      <div className="fb-frame" ref={frame} style={{ display: 'none' }}>
        <span className="fb-frame-label">{label}</span>
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
            <Btn
              style={{ flex: 1 }}
              onClick={() => {
                // No screenshot to be had: one from the phone's photos (the picker opens only in the tap itself).
                if (cap.state === 'fail') return file.current?.click();
                setWantScreen(true);
              }}
            >
              {wantScreen && cap.state === 'busy' ? <IconLoader2 size={19} className="fb-spin" /> : <IconCamera size={19} />}
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
          <ShotThumb shot={shot} marks={marks} busy={waiting} failed={cap.state === 'fail' && !gallery} onTap={() => (shot ? setAnnot(true) : file.current?.click())} />
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
              {marks.filter((m) => !m.auto).length ? ` · ${marks.filter((m) => !m.auto).length}` : ''}
            </Btn>
          ) : (
            <Btn onClick={() => file.current?.click()}>
              <IconPhoto size={18} />
              {s.gallery}
            </Btn>
          )}
          {cap.state === 'fail' && !gallery && <span className="fb-sub">{s.noShot}</span>}
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
          readOnly={waiting}
          placeholder={waiting ? s.shooting : s.placeholder}
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
          const g = await fileToShot(f);
          setGallery(g);
          if (!live.current.target) {
            // «Весь экран» with no screenshot of its own: the photo is the screen.
            setTarget({ kind: 'screen', page: pageInfo(s), viewport: viewportInfo() });
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
