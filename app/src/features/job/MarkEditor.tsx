import { ActionIcon, Button, Group } from '@mantine/core';
import { IconMinus, IconPhotoPlus, IconPlus, IconTrash, IconZoomReset } from '@tabler/icons-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { diagramOf, fitMark, fromOldRing, markAtTap, markFromBox, marksOn, MAX_MARKS, onMark, scaleMark, type DiagramMark } from '../../domain/diagramSheet';
import type { OrderItem } from '../../domain/types';
import { setDiagramMarks } from '../../services/diagramSheet';
import { cachedCardUrl, cachedMediaUrl, cardUrl, mediaSrc, mediaUrl } from '../../services/media';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';

/*
 * Outlining a part on its diagram (v0.59.1; its own module since v0.64): the suppliers' screen opens it in a sheet, the
 * job's photo viewer over a diagram (features/job/PartPictures.tsx) — the same outlines (`OrderItem.diagramMarks`) either
 * way: drawn in one place, they are on the supplier's sheet and in the job's picture alike.
 */

/**
 * The diagram's picture, fast (v0.59.1): the thumbnail at once (it is on the device), the card (1080 px) over it as soon
 * as it is here; the original only when two fingers bring it closer.
 */
function useDiagramPicture(id: string, full: boolean): string | undefined {
  const [src, setSrc] = useState<string | undefined>(() => cachedCardUrl(id) ?? cachedMediaUrl(id, true));
  useEffect(() => {
    let alive = true;
    let sharp = !!cachedCardUrl(id);
    if (!sharp) void mediaUrl(id, true).then((u) => alive && !sharp && u && setSrc(u));
    void cardUrl(id).then((u) => {
      if (!alive || !u) return;
      sharp = true;
      setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  // Brought closer (two fingers): the picture itself, sharp at that size — asked only then.
  useEffect(() => {
    if (!full) return;
    let alive = true;
    // Loaded before it is shown (v0.59.2: the phone showed a broken picture when the original did not come — the
    // card stays on screen in that case).
    void mediaSrc(id)
      .then((u) => {
        if (!alive || !u) return;
        const probe = new Image();
        probe.onload = () => alive && setSrc(u);
        probe.src = u;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, full]);
  return src;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'tap'; x: number; y: number; px: number; py: number; hit?: number }
  | { kind: 'draw'; x: number; y: number; x2: number; y2: number }
  | { kind: 'move'; at: number; x: number; y: number; from: DiagramMark; moved: boolean }
  | { kind: 'pinch'; d0: number; s0: number; mx: number; my: number; tx0: number; ty0: number };

/**
 * Outlining the part on its diagram (v0.59.1): a finger drawn across a piece — an oval round it; a tap — a circle there;
 * a tap on an outline picks it (drag — move it, − / + — its size, the bin — away); two fingers — closer (up to ×5).
 * As many outlines as the part has pieces (an engine mount complete — three). The outlines are the manager's; nothing
 * is guessed. `diagramId` — which of the part's diagrams (v0.64: the one open in the viewer; else the one it shows);
 * `fit` — the whole diagram in the room the page gives it (`--mark-room`, a full-screen layer), not as wide as the sheet;
 * `onDone` — after the outlines are kept (waited for: the outlined picture is made before the layer goes).
 */
export function MarkEditor({ item, diagramId, onDone, onAdd, fit }: { item: OrderItem; diagramId?: string; onDone: (marks: DiagramMark[]) => void | Promise<void>; onAdd?: () => void; fit?: boolean }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const id = diagramId ?? diagramOf(item)!;
  const [size, setSize] = useState<{ w: number; h: number }>();
  const [marks, setMarks] = useState<DiagramMark[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [draft, setDraft] = useState<DiagramMark | null>(null);
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });
  const [closer, setCloser] = useState(false);
  const src = useDiagramPicture(id, closer);
  useEffect(() => {
    if (view.s > 1.6) setCloser(true);
  }, [view.s]);
  const stage = useRef<HTMLDivElement>(null);
  const pic = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>({ kind: 'none' });
  const loaded = useRef(false);
  // The outlines kept, once the picture's size is known (v0.59's one ring becomes an oval of the same size).
  const onLoad = (w: number, h: number) => {
    setSize({ w, h });
    if (loaded.current) return;
    loaded.current = true;
    setMarks(marksOn(item, id).map((m) => ('r' in m ? fromOldRing(m, w, h) : m)));
  };
  const fraction = (cx: number, cy: number) => {
    const r = pic.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return { x: 0, y: 0 };
    return { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height };
  };
  const hitAt = (x: number, y: number) => {
    // the last drawn first; small outlines get a finger's room
    for (let k = marks.length - 1; k >= 0; k--) if (onMark(marks[k], x, y, 0.35 / view.s + 0.15)) return k;
    return undefined;
  };
  const twoFingers = () => {
    const [a, b] = [...pointers.current.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!size) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // a pointer the browser no longer knows: followed without capture
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // a second finger: closer or farther, never a line
      setDraft(null);
      const f = twoFingers();
      gesture.current = { kind: 'pinch', d0: f.d, s0: view.s, mx: f.mx, my: f.my, tx0: view.tx, ty0: view.ty };
      return;
    }
    if (pointers.current.size > 2) return;
    const p = fraction(e.clientX, e.clientY);
    const hit = hitAt(p.x, p.y);
    if (hit !== undefined && hit === picked) gesture.current = { kind: 'move', at: hit, x: p.x, y: p.y, from: marks[hit], moved: false };
    else gesture.current = { kind: 'tap', x: p.x, y: p.y, px: e.clientX, py: e.clientY, hit };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const f = twoFingers();
      const s = Math.min(5, Math.max(1, (g.s0 * f.d) / Math.max(1, g.d0)));
      const box = stage.current?.getBoundingClientRect();
      if (!box) return;
      // the point between the fingers stays under them
      const ox = g.mx - box.left;
      const oy = g.my - box.top;
      const tx = f.mx - box.left - ((ox - g.tx0) / g.s0) * s;
      const ty = f.my - box.top - ((oy - g.ty0) / g.s0) * s;
      const lim = (v: number, side: number) => Math.min(0, Math.max(side - side * s, v));
      setView({ s, tx: lim(tx, box.width), ty: lim(ty, box.height) });
      return;
    }
    const p = fraction(e.clientX, e.clientY);
    if (g.kind === 'tap' && Math.hypot(e.clientX - g.px, e.clientY - g.py) > 8) {
      gesture.current = { kind: 'draw', x: g.x, y: g.y, x2: p.x, y2: p.y };
    }
    const h = gesture.current;
    if (h.kind === 'draw') {
      h.x2 = p.x;
      h.y2 = p.y;
      setDraft(markFromBox(id, h.x, h.y, h.x2, h.y2));
    } else if (h.kind === 'move') {
      h.moved = true;
      const next = fitMark({ ...h.from, x: h.from.x + p.x - h.x, y: h.from.y + p.y - h.y });
      setMarks((l) => l.map((m, k) => (k === h.at ? next : m)));
    }
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) {
        gesture.current = { kind: 'none' };
        if (view.s < 1.05) setView({ s: 1, tx: 0, ty: 0 });
      }
      return;
    }
    gesture.current = { kind: 'none' };
    if (e.type === 'pointercancel') return setDraft(null);
    if (g.kind === 'draw') {
      setDraft(null);
      const m = markFromBox(id, g.x, g.y, g.x2, g.y2);
      if (marks.length >= MAX_MARKS) return;
      haptic('selection');
      setMarks((l) => [...l, m]);
      setPicked(marks.length);
    } else if (g.kind === 'tap') {
      if (g.hit !== undefined) {
        haptic('selection');
        setPicked(g.hit === picked ? null : g.hit);
      } else if (marks.length < MAX_MARKS && size) {
        haptic('selection');
        setMarks((l) => [...l, markAtTap(id, g.x, g.y, size.w, size.h)]);
        setPicked(marks.length);
      }
    }
  };
  const sel = picked !== null && picked < marks.length ? picked : null;
  const shown = draft ? [...marks, draft] : marks;
  // In a layer: the whole diagram in the room given, as wide as its shape lets it.
  const fitStyle: CSSProperties | undefined = size && fit ? { aspectRatio: `${size.w} / ${size.h}`, width: `min(100%, calc(var(--mark-room, 60vh) * ${size.w / size.h}))`, margin: '0 auto' } : size ? { aspectRatio: `${size.w} / ${size.h}` } : undefined;
  return (
    <div className="mark-editor" data-fit={fit || undefined}>
      <div
        className="mark-stage"
        ref={stage}
        data-mark-pic
        data-zoomed={view.s > 1 || undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <div className="mark-zoom" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}>
          <div className="mark-pic" ref={pic} style={fitStyle}>
            {src && <img src={src} alt="" draggable={false} onLoad={(e) => onLoad(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />}
            {shown.map((m, k) => (
              <span
                key={k}
                className="mark-oval"
                data-mark-ring
                data-picked={k === sel || undefined}
                data-draft={(draft && k === marks.length) || undefined}
                style={{ left: `${(m.x - m.rx) * 100}%`, top: `${(m.y - m.ry) * 100}%`, width: `${m.rx * 200}%`, height: `${m.ry * 200}%`, ['--k' as string]: 1 / view.s }}
                aria-hidden
              />
            ))}
          </div>
        </div>
        {!src && <div className="mark-loading" aria-hidden />}
      </div>
      <Group justify="space-between" wrap="nowrap" mt="md" gap="sm">
        <Group gap={8} wrap="nowrap">
          <ActionIcon variant="light" color="gray" size={44} radius="xl" aria-label="−" disabled={sel === null} onClick={() => sel !== null && setMarks((l) => l.map((m, k) => (k === sel ? scaleMark(m, 0.82) : m)))}>
            <IconMinus size={20} />
          </ActionIcon>
          <ActionIcon variant="light" color="gray" size={44} radius="xl" aria-label="+" disabled={sel === null} onClick={() => sel !== null && setMarks((l) => l.map((m, k) => (k === sel ? scaleMark(m, 1.22) : m)))}>
            <IconPlus size={20} />
          </ActionIcon>
          <ActionIcon
            variant="light"
            color="red"
            size={44}
            radius="xl"
            aria-label={t('common.delete')}
            disabled={sel === null}
            onClick={() => {
              if (sel === null) return;
              haptic('light');
              setMarks((l) => l.filter((_, k) => k !== sel));
              setPicked(null);
            }}
          >
            <IconTrash size={19} />
          </ActionIcon>
          {view.s > 1 && (
            <ActionIcon variant="light" color="gray" size={44} radius="xl" aria-label="1×" onClick={() => setView({ s: 1, tx: 0, ty: 0 })}>
              <IconZoomReset size={20} />
            </ActionIcon>
          )}
        </Group>
        {onAdd && (
          <Button variant="subtle" color="gray" leftSection={<IconPhotoPlus size={18} />} onClick={onAdd}>
            {t('diagrams.another')}
          </Button>
        )}
      </Group>
      <Group grow mt="md" gap="sm" wrap="nowrap">
        <Button
          size="lg"
          variant="light"
          color="gray"
          disabled={!marks.length}
          onClick={() => {
            setMarks([]);
            setPicked(null);
          }}
        >
          {t('common.clear')}
        </Button>
        <Button
          size="lg"
          loading={busy}
          disabled={!size}
          onClick={() =>
            void run(async () => {
              // Nothing on this diagram before, nothing now: the part's outlines on its other diagram stay (v0.64).
              if (marks.length || marksOn(item, id).length) await setDiagramMarks(item.id, marks);
              haptic('success');
              await onDone(marks);
            })
          }
        >
          {t('common.done')}
        </Button>
      </Group>
    </div>
  );
}
