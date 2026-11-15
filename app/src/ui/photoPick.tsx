import { useRef, type ReactNode } from 'react';
import { haptic } from './haptics';

/*
 * A photo for one place (the car's photo, its VIN, the Mulkiya): a tap opens the camera, a hold the phone's
 * photos (a right click on a PC too). The iPhone opens a picker only right in a touch, not from a timer while
 * the finger is down: so after the hold the tile swells a little (`data-held` — "let go to choose"), and the
 * photos open when the finger lets go. A finger that moves (scrolling) is not a hold.
 *
 * The hold is told by how long the press lasted, wherever the release lands: at the touch's end (where it can
 * still be held back — the click that would open the camera then never comes), or at that click itself —
 * the iPhone may take a long, still press over for its own gestures (the page gets `touchcancel`) and still
 * end it with a click; that click opens the photos too. A mouse held down works the same.
 */

const HOLD_MS = 450;

export function usePhotoPick(onFiles: (files: File[]) => void, opts: { /** Several at once from the photos (both sides of a card). */ multiple?: boolean } = {}): {
  /** Handlers for the tile: the press, its end, and the right click. */
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
    onTouchEnd: (e: React.TouchEvent<HTMLElement>) => void;
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  };
  /**
   * For the tile's click: true when the press was a hold — the photos open (or have opened already) and the
   * tap's own action (the camera) must not run.
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
  /** When the press began and ended, by the events' own clocks (0 — no press, or it turned into a scroll). */
  const pressedAt = useRef(0);
  const releasedAt = useRef(0);
  /** The photos were opened by this press already (its touch's end, a right click): its click does nothing. */
  const used = useRef(false);
  /** The press came from a finger (an Android long press ends in a context menu, then maybe a click). */
  const touch = useRef(false);
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
    unswell();
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
  const lifted = (e: React.PointerEvent<HTMLElement>, off: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (off && pressedAt.current > 0 && !releasedAt.current) releasedAt.current = e.timeStamp;
    window.clearTimeout(fade.current);
    fade.current = window.setTimeout(unswell, off ? 700 : 4000);
  };

  return {
    handlers: {
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        forget();
        used.current = false;
        touch.current = e.pointerType !== 'mouse';
        const el = e.currentTarget;
        tile.current = el;
        start.current = { x: e.clientX, y: e.clientY };
        pressedAt.current = e.timeStamp;
        timer.current = window.setTimeout(() => {
          timer.current = undefined;
          el.setAttribute('data-held', '');
          haptic('medium');
        }, HOLD_MS);
      },
      onPointerMove: (e) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) forget();
      },
      onPointerUp: (e) => lifted(e, true),
      // A scroll takes the touch (moved — forgotten already); the iPhone's own long-press gesture takes it too,
      // and then a click may still come: the press is kept for that click to tell.
      onPointerCancel: (e) => lifted(e, false),
      onTouchEnd: (e) => {
        if (!isHold(releasedAt.current || e.timeStamp) || !e.cancelable) return;
        // Right in the touch, so the iPhone opens it; the click that would open the camera does not come.
        e.preventDefault();
        used.current = true;
        forget();
        gallery();
      },
      onContextMenu: (e) => {
        // A right click on a PC; Android sends it for a long press too — the photos open once, here.
        e.preventDefault();
        const finger = touch.current && pressedAt.current > 0;
        forget();
        // A finger's long press may still end in a click (no camera then); a mouse's right click never does.
        used.current = finger;
        gallery();
      },
    },
    consumeClick: () => {
      if (used.current) {
        used.current = false;
        return true;
      }
      const hold = isHold();
      forget();
      if (hold) gallery();
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
