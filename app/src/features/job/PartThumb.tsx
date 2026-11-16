import { IconCamera } from '@tabler/icons-react';
import { useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrderItem } from '../../domain/types';
import { setLinePhotos } from '../../services/estimate';
import { MediaImage } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import { usePhotoPick } from '../../ui/photoPick';
import { PhotoViewer } from '../../ui/PhotoViewer';

/**
 * A part's photo beside its name on the job (v0.29): none yet — a place for it (a tap: the camera, a hold: the phone's
 * photos, several at once); taken — the photo itself, a tap shows it full (all of them, the number in its corner). The
 * thumb keeps its touches: the line under it neither swipes nor opens nor is picked by them.
 */
export function PartThumb({ item, editable }: { item: OrderItem; editable: boolean }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [viewing, setViewing] = useState<number | null>(null);
  const ids = item.mediaIds ?? [];
  const pick = usePhotoPick((files) => void run(async () => (await setLinePhotos(item.id, ids, files), haptic('light'))), { multiple: true });
  if (!ids.length && !editable) return null;
  const h = ids.length ? undefined : pick.handlers;
  const own =
    <E extends SyntheticEvent>(fn?: (e: E) => void) =>
    (e: E) => {
      e.stopPropagation();
      fn?.(e);
    };
  return (
    <>
      <button
        type="button"
        className="part-thumb"
        data-empty={!ids.length || undefined}
        aria-label={t('job.partPhoto')}
        onPointerDown={own(h?.onPointerDown)}
        onPointerMove={own(h?.onPointerMove)}
        onPointerUp={own(h?.onPointerUp)}
        onPointerCancel={own(h?.onPointerCancel)}
        onTouchStart={own()}
        onTouchMove={own(h?.onTouchMove)}
        onTouchEnd={own(h?.onTouchEnd)}
        onTouchCancel={own(h?.onTouchCancel)}
        onContextMenu={own(h?.onContextMenu ?? ((e) => e.preventDefault()))}
        onClick={own(() => (ids.length ? setViewing(0) : !pick.consumeClick() && pick.camera()))}
      >
        {ids.length ? <MediaImage id={ids[0]} h={44} w={44} radius="md" /> : <IconCamera size={20} stroke={1.8} aria-hidden />}
        {ids.length > 1 && <span className="part-thumb-n">{ids.length}</span>}
      </button>
      {/* The pickers sit inside the line: their own clicks (the camera opened) must not reach it. */}
      <span hidden onClick={(e) => e.stopPropagation()}>
        {pick.inputs}
      </span>
      {viewing !== null && <PhotoViewer items={ids.map((id) => ({ id }))} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />}
    </>
  );
}
