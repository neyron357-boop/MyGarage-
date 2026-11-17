import { IconArrowBackUp, IconCheck, IconChevronLeft, IconDots, IconDownload, IconFileZip, IconLoader2, IconPencil, IconPhoto, IconPlus, IconShare, IconTrash, IconX } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '../../domain/dates';
import { canShareFile, shareOrDownload } from '../../ui/share';
import { Annotator } from './annotator';
import { fileToShot } from './capture';
import { buildExport } from './exportZip';
import { setFeedbackOn } from './index';
import { Btn, sizeText, useEscape, useKeyboardInset, useObjectUrl } from './parts';
import { canvasBlob, frameMark, renderAnnotated, thumbOf } from './render';
import { deleteNotes, fbDb, replaceShot, updateNote } from './store';
import type { FbStrings } from './strings';
import type { FbMark, FbNote, FbShot } from './types';

/*
 * «Мои замечания»: the notes, newest first — a small screenshot, the screen, the words, when, new or fixed; the round
 * mark on the left chooses it for the export (all new ones are chosen to begin with). A note opens to be read and put
 * right: its words, its marks, another screenshot from the photos, «Исправлено», «Удалить». At the bottom, under the
 * thumb: «Экспорт для агента» — one ZIP, then «Поделиться» (the iPhone shares a file only in a tap, so it waits for it).
 */

type Filter = 'new' | 'fixed' | 'all';
type Export = { state: 'busy'; done: number; of: number } | { state: 'ready'; file: File; count: number } | null;

function Thumb({ blob, wide }: { blob?: Blob; wide: boolean }) {
  const url = useObjectUrl(blob);
  return url ? <img className="fb-thumb" data-wide={wide || undefined} src={url} alt="" /> : <span className="fb-thumb" data-wide={wide || undefined} />;
}

/** One note, open: read it, put it right. */
function NoteView({ s, note, shot, onBack, onToast }: { s: FbStrings; note: FbNote; shot?: FbShot; onBack: () => void; onToast: (t: string) => void }) {
  const [comment, setComment] = useState(note.comment);
  const [marks, setMarks] = useState<FbMark[]>(note.marks);
  const [annot, setAnnot] = useState(false);
  const [sure, setSure] = useState(false);
  const [img, setImg] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  /** Words typed and not yet kept, by field (kept a moment after the last key — or at once when the note is left). */
  const timers = useRef<Record<string, number>>({});
  const pending = useRef<Record<string, () => void>>({});
  const later = (key: string, keep: () => void) => {
    pending.current[key] = keep;
    window.clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(() => {
      delete pending.current[key];
      keep();
    }, 400);
  };
  const drop = (key: string) => {
    window.clearTimeout(timers.current[key]);
    delete pending.current[key];
  };
  // The picture with its marks, as it will go out.
  useEffect(() => {
    if (!shot) return setImg(undefined);
    let url: string | undefined;
    let alive = true;
    void renderAnnotated(shot, marks, Math.min(shot.width, 900))
      .then((c) => canvasBlob(c, 'image/jpeg', 0.9))
      .then((b) => {
        if (!alive) return;
        url = URL.createObjectURL(b);
        setImg(url);
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [shot, marks]);
  // Typed words are kept as they are typed (a moment after the last key).
  const keepComment = (v: string) => {
    setComment(v);
    later('comment', () => void updateNote(note.id, { comment: v.trim() }));
  };
  useEffect(
    () => () => {
      for (const key of Object.keys(pending.current)) {
        window.clearTimeout(timers.current[key]);
        pending.current[key]();
      }
    },
    [],
  );
  const keepMarks = async (list: FbMark[]) => {
    drop('marks');
    setMarks(list);
    await updateNote(note.id, { marks: list }, shot ? await thumbOf(shot, list).catch(() => undefined) : undefined);
  };
  const markWords = (n: number, v: string) => {
    const list = marks.map((m) => (m.n === n ? { ...m, comment: v } : m));
    setMarks(list);
    later('marks', () => void updateNote(note.id, { marks: list }));
  };
  const tech = [
    `№${note.n} · ${formatDateTime(note.createdAt)}`,
    `${note.page.name}${note.page.title ? ` — ${note.page.title}` : ''}`,
    note.page.route,
    note.page.sheet ? `sheet: ${note.page.sheet}` : '',
    note.element ? `${note.element.description}\n${note.element.selector}\n${note.element.path}` : '',
    note.element ? `rect: ${note.element.rect.x}, ${note.element.rect.y}, ${note.element.rect.width}×${note.element.rect.height}` : '',
    note.element?.components?.length ? `components: ${note.element.components.join(' ← ')}` : '',
    `screen: ${note.viewport.width}×${note.viewport.height} @${note.viewport.dpr}x · ${note.viewport.scheme} · ${note.viewport.standalone ? 'PWA' : 'browser'}`,
    shot ? `screenshot: ${shot.width}×${shot.height} · ${shot.source}` : `screenshot: ${s.noShotShort}`,
    `app ${note.appVersion}`,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div className="fb-full" data-fb-ui onTouchMove={(e) => e.stopPropagation()}>
      <div className="fb-top">
        <Btn onClick={onBack}>
          <IconChevronLeft size={20} />
          {s.back}
        </Btn>
        <div className="fb-top-title">№{note.n}</div>
        <Btn
          danger
          primary={sure}
          onClick={async () => {
            if (!sure) {
              setSure(true);
              window.setTimeout(() => setSure(false), 3000);
              return;
            }
            await deleteNotes([note.id]);
            onBack();
          }}
          aria-label={s.remove}
        >
          <IconTrash size={19} />
          {sure ? s.confirmDelete : null}
        </Btn>
      </div>
      <div className="fb-list">
        {shot ? (
          <button type="button" className="fb-note-shot" onClick={() => setAnnot(true)} aria-label={s.marks}>
            {img ? <img src={img} alt="" /> : <span className="fb-shot-state">{<IconLoader2 size={22} className="fb-spin" />}</span>}
          </button>
        ) : (
          <div className="fb-empty" style={{ padding: 24 }}>
            {s.noShot}
          </div>
        )}
        <div className="fb-row" style={{ justifyContent: 'center' }}>
          {shot && (
            <Btn onClick={() => setAnnot(true)}>
              <IconPencil size={18} />
              {s.marks}
            </Btn>
          )}
          <Btn onClick={() => file.current?.click()}>
            <IconPhoto size={18} />
            {s.gallery}
          </Btn>
          <Btn
            on={note.status === 'fixed'}
            onClick={() => {
              const next = note.status === 'fixed' ? 'new' : 'fixed';
              void updateNote(note.id, { status: next });
              onToast(`№${note.n} · ${s.status[next]}`);
            }}
          >
            {note.status === 'fixed' ? <IconArrowBackUp size={18} /> : <IconCheck size={18} />}
            {note.status === 'fixed' ? s.markNew : s.markFixed}
          </Btn>
        </div>
        <div className="fb-section">
          <div className="fb-section-title">{s.comment}</div>
          <textarea className="fb-text" style={{ marginTop: 0, background: 'var(--fb-card)' }} rows={2} value={comment} placeholder={s.placeholder} onChange={(e) => keepComment(e.currentTarget.value)} />
        </div>
        {marks.length > 0 && (
          <div className="fb-section">
            <div className="fb-section-title">{s.marks}</div>
            <div className="fb-group" style={{ padding: '4px 12px' }}>
              {marks.map((m) => (
                <div key={m.n} className="fb-mark-row">
                  <span className="fb-num">{m.n}</span>
                  <input className="fb-input" value={m.comment ?? ''} placeholder={`${s.tools[m.kind]} — ${s.markComment(m.n).toLowerCase()}`} onChange={(e) => markWords(m.n, e.currentTarget.value)} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="fb-section">
          <div className="fb-section-title">{s.technical}</div>
          <pre className="fb-tech">{tech}</pre>
        </div>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!f) return;
          const g = await fileToShot(f);
          // The element's frame goes on the photo when it is of this screen's shape; the owner's own marks stay.
          const own = marks.filter((m) => !m.auto);
          const list = note.element && g.scale ? [frameMark(note.element.rect, g.scale, g.width, g.height), ...own] : own;
          const renum = list.map((m, i) => ({ ...m, n: i + 1 }));
          await replaceShot(note.id, g, await thumbOf(g, renum).catch(() => undefined), renum);
          setMarks(renum);
        }}
      />
      {annot && shot && (
        <Annotator
          s={s}
          shot={shot}
          marks={marks}
          onCancel={() => setAnnot(false)}
          onDone={(list) => {
            setAnnot(false);
            void keepMarks(list.map((m, i) => ({ ...m, n: i + 1 })));
          }}
        />
      )}
    </div>
  );
}

export function Panel({ s, onClose, onPick, onToast }: { s: FbStrings; onClose: () => void; onPick: () => void; onToast: (t: string) => void }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useKeyboardInset(root);
  const notes = useLiveQuery(() => fbDb().notes.orderBy('n').reverse().toArray(), []);
  const shots = useLiveQuery(async () => {
    const ids = (notes ?? []).map((n) => n.shotId).filter((x): x is string => !!x);
    const list = await fbDb().shots.bulkGet(ids);
    return new Map(list.filter((x): x is FbShot => !!x).map((x) => [x.id, x]));
  }, [notes]);
  const [filter, setFilter] = useState<Filter>('new');
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [sure, setSure] = useState(false);
  const [exp, setExp] = useState<Export>(null);
  const { i18n } = useTranslation();
  useEscape(useCallback(() => (menu ? setMenu(false) : onClose()), [menu, onClose]));

  const all = notes ?? [];
  // Chosen for the export: all new ones, until the owner chooses himself.
  const picked = useMemo(() => chosen ?? new Set(all.filter((n) => n.status === 'new').map((n) => n.id)), [chosen, all]);
  const shown = all.filter((n) => filter === 'all' || n.status === filter);
  const count = { new: all.filter((n) => n.status === 'new').length, fixed: all.filter((n) => n.status === 'fixed').length, all: all.length };
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
    setExp(null);
  };
  const ids = all.filter((n) => picked.has(n.id)).map((n) => n.id);
  const open = openId ? all.find((n) => n.id === openId) : undefined;

  const runExport = async () => {
    setExp({ state: 'busy', done: 0, of: ids.length });
    try {
      const r = await buildExport(ids, s, (done, of) => setExp({ state: 'busy', done, of }));
      setExp({ state: 'ready', file: r.file, count: r.count });
      // Where a file cannot be shared (a PC), it is downloaded at once.
      if (!canShareFile(r.file)) shareOrDownload(r.file);
    } catch (e) {
      console.error('feedback export', e);
      setExp(null);
    }
  };

  return (
    <div className="fb-full" data-fb-ui ref={setRoot} style={{ paddingBottom: 'var(--fb-kb, 0px)' }} onTouchMove={(e) => e.stopPropagation()}>
      <div className="fb-top">
        <Btn round onClick={onClose} aria-label={s.close}>
          <IconX size={21} />
        </Btn>
        <div className="fb-top-title">
          {s.notes}
          {all.length ? ` · ${all.length}` : ''}
        </div>
        <Btn round onClick={onPick} aria-label={s.fab}>
          <IconPlus size={21} />
        </Btn>
        <Btn round onClick={() => setMenu((v) => !v)} aria-label={s.more}>
          <IconDots size={21} />
        </Btn>
      </div>
      {menu && (
        <div className="fb-menu">
          <Btn
            onClick={() => {
              setFeedbackOn(false);
              onToast(s.hidden);
              onClose();
            }}
          >
            {s.hide}
          </Btn>
          <Btn
            danger
            disabled={!count.fixed}
            onClick={async () => {
              if (!sure) {
                setSure(true);
                window.setTimeout(() => setSure(false), 3000);
                return;
              }
              await deleteNotes(all.filter((n) => n.status === 'fixed').map((n) => n.id));
              setSure(false);
              setMenu(false);
            }}
          >
            <IconTrash size={18} />
            {sure ? s.confirmDelete : `${s.deleteFixed} · ${count.fixed}`}
          </Btn>
        </div>
      )}
      <div style={{ padding: '0 12px 8px' }}>
        <div className="fb-seg" role="tablist">
          {(['new', 'fixed', 'all'] as const).map((f) => (
            <Btn key={f} on={filter === f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {s.filter[f]}
              {count[f] ? ` ${count[f]}` : ''}
            </Btn>
          ))}
        </div>
      </div>
      <div className="fb-list">
        {notes && !shown.length ? (
          <div className="fb-empty">{s.empty}</div>
        ) : (
          <div className="fb-group">
            {shown.map((n) => {
              const shot = n.shotId ? shots?.get(n.shotId) : undefined;
              const on = picked.has(n.id);
              return (
                <div key={n.id} className="fb-item" data-note={n.n}>
                  <button type="button" className="fb-check" data-on={on || undefined} onClick={() => toggle(n.id)} aria-pressed={on} aria-label={`№${n.n}`}>
                    <i>{on && <IconCheck size={16} stroke={3} />}</i>
                  </button>
                  <button type="button" className="fb-item-body" onClick={() => setOpenId(n.id)}>
                    <Thumb blob={shot?.thumb} wide={!!shot && shot.width > shot.height} />
                    <span className="fb-item-text">
                      <span className="fb-item-head">
                        <b>№{n.n}</b>
                        <span>{[n.page.name, n.element?.description].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="fb-item-comment">{n.comment || n.marks.find((m) => m.comment)?.comment || '—'}</span>
                      <span className="fb-item-meta">
                        <span>{formatDateTime(n.createdAt)}</span>
                        <span className="fb-pill" data-fixed={n.status === 'fixed' || undefined}>
                          {s.status[n.status]}
                        </span>
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="fb-bottom" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        {exp?.state === 'ready' ? (
          <>
            <div className="fb-sub" style={{ textAlign: 'center' }}>
              {s.exported(exp.count, sizeText(exp.file.size, s.kb, s.mb, i18n.language))}
            </div>
            <Btn primary wide onClick={() => shareOrDownload(exp.file)}>
              {canShareFile(exp.file) ? <IconShare size={20} /> : <IconDownload size={20} />}
              {canShareFile(exp.file) ? s.share : s.download}
            </Btn>
          </>
        ) : (
          <>
            <div className="fb-row" style={{ marginTop: 0 }}>
              <Btn style={{ flex: 1 }} onClick={() => (setChosen(new Set(shown.map((n) => n.id))), setExp(null))} disabled={!shown.length}>
                {s.selectAll}
              </Btn>
              <Btn style={{ flex: 1 }} onClick={() => (setChosen(new Set()), setExp(null))} disabled={!ids.length}>
                {s.selectNone}
              </Btn>
            </div>
            <Btn primary wide disabled={!ids.length || exp?.state === 'busy'} onClick={() => void runExport()}>
              {exp?.state === 'busy' ? <IconLoader2 size={20} className="fb-spin" /> : <IconFileZip size={20} />}
              {exp?.state === 'busy' ? s.exporting(exp.done, exp.of) : `${s.exportFor} · ${ids.length}`}
            </Btn>
          </>
        )}
      </div>
      {open && <NoteView key={open.id} s={s} note={open} shot={open.shotId ? shots?.get(open.shotId) : undefined} onBack={() => setOpenId(null)} onToast={onToast} />}
    </div>
  );
}
