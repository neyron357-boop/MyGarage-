import type { FbStrings } from './strings';
import type { FbElement, FbPage, FbRect, FbViewport } from './types';

/*
 * What a note says about where it was made: the screen (its route, its title, the sheet open over it), the element
 * picked (in words, its text, a selector that finds it, where it was) and the screen's size. Read off the page as it
 * is at that moment — nothing in the app is asked or changed.
 */

/** The tool's own interface: never picked, never in a screenshot. */
export const OURS = '[data-fb-ui]';

const ROUTES: [RegExp, keyof FbStrings['pages']][] = [
  [/^\/$/, 'board'],
  [/^\/search$/, 'search'],
  [/^\/orders\/new$/, 'newOrder'],
  [/^\/orders\/[^/]+\/suppliers$/, 'jobSuppliers'],
  [/^\/orders\/[^/]+\/claim$/, 'claim'],
  [/^\/orders\/[^/]+/, 'job'],
  [/^\/customers$/, 'customers'],
  [/^\/customers\/[^/]+$/, 'customer'],
  [/^\/vehicles\/[^/]+$/, 'vehicle'],
  [/^\/parts$/, 'parts'],
  [/^\/money$/, 'money'],
  [/^\/reports$/, 'reports'],
  [/^\/settings$/, 'settings'],
  [/^\/more$/, 'more'],
  [/^\/notes$/, 'notes'],
];

export const clean = (s: string | null | undefined, max = 200): string => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The screen in front: the phone's top screen, or the PC's page. */
export function frontScreen(): Element | null {
  return document.querySelector('.stack > .screen[data-role="top"]') ?? document.querySelector('.page-shell') ?? document.querySelector('main');
}

/** The sheets open now, the one in front last. */
function openDialogs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter((d) => !d.closest(OURS) && d.getBoundingClientRect().height > 0);
}

function dialogTitle(d: HTMLElement): string {
  const by = d.getAttribute('aria-labelledby');
  const t = (by && document.getElementById(by)) || d.querySelector('.mantine-Modal-title, .mantine-Drawer-title, h2');
  return clean(t?.textContent ?? d.getAttribute('aria-label'), 80);
}

export function pageInfo(s: FbStrings): FbPage {
  const hash = location.hash.replace(/^#/, '') || '/';
  const path = hash.split('?')[0] || '/';
  const key = ROUTES.find(([re]) => re.test(path))?.[1];
  const screen = frontScreen();
  // The tab chosen on the screen, as it reads (the job's «Заметки», «Деньги → Учёт»).
  const tab = screen?.querySelector('.scroll-tabs [aria-selected="true"], .scroll-tabs [data-active="true"], [role="tablist"] [aria-selected="true"]');
  const name = [key ? s.pages[key] : path, clean(tab?.textContent, 40)].filter(Boolean).join(' · ');
  const title = [clean(screen?.querySelector('.page-eyebrow')?.textContent, 60), clean(screen?.querySelector('h1')?.textContent, 80)].filter(Boolean).join(' · ');
  const dialogs = openDialogs();
  const sheet = dialogs.length ? dialogTitle(dialogs[dialogs.length - 1]) || s.types.sheet : undefined;
  return { name, title: title || undefined, sheet, route: `#${hash}`, url: location.href };
}

export function viewportInfo(): FbViewport {
  const html = document.documentElement;
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    standalone: html.classList.contains('standalone'),
    scheme: html.getAttribute('data-mantine-color-scheme') === 'dark' ? 'dark' : 'light',
    lang: html.lang || navigator.language,
    userAgent: navigator.userAgent,
  };
}

export const rectOf = (el: Element): FbRect => {
  const r = el.getBoundingClientRect();
  const round = (v: number) => Math.round(v * 10) / 10;
  return { x: round(r.left), y: round(r.top), width: round(r.width), height: round(r.height) };
};

/** What a tap means: a control, a row, a card, a picture — not the word or the icon inside it. */
const MEANINGFUL =
  'button, a[href], input, textarea, select, summary, label, [role="button"], [role="tab"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"], [role="menuitem"], [role="slider"], .chip, .list-row, .job-row, .kpi, .action-tile, img, video, canvas, h1, h2, h3, th, td';

/** The element under a point, the tool's own interface and the app's touch labels looked through. */
export function elementAt(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.closest(OURS)) continue;
    if (el.classList.contains('haptic-hit') || el.classList.contains('haptic-switch')) continue;
    if (el === document.documentElement || el === document.body) continue;
    return el;
  }
  return null;
}

/** From what the finger hit to what it means (a few levels up at most); a speck grows to something tappable. */
export function meaningful(hit: Element): Element {
  let el: Element | null = hit;
  for (let i = 0; el && i < 6; i++, el = el.parentElement) {
    if (el === document.body) break;
    if (el.matches(MEANINGFUL)) return el;
  }
  let small: Element = hit;
  while (small.parentElement && small.parentElement !== document.body) {
    const r = small.getBoundingClientRect();
    if (r.width >= 24 && r.height >= 24) break;
    small = small.parentElement;
  }
  return small;
}

/** The element and what holds it, up to the screen: «Шире» walks up this chain, «Уже» back down. */
export function chainOf(el: Element): Element[] {
  const out: Element[] = [];
  let e: Element | null = el;
  while (e && e !== document.body && e !== document.documentElement) {
    const r = e.getBoundingClientRect();
    // A wrapper exactly the size of what it wraps says nothing new.
    const last = out[out.length - 1];
    const same = last && (() => {
      const p = last.getBoundingClientRect();
      return Math.abs(p.left - r.left) < 1 && Math.abs(p.top - r.top) < 1 && Math.abs(p.width - r.width) < 1 && Math.abs(p.height - r.height) < 1;
    })();
    if (!same && r.width > 0 && r.height > 0) out.push(e);
    if (e.matches('.stack > .screen, [role="dialog"], .page-shell')) break;
    e = e.parentElement;
  }
  return out.length ? out : [el];
}

function typeOf(el: Element, s: FbStrings): string {
  const t = s.types;
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  const type = (el as HTMLInputElement).type;
  if (el.matches('.tab-bar, .tab-bar-wrap')) return t.tabBar;
  if (el.matches('.stack > .screen, .page-shell')) return t.screen;
  if (role === 'dialog') return t.sheet;
  if (el.matches('.job-row, .job-card')) return t.card;
  if (el.matches('.chip')) return t.chip;
  if (role === 'tab' || el.closest('.tab-bar') || el.matches('.scroll-tabs button')) return t.tab;
  if (role === 'switch' || (tag === 'input' && el.hasAttribute('switch'))) return t.switch;
  if (role === 'checkbox' || (tag === 'input' && type === 'checkbox')) return t.checkbox;
  if (role === 'radio' || (tag === 'input' && type === 'radio')) return t.radio;
  if (tag === 'button' || role === 'button' || role === 'menuitem' || role === 'option' || tag === 'summary') return t.button;
  if (tag === 'a' || role === 'link') return t.link;
  if (tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'checkbox', 'radio', 'file', 'hidden'].includes(type))) return t.field;
  if (tag === 'select') return t.select;
  if (el.matches('.list-row')) return t.row;
  if (tag === 'table') return t.table;
  if (tag === 'tr') return t.tableRow;
  if (tag === 'td' || tag === 'th') return t.cell;
  if (/^h[1-6]$/.test(tag)) return t.heading;
  if (tag === 'img') return t.image;
  if (tag === 'svg') return t.icon;
  if (tag === 'canvas') return t.canvas;
  if (tag === 'video') return t.video;
  if (tag === 'label') return t.label;
  if (clean(el.textContent) && el.children.length <= 2) return t.text;
  return t.block;
}

/** What an element is called: its label for the blind, its title, the words in it, a field's hint. */
export function nameOf(el: Element): string {
  const own = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || (el as HTMLInputElement).placeholder;
  if (own) return clean(own, 60);
  if (el.matches('input, textarea, select')) {
    const id = el.id;
    const label = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label');
    if (label) return clean(label.textContent, 60);
  }
  const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  // A block of many things is named by its first line («Фото машины…»), not by all it says.
  if (el.querySelectorAll('*').length > 6) {
    const lines = text.split('\n').map((l) => clean(l, 40)).filter(Boolean);
    return lines.length > 1 ? `${lines[0]}…` : (lines[0] ?? '');
  }
  return clean(text, 60);
}

export function describe(el: Element, s: FbStrings): string {
  // A label of a switch or a check box stands for it: «Переключатель «Кнопка замечаний»», not «Подпись».
  const subject = el instanceof HTMLLabelElement && el.control && !nameOf(el) ? el.control : el;
  const name = nameOf(subject);
  return name ? `${typeOf(subject, s)} «${name}»` : typeOf(subject, s);
}

/** Classes that say what a thing is: not Mantine's hashed ones, not a state of the moment. */
export function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter((c) => !/^m_[0-9a-f]+$/.test(c) && !/^(haptic-hit|tap|active|focus|hover|pop-in|fade-enter|rise-enter|page-enter|stagger)$/.test(c) && !/^mantine-(active|focus)/.test(c) && c.length < 48);
}

const cssId = (id: string) => (/^[A-Za-z][\w-]*$/.test(id) && !/^(mantine-|:r|r\d)/.test(id) ? id : '');

function segment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = cssId(el.id);
  if (id) return `#${CSS.escape(id)}`;
  const cls = stableClasses(el)
    .slice(0, 3)
    .map((c) => `.${CSS.escape(c)}`)
    .join('');
  let seg = tag + cls;
  const label = el.getAttribute('aria-label');
  if (label && label.length <= 60) seg += `[aria-label="${label.replace(/"/g, '\\"')}"]`;
  const parent = el.parentElement;
  if (parent) {
    const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName && (!cls || c.matches(seg)));
    if (same.length > 1) seg += `:nth-of-type(${Array.from(parent.children).filter((c) => c.tagName === el.tagName).indexOf(el) + 1})`;
  }
  return seg;
}

/** A selector that finds this element alone on the page (as short as that allows). */
export function selectorOf(el: Element): string {
  let sel = segment(el);
  let e: Element | null = el.parentElement;
  for (let i = 0; i < 10 && e && e !== document.documentElement; i++, e = e.parentElement) {
    try {
      if (document.querySelectorAll(sel).length === 1) return sel;
    } catch {
      break;
    }
    sel = `${segment(e)} > ${sel}`;
  }
  return sel;
}

/** Its ancestors from the screen (or the sheet) down, by tag and class: what an agent greps for. */
export function pathOf(el: Element): string {
  const parts: string[] = [];
  let e: Element | null = el;
  while (e && e !== document.body && parts.length < 12) {
    const cls = stableClasses(e).slice(0, 3).join('.');
    parts.unshift(e.tagName.toLowerCase() + (cls ? `.${cls}` : ''));
    if (e.matches('.stack > .screen, [role="dialog"], .page-shell, .tab-bar-wrap')) break;
    e = e.parentElement;
  }
  return parts.join(' > ');
}

/** React components around the element, nearest first — only where they have names (the dev server). */
export function componentsOf(el: Element): string[] | undefined {
  if (!import.meta.env.DEV) return undefined;
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (!key) return undefined;
  type Fiber = { type?: unknown; return?: Fiber | null };
  let f = (el as unknown as Record<string, Fiber>)[key] as Fiber | null | undefined;
  const out: string[] = [];
  for (let i = 0; f && i < 200 && out.length < 5; i++, f = f.return) {
    const t = f.type as { displayName?: string; name?: string } | string | undefined;
    const name = typeof t === 'function' || (typeof t === 'object' && t) ? (t as { displayName?: string; name?: string }).displayName || (t as { name?: string }).name : undefined;
    // The app's own components, not the libraries' or the shell's (routes, stack, boundaries).
    const plumbing = /^(Mantine|Box|Text|Group|Stack|Transition|Portal|OptionalPortal|Suspense|Memo|Fragment)/.test(name ?? '') || /^(RenderedRoute|Routes|Router|AppRoutes|ErrorBoundary|Screen\d*|PhoneStack|PhoneShell|Providers|App|LazySheet|SheetFor|Quiet)$/.test(name ?? '');
    if (name && /^[A-Z][A-Za-z0-9]{2,}$/.test(name) && !plumbing && !out.includes(name)) out.push(name);
  }
  return out.length ? out : undefined;
}

export function elementInfo(el: Element, rect: FbRect, s: FbStrings): FbElement {
  const text = clean((el as HTMLElement).innerText ?? el.textContent);
  return {
    description: describe(el, s),
    tag: el.tagName.toLowerCase(),
    text: text || undefined,
    id: el.id || undefined,
    role: el.getAttribute('role') ?? undefined,
    ariaLabel: el.getAttribute('aria-label') ?? undefined,
    classes: stableClasses(el),
    selector: selectorOf(el),
    path: pathOf(el),
    components: componentsOf(el),
    rect,
  };
}
