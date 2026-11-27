import { Button, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCircle, IconCircleCheckFilled, IconShoppingCart } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, dubaiDate, nowIso, shiftDay } from '../../domain/dates';
import { itemTitle } from '../../domain/items';
import { bestOffer, buyable } from '../../domain/supplierOrder';
import type { OrderItem, PartOffer, Supplier } from '../../domain/types';
import type { OrderBundle } from '../../services/orders';
import { orderFromSupplier } from '../../services/supplierOrder';
import { Money } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useErrorText, useScreenLiveQuery } from '../../ui/hooks';
import { db } from '../../db/db';

/*
 * «Заказать» (audit 27/11: ~15 taps and a typed «беру» for each part): the job's parts not bought yet, each with what the
 * suppliers offered — the cheapest price picked (a tap picks another, or none); when they are collected; «Заказать · N» —
 * one message to each supplier (through «Проверить и отправить»), the lines «заказано» once it went.
 */

type When = 'soon' | 'evening' | 'morning' | 'deliver';
const WHENS: When[] = ['soon', 'evening', 'morning', 'deliver'];

/** The time said to the supplier and the time the part is expected (Dubai). */
function collectOf(w: When): { by: 'pickup'; at: string; expectedAt: string } | { by: 'deliver'; expectedAt?: string } {
  const today = dubaiDate();
  if (w === 'deliver') return { by: 'deliver' };
  if (w === 'soon') return { by: 'pickup', at: 'within the hour', expectedAt: addDays(nowIso(), 1 / 24) };
  if (w === 'evening') return { by: 'pickup', at: 'today at 17:00', expectedAt: `${today}T13:00:00.000Z` };
  return { by: 'pickup', at: 'tomorrow at 9:00', expectedAt: `${shiftDay(today, 1)}T05:00:00.000Z` };
}

export function BuySheet({ b, opened, onClose }: { b: OrderBundle; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const { run, busy } = useAction({ exclusive: true });
  const lang = b.order.docLanguage ?? 'en';
  const parts = useMemo(() => b.items.filter(buyable), [b.items]);
  const suppliers = useScreenLiveQuery(() => db.suppliers.bulkGet([...new Set(parts.flatMap((i) => (i.offers ?? []).map((o) => o.supplierId).filter((x): x is string => !!x)))]), [parts.map((i) => i.id).join()]);
  const nameOf = (id?: string) => (suppliers ?? []).find((s): s is Supplier => !!s && s.id === id)?.name ?? '';
  // The picked offer of each part: the cheapest at first.
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const pickOf = (i: OrderItem): PartOffer | undefined => {
    const id = picked[i.id];
    if (id === null) return undefined;
    return id ? i.offers?.find((o) => o.id === id) : bestOffer(i);
  };
  const [when, setWhen] = useState<When>('evening');
  const chosen = parts.map((i) => ({ i, o: pickOf(i) })).filter((x): x is { i: OrderItem; o: PartOffer } => !!x.o?.supplierId);
  const go = () =>
    run(async () => {
      const bySupplier = new Map<string, { itemId: string; offerId: string }[]>();
      for (const { i, o } of chosen) bySupplier.set(o.supplierId!, [...(bySupplier.get(o.supplierId!) ?? []), { itemId: i.id, offerId: o.id }]);
      const c = collectOf(when);
      for (const [supplierId, picks] of bySupplier) await orderFromSupplier(b.order.id, supplierId, picks, c);
      haptic('success');
      onClose();
    }).catch((e) => notifications.show({ color: 'red', message: errorText(e) }));
  return (
    <Modal opened={opened} onClose={onClose} title={t('buy.title')} classNames={{ content: 'sheet-grouped buy-sheet' }}>
      <Stack gap="md">
        {parts.map((i) => {
          const on = pickOf(i);
          return (
            <div key={i.id} data-buy-part={i.id}>
              <div className="group-title">{itemTitle(i, lang)}</div>
              <div className="ios-group">
                {(i.offers ?? [])
                  .filter((o) => !o.na && o.supplierId)
                  .map((o) => (
                    <button key={o.id} type="button" className="buy-offer list-row clickable" onClick={() => (setPicked((p) => ({ ...p, [i.id]: on?.id === o.id ? null : o.id })), haptic('selection'))} data-buy-offer={o.id} data-on={on?.id === o.id || undefined}>
                      {on?.id === o.id ? <IconCircleCheckFilled size={22} color="var(--mantine-color-green-6)" /> : <IconCircle size={22} color="var(--app-label-3)" />}
                      <span className="buy-offer-text">
                        <Text span size="md" fw={500}>
                          {nameOf(o.supplierId) || t('buy.supplier')}
                        </Text>
                        <Text span size="sm" c="dimmed">
                          {[t(`buy.kind.${o.kind}`), o.brand].filter(Boolean).join(' · ')}
                        </Text>
                      </span>
                      {o.costFils ? <Money fils={o.costFils} /> : <Text span c="dimmed">—</Text>}
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
        {!parts.length && (
          <Text c="dimmed" size="sm">
            {t('buy.none')}
          </Text>
        )}
        <div>
          <div className="group-title">{t('buy.when')}</div>
          <div className="chip-row wrap">
            {WHENS.map((w) => (
              <button key={w} type="button" className="chip" data-active={when === w} onClick={() => (setWhen(w), haptic('selection'))} data-buy-when={w}>
                {t(`buy.whens.${w}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="sheet-footer">
          <Button size="lg" fullWidth leftSection={<IconShoppingCart size={18} />} loading={busy} disabled={!chosen.length} onClick={() => void go()} data-buy-go>
            {t('buy.go', { n: chosen.length })}
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}
