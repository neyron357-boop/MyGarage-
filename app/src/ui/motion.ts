import { useEffect, useRef, useState } from 'react';

/*
 * Motion that a native list has and a web page lacks. Everything here stands down when the phone asks
 * for reduced motion, and never runs on a screen that is not shown.
 */

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE_IOS = 'cubic-bezier(0.32, 0.72, 0, 1)';
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

type Box = { x: number; y: number; w: number; h: number };

/**
 * A list that moves like the iPhone's: a new row comes in softly, a removed one fades where it was while
 * the rows under it close the gap, rows that change places slide to them, and the list's own height
 * follows — so what is under the list glides instead of jumping. (FLIP on the Web Animations API: only
 * transforms and opacity, and one short height animation of the list itself.)
 *
 * The container must clip (`.list` does) and is made the rows' offset parent. Many rows changing at
 * once (a filter) are not animated — that would be a show, not a help.
 */
export function useAutoAnimate<T extends HTMLElement>(enabled = true): (el: T | null) => void {
  // A callback ref: the list may appear later than the component (nothing to show at first).
  const [parent, setParent] = useState<T | null>(null);
  useEffect(() => {
    if (!enabled || !parent || typeof MutationObserver === 'undefined' || typeof parent.animate !== 'function') return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const boxes = new WeakMap<Element, Box>();
    let height = parent.offsetHeight;
    const rows = () => ([...parent.children] as HTMLElement[]).filter((c) => !c.dataset.ghost);
    // Layout positions (offset*), not what is on screen: a row caught mid-flight is measured where it lands.
    const box = (el: HTMLElement): Box => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    const remember = () => {
      rows().forEach((c) => boxes.set(c, box(c)));
      height = parent.offsetHeight;
    };
    remember();
    const shown = () => parent.getClientRects().length > 0 && !document.hidden;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => remember()) : undefined;
    ro?.observe(parent);
    const mo = new MutationObserver((records) => {
      const added = new Set<HTMLElement>();
      const gone = new Set<HTMLElement>();
      for (const r of records) {
        r.addedNodes.forEach((n) => n instanceof HTMLElement && !n.dataset.ghost && added.add(n));
        r.removedNodes.forEach((n) => n instanceof HTMLElement && !n.dataset.ghost && gone.add(n));
      }
      const now = rows();
      const fresh = now.filter((c) => !boxes.has(c));
      const removed = [...gone].filter((n) => n.parentNode !== parent && boxes.has(n));
      if (!added.size && !gone.size) return;
      if (reduced() || !shown() || fresh.length + removed.length > 6) return remember();
      const was = height;
      // The rows that stay slide from where they were to where they are.
      for (const c of now) {
        const old = boxes.get(c);
        if (!old) continue;
        const b = box(c);
        const dx = old.x - b.x;
        const dy = old.y - b.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 340, easing: EASE_IOS });
      }
      // A new row comes in softly…
      for (const c of fresh) c.animate([{ opacity: 0, transform: 'translateY(-8px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: EASE_OUT });
      // …a removed one fades where it stood (a copy of it: the row itself is already gone).
      for (const n of removed) {
        const b = boxes.get(n)!;
        const ghost = n.cloneNode(true) as HTMLElement;
        ghost.dataset.ghost = '1';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.cssText += `;position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;margin:0;pointer-events:none;`;
        parent.appendChild(ghost);
        const a = ghost.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.97)' }], { duration: 220, easing: EASE_OUT, fill: 'forwards' });
        a.onfinish = a.oncancel = () => ghost.remove();
      }
      // The list's height follows, so what stands under it glides.
      const h = parent.offsetHeight;
      if (Math.abs(h - was) > 1) parent.animate([{ height: `${was}px` }, { height: `${h}px` }], { duration: 340, easing: EASE_IOS });
      remember();
    });
    mo.observe(parent, { childList: true });
    return () => {
      mo.disconnect();
      ro?.disconnect();
    };
  }, [enabled, parent]);
  return setParent;
}

/**
 * A figure that runs to its new value instead of blinking to it (a total after a line is added, a
 * balance after a payment): a third of a second, easing out.
 */
export function useRolling(value: number, on = true): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (!on || start === value || reduced() || typeof requestAnimationFrame !== 'function' || document.hidden) {
      from.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 380);
      const v = Math.round(start + (value - start) * (1 - Math.pow(1 - k, 3)));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, on]);
  return on ? shown : value;
}

/**
 * A moment worth a mark — the car handed over, the job paid: a tick drawn in the middle of the screen
 * for a second (ui/components `Celebration` shows it). Nothing to tap, nothing blocked.
 */
type Listener = (label: string) => void;
const listeners = new Set<Listener>();
export function celebrate(label: string): void {
  listeners.forEach((l) => l(label));
}
export function onCelebrate(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}
