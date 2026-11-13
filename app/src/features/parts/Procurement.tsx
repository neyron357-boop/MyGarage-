import { Button, Modal, SegmentedControl, Stack, Switch, TextInput } from '@mantine/core';
import { IconArrowBackUp } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db, uid } from '../../db/db';
import { itemTitle } from '../../domain/items';
import { roundFils } from '../../domain/money';
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
    // The next step is the likely one: needed → ordered, ordered → here.
    setStatus(item.procurementStatus === 'needed' || !item.procurementStatus ? 'ordered' : item.procurementStatus === 'ordered' || item.procurementStatus === 'in_transit' ? 'received' : item.procurementStatus);
    setSupplierId(item.supplierId);
    setCost(item.costPriceFils);
    setVat(item.purchaseVatFils);
    setExpected(item.expectedAt?.slice(0, 10) ?? '');
    setReceipt(undefined);
    setPaidCash(false);
    setRet(false);
    setRetReason('');
    setRetType('money');
    setRetAmount(item.costPriceFils !== undefined ? roundFils(item.costPriceFils * item.qty) + (item.purchaseVatFils ?? 0) : undefined);
  }, [item]);
  if (!item || !live) return null;
  const save = () =>
    run(async () => {
      await setProcurement(item.id, { status, supplierId: supplierId ?? '', costPriceFils: cost, purchaseVatFils: vat, expectedAt: expected, receipt: receipt?.file, paidCash });
      await syncStage(item.orderId);
      haptic('light');
      onClose();
    }, 'common.saved');
  const bought = ['ordered', 'in_transit', 'received'].includes(live.procurementStatus ?? '');
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
          <FormRow label={t('qi.costShort')}>
            <MoneyInput label={undefined} ariaLabel={t('parts.costPerUnit')} value={cost} onChange={setCost} />
          </FormRow>
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
        {cost !== undefined && cost > 0 && vat === undefined && (
          // The seller's VAT from the cost, one tap (5 % of the purchase).
          <Button variant="subtle" size="compact-md" onClick={() => setVat(roundFils(roundFils(cost * item.qty) * 0.05))} style={{ alignSelf: 'flex-start' }}>
            {t('parts.vat5')}
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
        <Button size="lg" loading={busy} onClick={save}>
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
