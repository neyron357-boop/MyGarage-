import { ActionIcon, Button, Text, Textarea } from '@mantine/core';
import {
  IconArrowBackUp,
  IconArrowUp,
  IconCamera,
  IconCheck,
  IconCopy,
  IconMicrophone,
  IconNotes,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { dayHeading, dubaiDate, dubaiTime } from '../../domain/dates';
import type { JobNote } from '../../domain/types';
import { flatPeaks } from '../../domain/waveform';
import { cachedMediaUrl, mediaUrl } from '../../services/media';
import { addNote, removeNote, restoreNote, setNotePeaks, type RemovedNote } from '../../services/notes';
import { copyText } from '../../ui/clipboard';
import { MediaImage, StickyBar, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { useLongPress } from '../../ui/longPress';
import { useAutoAnimate } from '../../ui/motion';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { canRecord, clock, useRecorder } from '../../ui/recorder';
import { peaksOfBlob, rateLabel, savedVoiceRate, saveVoiceRate, voicePeaks, VOICE_RATES, type VoiceRate } from '../../ui/voice';
import { AppError } from '../../services/errors';
import { useScreen } from '../../ui/stack';
import { useSwipeReply } from '../../ui/swipeReply';

/** Notes this close in time read as one run: one tail, no gap between them. */
const RUN_MINUTES = 3;
const minutesApart = (a: JobNote, b: JobNote) => Math.abs(Date.parse(b.createdAt) - Date.parse(a.createdAt)) / 60_000;

/**
 * One player for all the voice notes on the screen, as in a messenger: a new one stops the one playing; pause
 * keeps the place and play goes on from it; the dot can be moved — on a note not started too (it then starts
 * there); the speed (1×, 1.5×, 2×) holds for the next ones; when one ends, the next voice note plays on.
 * The callbacks keep their identity (the bubbles are memo: only the one playing is drawn again).
 *
 * One audio element plays every note: an iPhone lets an element play on by itself (the next voice note) only
 * once a tap has started that element — a new element for the next one would stay silent. What the element does
 * by itself is followed too: headphones out, a call or the lock screen pause it — the bubble shows ▶.
 */
function usePlayer(list: JobNote[]) {
  const audio = useRef<HTMLAudioElement | null>(null);
  /** Whose recording the element holds now: what it reports is that note's, not the one before. */
  const holds = useRef<string | null>(null);
  /** Playing by the user's word: only a note played to its end hands on to the next one. */
  const going = useRef(false);
  /** The latest start or move asked for: an older one whose recording is read late is dropped. */
  const asked = useRef(0);
  const alive = useRef(true);
  const [cur, setCur] = useState<{ id: string; playing: boolean } | null>(null);
  const [pos, setPos] = useState(0);
  const [rate, setRate] = useState<VoiceRate>(savedVoiceRate);
  const rateRef = useRef(rate);
  const curRef = useRef(cur);
  curRef.current = cur;
  const listRef = useRef(list);
  listRef.current = list;
  const screen = useScreen();
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      going.current = false;
      holds.current = null;
      const a = audio.current;
      if (!a) return;
      a.pause();
      // The recording is let go (an iPhone keeps a few media elements only).
      a.removeAttribute('src');
      a.load();
    };
  }, []);

  const api = useRef({
    /** The note's recording put in the element (the one before stops), at `at` seconds. */
    open(n: JobNote, url: string, at: number) {
      const a = (audio.current ??= new Audio());
      going.current = false;
      a.pause();
      holds.current = n.id;
      a.src = url;
      a.defaultPlaybackRate = rateRef.current;
      a.playbackRate = rateRef.current;
      a.onloadedmetadata = () => {
        if (holds.current !== n.id) return;
        // Some browsers set the speed back when the recording loads; a place set before it was read may be lost
        // (WebKit) — both are set again.
        a.playbackRate = rateRef.current;
        if (at > 0 && Math.abs(a.currentTime - at) > 0.25) a.currentTime = at;
      };
      // Before the recording is read this is where it will start (the spec's default playback start position).
      if (at > 0) a.currentTime = at;
      a.onplay = () => {
        if (holds.current !== n.id) return;
        going.current = true;
        setCur({ id: n.id, playing: true });
      };
      // Its own pause — headphones out, a call, the lock screen — as well as ours. The end is `onended`'s.
      a.onpause = () => {
        if (holds.current !== n.id || a.ended) return;
        going.current = false;
        setCur((c) => (c?.id === n.id ? { id: n.id, playing: false } : c));
      };
      a.ontimeupdate = () => {
        if (holds.current !== n.id) return;
        // The job went under another screen (a phone keeps it there): the voice stops — play goes on from here.
        if (!a.paused && screenRef.current && !screenRef.current.front()) {
          going.current = false;
          a.pause();
        }
        setPos(a.currentTime);
      };
      a.onended = () => {
        if (holds.current !== n.id) return;
        const played = going.current;
        going.current = false;
        if (!played) {
          // Its dot moved to the very end while it was paused: it stays there, nothing plays on.
          setPos(a.currentTime);
          setCur((c) => (c?.id === n.id ? { id: n.id, playing: false } : c));
          return;
        }
        holds.current = null;
        setCur(null);
        setPos(0);
        // Played to its end: the next voice message plays on (none when the note has left the chat).
        const l = listRef.current;
        const i = l.findIndex((x) => x.id === n.id);
        const next = i >= 0 ? l[i + 1] : undefined;
        if (next?.kind === 'voice' && next.mediaId) void api.current.start(next, 0);
      };
      setPos(at);
      return a;
    },
    play(n: JobNote, a: HTMLAudioElement) {
      // At its end: from the start again.
      if (a.ended || (Number.isFinite(a.duration) && a.duration > 0 && a.currentTime >= a.duration - 0.05)) a.currentTime = 0;
      going.current = true;
      setCur({ id: n.id, playing: true });
      a.play().catch(() => {
        going.current = false;
        setCur((c) => (c?.id === n.id ? { id: n.id, playing: false } : c));
      });
    },
    async start(n: JobNote, at: number) {
      if (!n.mediaId) return;
      const ask = ++asked.current;
      // An iPhone plays only right in the tap: the address made ahead (by the bubble) is used at once.
      const url = cachedMediaUrl(n.mediaId) ?? (await mediaUrl(n.mediaId));
      // A later tap (or the chat gone) while the recording was being read: this one is over.
      if (!url || ask !== asked.current || !alive.current) return;
      api.current.play(n, api.current.open(n, url, at));
    },
    toggle(n: JobNote) {
      const a = audio.current;
      // The element's own state, not the last one drawn (it may have paused by itself a moment ago).
      if (a && holds.current === n.id && curRef.current?.id === n.id) {
        if (!a.paused) {
          going.current = false;
          a.pause();
          setCur({ id: n.id, playing: false });
        } else api.current.play(n, a);
        return;
      }
      void api.current.start(n, 0);
    },
    seek(n: JobNote, frac: number) {
      const a = audio.current;
      const mine = !!a && holds.current === n.id && curRef.current?.id === n.id;
      // A recording's length may be unknown to the browser (Chrome's WebM): the note keeps its own.
      const total = mine && Number.isFinite(a!.duration) && a!.duration > 0 ? a!.duration : n.seconds ?? 0;
      // Never quite the end: a place at the very end would count as played to it.
      const at = Math.max(0, Math.min(Math.max(0, total - 0.15), frac * total));
      if (mine) {
        a!.currentTime = at;
        setPos(at);
        return;
      }
      const id = n.mediaId;
      if (!id) return;
      const ask = ++asked.current;
      // Another note: it becomes the current one there, paused — play goes on from that point.
      void (async () => {
        const url = cachedMediaUrl(id) ?? (await mediaUrl(id));
        if (!url || ask !== asked.current || !alive.current) return;
        api.current.open(n, url, at);
        setCur({ id: n.id, playing: false });
      })();
    },
    /** A note taken off the chat: when it is the one in the player, its sound stops with it. */
    drop(id: string) {
      if (holds.current !== id) return;
      asked.current++;
      going.current = false;
      holds.current = null;
      audio.current?.pause();
      setCur(null);
      setPos(0);
    },
    cycleRate() {
      const next = VOICE_RATES[(VOICE_RATES.indexOf(rateRef.current) + 1) % VOICE_RATES.length];
      rateRef.current = next;
      setRate(next);
      saveVoiceRate(next);
      const a = audio.current;
      if (a) {
        a.defaultPlaybackRate = next;
        a.playbackRate = next;
      }
    },
  });
  const toggle = useCallback((n: JobNote) => api.current.toggle(n), []);
  const seek = useCallback((n: JobNote, frac: number) => api.current.seek(n, frac), []);
  const cycleRate = useCallback(() => api.current.cycleRate(), []);
  const drop = useCallback((id: string) => api.current.drop(id), []);
  return { cur, pos, rate, toggle, seek, cycleRate, drop };
}

/**
 * A voice message, as in WhatsApp: play, the bars of the recording with the dot at the place (tap a place, or
 * drag the dot), the speed while it is the one playing (1× → 1.5× → 2×) — a microphone otherwise; under the bars
 * how long it is (how far it went while it plays), the time in the corner.
 */
function VoiceNote({
  n,
  voice,
  rate,
  onPlay,
  onSeek,
  onRate,
  consumeClick,
  held,
  time,
}: {
  n: JobNote;
  voice: { playing: boolean; pos: number } | null;
  rate: VoiceRate;
  onPlay: (n: JobNote) => void;
  onSeek: (n: JobNote, frac: number) => void;
  onRate: () => void;
  consumeClick: () => boolean;
  /** The bubble's long press went off (its menu is open): the finger lifting is not a move of the dot. */
  held: () => boolean;
  time: ReactNode;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const total = n.seconds ?? 0;
  const [read, setRead] = useState<number[]>();
  const bars = n.peaks ?? read ?? flatPeaks();
  // A note made before the bars were kept with it: read from the recording once — a moment later (the chat first;
  // a note just recorded gets its own bars in that moment).
  useEffect(() => {
    if (n.peaks || !n.mediaId) return;
    const id = n.mediaId;
    let alive = true;
    const later = window.setTimeout(() => void voicePeaks(id).then((p) => alive && p && setRead(p)), 900);
    return () => {
      alive = false;
      window.clearTimeout(later);
    };
  }, [n.peaks, n.mediaId]);
  // The recording's address made ahead: the tap on play then reaches it at once.
  useEffect(() => {
    if (n.mediaId) void mediaUrl(n.mediaId);
  }, [n.mediaId]);
  const wave = useRef<HTMLDivElement>(null);
  // Where the finger has the dot (the sound jumps there when it lets go).
  const [drag, setDrag] = useState<number | null>(null);
  const fracAt = (x: number) => {
    const r = wave.current?.getBoundingClientRect();
    return r && r.width ? Math.max(0, Math.min(1, (x - r.left) / r.width)) : 0;
  };
  const at = voice ? Math.min(voice.pos, total || voice.pos) : 0;
  const shown = drag ?? (voice && total ? Math.min(1, at / total) : 0);
  const seconds = drag !== null ? drag * total : voice ? at : total;
  const drawn = useMemo(() => bars.map((h, i) => <i key={i} style={{ '--h': h } as CSSProperties} />), [bars]);
  return (
    <div className="note-voice" data-active={voice ? true : undefined}>
      <ActionIcon
        size={36}
        radius="xl"
        variant="white"
        className="note-play"
        aria-label={voice?.playing ? t('notes.pause') : t('notes.play')}
        onClick={() => {
          if (!consumeClick()) onPlay(n);
        }}
      >
        {voice?.playing ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
      </ActionIcon>
      <div
        ref={wave}
        className="voice-wave"
        role="slider"
        tabIndex={0}
        aria-label={t('notes.position')}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(seconds)}
        aria-valuetext={clock(seconds)}
        data-drag={drag !== null || undefined}
        data-playing={(voice?.playing && drag === null) || undefined}
        style={{ '--p': shown } as CSSProperties}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setDrag(fracAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (drag !== null) setDrag(fracAt(e.clientX));
        }}
        onPointerUp={(e) => {
          if (drag === null) return;
          setDrag(null);
          // A long press here opened the bubble's menu: lifting the finger does not move the dot.
          if (!held()) onSeek(n, fracAt(e.clientX));
        }}
        // The chat took the finger to scroll: the dot stays where it was.
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (!total || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
          e.preventDefault();
          onSeek(n, Math.max(0, Math.min(1, (at + (e.key === 'ArrowRight' ? 5 : -5)) / total)));
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
      {voice ? (
        // Its words change with each tap, yet it is the same control: taps in a row all count (ui/tapGuard).
        <button type="button" className="voice-rate" data-repeat aria-label={t('notes.speed')} onClick={onRate}>
          {rateLabel(rate, lang)}
        </button>
      ) : (
        <span className="voice-mic" aria-hidden>
          <IconMicrophone size={18} stroke={2} />
        </span>
      )}
      <span className="tnum voice-len">{clock(seconds)}</span>
      {time}
    </div>
  );
}

/** A video note plays in its bubble (the phone's own player, full screen from its controls). */
function NoteVideo({ id }: { id: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    void mediaUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return url ? <video src={url} controls playsInline preload="metadata" /> : <span className="surface-soft" />;
}

interface BubbleProps {
  n: JobNote;
  /** The last of a run: the bubble's tail. */
  tail: boolean;
  /** The first of a run: a little room above it. */
  gap: boolean;
  /** A voice note that is the player's current one: playing, or paused at `pos` (seconds). */
  voice: { playing: boolean; pos: number } | null;
  rate: VoiceRate;
  /** The note this one answers ('gone' — it was deleted): on top of the bubble, a tap goes to it. */
  quote?: JobNote | 'gone';
  /** Notes are being picked (a long press began it): a tap picks or lets go, nothing else. */
  picking: boolean;
  picked: boolean;
  onPlay: (n: JobNote) => void;
  onSeek: (n: JobNote, frac: number) => void;
  onRate: () => void;
  onPhoto: (n: JobNote) => void;
  /** A long press: picking begins with this note. */
  onHold: (n: JobNote) => void;
  onPick: (n: JobNote) => void;
  /** A swipe to the right: the answer to it is written next. */
  onReply: (n: JobNote) => void;
  onQuote: (id: string) => void;
}

/** What a note is, in a few words: its text, or what it holds (a photo, a video, a voice note and its length). */
function noteGist(n: JobNote, t: (k: string) => string): string {
  if (n.kind === 'voice') return `${t('notes.voice')} · ${clock(n.seconds ?? 0)}`;
  if (n.kind === 'photo') return n.text || t('notes.photo');
  if (n.kind === 'video') return n.text || t('notes.video');
  return n.text ?? '';
}

/** The note answered, on top of the answer (a photo's thumbnail beside its words); a tap goes to it. */
function Quote({ note, onGo }: { note: JobNote | 'gone'; onGo: (id: string) => void }) {
  const { t } = useTranslation();
  if (note === 'gone')
    return (
      <span className="note-quote" data-gone>
        <span className="note-quote-text">{t('notes.gone')}</span>
      </span>
    );
  return (
    <button
      type="button"
      className="note-quote"
      onClick={(e) => {
        e.stopPropagation();
        onGo(note.id);
      }}
    >
      {note.kind === 'photo' && note.mediaId && (
        <span className="note-quote-thumb">
          <MediaImage id={note.mediaId} h={34} w={34} radius="0" />
        </span>
      )}
      <span className="note-quote-text">{noteGist(note, t)}</span>
    </button>
  );
}

/**
 * One note as a message of one's own: on the right, the time in its corner. A swipe to the right answers it
 * (ui/swipeReply.ts); a long press begins picking notes (a tick on the left; a tap then picks or lets go).
 */
const Bubble = memo(function Bubble({ n, tail, gap, voice, rate, quote, picking, picked, onPlay, onSeek, onRate, onPhoto, onHold, onPick, onReply, onQuote }: BubbleProps) {
  const { t } = useTranslation();
  const press = useLongPress(() => onHold(n));
  const swipe = useSwipeReply(() => onReply(n), !picking);
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
    onContextMenu: press.handlers.onContextMenu,
  };
  const time = <span className="note-time">{dubaiTime(n.createdAt)}</span>;
  const media = (n.kind === 'photo' || n.kind === 'video') && !!n.mediaId;
  const q = quote ? <Quote note={quote} onGo={onQuote} /> : null;
  return (
    <div className="note-row" data-gap={gap || undefined} data-picking={picking || undefined} data-picked={picked || undefined} data-note-id={n.id}>
      {picking && (
        <span className="note-tick" aria-hidden>
          {picked && <IconCheck size={15} stroke={3} />}
        </span>
      )}
      <div className="note-swipe" {...handlers}>
        <span className="note-reply-icon" aria-hidden>
          <IconArrowBackUp size={18} stroke={2.2} />
        </span>
        {media ? (
          <>
            {q}
            <div className="note-media" data-tail={tail || undefined} data-kind={n.kind}>
              {n.kind === 'photo' ? (
                <button
                  type="button"
                  className="note-photo"
                  aria-label={t('notes.photo')}
                  onClick={() => {
                    if (!press.consumeClick()) onPhoto(n);
                  }}
                >
                  <MediaImage id={n.mediaId!} card h="100%" w="100%" radius="0" />
                </button>
              ) : (
                <NoteVideo id={n.mediaId!} />
              )}
              {time}
            </div>
          </>
        ) : (
          <div className="note-bubble" data-tail={tail || undefined} data-kind={n.kind}>
            {q}
            {n.kind === 'voice' ? (
              <VoiceNote n={n} voice={voice} rate={rate} onPlay={onPlay} onSeek={onSeek} onRate={onRate} consumeClick={press.consumeClick} held={press.held} time={time} />
            ) : (
              <>
                <span className="note-text">{n.text}</span>
                {time}
              </>
            )}
          </div>
        )}
      </div>
      {/* While picking, the whole row is one tap: the note is picked or let go (its photo, its voice wait). */}
      {picking && <button type="button" className="note-pick" aria-pressed={picked} aria-label={noteGist(n, t) || t('notes.title')} onClick={() => onPick(n)} />}
    </div>
  );
});

/**
 * The scroll view of this screen (a phone screen) or the window (a computer): to keep the newest note in
 * sight, and to let the chat fill the screen so that a few notes sit just above the composer.
 */
function useChatScroll(fill: React.RefObject<HTMLDivElement>, count: number) {
  const screen = useScreen();
  const toEnd = (smooth: boolean) => {
    const el = screen?.scroller.current;
    const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
  };
  // The chat reaches down to the composer: its notes are pushed to the bottom (as in a messenger).
  useLayoutEffect(() => {
    const el = fill.current;
    if (!el) return;
    const sc = screen?.scroller.current ?? null;
    const update = () => {
      const view = sc ? sc.clientHeight : window.innerHeight;
      const top = el.getBoundingClientRect().top - (sc ? sc.getBoundingClientRect().top : 0) + (sc ? sc.scrollTop : window.scrollY);
      const body = el.closest('.screen-body');
      const below = body ? parseFloat(getComputedStyle(body).paddingBottom) || 0 : 120;
      el.style.minHeight = `${Math.max(0, Math.floor(view - top - below))}px`;
    };
    update();
    const ro = new ResizeObserver(update);
    if (sc) ro.observe(sc);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [fill, screen]);
  // Opened: at the newest note at once; a new note: it slides into sight.
  const seen = useRef(-1);
  useLayoutEffect(() => {
    if (seen.current < 0 || count < seen.current) toEnd(false);
    else if (count > seen.current) toEnd(true);
    seen.current = count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);
  return toEnd;
}

/**
 * What was typed and not sent yet, per job: the composer goes away with its tab (a swipe or a tap to the job) and
 * comes back with the text where it was left.
 */
const drafts = new Map<string, string>();

/**
 * The bottom of the chat: "+" (photos and videos from the phone), the text, the camera and the voice. Answering a
 * note (`reply`): the note above the field (× lets it go) — whatever is sent next answers it.
 */
function Composer({
  orderId,
  onSent,
  onFocus,
  reply,
  onReplyDone,
  field,
}: {
  orderId: string;
  onSent: () => void;
  onFocus: () => void;
  reply: JobNote | null;
  onReplyDone: () => void;
  field: React.RefObject<HTMLTextAreaElement>;
}) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [text, setShown] = useState(() => drafts.get(orderId) ?? '');
  const setText = (v: string) => {
    setShown(v);
    if (v) drafts.set(orderId, v);
    else drafts.delete(orderId);
  };
  const rec = useRecorder();
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const files = (list: File[]) => {
    if (!list.length) return;
    void run(async () => {
      for (const f of list) await addNote(orderId, f.type.startsWith('video/') ? { video: f, replyTo: reply?.id } : { photo: f, replyTo: reply?.id });
      haptic('light');
      onReplyDone();
      onSent();
    });
  };
  const send = () =>
    run(async () => {
      if (!text.trim()) return;
      await addNote(orderId, { text, replyTo: reply?.id });
      setText('');
      haptic('light');
      onReplyDone();
      onSent();
    });
  const record = () =>
    run(async () => {
      const r = await rec.start();
      if (r) {
        // The recording is kept first; its bars follow a moment later (reading it must never cost the note).
        const note = await addNote(orderId, { voice: r.blob, seconds: r.seconds, replyTo: reply?.id });
        haptic('success');
        onReplyDone();
        onSent();
        void peaksOfBlob(r.blob)
          .then((p) => p && setNotePeaks(note.id, p))
          .catch(() => undefined);
      }
    });
  // A computer's Enter sends (Shift+Enter — a new line); on a phone Return is a new line, as in its messengers.
  const fineMouse = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

  if (rec.recording)
    return (
      <div className="notes-composer" role="group" aria-label={t('notes.recording')} data-hold-page>
        <ActionIcon size={44} radius="xl" variant="default" className="notes-round glass" aria-label={t('common.cancel')} onClick={rec.cancel}>
          <IconX size={22} />
        </ActionIcon>
        <div className="notes-field glass recording">
          <span className="rec-dot" aria-hidden />
          <Text className="tnum" fw={600} fz={17}>
            {clock(rec.seconds)}
          </Text>
        </div>
        <ActionIcon size={44} radius="xl" color="red" aria-label={t('notes.stop')} onClick={rec.stop}>
          <IconPlayerStopFilled size={20} />
        </ActionIcon>
      </div>
    );
  const replying = reply && (
    <div className="notes-reply glass" role="group" aria-label={t('notes.reply')}>
      <IconArrowBackUp size={20} stroke={2.2} className="notes-reply-arrow" aria-hidden />
      {reply.kind === 'photo' && reply.mediaId && (
        <span className="note-quote-thumb">
          <MediaImage id={reply.mediaId} h={34} w={34} radius="0" />
        </span>
      )}
      <span className="notes-reply-text">{noteGist(reply, t)}</span>
      <ActionIcon size={32} radius="xl" variant="subtle" color="gray" aria-label={t('common.cancel')} onClick={onReplyDone}>
        <IconX size={18} />
      </ActionIcon>
    </div>
  );
  return (
    <div className="notes-bottom">
    {replying}
    <div className="notes-composer">
      <ActionIcon size={44} radius="xl" variant="default" className="notes-round glass" aria-label={t('notes.attach')} loading={busy} onClick={() => gallery.current?.click()}>
        <IconPlus size={22} />
      </ActionIcon>
      <div className="notes-field glass">
        <Textarea
          ref={field}
          aria-label={t('notes.add')}
          placeholder={t('notes.add')}
          autosize
          minRows={1}
          maxRows={5}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onFocus={onFocus}
          onKeyDown={(e) => {
            if (fineMouse && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
      </div>
      {text.trim() ? (
        <ActionIcon size={44} radius="xl" className="notes-send" aria-label={t('notes.send')} loading={busy} onClick={() => void send()}>
          <IconArrowUp size={22} stroke={2.4} />
        </ActionIcon>
      ) : (
        <>
          <ActionIcon size={44} radius="xl" variant="default" className="notes-round glass" aria-label={t('notes.camera')} onClick={() => camera.current?.click()}>
            <IconCamera size={21} />
          </ActionIcon>
          {canRecord() && (
            <ActionIcon size={44} radius="xl" variant="default" className="notes-round glass" aria-label={t('notes.record')} onClick={() => void record()}>
              <IconMicrophone size={21} />
            </ActionIcon>
          )}
        </>
      )}
      <input
        ref={gallery}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        data-note-media
        onChange={(e) => {
          const list = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          files(list);
        }}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-note-camera
        onChange={(e) => {
          const list = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          files(list);
        }}
      />
    </div>
    </div>
  );
}

/**
 * The job's "Notes" tab: a chat with oneself — everything to remember about the car and the job, typed,
 * photographed, filmed or said. The newest at the bottom, by day. A swipe to the right on a note answers it; a
 * long press begins picking notes — several at once: answer the one, copy their words, delete them (with Undo).
 */
export function NotesChat({ orderId, notes, editable }: { orderId: string; notes: JobNote[]; editable: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run } = useAction();
  const [viewing, setViewing] = useState<string | null>(null);
  const [reply, setReply] = useState<JobNote | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const fill = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const sorted = [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const byId = new Map(sorted.map((n) => [n.id, n]));
  const player = usePlayer(sorted);
  const onPhoto = useCallback((n: JobNote) => setViewing(n.id), []);
  const toEnd = useChatScroll(fill, sorted.length);
  const animate = useAutoAnimate<HTMLDivElement>();
  const picking = !!picked;

  const onHold = useCallback((n: JobNote) => setPicked((p) => p ?? new Set([n.id])), []);
  const onPick = useCallback((n: JobNote) => {
    haptic('selection');
    setPicked((p) => {
      if (!p) return p;
      const next = new Set(p);
      if (next.has(n.id)) next.delete(n.id);
      else next.add(n.id);
      return next.size ? next : null;
    });
  }, []);
  // The answer is written next: the field takes the keyboard (in the swipe's own touch — an iPhone opens it only so).
  const onReply = useCallback((n: JobNote) => {
    setReply(n);
    field.current?.focus();
  }, []);
  // The note answered: brought into sight, and it nods.
  const onQuote = useCallback((id: string) => {
    const row = fill.current?.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row.removeAttribute('data-flash');
    void row.offsetWidth;
    row.setAttribute('data-flash', '');
    window.setTimeout(() => row.removeAttribute('data-flash'), 1300);
  }, []);

  const chosen = sorted.filter((n) => picked?.has(n.id));
  const words = chosen
    .map((n) => n.text?.trim())
    .filter(Boolean)
    .join('\n');
  const remove = (list: JobNote[]) =>
    run(async () => {
      // A voice note being played goes quiet with it.
      for (const n of list) player.drop(n.id);
      const removed: RemovedNote[] = [];
      for (const n of list) {
        const r = await removeNote(n.id);
        if (r) removed.push(r);
      }
      setPicked(null);
      if (reply && list.some((n) => n.id === reply.id)) setReply(null);
      if (removed.length)
        undoToast(removed.length > 1 ? t('notes.removedN', { n: removed.length }) : t('notes.removed'), t('common.undo'), () => {
          void (async () => {
            for (const r of removed) await restoreNote(r);
          })();
        });
    });
  const copy = () =>
    run(async () => {
      setPicked(null);
      if (!words || !(await copyText(words))) throw new AppError('err.copy');
    }, 'notes.copied');

  const days: [string, JobNote[]][] = [];
  for (const n of sorted) {
    const d = dubaiDate(n.createdAt);
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(n);
    else days.push([d, [n]]);
  }
  const photos = sorted.filter((n) => n.kind === 'photo' && n.mediaId);

  return (
    <>
      <div className="notes-chat" ref={fill} aria-label={t('notes.title')}>
        {sorted.length === 0 ? (
          <div className="notes-empty">
            <span className="empty-icon" aria-hidden>
              <IconNotes size={30} stroke={1.8} />
            </span>
            <Text c="dimmed">{t('notes.empty')}</Text>
          </div>
        ) : (
          <div className="notes-list" ref={animate} data-picking={picking || undefined}>
            {days.flatMap(([day, list]) => {
              const head = dayHeading(day, lang);
              return [
                <div key={`d-${day}`} className="note-day">
                  {head.word ? t(`common.${head.word}`) : head.text}
                </div>,
                ...list.map((n, i) => (
                  <Bubble
                    key={n.id}
                    n={n}
                    gap={i > 0 && minutesApart(list[i - 1], n) > RUN_MINUTES}
                    tail={i === list.length - 1 || minutesApart(n, list[i + 1]) > RUN_MINUTES}
                    voice={player.cur?.id === n.id ? { playing: player.cur.playing, pos: player.pos } : null}
                    rate={player.rate}
                    quote={n.replyTo ? (byId.get(n.replyTo) ?? 'gone') : undefined}
                    picking={picking}
                    picked={!!picked?.has(n.id)}
                    onPlay={player.toggle}
                    onSeek={player.seek}
                    onRate={player.cycleRate}
                    onPhoto={onPhoto}
                    onHold={onHold}
                    onPick={onPick}
                    onReply={onReply}
                    onQuote={onQuote}
                  />
                )),
              ];
            })}
          </div>
        )}
      </div>
      {picking ? (
        // Picking: how many, and what can be done with them — answer (one), copy their words, delete.
        <StickyBar>
          <div className="notes-composer notes-picking" role="toolbar" aria-label={t('notes.pickedN', { n: chosen.length })}>
            <ActionIcon size={44} radius="xl" variant="default" className="notes-round glass" aria-label={t('common.cancel')} onClick={() => setPicked(null)}>
              <IconX size={22} />
            </ActionIcon>
            <div className="notes-field glass notes-count">
              <Text fw={600} fz={17} className="tnum">
                {t('notes.pickedN', { n: chosen.length })}
              </Text>
            </div>
            {editable && chosen.length === 1 && (
              <ActionIcon
                size={44}
                radius="xl"
                variant="default"
                className="notes-round glass"
                aria-label={t('notes.reply')}
                onClick={() => {
                  setPicked(null);
                  onReply(chosen[0]);
                }}
              >
                <IconArrowBackUp size={21} />
              </ActionIcon>
            )}
            {!!words && (
              <ActionIcon size={44} radius="xl" variant="default" className="notes-round glass" aria-label={t('notes.copy')} onClick={() => void copy()}>
                <IconCopy size={20} />
              </ActionIcon>
            )}
            {editable && (
              <ActionIcon size={44} radius="xl" color="red" aria-label={t('common.delete')} onClick={() => void remove(chosen)}>
                <IconTrash size={20} />
              </ActionIcon>
            )}
          </div>
        </StickyBar>
      ) : (
        editable && (
          <StickyBar>
            <Composer
              orderId={orderId}
              onSent={() => toEnd(true)}
              onFocus={() => window.setTimeout(() => toEnd(true), 350)}
              reply={reply}
              onReplyDone={() => setReply(null)}
              field={field}
            />
          </StickyBar>
        )
      )}
      {viewing && (
        <PhotoViewer
          items={photos.map((n) => ({ id: n.mediaId!, title: n.text }))}
          index={Math.max(0, photos.findIndex((n) => n.id === viewing))}
          onIndex={(i) => setViewing(photos[i]?.id ?? null)}
          onClose={() => setViewing(null)}
          actions={(it) => {
            const n = photos.find((x) => x.mediaId === it.id);
            return editable && n ? (
              <Button
                radius="xl"
                size="md"
                variant="light"
                color="red"
                leftSection={<IconTrash size={18} />}
                onClick={() => {
                  setViewing(null);
                  void remove([n]);
                }}
              >
                {t('common.delete')}
              </Button>
            ) : null;
          }}
        />
      )}
    </>
  );
}
