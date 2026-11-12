import { ActionIcon, Button, Modal, Stack, Text, Textarea } from '@mantine/core';
import { IconArrowUp, IconCamera, IconMicrophone, IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerStopFilled, IconTrash, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, hoursBetween, shortDuration } from '../../domain/dates';
import type { JobNote } from '../../domain/types';
import { mediaUrl } from '../../services/media';
import { addNote, removeNote, restoreNote } from '../../services/notes';
import { List, ListRow, MediaImage, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { canRecord, clock, useRecorder } from '../../ui/recorder';

/** One player for all the voice notes on the screen: a new one stops the one playing. */
function usePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string>();
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
    a.onended = () => setPlaying(undefined);
    setPlaying(n.id);
    await a.play().catch(() => setPlaying(undefined));
  };
  return { playing, toggle };
}

/**
 * The job's notes at the bottom of its screen, like a chat with oneself: what the mechanic found, what
 * was checked, what the customer was promised — typed, a photo, or a voice message. The latest three
 * show; a tap opens one (to see it whole, or remove it).
 */
export function NotesSection({ orderId, notes, editable }: { orderId: string; notes: JobNote[]; editable: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const [all, setAll] = useState(false);
  const [text, setText] = useState('');
  const [opened, setOpened] = useState<JobNote | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const rec = useRecorder();
  const player = usePlayer();
  if (!notes.length && !editable) return null;
  const shown = all ? notes : notes.slice(-3);
  const ago = (iso: string) => {
    const h = hoursBetween(iso);
    return h < 24 ? t('notes.ago', { time: shortDuration(h, lang) }) : formatDateTime(iso);
  };
  const send = () =>
    run(async () => {
      if (!text.trim()) return;
      await addNote(orderId, { text });
      setText('');
      haptic('light');
    });
  const record = () =>
    run(async () => {
      const r = await rec.start();
      if (r) {
        await addNote(orderId, { voice: r.blob, seconds: r.seconds });
        haptic('success');
      }
    });
  const remove = (n: JobNote) =>
    run(async () => {
      const removed = await removeNote(n.id);
      setOpened(null);
      if (removed) undoToast(t('notes.removed'), t('common.undo'), () => void restoreNote(removed));
    });

  const row = (n: JobNote) => (
    <ListRow
      key={n.id}
      left={
        n.kind === 'voice' ? (
          <ActionIcon
            size={40}
            radius="xl"
            variant="light"
            aria-label={player.playing === n.id ? t('notes.pause') : t('notes.play')}
            onClick={(e) => {
              e.stopPropagation();
              void player.toggle(n);
            }}
          >
            {player.playing === n.id ? <IconPlayerPauseFilled size={18} /> : <IconPlayerPlayFilled size={18} />}
          </ActionIcon>
        ) : n.kind === 'photo' && n.mediaId ? (
          <span className="note-thumb">
            <MediaImage id={n.mediaId} h={44} w={44} radius="0" />
          </span>
        ) : undefined
      }
      title={
        n.kind === 'voice' ? (
          <Text span inherit className="tnum">
            {t('notes.voice')} · {clock(n.seconds ?? 0)}
          </Text>
        ) : (
          <Text span inherit style={{ whiteSpace: 'pre-wrap' }}>
            {n.text || t('notes.photo')}
          </Text>
        )
      }
      subtitle={ago(n.createdAt)}
      onClick={() => (n.kind === 'photo' && n.mediaId ? setViewing(n.id) : setOpened(n))}
      // A swipe to the left takes the note off (with Undo), as in the iPhone's lists.
      trailing={editable ? { label: t('common.delete'), icon: IconTrash, color: 'red', onCommit: () => void remove(n) } : undefined}
    />
  );

  const photos = notes.filter((n) => n.kind === 'photo' && n.mediaId);
  return (
    <div className="notes" aria-label={t('notes.title')}>
      <div className="group-title">{t('notes.title')}</div>
      {notes.length > 0 && (
        <List animate>
          {notes.length > 3 && !all && (
            <ListRow
              title={
                <Text span inherit c="cobalt.6">
                  {t('notes.all', { n: notes.length })}
                </Text>
              }
              onClick={() => setAll(true)}
            />
          )}
          {shown.map(row)}
        </List>
      )}
      {editable &&
        (rec.recording ? (
          <div className="note-composer recording" role="group" aria-label={t('notes.recording')}>
            <span className="rec-dot" aria-hidden />
            <Text className="tnum" fw={600} style={{ flex: 1 }}>
              {clock(rec.seconds)}
            </Text>
            <ActionIcon size={44} radius="xl" variant="subtle" color="gray" aria-label={t('common.cancel')} onClick={rec.cancel}>
              <IconX size={22} />
            </ActionIcon>
            <ActionIcon size={44} radius="xl" color="red" aria-label={t('notes.stop')} onClick={rec.stop}>
              <IconPlayerStopFilled size={20} />
            </ActionIcon>
          </div>
        ) : (
          <div className="note-composer">
            <Textarea
              aria-label={t('notes.add')}
              placeholder={t('notes.add')}
              autosize
              minRows={1}
              maxRows={6}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            {text.trim() ? (
              <ActionIcon size={44} radius="xl" aria-label={t('notes.send')} loading={busy} onClick={() => void send()}>
                <IconArrowUp size={22} stroke={2.4} />
              </ActionIcon>
            ) : (
              <>
                <ActionIcon size={44} radius="xl" variant="light" color="gray" aria-label={t('notes.addPhoto')} onClick={() => photoInput.current?.click()}>
                  <IconCamera size={21} />
                </ActionIcon>
                {canRecord() && (
                  <ActionIcon size={44} radius="xl" variant="light" aria-label={t('notes.record')} onClick={() => void record()}>
                    <IconMicrophone size={21} />
                  </ActionIcon>
                )}
              </>
            )}
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              data-note-photo
              onChange={(e) => {
                const files = [...(e.currentTarget.files ?? [])];
                e.currentTarget.value = '';
                if (files.length) void run(async () => {
                  for (const f of files) await addNote(orderId, { photo: f });
                  haptic('light');
                });
              }}
            />
          </div>
        ))}
      <Modal opened={!!opened} onClose={() => setOpened(null)} title={opened ? formatDateTime(opened.createdAt) : ''}>
        {opened && (
          <Stack gap="md">
            {opened.kind === 'voice' ? (
              <Button variant="light" size="lg" leftSection={player.playing === opened.id ? <IconPlayerPauseFilled size={20} /> : <IconPlayerPlayFilled size={20} />} onClick={() => void player.toggle(opened)}>
                {t('notes.voice')} · {clock(opened.seconds ?? 0)}
              </Button>
            ) : (
              <Text style={{ whiteSpace: 'pre-wrap' }} className="selectable">
                {opened.text}
              </Text>
            )}
            {editable && (
              <Button variant="subtle" color="red" leftSection={<IconTrash size={18} />} onClick={() => void remove(opened)}>
                {t('common.delete')}
              </Button>
            )}
          </Stack>
        )}
      </Modal>
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
    </div>
  );
}
