import { Button } from '@mantine/core';
import { IconCameraPlus, IconTrash } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MediaImage } from './components';
import { PhotoViewer } from './PhotoViewer';

/** A photo in a strip: stored (`id` of the media) or picked and not saved yet (`src`, a local address). */
export interface StripPhoto {
  id: string;
  src?: string;
  /** Can be taken off (from the full-screen view). */
  removable?: boolean;
}

/**
 * A row of square photo tiles and a tile that adds more (camera or gallery, several at once); a tap
 * shows a photo full screen — share, save, or take a removable one off. Expense proofs, line photos.
 */
export function PhotoStrip({
  photos,
  onAdd,
  onRemove,
  addLabel,
  addAria,
  name,
}: {
  photos: StripPhoto[];
  onAdd?: (files: File[]) => void;
  onRemove?: (p: StripPhoto) => void;
  addLabel?: string;
  addAria?: string;
  /** Marks the hidden file input (`data-photo-input`), for tests. */
  name?: string;
}) {
  const { t } = useTranslation();
  const [viewing, setViewing] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (!photos.length && !onAdd) return null;
  const label = addLabel ?? t('photos.add');
  return (
    <>
      <div className="strip-row">
        {photos.map((p, i) => (
          <button key={p.id} type="button" className="action-tile strip-tile" aria-label={label} onClick={() => setViewing(i)}>
            {p.src ? <img src={p.src} alt="" /> : <MediaImage id={p.id} h="100%" w="100%" radius="0" />}
          </button>
        ))}
        {onAdd && (
          <button type="button" className="action-tile strip-tile" aria-label={addAria ?? t('photos.addAria')} onClick={() => input.current?.click()}>
            <IconCameraPlus size={24} stroke={1.7} aria-hidden />
            <span>{label}</span>
          </button>
        )}
      </div>
      {onAdd && (
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          data-photo-input={name ?? ''}
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = '';
            if (files.length) onAdd(files);
          }}
        />
      )}
      {viewing !== null && photos.length > 0 && (
        <PhotoViewer
          items={photos.map((p) => ({ id: p.id, src: p.src }))}
          index={Math.min(viewing, photos.length - 1)}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          actions={(it) => {
            const p = photos.find((x) => x.id === it.id);
            return p?.removable && onRemove ? (
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
