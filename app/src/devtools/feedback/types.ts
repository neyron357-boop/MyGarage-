/*
 * The developer's visual feedback tool (v0.39, temporary): notes on the interface — an element tapped, a few words,
 * a screenshot with marks — kept on the device and exported in one ZIP for an AI agent. Everything of it lives in
 * `src/devtools/feedback/` and its own database; the app knows of it only by two lines (`App.tsx`, `ui/Appearance.tsx`).
 */

/** A rectangle on the screen, CSS px. */
export interface FbRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A mark on a screenshot, numbered: a box, an arrow, a pin. Coordinates are fractions of the image (0–1): a box —
 * its corners; an arrow — from its tail (x1, y1) to its head (x2, y2); a pin — the point (x1, y1).
 */
export interface FbMark {
  n: number;
  kind: 'rect' | 'arrow' | 'pin';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The owner's words for this mark. */
  comment?: string;
  /** The frame the tool drew around the picked element (redrawn when the pick is widened or narrowed). */
  auto?: boolean;
}

/** Where the note was made. */
export interface FbPage {
  /** The screen in words ("Заказ · Заметки"). */
  name: string;
  /** Its large title and the line over it, as shown. */
  title?: string;
  /** The title of the sheet that was open over it. */
  sheet?: string;
  /** The app's route (the address after #). */
  route: string;
  url: string;
}

/** The element picked. */
export interface FbElement {
  /** In words: «Кнопка «Сохранить»». */
  description: string;
  tag: string;
  /** Its text as shown (cut to 200). */
  text?: string;
  id?: string;
  role?: string;
  ariaLabel?: string;
  classes: string[];
  /** A CSS selector that found it alone on the page when it was picked. */
  selector: string;
  /** Its ancestors down from the screen: `section.screen > … > button.chip`. */
  path: string;
  /** React components around it, nearest first (the dev server only: a built app has no names). */
  components?: string[];
  /** Where it was on the screen, CSS px. */
  rect: FbRect;
}

export interface FbViewport {
  width: number;
  height: number;
  dpr: number;
  standalone: boolean;
  scheme: 'light' | 'dark';
  lang: string;
  userAgent: string;
}

export interface FbNote {
  id: string;
  /** Its number: unique, never given again; its screenshot in the export is `screenshots/<n>.png`. */
  n: number;
  /** An element picked, or the whole screen marked. */
  kind: 'element' | 'screen';
  /** The owner's words, as typed. */
  comment: string;
  status: 'new' | 'fixed';
  createdAt: string;
  updatedAt: string;
  /** When it last went out in an export (it stays). */
  exportedAt?: string;
  page: FbPage;
  element?: FbElement;
  viewport: FbViewport;
  /** Its screenshot (`FbShot`). */
  shotId?: string;
  marks: FbMark[];
  appVersion: string;
}

/** A screenshot: taken by the tool, or picked from the phone's photos. Kept as JPEG; the marks are drawn on export. */
export interface FbShot {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  source: 'auto' | 'gallery';
  /** Image px per CSS px (the screen it shows), when known. */
  scale?: number;
  /** A small picture with its marks, for the list. */
  thumb?: Blob;
}

/** A screenshot in hand (not yet kept). */
export interface Shot {
  blob: Blob;
  width: number;
  height: number;
  source: 'auto' | 'gallery';
  scale?: number;
}
