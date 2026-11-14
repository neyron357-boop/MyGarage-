import { Fragment, useEffect, useState, type ReactNode } from 'react';

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

/** How long a sheet takes to leave (the phone theme's exit is 280 ms), with room to spare. */
const EXIT_MS = 450;

/**
 * A sheet opened for a value (the kind of payment, the version to decide on): `{value && <Sheet opened />}`
 * makes it vanish the moment the value is cleared — no slide down, and the next tap falls through to
 * whatever was under it (a tab of the bar). Here the sheet mounts closed and opens on the next frame
 * (it slides in), and when the value goes it keeps the last one while it slides out, then unmounts.
 *
 *   <SheetFor value={pay}>{(kind, o) => <PaymentModal opened={o} kind={kind} … />}</SheetFor>
 */
export function SheetFor<T>({ value, children }: { value: T | null | undefined | false; children: (value: T, opened: boolean) => ReactNode }) {
  const [held, setHeld] = useState<T | undefined>(value || undefined);
  const [shown, setShown] = useState(false);
  // Each opening is a sheet of its own: reopened while the last one is still sliding out, it must not be
  // that one with its state (a refund saved as the prepayment the leaving sheet was opened for).
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(!!value);
  if (!!value !== wasOpen) {
    setWasOpen(!!value);
    if (value) setOpening((n) => n + 1);
  }
  useEffect(() => {
    if (value) setHeld(value);
  }, [value]);
  useEffect(() => {
    if (!value) {
      setShown(false);
      return;
    }
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [value]);
  useEffect(() => {
    if (value || held === undefined) return;
    const t = window.setTimeout(() => setHeld(undefined), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [value, held]);
  const v = value || held;
  if (!v) return null;
  return <Fragment key={opening}>{children(v, !!value && shown)}</Fragment>;
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
