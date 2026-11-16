import { Box, Button, Modal, Skeleton, Stack } from '@mantine/core';
import { IconSend } from '@tabler/icons-react';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { formatDate, nowIso } from '../../domain/dates';
import { liveLines } from '../../domain/flow';
import { itemAmounts, itemCostPaid, itemTitle } from '../../domain/items';
import { formatPhone } from '../../domain/phone';
import { formatPlate } from '../../domain/plates';
import { jobProfit } from '../../domain/profit';
import type { Expense, Lang, OrderItem } from '../../domain/types';
import type { OrderBundle } from '../../services/orders';
import { useLang } from '../../ui/hooks';
import { shareOrDownload } from '../../ui/share';
import { drawOwnerCheck, type CheckData, type CheckLine } from './ownerCheckImage';

/** What the picture says, from the job as it is now: names in the job's documents' language, words in the app's. */
async function checkData(b: OrderBundle, expenses: Expense[], docLang: Lang, lang: Lang, t: TFunction): Promise<CheckData> {
  const live = liveLines(b.items);
  const lines = live.filter((i) => i.kind !== 'discount');
  const ids = [...new Set(lines.flatMap((i) => [i.supplierId, i.outsource?.supplierId]).filter((x): x is string => !!x))];
  const names = new Map((await db.suppliers.bulkGet(ids)).filter((s) => !!s).map((s) => [s!.id, s!.name]));
  const line = (i: OrderItem): CheckLine => {
    const out = i.kind !== 'part' && i.outsource ? i.outsource : undefined;
    // Work done outside: what the expense that paid it says (the truth once paid), else what they charge.
    const paid = out?.expenseId ? expenses.find((e) => e.id === out.expenseId && !e.voidedAt)?.amountFils : undefined;
    const known = i.costPriceFils !== undefined ? itemCostPaid(i) : undefined;
    return {
      name: itemTitle(i, docLang) || '—',
      qty: i.qty,
      unitSale: itemAmounts({ ...i, qty: 1 }).gross,
      sale: itemAmounts(i).gross,
      cost: i.customerSupplied ? undefined : i.kind === 'part' ? known : out ? (paid ?? known) : undefined,
      supplier: names.get((i.kind === 'part' ? i.supplierId : out?.supplierId) ?? ''),
      own: i.customerSupplied,
    };
  };
  const p = jobProfit({ order: b.order, items: b.items, invoices: b.invoices, expenses });
  const c = b.customer;
  const who = [(c.type === 'company' && c.companyName ? c.companyName : c.name) || '', c.phone ? formatPhone(c.phone) : ''].filter(Boolean).join(' · ');
  return {
    lang,
    logo: b.settings.logoDataUrl,
    garage: b.settings.name,
    number: `№${b.order.number}`,
    date: formatDate(nowIso()),
    car: [b.vehicle.make, b.vehicle.model, b.vehicle.year].filter(Boolean).join(' ') || formatPlate(b.vehicle.plate, docLang),
    plate: formatPlate(b.vehicle.plate, 'en'),
    customer: who,
    parts: lines.filter((i) => i.kind === 'part').map(line),
    work: lines.filter((i) => i.kind !== 'part').map(line),
    discount: -live.filter((i) => i.kind === 'discount').reduce((s, i) => s + itemAmounts(i).gross, 0),
    revenue: p.revenue,
    partsCost: p.parts,
    outside: p.outside,
    expenses: p.expenses,
    profit: p.profit,
    labels: {
      parts: t('ownerCheck.parts'),
      work: t('ownerCheck.work'),
      cost: t('ownerCheck.cost'),
      sale: t('ownerCheck.sale'),
      noSupplier: t('ownerCheck.noSupplier'),
      noCost: t('ownerCheck.noCost'),
      own: t('ownerCheck.own'),
      discount: t('ownerCheck.discount'),
      toClient: t('ownerCheck.toClient'),
      partsCost: t('ownerCheck.partsCost'),
      outside: t('ownerCheck.outside'),
      expenses: t('ownerCheck.expenses'),
      spent: t('ownerCheck.spent'),
      profit: t('ownerCheck.profit'),
      footer: t('ownerCheck.footer'),
    },
  };
}

/**
 * The job for the owner to check (v0.29): the picture as it will go, and «Отправить» — the phone's share sheet
 * (WhatsApp first), a download on a PC. The picture is ready before the tap (the iPhone shares only right in a tap).
 */
export function OwnerCheckSheet({ b, expenses, docLang, opened, onClose }: { b: OrderBundle; expenses: Expense[]; docLang: Lang; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [shot, setShot] = useState<{ file: File; url: string }>();
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    let made: string | undefined;
    void (async () => {
      const blob = await drawOwnerCheck(await checkData(b, expenses, docLang, lang, t));
      if (!alive) return;
      made = URL.createObjectURL(blob);
      const name = [`№${b.order.number}`, b.vehicle.make, b.vehicle.model, `${b.vehicle.plate.code}${b.vehicle.plate.number}`].filter(Boolean).join(' ');
      setShot({ file: new File([blob], `${name}.jpg`, { type: 'image/jpeg' }), url: made });
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [opened, b, expenses, docLang, lang, t]);
  return (
    <Modal opened={opened} onClose={onClose} title={t('ownerCheck.title')}>
      <Stack gap="md">
        <Box className="owner-check">{shot ? <img src={shot.url} alt={t('ownerCheck.title')} data-owner-check /> : <Skeleton height={520} radius="lg" />}</Box>
        <Button size="lg" fullWidth leftSection={<IconSend size={20} />} disabled={!shot} onClick={() => shot && shareOrDownload(shot.file)}>
          {t('ownerCheck.send')}
        </Button>
      </Stack>
    </Modal>
  );
}
