import { Button, Modal, SegmentedControl, Stack, Switch, TextInput, Text } from '@mantine/core';
import { IconArrowBackUp, IconCheck } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dubaiDate } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import { db, uid } from '../../db/db';
import { itemCostPaid, itemTitle } from '../../domain/items';
import type { OrderItem, ProcurementStatus, SupplierReturn } from '../../domain/types';
import { syncStage } from '../../services/flow';
import { createReturn, setProcurement } from '../../services/parts';
import { FormRow, MoneyInput } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { PhotoStrip } from '../../ui/PhotoStrip';
import { ReturnTerms } from '../job/LineExtras';
import { SupplierChips } from '../job/PartTools';

const STEPS: ProcurementStatus[] = ['needed', 'ordered', 'in_transit', 'received'];

/**
 * A part being bought, as an iOS form: where it stands (find · ordered · on the way · here), from whom,
 * the cost and the seller's VAT, the day it comes, the receipt and whether it was paid from the cash box;
 * once bought — the seller's return terms; something wrong — a return to the supplier.
 */
export function ProcurementModal({ item, onClose }: { item: OrderItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const make = useLiveQuery(async () => {
    if (!item) return undefined;
    const o = await db.orders.get(item.orderId);
    return o ? (await db.vehicles.get(o.vehicleId))?.make : undefined;
  }, [item?.orderId]);
  const live = useLiveQuery(() => (item ? db.items.get(item.id) : undefined), [item?.id]) ?? item;
  const [status, setStatus] = useState<ProcurementStatus>('needed');
  const [supplierId, setSupplierId] = useState<string>();
  const [cost, setCost] = useState<number | undefined>();
  const [vat, setVat] = useState<number | undefined>();
  const [expected, setExpected] = useState('');
  const [receipt, setReceipt] = useState<{ id: string; file: File; src: string }>();
  const [paidCash, setPaidCash] = useState(false);
  const [ret, setRet] = useState(false);
  const [retReason, setRetReason] = useState('');
  const [retAmount, setRetAmount] = useState<number | undefined>();
  const [retType, setRetType] = useState<SupplierReturn['refundType']>('money');
  useEffect(() => {
    if (!item) return;
    // v0.99 (audit Ч2): where the part is now — opened to fix a cost, «Сохранить» made it «Есть» while it was still coming.
    setStatus(item.procurementStatus ?? 'needed');
    setSupplierId(item.supplierId);
    setCost(item.costPriceFils);
    setVat(item.purchaseVatFils);
    setExpected(item.expectedAt?.slice(0, 10) ?? '');
    setReceipt(undefined);
    setPaidCash(false);
    setRet(false);
    setRetReason('');
    setRetType('money');
    setRetAmount(item.costPriceFils !== undefined ? itemCostPaid(item) : undefined);
  }, [item]);
  if (!item || !live) return null;
  const save = async () => {
    return run(async () => {
      await setProcurement(item.id, { status, supplierId: supplierId ?? '', costPriceFils: cost, purchaseVatFils: vat, expectedAt: expected, receipt: receipt?.file, paidCash });
      await syncStage(item.orderId);
      haptic('light');
      onClose();
    }, 'common.saved');
  };
  const bought = ['ordered', 'in_transit', 'received'].includes(live.procurementStatus ?? '');
  // The next step, a button of its own: needed → ordered, ordered / on its way → here.
  const next: ProcurementStatus | null = status === 'needed' ? 'ordered' : status === 'ordered' || status === 'in_transit' ? 'received' : null;
  const stepTo = (to: ProcurementStatus) =>
    run(async () => {
      await setProcurement(item.id, { status: to, supplierId: supplierId ?? '', costPriceFils: cost, purchaseVatFils: vat, expectedAt: expected, receipt: receipt?.file, paidCash });
      await syncStage(item.orderId);
      haptic(to === 'received' ? 'success' : 'light');
      onClose();
    }, 'common.saved');
  const qty = item.qty || 1;
  const day = (n: number) => dubaiDate(new Date(Date.now() + n * 86400_000).toISOString());
  return (
    <Modal opened onClose={onClose} title={itemTitle(item, lang)} classNames={{ content: 'sheet-grouped' }}>
      <Stack gap="lg">
        <div className="ios-group">
          <div className="ios-row">
            <SegmentedControl
              fullWidth
              aria-label={t('job.partState')}
              value={status}
              onChange={(v) => setStatus(v as ProcurementStatus)}
              // In the colour of where the part is, as on its line and on the board: to find orange, on its way blue, here green.
              color={status === 'needed' ? 'orange' : status === 'ordered' || status === 'in_transit' ? 'blue' : 'green'}
              data={STEPS.map((s) => ({ value: s, label: s === 'in_transit' ? t('proc.in_transit') : t(`job.part.${s === 'needed' ? 'needed' : s === 'ordered' ? 'ordered' : 'received'}`) }))}
            />
          </div>
        </div>
        <div>
          <div className="group-title">{t('job.supplier')}</div>
          <SupplierChips value={supplierId} onChange={setSupplierId} make={make} />
        </div>
        <div className="ios-group">
          {/* Per piece, without VAT — said on the field, with what it comes to for all of them (v0.99, audit Ч3). */}
          <FormRow label={t('parts.costEachShort')}>
            <MoneyInput label={undefined} ariaLabel={t('parts.costPerUnit')} value={cost} onChange={setCost} leftSection={qty !== 1 ? `${qty} ×` : undefined} />
          </FormRow>
          {cost !== undefined && cost > 0 && qty !== 1 && (
            <Text size="sm" c="dimmed" px="md" pb={8} className="tnum" data-cost-all>
              {t('parts.costAll', { qty, sum: formatAed(Math.round(cost * qty)) })}
            </Text>
          )}
          <FormRow label={t('parts.vatShort')}>
            <MoneyInput label={undefined} ariaLabel={t('parts.purchaseVat')} value={vat} onChange={setVat} />
          </FormRow>
          {(status === 'ordered' || status === 'in_transit') && (
            <FormRow label={t('parts.comes')}>
              <TextInput type="date" aria-label={t('parts.comes')} value={expected} onChange={(e) => setExpected(e.currentTarget.value)} />
            </FormRow>
          )}
          {status === 'received' && (
            <FormRow label={t('parts.paidCashShort')}>
              <Switch aria-label={t('parts.paidCash')} checked={paidCash} onChange={(e) => setPaidCash(e.currentTarget.checked)} />
            </FormRow>
          )}
        </div>
        {(status === 'ordered' || status === 'in_transit') && (
          // When it comes, one tap (v0.99, audit Ч4): the iPhone's calendar was three or four taps for «tomorrow».
          <div className="chip-row wrap" style={{ marginTop: -8 }} data-comes-chips>
            {[0, 1, 2].map((n) => (
              <button key={n} type="button" className="chip" data-active={expected === day(n)} onClick={() => setExpected(day(n))}>
                {t(`parts.comesIn.d${n}`)}
              </button>
            ))}
          </div>
        )}
        {cost !== undefined && cost > 0 && vat === undefined && (
          // Left empty, the seller's VAT is counted at the line's rate (v0.31); a part bought without it — one tap.
          <Button variant="subtle" size="compact-md" onClick={() => setVat(0)} style={{ alignSelf: 'flex-start' }}>
            {t('parts.boughtNoVat')}
          </Button>
        )}
        {status === 'received' && (
          <PhotoStrip
            name="receipt"
            addLabel={t('parts.proof')}
            photos={[...(live.receiptMediaId && !receipt ? [{ id: live.receiptMediaId }] : []), ...(receipt ? [{ id: receipt.id, src: receipt.src, removable: true }] : [])]}
            onAdd={(files) => files[0] && setReceipt({ id: uid(), file: files[0], src: URL.createObjectURL(files[0]) })}
            onRemove={() => setReceipt(undefined)}
          />
        )}
        {next && (
          <Button size="lg" color={next === 'received' ? 'green' : 'blue'} loading={busy} leftSection={<IconCheck size={20} />} onClick={() => void stepTo(next)} data-proc-next>
            {t(next === 'received' ? 'parts.markReceived' : 'parts.markOrdered')}
          </Button>
        )}
        <Button size="lg" variant={next ? 'default' : 'filled'} loading={busy} onClick={save}>
          {t('common.save')}
        </Button>
        {bought && !live.done && <ReturnTerms item={live} withProof={false} />}
        {bought && !ret && (
          <Button variant="subtle" color="red" leftSection={<IconArrowBackUp size={16} />} onClick={() => setRet(true)}>
            {t('parts.return')}
          </Button>
        )}
        {ret && (
          <Stack gap="sm">
            <div className="ios-group">
              <div className="ios-row left">
                <TextInput aria-label={t('common.reason')} placeholder={t('parts.returnReasonHint')} value={retReason} onChange={(e) => setRetReason(e.currentTarget.value)} w="100%" data-autofocus />
              </div>
              <FormRow label={t('parts.refundShort')}>
                <MoneyInput label={undefined} ariaLabel={t('parts.expectedRefund')} value={retAmount} onChange={setRetAmount} />
              </FormRow>
              <div className="ios-row">
                <SegmentedControl fullWidth aria-label={t('parts.expectedRefund')} value={retType} onChange={(v) => setRetType(v as SupplierReturn['refundType'])} data={(['money', 'replacement', 'credit'] as const).map((x) => ({ value: x, label: t(`refund.${x}`) }))} />
              </div>
            </div>
            <Button
              color="red"
              disabled={!retReason.trim()}
              loading={busy}
              onClick={() =>
                run(async () => {
                  await createReturn(item.id, { reason: retReason, expectedRefundFils: retAmount ?? 0, refundType: retType });
                  // A part sent back no longer holds the job up.
                  await syncStage(item.orderId);
                  onClose();
                }, 'common.saved')
              }
            >
              {t('parts.createReturn')}
            </Button>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
