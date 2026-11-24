/**
 * Going to a screen from outside the screens (v0.83): a notification tapped while the app is open, a toast's button, the
 * crash screen's «Home». Through the router — the step is the app's own (ui/virtualHistory.ts keeps the browser's
 * history at one page on an iPhone; `location.hash = …` would add a page to it, and with it the browser's swipe).
 */

type Go = (to: string) => void;
let go: Go | null = null;

/** The router's navigate, given once the router is there (App.tsx). */
export function setRouteOpener(fn: Go | null): void {
  go = fn;
}

/** `#/orders/…` or `/orders/…`. */
export function openRoute(to: string): void {
  const path = to.replace(/^#/, '') || '/';
  if (go) go(path);
  else window.location.hash = `#${path}`;
}
