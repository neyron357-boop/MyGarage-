import { Button, Loader, Modal, Stack, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBan,
  IconBrandWhatsapp,
  IconCamera,
  IconChevronDown,
  IconChevronLeft,
  IconChevronUp,
  IconCopy,
  IconDownload,
  IconFile,
  IconLock,
  IconMapPin,
  IconMessage2,
  IconMicrophone,
  IconPaperclip,
  IconPhone,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconPlus,
  IconRefresh,
  IconSend,
  IconShare2,
  IconTrash,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { dayHeading, dubaiTime } from '../../domain/dates';
import { clock, fileSize, firstUnread, groupDays, kindOf, MAX_FILE_BYTES, sendKind, type WaMessage, type Who } from '../../domain/whatsapp';
import {
  canRetryWa,
  inChat,
  deleteWaForAll,
  dropFailed,
  forwardWa,
  loadMessages,
  moreMessages,
  retryWa,
  seenWa,
  sendWaFile,
  sendWaText,
  sendWaVoice,
  setWaDraft,
  setWaReply,
  setWaVoiceDraft,
  showingChat,
  stopWaUpload,
  useWaPrefs,
  waDraft,
  waFileBlob,
  waFileSrc,
  waReady,
  waReplyOf,
  waVoiceDraft,
  type VoiceDraft,
} from '../../services/whatsapp';
import { canRecord, useRecorder } from '../../ui/recorder';
import { peaksOfBlob, rateLabel, savedVoiceRate, saveVoiceRate, VOICE_RATES, type VoiceRate } from '../../ui/voice';
import { WAVE_BARS } from '../../domain/waveform';
import { copyText } from '../../ui/clipboard';
import { ConfirmModal, StickyBar } from '../../ui/components';
import { DeskMenu, type DeskMenuItem } from '../../ui/desk';
import { haptic } from '../../ui/haptics';
import { useHistoryLayer } from '../../ui/historyLayer';
import { useErrorText, useLang } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { useLongPress } from '../../ui/longPress';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { showPdf } from '../../ui/PdfViewer';
import { downloadFile, shareOrDownload } from '../../ui/share';
import { useScreen } from '../../ui/stack';
import { useWaSel } from '../../ui/waSel';
import { useSwipeReply } from '../../ui/swipeReply';
import { startVideo, VideoPlayer } from '../../ui/VideoPlayer';
import { ChatQuick, type QuickFor } from './ChatQuick';
import { ChatPicker } from './ChatPicker';
import { forwardNote } from './forwardNote';
import { KIND_ICON, Marked, Ticks } from './WaParts';

/*
 * A chat of the garage's WhatsApp (v0.78; v0.84 — the brief «полировка встроенного WhatsApp», the owner: «интерфейс на 99 %
 * схож с настоящим ватсапом»): its messages by day over the chat's own wallpaper — the other side on the left in white,
 * one's own on the right in WhatsApp's pale green, the time and the ticks in the bubble's corner, a tail on the last of a
 * run; the day floats at the top while it scrolls; «N непрочитанных» where the unread begin. Below, WhatsApp's bar: «＋»,
 * the words (up to four lines), the camera and the microphone (held — it records; slid left — thrown away; slid up —
 * locked, no hands). A swipe to the right answers a message, a long press lifts it with its menu (a right click on a PC).
 *
 * The same chat in «WhatsApp» and on a job's tab: one store (services/whatsapp.ts), one draft, one message being answered,
 * one recording kept. What is sent is in the chat at once with its state — «В очереди» without a network (it goes by
 * itself), a ring while a file goes up, «Ошибка отправки» with why, «Повторить» and «Удалить».
 */

/** Messages of one side closer than this are one run (the tail on its last). */
const RUN_MS = 5 * 60_000;
/** Drawn with the chat at once (the rest a frame later): more than a phone's screen holds above the field. */
const FIRST_ROWS = 14;
const fineMouse = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
const thumbSrc = (thumb: string | undefined) => (thumb ? `data:image/jpeg;base64,${thumb}` : undefined);

/**
 * A photo's or a video's frame: its own shape, kept within what a bubble may take — nothing moves as it loads. With words
 * under it (v0.87) a tall one is cut a little (its middle shown, as WhatsApp does): its words are read in a column as wide
 * as the picture, not a narrow strip.
 */
function frameOf(w: number | undefined, h: number | undefined, words = false): React.CSSProperties {
  const ratio = w && h ? Math.min(1.9, Math.max(words ? 0.8 : 0.62, w / h)) : 1;
  return { aspectRatio: String(ratio), width: `min(${ratio >= 1 ? 280 : Math.round(300 * ratio)}px, 66vw)` };
}

/** A group's writer's own colour (as WhatsApp gives each one) — the same person, the same colour. */
const AUTHOR_HUES = ['#1f7aec', '#d0571c', '#0f9d58', '#a43ad8', '#c88a04', '#0a93b0', '#d43a3a', '#5b5bd6', '#13976f', '#cf3a8a'];
function authorColor(id: string | undefined): string {
  let h = 0;
  for (const ch of id ?? '') h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AUTHOR_HUES[Math.abs(h) % AUTHOR_HUES.length];
}

/* ---------- What a message carries ---------- */

/**
 * A voice message or a sound, as WhatsApp shows one (v0.83): ▶ · the recording's own bars with the dot at the place (a tap
 * or a drag moves it there) · the speed once it has been played (1× → 1.5× → 2×, kept on this device) or the microphone ·
 * how long (how far it went) under the bars. The bars are read from the recording itself, one recording at a time, a
 * moment after the chat shows (`waveOf`); until then they lie flat. One plays at a time.
 */
let playing: HTMLAudioElement | null = null;
const waves = new Map<string, number[]>();
let waveQueue: Promise<unknown> = Promise.resolve();
function waveOf(m: WaMessage): Promise<number[] | undefined> {
  const known = waves.get(m.id);
  if (known) return Promise.resolve(known);
  const p = waveQueue.then(async () => {
    const blob = await waFileBlob(m).catch(() => undefined);
    const bars = blob ? await peaksOfBlob(blob) : undefined;
    if (bars) waves.set(m.id, bars);
    return bars;
  });
  waveQueue = p.catch(() => undefined);
  return p;
}
const FLAT = Array.from({ length: WAVE_BARS }, () => 0.12);

function Sound({ m, busy }: { m: WaMessage; /** Going up (v0.84): the ring stands in the play button's place. */ busy?: ReactNode }) {
  const { t } = useTranslation();
  const lang = useLang();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [on, setOn] = useState(false);
  const [pos, setPos] = useState(0);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rate, setRate] = useState<VoiceRate>(savedVoiceRate);
  const [bars, setBars] = useState<number[] | undefined>(() => waves.get(m.id));
  const [dur, setDur] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const press = useRef<{ x: number; at: number } | null>(null);
  const wave = useRef<HTMLDivElement>(null);
  const length = m.file?.sec || dur || 0;
  useEffect(
    () => () => {
      audio.current?.pause();
      if (playing === audio.current) playing = null;
    },
    [],
  );
  useEffect(() => {
    if (bars || !(m.local || waFileSrc(m.id))) return undefined;
    let alive = true;
    const later = window.setTimeout(() => void waveOf(m).then((p) => alive && p && setBars(p)), 500);
    return () => {
      alive = false;
      window.clearTimeout(later);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);
  const player = (): HTMLAudioElement | null => {
    if (audio.current) return audio.current;
    const src = m.local ?? waFileSrc(m.id);
    if (!src) return null;
    const a = new Audio(src);
    a.preload = 'auto';
    a.playbackRate = rate;
    a.addEventListener('timeupdate', () => setPos(a.currentTime));
    a.addEventListener('loadedmetadata', () => Number.isFinite(a.duration) && setDur(a.duration));
    a.addEventListener('ended', () => {
      setOn(false);
      setPos(0);
    });
    a.addEventListener('pause', () => setOn(false));
    a.addEventListener('play', () => setOn(true));
    a.addEventListener('error', () => setFailed(true));
    audio.current = a;
    return a;
  };
  const toggle = () => {
    const a = player();
    if (!a) return;
    setStarted(true);
    if (a.paused) {
      if (playing && playing !== a) playing.pause();
      playing = a;
      a.playbackRate = rate;
      void a.play().catch(() => setFailed(true));
    } else a.pause();
  };
  const seek = (frac: number) => {
    const a = player();
    const whole = length || a?.duration || 0;
    if (!a || !whole || !Number.isFinite(whole)) return;
    a.currentTime = Math.min(whole, Math.max(0, frac * whole));
    setPos(a.currentTime);
    setStarted(true);
  };
  const cycle = () => {
    const next = VOICE_RATES[(VOICE_RATES.indexOf(rate) + 1) % VOICE_RATES.length];
    setRate(next);
    saveVoiceRate(next);
    if (audio.current) audio.current.playbackRate = next;
    haptic('selection');
  };
  const fracAt = (x: number) => {
    const r = wave.current?.getBoundingClientRect();
    return r && r.width ? Math.max(0, Math.min(1, (x - r.left) / r.width)) : 0;
  };
  const shown = drag ?? (length ? Math.min(1, pos / length) : 0);
  const seconds = drag !== null ? drag * length : on || pos ? pos : length;
  const drawn = useMemo(() => (bars ?? FLAT).map((h, k) => <i key={k} style={{ '--h': h } as React.CSSProperties} />), [bars]);
  return (
    <span className="note-voice wa-voice" data-active={started || undefined} data-failed={failed || undefined}>
      {busy ?? (
        <button type="button" className="wa-sound-play note-play tap" aria-label={t(on ? 'wa.pause' : 'wa.play')} onClick={toggle} data-repeat>
          {on ? <IconPlayerPauseFilled size={20} /> : <IconPlayerPlayFilled size={20} />}
        </button>
      )}
      <div
        ref={wave}
        className="voice-wave"
        role="slider"
        tabIndex={0}
        aria-label={t('wa.kind.voice')}
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={Math.round(seconds)}
        aria-valuetext={clock(seconds)}
        data-drag={drag !== null || undefined}
        data-playing={(on && drag === null) || undefined}
        style={{ '--p': shown } as React.CSSProperties}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          press.current = { x: e.clientX, at: e.timeStamp };
          setDrag(fracAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (drag !== null) setDrag(fracAt(e.clientX));
        }}
        onPointerUp={(e) => {
          if (drag === null) return;
          setDrag(null);
          const p = press.current;
          press.current = null;
          // A long press without a move opened the message's menu: lifting the finger does not move the place.
          if (p && e.timeStamp - p.at > 450 && Math.abs(e.clientX - p.x) < 8) return;
          seek(fracAt(e.clientX));
        }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (!length || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
          e.preventDefault();
          seek(Math.max(0, Math.min(1, (pos + (e.key === 'ArrowRight' ? 5 : -5)) / length)));
        }}
      >
        <span className="voice-bars" aria-hidden>
          {drawn}
        </span>
        <span className="voice-bars voice-played" aria-hidden>
          {drawn}
        </span>
        <span className="voice-dot-rail" aria-hidden>
          <span className="voice-dot" />
        </span>
      </div>
      {started && !failed ? (
        // Its words change with each tap, yet it is the same control: taps in a row all count (ui/tapGuard).
        <button type="button" className="voice-rate" data-repeat aria-label={t('notes.speed')} onClick={cycle}>
          {rateLabel(rate, lang)}
        </button>
      ) : (
        <span className="voice-mic" aria-hidden>
          <IconMicrophone size={18} stroke={2} />
        </span>
      )}
      <span className="tnum voice-len">{failed ? t('wa.fileGone') : clock(seconds)}</span>
    </span>
  );
}

/**
 * A file going up (v0.84): a ring of how much of it went, «×» in it stops it (the message stays, not sent — «Повторить»).
 * Before the first part goes — a ring that turns.
 */
function Progress({ id, p, size = 44 }: { id: string; p: number | undefined; size?: number }) {
  const { t } = useTranslation();
  const r = size / 2 - 3;
  const len = 2 * Math.PI * r;
  return (
    <button
      type="button"
      className="wa-progress"
      style={{ width: size, height: size }}
      aria-label={t('wa.stop')}
      data-spin={!p || undefined}
      onClick={(e) => {
        e.stopPropagation();
        stopWaUpload(id);
      }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="wa-progress-track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="wa-progress-bar" strokeDasharray={len} strokeDashoffset={len * (1 - Math.max(0.06, p ?? 0.25))} />
      </svg>
      <IconX size={size * 0.4} stroke={2.4} aria-hidden />
    </button>
  );
}

/** A document: its symbol, its name, how large — a tap shares it (a phone) or saves it (a PC). */
function Doc({ m, onOpen }: { m: WaMessage; onOpen: (m: WaMessage) => void }) {
  const { t } = useTranslation();
  const size = fileSize(m.file?.size);
  const ext = (m.file?.name?.split('.').pop() ?? m.file?.mime?.split('/').pop() ?? '').slice(0, 5).toUpperCase();
  const going = m.pending && !m.failed && !m.queued && m.progress !== undefined;
  return (
    <div className="wa-doc">
      {going ? (
        <Progress id={m.id} p={m.progress} size={40} />
      ) : (
        <span className="wa-doc-icon" data-ext={ext.toLowerCase()} aria-hidden>
          <IconFile size={22} stroke={1.8} />
          {ext && <span className="wa-doc-ext">{ext}</span>}
        </span>
      )}
      <button type="button" className="wa-doc-body tap" onClick={() => onOpen(m)} aria-label={m.file?.name || t('wa.kind.file')}>
        <span className="wa-doc-name">{m.file?.name || t('wa.kind.file')}</span>
        <span className="wa-doc-meta">{[size ? `${size.n} ${t(`wa.unit.${size.unit}`)}` : '', ext].filter(Boolean).join(' · ')}</span>
      </button>
      {!m.pending && <IconDownload size={18} stroke={2} aria-hidden className="wa-doc-get" />}
    </div>
  );
}

/** A photo: its small blurred preview at once (it came with the message), the photo itself over it when it is in. */
function Picture({ m, onOpen }: { m: WaMessage; onOpen: (m: WaMessage) => void }) {
  const { t } = useTranslation();
  const src = m.local ?? waFileSrc(m.id);
  const [shown, setShown] = useState(false);
  const [gone, setGone] = useState(false);
  const thumb = thumbSrc(m.file?.thumb);
  const going = m.pending && !m.failed && !m.queued && m.progress !== undefined;
  return (
    <span className="wa-pic" style={frameOf(m.file?.w, m.file?.h, !!m.text)} data-gone={gone || undefined}>
      <button type="button" className="wa-pic-open" aria-label={t('wa.kind.photo')} onClick={() => !gone && onOpen(m)} />
      {thumb && <img className="wa-pic-thumb" src={thumb} alt="" aria-hidden />}
      {src && !gone && <img className="wa-pic-full" src={src} alt="" loading="lazy" decoding="async" data-shown={shown || undefined} onLoad={() => setShown(true)} onError={() => setGone(true)} />}
      {gone && <span className="wa-pic-gone">{t('wa.fileGone')}</span>}
      {going && (
        <span className="wa-pic-progress">
          <Progress id={m.id} p={m.progress} size={48} />
        </span>
      )}
    </span>
  );
}

function Film({ m, onOpen }: { m: WaMessage; onOpen: (m: WaMessage, url: string) => void }) {
  const { t } = useTranslation();
  const src = m.local ?? waFileSrc(m.id);
  const thumb = thumbSrc(m.file?.thumb);
  const going = m.pending && !m.failed && !m.queued && m.progress !== undefined;
  return (
    <span className="wa-pic wa-film" style={frameOf(m.file?.w, m.file?.h, !!m.text)}>
      <button type="button" className="wa-pic-open" aria-label={t('wa.kind.video')} onClick={() => src && onOpen(m, src)} />
      {thumb && <img className="wa-pic-thumb" src={thumb} alt="" aria-hidden />}
      {going ? (
        <span className="wa-pic-progress">
          <Progress id={m.id} p={m.progress} size={48} />
        </span>
      ) : (
        <span className="note-video-play" aria-hidden>
          <IconPlayerPlayFilled size={26} />
        </span>
      )}
      {!!m.file?.sec && (
        <span className="note-video-len" aria-hidden>
          {clock(m.file.sec)}
        </span>
      )}
    </span>
  );
}

/** The message answered, on top of the answer: a bar of its writer's colour, who, a line of it, its picture. */
function Quoted({ q, onGo, name, color }: { q: NonNullable<WaMessage['quote']>; onGo: (id: string) => void; name: string; color: string }) {
  const { t } = useTranslation();
  const kind = kindOf(q.type);
  const I = KIND_ICON[kind];
  const thumb = thumbSrc(q.thumb);
  return (
    <button type="button" className="wa-quote" style={{ '--qc': color } as React.CSSProperties} onClick={() => q.id && onGo(q.id)}>
      <span className="wa-quote-text">
        <span className="wa-quote-who">{name}</span>
        <span className="wa-quote-line">
          {I && <I size={14} stroke={2} aria-hidden />} {q.text || (kind === 'text' ? '' : t(`wa.kind.${kind}`))}
        </span>
      </span>
      {thumb && <img className="wa-quote-thumb" src={thumb} alt="" />}
    </button>
  );
}

/* ---------- A message ---------- */

interface BubbleProps {
  m: WaMessage;
  tail: boolean;
  gap: boolean;
  /** In a group: who wrote it, over the first of a run — the garage's name for the person, when it knows one. */
  author?: string;
  /** Whose the quoted message was, as the chat names them. */
  quoteName: string;
  desk: boolean;
  onPhoto: (m: WaMessage) => void;
  onVideo: (m: WaMessage, url: string) => void;
  onDoc: (m: WaMessage) => void;
  onReply: (m: WaMessage) => void;
  onMenu: (m: WaMessage, at?: { x: number; y: number }, el?: HTMLElement) => void;
  onQuote: (id: string) => void;
  onAgain: (m: WaMessage) => void;
  onDrop: (m: WaMessage) => void;
  onCard: (phone: string) => void;
}

const Bubble = memo(function Bubble({ m, tail, gap, author, quoteName, desk, onPhoto, onVideo, onDoc, onReply, onMenu, onQuote, onAgain, onDrop, onCard }: BubbleProps) {
  const { t } = useTranslation();
  const kind = kindOf(m.type);
  const row = useRef<HTMLDivElement>(null);
  const press = useLongPress(() => onMenu(m, undefined, row.current ?? undefined));
  const swipe = useSwipeReply(() => onReply(m), !m.pending && !m.failed);
  // A finger (a phone, an iPad in the PC's layout): a long press lifts the message with its menu, a swipe answers; a mouse
  // on a PC: the right click — its menu where the pointer is.
  const handlers = {
        onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
          press.handlers.onTouchStart(e);
          swipe.onTouchStart(e);
        },
        onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
          press.handlers.onTouchMove(e);
          swipe.onTouchMove(e);
        },
        onTouchEnd: (e: React.TouchEvent<HTMLElement>) => {
          press.handlers.onTouchEnd(e);
          swipe.onTouchEnd();
        },
        onTouchCancel: () => {
          press.handlers.onTouchCancel();
          swipe.onTouchCancel();
        },
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault();
          // (A touch's own long press is the one above; a mouse's right click — the PC's menu at the pointer.)
          if (desk && (e.nativeEvent as PointerEvent).pointerType !== 'touch') onMenu(m, { x: e.clientX, y: e.clientY }, row.current ?? undefined);
        },
      };
  const foot = (
    <span className="note-time wa-foot">
      {m.star && <span className="wa-star" aria-hidden>★</span>}
      {dubaiTime(new Date(m.t).toISOString())}
      {m.me && <Ticks m={m} size={16} />}
    </span>
  );
  const quote = m.quote ? <Quoted q={m.quote} onGo={onQuote} name={m.quote.me ? t('wa.you') : quoteName} color={m.quote.me ? 'var(--wa-quote-me)' : 'var(--wa-quote-other)'} /> : null;
  const who = author ? (
    <span className="wa-author" style={{ '--ac': authorColor(m.from?.id) } as React.CSSProperties}>
      {author}
    </span>
  ) : null;
  const fwd = m.fwd ? (
    <span className="wa-fwd">
      <IconArrowForwardUp size={14} stroke={2} aria-hidden /> {t('wa.forwarded')}
    </span>
  ) : null;
  const words = m.text ? (
    <span className="note-text">
      <Marked text={m.text} />
    </span>
  ) : null;
  const picture = kind === 'photo' || kind === 'video' || kind === 'sticker';
  const going = m.pending && !m.failed && !m.queued && m.progress !== undefined;

  let inner: ReactNode;
  if (picture) inner = kind === 'video' ? <Film m={m} onOpen={onVideo} /> : <Picture m={m} onOpen={onPhoto} />;
  else if (kind === 'voice' || kind === 'audio') inner = <Sound m={m} busy={going ? <Progress id={m.id} p={m.progress} size={40} /> : undefined} />;
  else if (kind === 'file') inner = <Doc m={m} onOpen={onDoc} />;
  else if (kind === 'place')
    inner = (
      <a className="wa-line" href={`https://maps.google.com/?q=${m.place?.lat},${m.place?.lng}`} target="_blank" rel="noopener noreferrer">
        <IconMapPin size={18} stroke={2} aria-hidden /> {m.text || t('wa.kind.place')}
      </a>
    );
  else if (kind === 'card')
    inner = (
      <button type="button" className="wa-line wa-card tap" disabled={!m.card?.phone} onClick={() => m.card?.phone && onCard(m.card.phone)}>
        <IconUser size={18} stroke={2} aria-hidden /> {m.card?.name || t('wa.kind.card')}
        {m.card?.phone ? <span className="wa-card-phone">+{m.card.phone}</span> : null}
      </button>
    );
  else if (kind === 'call')
    inner = (
      <span className="wa-line">
        <IconPhone size={18} stroke={2} aria-hidden /> {t('wa.kind.call')}
      </span>
    );
  else if (kind === 'gone')
    inner = (
      <span className="wa-line wa-dim">
        <IconBan size={17} stroke={2} aria-hidden /> {t('wa.kind.gone')}
      </span>
    );
  else if (kind === 'other')
    inner = (
      <span className="wa-line wa-dim">
        <IconBrandWhatsapp size={17} stroke={2} aria-hidden /> {t('wa.kind.other')}
      </span>
    );

  // A picture without words: the time over its corner (as WhatsApp); with words — under them, as in any bubble.
  const bare = picture && !m.text;
  const state = m.pending && !m.failed && (m.queued || m.checking) ? (m.queued ? 'queued' : 'checking') : null;

  return (
    <div
      ref={row}
      className="note-row wa-row"
      data-in={!m.me || undefined}
      data-gap={gap || undefined}
      data-wa-id={m.id}
      data-failed={m.failed || undefined}
      data-pending={m.pending || undefined}
    >
      <div className="note-swipe" {...handlers}>
        <span className="note-reply-icon" aria-hidden>
          <IconArrowBackUp size={18} stroke={2.2} />
        </span>
        <div className="wa-bubble" data-tail={tail || undefined} data-kind={kind} data-media={picture || undefined} data-bare={bare || undefined} data-sticker={kind === 'sticker' || undefined}>
          {who}
          {fwd}
          {quote}
          {inner}
          {kind === 'place' ? null : words}
          {foot}
          {/* A PC (v0.87, as WhatsApp's own window): ⌄ in the corner while the pointer is over it — the message's menu. */}
          {desk && (
            <button
              type="button"
              className="wa-more"
              aria-label={t('wa.msgMenu')}
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                onMenu(m, { x: Math.round(r.left), y: Math.round(r.bottom + 4) }, row.current ?? undefined);
              }}
              data-wa-more
            >
              <IconChevronDown size={18} stroke={2.2} aria-hidden />
            </button>
          )}
        </div>
        {state && (
          <span className="wa-state-line" role="status">
            {state === 'queued' ? <IconRefresh size={13} stroke={2.2} aria-hidden /> : <Loader size={10} color="currentColor" />}
            {t(`wa.ticks.${state}`)}
          </span>
        )}
        {m.failed && (
          <span className="wa-failed" role="alert">
            <span className="wa-failed-why">
              <IconAlertCircle size={15} stroke={2.2} aria-hidden />
              <span>
                {t('wa.ticks.failed')}
                {m.err && m.err !== 'wa.err.failed' ? ` · ${t(m.err)}` : ''}
              </span>
            </span>
            <span className="wa-failed-acts">
              {canRetryWa(m.id) && (
                <button type="button" className="wa-failed-btn tap" onClick={() => onAgain(m)} data-wa-retry>
                  <IconRefresh size={15} stroke={2.2} aria-hidden /> {t('wa.retry')}
                </button>
              )}
              <button type="button" className="wa-failed-btn tap" data-red onClick={() => onDrop(m)} data-wa-drop>
                <IconTrash size={15} stroke={2} aria-hidden /> {t('common.delete')}
              </button>
            </span>
          </span>
        )}
      </div>
    </div>
  );
});

/* ---------- Files about to be sent ---------- */

interface Picked {
  file: File;
  url?: string;
}
/** Files picked and not sent (v0.84, «возврат сохраняет выбранный файл и подпись в черновике текущего чата»), by chat. */
const pickedDrafts = new Map<string, { files: Picked[]; caption: string }>();

/**
 * What was picked, before it goes (v0.84): the pictures as they are, a document by its name and size — to whom, on which
 * job, a caption — and one button. Closed without sending: kept with the chat («📎 N» over the field opens it again).
 */
function FilesSheet({ files, to, job, opened, caption, onCaption, onClose, onSend, onDrop }: { files: Picked[]; to: string; job?: string; opened: boolean; caption: string; onCaption: (s: string) => void; onClose: () => void; onSend: () => void; onDrop: () => void }) {
  const { t } = useTranslation();
  const tooBig = files.some((f) => f.file.size > MAX_FILE_BYTES);
  return (
    <Modal opened={opened} onClose={onClose} title={t('wa.toWho', { name: to })}>
      <Stack gap="md" data-wa-files>
        {job && <Text size="sm" c="dimmed">{job}</Text>}
        <div className="wa-picked">
          {files.map((f, i) => {
            const size = fileSize(f.file.size);
            return f.url ? (
              <span key={i} className="wa-picked-pic" data-one={files.length === 1 || undefined}>
                <img src={f.url} alt="" />
              </span>
            ) : (
              <span key={i} className="wa-picked-doc" data-big={f.file.size > MAX_FILE_BYTES || undefined}>
                <IconFile size={20} stroke={1.8} aria-hidden />
                <span className="wa-doc-name">{f.file.name}</span>
                <span className="wa-doc-meta">{size ? `${size.n} ${t(`wa.unit.${size.unit}`)}` : ''}</span>
              </span>
            );
          })}
        </div>
        {tooBig && (
          <Text size="sm" c="red.6">
            {t('wa.err.tooBig')}
          </Text>
        )}
        <Textarea value={caption} onChange={(e) => onCaption(e.currentTarget.value)} placeholder={t('wa.caption')} aria-label={t('wa.caption')} autosize minRows={1} maxRows={5} />
        <Button fullWidth size="md" color="green" disabled={tooBig} leftSection={<IconSend size={20} stroke={2.2} />} onClick={onSend} data-wa-files-send>
          {t('wa.sendN', { count: files.length })}
        </Button>
        <Button fullWidth variant="subtle" color="red" onClick={onDrop} data-wa-files-drop>
          {t('wa.dropFiles')}
        </Button>
      </Stack>
    </Modal>
  );
}

/* ---------- The microphone (v0.81, v0.84) ---------- */

/** Slid this far to the left while held: the recording is thrown away. */
const CANCEL_PX = 100;
/** Slid this far up while held: locked — it records on without the finger. */
const LOCK_PX = 70;
/** Shorter than this: no voice message (a tap, not a hold) — the hint instead. */
const SHORTEST_S = 0.6;
/** A recording stopped by something else is offered back only if it says something. */
const KEEP_S = 1;

/**
 * The microphone's own little bars while it records (v0.84, «индикатор сигнала»): the level of the last moments, read from
 * the microphone itself; drawn straight into the page, a few times a second — not React, not every frame.
 */
function LiveBars({ stream, n = 28 }: { stream: () => MediaStream | null; n?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const s = stream();
    const el = box.current;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!s || !el || !AC) return undefined;
    let ctx: AudioContext;
    try {
      ctx = new AC();
    } catch {
      return undefined;
    }
    const src = ctx.createMediaStreamSource(s);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    const levels = Array.from({ length: n }, () => 0.06);
    const bars = [...el.children] as HTMLElement[];
    let peak = 0;
    let last = 0;
    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      peak = Math.max(peak, Math.sqrt(sum / buf.length));
      if (now - last < 90) return;
      last = now;
      levels.shift();
      levels.push(Math.min(1, 0.06 + peak * 3.2));
      peak = 0;
      for (let i = 0; i < bars.length; i++) bars[i].style.transform = `scaleY(${levels[i].toFixed(3)})`;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      src.disconnect();
      void ctx.close().catch(() => undefined);
    };
  }, [stream, n]);
  return (
    <span className="wa-live" ref={box} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

type MicPhase = 'idle' | 'hold' | 'locked';
type Note = 'hint' | 'denied' | 'interrupted' | 'allowed' | null;

/**
 * The chat's microphone (v0.81; v0.84, the brief: «удержание микрофона начинает запись, отпускание отправляет… таймер и
 * индикатор сигнала… отменить до отправки… запись и отправка отдельными нажатиями… при звонке, сворачивании, смене чата
 * или потере доступа — без случайной отправки; пригодную запись — прослушать, отправить или удалить»):
 * held — it records (the red dot, the seconds, «‹ отмена»); let go — sent; slid left — thrown away; slid up — locked: it
 * records on, «■» stops it to be listened to, ➤ sends it, 🗑 throws it away. A keyboard (Enter) or «Записать» under the
 * hint starts it locked at once. The app put away, a call, the microphone lost, another chat opened — it stops and its
 * chat keeps it («Прослушать · Отправить · Удалить»), a moment's recording is only said to be interrupted.
 */
function useMic(chatId: string, answering: () => WaMessage | undefined, onSent: () => void, say: (e: unknown) => void) {
  const rec = useRecorder({ keep: true });
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [slide, setSlide] = useState({ x: 0, y: 0 });
  const [note, setNote] = useState<Note>(null);
  const [asking, setAsking] = useState(false);
  // The gesture now: where it began, and what its recording is for when it ends.
  const g = useRef<{ x0: number; y0: number; mode: 'send' | 'cancel' | 'keep' | 'stopped' | null; locked: boolean; began: number } | null>(null);
  const dropOnStart = useRef(false);
  const noteTimer = useRef<number>();
  const showNote = useCallback((n: Note, ms = 4000) => {
    window.clearTimeout(noteTimer.current);
    setNote(n);
    if (n && ms) noteTimer.current = window.setTimeout(() => setNote(null), ms);
  }, []);
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);

  const finish = (mode: 'send' | 'cancel' | 'keep' | 'stopped') => {
    const cur = g.current;
    if (!cur) return;
    cur.mode = mode;
    g.current = null;
    setPhase('idle');
    setSlide({ x: 0, y: 0 });
    if (rec.recording) {
      if (mode === 'cancel') rec.cancel();
      else rec.stop();
    } else {
      // Not begun yet (the microphone still being asked for): what begins is thrown away.
      dropOnStart.current = true;
    }
  };
  // Let go before the recording began: stopped as soon as it begins.
  useEffect(() => {
    if (rec.recording && dropOnStart.current) {
      dropOnStart.current = false;
      rec.cancel();
    }
  }, [rec.recording, rec]);

  const start = (locked: boolean, x = 0, y = 0) => {
    if (g.current) return;
    const cur = { x0: x, y0: y, mode: null as 'send' | 'cancel' | 'keep' | 'stopped' | null, locked, began: performance.now() };
    g.current = cur;
    dropOnStart.current = false;
    setSlide({ x: 0, y: 0 });
    setPhase(locked ? 'locked' : 'hold');
    showNote(null);
    haptic('light');
    const askedAt = window.setTimeout(() => setAsking(true), 250);
    void rec
      .start()
      .then((r) => {
        if (!r) return;
        const mode = cur.mode;
        if (mode === 'cancel' || mode === null) return;
        if (mode === 'send') {
          if (r.seconds < SHORTEST_S) {
            showNote('hint');
            return;
          }
          haptic('success');
          const q = answering();
          void sendWaVoice(chatId, r.blob, r.seconds, q).catch(say);
          onSent();
          return;
        }
        // Kept for its chat: stopped by hand (to listen first), or by something else.
        if (mode === 'keep' && r.seconds < KEEP_S) {
          showNote('interrupted');
          return;
        }
        setWaVoiceDraft(chatId, { blob: r.blob, seconds: r.seconds, url: URL.createObjectURL(r.blob), how: mode === 'stopped' ? 'stopped' : 'interrupted' });
      })
      .catch((err: unknown) => {
        g.current = null;
        setPhase('idle');
        const name = (err as Error)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') showNote('denied', 6000);
        else say(err);
      })
      .finally(() => {
        window.clearTimeout(askedAt);
        setAsking(false);
      });
    // Asked for the first time, let go while the phone asked: the next hold records.
    void navigator.permissions?.query?.({ name: 'microphone' as PermissionName }).then(
      (p) => {
        if (p.state === 'prompt')
          p.onchange = () => {
            if (p.state === 'granted' && !g.current) showNote('allowed');
          };
      },
      () => undefined,
    );
  };

  // Interrupted (the app put away, the microphone taken by a call): stopped, kept for its chat — never sent by itself.
  useEffect(() => {
    if (phase === 'idle') return undefined;
    const away = () => document.visibilityState === 'hidden' && finish('keep');
    document.addEventListener('visibilitychange', away);
    const track = rec.recording ? rec.stream()?.getAudioTracks()[0] : undefined;
    const lost = () => finish('keep');
    track?.addEventListener('ended', lost);
    return () => {
      document.removeEventListener('visibilitychange', away);
      track?.removeEventListener('ended', lost);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, rec.recording]);
  // Another chat opened, the screen left: the same.
  useEffect(
    () => () => {
      if (g.current) g.current.mode = 'keep';
    },
    [],
  );

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || g.current) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // the finger is followed all the same
      }
      start(false, e.clientX, e.clientY);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const cur = g.current;
      if (!cur || cur.locked) return;
      const dx = Math.min(0, e.clientX - cur.x0);
      const dy = Math.min(0, e.clientY - cur.y0);
      setSlide({ x: dx, y: dy });
      if (dx < -CANCEL_PX) {
        haptic('warning');
        finish('cancel');
      } else if (dy < -LOCK_PX) {
        cur.locked = true;
        haptic('success');
        setPhase('locked');
        setSlide({ x: 0, y: 0 });
      }
    },
    onPointerUp: () => {
      const cur = g.current;
      if (!cur || cur.locked) return;
      // A tap, not a hold: nothing recorded — how to (and «Записать» for one who cannot hold).
      if (performance.now() - cur.began < 350 && rec.seconds < 1) {
        finish('cancel');
        showNote('hint');
        return;
      }
      finish('send');
    },
    // The phone took the touch (a call, a system sheet): kept, not sent.
    onPointerCancel: () => {
      const cur = g.current;
      if (cur && !cur.locked) finish('keep');
    },
    onClick: (e: React.MouseEvent) => {
      // A keyboard's Enter or a screen reader's double tap (no pointer): locked at once — record, then «Отправить».
      if (e.detail === 0 && !g.current) start(true);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
  return {
    phase,
    seconds: rec.seconds,
    recording: rec.recording,
    asking,
    slide,
    note,
    showNote,
    stream: rec.stream,
    handlers,
    startLocked: () => start(true),
    send: () => finish('send'),
    stop: () => finish('stopped'),
    cancel: () => finish('cancel'),
  };
}

/** A recording stopped before it went: listened to, sent or thrown away (v0.84). */
function VoiceReview({ chatId, v, onSend }: { chatId: string; v: VoiceDraft; onSend: () => void }) {
  const { t } = useTranslation();
  const m = useMemo<WaMessage>(() => ({ id: `draft:${v.url}`, chat: chatId, t: 0, me: true, type: 'ptt', text: '', ack: 0, local: v.url, file: { here: true, sec: Math.max(1, Math.round(v.seconds)), mime: v.blob.type } }), [chatId, v]);
  return (
    <div className="wa-voice-review" data-wa-voice-review>
      {v.how === 'interrupted' && <span className="wa-voice-review-note">{t('wa.voice.interrupted')}</span>}
      <div className="wa-voice-review-row">
        <button type="button" className="wa-icon-btn tap" data-red aria-label={t('common.delete')} onClick={() => setWaVoiceDraft(chatId, null)} data-wa-voice-drop>
          <IconTrash size={22} stroke={1.9} />
        </button>
        <div className="wa-voice-review-player">
          <Sound m={m} />
        </div>
        <button type="button" className="wa-send-btn tap" aria-label={t('wa.send')} onClick={onSend} data-wa-voice-send>
          <IconSend size={20} stroke={2.2} />
        </button>
      </div>
    </div>
  );
}

/* ---------- The bottom: «＋», the words, the camera, the microphone ---------- */

interface ComposerProps {
  chatId: string;
  title: string;
  job?: string;
  reply: WaMessage | null;
  replyName: string;
  onReplyDone: () => void;
  onSent: () => void;
  field: React.RefObject<HTMLTextAreaElement>;
  quick?: QuickFor;
  desk: boolean;
}

function Composer({ chatId, title, job, reply, replyName, onReplyDone, onSent, field, quick, desk }: ComposerProps) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [text, setTextState] = useState(() => waDraft(chatId));
  const kept = pickedDrafts.get(chatId);
  const [picked, setPicked] = useState<Picked[] | null>(null);
  const [caption, setCaption] = useState(kept?.caption ?? '');
  const [keptN, setKeptN] = useState(kept?.files.length ?? 0);
  const voice = useWaSel((s) => waVoiceDraft(chatId, s));
  // «＋» of a customer's chat (v0.80): what can be done for them at once; anyone else's — a file, as before.
  const [quickAt, setQuickAt] = useState<{ x: number; y: number } | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const setText = (v: string) => {
    setTextState(v);
    setWaDraft(chatId, v);
  };
  const say = useCallback(
    (e: unknown) => {
      haptic('error');
      // A message in the chat says itself why it did not go (v0.84): a toast only for what never got into it.
      if (inChat(e)) return;
      notifications.show({ color: 'red', message: errorText(e) });
    },
    [errorText],
  );
  const replyRef = useRef(reply);
  replyRef.current = reply;
  const takeReply = () => {
    const q = replyRef.current ?? undefined;
    if (q) onReplyDone();
    return q;
  };
  const send = () => {
    const words = text.trim();
    if (!words) return;
    // Gone from the field at once: the message is in the chat, on its way (waiting for the network if there is none).
    setText('');
    const answered = takeReply();
    haptic('light');
    void sendWaText(chatId, words, answered, { queue: true }).catch(say);
    onSent();
    field.current?.focus();
  };
  const mic = useMic(chatId, takeReply, onSent, say);
  const sendDraftVoice = () => {
    if (!voice) return;
    const v = voice;
    setWaVoiceDraft(chatId, null);
    haptic('success');
    void sendWaVoice(chatId, v.blob, v.seconds, takeReply()).catch(say);
    onSent();
  };
  const pick = (list: File[]) => {
    if (!list.length) return;
    const was = pickedDrafts.get(chatId)?.files ?? [];
    const files = [...was, ...list.map((file) => ({ file, url: sendKind(file) === 'photo' ? URL.createObjectURL(file) : undefined }))];
    pickedDrafts.set(chatId, { files, caption });
    setKeptN(files.length);
    setPicked(files);
  };
  // Closed without sending: kept with the chat (the field's «📎 N» opens it again).
  const closePicked = () => {
    if (picked) pickedDrafts.set(chatId, { files: picked, caption });
    setPicked(null);
  };
  const dropPicked = () => {
    (picked ?? pickedDrafts.get(chatId)?.files ?? []).forEach((p) => p.url && URL.revokeObjectURL(p.url));
    pickedDrafts.delete(chatId);
    setKeptN(0);
    setCaption('');
    setPicked(null);
  };
  const sendFiles = () => {
    const list = picked ?? [];
    const words = caption;
    const answered = takeReply();
    pickedDrafts.delete(chatId);
    setKeptN(0);
    setCaption('');
    setPicked(null);
    haptic('light');
    window.setTimeout(() => list.forEach((p) => p.url && URL.revokeObjectURL(p.url)), 1500);
    // One after another, in the order picked; the caption — and the answer — with the first.
    let before: Promise<unknown> | undefined;
    list.forEach((p, i) => {
      const going = sendWaFile(chatId, p.file, { name: p.file.name || 'file', caption: i === 0 ? words : '', quote: i === 0 ? answered : undefined, queue: true, after: before });
      going.catch(say);
      before = going;
    });
    onSent();
  };
  const input = (ref: React.RefObject<HTMLInputElement>, attrs: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      ref={ref}
      type="file"
      hidden
      {...attrs}
      onChange={(e) => {
        const list = [...(e.currentTarget.files ?? [])];
        e.currentTarget.value = '';
        pick(list);
      }}
    />
  );
  const typed = !!text.trim();
  const holding = mic.phase === 'hold';
  const locked = mic.phase === 'locked';
  const noteText = mic.note === 'hint' ? t('wa.voice.hold') : mic.note === 'denied' ? t('wa.voice.denied') : mic.note === 'interrupted' ? t('wa.voice.interrupted') : mic.note === 'allowed' ? t('wa.voice.allowed') : '';

  return (
    <div className="wa-composer" data-wa-composer-box>
      {reply && (
        <div className="wa-replying" role="group" aria-label={t('wa.reply')} data-wa-replying>
          <span className="wa-replying-body" style={{ '--qc': reply.me ? 'var(--wa-quote-me)' : 'var(--wa-quote-other)' } as React.CSSProperties}>
            <span className="wa-quote-who">{reply.me ? t('wa.you') : replyName}</span>
            <span className="wa-quote-line">{reply.text || t(`wa.kind.${kindOf(reply.type)}`)}</span>
          </span>
          {reply.file?.thumb && <img className="wa-quote-thumb" src={thumbSrc(reply.file.thumb)} alt="" />}
          <button type="button" className="wa-icon-btn tap" aria-label={t('common.cancel')} onClick={onReplyDone}>
            <IconX size={20} stroke={2} />
          </button>
        </div>
      )}
      {keptN > 0 && !picked && (
        <div className="wa-kept-files">
          <button type="button" className="wa-kept-open tap" onClick={() => setPicked(pickedDrafts.get(chatId)?.files ?? null)} data-wa-kept>
            <IconPaperclip size={16} stroke={2} aria-hidden /> {t('wa.keptFiles', { count: keptN })}
          </button>
          <button type="button" className="wa-icon-btn tap" aria-label={t('common.delete')} onClick={dropPicked}>
            <IconX size={18} stroke={2} />
          </button>
        </div>
      )}
      {noteText && (
        <div className="wa-mic-note" role="status" data-wa-mic-note={mic.note}>
          <span>{noteText}</span>
          {mic.note === 'hint' && (
            <button type="button" className="wa-mic-note-btn tap" onClick={() => mic.startLocked()} data-wa-rec-start>
              {t('wa.voice.start')}
            </button>
          )}
        </div>
      )}
      {voice && !locked && !holding ? (
        <VoiceReview chatId={chatId} v={voice} onSend={sendDraftVoice} />
      ) : locked ? (
        // Locked (v0.84): it records on without the finger — the seconds and the signal; 🗑 · ■ (to listen first) · ➤.
        <div className="wa-rec-locked" data-wa-rec-locked>
          <div className="wa-rec-locked-top">
            <span className="wa-rec-dot" aria-hidden />
            <span className="wa-rec-time tnum" role="timer" aria-live="off">
              {mic.asking && !mic.recording ? t('wa.voice.asking') : clock(mic.seconds)}
            </span>
            {mic.recording && <LiveBars stream={mic.stream} />}
          </div>
          <div className="wa-rec-locked-row">
            <button type="button" className="wa-icon-btn tap" data-red aria-label={t('common.delete')} onClick={() => mic.cancel()} data-wa-rec-drop>
              <IconTrash size={24} stroke={1.9} />
            </button>
            <button type="button" className="wa-rec-stop tap" aria-label={t('wa.voice.stop')} onClick={() => mic.stop()} disabled={!mic.recording} data-wa-rec-stop>
              <IconPlayerStopFilled size={18} />
            </button>
            <button type="button" className="wa-send-btn tap" aria-label={t('wa.send')} onClick={() => mic.send()} disabled={!mic.recording} data-wa-rec-send>
              <IconSend size={20} stroke={2.2} />
            </button>
          </div>
        </div>
      ) : (
        <div className="wa-input-row" data-wa-composer>
          <button
            type="button"
            className="wa-icon-btn tap"
            aria-label={t('wa.quick.title')}
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setQuickAt({ x: r.left, y: r.top - 4 });
            }}
            data-wa-plus
            hidden={holding}
          >
            <IconPlus size={26} stroke={1.8} />
          </button>
          {holding ? (
            // Held (v0.81): in the field's place — the red dot and the seconds; slide left to throw it away, up to lock.
            <div className="wa-rec" role="status" aria-live="polite" data-wa-rec>
              <span className="wa-rec-dot" aria-hidden />
              <span className="wa-rec-time tnum">{mic.asking && !mic.recording ? t('wa.voice.asking') : clock(mic.seconds)}</span>
              <span className="wa-rec-cancel" style={{ transform: `translateX(${Math.max(-CANCEL_PX, mic.slide.x)}px)`, opacity: 1 - Math.min(1, -mic.slide.x / CANCEL_PX) * 0.7 }}>
                <IconChevronLeft size={16} stroke={2.2} aria-hidden /> {t('wa.voice.slide')}
              </span>
            </div>
          ) : (
            <div className="wa-input">
              <Textarea
                ref={field}
                aria-label={t('wa.message')}
                placeholder={t('wa.message')}
                autosize
                minRows={1}
                maxRows={4}
                value={text}
                onChange={(e) => setText(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (fineMouse() && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                    e.preventDefault();
                    send();
                  }
                }}
                onPaste={(e) => {
                  // A screenshot pasted on a PC is a photo to send.
                  const list = [...(e.clipboardData?.files ?? [])];
                  if (list.length) {
                    e.preventDefault();
                    pick(list);
                  }
                }}
                data-wa-field
              />
            </div>
          )}
          {typed ? (
            <button type="button" className="wa-send-btn tap" aria-label={t('wa.send')} onClick={send} data-wa-send>
              <IconSend size={20} stroke={2.2} />
            </button>
          ) : (
            <>
              {!holding && (
                <button type="button" className="wa-icon-btn tap" aria-label={t('wa.camera')} onClick={() => camera.current?.click()} data-wa-camera>
                  <IconCamera size={25} stroke={1.8} />
                </button>
              )}
              {/* The microphone: held — it records; let go — sent; slid left — thrown away; up — locked. */}
              {canRecord() && (
                <span className="wa-mic-wrap">
                  {holding && (
                    <span className="wa-lock" style={{ transform: `translateY(${Math.max(-LOCK_PX, mic.slide.y)}px)` }} aria-hidden>
                      <IconLock size={18} stroke={2} />
                      <IconChevronUp size={16} stroke={2.2} />
                    </span>
                  )}
                  <button type="button" className="wa-mic" data-rec={holding || undefined} aria-label={t('wa.voice.mic')} {...mic.handlers} data-wa-mic>
                    <IconMicrophone size={25} stroke={1.8} />
                  </button>
                </span>
              )}
            </>
          )}
        </div>
      )}
      {input(gallery, { multiple: true, 'data-wa-file': '' } as React.InputHTMLAttributes<HTMLInputElement>)}
      {input(camera, { accept: 'image/*', capture: 'environment' })}
      <SheetFor value={picked}>
        {(list, o) => (
          <FilesSheet
            files={list}
            to={title}
            job={job}
            opened={o}
            caption={caption}
            onCaption={(c) => {
              setCaption(c);
              const k = pickedDrafts.get(chatId);
              if (k) k.caption = c;
            }}
            onClose={closePicked}
            onSend={sendFiles}
            onDrop={dropPicked}
          />
        )}
      </SheetFor>
      {/* «＋» (v0.80.3): a customer's chat — their jobs; any other — any job found, and files as ever. */}
      <ChatQuick chatId={chatId} quick={quick ?? {}} desk={desk} at={quickAt} opened={!!quickAt} onClose={() => setQuickAt(null)} onFiles={() => gallery.current?.click()} />
    </div>
  );
}

/* ---------- A message lifted with its menu (v0.84) ---------- */

/**
 * A long press on a phone (v0.84, «удержание сообщения открывает меню рядом с ним»): the chat dims, the message lifts where
 * it was (moved only as far as needed to fit its menu on the screen) and its menu stands under it — «Ответить»,
 * «Скопировать», «Переслать»… as the iPhone's menus are: the words on the left, the symbol on the right. A tap outside,
 * «Назад» or Escape put it down.
 */
function MessageFocus({ el, me, items, onClose }: { el: HTMLElement; me: boolean; items: DeskMenuItem[]; onClose: () => void }) {
  const release = useHistoryLayer('mgWaMenu', onClose);
  const close = useCallback(() => {
    release();
    onClose();
  }, [release, onClose]);
  const msg = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; width: number; shift: number; menuTop: number; max?: number } | null>(null);
  useLayoutEffect(() => {
    const box = msg.current;
    const m = menu.current;
    if (!box || !m) return;
    const r = el.getBoundingClientRect();
    const copy = el.cloneNode(true) as HTMLElement;
    copy.removeAttribute('data-wa-id');
    copy.removeAttribute('data-flash');
    copy.querySelectorAll('[style*="transform"]').forEach((x) => ((x as HTMLElement).style.transform = ''));
    box.replaceChildren(copy);
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const topSafe = 56;
    // Its own height, not as drawn now: it comes in from 0.6 of its size (wa-menu-in) — measured so, a message low on the
    // screen was lifted too little and its menu went off the bottom (#61, 25/11).
    const menuH = m.offsetHeight;
    const max = Math.max(120, vh * 0.5);
    const h = Math.min(r.height, max);
    let top = r.top;
    if (top + h + 10 + menuH > vh - 24) top = vh - 24 - menuH - 10 - h;
    if (top < topSafe) top = topSafe;
    setPlace({ top, left: r.left, width: r.width, shift: top - r.top, menuTop: top + h + 10, max: r.height > max ? max : undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [close]);
  return createPortal(
    <div className="wa-focus" onClick={close} data-wa-focus>
      <div className="wa-focus-shade" aria-hidden />
      <div className="wa-chat wa-focus-msg" ref={msg} aria-hidden style={place ? ({ top: place.top, left: place.left, width: place.width, maxHeight: place.max, '--shift': `${place.shift}px` } as React.CSSProperties) : { visibility: 'hidden' }} />
      <div
        className="wa-focus-menu"
        ref={menu}
        role="menu"
        data-me={me || undefined}
        data-wa-menu
        style={place ? (me ? { top: place.menuTop, right: Math.max(12, window.innerWidth - place.left - place.width + 4) } : { top: place.menuTop, left: Math.max(12, place.left + 4) }) : { visibility: 'hidden', top: 0, left: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((a) => (
          <button
            key={a.key}
            type="button"
            role="menuitem"
            className="wa-focus-item"
            data-red={a.color === 'red' || undefined}
            data-wa-menu-item={a.key}
            onClick={() => {
              close();
              a.onClick();
            }}
          >
            <span>{a.label}</span>
            {a.icon && <a.icon size={21} stroke={1.8} aria-hidden />}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- The chat ---------- */

/** Where the chat scrolls: the phone screen's own scroll view, or the pane of the PC's window. */
function useScroller(pane: React.RefObject<HTMLDivElement>) {
  const screen = useScreen();
  return useCallback(() => screen?.scroller.current ?? pane.current, [screen, pane]);
}

export function ChatThread({
  chatId,
  title,
  group,
  people,
  desk,
  quick,
  who,
  phone,
  job,
  top: head,
}: {
  chatId: string;
  title: string;
  group: boolean;
  people: Map<string, Who>;
  desk: boolean;
  /** Whose chat it is, for «＋»'s quick actions (v0.80). */ quick?: QuickFor;
  /** Who the chat is with, and their number: a customer's message forwarded says whose it is (v0.80.3). */ who?: Who;
  phone?: string;
  /** The job the chat is opened on (v0.84): said in a file's preview. */ job?: string;
  /** Over the messages, in the pane (a PC's chat head). */ top?: ReactNode;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  // Only this chat's part of the store (v0.80.2): a message in another chat does not draw this one again.
  const prefs = useWaPrefs();
  const screen = useScreen();
  const ready = useWaSel(waReady);
  const list = useWaSel((s) => s.messages[chatId]);
  const meta = useWaSel((s) => s.meta[chatId]);
  const unread = useWaSel((s) => s.chats.find((c) => c.id === chatId)?.unread ?? 0);
  const pane = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useScroller(pane);
  // The message being answered — the chat's own (v0.84): it stays with it when another job or chat is opened meanwhile.
  const [reply, setReplyState] = useState<WaMessage | null>(() => waReplyOf(chatId));
  const setReply = useCallback(
    (m: WaMessage | null) => {
      setReplyState(m);
      setWaReply(chatId, m);
    },
    [chatId],
  );
  const [menu, setMenu] = useState<{ m: WaMessage; at?: { x: number; y: number }; el?: HTMLElement } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [film, setFilm] = useState<{ el: HTMLVideoElement; m: WaMessage } | null>(null);
  const [down, setDown] = useState(false);
  // The newest message when the end went out of sight (v0.84): what came after it is counted on the way down.
  const [awayAt, setAwayAt] = useState<string | null>(null);
  const lastId = useRef<string | undefined>(undefined);
  // A message being forwarded: the chat it goes to is picked (v0.80.3).
  const [forwarding, setForwarding] = useState<WaMessage | null>(null);
  // «Удалить у всех» (v0.83): asked first — it cannot be taken back.
  const [delAll, setDelAll] = useState<WaMessage | null>(null);
  // How many waited when the chat was opened: «N непрочитанных» stays where they began until the chat is left.
  const [unreadAtOpen] = useState(unread);

  // Read when the chat is opened, and again when WhatsApp is back.
  useEffect(() => {
    if (ready) void loadMessages(chatId);
  }, [chatId, ready]);
  // On a screen (v0.87): read again after a gap — what WhatsApp said while this device did not hear it comes in.
  useEffect(() => showingChat(chatId), [chatId]);

  // Seen: the chat is in front, the app in sight — its unread goes, here and on the phone.
  useEffect(() => {
    if (!prefs.seen || !unread || !list) return;
    if (document.visibilityState !== 'visible' || (screen && !screen.front())) return;
    void seenWa(chatId);
  }, [chatId, unread, prefs.seen, list, screen]);

  // A phone (v0.84): the chat's wallpaper over the whole screen, the bar under it WhatsApp's; its height kept for the list.
  useLayoutEffect(() => {
    const el = screen?.scroller.current?.closest<HTMLElement>('.screen');
    if (!el || desk) return undefined;
    el.setAttribute('data-wa-wall', '');
    return () => el.removeAttribute('data-wa-wall');
  }, [screen, desk]);

  /* ----- Where the chat stands ----- */
  const atEnd = useRef(true);
  const toEnd = useCallback(
    (smooth: boolean) => {
      const el = scroller();
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
    },
    [scroller],
  );
  // The day of what is at the top, floating over the chat while it scrolls (v0.84, as WhatsApp): gone a moment after.
  const [float, setFloat] = useState<{ day: string; on: boolean }>({ day: '', on: false });
  const floatTimer = useRef<number>();
  useEffect(() => {
    const el = scroller();
    if (!el) return undefined;
    let frame = 0;
    const on = () => {
      frame = 0;
      const far = el.scrollHeight - el.scrollTop - el.clientHeight;
      const end = far < 140;
      if (end !== atEnd.current) setAwayAt(end ? null : (lastId.current ?? null));
      atEnd.current = end;
      setDown(far > 400);
      // Which day is under the top edge: the last day section that begins above it.
      const days = fill.current?.querySelectorAll<HTMLElement>('.wa-day');
      if (days?.length) {
        const edge = el.getBoundingClientRect().top + (screen ? screen.nav.getBoundingClientRect().height : 0) + 8;
        let day = '';
        for (const d of days) {
          if (d.getBoundingClientRect().top > edge) break;
          day = d.dataset.day ?? '';
        }
        // The day's own pill still in sight just under the edge: no floating one over it.
        const first = days[0].getBoundingClientRect().top > edge;
        setFloat((f) => (f.day === day && f.on === !first && !!day ? f : { day, on: !first && !!day }));
        window.clearTimeout(floatTimer.current);
        floatTimer.current = window.setTimeout(() => setFloat((f) => (f.on ? { ...f, on: false } : f)), 1200);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(on);
    };
    el.addEventListener('scroll', schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(floatTimer.current);
      el.removeEventListener('scroll', schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller, chatId]);
  // The bar's height (it grows with the words, a reply, a recording): the messages end just above it; at the end — kept there.
  useLayoutEffect(() => {
    const b = bottom.current?.closest<HTMLElement>('.sticky-bar') ?? bottom.current;
    const sc = screen?.scroller.current?.closest<HTMLElement>('.screen');
    if (!b || !sc || desk) return undefined;
    const ro = new ResizeObserver(() => {
      sc.style.setProperty('--wa-foot', `${Math.ceil(b.getBoundingClientRect().height)}px`);
      if (atEnd.current) toEnd(false);
    });
    ro.observe(b);
    return () => {
      ro.disconnect();
      sc.style.removeProperty('--wa-foot');
    };
  }, [screen, desk, toEnd, ready]);
  // On a phone the chat reaches down to the composer: a few messages sit just above it (as in a messenger).
  useLayoutEffect(() => {
    const el = fill.current;
    const sc = screen?.scroller.current;
    if (!el || !sc) return undefined;
    const update = () => {
      const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      const body = el.closest('.screen-body');
      const below = body ? parseFloat(getComputedStyle(body).paddingBottom) || 0 : 120;
      el.style.minHeight = `${Math.max(0, Math.floor(sc.clientHeight - top - below))}px`;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(sc);
    return () => ro.disconnect();
  }, [screen, chatId]);
  // Opened: at the first unread (its line near the top), else at the newest. A new message: brought into sight if the end
  // was in sight, or it is one's own; otherwise counted on the way down. Older ones put on top: what was in sight stays.
  const seen = useRef<{ chat: string; first?: string; last?: string; height: number }>({ chat: '', height: 0 });
  const [whole, setWhole] = useState(false);
  const hasList = !!list;
  useEffect(() => {
    if (!hasList || whole) return undefined;
    let frame = requestAnimationFrame(() => {
      frame = window.setTimeout(() => setWhole(true), 0) as unknown as number;
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(frame);
    };
  }, [hasList, whole]);
  const shown = useMemo(() => (!list || whole || list.length <= FIRST_ROWS || unreadAtOpen >= FIRST_ROWS - 2 ? list : list.slice(-FIRST_ROWS)), [list, whole, unreadAtOpen]);
  const firstId = shown?.[0]?.id;
  const last = shown?.[shown.length - 1];
  lastId.current = last?.id;
  const fresh = useMemo(() => {
    if (!awayAt || !list) return 0;
    const at = list.findIndex((m) => m.id === awayAt);
    return at < 0 ? 0 : list.slice(at + 1).filter((m) => !m.me).length;
  }, [awayAt, list]);
  useLayoutEffect(() => {
    const el = scroller();
    if (!el || !list) return;
    const was = seen.current;
    if (was.chat !== chatId || !was.last) {
      const line = fill.current?.querySelector<HTMLElement>('[data-wa-unread-line]');
      if (line) {
        const navH = screen ? screen.nav.getBoundingClientRect().height : 0;
        el.scrollTop += line.getBoundingClientRect().top - el.getBoundingClientRect().top - navH - 56;
        const far = el.scrollHeight - el.scrollTop - el.clientHeight;
        atEnd.current = far < 140;
      } else toEnd(false);
    } else if (last && last.id !== was.last) {
      if (atEnd.current || last.me) toEnd(was.chat === chatId);
    } else if (firstId !== was.first) el.scrollTop += el.scrollHeight - was.height;
    seen.current = { chat: chatId, first: firstId, last: last?.id, height: el.scrollHeight };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, firstId, last?.id, shown?.length]);

  // At the end, it stays at the end (v0.84): whatever grows there — a picture coming in, «Ошибка отправки» under a message.
  useEffect(() => {
    const el = fill.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let h = el.getBoundingClientRect().height;
    const ro = new ResizeObserver((entries) => {
      const now = entries[0]?.contentRect.height ?? h;
      if (now > h && atEnd.current) toEnd(false);
      h = now;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [toEnd, chatId]);

  // Older messages: asked for when the top comes near.
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = top.current;
    if (!el || !meta?.more || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && !atEnd.current && void moreMessages(chatId), { root: desk ? pane.current : (screen?.scroller.current ?? null), rootMargin: '300px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [chatId, meta?.more, meta?.limit, desk, screen]);

  /* ----- What a message does ----- */
  const onReply = useCallback(
    (m: WaMessage) => {
      setReply(m);
      field.current?.focus();
    },
    [setReply],
  );
  const onMenu = useCallback((m: WaMessage, at?: { x: number; y: number }, el?: HTMLElement) => setMenu({ m, at, el }), []);
  const onPhoto = useCallback((m: WaMessage) => setViewing(m.id), []);
  const onVideo = useCallback((m: WaMessage, url: string) => setFilm({ el: startVideo(url), m }), []);
  const fileOf = useCallback(
    async (m: WaMessage) => {
      const f = await waFileBlob(m).catch(() => undefined);
      if (!f) notifications.show({ color: 'orange', message: t('wa.fileGone') });
      return f;
    },
    [t],
  );
  const onDoc = useCallback(
    (m: WaMessage) => {
      // A PDF — in the app's own viewer (v0.90), shown at once and filled when the file is here; a picture on a PC opens
      // beside the app; anything else is handed over (the phone's share sheet) or saved.
      if (/pdf/i.test(m.file?.mime ?? '') || /\.pdf$/i.test(m.file?.name ?? '')) {
        showPdf(fileOf(m).then((f) => (f ? { blob: f, filename: f.name || 'document.pdf' } : undefined)), m.file?.name?.replace(/\.pdf$/i, ''));
        return;
      }
      const src = waFileSrc(m.id);
      if (desk && src && /^image\//.test(m.file?.mime ?? '')) {
        window.open(src, '_blank', 'noopener');
        return;
      }
      void fileOf(m).then((f) => f && (desk ? downloadFile(f) : shareOrDownload(f)));
    },
    [desk, fileOf],
  );
  const onQuote = useCallback((id: string) => {
    const row = [...(fill.current?.querySelectorAll<HTMLElement>('[data-wa-id]') ?? [])].find((el) => el.dataset.waId?.endsWith(`_${id}`) || el.dataset.waId === id);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row.removeAttribute('data-flash');
    void row.offsetWidth;
    row.setAttribute('data-flash', '');
    window.setTimeout(() => row.removeAttribute('data-flash'), 1300);
  }, []);
  const onAgain = useCallback(
    (m: WaMessage) => {
      // Not sent: the same message once more, under the same key — it does not go twice.
      haptic('light');
      void retryWa(chatId, m.id)?.catch((e) => notifications.show({ color: 'red', message: errorText(e) }));
    },
    [chatId, errorText],
  );
  const onDrop = useCallback((m: WaMessage) => dropFailed(chatId, m.id), [chatId]);
  const onCard = useCallback((ph: string) => window.dispatchEvent(new CustomEvent('mg-wa-open', { detail: ph })), []);

  const photos = useMemo(() => (list ?? []).filter((m) => kindOf(m.type) === 'photo' && (m.local || waFileSrc(m.id))), [list]);
  const days = useMemo(() => groupDays(shown ?? []), [shown]);
  // Where the unread begin, as they were when the chat was opened.
  const unreadFrom = useMemo(() => {
    if (!list || !unreadAtOpen) return undefined;
    const i = firstUnread(list, unreadAtOpen);
    return i >= 0 ? list[i].id : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!list, unreadAtOpen]);
  const nameOf = useCallback((m: WaMessage) => (m.from ? (m.from.phone && people.get(m.from.phone)?.name) || m.from.name || (m.from.phone ? `+${m.from.phone}` : '') : ''), [people]);
  const otherName = group ? '' : title;

  const actions = (m: WaMessage): DeskMenuItem[] => {
    const hasFile = !!m.file && !m.pending;
    return [
      ...(!m.pending && !m.failed ? [{ key: 'reply', label: t('wa.reply'), icon: IconArrowBackUp, onClick: () => onReply(m) }] : []),
      ...(m.text ? [{ key: 'copy', label: t('wa.copy'), icon: IconCopy, onClick: () => void copyText(m.text).then((ok) => ok && notifications.show({ color: 'green', message: t('common.copied') })) }] : []),
      ...(!m.pending && !m.failed ? [{ key: 'forward', label: t('wa.forward'), icon: IconArrowForwardUp, onClick: () => setForwarding(m) }] : []),
      ...(hasFile ? [{ key: 'file', label: t(desk ? 'wa.save' : 'wa.share'), icon: desk ? IconDownload : IconShare2, onClick: () => void fileOf(m).then((f) => f && (desk ? downloadFile(f) : shareOrDownload(f))) }] : []),
      ...(m.failed && canRetryWa(m.id) ? [{ key: 'retry', label: t('wa.retry'), icon: IconRefresh, onClick: () => onAgain(m) }] : []),
      ...(m.failed || m.queued ? [{ key: 'drop', label: t('common.delete'), icon: IconTrash, color: 'red', onClick: () => dropFailed(chatId, m.id) }] : []),
      // Ours, on WhatsApp, not taken back yet (v0.83): for everyone — while WhatsApp allows it (the server asks it).
      ...(m.me && !m.pending && !m.failed && kindOf(m.type) !== 'gone' ? [{ key: 'delAll', label: t('wa.delAll.action'), icon: IconTrash, color: 'red', onClick: () => setDelAll(m) }] : []),
    ];
  };

  const body = !list ? (
    <div className="notes-empty">{meta?.failed ? <Button variant="light" onClick={() => void loadMessages(chatId)}>{t('wa.gate.retry')}</Button> : <Loader size="sm" />}</div>
  ) : list.length === 0 ? (
    <div className="notes-empty">
      <span className="wa-empty-chat">
        <IconMessage2 size={26} stroke={1.8} aria-hidden />
        {t('wa.noMessages')}
      </span>
    </div>
  ) : (
    <div className="notes-list wa-list" data-wa-list>
      <div ref={top} className="wa-top">
        {meta?.loading && list.length > 0 && <Loader size="xs" />}
      </div>
      {days.map(([day, msgs]) => {
        const head = dayHeading(day, lang);
        return (
          // A day: its date floats at the top while the day is in sight (v0.84).
          <section key={`d-${day}`} className="wa-day" data-day={head.word ? t(`common.${head.word}`) : head.text}>
            <div className="note-day wa-day-pill">
              <span>{head.word ? t(`common.${head.word}`) : head.text}</span>
            </div>
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const next = msgs[i + 1];
              const sameAsPrev = !!prev && prev.me === m.me && prev.from?.id === m.from?.id && m.t - prev.t <= RUN_MS;
              const sameAsNext = !!next && next.me === m.me && next.from?.id === m.from?.id && next.t - m.t <= RUN_MS;
              const bubble = (
                <Bubble
                  key={m.id}
                  m={m}
                  desk={desk}
                  gap={!!prev && (!sameAsPrev || m.id === unreadFrom)}
                  tail={!sameAsNext || next?.id === unreadFrom}
                  author={group && !m.me && !sameAsPrev ? nameOf(m) : undefined}
                  quoteName={otherName}
                  onPhoto={onPhoto}
                  onVideo={onVideo}
                  onDoc={onDoc}
                  onReply={onReply}
                  onMenu={onMenu}
                  onQuote={onQuote}
                  onAgain={onAgain}
                  onDrop={onDrop}
                  onCard={onCard}
                />
              );
              return m.id === unreadFrom
                ? [
                    <div key="unread-line" className="wa-unread-line" data-wa-unread-line>
                      <span>{t('wa.unreadLine', { count: unreadAtOpen })}</span>
                    </div>,
                    bubble,
                  ]
                : bubble;
            })}
          </section>
        );
      })}
    </div>
  );

  const replyName = reply ? (group ? nameOf(reply) : title) : '';
  const floating = float.day ? (
    <div className="wa-float-day" data-on={float.on || undefined} aria-hidden>
      <span>{float.day}</span>
    </div>
  ) : null;
  const composer = ready ? (
    <Composer
      chatId={chatId}
      title={title}
      job={job}
      reply={reply}
      replyName={replyName}
      onReplyDone={() => setReply(null)}
      onSent={() => window.setTimeout(() => toEnd(true), 30)}
      field={field}
      quick={quick}
      desk={desk}
    />
  ) : null;
  const jump = down ? (
    <button
      type="button"
      className="wa-jump tap"
      aria-label={fresh ? t('wa.newMessages', { count: fresh }) : t('wa.toEnd')}
      onClick={() => toEnd(true)}
      data-wa-jump
    >
      <IconChevronDown size={24} stroke={2} />
      {(fresh > 0 || unread > 0) && <span className="wa-badge">{fresh || unread}</span>}
    </button>
  ) : null;

  return (
    <>
      {desk ? (
        // A PC: the chat is a pane of the window — its messages scroll in it, the composer stays at its foot. A file
        // dropped on it is a file to send.
        <div
          className="wa-pane"
          onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
          onDrop={(e) => {
            const dropped = [...e.dataTransfer.files];
            if (!dropped.length) return;
            e.preventDefault();
            const input = pane.current?.parentElement?.querySelector<HTMLInputElement>('[data-wa-file]');
            if (!input) return;
            const dt = new DataTransfer();
            dropped.forEach((f) => dt.items.add(f));
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }}
        >
          {head}
          {floating}
          <div className="wa-pane-scroll wa-wall" ref={pane}>
            <div className="notes-chat wa-chat" ref={fill} data-wa aria-label={title}>
              {body}
            </div>
          </div>
          <div className="wa-pane-foot wa-bottom" ref={bottom}>
            {jump}
            {composer}
          </div>
        </div>
      ) : (
        <>
          {head}
          {floating}
          <div className="notes-chat wa-chat" ref={fill} data-wa aria-label={title}>
            {body}
          </div>
          {composer && (
            <StickyBar>
              <div className="wa-bottom" ref={bottom}>
                {jump}
                {composer}
              </div>
            </StickyBar>
          )}
        </>
      )}
      {desk && <DeskMenu at={menu?.at ?? null} items={menu?.at ? actions(menu.m) : []} onClose={() => setMenu(null)} />}
      {menu?.el && !menu.at && <MessageFocus key={menu.m.id} el={menu.el} me={menu.m.me} items={actions(menu.m)} onClose={() => setMenu(null)} />}
      <ConfirmModal
        opened={!!delAll}
        onClose={() => setDelAll(null)}
        title={t('wa.delAll.title')}
        confirmLabel={t('wa.delAll.action')}
        color="red"
        onConfirm={async () => {
          const m = delAll;
          if (!m) return true;
          try {
            await deleteWaForAll(m);
            haptic('success');
            notifications.show({ color: 'green', message: t('wa.delAll.done') });
          } catch (e) {
            notifications.show({ color: 'red', message: errorText(e) });
          }
          return true;
        }}
      >
        <Text size="sm">{t('wa.delAll.text')}</Text>
      </ConfirmModal>
      {forwarding && (
        <ChatPicker
          opened={!!forwarding}
          onClose={() => setForwarding(null)}
          kind="person"
          title={t('wa.forwardTo')}
          onPick={(to) => {
            const m = forwarding;
            setForwarding(null);
            // A customer's message says whose it is (the chat's customer, or in a group the customer who wrote it).
            const from = m.me ? undefined : group ? (m.from?.phone ? people.get(m.from.phone) : undefined) : who;
            const fromPhone = group ? m.from?.phone : phone;
            void forwardNote(from?.kind === 'customer' ? { name: from.name, phone: fromPhone } : undefined)
              .then((note) => forwardWa(m, to.chat, note))
              .then(() => {
                haptic('success');
                notifications.show({ color: 'green', message: t('wa.forwarded2', { name: to.name }) });
              })
              .catch((e) => notifications.show({ color: 'red', message: errorText(e) }));
          }}
        />
      )}
      {film && <VideoPlayer video={film.el} file={() => waFileBlob(film.m)} onClose={() => setFilm(null)} />}
      {viewing && (
        <PhotoViewer
          items={photos.map((m) => ({ id: m.id, title: m.text, src: m.local ?? waFileSrc(m.id) }))}
          index={Math.max(0, photos.findIndex((m) => m.id === viewing))}
          onIndex={(i) => setViewing(photos[i]?.id ?? null)}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}
