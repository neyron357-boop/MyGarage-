import { ActionIcon, Button, Loader, Modal, Stack, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconArrowDown,
  IconArrowUp,
  IconBan,
  IconBrandWhatsapp,
  IconCamera,
  IconCopy,
  IconDownload,
  IconFile,
  IconMapPin,
  IconMessage2,
  IconPhone,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlus,
  IconShare2,
  IconTrash,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { dayHeading, dubaiTime } from '../../domain/dates';
import { clock, fileSize, groupDays, kindOf, MAX_FILE_BYTES, sendKind, type WaMessage, type Who } from '../../domain/whatsapp';
import { dropFailed, loadMessages, moreMessages, seenWa, sendWaFile, sendWaText, useWa, useWaPrefs, waFileBlob, waFileSrc, waReady } from '../../services/whatsapp';
import { copyText } from '../../ui/clipboard';
import { StickyBar } from '../../ui/components';
import { DeskMenu, type DeskMenuItem } from '../../ui/desk';
import { haptic } from '../../ui/haptics';
import { useErrorText, useLang } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { useLongPress } from '../../ui/longPress';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { downloadFile, shareOrDownload } from '../../ui/share';
import { useScreen } from '../../ui/stack';
import { useSwipeReply } from '../../ui/swipeReply';
import { startVideo, VideoPlayer } from '../../ui/VideoPlayer';
import { ChatQuick, type QuickFor } from './ChatQuick';
import { KIND_ICON, Marked, Ticks } from './WaParts';

/*
 * A chat of the garage's WhatsApp (v0.78): its messages by day — the other side on the left, one's own on the right in
 * WhatsApp's green — photos, videos, voice messages and documents as WhatsApp shows them, an answer with the message
 * it answers; below, «＋» (any file), the words, the camera. A swipe to the right answers a message, a long press (a
 * right click on a PC) — answer, copy, share. Older messages come as the chat is scrolled up. Everything is read from
 * the garage's server and kept right by what it says on the open stream; nothing is kept in the app's data.
 */

/** Messages of one side closer than this are one run (the tail on its last). */
const RUN_MS = 5 * 60_000;
const fineMouse = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
const thumbSrc = (thumb: string | undefined) => (thumb ? `data:image/jpeg;base64,${thumb}` : undefined);

/** A photo's or a video's frame: its own shape, kept within what a bubble may take — nothing moves as it loads. */
function frameOf(w: number | undefined, h: number | undefined): React.CSSProperties {
  const ratio = w && h ? Math.min(1.9, Math.max(0.62, w / h)) : 1;
  return { aspectRatio: String(ratio), width: `min(${ratio >= 1 ? 280 : Math.round(300 * ratio)}px, 68vw)` };
}

/* ---------- What a message carries ---------- */

/** A sound: ▶, the line of where it is, how long. One plays at a time. */
let playing: HTMLAudioElement | null = null;
function Sound({ m }: { m: WaMessage }) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [on, setOn] = useState(false);
  const [pos, setPos] = useState(0);
  const [failed, setFailed] = useState(false);
  const total = m.file?.sec ?? 0;
  useEffect(
    () => () => {
      audio.current?.pause();
      if (playing === audio.current) playing = null;
    },
    [],
  );
  const toggle = () => {
    const src = m.local ?? waFileSrc(m.id);
    if (!src) return;
    let a = audio.current;
    if (!a) {
      a = new Audio(src);
      a.preload = 'auto';
      a.addEventListener('timeupdate', () => setPos(a!.currentTime));
      a.addEventListener('ended', () => {
        setOn(false);
        setPos(0);
      });
      a.addEventListener('pause', () => setOn(false));
      a.addEventListener('play', () => setOn(true));
      a.addEventListener('error', () => setFailed(true));
      audio.current = a;
    }
    if (a.paused) {
      if (playing && playing !== a) playing.pause();
      playing = a;
      void a.play().catch(() => setFailed(true));
    } else a.pause();
  };
  const length = total || audio.current?.duration || 0;
  const part = length ? Math.min(1, pos / length) : 0;
  return (
    <span className="wa-sound" data-failed={failed || undefined}>
      <button type="button" className="wa-sound-play tap" aria-label={t(on ? 'wa.pause' : 'wa.play')} onClick={toggle} data-repeat>
        {on ? <IconPlayerPauseFilled size={18} /> : <IconPlayerPlayFilled size={18} />}
      </button>
      <span
        className="wa-sound-line"
        role="slider"
        aria-label={t('wa.kind.voice')}
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={Math.round(pos)}
        tabIndex={0}
        onClick={(e) => {
          const a = audio.current;
          if (!a || !length) return;
          const box = e.currentTarget.getBoundingClientRect();
          a.currentTime = Math.min(length, Math.max(0, ((e.clientX - box.left) / box.width) * length));
        }}
      >
        <span style={{ width: `${part * 100}%` }} />
      </span>
      <span className="wa-sound-time tnum">{failed ? t('wa.fileGone') : clock(on || pos ? pos : length)}</span>
    </span>
  );
}

/** A document: its symbol, its name, how large — a tap shares it (a phone) or saves it (a PC). */
function Doc({ m, onOpen }: { m: WaMessage; onOpen: (m: WaMessage) => void }) {
  const { t } = useTranslation();
  const size = fileSize(m.file?.size);
  const ext = (m.file?.name?.split('.').pop() ?? m.file?.mime?.split('/').pop() ?? '').slice(0, 5).toUpperCase();
  return (
    <button type="button" className="wa-doc tap" onClick={() => onOpen(m)} aria-label={m.file?.name || t('wa.kind.file')}>
      <span className="wa-doc-icon" aria-hidden>
        <IconFile size={22} stroke={1.8} />
      </span>
      <span className="wa-doc-body">
        <span className="wa-doc-name">{m.file?.name || t('wa.kind.file')}</span>
        <span className="wa-doc-meta">{[ext, size ? `${size.n} ${t(`wa.unit.${size.unit}`)}` : ''].filter(Boolean).join(' · ')}</span>
      </span>
      <IconDownload size={18} stroke={2} aria-hidden className="wa-doc-get" />
    </button>
  );
}

/** A photo: its small blurred preview at once (it came with the message), the photo itself over it when it is in. */
function Picture({ m, onOpen }: { m: WaMessage; onOpen: (m: WaMessage) => void }) {
  const { t } = useTranslation();
  const src = m.local ?? waFileSrc(m.id);
  const [shown, setShown] = useState(false);
  const [gone, setGone] = useState(false);
  const thumb = thumbSrc(m.file?.thumb);
  return (
    <button type="button" className="wa-pic" style={frameOf(m.file?.w, m.file?.h)} aria-label={t('wa.kind.photo')} onClick={() => !gone && onOpen(m)} data-gone={gone || undefined}>
      {thumb && <img className="wa-pic-thumb" src={thumb} alt="" aria-hidden />}
      {src && !gone && <img className="wa-pic-full" src={src} alt="" loading="lazy" decoding="async" data-shown={shown || undefined} onLoad={() => setShown(true)} onError={() => setGone(true)} />}
      {gone && <span className="wa-pic-gone">{t('wa.fileGone')}</span>}
    </button>
  );
}

function Film({ m, onOpen }: { m: WaMessage; onOpen: (m: WaMessage, url: string) => void }) {
  const { t } = useTranslation();
  const src = m.local ?? waFileSrc(m.id);
  const thumb = thumbSrc(m.file?.thumb);
  return (
    <button type="button" className="wa-pic wa-film" style={frameOf(m.file?.w, m.file?.h)} aria-label={t('wa.kind.video')} onClick={() => src && onOpen(m, src)}>
      {thumb && <img className="wa-pic-thumb" src={thumb} alt="" aria-hidden />}
      <span className="note-video-play" aria-hidden>
        <IconPlayerPlayFilled size={26} />
      </span>
      {!!m.file?.sec && (
        <span className="note-video-len" aria-hidden>
          {clock(m.file.sec)}
        </span>
      )}
    </button>
  );
}

/** The message answered, on top of the answer. */
function Quoted({ q, onGo }: { q: NonNullable<WaMessage['quote']>; onGo: (id: string) => void }) {
  const { t } = useTranslation();
  const kind = kindOf(q.type);
  const I = KIND_ICON[kind];
  const thumb = thumbSrc(q.thumb);
  return (
    <button type="button" className="note-quote wa-quote" onClick={() => q.id && onGo(q.id)}>
      {thumb && (
        <span className="note-quote-thumb">
          <img src={thumb} alt="" />
        </span>
      )}
      <span className="note-quote-text">
        <span className="wa-quote-who">{q.me ? t('wa.you') : ''}</span>
        {I && <I size={14} stroke={2} aria-hidden />} {q.text || (kind === 'text' ? '' : t(`wa.kind.${kind}`))}
      </span>
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
  desk: boolean;
  onPhoto: (m: WaMessage) => void;
  onVideo: (m: WaMessage, url: string) => void;
  onDoc: (m: WaMessage) => void;
  onReply: (m: WaMessage) => void;
  onMenu: (m: WaMessage, at?: { x: number; y: number }) => void;
  onQuote: (id: string) => void;
  onAgain: (m: WaMessage) => void;
  onCard: (phone: string) => void;
}

const Bubble = memo(function Bubble({ m, tail, gap, author, desk, onPhoto, onVideo, onDoc, onReply, onMenu, onQuote, onAgain, onCard }: BubbleProps) {
  const { t } = useTranslation();
  const kind = kindOf(m.type);
  const press = useLongPress(() => onMenu(m));
  const swipe = useSwipeReply(() => onReply(m), !m.pending && !m.failed);
  const handlers = desk
    ? {
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault();
          onMenu(m, { x: e.clientX, y: e.clientY });
        },
      }
    : {
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
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      };
  const foot = (
    <span className="note-time wa-foot">
      {m.fwd && <IconShare2 size={12} stroke={2} aria-label={t('wa.forwarded')} />}
      {dubaiTime(new Date(m.t).toISOString())}
      {m.me && <Ticks m={m} size={15} />}
    </span>
  );
  const quote = m.quote ? <Quoted q={m.quote} onGo={onQuote} /> : null;
  const who = author ? <span className="wa-author">{author}</span> : null;
  const words = m.text ? (
    <span className="note-text">
      <Marked text={m.text} />
    </span>
  ) : null;
  const picture = kind === 'photo' || kind === 'video' || kind === 'sticker';

  let body: ReactNode;
  if (picture) {
    body = (
      <div className="wa-media" data-tail={tail || undefined} data-words={!!m.text || undefined} data-sticker={kind === 'sticker' || undefined}>
        {who}
        {quote}
        {kind === 'video' ? <Film m={m} onOpen={onVideo} /> : <Picture m={m} onOpen={onPhoto} />}
        {words ? (
          <div className="wa-caption">
            {words}
            {foot}
          </div>
        ) : (
          foot
        )}
      </div>
    );
  } else {
    let inner: ReactNode;
    if (kind === 'voice' || kind === 'audio') inner = <Sound m={m} />;
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
    body = (
      <div className="note-bubble" data-tail={tail || undefined} data-kind={kind}>
        {who}
        {quote}
        {inner}
        {kind === 'text' || kind === 'poll' ? (
          <>
            {words}
            {foot}
          </>
        ) : (
          <>
            {kind !== 'place' && words}
            {foot}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="note-row" data-in={!m.me || undefined} data-gap={gap || undefined} data-wa-id={m.id} data-failed={m.failed || undefined} data-pending={m.pending || undefined}>
      <div className="note-swipe" {...handlers}>
        <span className="note-reply-icon" aria-hidden>
          <IconArrowBackUp size={18} stroke={2.2} />
        </span>
        {body}
        {m.failed && (
          <button type="button" className="wa-failed tap" onClick={() => onAgain(m)}>
            <IconAlertCircle size={15} stroke={2.2} aria-hidden /> {t('wa.notSent')}
          </button>
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

/** What was picked, before it goes: the files, a caption — and one button. (A file sent to a customer is not taken back.) */
function FilesSheet({ files, to, opened, onClose, onSend }: { files: Picked[]; to: string; opened: boolean; onClose: () => void; onSend: (caption: string) => void }) {
  const { t } = useTranslation();
  const [caption, setCaption] = useState('');
  const tooBig = files.some((f) => f.file.size > MAX_FILE_BYTES);
  return (
    <Modal opened={opened} onClose={onClose} title={to}>
      <Stack gap="md" data-wa-files>
        <div className="wa-picked">
          {files.map((f, i) => {
            const size = fileSize(f.file.size);
            return f.url ? (
              <span key={i} className="wa-picked-pic">
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
        <Textarea value={caption} onChange={(e) => setCaption(e.currentTarget.value)} placeholder={t('wa.caption')} aria-label={t('wa.caption')} autosize minRows={1} maxRows={5} />
        <Button fullWidth size="md" color="green" disabled={tooBig} leftSection={<IconArrowUp size={20} stroke={2.4} />} onClick={() => onSend(caption)} data-wa-files-send>
          {t('wa.sendN', { count: files.length })}
        </Button>
      </Stack>
    </Modal>
  );
}

/* ---------- The bottom: «＋», the words, the camera ---------- */

/** What was typed and not sent, by chat: back in its field when the chat is opened again. */
const drafts = new Map<string, string>();

function Composer({ chatId, title, reply, onReplyDone, onSent, field, quick, desk }: { chatId: string; title: string; reply: WaMessage | null; onReplyDone: () => void; onSent: () => void; field: React.RefObject<HTMLTextAreaElement>; quick?: QuickFor; desk: boolean }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [text, setTextState] = useState(drafts.get(chatId) ?? '');
  const [picked, setPicked] = useState<Picked[] | null>(null);
  // «＋» of a customer's chat (v0.80): what can be done for them at once; anyone else's — a file, as before.
  const [quickAt, setQuickAt] = useState<{ x: number; y: number } | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const setText = (v: string) => {
    setTextState(v);
    if (v) drafts.set(chatId, v);
    else drafts.delete(chatId);
  };
  useEffect(() => setTextState(drafts.get(chatId) ?? ''), [chatId]);
  const say = (e: unknown) => {
    haptic('error');
    notifications.show({ color: 'red', message: errorText(e) });
  };
  const send = () => {
    const words = text.trim();
    if (!words) return;
    // Gone from the field at once: the message is in the chat, on its way.
    setText('');
    const answered = reply ?? undefined;
    onReplyDone();
    haptic('light');
    void sendWaText(chatId, words, answered).catch(say);
    onSent();
  };
  const pick = (list: File[]) => {
    if (!list.length) return;
    setPicked(list.map((file) => ({ file, url: sendKind(file) === 'photo' ? URL.createObjectURL(file) : undefined })));
  };
  const closePicked = () => {
    picked?.forEach((p) => p.url && URL.revokeObjectURL(p.url));
    setPicked(null);
  };
  const sendFiles = (caption: string) => {
    const list = picked ?? [];
    const answered = reply ?? undefined;
    onReplyDone();
    closePicked();
    haptic('light');
    void (async () => {
      // One after another, in the order picked; the caption — and the answer — with the first.
      for (const [i, p] of list.entries()) {
        try {
          await sendWaFile(chatId, p.file, { name: p.file.name || 'file', caption: i === 0 ? caption : '', quote: i === 0 ? answered : undefined });
        } catch (e) {
          say(e);
          break;
        }
      }
    })();
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
  return (
    <div className="notes-bottom">
      {reply && (
        <div className="notes-reply glass" role="group" aria-label={t('wa.reply')}>
          <IconArrowBackUp size={20} stroke={2.2} className="notes-reply-arrow" aria-hidden />
          <span className="notes-reply-text">{reply.text || t(`wa.kind.${kindOf(reply.type)}`)}</span>
          <ActionIcon size={36} radius="xl" variant="subtle" color="gray" aria-label={t('common.cancel')} onClick={onReplyDone}>
            <IconX size={18} />
          </ActionIcon>
        </div>
      )}
      <div className="notes-composer" data-wa-composer>
        <ActionIcon
          size={44}
          radius="xl"
          variant="default"
          className="notes-round glass"
          aria-label={t(quick ? 'wa.quick.title' : 'wa.attach')}
          aria-haspopup={quick ? 'menu' : undefined}
          onClick={(e) => {
            if (!quick) return gallery.current?.click();
            const r = e.currentTarget.getBoundingClientRect();
            setQuickAt({ x: r.left, y: r.top - 4 });
          }}
          data-wa-plus
        >
          <IconPlus size={22} />
        </ActionIcon>
        <div className="notes-field glass">
          <Textarea
            ref={field}
            aria-label={t('wa.message')}
            placeholder={t('wa.message')}
            autosize
            minRows={1}
            maxRows={6}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (fineMouse() && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
        {text.trim() ? (
          <ActionIcon size={44} radius="xl" color="green" className="notes-send" aria-label={t('wa.send')} onClick={send} data-wa-send>
            <IconArrowUp size={22} stroke={2.4} />
          </ActionIcon>
        ) : (
          <ActionIcon size={44} radius="xl" variant="default" className="notes-round glass" aria-label={t('wa.camera')} onClick={() => camera.current?.click()}>
            <IconCamera size={21} />
          </ActionIcon>
        )}
        {input(gallery, { multiple: true, 'data-wa-file': '' } as React.InputHTMLAttributes<HTMLInputElement>)}
        {input(camera, { accept: 'image/*', capture: 'environment' })}
      </div>
      <SheetFor value={picked}>{(list, o) => <FilesSheet files={list} to={title} opened={o} onClose={closePicked} onSend={sendFiles} />}</SheetFor>
      {quick && <ChatQuick chatId={chatId} quick={quick} desk={desk} at={quickAt} opened={!!quickAt} onClose={() => setQuickAt(null)} onFiles={() => gallery.current?.click()} />}
    </div>
  );
}

/* ---------- The chat ---------- */

/** Where the chat scrolls: the phone screen's own scroll view, or the pane of the PC's window. */
function useScroller(pane: React.RefObject<HTMLDivElement>) {
  const screen = useScreen();
  return useCallback(() => screen?.scroller.current ?? pane.current, [screen, pane]);
}

export function ChatThread({ chatId, title, group, people, desk, quick }: { chatId: string; title: string; group: boolean; people: Map<string, Who>; desk: boolean; /** Whose chat it is, for «＋»'s quick actions (v0.80). */ quick?: QuickFor }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const s = useWa();
  const prefs = useWaPrefs();
  const screen = useScreen();
  const ready = waReady(s);
  const list = s.messages[chatId];
  const meta = s.meta[chatId];
  const unread = s.chats.find((c) => c.id === chatId)?.unread ?? 0;
  const pane = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const scroller = useScroller(pane);
  const [reply, setReply] = useState<WaMessage | null>(null);
  const [menu, setMenu] = useState<{ m: WaMessage; at?: { x: number; y: number } } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [film, setFilm] = useState<{ el: HTMLVideoElement; m: WaMessage } | null>(null);
  const [down, setDown] = useState(false);

  // Read when the chat is opened, and again when WhatsApp is back.
  useEffect(() => {
    if (ready) void loadMessages(chatId);
  }, [chatId, ready]);
  useEffect(() => {
    setReply(null);
    setMenu(null);
  }, [chatId]);

  // Seen: the chat is in front, the app in sight — its unread goes, here and on the phone.
  useEffect(() => {
    if (!prefs.seen || !unread || !list) return;
    if (document.visibilityState !== 'visible' || (screen && !screen.front())) return;
    void seenWa(chatId);
  }, [chatId, unread, prefs.seen, list, screen]);

  /* ----- Where the chat stands ----- */
  const atEnd = useRef(true);
  const toEnd = useCallback(
    (smooth: boolean) => {
      const el = scroller();
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    },
    [scroller],
  );
  useEffect(() => {
    const el = scroller();
    if (!el) return undefined;
    const on = () => {
      const far = el.scrollHeight - el.scrollTop - el.clientHeight;
      atEnd.current = far < 140;
      setDown(far > 600);
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, [scroller, chatId]);
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
  // Opened: at the newest. A new message: brought into sight if the end was in sight, or it is one's own. Older ones
  // put on top: what was in sight stays where it was.
  const seen = useRef<{ chat: string; first?: string; last?: string; height: number }>({ chat: '', height: 0 });
  const firstId = list?.[0]?.id;
  const last = list?.[list.length - 1];
  useLayoutEffect(() => {
    const el = scroller();
    if (!el || !list) return;
    const was = seen.current;
    if (was.chat !== chatId || !was.last) toEnd(false);
    else if (last && last.id !== was.last) {
      if (atEnd.current || last.me) toEnd(was.chat === chatId);
    } else if (firstId !== was.first) el.scrollTop += el.scrollHeight - was.height;
    seen.current = { chat: chatId, first: firstId, last: last?.id, height: el.scrollHeight };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, firstId, last?.id, list?.length]);

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
  const onReply = useCallback((m: WaMessage) => {
    setReply(m);
    field.current?.focus();
  }, []);
  const onMenu = useCallback((m: WaMessage, at?: { x: number; y: number }) => setMenu({ m, at }), []);
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
      // A PDF on a PC opens beside the app; anything else is handed over (the phone's share sheet) or saved.
      const src = waFileSrc(m.id);
      if (desk && src && /pdf|^image\//.test(m.file?.mime ?? '')) {
        window.open(src, '_blank', 'noopener');
        return;
      }
      void fileOf(m).then((f) => f && (desk ? downloadFile(f) : shareOrDownload(f)));
    },
    [desk, fileOf],
  );
  const onQuote = useCallback(
    (id: string) => {
      const row = [...(fill.current?.querySelectorAll<HTMLElement>('[data-wa-id]') ?? [])].find((el) => el.dataset.waId?.endsWith(`_${id}`) || el.dataset.waId === id);
      if (!row) return;
      row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      row.removeAttribute('data-flash');
      void row.offsetWidth;
      row.setAttribute('data-flash', '');
      window.setTimeout(() => row.removeAttribute('data-flash'), 1300);
    },
    [],
  );
  const onAgain = useCallback(
    (m: WaMessage) => {
      // Not sent: the same words once more (a file is picked again).
      dropFailed(chatId, m.id);
      if (m.type === 'chat' && m.text) void sendWaText(chatId, m.text).catch((e) => notifications.show({ color: 'red', message: errorText(e) }));
    },
    [chatId, errorText],
  );
  const onCard = useCallback((phone: string) => window.dispatchEvent(new CustomEvent('mg-wa-open', { detail: phone })), []);

  const photos = useMemo(() => (list ?? []).filter((m) => kindOf(m.type) === 'photo' && (m.local || waFileSrc(m.id))), [list]);
  const days = useMemo(() => groupDays(list ?? []), [list]);
  const nameOf = (m: WaMessage) => (m.from ? (m.from.phone && people.get(m.from.phone)?.name) || m.from.name || (m.from.phone ? `+${m.from.phone}` : '') : '');

  const actions = (m: WaMessage): DeskMenuItem[] => {
    const hasFile = !!m.file && !m.pending;
    return [
      ...(!m.pending && !m.failed ? [{ key: 'reply', label: t('wa.reply'), icon: IconArrowBackUp, onClick: () => onReply(m) }] : []),
      ...(m.text ? [{ key: 'copy', label: t('wa.copy'), icon: IconCopy, onClick: () => void copyText(m.text).then((ok) => ok && notifications.show({ color: 'green', message: t('common.copied') })) }] : []),
      ...(hasFile ? [{ key: 'file', label: t(desk ? 'wa.save' : 'wa.share'), icon: desk ? IconDownload : IconShare2, onClick: () => void fileOf(m).then((f) => f && (desk ? downloadFile(f) : shareOrDownload(f))) }] : []),
      ...(m.failed ? [{ key: 'drop', label: t('wa.remove'), icon: IconTrash, color: 'red', onClick: () => dropFailed(chatId, m.id) }] : []),
    ];
  };

  const body = !list ? (
    <div className="notes-empty">{meta?.failed ? <Button variant="light" onClick={() => void loadMessages(chatId)}>{t('wa.gate.retry')}</Button> : <Loader size="sm" />}</div>
  ) : list.length === 0 ? (
    <div className="notes-empty">
      <span className="empty-icon" aria-hidden>
        <IconMessage2 size={30} stroke={1.8} />
      </span>
      <Text c="dimmed">{t('wa.noMessages')}</Text>
    </div>
  ) : (
    <div className="notes-list wa-list" data-wa-list>
      <div ref={top} className="wa-top">
        {meta?.loading && list.length > 0 && <Loader size="xs" />}
      </div>
      {days.flatMap(([day, msgs]) => {
        const head = dayHeading(day, lang);
        return [
          <div key={`d-${day}`} className="note-day">
            {head.word ? t(`common.${head.word}`) : head.text}
          </div>,
          ...msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const next = msgs[i + 1];
            const sameAsPrev = !!prev && prev.me === m.me && prev.from?.id === m.from?.id;
            const sameAsNext = !!next && next.me === m.me && next.from?.id === m.from?.id;
            return (
              <Bubble
                key={m.id}
                m={m}
                desk={desk}
                gap={!!prev && (!sameAsPrev || m.t - prev.t > RUN_MS)}
                tail={!sameAsNext || next.t - m.t > RUN_MS}
                author={group && !m.me && (!sameAsPrev || m.t - prev.t > RUN_MS) ? nameOf(m) : undefined}
                onPhoto={onPhoto}
                onVideo={onVideo}
                onDoc={onDoc}
                onReply={onReply}
                onMenu={onMenu}
                onQuote={onQuote}
                onAgain={onAgain}
                onCard={onCard}
              />
            );
          }),
        ];
      })}
    </div>
  );

  const composer = ready ? <Composer chatId={chatId} title={title} reply={reply} onReplyDone={() => setReply(null)} onSent={() => window.setTimeout(() => toEnd(true), 30)} field={field} quick={quick} desk={desk} /> : null;
  const jump = down ? (
    <button type="button" className="wa-jump glass tap" aria-label={t('wa.toEnd')} onClick={() => toEnd(true)}>
      <IconArrowDown size={20} stroke={2.2} />
      {unread > 0 && <span className="wa-badge">{unread}</span>}
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
          <div className="wa-pane-scroll" ref={pane}>
            <div className="notes-chat wa-chat" ref={fill} data-wa aria-label={title}>
              {body}
            </div>
          </div>
          <div className="wa-pane-foot wa-bottom">
            {jump}
            {composer}
          </div>
        </div>
      ) : (
        <>
          <div className="notes-chat wa-chat" ref={fill} data-wa aria-label={title}>
            {body}
          </div>
          {composer && (
            <StickyBar>
              <div className="wa-bottom">
                {jump}
                {composer}
              </div>
            </StickyBar>
          )}
        </>
      )}
      {desk ? (
        <DeskMenu at={menu?.at ?? null} items={menu ? actions(menu.m) : []} onClose={() => setMenu(null)} />
      ) : (
        <SheetFor value={menu}>
          {(v, o) => (
            <Modal opened={o} onClose={() => setMenu(null)} title={v.m.text ? v.m.text.slice(0, 40) : t(`wa.kind.${kindOf(v.m.type)}`)}>
              <div className="action-tiles" data-wa-menu>
                {actions(v.m).map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className="action-tile"
                    onClick={() => {
                      setMenu(null);
                      a.onClick();
                    }}
                  >
                    <span className="tile-icon" style={{ '--c': `var(--mantine-color-${a.color ?? (a.key === 'reply' ? 'green' : a.key === 'copy' ? 'blue' : 'indigo')}-6)` } as React.CSSProperties}>{a.icon && <a.icon size={23} stroke={1.9} aria-hidden />}</span>
                    <span>{a.label}</span>
                  </button>
                ))}
              </div>
            </Modal>
          )}
        </SheetFor>
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
