import { ActionIcon, Button, Group, Modal } from '@mantine/core';
import { IconCircleDot, IconMinus, IconPhotoPlus, IconPlus } from '@tabler/icons-react';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { diagramOf, fitMark, MARK_DEFAULT, sheetEntries, stepMark, type DiagramMark } from '../../domain/diagramSheet';
import { itemTitle } from '../../domain/items';
import type { OrderItem } from '../../domain/types';
import { addDiagram, diagramSheets, setDiagramMark } from '../../services/diagramSheet';
import { mediaSrc } from '../../services/media';
import { List, ListRow, MediaImage } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { PhotoViewer } from '../../ui/PhotoViewer';

/*
 * The parts' diagrams for a supplier (v0.59, the user: «список запчастей… с фото схем деталей… в одной фотографии
 * максимум по 4 схемы с нумерациями и названия детали… обводка той самой детали… без ИИ»): the sheets made of them,
 * ready before the tap (iOS shares only right in it), and a row a part — its diagram, a tap to ring the part on it
 * (no diagram — a tap adds one: a catalogue's screenshot).
 */

/** What changes a sheet: the parts, their names, numbers, diagrams and rings. */
const keyOf = (items: OrderItem[]) =>
  items.map((i) => [i.id, i.titleEn, i.titleRu, i.partNumber, i.qty, (i.diagramIds ?? []).join('+'), i.diagramMark ? `${i.diagramMark.id}@${i.diagramMark.x},${i.diagramMark.y},${i.diagramMark.r}` : ''].join('|')).join('/');

/** The sheets of these parts as files and their pictures, made again when what is on them changes. */
export function useDiagramSheets(items: OrderItem[]): { files: File[]; urls: string[]; making: boolean } {
  const key = keyOf(items);
  const [made, setMade] = useState<{ key: string; files: File[]; urls: string[] }>({ key: '', files: [], urls: [] });
  useEffect(() => {
    let alive = true;
    let urls: string[] = [];
    void diagramSheets(items)
      .catch(() => [] as File[])
      .then((files) => {
        if (!alive) return;
        urls = files.map((f) => URL.createObjectURL(f));
        setMade({ key, files, urls });
      });
    return () => {
      alive = false;
      // the pictures of sheets gone: let them go a moment later (the new ones are on screen by then)
      window.setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 4000);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { files: made.files, urls: made.urls, making: made.key !== key && sheetEntries(items).length > 0 };
}

/** The sheets as tiles and the parts a row each: the diagram, ringed or not; a tap — ring it, or add one. */
export function DiagramParts({ items, sheets }: { items: OrderItem[]; sheets: { urls: string[] } }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run } = useAction();
  const [viewing, setViewing] = useState<number | null>(null);
  const [marking, setMarking] = useState<OrderItem | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const adding = useRef<string>('');
  if (!items.length) return null;
  const pick = (i: OrderItem) => {
    if (diagramOf(i)) return setMarking(i);
    adding.current = i.id;
    input.current?.click();
  };
  // The part being ringed, as it is now (its new diagram, its ring).
  const now = marking ? items.find((i) => i.id === marking.id) ?? marking : null;
  return (
    <>
      <div className="group-title">
        {t('diagrams.title')}
        {sheets.urls.length > 0 && <span className="count">{sheets.urls.length}</span>}
      </div>
      {sheets.urls.length > 0 && (
        <div className="line-media diagram-sheets" data-diagram-sheets>
          {sheets.urls.map((u, i) => (
            <button key={u} type="button" className="line-media-tile diagram-sheet-tile" data-kind="diagram" aria-label={`${t('diagrams.title')} ${i + 1}`} onClick={() => setViewing(i)}>
              <img src={u} alt="" />
            </button>
          ))}
        </div>
      )}
      <List className="diagram-parts">
        {items.map((i, k) => {
          const d = diagramOf(i);
          const ringed = !!d && i.diagramMark?.id === d;
          return (
            <ListRow
              key={i.id}
              onClick={() => pick(i)}
              left={
                <span className="diagram-thumb" data-empty={!d || undefined}>
                  {d ? <MediaImage id={d} h={44} w={44} radius="0" /> : <IconPhotoPlus size={20} stroke={1.8} aria-hidden />}
                </span>
              }
              title={`${k + 1}. ${itemTitle(i, lang)}`}
              subtitle={i.partNumber || undefined}
              right={d ? <IconCircleDot size={22} stroke={2} color={ringed ? 'var(--mantine-color-red-6)' : 'var(--app-label-3)'} aria-label={ringed ? t('diagrams.ringed') : t('diagrams.ring')} data-ringed={ringed || undefined} /> : undefined}
            />
          );
        })}
      </List>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        data-photo-input="diagram"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          const id = adding.current;
          if (!file || !id) return;
          void run(async () => {
            await addDiagram(id, file);
            haptic('light');
            const item = items.find((i) => i.id === id);
            if (item) setMarking(item);
          });
        }}
      />
      {viewing !== null && sheets.urls.length > 0 && (
        <PhotoViewer
          items={sheets.urls.map((u, i) => ({ id: `sheet-${i}`, src: u }))}
          index={Math.min(viewing, sheets.urls.length - 1)}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
      <LazySheet opened={!!now}>
        {(o) => (
          <Modal opened={o && !!now} onClose={() => setMarking(null)} title={now ? itemTitle(now, lang) : ''}>
            {now && diagramOf(now) && <MarkEditor key={diagramOf(now)} item={now} onDone={() => setMarking(null)} onAdd={() => pick({ ...now, diagramIds: [] })} />}
          </Modal>
        )}
      </LazySheet>
    </>
  );
}

/**
 * Ringing the part on its diagram: a tap puts the ring there (another tap moves it), − and + its size, «Готово» keeps
 * it. The ring is the manager's; nothing is guessed.
 */
function MarkEditor({ item, onDone, onAdd }: { item: OrderItem; onDone: () => void; onAdd: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const id = diagramOf(item)!;
  const [src, setSrc] = useState<string>();
  const [size, setSize] = useState<{ w: number; h: number }>();
  const [mark, setMark] = useState<DiagramMark | undefined>(item.diagramMark?.id === id ? item.diagramMark : undefined);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    void mediaSrc(id).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [id]);
  const place = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    haptic('selection');
    setMark((m) => fitMark({ id, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r: m?.r ?? MARK_DEFAULT }));
  };
  // The ring on screen: its radius a part of the picture's shorter side, as on the sheet.
  const ring = mark && size ? { left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, d: `${(mark.r * 2 * Math.min(size.w, size.h) * 100) / size.w}%` } : undefined;
  return (
    <div className="mark-editor">
      <div className="mark-editor-pic" ref={box} onClick={place} data-mark-pic>
        {src && <img src={src} alt="" draggable={false} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
        {ring && <span className="mark-ring" style={{ left: ring.left, top: ring.top, width: ring.d }} aria-hidden data-mark-ring />}
      </div>
      <Group justify="space-between" wrap="nowrap" mt="md" gap="sm">
        <Group gap={8} wrap="nowrap">
          <ActionIcon variant="light" color="gray" size={44} radius="xl" aria-label="−" disabled={!mark} onClick={() => mark && setMark({ ...mark, r: stepMark(mark.r, -1) })}>
            <IconMinus size={20} />
          </ActionIcon>
          <ActionIcon variant="light" color="gray" size={44} radius="xl" aria-label="+" disabled={!mark} onClick={() => mark && setMark({ ...mark, r: stepMark(mark.r, 1) })}>
            <IconPlus size={20} />
          </ActionIcon>
        </Group>
        <Button variant="subtle" color="gray" leftSection={<IconPhotoPlus size={18} />} onClick={onAdd}>
          {t('diagrams.another')}
        </Button>
      </Group>
      <Group grow mt="md" gap="sm" wrap="nowrap">
        <Button size="lg" variant="light" color="gray" disabled={!mark} onClick={() => setMark(undefined)}>
          {t('common.clear')}
        </Button>
        <Button
          size="lg"
          loading={busy}
          onClick={() =>
            void run(async () => {
              await setDiagramMark(item.id, mark);
              haptic('success');
              onDone();
            })
          }
        >
          {t('common.done')}
        </Button>
      </Group>
    </div>
  );
}
