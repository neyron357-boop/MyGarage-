import { Loader } from "@mantine/core";
import {
  IconDownload,
  IconExternalLink,
  IconFileOff,
  IconMinus,
  IconPlus,
  IconShare2,
  IconX,
} from "@tabler/icons-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { setPdfViewer, type PdfFile } from "../services/documents";
import { loadPdfjs } from "../services/pdfText";
import { useHistoryLayer, useLockScroll } from "./historyLayer";
import { usePhone } from "./hooks";
import { canShareFile, downloadFile, shareOrDownload } from "./share";

/*
 * The app's own PDF viewer (v0.90, the owner: «добавить также удобный просмотр PDF файлов внутри приложения»): an invoice,
 * a quotation, a statement, a report, a file in a WhatsApp chat — opened over the app, not handed to the phone's share
 * sheet, downloaded or put in a browser tab. Pages drawn on the device (pdf.js), one under the other, scrolled as any
 * list; two fingers or a double tap — closer (on a PC: Ctrl + the wheel, + and −); «Поделиться» (an iPhone's sheet has
 * Print and «Save to Files») or «Сохранить», on a PC also the browser's own viewer (print). Back and Escape close it.
 */

type Source = PdfFile | Promise<PdfFile | undefined>;
interface Shown {
  key: number;
  source: Source;
  title?: string;
}

let shown: Shown | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((f) => f());
const subscribe = (f: () => void) => (
  listeners.add(f),
  () => void listeners.delete(f)
);

/** Show a PDF over the app — one still being made or fetched is shown the moment it is here. */
export function showPdf(source: Source, title?: string): void {
  shown = { key: Date.now(), source, title };
  tell();
}

/** Mounted once by the app: the viewer, and every «open the PDF» of the services shown in it. */
export function PdfViewerHost() {
  const s = useSyncExternalStore(subscribe, () => shown);
  useEffect(() => {
    setPdfViewer(showPdf);
    return () => setPdfViewer(undefined);
  }, []);
  const close = useCallback(() => {
    shown = null;
    tell();
  }, []);
  return s ? (
    <PdfViewer key={s.key} source={s.source} title={s.title} onClose={close} />
  ) : null;
}

const MAX_ZOOM = 4;
/** A canvas no larger than this many pixels (an iPhone refuses bigger ones and runs out of memory with many). */
const MAX_PIXELS = 10e6;
const nameOf = (f?: string) => (f ?? "").replace(/\.pdf$/i, "");

interface PageSize {
  w: number;
  h: number;
}

export function PdfViewer({
  source,
  title,
  onClose,
}: {
  source: Source;
  title?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const phone = usePhone();
  const [file, setFile] = useState<PdfFile>();
  const [broken, setBroken] = useState(false);
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [page, setPage] = useState(1);
  const [zoomShown, setZoomShown] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const boxes = useRef<(HTMLDivElement | null)[]>([]);
  const zoom = useRef(1);
  const base = useRef(0);
  const minZoom = phone ? 1 : 0.5;

  useLockScroll();
  const release = useHistoryLayer("mgPdf", onClose);
  const close = useCallback(() => {
    release();
    onClose();
  }, [release, onClose]);
  const closeRef = useRef(close);
  closeRef.current = close;

  // The file: given, or made / fetched while the viewer already shows that it is coming.
  useEffect(() => {
    let alive = true;
    Promise.resolve(source).then(
      (f) => alive && (f ? setFile(f) : setBroken(true)),
      () => alive && setBroken(true),
    );
    return () => {
      alive = false;
    };
  }, [source]);

  // The document and the size of every page (cheap: no page is drawn for it).
  useEffect(() => {
    if (!file) return;
    let alive = true;
    let task: { destroy: () => Promise<void> } | undefined;
    void (async () => {
      const pdfjs = await loadPdfjs();
      const loading = pdfjs.getDocument({
        data: new Uint8Array(await file.blob.arrayBuffer()),
      });
      task = loading;
      const d = await loading.promise;
      const all: PageSize[] = [];
      for (let i = 1; i <= d.numPages; i++) {
        const v = (await d.getPage(i)).getViewport({ scale: 1 });
        all.push({ w: v.width, h: v.height });
      }
      if (!alive) return;
      setSizes(all);
      setDoc(d);
    })().catch(() => alive && setBroken(true));
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [file]);

  const widest = useMemo(() => Math.max(1, ...sizes.map((s) => s.w)), [sizes]);

  /** Every page's box at this zoom — written straight to the page (a pinch moves it every frame). */
  const layout = useCallback(() => {
    const z = zoom.current;
    sizes.forEach((s, i) => {
      const el = boxes.current[i];
      if (!el) return;
      const w = (base.current * z * s.w) / widest;
      el.style.width = `${w}px`;
      el.style.height = `${(w * s.h) / s.w}px`;
    });
  }, [sizes, widest]);

  // Drawing: the pages in sight (and a screen around them), sharp for the zoom they are seen at, one at a time.
  const near = useRef(new Set<number>());
  const drawn = useRef(new Map<number, number>());
  const queue = useRef<number[]>([]);
  const drawing = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // The canvases' memory back at once (an iPhone keeps it until they are emptied).
      for (const el of boxes.current)
        el?.querySelectorAll("canvas").forEach(
          (c) => ((c.width = 0), (c.height = 0), c.remove()),
        );
      drawn.current.clear();
    };
  }, []);

  const wantOf = useCallback(
    (i: number) => {
      const el = boxes.current[i];
      const s = sizes[i];
      if (!el || !s) return 0;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      let w = el.offsetWidth * dpr;
      const h = (w * s.h) / s.w;
      if (w * h > MAX_PIXELS) w = Math.sqrt((MAX_PIXELS * s.w) / s.h);
      return Math.max(1, Math.round(w));
    },
    [sizes],
  );

  const pump = useCallback(async () => {
    if (drawing.current || !doc) return;
    drawing.current = true;
    try {
      while (alive.current && queue.current.length) {
        const i = queue.current.shift()!;
        const box = boxes.current[i];
        if (!box || !near.current.has(i)) continue;
        const want = wantOf(i);
        const have = drawn.current.get(i);
        if (have && Math.abs(want - have) / have < 0.15) continue;
        const pg = await doc.getPage(i + 1);
        const one = pg.getViewport({ scale: 1 });
        const viewport = pg.getViewport({ scale: want / one.width });
        const c = document.createElement("canvas");
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        await pg.render({ canvas: c, viewport }).promise;
        if (!alive.current) {
          c.width = c.height = 0;
          return;
        }
        // The new drawing over the old one only when ready — no white flash while it is made.
        const old = box.querySelectorAll("canvas");
        box.appendChild(c);
        old.forEach((o) => ((o.width = 0), (o.height = 0), o.remove()));
        box.dataset.drawn = "";
        drawn.current.set(i, want);
      }
    } catch {
      // A page that cannot be drawn stays a white page; the rest go on being drawn when asked again.
    } finally {
      drawing.current = false;
    }
  }, [doc, wantOf]);

  const refresh = useCallback(() => {
    const order = [...near.current].sort(
      (a, b) => Math.abs(a + 1 - page) - Math.abs(b + 1 - page),
    );
    queue.current = order;
    void pump();
  }, [pump, page]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const settleTimer = useRef(0);
  const settle = useCallback(() => {
    setZoomShown(zoom.current);
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => refreshRef.current(), 120);
  }, []);

  // The page's width at zoom 1: the screen's on a phone, a sheet of paper's on a PC — again when the window changes.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !sizes.length) return;
    const fit = () => {
      const pad = phone ? 16 : 64;
      base.current = Math.max(
        120,
        Math.min(el.clientWidth - pad, phone ? Infinity : 880),
      );
      layout();
      settle();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sizes, phone, layout, settle]);

  // Which pages are near the screen: drawn when they come, emptied when far (a long document).
  useEffect(() => {
    const root = scroller.current;
    if (!root || !doc) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) near.current.add(i);
          else {
            near.current.delete(i);
            if (sizes.length > 4) {
              e.target
                .querySelectorAll("canvas")
                .forEach((c) => ((c.width = 0), (c.height = 0), c.remove()));
              delete (e.target as HTMLElement).dataset.drawn;
              drawn.current.delete(i);
            }
          }
        }
        refreshRef.current();
      },
      { root, rootMargin: "100% 0px" },
    );
    boxes.current.forEach((b) => b && io.observe(b));
    return () => io.disconnect();
  }, [doc, sizes.length]);

  /** Closer or further, the point under `at` (the fingers, the mouse) staying where it is. */
  const zoomTo = useCallback(
    (z: number, at?: { x: number; y: number }) => {
      const el = scroller.current;
      if (!el) return;
      const next = Math.max(minZoom, Math.min(MAX_ZOOM, z));
      if (Math.abs(next - zoom.current) < 0.001) return;
      const r = el.getBoundingClientRect();
      const mx = (at?.x ?? r.left + r.width / 2) - r.left;
      const my = (at?.y ?? r.top + r.height / 2) - r.top;
      const fx = (el.scrollLeft + mx) / el.scrollWidth;
      const fy = (el.scrollTop + my) / el.scrollHeight;
      zoom.current = next;
      layout();
      el.scrollLeft = fx * el.scrollWidth - mx;
      el.scrollTop = fy * el.scrollHeight - my;
    },
    [layout, minZoom],
  );

  /** A double tap, + and −: the same, in a short glide (none when the system asks for less motion). */
  const glide = useRef(0);
  const zoomSmooth = useCallback(
    (target: number, at?: { x: number; y: number }) => {
      cancelAnimationFrame(glide.current);
      const from = zoom.current;
      const to = Math.max(minZoom, Math.min(MAX_ZOOM, target));
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        zoomTo(to, at);
        return settle();
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 220);
        const e = 1 - Math.pow(1 - k, 3);
        zoomTo(from + (to - from) * e, at);
        if (k < 1) glide.current = requestAnimationFrame(step);
        else settle();
      };
      glide.current = requestAnimationFrame(step);
    },
    [minZoom, settle, zoomTo],
  );

  // Fingers: one scrolls (the browser's own scrolling, with its momentum); two — closer; a double tap — closer / back.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let pinch: { d: number; z: number } | null = null;
    let tap: { x: number; y: number; t: number; moved: boolean } | null = null;
    let lastTap: { x: number; y: number; t: number } | null = null;
    const two = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      return {
        d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        mid: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
      };
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        cancelAnimationFrame(glide.current);
        pinch = { d: Math.max(1, two(e).d), z: zoom.current };
        tap = null;
      } else if (e.touches.length === 1) {
        const p = e.touches[0];
        tap = { x: p.clientX, y: p.clientY, t: Date.now(), moved: false };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (pinch && e.touches.length >= 2) {
        e.preventDefault();
        const g = two(e);
        zoomTo((pinch.z * g.d) / pinch.d, g.mid);
        return;
      }
      const p = e.touches[0];
      if (tap && p && Math.hypot(p.clientX - tap.x, p.clientY - tap.y) > 10)
        tap.moved = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (pinch) {
        if (e.touches.length < 2) {
          pinch = null;
          settle();
        }
        return;
      }
      if (!tap || tap.moved || Date.now() - tap.t > 300)
        return ((tap = null), undefined);
      const at = { x: tap.x, y: tap.y, t: Date.now() };
      tap = null;
      if (
        lastTap &&
        at.t - lastTap.t < 320 &&
        Math.hypot(at.x - lastTap.x, at.y - lastTap.y) < 40
      ) {
        lastTap = null;
        e.preventDefault();
        zoomSmooth(zoom.current > 1.05 ? 1 : 2.5, at);
      } else lastTap = at;
    };
    // A mouse: a double click — closer / back; Ctrl + the wheel (and a touchpad's pinch) — closer, further.
    const onDbl = (e: MouseEvent) =>
      zoomSmooth(zoom.current > 1.05 ? 1 : 2, { x: e.clientX, y: e.clientY });
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(zoom.current * Math.exp(-e.deltaY * 0.01), {
        x: e.clientX,
        y: e.clientY,
      });
      settle();
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onEnd);
    el.addEventListener("dblclick", onDbl);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("dblclick", onDbl);
      el.removeEventListener("wheel", onWheel);
    };
  }, [settle, zoomSmooth, zoomTo]);

  // Keys (a PC): Escape closes; + − 0 — closer, further, the page's width. The app's own keys wait behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      const z =
        e.key === "+" || e.key === "="
          ? zoom.current * 1.25
          : e.key === "-" || e.key === "_"
            ? zoom.current / 1.25
            : e.key === "0"
              ? 1
              : 0;
      if (z) {
        e.preventDefault();
        zoomSmooth(z);
      }
      // Arrows, PgUp / PgDn, Space scroll the pages; nothing reaches the screen underneath.
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoomSmooth]);

  // Its keys scroll the pages from the start.
  useEffect(() => {
    if (doc) scroller.current?.focus({ preventScroll: true });
  }, [doc]);

  // Which page is in the middle of the screen.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    let n = 1;
    boxes.current.forEach((b, i) => {
      if (b && b.offsetTop <= mid) n = i + 1;
    });
    setPage(n);
  }, []);

  // The file to share or save — ready before the tap (an iPhone shares only right in it).
  const asFile = useMemo(
    () =>
      file
        ? new File([file.blob], file.filename, { type: "application/pdf" })
        : undefined,
    [file],
  );
  const shareable = canShareFile(asFile);
  const inBrowser = () => {
    if (!file) return;
    const url = URL.createObjectURL(file.blob);
    if (!window.open(url, "_blank")) asFile && downloadFile(asFile);
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  };

  const name = title || nameOf(file?.filename);
  const pages = sizes.length;
  return createPortal(
    <div
      className="viewer pdfv"
      role="dialog"
      aria-modal="true"
      aria-label={name || "PDF"}
      data-pdf-viewer
    >
      <div className="viewer-top">
        <div className="viewer-side">
          <button
            type="button"
            className="cam-icon"
            onClick={() => close()}
            aria-label={t("camera.close")}
            data-pdf-close
          >
            <IconX size={22} />
          </button>
          {!phone && <span className="cam-icon-spacer" aria-hidden />}
        </div>
        <div className="cam-title">
          {name && <div className="cam-title-main">{name}</div>}
          {pages > 1 && (
            <div className="cam-title-sub tnum" data-pdf-page={page}>
              {t("camera.of", { n: page, total: pages })}
            </div>
          )}
        </div>
        <div className="viewer-side">
          {!phone && (
            <button
              type="button"
              className="cam-icon"
              disabled={!file}
              onClick={inBrowser}
              aria-label={t("pdfView.inBrowser")}
            >
              <IconExternalLink size={20} />
            </button>
          )}
          <button
            type="button"
            className="cam-icon"
            disabled={!asFile}
            onClick={() =>
              asFile && (phone ? shareOrDownload(asFile) : downloadFile(asFile))
            }
            aria-label={
              phone && (shareable || !asFile)
                ? t("photos.share")
                : t("photos.save")
            }
            data-pdf-share
          >
            {phone && (shareable || !asFile) ? (
              <IconShare2 size={21} />
            ) : (
              <IconDownload size={21} />
            )}
          </button>
        </div>
      </div>
      <div
        className="pdfv-scroll"
        ref={scroller}
        tabIndex={-1}
        onScroll={onScroll}
      >
        {broken ? (
          <div className="pdfv-none">
            <IconFileOff size={44} stroke={1.5} aria-hidden />
            <span>{t("pdfView.broken")}</span>
          </div>
        ) : !doc ? (
          <div className="pdfv-none">
            <Loader color="white" />
          </div>
        ) : (
          <div className="pdfv-pages">
            {sizes.map((_, i) => (
              <div
                key={i}
                className="pdfv-page"
                data-page={i}
                ref={(el) => void (boxes.current[i] = el)}
              />
            ))}
          </div>
        )}
      </div>
      {!phone && doc && (
        <div className="pdfv-zoom">
          <button
            type="button"
            className="cam-icon"
            onClick={() => zoomSmooth(zoom.current / 1.25)}
            disabled={zoomShown <= minZoom + 0.001}
            aria-label={t("pdfView.further")}
          >
            <IconMinus size={18} />
          </button>
          <button
            type="button"
            className="pdfv-zoom-n tnum"
            onClick={() => zoomSmooth(1)}
            aria-label={t("pdfView.fit")}
          >
            {Math.round(zoomShown * 100)} %
          </button>
          <button
            type="button"
            className="cam-icon"
            onClick={() => zoomSmooth(zoom.current * 1.25)}
            disabled={zoomShown >= MAX_ZOOM - 0.001}
            aria-label={t("pdfView.closer")}
          >
            <IconPlus size={18} />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
