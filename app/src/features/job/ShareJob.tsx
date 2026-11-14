import { ActionIcon } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconShare2 } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { liveLines } from '../../domain/flow';
import { formatPlate } from '../../domain/plates';
import { coverOf } from '../../services/cover';
import { mediaBlob } from '../../services/media';
import { jobShareText } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { copyText } from '../../ui/clipboard';
import { haptic } from '../../ui/haptics';
import { useLang, useScreenLiveQuery } from '../../ui/hooks';

/**
 * The job to the garage's group in one tap (the round button by "…"): the share sheet with the car's
 * photo and the text — the car, the customer's name, the lines with their amounts, the total. iOS shares
 * only right in the tap, so the photo is read beforehand (a moment after the job opens, not to slow the
 * screen). Where nothing can be shared (a PC browser without it), the text is copied.
 */
export function ShareJobButton({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [photo, setPhoto] = useState<File>();
  // The car's main photo, as the card above shows it (a new one taken here comes in too).
  const cover = useScreenLiveQuery(async () => ({ id: await coverOf(b.vehicle.id) }), [b.vehicle.id])?.id;
  const name = [b.vehicle.make, b.vehicle.model, formatPlate(b.vehicle.plate)].filter(Boolean).join(' ');
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      const blob = cover ? await mediaBlob(cover) : undefined;
      if (alive) setPhoto(blob ? new File([blob], `${name}.jpg`, { type: blob.type || 'image/jpeg' }) : undefined);
    }, 900);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [cover, name]);
  const share = () => {
    const text = jobShareText(b.vehicle, b.customer, liveLines(b.items), lang);
    haptic('light');
    if (typeof navigator.share === 'function') {
      const files = photo ? [photo] : [];
      const data: ShareData = files.length && navigator.canShare?.({ files }) ? { files, text } : { text };
      navigator.share(data).catch(() => undefined);
      return;
    }
    void copyText(text).then((ok) => ok && notifications.show({ color: 'green', message: t('common.copied') }));
  };
  return (
    <ActionIcon variant="default" size={40} radius="md" aria-label={t('common.share')} onClick={share}>
      <IconShare2 size={20} />
    </ActionIcon>
  );
}
