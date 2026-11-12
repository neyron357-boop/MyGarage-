import { Button, Group, Text } from '@mantine/core';
import { IconBuildingFactory2, IconCash, IconCheck, IconCreditCard, IconTransfer } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { daysBetween, dubaiDate, formatDate, shiftDay } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import type { OrderItem, PayMethod } from '../../domain/types';
import { updateItem } from '../../services/estimate';
import { syncStage } from '../../services/flow';
import { deleteMedia } from '../../services/media';
import { addDealProof, payOutsource, setOutsource, setReceivedQty, setReturnTerms } from '../../services/parts';
import { FormRow, MoneyInput } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { PhotoStrip } from '../../ui/PhotoStrip';
import { DaysChips, ReceivedStepper, SupplierChips } from './PartTools';

const RETURN_DAYS = [3, 7, 14] as const;

/**
 * What the seller said about returns, right when the part is bought: no returns, or back within 3 / 7 /
 * 14 days (a reminder comes before the day) — and the proof of it, a photo of the receipt or a screenshot
 * of the chat, kept with the line.
 */
export function ReturnTerms({ item }: { item: OrderItem }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const proofs = useLiveQuery(() => db.media.where('ownerId').equals(item.id).filter((m) => m.slot === 'deal').sortBy('createdAt'), [item.id]) ?? [];
  const from = dubaiDate(item.receivedAt ?? item.orderedAt ?? item.createdAt);
  const set = (days: number | 'none' | undefined) =>
    run(async () => {
      await setReturnTerms(item.id, days === 'none' ? { noReturn: true } : days ? { returnBy: shiftDay(from, days) } : {});
      haptic('selection');
    });
  const active = (d: number) => !!item.returnBy && daysBetween(from, item.returnBy) === d;
  return (
    <div>
      <div className="group-title">
        {t('parts.returnTitle')}
        {item.returnBy && !item.noReturn ? ` · ${t('parts.returnUntil', { date: formatDate(item.returnBy).slice(0, 5) })}` : ''}
      </div>
      <div className="chip-row" aria-label={t('parts.returnTitle')}>
        <button type="button" className="chip" data-active={!!item.noReturn} onClick={() => void set(item.noReturn ? undefined : 'none')}>
          {t('parts.noReturn')}
        </button>
        {RETURN_DAYS.map((d) => (
          <button key={d} type="button" className="chip" data-active={active(d)} onClick={() => void set(active(d) ? undefined : d)}>
            {t('parts.returnDays', { n: d })}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <PhotoStrip
          name="deal"
          addLabel={t('parts.proof')}
          photos={proofs.map((m) => ({ id: m.id, removable: true }))}
          onAdd={(files) => void run(() => addDealProof(item.id, files))}
          onRemove={(p) => void run(() => deleteMedia(p.id))}
        />
      </div>
    </div>
  );
}

/** Several ordered, some came: "1 of 2"; all of them — the part is here. */
export function ReceivedRow({ item }: { item: OrderItem }) {
  const { t } = useTranslation();
  const { run } = useAction();
  return (
    <div className="ios-group">
      <FormRow label={t('parts.came')}>
        <ReceivedStepper
          value={item.procurementStatus === 'received' ? item.qty : item.receivedQty ?? 0}
          of={item.qty}
          onChange={(n) =>
            void run(async () => {
              await setReceivedQty(item.id, n);
              await syncStage(item.orderId);
              haptic('selection');
            })
          }
        />
      </FormRow>
    </div>
  );
}

const PAY: { m: PayMethod; icon: typeof IconCash }[] = [
  { m: 'cash', icon: IconCash },
  { m: 'card', icon: IconCreditCard },
  { m: 'transfer', icon: IconTransfer },
];

/**
 * Work handed outside, on a line already agreed: hand it over, it is with them, it came back; who, what
 * they charge, back when; then pay them — an expense of this job in the money book.
 */
export function OutsourceActions({ item, make }: { item: OrderItem; make?: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const [paying, setPaying] = useState(false);
  const [cost, setCost] = useState<number | undefined>(item.costPriceFils);
  useEffect(() => setCost(item.costPriceFils), [item.costPriceFils]);
  const o = item.outsource;
  if (!o)
    return (
      <button type="button" className="chip" onClick={() => void run(() => setOutsource(item.id, { state: 'todo' }))}>
        <IconBuildingFactory2 size={16} stroke={2} style={{ verticalAlign: -3, marginRight: 6 }} aria-hidden />
        {t('outsource.title')}
      </button>
    );
  const amount = Math.round((item.costPriceFils ?? 0) * (item.qty || 1));
  return (
    <div>
      <div className="group-title">{t('outsource.title')}</div>
      <div className="chip-row" aria-label={t('outsource.state')}>
        {(['todo', 'out', 'back'] as const).map((s) => (
          <button key={s} type="button" className="chip" data-active={o.state === s} onClick={() => void run(async () => (await setOutsource(item.id, { ...o, state: s }), haptic('selection')))}>
            {t(`outsource.states.${s}`)}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => void run(() => setOutsource(item.id, undefined))}>
          {t('outsource.cancel')}
        </button>
      </div>
      <div className="ios-group" style={{ marginTop: 10 }}>
        <div className="ios-row">
          <SupplierChips service make={make} value={o.supplierId} onChange={(s) => void run(() => setOutsource(item.id, { ...o, supplierId: s }))} label={t('outsource.who')} />
        </div>
        <FormRow label={t('outsource.cost')}>
          <MoneyInput label={undefined} ariaLabel={t('outsource.cost')} value={cost} onChange={setCost} />
        </FormRow>
        {o.state !== 'back' && (
          <div className="ios-row">
            <span className="label">{t('outsource.back')}</span>
            <DaysChips
              value={o.dueAt ? Math.max(0, daysBetween(dubaiDate(), o.dueAt)) : undefined}
              onChange={(d) => void run(() => setOutsource(item.id, { ...o, dueAt: d === undefined ? undefined : shiftDay(dubaiDate(), d) }))}
              label={t('outsource.back')}
            />
          </div>
        )}
      </div>
      {cost !== item.costPriceFils && (
        <Button mt="sm" fullWidth variant="light" loading={busy} onClick={() => void run(() => updateItem(item.id, { costPriceFils: cost }))}>
          {t('common.save')}
        </Button>
      )}
      {o.expenseId ? (
        <Text mt="sm" size="sm" c="green.7" fw={600}>
          <IconCheck size={16} stroke={2.6} style={{ verticalAlign: -3, marginRight: 4 }} aria-hidden />
          {t('outsource.paid', { amount: formatAed(amount, lang) })}
        </Text>
      ) : (
        amount > 0 &&
        cost === item.costPriceFils &&
        (paying ? (
          <Group grow gap={8} mt="sm" wrap="nowrap">
            {PAY.map(({ m, icon: I }) => (
              <Button key={m} variant="light" loading={busy} leftSection={<I size={18} />} onClick={() => void run(async () => (await payOutsource(item.id, m), haptic('success')), 'outsource.paidToast')}>
                {t(`payment.method.${m}`)}
              </Button>
            ))}
          </Group>
        ) : (
          <Button mt="sm" fullWidth variant="light" color="green" onClick={() => setPaying(true)}>
            {t('outsource.pay', { amount: formatAed(amount, lang) })}
          </Button>
        ))
      )}
    </div>
  );
}
