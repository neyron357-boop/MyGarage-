import { Box, Text } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { liveLines } from '../../domain/flow';
import { activeInvoice, paidNet } from '../../domain/invoice';
import { itemAmounts, itemTitle, lineName } from '../../domain/items';
import { formatAed, roundFils } from '../../domain/money';
import { sumAmounts } from '../../domain/vat';
import type { OrderBundle } from '../../services/orders';
import { unlockClient } from '../../ui/clientLock';
import { List, ListRow, Money, PageHeader, PlateText } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useLang } from '../../ui/hooks';
import { notifications } from '@mantine/notifications';
import { coverOf } from '../../services/cover';
import { MediaImage } from '../../ui/components';
import { useScreenLiveQuery } from '../../ui/hooks';

/*
 * The job as its customer may see it (v0.67, the owner's note: «кнопка замка для клиента, чтобы он при показе из
 * приложения случайно не открыл детали и не посмотрел стоимость закупки»): the car, the work and the parts with the
 * customer's prices, the total with VAT, what is paid — nothing that opens, nothing of the garage's own (purchase costs,
 * suppliers, part numbers, the AI, notes, the profit). The lock in the head is held to leave (a tap only says so).
 */

/** Held this long, the lock opens. */
const HOLD_MS = 1200;

function HoldToUnlock() {
  const { t } = useTranslation();
  const [holding, setHolding] = useState(false);
  const timer = useRef<number>();
  const done = useRef(false);
  const start = (e: ReactPointerEvent) => {
    e.preventDefault();
    done.current = false;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      done.current = true;
      setHolding(false);
      haptic('success');
      unlockClient();
    }, HOLD_MS);
  };
  const stop = () => {
    window.clearTimeout(timer.current);
    if (holding && !done.current) notifications.show({ message: t('client.hold'), autoClose: 2200 });
    setHolding(false);
  };
  return (
    <button
      type="button"
      className="client-unlock"
      data-holding={holding || undefined}
      aria-label={t('client.unlock')}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      style={{ ['--hold' as string]: `${HOLD_MS}ms` }}
    >
      <IconLock size={20} stroke={2.2} aria-hidden />
      <span className="client-unlock-ring" aria-hidden />
    </button>
  );
}

/** The car's photo, only to look at (the job's own photo tile retakes and deletes it). */
function ClientCarPhoto({ vehicleId }: { vehicleId: string }) {
  const cover = useScreenLiveQuery(() => coverOf(vehicleId), [vehicleId]);
  if (!cover) return null;
  return (
    <div className="client-car-photo">
      <MediaImage id={cover} card h="100%" w="100%" radius="0" />
    </div>
  );
}

export function ClientView({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const lang = useLang();
  const docLang = b.order.docLanguage;
  const inv = activeInvoice(b.invoices);
  const live = liveLines(b.items);
  const sum = sumAmounts(live.map(itemAmounts));
  const paid = paidNet(b.payments);
  const total = inv ? inv.totalFils : sum.gross;
  const due = Math.max(0, total - paid);
  const qtyNote = (qty: number, gross: number) => (qty !== 1 ? `${qty} × ${formatAed(roundFils(gross / qty), lang)}` : undefined);
  return (
    <div className="client-view" data-client-view>
      <PageHeader
        eyebrow={`№${b.order.number}`}
        title={
          <>
            {[b.vehicle.make, b.vehicle.model].filter(Boolean).join(' ') || t('order.title')}{' '}
            {b.vehicle.year && (
              <Text span inherit c="dimmed" fw={500}>
                {b.vehicle.year}
              </Text>
            )}
          </>
        }
        right={<HoldToUnlock />}
      />
      <Box className="client-view-body">
        <div className="client-car">
          <ClientCarPhoto vehicleId={b.vehicle.id} />
          <PlateText plate={b.vehicle.plate} size="sm" />
        </div>
        {inv ? (
          <List>
            {inv.lines.map((l, k) => (
              <ListRow key={k} title={lineName(l.description, l.kind)} subtitle={qtyNote(l.qty, l.gross)} right={<Money fils={l.gross} c={l.kind === 'discount' ? 'green.7' : undefined} />} />
            ))}
          </List>
        ) : (
          live.length > 0 && (
            <List>
              {live.map((i) => {
                const a = itemAmounts(i);
                return <ListRow key={i.id} title={itemTitle(i, docLang) || '—'} subtitle={qtyNote(i.qty, a.gross)} right={<Money fils={a.gross} c={i.kind === 'discount' ? 'green.7' : undefined} />} />;
              })}
            </List>
          )
        )}
        <Box mt="lg">
          <List>
            <ListRow
              title={
                <Text span fw={700} inherit>
                  {t('job.total')}
                </Text>
              }
              subtitle={!inv && sum.vat ? t('job.vatIn', { vat: formatAed(sum.vat, lang, false) }) : undefined}
              right={
                <Text fz={24} lh={1.1}>
                  <Money fils={total} display />
                </Text>
              }
            />
            {paid > 0 && <ListRow title={<Text span c="dimmed" inherit>{t('qi.paid')}</Text>} right={<Money fils={paid} c="green.7" />} />}
            {paid > 0 && due > 0 && <ListRow title={<Text span c="dimmed" inherit>{t('qi.due')}</Text>} right={<Money fils={due} c="red.7" />} />}
          </List>
        </Box>
      </Box>
    </div>
  );
}
