import { useRef, type ReactNode } from 'react';
import { haptic, isApple } from './haptics';

/*
 * A photo for one place (the car's photo, its VIN, the Mulkiya, a damage point): a tap opens the camera, a hold the
 * phone's photos (a right click on a PC too). A phone opens a picker only right in a touch, not from a timer while
 * the finger is down: so after the hold the tile swells and rings ("let go to choose"), and the photos open when the
 * finger lets go — only the photos: the click that would open the camera does nothing. (A file input without
 * `capture` is all a web page has: the iPhone shows its own short menu — Photo Library first — not the library
 * itself; with `capture` the camera opens at once.)
 *
 * On an iPhone the photos open from the click the release brings (v0.46.1): a long, still press is the iPhone's own
 * gesture — iOS 27 sends no pointer end for it, and a picker opened at the touch's end does not show — but the press
 * still ends in a click, and a click opens a picker always. Android (and a PC's touch screen) open them at the
 * touch's end, and its click is held back.
 *
 * Only a finger that moves on before the hold — a scroll, the page's swipe — cancels the press: nothing opens, not
 * even the camera on the click a drifting tap may still bring. A touch the phone takes over while the finger stays
 * still (`pointercancel`, `touchcancel`) is not a scroll: the press is kept, and the click that ends it tells a tap
 * from a hold. Once the hold is there, the thumb may shift a little as it lifts. The hold is told by how long the
 * press lasted, by the events' own clocks, wherever the release lands. A mouse held down works the same.
 */

const HOLD_MS = 450;
/** A finger that moves this far before the hold is scrolling or swiping (as the tab swipe and a tap are told apart). */
const SLOP = 8;
/** Once the hold is there: how far the thumb may shift as it lifts. */
const HELD_SLOP = 24;
/** After a press opened the photos: a click it still brings does nothing for this long (a cancelled one's — at all). */
const SWALLOW_MS = 1000;
/** A press with no release for this long is forgotten: a later click without a press (VoiceOver, a key) is a tap. */
const STALE_MS = 8000;

export function usePhotoPick(onFiles: (files: File[]) => void, opts: { /** Several at once from the photos (both sides of a card). */ multiple?: boolean } = {}): {
  /** Handlers for the tile: the press, its moves, its end, and the right click. */
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchEnd: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchCancel: (e: React.TouchEvent<HTMLElement>) => void;
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  };
  /**
   * For the tile's click: true when the click must not do the tap's action (the camera) — the press was a hold (the
   * photos open, or have opened already) or was cancelled by a scroll.
   */
  consumeClick: () => boolean;
  camera: () => void;
  gallery: () => void;
  /** The two hidden pickers to render. */
  inputs: ReactNode;
} {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const fade = useRef<number | undefined>(undefined);
  const tile = useRef<HTMLElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** When the press began and ended, by the events' own clocks (0 — no press, or it was cancelled). */
  const pressedAt = useRef(0);
  const releasedAt = useRef(0);
  /** The hold's timer went off (the tile swells and rings). Whether it is a hold is told by the events' clock. */
  const held = useRef(false);
  /** When a press was cancelled (a scroll, a drift): the click it may still bring does nothing, however late. */
  const cancelledAt = useRef(0);
  /** The photos were opened by this press already (its touch's end, a right click): its click does nothing. */
  const used = useRef(false);
  /** Until when a click is held back (a press that opened the photos, or one a scroll cancelled). */
  const swallowUntil = useRef(0);
  /** The press came from a finger (an Android long press ends in a context menu, then maybe a click). */
  const touch = useRef(false);
  /** When a finger last let go: a mouse press right after it is the browser's copy of that touch, not a new press. */
  const fingerUpAt = useRef(0);
  const pick = useRef(onFiles);
  pick.current = onFiles;

  const unswell = () => {
    window.clearTimeout(fade.current);
    tile.current?.removeAttribute('data-held');
  };
  const forget = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
    pressedAt.current = 0;
    releasedAt.current = 0;
    held.current = false;
    unswell();
  };
  /** The press goes to nothing: a scroll took it. A click it may still bring is held back. */
  const cancel = () => {
    forget();
    cancelledAt.current = performance.now();
  };
  /**
   * Held long enough by the time `t` (an event's own clock) — not by when the timer got to run: a busy page runs it
   * late, and a thumb shifting as it lifts after a real hold must not count as a drift.
   */
  const heldBy = (t: number) => held.current || (pressedAt.current > 0 && t - pressedAt.current >= HOLD_MS);
  const moved = (x: number, y: number, t: number) => {
    const s = start.current;
    return !!s && Math.hypot(x - s.x, y - s.y) > (heldBy(t) ? HELD_SLOP : SLOP);
  };
  /**
   * Held long enough, the finger kept still — measured from the press to its release (not to when the click is
   * handled: a busy moment must not turn a tap into a hold).
   */
  const isHold = (end = releasedAt.current || performance.now()) => pressedAt.current > 0 && end - pressedAt.current >= HOLD_MS;
  const gallery = () => galleryRef.current?.click();
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.currentTarget.files ?? [])];
    e.currentTarget.value = '';
    if (files.length) pick.current(files);
  };
  /**
   * The finger is off — or the iPhone took the touch over, the finger still down (then the press is measured
   * to the click that ends it). The swell goes soon if no click comes to use it.
   */
  const lifted = (at: number, off: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (off && pressedAt.current > 0 && !releasedAt.current) releasedAt.current = at;
    window.clearTimeout(fade.current);
    fade.current = window.setTimeout(unswell, off ? 700 : 4000);
  };
  /** The finger's own touch: still on the tile while it moves, the one that went at its end (another may rest on the glass). */
  const own = (e: React.TouchEvent<HTMLElement>) => (e.type === 'touchmove' ? e.targetTouches[0] : undefined) ?? e.changedTouches[0];

  return {
    handlers: {
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        // The mouse events a browser makes up after a touch must not restart the finger's press.
        if (e.pointerType === 'mouse' && performance.now() - fingerUpAt.current < SWALLOW_MS) return;
        forget();
        used.current = false;
        swallowUntil.current = 0;
        cancelledAt.current = 0;
        touch.current = e.pointerType !== 'mouse';
        const el = e.currentTarget;
        tile.current = el;
        start.current = { x: e.clientX, y: e.clientY };
        pressedAt.current = e.timeStamp;
        timer.current = window.setTimeout(() => {
          timer.current = undefined;
          held.current = true;
          el.setAttribute('data-held', '');
          haptic('medium');
        }, HOLD_MS);
      },
      onPointerMove: (e) => {
        if (moved(e.clientX, e.clientY, e.timeStamp)) cancel();
      },
      onPointerUp: (e) => lifted(e.timeStamp, true),
      // The phone took the touch over, the finger still down (a scroll is told by the moves, not by this): the press
      // is kept for the click that ends it to tell. A swell not there yet does not come (the touch may be a scroll's).
      onPointerCancel: () => lifted(0, false),
      // A scroll goes on in touches after the pointer was taken away: still a cancelled press.
      onTouchMove: (e) => {
        const t = own(e);
        if (t && moved(t.clientX, t.clientY, e.timeStamp)) cancel();
      },
      onTouchEnd: (e) => {
        fingerUpAt.current = performance.now();
        const t = own(e);
        // Lifted far from where it was pressed (moves the page did not get): a drag, not a hold.
        if (t && moved(t.clientX, t.clientY, e.timeStamp)) return cancel();
        lifted(e.timeStamp, true);
        if (!isHold()) return;
        // The iPhone: the click this release brings opens the photos (consumeClick) — nothing here, and the touch's
        // end is not held back, or that click would not come.
        if (isApple()) return;
        // Right in the touch, so the phone opens it; the click that would open the camera does not come — or, where the
        // touch's end cannot be held back (another finger on the glass makes it a gesture), is swallowed when it does.
        if (e.cancelable) e.preventDefault();
        used.current = true;
        swallowUntil.current = performance.now() + SWALLOW_MS;
        forget();
        gallery();
      },
      onTouchCancel: (e) => {
        fingerUpAt.current = performance.now();
        const t = own(e);
        if (t && moved(t.clientX, t.clientY, e.timeStamp)) cancel();
        else lifted(0, false);
      },
      onContextMenu: (e) => {
        // A right click on a PC; Android sends it for a long press too — the photos open once, here.
        e.preventDefault();
        const finger = touch.current && pressedAt.current > 0;
        forget();
        // A finger's long press may still end in a click (no camera then); a mouse's right click never does.
        used.current = finger;
        if (finger) swallowUntil.current = performance.now() + SWALLOW_MS;
        gallery();
      },
    },
    consumeClick: () => {
      if (used.current) {
        used.current = false;
        return true;
      }
      if (performance.now() < swallowUntil.current) return true;
      // The press this click ends was cancelled (until a new press, or long gone).
      if (cancelledAt.current) {
        const recent = performance.now() - cancelledAt.current < STALE_MS;
        cancelledAt.current = 0;
        if (recent) return true;
      }
      // Never released and long gone, or released a while ago: not this click's press.
      if (pressedAt.current > 0 && !releasedAt.current && performance.now() - pressedAt.current > STALE_MS) forget();
      if (releasedAt.current > 0 && performance.now() - releasedAt.current > SWALLOW_MS) forget();
      const hold = isHold();
      forget();
      if (hold) {
        swallowUntil.current = performance.now() + SWALLOW_MS;
        gallery();
      }
      return hold;
    },
    camera: () => cameraRef.current?.click(),
    gallery,
    inputs: (
      <>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden data-camera-input onChange={take} />
        <input ref={galleryRef} type="file" accept="image/*" multiple={opts.multiple} hidden data-gallery-input onChange={take} />
      </>
    ),
  };
}
