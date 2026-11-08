import { Action, createHashHistory, type HashHistory, type Location } from '@remix-run/router';

type Update = { action: Action; location: Location; delta: number | null };
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Router } from 'react-router-dom';

/**
 * The app's router: a hash router (works from any static hosting and the file system) whose screen
 * changes are animated like a native navigation stack. A screen that opens slides in from the right
 * over the one it came from; "Back" slides it out again; the bottom tabs cross-fade.
 *
 * The animation is a same-document View Transition (Safari 18+, Chrome 111+): the old screen is
 * captured, the route changes synchronously, the new screen is captured, and CSS in styles.css
 * (`::view-transition-*(page)`) moves the two images. Where the browser lacks it, or the person asked
 * for reduced motion, screens just appear (with the small CSS entrance of `page-enter`).
 */

export type NavDirection = 'push' | 'pop' | 'tab' | 'none';

/** The screens of the bottom tab bar: switching between them is not a push. */
export const TAB_ROOTS = new Set(['/', '/search', '/money', '/more']);

/** What the back swipe leaves for the next navigation: the screen is already partly off the edge. */
let preset: { dir: NavDirection; progress: number } | null = null;

export function presetNavigation(dir: NavDirection, progress = 0) {
  preset = { dir, progress };
}

type VTDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> };
};

export function viewTransitionsSupported(): boolean {
  return typeof document !== 'undefined' && typeof (document as VTDocument).startViewTransition === 'function';
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function direction(from: Location, to: Location, action: Action, delta: number | null): NavDirection {
  // Same screen, other tab or filter in the address (or a sheet's history step): nothing moves.
  if (from.pathname === to.pathname) return 'none';
  const tabs = TAB_ROOTS.has(from.pathname) && TAB_ROOTS.has(to.pathname);
  if (tabs) return 'tab';
  if (action === Action.Pop) return delta !== null && delta > 0 ? 'push' : 'pop';
  return 'push';
}

/**
 * The new screen first shows a loading placeholder for a few milliseconds while it reads the device
 * database; captured like that it would slide in empty. So the capture waits for the data — briefly.
 */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (!document.querySelector('.skeleton-page') || performance.now() - start > 160) resolve();
      else window.setTimeout(tick, 16);
    };
    tick();
  });
}

export function AppRouter({ children, animated }: { children: ReactNode; animated: boolean }) {
  const historyRef = useRef<HashHistory>();
  if (!historyRef.current) historyRef.current = createHashHistory({ window, v5Compat: true });
  const history = historyRef.current;
  const [state, setState] = useState({ action: history.action, location: history.location });
  const animatedRef = useRef(animated);
  animatedRef.current = animated;
  const current = useRef(history.location);

  useLayoutEffect(
    () =>
      history.listen((update: Update) => {
        const from = current.current;
        current.current = update.location;
        const next = preset;
        preset = null;
        const dir = next?.dir ?? direction(from, update.location, update.action, update.delta);
        const doc = document as VTDocument;
        // A hidden document cannot animate (the browser skips the transition with an error).
        if (dir === 'none' || !animatedRef.current || !doc.startViewTransition || reducedMotion() || document.hidden) {
          setState(update);
          return;
        }
        const html = document.documentElement;
        const progress = next?.progress ?? 0;
        html.dataset.nav = dir;
        html.style.setProperty('--swipe-p', String(progress));
        // After a swipe the screen has the rest of the way to go: a shorter animation keeps its speed.
        html.style.setProperty('--vt-dur', `${Math.round(140 + 240 * (1 - progress))}ms`);
        const transition = doc.startViewTransition(async () => {
          flushSync(() => setState(update));
          await settled();
        });
        // A skipped transition (tab hidden, viewport resized) rejects these; the screen has changed anyway.
        transition.ready.catch(() => undefined);
        transition.updateCallbackDone.catch(() => undefined);
        transition.finished
          .catch(() => undefined)
          .finally(() => {
            if (html.dataset.nav !== dir) return;
            delete html.dataset.nav;
            html.style.removeProperty('--swipe-p');
            html.style.removeProperty('--vt-dur');
          });
      }),
    [history],
  );

  return (
    <Router basename="/" location={state.location} navigationType={state.action} navigator={history}>
      {children}
    </Router>
  );
}
