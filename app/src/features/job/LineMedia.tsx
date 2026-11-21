import { Button } from '@mantine/core';
import { IconCameraPlus, IconTrash } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { siteOf } from '../../domain/ai';
import type { OrderItem } from '../../domain/types';
import { MediaImage } from '../../ui/components';
import { useScreenLiveQuery } from '../../ui/hooks';
import type { StripPhoto } from '../../ui/PhotoStrip';
import { AiMark } from '../ai/Ai';
import { PartPhotoViewer, useOutlined } from './PartPictures';

/*
 * A line's pictures, all at the top of its sheet (v0.52, the user: «место для всех фотографий, включая результаты ИИ,
 * наверху; все фотографии одного фиксированного оптимального размера, остальное ниже»): one row of tiles of one size —
 * «Фото» first (the camera or the phone's photos), the line's own photos (they go to the customer with the estimate),
 * then what the garage's AI found: the part's catalogue diagram first (v0.55 — the part's place marked on it), then
 * photos of the part (samples), each marked with the AI's sign and a word (they stay in the garage). A tap — all of
 * them full screen, one after another; on a diagram — «Обвести» (v0.64), and the outlined one shows its outlines here.
 */

type Tile = StripPhoto & { kind: 'own' | 'sample' | 'diagram'; site?: string };

export function LineMedia({
  own,
  onAdd,
  onRemove,
  item,
  diagramIds = [],
  sampleIds = [],
}: {
  own: StripPhoto[];
  onAdd: (files: File[]) => void;
  onRemove: (p: StripPhoto) => void;
  /** The line as it is now (a part's): its diagrams are outlined on it. */
  item?: OrderItem;
  diagramIds?: string[];
  sampleIds?: string[];
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const outlined = useOutlined(item);
  const ai = useScreenLiveQuery(async () => {
    const of = async (ids: string[]) => (await db.media.bulkGet(ids)).filter((m) => !!m).map((m) => ({ id: m!.id, site: siteOf(m!.name ?? '') }));
    return { samples: await of(sampleIds), diagrams: await of(diagramIds) };
  }, [sampleIds.join(','), diagramIds.join(',')]);
  const tiles: Tile[] = [
    ...own.map((p) => ({ ...p, kind: 'own' as const })),
    // The diagram first, then the sample (v0.55).
    ...(ai?.diagrams ?? []).map((d) => ({ id: d.id, kind: 'diagram' as const, site: d.site })),
    ...(ai?.samples ?? []).map((s) => ({ id: s.id, kind: 'sample' as const, site: s.site })),
  ];
  const word = (k: Tile['kind']) => (k === 'diagram' ? t('ai.diagram') : k === 'sample' ? t('ai.sample') : '');
  return (
    <>
      <div className="line-media" data-line-media>
        <button type="button" className="line-media-tile line-media-add" aria-label={t('photos.addAria')} onClick={() => input.current?.click()}>
          <IconCameraPlus size={26} stroke={1.7} aria-hidden />
          <span>{t('photos.add')}</span>
        </button>
        {tiles.map((p, i) => {
          const ringed = p.kind === 'diagram' && outlined?.id === p.id;
          return (
            <button key={p.id} type="button" className="line-media-tile" data-kind={p.kind} data-outlined={ringed || undefined} aria-label={word(p.kind) || t('photos.add')} onClick={() => setViewing(i)}>
              {p.src ? <img src={p.src} alt="" /> : ringed ? <img src={outlined.url} alt="" /> : <MediaImage id={p.id} h="100%" w="100%" radius="0" />}
              {p.kind !== 'own' && (
                <span className="line-media-ai">
                  <AiMark size={16} />
                  <span>{word(p.kind)}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-photo-input="line"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length) onAdd(files);
        }}
      />
      {viewing !== null && tiles.length > 0 && (
        <PartPhotoViewer
          item={item}
          pictures={tiles.map((p) => ({ id: p.id, src: p.src, kind: p.kind, title: word(p.kind) || undefined, caption: p.site }))}
          index={Math.min(viewing, tiles.length - 1)}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          actions={(it) => {
            const p = tiles.find((x) => x.id === it.id);
            return p?.kind === 'own' && p.removable ? (
              <Button radius="xl" size="md" variant="light" color="red" leftSection={<IconTrash size={18} />} onClick={() => onRemove(p)}>
                {t('common.delete')}
              </Button>
            ) : null;
          }}
        />
      )}
    </>
  );
}
