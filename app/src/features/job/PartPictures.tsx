import { Button } from '@mantine/core';
import { IconCircleDot, IconX } from '@tabler/icons-react';
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { diagramOf, marksOf, outlineKey } from '../../domain/diagramSheet';
import { itemTitle } from '../../domain/items';
import type { OrderItem } from '../../domain/types';
import { cachedOutlinedUrl, outlinedUrl } from '../../services/diagramSheet';
import { useHistoryLayer } from '../../ui/historyLayer';
import { useLang } from '../../ui/hooks';
import { PhotoViewer, type ViewerItem } from '../../ui/PhotoViewer';
import { MarkEditor } from './MarkEditor';

/*
 * A part line's pictures full screen (v0.64, the user: «можно нарисовать обводку прямо в карточке заказа, когда открываю
 * фото, и сохранить в таком виде»): the line's own photos, the diagram and the samples the AI found — and on a diagram
 * «Обвести»: the outline editor over the viewer, the same outlines as the suppliers' «Схемы» (`diagramMarks`). The
 * outlined diagram is shown, shared and saved with its outlines drawn in (services/diagramSheet.ts `outlinedPicture`);
 * the diagram itself stays as it came. The line's preview and its sheet's tiles show it outlined too.
 */

export interface PartPicture {
  id: string;
  /** A photo not stored yet (picked in the sheet, not saved). */
  src?: string;
  kind: 'own' | 'diagram' | 'sample';
  title?: string;
  caption?: ReactNode;
}

type Outlinable = Pick<OrderItem, 'diagramIds' | 'diagramMark' | 'diagramMarks'>;

/** The part's outlined diagram — its id and the picture with the outlines drawn in (none outlined — none). */
export function useOutlined(item?: Outlinable): { id: string; url: string } | undefined {
  const id = item ? diagramOf(item) : undefined;
  const marks = item ? marksOf(item) : [];
  const key = id ? outlineKey(id, marks) : '';
  const [made, setMade] = useState<{ key: string; url: string }>();
  useEffect(() => {
    if (!key || !id) return;
    let alive = true;
    void outlinedUrl(id, marks).then((u) => alive && u && setMade({ key, url: u }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key || !id) return undefined;
  const url = made?.key === key ? made.url : cachedOutlinedUrl(id, marks);
  return url ? { id, url } : undefined;
}

/**
 * The outline editor over the photo viewer: a full-screen layer of its own (Back and Escape close it, not the viewer);
 * «Готово» keeps the outlines and makes the outlined picture before the layer goes — the viewer shows it at once.
 */
function MarkLayer({ item, diagramId, onClose }: { item: OrderItem; diagramId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const release = useHistoryLayer('mgMark', onClose);
  const close = () => {
    release();
    onClose();
  };
  useEffect(() => {
    // Before the viewer and the sheets hear it (they listen on the window too).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      release();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [release, onClose]);
  return createPortal(
    <div className="mark-layer rise-enter" role="dialog" aria-modal="true" aria-label={t('diagrams.ring')} data-mark-layer>
      <div className="mark-layer-top">
        <button type="button" className="cam-icon mark-layer-close" onClick={close} aria-label={t('camera.close')}>
          <IconX size={22} />
        </button>
        <div className="mark-layer-title">{itemTitle(item, lang) || t('diagrams.ring')}</div>
        <span className="cam-icon-spacer" aria-hidden />
      </div>
      <div className="mark-layer-body">
        <MarkEditor
          item={item}
          diagramId={diagramId}
          fit
          onDone={async (marks) => {
            await outlinedUrl(diagramId, marks).catch(() => undefined);
            close();
          }}
        />
      </div>
    </div>,
    document.body,
  );
}

/**
 * The part's pictures full screen: its outlined diagram with the outlines drawn in, «Обвести» on each diagram (`item` — the
 * line as it is now; without it — the viewer alone), `actions` — what else a picture has (a photo of the line's own: «Удалить»).
 */
export function PartPhotoViewer({
  item,
  pictures,
  index,
  onIndex,
  onClose,
  actions,
}: {
  item?: OrderItem;
  pictures: PartPicture[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  actions?: (p: PartPicture) => ReactNode;
}) {
  const { t } = useTranslation();
  const outlined = useOutlined(item);
  const [marking, setMarking] = useState<string | null>(null);
  const items: ViewerItem[] = pictures.map((p) => ({ id: p.id, src: p.src ?? (outlined?.id === p.id ? outlined.url : undefined), title: p.title, caption: p.caption }));
  return (
    // The viewer and the editor are portals, but React carries their touches up its own tree — to the job's line that
    // opened them (its swipe, its long press, its tap) or the sheet under them: they stop here.
    <span hidden {...SHIELD}>
      <PhotoViewer
        items={items}
        index={Math.min(index, Math.max(0, items.length - 1))}
        onIndex={onIndex}
        onClose={onClose}
        paused={!!marking}
        actions={(it) => {
          const p = pictures.find((x) => x.id === it.id);
          if (!p) return null;
          const own = actions?.(p);
          const ring =
            item && p.kind === 'diagram' && (item.diagramIds ?? []).includes(p.id) ? (
              <Button key="ring" radius="xl" size="md" variant="default" className="viewer-pill" leftSection={<IconCircleDot size={18} />} onClick={() => setMarking(p.id)} data-mark-open>
                {t('diagrams.ring')}
              </Button>
            ) : null;
          return own || ring ? (
            <>
              {ring}
              {own}
            </>
          ) : null;
        }}
      />
      {item && marking && <MarkLayer item={item} diagramId={marking} onClose={() => setMarking(null)} />}
    </span>
  );
}

const stop = (e: SyntheticEvent) => e.stopPropagation();
/** What a full-screen layer's touches must not carry to the row or sheet it was opened from (keys: only Enter and Space — the row's). */
const SHIELD = {
  onClick: stop,
  onPointerDown: stop,
  onPointerMove: stop,
  onPointerUp: stop,
  onPointerCancel: stop,
  onTouchStart: stop,
  onTouchMove: stop,
  onTouchEnd: stop,
  onTouchCancel: stop,
  onMouseDown: stop,
  onMouseUp: stop,
  onContextMenu: stop,
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => (e.key === 'Enter' || e.key === ' ') && e.stopPropagation(),
};
