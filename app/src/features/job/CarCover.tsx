import { ActionIcon, Button, Group } from '@mantine/core';
import { IconCamera, IconCameraPlus, IconCar, IconPhoto, IconTrash } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { carOwned, coverOf, MULKIYA_SIDES, mulkiyaOf, removeCarPhoto, restoreCarPhoto, rotateCarPhoto, setCover, setMulkiya, setVinPhoto, vinPhotoOf, type CarSlot, type MulkiyaSide } from '../../services/cover';
import { MediaImage, undoToast } from '../../ui/components';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { usePhotoPick } from '../../ui/photoPick';
import { openVinCheck, readVin, useVinState, VinButton, VinCheckSheet } from './VinRead';

/**
 * In the photo's full-screen view: take it again, choose another one from the phone's photos, or take a wrong
 * one off (the car's own photo; a check-in act's photo stays as the act has it).
 */
function ReplaceButtons({ camera, gallery, onDelete }: { camera: () => void; gallery: () => void; onDelete?: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <Group gap="sm" justify="center" wrap="nowrap">
      <Button radius="xl" size="md" variant="white" color="dark" leftSection={<IconCamera size={18} />} onClick={camera}>
        {t('job.retakePhoto')}
      </Button>
      <Button radius="xl" size="md" variant="white" color="dark" leftSection={<IconPhoto size={18} />} onClick={gallery}>
        {t('job.fromPhotos')}
      </Button>
      {onDelete && (
        <ActionIcon size={44} radius="xl" variant="white" color="red" aria-label={t('common.delete')} onClick={onDelete}>
          <IconTrash size={20} />
        </ActionIcon>
      )}
    </Group>
  );
}

/**
 * The full-screen view's two edits of a car's photo: turn it (a quarter to the left — the turned copy takes its
 * place) and take it off (with Undo).
 */
function useCarPhotoEdits(vehicleId: string) {
  const { t } = useTranslation();
  const { run } = useAction();
  return {
    rotate: async (slot: CarSlot, mediaId: string) => {
      if (!(await run(() => rotateCarPhoto(vehicleId, slot, mediaId)))) throw new Error('not turned');
    },
    remove: (mediaId: string) =>
      run(async () => {
        const removed = await removeCarPhoto(mediaId);
        undoToast(t('photos.removed'), t('common.undo'), () => void restoreCarPhoto(removed));
      }),
  };
}

/**
 * The car's main photo across the top of the job's card. Without one, a tap on the tile opens the camera
 * (one shot becomes the car's photo) and a long press the phone's photos; with one, a tap shows it full
 * screen (retake it or choose another), a long press chooses another from the photos.
 */
export function CarCover({ vehicleId, hideEmpty }: { vehicleId: string; hideEmpty?: boolean }) {
  const { t } = useTranslation();
  const { run } = useAction();
  // The photo, and whether it is the car's own (one taken from a check-in act is not taken off here).
  const cover = useScreenLiveQuery(async () => {
    const id = await coverOf(vehicleId);
    return { id, own: !!id && (await carOwned([id])).has(id) };
  }, [vehicleId]);
  const [viewing, setViewing] = useState(false);
  const pick = usePhotoPick(([file]) => void run(() => setCover(vehicleId, file)));
  const edits = useCarPhotoEdits(vehicleId);
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
          onRotate={(it) => edits.rotate('cover', it.id)}
          actions={(it) => (
            <ReplaceButtons
              camera={pick.camera}
              gallery={pick.gallery}
              onDelete={
                cover.own
                  ? () => {
                      setViewing(false);
                      void edits.remove(it.id);
                    }
                  : undefined
              }
            />
          )}
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
 * as its title: retake, choose another, share, read the VIN off it), a long press chooses another from the
 * photos. A photo taken is read at once (./VinRead.tsx): the chip scans while it reads, and an orange dot on it
 * — a read VIN waiting to be looked at — makes a tap open that instead.
 */
export function VinTile({ vehicleId, vin, year, hideEmpty }: { vehicleId: string; vin?: string; year?: number; hideEmpty?: boolean }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const photo = useScreenLiveQuery(async () => ({ id: await vinPhotoOf(vehicleId) }), [vehicleId]);
  const [viewing, setViewing] = useState(false);
  const pick = usePhotoPick(
    ([file]) =>
      void run(async () => {
        await setVinPhoto(vehicleId, file);
        return true;
      }).then((ok) => ok && readVin(vehicleId, t)),
  );
  const edits = useCarPhotoEdits(vehicleId);
  const vinState = useVinState(vehicleId);
  const sheet = <VinCheckSheet vehicleId={vehicleId} current={{ vin, year }} />;
  // A closed job shows the VIN photo if there is one — not an empty tile asking for it.
  if (hideEmpty && !photo?.id) return sheet;
  return (
    <>
      {/* A chip among the card's chips: a camera while there is no photo, its round thumbnail once there is. */}
      <button
        type="button"
        className="chip vin-chip"
        data-empty={!photo?.id || undefined}
        data-reading={vinState.reading || undefined}
        data-check={(vinState.check && !vinState.reading) || undefined}
        aria-busy={vinState.reading || undefined}
        aria-label={vinState.check ? t('vinRead.checkBtn') : photo?.id ? t('job.vinPhoto') : t('job.vinTake')}
        {...pick.handlers}
        onClick={() => {
          if (pick.consumeClick()) return;
          if (vinState.check && !vinState.reading) openVinCheck(vehicleId);
          else if (photo?.id) setViewing(true);
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
      {sheet}
      {viewing && photo?.id && (
        <PhotoViewer
          items={[{ id: photo.id, title: vin ? `VIN ${vin}` : 'VIN', caption: <VinButton vehicleId={vehicleId} onLook={() => setViewing(false)} /> }]}
          index={0}
          onIndex={() => undefined}
          onClose={() => setViewing(false)}
          onRotate={(it) => edits.rotate('vin', it.id)}
          actions={(it) => (
            <ReplaceButtons
              camera={pick.camera}
              gallery={pick.gallery}
              onDelete={() => {
                setViewing(false);
                void edits.remove(it.id);
              }}
            />
          )}
        />
      )}
    </>
  );
}

/**
 * The car's Mulkiya (the registration card), both sides, as a chip beside VIN: a tap takes the side still
 * missing with the camera (the front first; "1/2" while one is there), a long press picks from the phone's
 * photos — two at once go in as front and back. With both, a tap shows them full screen (swipe between the
 * sides: retake or choose another for the one shown), a long press chooses them again from the photos.
 */
export function MulkiyaTile({ vehicleId, hideEmpty }: { vehicleId: string; hideEmpty?: boolean }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const found = useScreenLiveQuery(async () => {
    const sides = await mulkiyaOf(vehicleId);
    return { sides, own: await carOwned(Object.values(sides)) };
  }, [vehicleId]);
  const photos = found?.sides;
  const edits = useCarPhotoEdits(vehicleId);
  const [viewing, setViewing] = useState<number | null>(null);
  // The side a picker fills when it is not "the next missing one" (the side shown full screen).
  const [target, setTarget] = useState<MulkiyaSide | null>(null);
  const present = MULKIYA_SIDES.filter((s) => photos?.[s]);
  const missing = MULKIYA_SIDES.filter((s) => !photos?.[s]);
  const pick = usePhotoPick(
    (files) =>
      void run(async () => {
        // The side shown, or the missing ones first (front, back), then the rest in order.
        const order = target ? [target] : [...missing, ...present];
        setTarget(null);
        for (let i = 0; i < files.length && i < order.length; i++) await setMulkiya(vehicleId, order[i], files[i]);
        return true;
      }).then((ok) => ok && readVin(vehicleId, t)),
    { multiple: true },
  );
  const reading = useVinState(vehicleId).reading;
  if (hideEmpty && !present.length) return null;
  const caption = <VinButton vehicleId={vehicleId} onLook={() => setViewing(null)} />;
  const items = present.map((s) => ({ id: photos![s]!, title: t(`slot.${s}`), side: s, caption }));
  return (
    <>
      <button
        type="button"
        className="chip vin-chip"
        data-empty={!present.length || undefined}
        data-reading={(reading && present.length > 0) || undefined}
        aria-busy={reading || undefined}
        aria-label={present.length ? t('intake.mulkiya') : t('job.mulkiyaTake')}
        {...pick.handlers}
        onClick={() => {
          if (pick.consumeClick()) return;
          setTarget(null);
          if (missing.length) pick.camera();
          else setViewing(0);
        }}
      >
        {present.length ? (
          <span className="mulkiya-thumbs">
            {items.map((x) => (
              <span key={x.side} className="vin-thumb">
                <MediaImage id={x.id} h={26} w={26} radius="0" />
              </span>
            ))}
          </span>
        ) : (
          <IconCameraPlus size={17} stroke={1.9} aria-hidden />
        )}
        <span>{t('intake.mulkiya')}</span>
        {present.length === 1 && <span className="chip-note tnum">1/2</span>}
      </button>
      {pick.inputs}
      {viewing !== null && items.length > 0 && (
        <PhotoViewer
          items={items}
          index={Math.min(viewing, items.length - 1)}
          onIndex={setViewing}
          onClose={() => {
            setViewing(null);
            setTarget(null);
          }}
          onRotate={(item) => edits.rotate(items.find((x) => x.id === item.id)?.side ?? 'mulkiya', item.id)}
          actions={(item) => {
            const side = items.find((x) => x.id === item.id)?.side ?? 'mulkiya';
            return (
              <ReplaceButtons
                camera={() => {
                  setTarget(side);
                  pick.camera();
                }}
                gallery={() => {
                  setTarget(side);
                  pick.gallery();
                }}
                // The other side stays on screen; with the last one the view closes (and does not open by itself
                // when a new one is taken).
                onDelete={
                  found?.own.has(item.id)
                    ? () => {
                        if (items.length === 1) setViewing(null);
                        void edits.remove(item.id);
                      }
                    : undefined
                }
              />
            );
          }}
        />
      )}
    </>
  );
}
