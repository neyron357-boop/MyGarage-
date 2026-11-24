import { Button, Modal, Stack } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { itemAmounts, itemCostPaid, itemTitle } from '../../domain/items';
import { formatAed, roundFils, withMarkup } from '../../domain/money';
import type { OrderItem } from '../../domain/types';
import { enteredPrice, priceFromEntered, rateFor, vatModeOf } from '../../domain/vat';
import { updateItem } from '../../services/estimate';
import { syncStage } from '../../services/flow';
import type { OrderBundle } from '../../services/orders';
import { FormRow, Money, MoneyInput } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { forgetSuggestions } from './LineSheet';
import { cleanOff, LineOffRow, type LineOff } from './LineOff';

/*
 * «+ Цена» on a line (v0.81, the user's brief: «у позиции без цены справа «+ Цена»… «Закупка» и «Продажа», курсор сразу в
 * «Закупке», цифровая клавиатура; после ввода закупки рассчитать продажу через существующую логику (30 % и налог)…
 * продажную цену можно изменить вручную»). The prices of a draft line, as its card counts them (LineSheet.tsx):
 *  - the cost is typed without VAT (a part as bought, a service — what we pay those who do it);
 *  - the customer's price is the cost at the garage's markup (`withMarkup`, «Наценка» in the settings — 30 % by default),
 *    in the line's VAT mode (VAT on top, or in the price when prices are typed with VAT — `vatModeOf`): a price typed
 *    by hand stays as typed, a cost typed after it moves it only while it is still the markup's;
 *  - work (the labour charge) has no cost: the price alone.
 * Saved on the draft line as its card would save it; a line told to the customer changes its price by its own sheet.
 */
export function PriceSheet({ b, item, opened, onClose, service }: { b: OrderBundle; item: OrderItem | null; opened: boolean; onClose: () => void; service: boolean }) {
  const { t } = useTranslation();
  const uiLang = useLang();
  const { run, busy } = useAction();
  const [cost, setCost] = useState<number>();
  const [price, setPrice] = useState<number>();
  // The line's own discount (v0.82).
  const [off, setOff] = useState<LineOff>();
  const i = item;
  const incl = b.settings.pricesIncludeVat;
  const taxRate = i?.vatRateBp ? i.vatRateBp : b.settings.vatRateBp;
  const mode = vatModeOf(i ?? undefined, incl);
  const part = i?.kind === 'part';
  const costs = part || service;
  const fromCost = (c: number | undefined) => (c === undefined ? undefined : enteredPrice({ unitPriceFils: withMarkup(c, b.settings.defaultMarkupBp) }, taxRate, mode));
  useEffect(() => {
    if (!opened || !i) return;
    setCost(i.costPriceFils);
    setOff(i.lineOff);
    const p = enteredPrice(i, taxRate, mode);
    setPrice(p > 0 ? p : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, i?.id]);
  if (!i) return null;
  const qty = i.qty || 1;
  const priced = { ...priceFromEntered(price ?? 0, taxRate, mode), vatRateBp: rateFor(mode, taxRate) };
  const total = price ? itemAmounts({ ...i, ...priced, lineOff: cleanOff(off) }) : undefined;
  const paid = costs && cost !== undefined ? (part ? itemCostPaid({ kind: 'part', costPriceFils: cost, qty, vatRateBp: priced.vatRateBp, purchaseVatFils: cost === i.costPriceFils ? i.purchaseVatFils : undefined }) : roundFils(cost * qty)) : undefined;
  const save = () =>
    run(async () => {
      const patch: Partial<OrderItem> = { ...priced, lineOff: cleanOff(off) };
      if (part) patch.costPriceFils = cost;
      else if (service && cost !== undefined && cost > 0) {
        // What we pay them makes it work done outside (as in its card): its cost is theirs.
        patch.outsource = i.outsource ?? { state: 'todo' };
        patch.costPriceFils = cost;
      } else if (service && i.outsource) patch.costPriceFils = cost;
      await updateItem(i.id, patch);
      await syncStage(i.orderId);
      forgetSuggestions();
      haptic('light');
      onClose();
    });
  const cells: { key: string; label: string; fils: number; note?: string; tone?: 'good' | 'bad' }[] = [];
  if (total && total.gross) {
    cells.push({ key: 'total', label: t('qi.sumClient'), fils: total.gross, note: mode === 'none' ? t('qi.sumNoVat') : t('qi.sumVat', { vat: formatAed(total.vat, uiLang, false) }) });
    if (paid !== undefined) {
      cells.push({ key: 'cost', label: part ? t('qi.sumCost') : t('outsource.cost'), fils: paid });
      cells.push({ key: 'margin', label: part ? t('qi.sumMargin') : t('qi.sumLeft'), fils: total.gross - paid, tone: total.gross >= paid ? 'good' : 'bad' });
    }
  }
  return (
    <Modal opened={opened} onClose={onClose} title={itemTitle(i, b.order.docLanguage)} classNames={{ content: 'sheet-grouped price-sheet' }}>
      <Stack gap="md" onKeyDown={(e) => e.key === 'Enter' && !(e.nativeEvent as KeyboardEvent).isComposing && (e.preventDefault(), void save())}>
        <div className="ios-group">
          {costs && (
            <FormRow label={t('price.cost')}>
              <MoneyInput
                label={undefined}
                ariaLabel={t('price.cost')}
                value={cost}
                autoFocus
                leftSection={qty !== 1 ? `${qty} ×` : undefined}
                onChange={(c) => {
                  // The price follows the cost while it is still the markup's (or none).
                  if (!price || price === fromCost(cost)) setPrice(fromCost(c));
                  setCost(c);
                }}
              />
            </FormRow>
          )}
          <FormRow label={t('price.sell')}>
            <MoneyInput label={undefined} ariaLabel={t('price.sell')} value={price} autoFocus={!costs} leftSection={qty !== 1 ? `${qty} ×` : undefined} onChange={setPrice} />
          </FormRow>
          <LineOffRow value={off} onChange={setOff} />
        </div>
        {cells.length > 0 && (
          <div className="line-sum" role="group" data-cells={cells.length}>
            {cells.map((c) => (
              <div key={c.key} className="line-sum-cell" data-sum={c.key} data-tone={c.tone}>
                <span className="line-sum-label">{c.label}</span>
                <span className="line-sum-value">
                  <Money fils={c.fils} signed={c.key === 'margin'} roll />
                </span>
                {c.note && <span className="line-sum-note">{c.note}</span>}
              </div>
            ))}
          </div>
        )}
        <Button size="lg" fullWidth loading={busy} disabled={!price} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </Stack>
    </Modal>
  );
}
