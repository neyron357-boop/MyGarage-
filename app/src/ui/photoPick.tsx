import { useRef, type ReactNode } from 'react';
import { haptic } from './haptics';

/*
 * A photo for one place (the car's photo, its VIN): a tap opens the camera, a long press the phone's photos
 * (a right click on a PC). The iPhone opens a picker only right in a touch, not from a timer while the finger
 * is down: so after the hold the tile swells a little (`data-held` — "let go to choose"), and the photos open
 * when the finger lets go. A finger that moves (scrolling) is not a hold.
 */

const HOLD_MS = 450;

export function usePhotoPick(onFile: (file: File) => void): {
  /** Handlers for the tile: the hold and the right click. */
  handlers: {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchEnd: (e: React.TouchEvent<HTMLElement>) => void;
    onTouchCancel: (e: React.TouchEvent<HTMLElement>) => void;
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  };
  /** True once after a hold: the click that ends it must not open the camera too. */
  consumeClick: () => boolean;
  camera: () => void;
  gallery: () => void;
  /** The two hidden pickers to render. */
  inputs: ReactNode;
} {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);
  const used = useRef(false);
  const touching = useRef(false);
  const pick = useRef(onFile);
  pick.current = onFile;
  const stop = (el?: HTMLElement) => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    el?.removeAttribute('data-held');
  };
  const gallery = () => galleryRef.current?.click();
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) pick.current(file);
  };
  return {
    handlers: {
      onTouchStart: (e) => {
        stop();
        held.current = false;
        used.current = false;
        touching.current = true;
        if (e.touches.length !== 1) return;
        const el = e.currentTarget;
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        timer.current = window.setTimeout(() => {
          timer.current = undefined;
          held.current = true;
          el.setAttribute('data-held', '');
          haptic('medium');
        }, HOLD_MS);
      },
      onTouchMove: (e) => {
        const s = start.current;
        const t = e.touches[0];
        if (s && t && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10) {
          held.current = false;
          stop(e.currentTarget);
        }
      },
      onTouchEnd: (e) => {
        touching.current = false;
        stop(e.currentTarget);
        if (!held.current) return;
        held.current = false;
        // Right in the touch, so the iPhone opens it; the click that would follow (the camera) does not come —
        // or, where it cannot be held back, it is let pass without its action.
        if (e.cancelable) e.preventDefault();
        else used.current = true;
        gallery();
      },
      onTouchCancel: (e) => {
        touching.current = false;
        held.current = false;
        stop(e.currentTarget);
      },
      onContextMenu: (e) => {
        // A right click on a PC; Android sends it for a long press too — the gallery opens once, here.
        e.preventDefault();
        held.current = false;
        stop(e.currentTarget);
        // A finger's long press may still end in a click (no camera then); a mouse's right click never does.
        used.current = touching.current;
        gallery();
      },
    },
    consumeClick: () => {
      const u = used.current;
      used.current = false;
      return u;
    },
    camera: () => cameraRef.current?.click(),
    gallery,
    inputs: (
      <>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden data-camera-input onChange={take} />
        <input ref={galleryRef} type="file" accept="image/*" hidden data-gallery-input onChange={take} />
      </>
    ),
  };
}
