/*
 * The keyboard up at once for a sheet whose field is not on the page yet (v0.81, the quick «＋» sheet of a job: «фокус в
 * строке»). An iPhone opens its keyboard only for a field focused in the very tap; the sheet's field comes a frame later
 * (the sheet is made when it opens). So the tap focuses a field of its own, out of sight — the keyboard comes up — and
 * the sheet's field takes the focus over as it mounts (focus moved from field to field keeps the keyboard up). Released
 * by itself when nothing took it over in a second.
 */

let proxy: HTMLInputElement | null = null;
let timer: number | undefined;

/** In the tap that opens the sheet, before it opens. */
export function holdKeyboard(): void {
  if (typeof document === 'undefined') return;
  if (!proxy) {
    proxy = document.createElement('input');
    proxy.type = 'text';
    proxy.setAttribute('aria-hidden', 'true');
    proxy.tabIndex = -1;
    proxy.autocomplete = 'off';
    proxy.setAttribute('autocapitalize', 'characters');
    // 16 px: an iPhone does not zoom the page into it; at the top, out of sight, nothing scrolls to it.
    proxy.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px;border:0;padding:0;';
    document.body.appendChild(proxy);
  }
  proxy.focus({ preventScroll: true });
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (document.activeElement === proxy) proxy?.blur();
  }, 1200);
}
