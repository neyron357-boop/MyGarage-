import { Button, Group } from '@mantine/core';
import { IconCamera, IconCameraPlus, IconCar, IconPhoto } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { coverOf, setCover, setVinPhoto, vinPhotoOf } from '../../services/cover';
import { MediaImage } from '../../ui/components';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { usePhotoPick } from '../../ui/photoPick';

/** In the photo's full-screen view: take it again, or choose another one from the phone's photos. */
function ReplaceButtons({ camera, gallery }: { camera: () => void; gallery: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <Group gap="sm" justify="center" wrap="nowrap">
      <Button radius="xl" size="md" variant="white" color="dark" leftSection={<IconCamera size={18} />} onClick={camera}>
        {t('job.retakePhoto')}
      </Button>
      <Button radius="xl" size="md" variant="white" color="dark" leftSection={<IconPhoto size={18} />} onClick={gallery}>
        {t('job.fromPhotos')}
      </Button>
    </Group>
  );
}

/**
 * The car's main photo across the top of the job's card. Without one, a tap on the tile opens the camera
 * (one shot becomes the car's photo) and a long press the phone's photos; with one, a tap shows it full
 * screen (retake it or choose another), a long press chooses another from the photos.
 */
export function CarCover({ vehicleId, hideEmpty }: { vehicleId: string; hideEmpty?: boolean }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const cover = useScreenLiveQuery(async () => ({ id: await coverOf(vehicleId) }), [vehicleId]);
  const [viewing, setViewing] = useState(false);
  const pick = usePhotoPick((file) => void run(() => setCover(vehicleId, file)));
  if (!cover) return <div className="action-tile job-cover" data-empty="true" aria-hidden="true" />;
  // A closed job shows the photo if the car has one — not a tile asking for it.
  if (hideEmpty && !cover.id) return null;
  return (
    <>
      {cover.id ? (
        <button type="button" className="action-tile job-cover" aria-label={t('job.carPhoto')} {...pick.handlers} onClick={() => !pick.consumeClick() && setViewing(true)}>
          <MediaImage id={cover.id} thumb={false} h="100%" w="100%" radius="0" />
        </button>
      ) : (
        <button type="button" className="action-tile job-cover" data-empty="true" aria-label={t('job.carPhoto')} {...pick.handlers} onClick={() => !pick.consumeClick() && pick.camera()}>
          <IconCameraPlus size={26} stroke={1.7} aria-hidden />
          <span>{t('job.carPhoto')}</span>
        </button>
      )}
      {pick.inputs}
      {viewing && cover.id && (
        <PhotoViewer
          items={[{ id: cover.id }]}
          index={0}
          onIndex={() => undefined}
          onClose={() => setViewing(false)}
          actions={() => <ReplaceButtons camera={pick.camera} gallery={pick.gallery} />}
        />
      )}
    </>
  );
}

/** The car's main photo as a small square (a known car at check-in); a car symbol while there is none. */
export function CarThumb({ vehicleId, size = 56 }: { vehicleId: string; size?: number }) {
  const cover = useScreenLiveQuery(async () => ({ id: await coverOf(vehicleId) }), [vehicleId]);
  return (
    <span className="car-thumb" style={{ width: size, height: size }}>
      {cover?.id ? <MediaImage id={cover.id} h={size} w={size} radius="0" /> : <IconCar size={Math.round(size * 0.46)} stroke={1.6} aria-hidden />}
    </span>
  );
}

/**
 * The car's VIN photo as a small tile in the job's card: without one, a tap opens the camera and a long
 * press the phone's photos; with one, the thumbnail — a tap shows it full screen (the VIN typed on the car
 * as its title: retake, choose another, share), a long press chooses another from the photos.
 */
export function VinTile({ vehicleId, vin, hideEmpty }: { vehicleId: string; vin?: string; hideEmpty?: boolean }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const photo = useScreenLiveQuery(async () => ({ id: await vinPhotoOf(vehicleId) }), [vehicleId]);
  const [viewing, setViewing] = useState(false);
  const pick = usePhotoPick((file) => void run(() => setVinPhoto(vehicleId, file)));
  // A closed job shows the VIN photo if there is one — not an empty tile asking for it.
  if (hideEmpty && !photo?.id) return null;
  return (
    <>
      {/* A chip among the card's chips: a camera while there is no photo, its round thumbnail once there is. */}
      <button
        type="button"
        className="chip vin-chip"
        data-empty={!photo?.id || undefined}
        aria-label={photo?.id ? t('job.vinPhoto') : t('job.vinTake')}
        {...pick.handlers}
        onClick={() => {
          if (pick.consumeClick()) return;
          if (photo?.id) setViewing(true);
          else pick.camera();
        }}
      >
        {photo?.id ? (
          <span className="vin-thumb">
            <MediaImage id={photo.id} h={26} w={26} radius="0" />
          </span>
        ) : (
          <IconCameraPlus size={17} stroke={1.9} aria-hidden />
        )}
        <span>VIN</span>
      </button>
      {pick.inputs}
      {viewing && photo?.id && (
        <PhotoViewer
          items={[{ id: photo.id, title: vin ? `VIN ${vin}` : 'VIN' }]}
          index={0}
          onIndex={() => undefined}
          onClose={() => setViewing(false)}
          actions={() => <ReplaceButtons camera={pick.camera} gallery={pick.gallery} />}
        />
      )}
    </>
  );
}
