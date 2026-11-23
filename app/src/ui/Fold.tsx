import { useEffect, useState, type ReactNode } from 'react';

/**
 * What folds away and back (a debtor's card, «ещё» of a form). Its height is never pinned in pixels — a grid row going
 * from 0fr to 1fr (`.fold` in styles.css) — so what comes into it later (rows read after it opened, a list unfolded
 * inside it) is never cut, and one fold can stand inside another.
 *
 * Not Mantine's `Collapse` (v0.72, the user's PC: «раскрываю paid month — отображается один месяц, а другой спрятан
 * внизу»): it measures the height once and lets it go at `transitionend`; with the system's animations off
 * (`prefers-reduced-motion` — Windows «Показывать анимацию» выключено) nothing moves, that event never comes, and the
 * height measured at the opening stayed for good — whatever appeared after it was cut by the card.
 */
export function Fold({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  // Standing open, it clips nothing (a field's focus ring, a button's glow at its edge). A timer, not the transition's
  // end: with motion reduced there is no transition to end.
  const [still, setStill] = useState(open);
  useEffect(() => {
    if (!open) return setStill(false);
    const timer = window.setTimeout(() => setStill(true), 320);
    return () => window.clearTimeout(timer);
  }, [open]);
  return (
    // (`inert` as React 18 passes it: an attribute with an empty value — folded, nothing in it takes a key or a click.)
    <div className={className ? `fold ${className}` : 'fold'} data-open={open || undefined} data-still={still || undefined} aria-hidden={!open} {...(open ? null : ({ inert: '' } as object))}>
      <div className="fold-in">{children}</div>
    </div>
  );
}
