import { ActionIcon, Button, Modal, Stack, Text, Textarea } from '@mantine/core';
import {
  IconArrowUp,
  IconCamera,
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
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { dayHeading, dubaiDate, dubaiTime, formatDateTime } from '../../domain/dates';
import type { JobNote } from '../../domain/types';
import { mediaUrl } from '../../services/media';
import { addNote, removeNote, restoreNote } from '../../services/notes';
import { copyText } from '../../ui/clipboard';
import { MediaImage, StickyBar, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { useLongPress } from '../../ui/longPress';
import { useAutoAnimate } from '../../ui/motion';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { canRecord, clock, useRecorder } from '../../ui/recorder';
import { AppError } from '../../services/errors';
import { useScreen } from '../../ui/stack';

/** Notes this close in time read as one run: one tail, no gap between them. */
const RUN_MINUTES = 3;
const minutesApart = (a: JobNote, b: JobNote) => Math.abs(Date.parse(b.createdAt) - Date.parse(a.createdAt)) / 60_000;

/** One player for all the voice notes on the screen: a new one stops the one playing; how far it went (0–1). */
function usePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string>();
  const [progress, setProgress] = useState(0);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = async (n: JobNote) => {
    if (!n.mediaId) return;
    if (playing === n.id) {
      audio.current?.pause();
      setPlaying(undefined);
      return;
    }
    audio.current?.pause();
    const url = await mediaUrl(n.mediaId);
    if (!url) return;
    const a = new Audio(url);
    audio.current = a;
    setProgress(0);
    // A recording's length may be unknown to the browser (webm): the note keeps its own.
    a.ontimeupdate = () => {
      const total = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : n.seconds ?? 0;
      setProgress(total ? Math.min(1, a.currentTime / total) : 0);
    };
    a.onended = () => {
      setPlaying(undefined);
      setProgress(0);
    };
    setPlaying(n.id);
    await a.play().catch(() => setPlaying(undefined));
  };
  return { playing, progress, toggle };
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
  playing: boolean;
  progress: number;
  onPlay: (n: JobNote) => void;
  onPhoto: (n: JobNote) => void;
  onMenu: (n: JobNote) => void;
}

/** One note as a message of one's own: on the right, the time in its corner; a long press — copy or delete. */
function Bubble({ n, tail, gap, playing, progress, onPlay, onPhoto, onMenu }: BubbleProps) {
  const { t } = useTranslation();
  const press = useLongPress(() => onMenu(n));
  const time = <span className="note-time">{dubaiTime(n.createdAt)}</span>;
  const media = n.kind === 'photo' || n.kind === 'video';
  return (
    <div className="note-row" data-gap={gap || undefined}>
      {media && n.mediaId ? (
        <div className="note-media" data-tail={tail || undefined} data-kind={n.kind} {...press.handlers}>
          {n.kind === 'photo' ? (
            <button
              type="button"
              className="note-photo"
              aria-label={t('notes.photo')}
              onClick={() => {
                if (!press.consumeClick()) onPhoto(n);
              }}
            >
              <MediaImage id={n.mediaId} card h="100%" w="100%" radius="0" />
            </button>
          ) : (
            <NoteVideo id={n.mediaId} />
          )}
          {time}
        </div>
      ) : (
        <div className="note-bubble" data-tail={tail || undefined} data-kind={n.kind} {...press.handlers}>
          {n.kind === 'voice' ? (
            <div className="note-voice">
              <ActionIcon
                size={36}
                radius="xl"
                variant="white"
                className="note-play"
                aria-label={playing ? t('notes.pause') : t('notes.play')}
                onClick={() => {
                  if (!press.consumeClick()) onPlay(n);
                }}
              >
                {playing ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
              </ActionIcon>
              <span className="note-track" aria-hidden>
                <i style={{ '--p': playing ? progress : 0 } as CSSProperties} />
              </span>
              <span className="tnum note-length">{clock(n.seconds ?? 0)}</span>
            </div>
          ) : (
            <span className="note-text">{n.text}</span>
          )}
          {time}
        </div>
      )}
    </div>
  );
}

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

/** The bottom of the chat: "+" (photos and videos from the phone), the text, the camera and the voice. */
function Composer({ orderId, onSent, onFocus }: { orderId: string; onSent: () => void; onFocus: () => void }) {
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
      for (const f of list) await addNote(orderId, f.type.startsWith('video/') ? { video: f } : { photo: f });
      haptic('light');
      onSent();
    });
  };
  const send = () =>
    run(async () => {
      if (!text.trim()) return;
      await addNote(orderId, { text });
      setText('');
      haptic('light');
      onSent();
    });
  const record = () =>
    run(async () => {
      const r = await rec.start();
      if (r) {
        await addNote(orderId, { voice: r.blob, seconds: r.seconds });
        haptic('success');
        onSent();
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
  return (
    <div className="notes-composer">
      <ActionIcon size={44} radius="xl" variant="default" className="notes-round glass" aria-label={t('notes.attach')} loading={busy} onClick={() => gallery.current?.click()}>
        <IconPlus size={22} />
      </ActionIcon>
      <div className="notes-field glass">
        <Textarea
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
  );
}

/**
 * The job's "Notes" tab: a chat with oneself — everything to remember about the car and the job, typed,
 * photographed, filmed or said. The newest at the bottom, by day; a long press copies or deletes.
 */
export function NotesChat({ orderId, notes, editable }: { orderId: string; notes: JobNote[]; editable: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run } = useAction();
  const [menu, setMenu] = useState<JobNote | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const player = usePlayer();
  const fill = useRef<HTMLDivElement>(null);
  const sorted = [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const toEnd = useChatScroll(fill, sorted.length);
  const animate = useAutoAnimate<HTMLDivElement>();

  const remove = (n: JobNote) =>
    run(async () => {
      const removed = await removeNote(n.id);
      setMenu(null);
      if (removed) undoToast(t('notes.removed'), t('common.undo'), () => void restoreNote(removed));
    });
  const copy = (n: JobNote) =>
    run(async () => {
      setMenu(null);
      if (!n.text || !(await copyText(n.text))) throw new AppError('err.copy');
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
          <div className="notes-list" ref={animate}>
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
                    playing={player.playing === n.id}
                    progress={player.progress}
                    onPlay={(x) => void player.toggle(x)}
                    onPhoto={(x) => setViewing(x.id)}
                    onMenu={setMenu}
                  />
                )),
              ];
            })}
          </div>
        )}
      </div>
      {editable && (
        <StickyBar>
          <Composer orderId={orderId} onSent={() => toEnd(true)} onFocus={() => window.setTimeout(() => toEnd(true), 350)} />
        </StickyBar>
      )}
      <SheetFor value={menu}>
        {(n, opened) => (
          <Modal opened={opened} onClose={() => setMenu(null)} title={formatDateTime(n.createdAt)}>
            <Stack gap="sm">
              {n.text && (
                <Button variant="light" size="lg" leftSection={<IconCopy size={20} />} onClick={() => void copy(n)}>
                  {t('notes.copy')}
                </Button>
              )}
              {editable && (
                <Button variant="light" color="red" size="lg" leftSection={<IconTrash size={20} />} onClick={() => void remove(n)}>
                  {t('common.delete')}
                </Button>
              )}
            </Stack>
          </Modal>
        )}
      </SheetFor>
      {viewing && (
        <PhotoViewer
          items={photos.map((n) => ({ id: n.mediaId!, title: n.text }))}
          index={Math.max(0, photos.findIndex((n) => n.id === viewing))}
          onIndex={(i) => setViewing(photos[i]?.id ?? null)}
          onClose={() => setViewing(null)}
          actions={(it) => {
            const n = photos.find((x) => x.mediaId === it.id);
            return editable && n ? (
              <Button radius="xl" size="md" variant="light" color="red" leftSection={<IconTrash size={18} />} onClick={() => (setViewing(null), void remove(n))}>
                {t('common.delete')}
              </Button>
            ) : null;
          }}
        />
      )}
    </>
  );
}
