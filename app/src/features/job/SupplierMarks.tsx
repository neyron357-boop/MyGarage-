import { ActionIcon, Group, Modal, Text } from '@mantine/core';
import { IconBrandWhatsapp, IconCheck, IconEyeOff, IconMessageOff, IconPhone, IconThumbUp, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import type { Ranked } from '../../domain/supplierRank';
import type { OrderItem, Supplier } from '../../domain/types';
import { coverOf } from '../../services/cover';
import { cardBlob } from '../../services/media';
import { setSupplierMark } from '../../services/supplierRank';
import { ListRow, PersonAvatar, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import { useLongPress } from '../../ui/longPress';

/*
 * The job's suppliers, marked from their list (v0.71, the user: «некоторые вообще не отвечают, некоторых нужно просто
 * убрать, а некоторые прям хорошие — отмечать прямо отсюда, чтобы самые хорошие были наверху»): a swipe right — good
 * (first in the list), a swipe left — off the list (with «Отменить»), a long press — every mark (good, does not answer,
 * off, none). And (v0.71, «бэушным поставщикам — фотографии автомобиля и образцов деталей… и по значку WhatsApp тоже»)
 * a used-parts seller is asked with the car's and the parts' photos — the share sheet, where the files go with the words.
 */

type Mark = Supplier['mark'];
const MARKS: { mark: Exclude<Mark, undefined>; icon: typeof IconThumbUp; color: string }[] = [
  { mark: 'good', icon: IconThumbUp, color: 'green' },
  { mark: 'silent', icon: IconMessageOff, color: 'orange' },
  { mark: 'off', icon: IconEyeOff, color: 'red' },
];

/** The mark beside a supplier's name: good — green, does not answer — orange. */
export function MarkTag({ mark }: { mark: Mark }) {
  const { t } = useTranslation();
  if (mark !== 'good' && mark !== 'silent') return null;
  return (
    <span className="supplier-mark" data-mark={mark}>
      {mark === 'good' ? <IconThumbUp size={12} stroke={2.4} aria-hidden /> : <IconMessageOff size={12} stroke={2.4} aria-hidden />}
      {t(`suppliers.mark.${mark}`)}
    </span>
  );
}

/** Every mark of one supplier, a tap each (and «none»). */
function MarkSheet({ s, opened, onClose }: { s: Supplier; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const put = (mark: Mark) =>
    void run(async () => {
      onClose();
      if (mark === s.mark) return;
      await setSupplierMark(s.id, mark);
      haptic(mark === 'good' ? 'success' : 'light');
    });
  return (
    <Modal opened={opened} onClose={onClose} title={s.name}>
      {MARKS.map(({ mark, icon: I, color }) => (
        <ListRow
          key={mark}
          left={
            <span className="row-icon" style={{ background: `var(--mantine-color-${color}-6)` }} aria-hidden>
              <I size={18} stroke={2} />
            </span>
          }
          title={t(`suppliers.mark.${mark}`)}
          right={s.mark === mark ? <IconCheck size={20} stroke={2.4} color="var(--mantine-color-cobalt-6)" aria-hidden /> : undefined}
          onClick={() => put(mark)}
        />
      ))}
      {s.mark && <ListRow left={<IconX size={20} stroke={1.8} aria-hidden />} title={t('suppliers.mark.none')} onClick={() => put(undefined)} />}
    </Modal>
  );
}

/**
 * A supplier of the job's list: its name, stars and mark, why it fits; WhatsApp and a call at its end. Marked by a swipe or
 * a long press; a tap opens its card. `used`: its WhatsApp sends the car's and the parts' photos with the words.
 */
export function SupplierRow({ r, why, chat, used, onCard, onUsedAsk, stars }: { r: Ranked; why: string; chat?: string; used?: boolean; onCard: () => void; onUsedAsk?: () => void; stars?: React.ReactNode }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const s = r.supplier;
  const [marking, setMarking] = useState(false);
  const press = useLongPress(() => setMarking(true));
  const good = s.mark === 'good';
  const take = (mark: Mark) =>
    void run(async () => {
      const was = await setSupplierMark(s.id, mark);
      haptic(mark === 'good' ? 'success' : 'light');
      if (mark === 'off') undoToast(t('suppliers.mark.removed', { name: s.name }), t('common.undo'), () => void setSupplierMark(s.id, was));
    });
  return (
    <>
      <ListRow
        handlers={press.handlers}
        onClick={() => !press.consumeClick() && onCard()}
        leading={{ label: good ? t('suppliers.mark.none') : t('suppliers.mark.good'), icon: good ? IconX : IconThumbUp, color: good ? 'gray' : 'green', onCommit: () => take(good ? undefined : 'good') }}
        trailing={{ label: t('suppliers.mark.off'), icon: IconEyeOff, color: 'red', full: false, onCommit: () => take('off') }}
        left={<PersonAvatar name={s.name} company size={36} />}
        title={
          <span className="supplier-name">
            <span className="supplier-name-text">{s.name}</span>
            {stars}
          </span>
        }
        subtitle={
          s.mark === 'good' || s.mark === 'silent' || why ? (
            <span className="supplier-why">
              <MarkTag mark={s.mark} />
              {why && <Text span inherit>{why}</Text>}
            </span>
          ) : undefined
        }
        right={
          <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
            {(chat || (used && onUsedAsk)) && (
              <ActionIcon
                component="a"
                href={chat}
                target="_blank"
                rel="noopener"
                variant="light"
                color="green"
                size={36}
                radius="xl"
                aria-label="WhatsApp"
                data-used-ask={used || undefined}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  // A used-parts seller (v0.71): the car's and the parts' photos with the words — the share sheet (a link
                  // to the chat carries words only).
                  if (used && onUsedAsk) {
                    e.preventDefault();
                    onUsedAsk();
                  }
                }}
              >
                <IconBrandWhatsapp size={19} />
              </ActionIcon>
            )}
            {s.phone && (
              <ActionIcon component="a" href={`tel:${s.phone}`} variant="light" color="green" size={36} radius="xl" aria-label={t('customer.call')} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                <IconPhone size={18} />
              </ActionIcon>
            )}
          </Group>
        }
      />
      {marking && <MarkSheet s={s} opened={marking} onClose={() => setMarking(false)} />}
    </>
  );
}

/** A supplier taken off the list: a tap — its marks (to bring it back). */
export function OffRow({ s }: { s: Supplier }) {
  const { t } = useTranslation();
  const [marking, setMarking] = useState(false);
  return (
    <>
      <ListRow left={<PersonAvatar name={s.name} company size={32} />} title={<Text span inherit c="dimmed">{s.name}</Text>} right={<Text span size="sm" c="cobalt.6" fw={600}>{t('suppliers.mark.back')}</Text>} onClick={() => setMarking(true)} dim />
      {marking && <MarkSheet s={s} opened={marking} onClose={() => setMarking(false)} />}
    </>
  );
}

/**
 * The car's photos and the parts' (v0.71: a used-parts seller is asked with them), as files, ready before the tap (an
 * iPhone shares only right in it): the car's own photos (its latest three, else its main one), then each part's — its
 * own photos, else a sample found for it; ten at most, at the card's size.
 */
export function useUsedFiles(vehicleId: string | undefined, items: OrderItem[]): File[] | undefined {
  const key = [vehicleId, ...items.map((i) => [i.id, ...(i.mediaIds ?? []), ...(i.sampleIds ?? [])].join(','))].join('|');
  const [made, setMade] = useState<{ key: string; files: File[] }>();
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      const ids: { id: string; name: string }[] = [];
      if (vehicleId) {
        const own = (await db.media.where('ownerId').equals(vehicleId).toArray())
          .filter((m) => m.kind === 'photo' && m.slot === 'cover')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 3)
          .map((m) => m.id);
        const car = own.length ? own : [await coverOf(vehicleId)].filter((x): x is string => !!x);
        car.forEach((id, n) => ids.push({ id, name: `car-${n + 1}.jpg` }));
      }
      items.forEach((i, k) => {
        const own = (i.mediaIds ?? []).slice(0, 2);
        (own.length ? own : (i.sampleIds ?? []).slice(0, 1)).forEach((id, n) => ids.push({ id, name: `part-${k + 1}-${n + 1}.jpg` }));
      });
      const files: File[] = [];
      for (const x of ids.slice(0, 10)) {
        const blob = await cardBlob(x.id).catch(() => undefined);
        if (blob) files.push(new File([blob], x.name, { type: blob.type || 'image/jpeg' }));
      }
      if (alive) setMade({ key, files });
    }, 600);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return made?.key === key ? made.files : undefined;
}
