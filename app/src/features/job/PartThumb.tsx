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
import { AiMark } from '../ai/Ai';

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
  // No photo of its own (v0.52): what the garage's AI found shows in its place — a photo of the part first, else its
  // diagram — with the AI's mark (it stays in the garage: the line's own photos are what goes to the customer).
  const ai = [...(item.sampleIds ?? []), ...(item.diagramIds ?? [])];
  const shown = ids.length ? ids : ai;
  const pick = usePhotoPick((files) => void run(async () => (await setLinePhotos(item.id, ids, files), haptic('light'))), { multiple: true });
  if (!shown.length && !editable) return null;
  const h = shown.length ? undefined : pick.handlers;
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
        data-empty={!shown.length || undefined}
        data-ai-preview={!ids.length && ai.length ? '' : undefined}
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
        onClick={own(() => (shown.length ? setViewing(0) : !pick.consumeClick() && pick.camera()))}
      >
        {shown.length ? <MediaImage id={shown[0]} h={44} w={44} radius="md" /> : <IconCamera size={20} stroke={1.8} aria-hidden />}
        {ids.length > 1 && <span className="part-thumb-n">{ids.length}</span>}
        {!ids.length && ai.length > 0 && (
          <span className="part-thumb-ai">
            <AiMark size={14} />
          </span>
        )}
      </button>
      {/* The pickers sit inside the line: their own clicks (the camera opened) must not reach it. */}
      <span hidden onClick={(e) => e.stopPropagation()}>
        {pick.inputs}
      </span>
      {viewing !== null && <PhotoViewer items={shown.map((id) => ({ id }))} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />}
    </>
  );
}
