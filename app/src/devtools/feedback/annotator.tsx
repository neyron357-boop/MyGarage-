import { IconArrowBackUp, IconArrowUpRight, IconCircleNumber1, IconEye, IconPencil, IconSquare, IconTrash } from '@tabler/icons-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Btn, useEscape, useKeyboardInset, useObjectUrl } from './parts';
import { arrowHead, badgeAt, canvasBlob, geometry, markColor, renderAnnotated, renumber } from './render';
import type { FbStrings } from './strings';
import type { FbMark } from './types';

/*
 * Marks on a screenshot: a box (drag over what is meant), an arrow (from where to what), a numbered pin (a tap). Each
 * mark gets the next number and a line for a few words; a tap on a mark takes it again (its words, «Удалить»).
 * «Просмотр» shows the picture exactly as it goes out (the export's own drawing).
 */

type Tool = FbMark['kind'];
type ShotLike = { blob: Blob; width: number; height: number };

const TOOLS: { kind: Tool; icon: typeof IconSquare }[] = [
  { kind: 'rect', icon: IconSquare },
  { kind: 'arrow', icon: IconArrowUpRight },
  { kind: 'pin', icon: IconCircleNumber1 },
];

/** One mark as SVG, the same as the export draws it (render.ts). */
function MarkSvg({ m, w, h, color, selected }: { m: FbMark; w: number; h: number; color: string; selected: boolean }) {
  const g = geometry(w, h);
  const x1 = m.x1 * w;
  const y1 = m.y1 * h;
  const x2 = m.x2 * w;
  const y2 = m.y2 * h;
  const b = badgeAt(m, w, h, g);
  const r = m.kind === 'pin' ? g.badge * 1.25 : g.badge;
  const halo = g.line + 2 * g.halo;
  let shape = null;
  if (m.kind === 'rect') {
    const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    shape = (
      <>
        <rect {...box} fill="rgba(255, 59, 48, 0.08)" stroke="#fff" strokeWidth={halo} strokeLinejoin="round" />
        <rect {...box} fill="none" stroke={color} strokeWidth={g.line} strokeLinejoin="round" />
        <rect {...box} fill="none" stroke="transparent" strokeWidth={g.line * 7} pointerEvents="stroke" />
      </>
    );
  } else if (m.kind === 'arrow') {
    const head = arrowHead(x1, y1, x2, y2, g.head);
    const mid = { x: (head[1][0] + head[2][0]) / 2, y: (head[1][1] + head[2][1]) / 2 };
    const pts = head.map((p) => p.join(',')).join(' ');
    shape = (
      <>
        <line x1={x1} y1={y1} x2={mid.x} y2={mid.y} stroke="#fff" strokeWidth={halo} strokeLinecap="round" />
        <polygon points={pts} fill="#fff" stroke="#fff" strokeWidth={halo} strokeLinejoin="round" />
        <line x1={x1} y1={y1} x2={mid.x} y2={mid.y} stroke={color} strokeWidth={g.line} strokeLinecap="round" />
        <polygon points={pts} fill={color} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={g.line * 7} pointerEvents="stroke" />
      </>
    );
  }
  return (
    <g data-n={m.n} className="fb-mark-hit">
      {shape}
      {selected && <circle cx={b.x} cy={b.y} r={r + g.halo * 3} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={g.halo * 2} />}
      <circle cx={b.x} cy={b.y} r={r} fill={color} stroke="#fff" strokeWidth={g.halo} />
      <text x={b.x} y={b.y + g.unit * 0.5} fill="#fff" fontSize={m.kind === 'pin' ? g.font * 1.2 : g.font} fontWeight={700} textAnchor="middle" dominantBaseline="middle" fontFamily="-apple-system, system-ui, sans-serif">
        {m.n}
      </text>
    </g>
  );
}

export function Annotator({ shot, marks, onDone, onCancel, s }: { shot: ShotLike; marks: FbMark[]; onDone: (marks: FbMark[]) => void; onCancel: () => void; s: FbStrings }) {
  const [list, setList] = useState<FbMark[]>(marks);
  const [tool, setTool] = useState<Tool>('rect');
  const [sel, setSel] = useState<number | null>(null);
  const [draft, setDraft] = useState<FbMark | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const url = useObjectUrl(shot.blob);
  const color = markColor();
  useKeyboardInset(root);
  useEscape(useCallback(() => (sel !== null ? setSel(null) : onCancel()), [sel, onCancel]));

  // The picture as big as the stage lets it be, its shape kept.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const k = Math.min((r.width - 24) / shot.width, (r.height - 8) / shot.height);
      setBox({ w: Math.max(1, Math.floor(shot.width * k)), h: Math.max(1, Math.floor(shot.height * k)) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shot.width, shot.height]);

  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  /** A new mark is taken at once: its words next (the field gets the keyboard in the tap itself). */
  const add = (m: FbMark) => {
    setList((l) => [...l, m]);
    setSel(m.n);
    input.current?.focus({ preventScroll: true });
  };
  const selected = sel !== null ? list.find((m) => m.n === sel) : undefined;
  const setComment = (v: string) => setList((l) => l.map((m) => (m.n === sel ? { ...m, comment: v } : m)));
  const remove = () => {
    setList((l) => renumber(l.filter((m) => m.n !== sel)));
    setSel(null);
  };
  const showPreview = async () => {
    const canvas = await renderAnnotated(shot, list, Math.min(shot.width, Math.round(box.w * Math.min(2, window.devicePixelRatio || 1))));
    setPreview(URL.createObjectURL(await canvasBlob(canvas, 'image/png')));
    setSel(null);
  };
  const minMove = 0.02;

  return (
    <div className="fb-full" data-fb-ui ref={setRoot} style={{ paddingBottom: 'var(--fb-kb, 0px)' }} onTouchMove={(e) => e.stopPropagation()}>
      <div className="fb-top">
        <Btn onClick={onCancel}>{s.cancel}</Btn>
        <div className="fb-top-title">{s.marks}</div>
        <Btn primary onClick={() => onDone(list)}>
          {s.done}
        </Btn>
      </div>
      <div className="fb-stage" ref={stage}>
        <div className="fb-canvas" style={{ width: box.w, height: box.h }}>
          {preview ? (
            <img src={preview} alt="" />
          ) : (
            <>
              {url && <img src={url} alt="" />}
              <svg
                ref={svg}
                viewBox={`0 0 ${shot.width} ${shot.height}`}
                preserveAspectRatio="none"
                onPointerDown={(e) => {
                  const hit = (e.target as Element).closest('[data-n]');
                  if (hit) {
                    setSel(Number(hit.getAttribute('data-n')));
                    return;
                  }
                  if (input.current === document.activeElement) input.current?.blur();
                  svg.current?.setPointerCapture(e.pointerId);
                  const p = at(e);
                  drag.current = { id: e.pointerId, x: p.x, y: p.y, moved: false };
                  if (tool !== 'pin') setDraft({ n: list.length + 1, kind: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d || d.id !== e.pointerId) return;
                  const p = at(e);
                  if (Math.hypot(p.x - d.x, (p.y - d.y) * (shot.height / shot.width)) > minMove) d.moved = true;
                  if (tool !== 'pin') setDraft((m) => (m ? { ...m, x2: p.x, y2: p.y } : m));
                }}
                onPointerUp={(e) => {
                  const d = drag.current;
                  drag.current = null;
                  const m = draft;
                  setDraft(null);
                  if (!d || d.id !== e.pointerId) return;
                  const n = list.length + 1;
                  if (tool === 'pin') {
                    if (!d.moved) add({ n, kind: 'pin', x1: d.x, y1: d.y, x2: d.x, y2: d.y });
                  } else if (m && d.moved) add({ ...m, n });
                  else setSel(null);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setDraft(null);
                }}
              >
                {list.map((m) => (
                  <MarkSvg key={m.n} m={m} w={shot.width} h={shot.height} color={color} selected={m.n === sel} />
                ))}
                {draft && <MarkSvg m={draft} w={shot.width} h={shot.height} color={color} selected={false} />}
              </svg>
            </>
          )}
        </div>
      </div>
      {/* The words of the mark taken; always there (hidden), so a new mark's tap can give it the keyboard. */}
      <div className="fb-mark-bar" style={selected && !preview ? undefined : { position: 'absolute', opacity: 0, pointerEvents: 'none', left: -9999 }}>
        <span className="fb-num">{selected?.n ?? ''}</span>
        <input
          ref={input}
          className="fb-input"
          value={selected?.comment ?? ''}
          placeholder={selected ? s.markComment(selected.n) : ''}
          onChange={(e) => setComment(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              input.current?.blur();
              setSel(null);
            }
          }}
          enterKeyHint="done"
          aria-label={selected ? s.markComment(selected.n) : s.comment}
        />
        <Btn round danger onClick={remove} aria-label={s.remove}>
          <IconTrash size={20} />
        </Btn>
        <Btn
          onClick={() => {
            input.current?.blur();
            setSel(null);
          }}
        >
          {s.ok}
        </Btn>
      </div>
      <div className="fb-bottom">
        {preview ? (
          <Btn wide onClick={() => setPreview(null)}>
            <IconPencil size={20} />
            {s.draw}
          </Btn>
        ) : (
          <>
            <div className="fb-seg" role="radiogroup" aria-label={s.marks}>
              {TOOLS.map((t) => (
                <Btn key={t.kind} on={tool === t.kind} role="radio" aria-checked={tool === t.kind} onClick={() => setTool(t.kind)}>
                  <t.icon size={19} stroke={2.1} />
                  <span>{s.tools[t.kind]}</span>
                </Btn>
              ))}
            </div>
            <Btn round disabled={!list.length} onClick={() => (setList((l) => l.slice(0, -1)), setSel(null))} aria-label={s.undo}>
              <IconArrowBackUp size={21} />
            </Btn>
            <Btn round onClick={() => void showPreview()} aria-label={s.preview}>
              <IconEye size={21} />
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}
