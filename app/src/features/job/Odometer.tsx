import { Box, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { IconCamera, IconCameraPlus, IconGauge, IconPhoto } from '@tabler/icons-react';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../domain/dates';
import { fitsPrevious, formatKm, parseKm } from '../../domain/odometer';
import type { Order } from '../../domain/types';
import { odometerPhotoOf, previousMileage, readJobOdometer, setJobMileage, setOdometerPhoto } from '../../services/mileage';
import { MediaImage, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { usePhotoPick } from '../../ui/photoPick';

/*
 * The car's mileage on this visit (v0.44): a chip among the job card's chips — a tap takes the odometer's photo (a
 * long press picks one from the phone), read at once on the phone (services/odometerReader.ts): a sure reading goes in
 * by itself («Отменить»), a doubtful one puts an orange dot on the chip. Its sheet: the photo, the number (the readings
 * to pick in one tap), and the mileage of the car's last visit with how far it has gone since.
 */

type JobFor = Pick<Order, 'id' | 'vehicleId' | 'createdAt' | 'arrivedAt' | 'mileageKm' | 'mileageOffered'>;
type T = (key: string, opts?: Record<string, unknown>) => string;

/** The jobs whose odometer photo is being read now (the chip's band of light runs while it is). */
const reading = new Set<string>();
/** A photo came while the job's last one was being read: read again when that one is done. */
const again = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
function useReading(orderId: string): boolean {
  useSyncExternalStore(subscribe, () => version);
  return reading.has(orderId);
}

/** The job's odometer photo read, its result told: what went in (with «Отменить»), or the dot that waits. */
function readIt(orderId: string, t: T) {
  if (reading.has(orderId)) {
    again.add(orderId);
    return;
  }
  reading.add(orderId);
  emit();
  void readJobOdometer(orderId)
    .then((r) => {
      if (r.look) haptic('warning');
      if (r.filled === undefined) return;
      haptic('success');
      undoToast(t('odo.filled', { km: formatKm(r.filled) }), t('common.undo'), () => void setJobMileage(orderId, undefined), { replace: false });
    })
    .catch((e) => console.error(e))
    .finally(() => {
      reading.delete(orderId);
      emit();
      if (again.delete(orderId)) readIt(orderId, t);
    });
}

/**
 * The «Пробег» chip: empty — a camera (tap) and the phone's photos (a long press); with a mileage — its number (and
 * the photo's thumbnail); a reading waiting to be looked at — an orange dot. A tap then opens its sheet.
 */
export function OdometerChip({ order, open }: { order: JobFor; open: boolean }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const photo = useScreenLiveQuery(async () => ({ id: await odometerPhotoOf(order.id) }), [order.id]);
  const busy = useReading(order.id);
  const [sheet, setSheet] = useState(false);
  const take = (files: File[]) =>
    void run(async () => {
      await setOdometerPhoto(order.id, files[0]);
      return true;
    }).then((ok) => ok && readIt(order.id, t));
  const pick = usePhotoPick((files) => files[0] && take(files));
  const km = order.mileageKm;
  const offered = order.mileageOffered;
  // A closed job shows the mileage it has — not an empty chip asking for one.
  if (!open && km === undefined && !photo?.id) return null;
  const label = km !== undefined ? `${formatKm(km)} ${t('unit.km')}` : offered?.length ? `${formatKm(offered[0])}?` : t('odo.chip');
  return (
    <>
      <button
        type="button"
        className="chip vin-chip odo-chip"
        data-empty={(km === undefined && !photo?.id) || undefined}
        data-reading={busy || undefined}
        data-check={(!!offered && !busy) || undefined}
        aria-busy={busy || undefined}
        aria-label={t('odo.title')}
        {...pick.handlers}
        onClick={() => {
          if (pick.consumeClick()) return;
          // Not read yet whether there is a photo: no camera over one there may be.
          if (!photo) return;
          if (photo.id || km !== undefined) setSheet(true);
          else pick.camera();
        }}
      >
        {photo?.id ? (
          <span className="vin-thumb">
            <MediaImage id={photo.id} h={26} w={26} radius="0" />
          </span>
        ) : km !== undefined ? (
          <IconGauge size={17} stroke={1.9} aria-hidden />
        ) : (
          <IconCameraPlus size={17} stroke={1.9} aria-hidden />
        )}
        <span className="tnum">{label}</span>
      </button>
      {pick.inputs}
      <OdometerSheet order={order} photoId={photo?.id} opened={sheet} onClose={() => setSheet(false)} onPhoto={take} reading={busy} />
    </>
  );
}

/** The mileage's sheet: made anew each time it opens (what was typed last time is not there). */
function OdometerSheet({ order, photoId, opened, onClose, onPhoto, reading: busy }: { order: JobFor; photoId?: string; opened: boolean; onClose: () => void; onPhoto: (files: File[]) => void; reading: boolean }) {
  const { t } = useTranslation();
  const [n, setN] = useState(0);
  const [was, setWas] = useState(opened);
  if (opened !== was) {
    setWas(opened);
    if (opened) setN(n + 1);
  }
  return (
    <LazySheet opened={opened}>
      {(o) => (
        <Modal opened={o} onClose={onClose} title={t('odo.title')}>
          <OdometerPanel key={n} order={order} photoId={photoId} onDone={onClose} onPhoto={onPhoto} reading={busy} />
        </Modal>
      )}
    </LazySheet>
  );
}

function OdometerPanel({ order, photoId, onDone, onPhoto, reading: busy }: { order: JobFor; photoId?: string; onDone: () => void; onPhoto: (files: File[]) => void; reading: boolean }) {
  const { t } = useTranslation();
  const { run, busy: saving } = useAction();
  const first = order.mileageKm ?? order.mileageOffered?.[0];
  const [typed, setTyped] = useState(first !== undefined ? formatKm(first) : '');
  const [viewing, setViewing] = useState(false);
  const prev = useScreenLiveQuery(() => previousMileage(order), [order.id, order.vehicleId]);
  // A new photo from here: the sheet goes, the chip reads it (its band of light), as a photo taken on the chip.
  const pick = usePhotoPick((files) => {
    if (!files[0]) return;
    onPhoto(files);
    onDone();
  });
  const km = parseKm(typed);
  const since = km !== undefined && prev ? km - prev.km : undefined;
  const save = () =>
    run(async () => {
      await setJobMileage(order.id, km);
      haptic('success');
      onDone();
    });
  const remove = () =>
    run(async () => {
      const had = order.mileageKm;
      await setJobMileage(order.id, undefined);
      haptic('light');
      onDone();
      if (had !== undefined) undoToast(t('odo.removed'), t('common.undo'), () => void setJobMileage(order.id, had));
    });
  const offered = (order.mileageOffered ?? []).filter((x) => x !== km);
  return (
    <Stack gap="md">
      {photoId ? (
        <button type="button" className="odo-photo" aria-label={t('odo.photo')} onClick={() => setViewing(true)} data-reading={busy || undefined}>
          <MediaImage id={photoId} card h={200} w="100%" radius="0" />
        </button>
      ) : null}
      <Group gap="sm" grow>
        <Button variant="default" leftSection={<IconCamera size={18} />} onClick={pick.camera}>
          {photoId ? t('job.retakePhoto') : t('odo.photo')}
        </Button>
        <Button variant="default" leftSection={<IconPhoto size={18} />} onClick={pick.gallery}>
          {t('job.fromPhotos')}
        </Button>
      </Group>
      {pick.inputs}
      <TextInput
        label={t('odo.km')}
        aria-label={t('odo.km')}
        inputMode="numeric"
        placeholder="123 456"
        value={typed}
        onChange={(e) => setTyped(e.currentTarget.value)}
        autoComplete="off"
        error={typed.trim() && km === undefined ? t('err.mileage') : undefined}
        classNames={{ input: 'tnum' }}
      />
      {offered.length > 0 && (
        <div className="chip-row wrap" aria-label={t('odo.offered')}>
          {offered.map((x) => (
            <button key={x} type="button" className="chip tnum" onClick={() => (setTyped(formatKm(x)), haptic('selection'))}>
              {formatKm(x)}
            </button>
          ))}
        </div>
      )}
      {prev && (
        // The car's last visit: its mileage, and how far it has gone since (less than then — in orange: a misread or a typo).
        <Box className="odo-prev">
          <Text size="sm" c="dimmed">
            {t('odo.previous', { date: formatDate(prev.at), number: prev.number })}
          </Text>
          <Text fw={600} className="tnum">
            {formatKm(prev.km)} {t('unit.km')}
            {since !== undefined && (
              <Text span inherit c={fitsPrevious(km!, prev.km) ? 'green.7' : 'orange.7'} ml={8}>
                {since >= 0 ? `+${formatKm(since)}` : `−${formatKm(-since)}`} {t('unit.km')}
              </Text>
            )}
          </Text>
          {since !== undefined && since < 0 && (
            <Text size="sm" c="orange.7">
              {t('odo.less')}
            </Text>
          )}
        </Box>
      )}
      <Button fullWidth loading={saving} disabled={km === undefined || (km === order.mileageKm && !order.mileageOffered)} onClick={() => void save()}>
        {t('common.save')}
      </Button>
      {order.mileageKm !== undefined && (
        <Button variant="subtle" color="red" loading={saving} onClick={() => void remove()}>
          {t('odo.remove')}
        </Button>
      )}
      {viewing && photoId && <PhotoViewer items={[{ id: photoId, title: t('odo.title') }]} index={0} onIndex={() => undefined} onClose={() => setViewing(false)} />}
    </Stack>
  );
}
