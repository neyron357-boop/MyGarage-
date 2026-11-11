import { Button } from '@mantine/core';
import { IconCamera, IconCameraPlus, IconCar } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { coverOf, setCover } from '../../services/cover';
import { MediaImage } from '../../ui/components';
import { useAction } from '../../ui/hooks';
import { PhotoViewer } from '../../ui/PhotoViewer';

/**
 * The car's main photo across the top of the job's card. Without one, a tile opens the camera
 * (one shot becomes the car's photo); with one, a tap shows it full screen, where it can be retaken.
 */
export function CarCover({ vehicleId }: { vehicleId: string }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const cover = useLiveQuery(async () => ({ id: await coverOf(vehicleId) }), [vehicleId]);
  const [viewing, setViewing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!cover) return <div className="action-tile job-cover" data-empty="true" aria-hidden="true" />;
  const take = () => input.current?.click();
  return (
    <>
      {cover.id ? (
        <button type="button" className="action-tile job-cover" aria-label={t('job.carPhoto')} onClick={() => setViewing(true)}>
          <MediaImage id={cover.id} thumb={false} h="100%" w="100%" radius="0" />
        </button>
      ) : (
        <button type="button" className="action-tile job-cover" data-empty="true" aria-label={t('job.carPhoto')} onClick={take}>
          <IconCameraPlus size={26} stroke={1.7} aria-hidden />
          <span>{t('job.carPhoto')}</span>
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-cover-input
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void run(() => setCover(vehicleId, file));
        }}
      />
      {viewing && cover.id && (
        <PhotoViewer
          items={[{ id: cover.id }]}
          index={0}
          onIndex={() => undefined}
          onClose={() => setViewing(false)}
          actions={() => (
            <Button radius="xl" size="md" variant="white" color="dark" leftSection={<IconCamera size={18} />} onClick={take}>
              {t('job.retakePhoto')}
            </Button>
          )}
        />
      )}
    </>
  );
}

/** The car's main photo as a small square (a known car at check-in); a car symbol while there is none. */
export function CarThumb({ vehicleId, size = 56 }: { vehicleId: string; size?: number }) {
  const cover = useLiveQuery(async () => ({ id: await coverOf(vehicleId) }), [vehicleId]);
  return (
    <span className="car-thumb" style={{ width: size, height: size }}>
      {cover?.id ? <MediaImage id={cover.id} h={size} w={size} radius="0" /> : <IconCar size={Math.round(size * 0.46)} stroke={1.6} aria-hidden />}
    </span>
  );
}
