/**
 * The second tap of a double tap that lands on something else.
 *
 * A tap often changes what is under the finger: the job's main button becomes the next step's
 * ("Hand over" → "Reopen" in the same place, "Agree" → "Refuse"), a sheet closes and uncovers the tab
 * bar, a card opens a screen whose photo is where the card was. A quick second tap — a double tap, an
 * impatient repeat — then hits that new thing and does what nobody asked for. iOS ignores touches while
 * such a change settles; so does the app: a tap on a control that comes within SETTLE ms of the last tap
 * on a control, within REACH px of it, where a different control is now (or the same one saying something
 * else), never reaches the app (docs/quality/map.md, v0.14.1).
 *
 * - The window runs from the last tap, and starts again when an action finishes (`tapSettled`, called by
 *   `useAction` and the confirm sheet): an action that takes a while changes the screen late. Taps that
 *   keep coming at the same spot keep being dropped.
 * - The same control tapped again (a stepper, a chip, a tab tapped twice to go to the top) passes — an
 *   action that must not repeat guards itself (`useAction({ exclusive })`, dialogs that take no taps
 *   while they close — ui/theme.ts).
 * - A tap beside the controls protects nothing and holds nothing back (a near miss, then the real tap).
 * - Keyboard, screen-reader and scripted clicks are not taps (`detail === 0` or untrusted) and pass. The
 *   click a label forwards to its control is part of the same tap, as is the iPhone haptic switch's
 *   (`ui/haptics.ts`); a haptic label laid over a control stands for that control.
 * - Actions done on the finger's release rather than on click (slides, long presses) are not seen here.
 */
const SETTLE = 350;
const REACH = 24;
const CONTROL = 'button, a[href], [role="button"], [role="tab"], [role="option"], [role="switch"], label, input, select, textarea, summary, [data-href]';

/** The last tap on a control: when it was (`tap`), where its window starts now (`t`), where and what it hit. */
let last: { tap: number; t: number; x: number; y: number; el: Element; sig: string } | null = null;

/** What a control says: the same node saying something else ("Agree" re-rendered as "Refuse") is another control. */
const sig = (el: Element) => `${el.getAttribute('aria-label') ?? ''}|${(el.textContent ?? '').trim().slice(0, 80)}`;

function onClick(e: MouseEvent) {
  if (!e.isTrusted || e.detail === 0) return;
  const target = e.target as Element | null;
  if (!target?.closest) return;
  // The haptic switch's click, forwarded by the label the finger hit: the same tap.
  if (target.id === 'mg-haptic') return;
  const hit = target.closest('.haptic-hit')?.parentElement ?? target.closest(CONTROL);
  const prev = last;
  // A label's activation clicks its control: the same tap, not a second one.
  if (hit && prev?.el instanceof HTMLLabelElement && prev.el.control === hit) return;
  if (!hit) {
    last = null;
    return;
  }
  const near = !!prev && e.timeStamp - prev.t < SETTLE && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < REACH;
  if (prev && near && (hit !== prev.el || sig(hit) !== prev.sig)) {
    // What is under the finger changed since the last tap: this one was meant for what was there.
    e.preventDefault();
    e.stopImmediatePropagation();
    prev.t = e.timeStamp;
    return;
  }
  last = { tap: e.timeStamp, t: e.timeStamp, x: e.clientX, y: e.clientY, el: hit, sig: sig(hit) };
}

/** When the action now starting began: pass it back to `tapSettled` when the action ends. */
export const actionStart = () => performance.now();

/**
 * An action has just finished and may have changed what is under the finger. If the last tap started it
 * (it began within that tap's click), that tap's window starts again now — a slow save changes the screen
 * late. Actions the tap did not start (a field saved on blur, a background write) leave the window alone.
 */
export function tapSettled(startedAt: number) {
  if (last && Math.abs(startedAt - last.tap) < 50) last.t = performance.now();
}

export function installTapGuard() {
  window.addEventListener('click', onClick, { capture: true });
}
