import { ActionIcon, Box, Button, Group, Modal, Skeleton, Stack, Text } from '@mantine/core';
import { IconBrandWhatsapp, IconSend, IconShare } from '@tabler/icons-react';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { formatDate, nowIso } from '../../domain/dates';
import { liveLines } from '../../domain/flow';
import { itemAmounts, itemCostPaid, itemTitle } from '../../domain/items';
import { formatPhone } from '../../domain/phone';
import { formatPlate } from '../../domain/plates';
import { jobProfit, partsPaid } from '../../domain/profit';
import type { Expense, Lang, OrderItem } from '../../domain/types';
import { coverOf } from '../../services/cover';
import { cardUrl } from '../../services/media';
import type { OrderBundle } from '../../services/orders';
import { waAutoOf, type WaTarget } from '../../domain/waAuto';
import { saveWaAuto } from '../../services/waAuto';
import { sendWaFile, waReady } from '../../services/whatsapp';
import { useWaSel } from '../../ui/waSel';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { shareOrDownload } from '../../ui/share';
import { ChatPicker } from '../whatsapp/ChatPicker';
import { drawOwnerCheck, type CheckData, type CheckLine } from './ownerCheckImage';

/** What the picture says, from the job as it is now: names in the job's documents' language, words in the app's. */
async function checkData(b: OrderBundle, expenses: Expense[], partsCategoryId: string | undefined, docLang: Lang, lang: Lang, t: TFunction): Promise<CheckData> {
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
  const p = jobProfit({ order: b.order, items: b.items, invoices: b.invoices, expenses, partsCategoryId });
  // What else went out for the job, line by line (v0.31): its other expenses, and paid for parts beyond their costs.
  const paidOutside = new Set(live.map((i) => (i.kind !== 'part' ? i.outsource?.expenseId : undefined)).filter(Boolean));
  const others = expenses.filter((e) => !e.voidedAt && !paidOutside.has(e.id) && !(partsCategoryId && e.categoryId === partsCategoryId));
  const cats = new Map((await db.expenseCategories.bulkGet([...new Set(others.map((e) => e.categoryId))])).filter((x) => !!x).map((x) => [x!.id, lang === 'ru' ? x!.nameRu : x!.nameEn]));
  const extra: CheckLine[] = others.map((e) => ({ name: [cats.get(e.categoryId), e.vendor || e.note].filter(Boolean).join(' · ') || '—', qty: 1, unitSale: 0, sale: 0, cost: e.amountFils }));
  const beyond = partsPaid(expenses, partsCategoryId, paidOutside) - lines.filter((i) => i.kind === 'part' && !i.customerSupplied).reduce((s, i) => s + itemCostPaid(i), 0);
  if (beyond > 0) extra.unshift({ name: t('ownerCheck.partsBeyond'), qty: 1, unitSale: 0, sale: 0, cost: beyond });
  // The car's main photo, at a card's size (made once a session, v0.36).
  const cover = await coverOf(b.vehicle.id);
  const photo = cover ? await cardUrl(cover) : undefined;
  const c = b.customer;
  const who = [(c.type === 'company' && c.companyName ? c.companyName : c.name) || '', c.phone ? formatPhone(c.phone) : ''].filter(Boolean).join(' · ');
  return {
    lang,
    logo: b.settings.logoDataUrl,
    photo,
    garage: b.settings.name,
    number: `№${b.order.number}`,
    date: formatDate(nowIso()),
    car: [b.vehicle.make, b.vehicle.model, b.vehicle.year].filter(Boolean).join(' ') || formatPlate(b.vehicle.plate, docLang),
    plate: formatPlate(b.vehicle.plate, 'en'),
    customer: who,
    parts: lines.filter((i) => i.kind === 'part').map(line),
    work: lines.filter((i) => i.kind !== 'part').map(line),
    extra,
    discount: -live.filter((i) => i.kind === 'discount').reduce((s, i) => s + itemAmounts(i).gross, 0),
    revenue: p.revenue,
    spent: p.spent,
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
 * The garage's WhatsApp linked (v0.80, «нажал — и уже отправилось прямо к владельцу»): one tap sends it to the owner's
 * chat (the boss of «WhatsApp → Автоматизация»; picked here the first time); the share sheet stays beside it.
 */
export function OwnerCheckSheet({
  b,
  expenses,
  partsCategoryId,
  docLang,
  opened,
  onClose,
}: {
  b: OrderBundle;
  expenses: Expense[];
  partsCategoryId?: string;
  docLang: Lang;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const [shot, setShot] = useState<{ file: File; url: string }>();
  const ready = useWaSel(waReady);
  const owner = waAutoOf(b.settings.waAuto).boss.to;
  const [picking, setPicking] = useState(false);
  const { run, busy } = useAction({ exclusive: true });
  const toOwner = (to: WaTarget) =>
    run(async () => {
      if (!shot) return;
      const caption = [`№${b.order.number}`, [b.vehicle.make, b.vehicle.model, b.vehicle.year].filter(Boolean).join(' '), formatPlate(b.vehicle.plate, 'en')].filter(Boolean).join(' · ');
      await sendWaFile(to.chat, shot.file, { name: shot.file.name, caption });
      haptic('success');
      onClose();
    }, 'ownerCheck.sent');
  // The owner's chat picked here: it is the boss of the automation from now on — its reports stay as they were set
  // (never turned on from here: picked for this picture, not for the money's every step).
  const pickOwner = (to: WaTarget) => {
    void saveWaAuto('boss', b.settings.waAuto?.boss?.on === undefined ? { to, on: false } : { to });
    void toOwner(to);
  };
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    let made: string | undefined;
    void (async () => {
      const blob = await drawOwnerCheck(await checkData(b, expenses, partsCategoryId, docLang, lang, t));
      if (!alive) return;
      made = URL.createObjectURL(blob);
      const name = [`№${b.order.number}`, b.vehicle.make, b.vehicle.model, `${b.vehicle.plate.code}${b.vehicle.plate.number}`].filter(Boolean).join(' ');
      setShot({ file: new File([blob], `${name}.jpg`, { type: 'image/jpeg' }), url: made });
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [opened, b, expenses, partsCategoryId, docLang, lang, t]);
  return (
    <Modal opened={opened} onClose={onClose} title={t('ownerCheck.title')}>
      <Stack gap="md">
        <Box className="owner-check">{shot ? <img src={shot.url} alt={t('ownerCheck.title')} data-owner-check /> : <Skeleton height={520} radius="lg" />}</Box>
        {ready ? (
          <Stack gap={4}>
            <Group gap={10} wrap="nowrap">
              <Button size="lg" color="green" style={{ flex: 1 }} leftSection={<IconBrandWhatsapp size={22} />} loading={busy} disabled={!shot} onClick={() => (owner ? void toOwner(owner) : setPicking(true))} data-owner-wa>
                {t('ownerCheck.toOwner')}
              </Button>
              <ActionIcon size={50} radius="xl" variant="default" aria-label={t('ownerCheck.share')} disabled={!shot} onClick={() => shot && shareOrDownload(shot.file)}>
                <IconShare size={22} />
              </ActionIcon>
            </Group>
            {owner && (
              <Text size="xs" c="dimmed" ta="center" className="dt-clip">
                {owner.name}
              </Text>
            )}
          </Stack>
        ) : (
          <Button size="lg" fullWidth leftSection={<IconSend size={20} />} disabled={!shot} onClick={() => shot && shareOrDownload(shot.file)}>
            {t('ownerCheck.send')}
          </Button>
        )}
      </Stack>
      {ready && <ChatPicker opened={picking} onClose={() => setPicking(false)} onPick={pickOwner} kind="person" title={t('ownerCheck.pickOwner')} />}
    </Modal>
  );
}
