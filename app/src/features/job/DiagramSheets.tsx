import { Modal } from '@mantine/core';
import { IconCircleDot, IconPhotoPlus } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diagramOf, marksOf, sheetEntries } from '../../domain/diagramSheet';
import { itemTitle } from '../../domain/items';
import type { OrderItem } from '../../domain/types';
import { addDiagram, diagramSheets, warmDiagrams } from '../../services/diagramSheet';
import { List, ListRow, MediaImage } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { MarkEditor } from './MarkEditor';

/*
 * The parts' diagrams for a supplier (v0.59, the user: «список запчастей… с фото схем деталей… в одной фотографии
 * максимум по 4 схемы с нумерациями и названия детали… обводка той самой детали… без ИИ»): the sheets made of them,
 * ready before the tap (iOS shares only right in it), and a row a part — its diagram, a tap to outline the part on it
 * (no diagram — a tap adds one: a catalogue's screenshot). v0.59.1 (the user: «схема загружается очень медленно»,
 * «обводка очень простая… иногда нужно обводить несколько деталей в одной схеме»): the diagrams are brought at a card's
 * size as the screen opens; the outlines are ovals drawn by the finger, as many as the part has pieces.
 */

/** What changes a sheet: the parts, their names, numbers, diagrams and outlines. */
const keyOf = (items: OrderItem[]) =>
  items
    .map((i) =>
      [
        i.id,
        i.titleEn,
        i.titleRu,
        i.partNumber,
        i.qty,
        (i.diagramIds ?? []).join('+'),
        i.diagramMark ? `${i.diagramMark.id}@${i.diagramMark.x},${i.diagramMark.y},${i.diagramMark.r}` : '',
        (i.diagramMarks ?? []).map((m) => `${m.id}@${m.x},${m.y},${m.rx},${m.ry}`).join(';'),
      ].join('|'),
    )
    .join('/');

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

/** The sheets as tiles and the parts a row each: the diagram, outlined or not; a tap — outline it, or add one. */
export function DiagramParts({ items, sheets }: { items: OrderItem[]; sheets: { urls: string[] } }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run } = useAction();
  const [viewing, setViewing] = useState<number | null>(null);
  const [marking, setMarking] = useState<OrderItem | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const adding = useRef<string>('');
  // The diagrams brought at a card's size as the screen opens (v0.59.1): the outline sheet opens at once.
  const diagrams = items.map((i) => diagramOf(i) ?? '').join(',');
  useEffect(() => {
    void warmDiagrams(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagrams]);
  if (!items.length) return null;
  const pick = (i: OrderItem) => {
    if (diagramOf(i)) return setMarking(i);
    adding.current = i.id;
    input.current?.click();
  };
  // The part being outlined, as it is now (its new diagram, its outlines).
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
          const count = marksOf(i).length;
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
              right={
                d ? (
                  <span className="diagram-marked" data-ringed={count > 0 || undefined} aria-label={count ? t('diagrams.ringed') : t('diagrams.ring')}>
                    <IconCircleDot size={22} stroke={2} aria-hidden />
                    {count > 1 && <span className="tnum">{count}</span>}
                  </span>
                ) : undefined
              }
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
