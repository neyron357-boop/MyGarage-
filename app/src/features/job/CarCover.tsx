import { ActionIcon, Button, Group, Stack } from '@mantine/core';
import { useAiWorking } from '../ai/Ai';
import { IconCamera, IconCameraPlus, IconCar, IconPhoto, IconTrash } from '@tabler/icons-react';
import { useRef, useState, type ReactNode } from 'react';
import { db } from '../../db/db';
import { useTranslation } from 'react-i18next';
import { carOwned, coverOf, MULKIYA_SIDES, mulkiyaOf, removeCarPhoto, restoreCarPhoto, rotateCarPhoto, setCover, setMulkiya, setVinPhoto, vinPhotoOf, type CarSlot, type MulkiyaSide } from '../../services/cover';
import { carPhotoLater } from '../../services/carPhoto';
import { MediaImage, undoToast } from '../../ui/components';
import { AheadPill } from '../../ui/DateFields';
import { dubaiDate, formatDate } from '../../domain/dates';
import { expiryState } from '../../domain/mulkiya';
import { readMulkiyaExpiry, setMulkiyaExpiry } from '../../services/mulkiya';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { usePhotoPick } from '../../ui/photoPick';
import { readVin, TypeVinButton, useVinState, VinButton, VinCheckSheet, VinTypeIn } from './VinRead';

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
  // A car with no make or model yet: the AI looks at the photo (v0.89, services/carPhoto.ts — once, a small picture).
  const pick = usePhotoPick(([file]) =>
    void run(async () => {
      await setCover(vehicleId, file);
      carPhotoLater(vehicleId, file);
    }),
  );
  const edits = useCarPhotoEdits(vehicleId);
  if (!cover) return <div className="action-tile job-cover" data-empty="true" aria-hidden="true" />;
  // A closed job shows the photo if the car has one — not a tile asking for it.
  if (hideEmpty && !cover.id) return null;
  return (
    <>
      {cover.id ? (
        <button type="button" className="action-tile job-cover" aria-label={t('job.carPhoto')} {...pick.handlers} onClick={() => !pick.consumeClick() && setViewing(true)}>
          <MediaImage id={cover.id} card h="100%" w="100%" radius="0" />
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

/** Under a VIN or Mulkiya photo: read the VIN off it, or (v0.73) type it by hand looking at it. */
/**
 * The Mulkiya's expiry (audit 27/11): read off its front on the phone, or picked here by hand — «Сегодня» reminds the
 * customer two weeks before it. Orange within a month, red when past.
 */
function MulkiyaExpiry({ vehicleId, expires }: { vehicleId: string; expires?: string }) {
  const { t } = useTranslation();
  const { run } = useAction();
  return (
    <AheadPill
      value={expires}
      state={expiryState(expires, dubaiDate())}
      label={t('mulkiya.until')}
      placeholder={t('mulkiya.expires')}
      onChange={(day) => void run(() => setMulkiyaExpiry(vehicleId, day))}
    />
  );
}

function VinCaption({ vehicleId, onLook, onType }: { vehicleId: string; onLook: () => void; onType: () => void }) {
  return (
    <Group gap="sm" justify="center" wrap="nowrap">
      <VinButton vehicleId={vehicleId} onLook={onLook} />
      <TypeVinButton onOpen={onType} />
    </Group>
  );
}

/**
 * The car's VIN photo as a small tile in the job's card: without one, a tap opens the camera and a long
 * press the phone's photos; with one, the thumbnail — a tap shows it full screen (the VIN typed on the car
 * as its title: retake, choose another, share, read the VIN off it), a long press chooses another from the
 * photos. A photo taken is read at once (./VinRead.tsx): the chip scans while it reads; a read VIN waiting to be
 * looked at puts an orange dot on it, and its full view has "Check VIN" (v0.21: the tap still shows the photo;
 * with no VIN photo the dot is on the Mulkiya the VIN was read off).
 */
export function VinTile({ vehicleId, vin, year, hideEmpty }: { vehicleId: string; vin?: string; year?: number; hideEmpty?: boolean }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const photo = useScreenLiveQuery(async () => ({ id: await vinPhotoOf(vehicleId) }), [vehicleId]);
  const [viewing, setViewing] = useState(false);
  // The VIN typed by hand right in the photo's view (v0.73).
  const [typing, setTyping] = useState(false);
  const pick = usePhotoPick(
    ([file]) =>
      void run(async () => {
        await setVinPhoto(vehicleId, file);
        return true;
      }).then((ok) => ok && readVin(vehicleId, t)),
  );
  const edits = useCarPhotoEdits(vehicleId);
  const vinState = useVinState(vehicleId);
  // The garage's AI reading the VIN (v0.48.1): a ring of its colours breathes round the chip.
  const aiReading = useAiWorking(`car:${vehicleId}`);
  const sheet = <VinCheckSheet vehicleId={vehicleId} current={{ vin, year }} />;
  // A closed job shows the VIN photo if there is one — not an empty tile asking for it.
  if (hideEmpty && !photo?.id) return sheet;
  return (
    <>
      {/* A chip among the card's chips: a camera while there is no photo, its round thumbnail once there is. */}
      <button
        type="button"
        className="chip vin-chip ai-ring"
        data-ai-busy={aiReading || undefined}
        data-empty={!photo?.id || undefined}
        data-reading={vinState.reading || undefined}
        data-check={(vinState.check && !vinState.reading && !!photo?.id) || undefined}
        aria-busy={vinState.reading || undefined}
        aria-label={photo?.id ? t('job.vinPhoto') : t('job.vinTake')}
        {...pick.handlers}
        onClick={() => {
          if (pick.consumeClick()) return;
          // Not read yet whether there is a photo: no camera over one there may be.
          if (!photo) return;
          if (photo.id) setViewing(true);
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
          items={[
            {
              id: photo.id,
              title: vin ? `VIN ${vin}` : 'VIN',
              caption: typing ? (
                <VinTypeIn vehicleId={vehicleId} current={{ vin, year }} onDone={() => setTyping(false)} />
              ) : (
                <VinCaption vehicleId={vehicleId} onLook={() => setViewing(false)} onType={() => setTyping(true)} />
              ),
            },
          ]}
          index={0}
          onIndex={() => undefined}
          onClose={() => {
            setTyping(false);
            setViewing(false);
          }}
          typing={typing}
          onRotate={(it) => edits.rotate('vin', it.id)}
          actions={(it) => typing ? null : (
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
 * In a Mulkiya's full view while one of its sides is still missing: that side — a tap takes it with the camera, a
 * long press picks it from the phone's photos, as on the chip.
 */
function AddSide({ side, onFiles }: { side: MulkiyaSide; onFiles: (files: File[]) => void }) {
  const { t } = useTranslation();
  const pick = usePhotoPick(onFiles);
  return (
    <>
      <Button radius="xl" size="md" variant="white" color="dark" className="add-side" leftSection={<IconCameraPlus size={18} />} {...pick.handlers} onClick={() => !pick.consumeClick() && pick.camera()}>
        {t(`slot.${side}`)}
      </Button>
      {pick.inputs}
    </>
  );
}

/**
 * The car's Mulkiya (the registration card), both sides, as a chip beside VIN: empty, a tap takes the front with the
 * camera, a long press picks from the phone's photos — two at once go in as front and back. With a side or both
 * ("1/2" while one is there), a tap shows them full screen (v0.21: the saved photo first, as the VIN's): swipe between
 * the sides — retake or choose another for the one shown — and, while a side is missing, take or pick it right there;
 * a long press chooses again from the photos (the missing side first). A read VIN waiting to be looked at puts an
 * orange dot here when the VIN has no photo of its own (the full view has "Check VIN").
 */
export function MulkiyaTile({ vehicleId, hideEmpty }: { vehicleId: string; hideEmpty?: boolean }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const found = useScreenLiveQuery(async () => {
    const sides = await mulkiyaOf(vehicleId);
    return { sides, own: await carOwned(Object.values(sides)), vin: !!(await vinPhotoOf(vehicleId)), expires: (await db.vehicles.get(vehicleId))?.regExpires };
  }, [vehicleId]);
  const photos = found?.sides;
  const edits = useCarPhotoEdits(vehicleId);
  const [viewing, setViewing] = useState<number | null>(null);
  // The VIN typed by hand right in the Mulkiya's view (v0.73): the card's VIN and year to start from — read as the view
  // opens, so the field comes in the tap itself (an iPhone gives the keyboard only to a field focused in the tap).
  const [typing, setTyping] = useState(false);
  const car = useScreenLiveQuery(async () => (viewing !== null ? { v: await db.vehicles.get(vehicleId) } : undefined), [viewing !== null, vehicleId]);
  const present = MULKIYA_SIDES.filter((s) => photos?.[s]);
  const missing = MULKIYA_SIDES.filter((s) => !photos?.[s]);
  /** Photos into the sides in this order (several picked at once: one side each). */
  const store = (order: MulkiyaSide[]) => (files: File[]) =>
    void run(async () => {
      for (let i = 0; i < files.length && i < order.length; i++) await setMulkiya(vehicleId, order[i], files[i]);
      return true;
    }).then((ok) => {
      if (!ok) return;
      readVin(vehicleId, t);
      // Audit 27/11: the front's expiry, read on the phone after the VIN (one reader at a time) — each photo once.
      void readMulkiyaExpiry(vehicleId).catch(() => undefined);
    });
  // The chip: one photo goes to the side still missing (the front first); several are front and back, in that order.
  const pick = usePhotoPick((files) => store(files.length > 1 ? MULKIYA_SIDES : [...missing, ...present])(files), { multiple: true });
  // The full view's "retake" / "from photos": the side shown — set right as either is opened.
  const shown = useRef<MulkiyaSide>('mulkiya');
  const sidePick = usePhotoPick((files) => store([shown.current])(files));
  const vinState = useVinState(vehicleId);
  if (hideEmpty && !present.length) return null;
  const caption = typing ? (
    <VinTypeIn vehicleId={vehicleId} current={{ vin: car?.v?.vin, year: car?.v?.year }} onDone={() => setTyping(false)} />
  ) : (
    <VinCaption vehicleId={vehicleId} onLook={() => setViewing(null)} onType={() => car && setTyping(true)} />
  );
  const withExpiry = typing ? (
    caption
  ) : (
    <Stack gap="xs" align="center">
      <MulkiyaExpiry vehicleId={vehicleId} expires={found?.expires} />
      {caption}
    </Stack>
  );
  const items = present.map((s) => ({ id: photos![s]!, title: t(`slot.${s}`), side: s, caption: withExpiry }));
  const due = expiryState(found?.expires, dubaiDate());
  return (
    <>
      <button
        type="button"
        className="chip vin-chip"
        data-empty={!present.length || undefined}
        data-reading={(vinState.reading && present.length > 0) || undefined}
        data-check={(vinState.check && !vinState.reading && present.length > 0 && found && !found.vin) || undefined}
        aria-busy={vinState.reading || undefined}
        aria-label={present.length ? t('intake.mulkiya') : t('job.mulkiyaTake')}
        {...pick.handlers}
        onClick={() => {
          if (pick.consumeClick()) return;
          // Not read yet what is there: no camera over a side there may be.
          if (!found) return;
          if (present.length) setViewing(0);
          else pick.camera();
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
        {/* Audit 27/11: the registration runs out within a month (orange) or has (red). */}
        {(due === 'soon' || due === 'past') && found?.expires && (
          <span className="chip-note tnum" data-due={due} data-mulkiya-due>
            {formatDate(found.expires).slice(0, 5)}
          </span>
        )}
      </button>
      {pick.inputs}
      {sidePick.inputs}
      {viewing !== null && items.length > 0 && (
        <PhotoViewer
          items={items}
          index={Math.min(viewing, items.length - 1)}
          onIndex={setViewing}
          onClose={() => {
            setTyping(false);
            setViewing(null);
          }}
          typing={typing}
          onRotate={(item) => edits.rotate(items.find((x) => x.id === item.id)?.side ?? 'mulkiya', item.id)}
          actions={(item) => {
            // Typing the VIN: the field alone at the foot, the photo above it.
            if (typing) return null;
            const side = items.find((x) => x.id === item.id)?.side ?? 'mulkiya';
            const replace = (
              <ReplaceButtons
                camera={() => {
                  shown.current = side;
                  sidePick.camera();
                }}
                gallery={() => {
                  shown.current = side;
                  sidePick.gallery();
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
            // A side still missing: taken or picked from here, as on the chip.
            return missing.length ? (
              <Stack gap="sm" align="center">
                <AddSide
                  side={missing[0]}
                  onFiles={(files) => {
                    store([missing[0]])(files);
                    // The side just added is the one shown (the sides go front, back).
                    setViewing(MULKIYA_SIDES.indexOf(missing[0]));
                  }}
                />
                {replace}
              </Stack>
            ) : (
              replace
            );
          }}
        />
      )}
    </>
  );
}
