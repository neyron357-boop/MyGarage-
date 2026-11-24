/**
 * The installed app on an iPhone keeps the browser's history at one page (v0.83, the owner: «заблокировать браузерный
 * свайп всей страницы, чтобы не было как в веб-сайтах»).
 *
 * Since iOS 26 a web app opened from the Home Screen has Safari's swipe between pages: from the edge, a picture of the
 * page before slides in under the finger — another screen of the app with its own tab bar — and the app's own swipe
 * (ui/stack.tsx) and screens fight it. WebKit starts that gesture only when its history has a page to go to. So here the
 * browser's history never gets a second page: each step of the app's own history — a screen, a sheet's Back step
 * (ui/backCloses.ts), the camera or a photo viewer (ui/historyLayer.ts) — is kept in memory behind the same `history`
 * object. `pushState`, `replaceState`, `go`, `back`, `forward`, `state` and `length` act on that list; the address follows
 * by the browser's own `replaceState` (a reload opens the same screen); a step back or forward is told by `popstate`, as
 * the browser tells it. React Router, the sheets and the layers work unchanged.
 *
 * Only the installed app on Apple devices (Safari in a tab keeps its own history and swipes — the stack leaves the edge to
 * them). `localStorage['mygarage.vhistory']` = '1' / '0' turns it on or off on any browser (tests).
 *
 * Steps that leave the app's code — a link to `#/…` followed by the browser, `location.hash = …` — would still add a
 * page to the browser's history: the app goes through the router instead (ui/openRoute.ts).
 */

interface Step {
  state: unknown;
  url: string;
}

let installed = false;

export function virtualHistoryWanted(): boolean {
  if (typeof window === 'undefined') return false;
  let forced: string | null = null;
  try {
    forced = localStorage.getItem('mygarage.vhistory');
  } catch {
    // no storage
  }
  if (forced === '1') return true;
  if (forced === '0') return false;
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;
  return apple && standalone;
}

/** Is the app's history kept here (and not in the browser's)? */
export const virtualHistoryOn = () => installed;

/** Put the app's history in memory. Call before anything reads or writes `history` (before the router is made). */
export function installVirtualHistory(): boolean {
  if (installed || !virtualHistoryWanted()) return installed;
  const real = window.history;
  const proto = History.prototype;
  const realReplace = (state: unknown, url: string) => proto.replaceState.call(real, state, '', url);
  const realState = Object.getOwnPropertyDescriptor(proto, 'state')?.get?.call(real) as Record<string, unknown> | null | undefined;
  // The page the app opens on is the first step: whatever position it had in an earlier history (a reload) is gone, and so
  // are a sheet's or a layer's marks (their steps are not here).
  const first = realState && typeof realState === 'object' ? { usr: realState.usr ?? null, key: realState.key ?? 'default', idx: 0 } : realState ?? null;
  const steps: Step[] = [{ state: first, url: location.href }];
  let at = 0;
  let telling = 0;
  realReplace(first, location.href);

  const abs = (url?: string | URL | null) => (url === undefined || url === null ? location.href : new URL(String(url), location.href).href);
  // The browser tells a step back or forward after the call has returned, once — several in a row are told as one.
  const tell = () => {
    if (telling) return;
    telling = window.setTimeout(() => {
      telling = 0;
      const s = steps[at];
      realReplace(s.state, s.url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: s.state }));
    }, 0);
  };
  const go = (delta = 0) => {
    if (!delta) {
      location.reload();
      return;
    }
    const to = at + delta;
    // Past either end: nothing happens, as in the browser.
    if (to < 0 || to >= steps.length) return;
    at = to;
    tell();
  };
  const define = (name: string, value: unknown) => Object.defineProperty(real, name, { configurable: true, writable: true, value });
  define('pushState', (state: unknown, _unused: string, url?: string | URL | null) => {
    const href = abs(url);
    steps.length = at + 1;
    steps.push({ state: state ?? null, url: href });
    at++;
    realReplace(state ?? null, href);
  });
  define('replaceState', (state: unknown, _unused: string, url?: string | URL | null) => {
    const href = abs(url);
    steps[at] = { state: state ?? null, url: href };
    realReplace(state ?? null, href);
  });
  define('go', go);
  define('back', () => go(-1));
  define('forward', () => go(1));
  Object.defineProperty(real, 'state', { configurable: true, get: () => steps[at].state });
  Object.defineProperty(real, 'length', { configurable: true, get: () => steps.length });
  installed = true;
  document.documentElement.dataset.vhistory = '';
  return true;
}
