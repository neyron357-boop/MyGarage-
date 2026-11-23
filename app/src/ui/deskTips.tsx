import { useEffect } from 'react';

/*
 * What a button without words is, said to the mouse resting on it (v0.72, the PC only — mounted by `DesktopShell`).
 *
 * The PC's toolbars, cards and rows are full of round buttons with only a symbol (a lock, «поделиться», a pin, a
 * star, WhatsApp): a finger learns them by pressing, a mouse asks first. Every such button already has its name for a
 * screen reader (`aria-label`); this shows that name under it — one listener for the whole window and one element in
 * the page, nothing per button, no state in React (the label follows the mouse, not a render).
 *
 * Whose name is shown: a `button`, a link or a `role="button"` with an `aria-label` and no words of its own (a
 * symbol, or a symbol with a count); anything with `data-tip`; a line cut short with « … » (`.dt-clip`, the toolbar's
 * title) — its whole text. Not shown: what has words, what has a native `title`, what is disabled or has its menu open.
 *
 * As a desktop app does it (Vercel's and Rauno's interface guidelines): the first one waits half a second — the mouse
 * crossing the toolbar opens nothing; once one is up, its neighbours answer at once and without the fade; a press, a
 * key, the wheel or a scroll puts it away. A key's focus (Tab) shows it too.
 */

const WAIT = 500;
/** How long after one went away the next one still comes at once. */
const WARM = 400;
const GAP = 8;
const EDGE = 8;
/** A button with only a symbol is no bigger than this. */
const SMALL = 72;

const CONTROL = 'button, a[href], [role="button"], [data-tip]';
const CLIPPED = '.dt-clip, .desk-title, [data-clip]';

/** What to say about what is under the mouse, and about which element; nothing — null. */
function tipOf(from: EventTarget | null): { el: HTMLElement; text: string } | null {
  const start = from instanceof Element ? from : null;
  if (!start) return null;
  const el = start.closest<HTMLElement>(CONTROL);
  if (el && !el.closest('.desk-tip')) {
    const own = el.dataset.tip;
    if (own) return { el, text: own };
    const label = el.getAttribute('aria-label')?.trim();
    const words = el.textContent?.trim() ?? '';
    const quiet = el.hasAttribute('title') || el.matches(':disabled, [data-disabled], [aria-disabled="true"], [aria-expanded="true"]');
    // A symbol alone, or with a count beside it («4» on the bell); a button with words says it itself. And a small
    // one: a card that is one big button (a car on the board) is not a symbol to explain.
    if (label && !quiet && words.length <= 3 && label !== words) {
      const r = el.getBoundingClientRect();
      if (r.width <= SMALL && r.height <= SMALL) return { el, text: label };
    }
  }
  const cut = start.closest<HTMLElement>(CLIPPED);
  if (cut && cut.scrollWidth > cut.clientWidth + 1) {
    const text = cut.textContent?.trim();
    if (text) return { el: cut, text };
  }
  return null;
}

export function DeskTips() {
  useEffect(() => {
    const tip = document.createElement('div');
    tip.className = 'desk-tip';
    // The name is the control's own `aria-label` already: a reader must not hear it twice.
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);

    let on: HTMLElement | null = null;
    let timer = 0;
    let shown = false;
    let wentAt = 0;

    const place = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const below = r.bottom + GAP + h <= window.innerHeight - EDGE;
      const left = Math.max(EDGE, Math.min(window.innerWidth - EDGE - w, r.left + r.width / 2 - w / 2));
      const top = below ? r.bottom + GAP : Math.max(EDGE, r.top - GAP - h);
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      tip.dataset.side = below ? 'bottom' : 'top';
    };
    const show = (el: HTMLElement, text: string, instant: boolean) => {
      if (!el.isConnected) return;
      tip.textContent = text;
      if (instant) tip.dataset.instant = '';
      else delete tip.dataset.instant;
      place(el);
      tip.dataset.on = '';
      shown = true;
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (shown) wentAt = performance.now();
      shown = false;
      on = null;
      delete tip.dataset.on;
    };
    const ask = (target: EventTarget | null, now: boolean) => {
      const found = tipOf(target);
      if (!found) return hide();
      if (found.el === on) return;
      const warm = shown || performance.now() - wentAt < WARM;
      window.clearTimeout(timer);
      // (The one before stays up while the mouse goes to its neighbour: the label moves, it does not blink.)
      on = found.el;
      if (warm || now) show(found.el, found.text, warm);
      else {
        delete tip.dataset.on;
        shown = false;
        timer = window.setTimeout(() => on === found.el && show(found.el, found.text, false), WAIT);
      }
    };

    const onOver = (e: PointerEvent) => {
      // A finger on a touch screen presses, it does not rest: no labels for it.
      if (e.pointerType === 'mouse') ask(e.target, false);
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.matches(':focus-visible')) ask(el, true);
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && !e.relatedTarget) hide();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onLeave);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('wheel', hide, { capture: true, passive: true });
    document.addEventListener('scroll', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onLeave);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('wheel', hide, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      tip.remove();
    };
  }, []);
  return null;
}
