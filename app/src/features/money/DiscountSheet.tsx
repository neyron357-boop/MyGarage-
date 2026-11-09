import { Box, Button, Group, Modal, NumberInput, SegmentedControl, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentDiscount, discountBase, discountGross, grossOf, roundTotals, type DiscountSpec } from '../../domain/discount';
import { activeInvoice, paidNet } from '../../domain/invoice';
import { formatAed } from '../../domain/money';
import { setDiscount } from '../../services/discount';
import { discountIssuedInvoice } from '../../services/money';
import type { OrderBundle } from '../../services/orders';
import { ConfirmModal, Money, MoneyInput } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';

type Mode = 'aed' | 'pct';
const PERCENTS = [5, 10, 15, 20];

const sameSpec = (a: DiscountSpec | null, b: DiscountSpec | null) =>
  a === b || (!!a && !!b && ('pctBp' in a ? 'pctBp' in b && a.pctBp === b.pctBp : 'grossFils' in b && a.grossFils === b.grossFils));

/**
 * The job's discount: an amount off (with one-tap round totals) or a percentage of the lines. Before
 * the invoice it changes the lines; once the invoice is out it is given with a credit note and a new
 * invoice (an issued invoice never changes).
 */
export function DiscountSheet({ b, opened, onClose }: { b: OrderBundle; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const inv = activeInvoice(b.invoices);
  const now = currentDiscount(b.items);
  const [mode, setMode] = useState<Mode>('aed');
  const [amount, setAmount] = useState<number | undefined>();
  const [pct, setPct] = useState<number | string>('');
  const [confirm, setConfirm] = useState<DiscountSpec | null | false>(false);
  useEffect(() => {
    if (!opened) return;
    const pctNow = now && 'pctBp' in now ? now.pctBp / 100 : undefined;
    setMode(pctNow ? 'pct' : 'aed');
    setPct(pctNow ?? '');
    setAmount(now && 'grossFils' in now ? now.grossFils : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const before = grossOf(discountBase(b.items));
  const spec: DiscountSpec | null = mode === 'pct' ? (Number(pct) > 0 ? { pctBp: Math.round(Number(pct) * 100) } : null) : amount && amount > 0 ? { grossFils: amount } : null;
  const off = spec ? discountGross(spec, before) : 0;
  const after = before - off;
  const paid = paidNet(b.payments);
  const error = off > before ? t('err.discountTooBig') : inv && after < paid ? t('err.discountOverPaid') : undefined;
  const changed = !sameSpec(spec, now);

  /** Before the invoice: the lines change at once. */
  const save = (s: DiscountSpec | null) =>
    run(async () => {
      await setDiscount(b.order.id, s);
      haptic('light');
      onClose();
    }, s ? 'discount.saved' : 'discount.removed');
  /** After the invoice: a credit note and a new invoice — confirmed first. */
  const reissue = async (s: DiscountSpec | null) => {
    const r = await run(() => discountIssuedInvoice(b.order.id, s));
    if (!r) return false;
    haptic('success');
    notifications.show({ color: 'green', message: t('discount.reissued', { credit: r.credit.number, invoice: r.invoice.number }) });
    onClose();
    return true;
  };
  const submit = (s: DiscountSpec | null) => (inv ? setConfirm(s) : void save(s));

  return (
    <>
      <Modal opened={opened && confirm === false} onClose={onClose} title={t('discount.title')}>
        <Stack gap="md">
          <SegmentedControl
            fullWidth
            value={mode}
            onChange={(m) => setMode(m as Mode)}
            aria-label={t('discount.modeLabel')}
            data={[
              { value: 'aed', label: 'AED' },
              { value: 'pct', label: '%' },
            ]}
          />
          {mode === 'aed' ? (
            <>
              {roundTotals(before).length > 0 && (
                <div className="chip-row">
                  {roundTotals(before).map((to) => (
                    <button key={to} type="button" className="chip" data-active={amount === before - to} onClick={() => setAmount(before - to)}>
                      {t('discount.payTo', { amount: formatAed(to, lang) })}
                    </button>
                  ))}
                </div>
              )}
              <MoneyInput label={t('discount.amount')} description={t('discount.hint')} value={amount} onChange={setAmount} />
            </>
          ) : (
            <>
              <div className="chip-row">
                {PERCENTS.map((p) => (
                  <button key={p} type="button" className="chip" data-active={Number(pct) === p} onClick={() => setPct(p)}>
                    {p} %
                  </button>
                ))}
              </div>
              <NumberInput label={t('discount.percent')} description={inv ? undefined : t('discount.pctHint')} value={pct} onChange={setPct} min={0} max={100} decimalScale={2} suffix=" %" inputMode="decimal" />
            </>
          )}
          <Box className="surface-soft" p="sm">
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" c="dimmed">
                  {t('discount.before')}
                </Text>
                <Money fils={before} size="sm" />
              </Group>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" c="dimmed">
                  {t('discount.off')}
                </Text>
                <Money fils={-off} size="sm" c={off ? 'green.7' : undefined} />
              </Group>
              <Group justify="space-between" wrap="nowrap">
                <Text fw={700}>{t('discount.after')}</Text>
                <Money fils={after} fw={700} />
              </Group>
            </Stack>
          </Box>
          {error && (
            <Text size="sm" c="red.7">
              {error}
            </Text>
          )}
          {inv && (
            <Text size="sm" c="dimmed">
              {t('discount.issuedNote', { number: inv.number })}
            </Text>
          )}
          <Button size="lg" loading={busy} disabled={!spec || !!error || !changed} onClick={() => submit(spec)}>
            {inv ? t('discount.apply') : t('common.save')}
          </Button>
          {now && (
            <Button variant="subtle" color="red" loading={busy} onClick={() => submit(null)}>
              {inv ? t('discount.applyRemove') : t('discount.remove')}
            </Button>
          )}
        </Stack>
      </Modal>
      {inv && (
        <ConfirmModal
          opened={confirm !== false}
          onClose={() => setConfirm(false)}
          title={t('discount.confirmTitle')}
          confirmLabel={confirm ? t('discount.apply') : t('discount.applyRemove')}
          onConfirm={() => reissue(confirm === false ? null : confirm)}
        >
          <Text size="sm">{t('discount.confirmText', { number: inv.number, amount: formatAed(confirm ? before - discountGross(confirm, before) : before, lang) })}</Text>
        </ConfirmModal>
      )}
    </>
  );
}
