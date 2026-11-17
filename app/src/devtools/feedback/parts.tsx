import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

/*
 * Small pieces the tool's screens share: a button that ticks on the iPhone like the app's own, the keyboard's height,
 * a picture's address while it is shown.
 */

/** The iPhone's tick, as the app gives it (ui/haptics.ts): a label over the control, for its hidden switch. */
function Tick() {
  const html = document.documentElement.classList;
  if (!html.contains('haptic-labels') || html.contains('no-haptics') || !document.getElementById('mg-haptic')) return null;
  return <label htmlFor="mg-haptic" className="haptic-hit" aria-hidden />;
}

export function Btn({
  children,
  primary,
  danger,
  round,
  wide,
  on,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; primary?: boolean; danger?: boolean; round?: boolean; wide?: boolean; on?: boolean }) {
  return (
    <button
      type="button"
      className="fb-btn"
      data-primary={primary || undefined}
      data-danger={danger || undefined}
      data-round={round || undefined}
      data-wide={wide || undefined}
      data-on={on || undefined}
      {...rest}
    >
      {children}
      {!rest.disabled && <Tick />}
    </button>
  );
}

export function Chip({ children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button type="button" className="fb-chip" {...rest}>
      {children}
      <Tick />
    </button>
  );
}

/** How much of the screen the keyboard covers from below (0 without one), kept in `--fb-kb` on the tool's layer. */
export function useKeyboardInset(el: HTMLElement | null) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!el || !vv) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const covered = Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)));
      el.style.setProperty('--fb-kb', `${covered > 60 ? covered : 0}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
    };
  }, [el]);
}

/** An object URL for a picture while it is shown. */
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** Sizes as a person reads them: «340 КБ», «2,4 МБ». */
export function sizeText(bytes: number, kb: string, mb: string, lang: string): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ${kb}`;
  return `${(bytes / 1024 / 1024).toLocaleString(lang.startsWith('en') ? 'en' : 'ru', { maximumFractionDigits: 1 })} ${mb}`;
}

/** Keys and taps inside the tool stay in the tool: Esc closes it, not a sheet of the app under it. */
export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onEscape();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onEscape]);
}
