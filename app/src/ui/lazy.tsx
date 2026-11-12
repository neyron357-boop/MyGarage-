import { useEffect, useState, type ReactNode } from 'react';

/**
 * A sheet that is not there until it is first opened: the screen it belongs to renders without it (a job
 * opens faster — no form, no queries of a sheet nobody asked for), and it still slides in — it is mounted
 * closed, then opened on the next frame. Once opened it stays mounted, so it slides out and opens at once
 * the next time.
 *
 * `warm` — a sheet that is opened often (a line of the job): made closed in a quiet moment after the
 * screen has settled, so even the first tap only opens it.
 *
 *   <LazySheet opened={open}>{(o) => <SomeSheet opened={o} … />}</LazySheet>
 */
export function LazySheet({ opened, warm, children }: { opened: boolean; warm?: boolean; children: (opened: boolean) => ReactNode }) {
  const [mounted, setMounted] = useState(opened);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (opened && !mounted) setMounted(true);
  }, [opened, mounted]);
  useEffect(() => {
    if (!warm || mounted) return;
    return whenQuiet(() => setMounted(true));
  }, [warm, mounted]);
  useEffect(() => {
    if (!mounted || ready) return;
    const r = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(r);
  }, [mounted, ready]);
  if (!mounted) return null;
  return <>{children(ready && opened)}</>;
}

/** Runs `fn` once the page is idle (after a screen's slide has ended); Safari has no idle callback — a timer. */
function whenQuiet(fn: () => void): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  let idle = 0;
  const t = window.setTimeout(() => {
    if (w.requestIdleCallback) idle = w.requestIdleCallback(fn, { timeout: 1500 });
    else fn();
  }, 900);
  return () => {
    window.clearTimeout(t);
    if (idle) w.cancelIdleCallback?.(idle);
  };
}
