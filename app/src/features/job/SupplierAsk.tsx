import { ActionIcon, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandWhatsapp, IconCircle, IconCircleCheckFilled, IconCopy, IconSend, IconStarFilled } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { itemTitle } from '../../domain/items';
import { starsOf, type Ranked } from '../../domain/supplierRank';
import { partsType } from '../../domain/supplierTidy';
import type { OrderItem, Supplier } from '../../domain/types';
import { partNamesText, partsRequestText, whatsappUrl } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { suppliersForJob } from '../../services/supplierRank';
import { askSuppliers, recordLinkAsk } from '../../services/waAsk';
import { waReady } from '../../services/whatsapp';
import { copyText } from '../../ui/clipboard';
import { SearchField } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useErrorText, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { useWaSel } from '../../ui/waSel';

/*
 * «Поставщики» under a job's lines (v0.82, the owner's notes 24/11: «убрать полностью эту капсулу и весь его модуль»; «кнопку
 * Поставщики и быструю отправку им: нажал — открылось окно со списками подходящих поставщиков, выбрал несколько и нажал
 * отправить — сразу отправляются им по WhatsApp; сначала выбрать несколько деталей из списка или все; без схем; можно
 * заменить кнопку Копировать»). One sheet in place of the job's suppliers' screen:
 *  - the parts — those still to buy picked at first (else all), a tap each, «Все»;
 *  - the suppliers that fit (services/supplierRank.ts: on this job, bought for this make, sold such a part, the stars…),
 *    the best first, a search for any other; those taken off the list are not offered;
 *  - «Отправить · N» — the list (no diagrams) to each picked one through the garage's WhatsApp, one after another
 *    (services/waAsk.ts `askSuppliers`: their answers are read into the lines' offers as before). The pick and the tap are
 *    the person's own sending — nothing goes by itself. Without the garage's WhatsApp: each one's chat by a link with
 *    the list, and «Скопировать».
 */

const SHOWN = 12;

/** The manager's stars of a supplier, as a pill (the suppliers' list and this sheet). */
export function StarsPill({ s }: { s: Pick<Supplier, 'reliability'> }) {
  const n = starsOf(s);
  if (!n) return null;
  return (
    <span className="stars-pill tnum" aria-label={`★ ${n}`}>
      <IconStarFilled size={12} aria-hidden />
      {n}
    </span>
  );
}

export function SupplierAskSheet({ b, opened, onClose }: { b: OrderBundle; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const data = useScreenLiveQuery(() => (opened ? suppliersForJob(b.order.id, lang) : undefined), [b.order.id, lang, opened]);
  const canSend = useWaSel(waReady);
  const { run, busy } = useAction({ exclusive: true });
  const [parts, setParts] = useState<Set<string> | null>(null);
  const [who, setWho] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  // Opened: the parts still to buy (else all of them), nobody picked yet.
  useEffect(() => {
    if (!opened) return;
    setParts(null);
    setWho(new Set());
    setQuery('');
  }, [opened]);
  const lines = data?.partLines ?? [];
  const toBuy = lines.filter((i) => !i.procurementStatus || i.procurementStatus === 'needed');
  const picked = parts ?? new Set((toBuy.length ? toBuy : lines).map((i) => i.id));
  const asked = lines.filter((i) => picked.has(i.id));
  // Sellers of parts, the manager's «off» ones left out; the search finds any of them.
  const sellers = useMemo(() => (data?.parts ?? []).filter((r) => r.supplier.mark !== 'off'), [data]);
  const q = query.trim().toLowerCase();
  const shown = q ? sellers.filter((r) => `${r.supplier.name} ${r.supplier.nameAr ?? ''} ${r.supplier.phone ?? ''}`.toLowerCase().includes(q)).slice(0, 30) : sellers.slice(0, SHOWN);
  // The picked ones stay in sight whatever is searched.
  const pickedRows = sellers.filter((r) => who.has(r.supplier.id) && !shown.includes(r));
  const text = b.vehicle && asked.length ? partsRequestText(b.vehicle, asked) : '';
  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    haptic('selection');
    return n;
  };
  const send = () =>
    run(async () => {
      const r = await askSuppliers(
        b.order.id,
        [...who].map((supplierId) => ({ supplierId })),
        { items: asked, sheets: [], usedFiles: [] },
      );
      haptic('success');
      if (r.noNumber.length) notifications.show({ color: 'orange', message: t('ask.noNumber', { names: r.noNumber.join(', ') }) });
      notifications.show({ color: 'green', message: t('ask.sent', { n: r.asked }) });
      onClose();
    });
  const copy = () =>
    void run(async () => {
      if (!(await copyText(partNamesText(asked, b.order.docLanguage, b.vehicle)))) throw new Error('copy');
      haptic('light');
      notifications.show({ color: 'green', message: t('job.copiedLines') });
    }).catch((e) => notifications.show({ color: 'red', message: errorText(e) }));
  const allOn = lines.length > 0 && asked.length === lines.length;
  const row = (r: Ranked) => <SupplierPick key={r.supplier.id} r={r} on={who.has(r.supplier.id)} onTap={() => setWho((w) => toggle(w, r.supplier.id))} link={!canSend && text ? { text, orderId: b.order.id, items: asked } : undefined} />;
  return (
    <Modal opened={opened} onClose={onClose} title={t('ask.title')} classNames={{ content: 'sheet-grouped ask-sheet' }}>
      <Stack gap="md">
        <div>
          <Group justify="space-between" wrap="nowrap" mb={6}>
            <div className="group-title" style={{ margin: 0 }}>
              {t('ask.parts')} <span className="count">{asked.length}</span>
            </div>
            <Button variant="subtle" size="compact-md" onClick={() => (setParts(allOn ? new Set() : new Set(lines.map((i) => i.id))), haptic('selection'))} data-ask-all>
              {allOn ? t('job.pickNone') : t('job.pickAll')}
            </Button>
          </Group>
          <div className="ios-group">
            {lines.map((i) => (
              <PartPick key={i.id} i={i} lang={b.order.docLanguage} on={picked.has(i.id)} onTap={() => setParts(toggle(picked, i.id))} />
            ))}
            {!lines.length && (
              <Text c="dimmed" p="md" size="sm">
                {t('ask.noParts')}
              </Text>
            )}
          </div>
        </div>
        <div>
          <div className="group-title">
            {t('ask.who')}
            {who.size > 0 && <> <span className="count">{who.size}</span></>}
          </div>
          <SearchField value={query} onChange={setQuery} placeholder={t('ask.search')} />
          <div className="ios-group" style={{ marginTop: 8 }}>
            {pickedRows.map(row)}
            {shown.map(row)}
            {!shown.length && !pickedRows.length && (
              <Text c="dimmed" p="md" size="sm">
                {t('ask.noSuppliers')}
              </Text>
            )}
          </div>
        </div>
        <div className="sheet-footer">
          <Group gap={8} wrap="nowrap">
            <ActionIcon size={48} radius="xl" variant="light" aria-label={t('job.copyLines')} disabled={!asked.length} onClick={copy} data-ask-copy>
              <IconCopy size={20} />
            </ActionIcon>
            <Button size="lg" style={{ flex: 1 }} leftSection={<IconSend size={18} />} loading={busy} disabled={!canSend || !who.size || !asked.length} onClick={() => void send()} data-ask-send>
              {canSend ? t('ask.send', { n: who.size }) : t('ask.noWa')}
            </Button>
          </Group>
        </div>
      </Stack>
    </Modal>
  );
}

/** A part to ask about: a tap — in or out. */
function PartPick({ i, lang, on, onTap }: { i: OrderItem; lang: 'en' | 'ru'; on: boolean; onTap: () => void }) {
  return (
    <button type="button" className="ask-row" aria-pressed={on} onClick={onTap} data-ask-part={i.id}>
      {on ? <IconCircleCheckFilled size={22} className="ask-check" data-on aria-hidden /> : <IconCircle size={22} stroke={1.6} className="ask-check" aria-hidden />}
      <span className="ask-row-name">{itemTitle(i, lang)}</span>
      {i.qty !== 1 && <span className="ask-row-note tnum">× {i.qty}</span>}
    </button>
  );
}

/** A supplier to ask: a tap — picked; why it fits under its name; without the garage's WhatsApp — its chat by a link. */
function SupplierPick({ r, on, onTap, link }: { r: Ranked; on: boolean; onTap: () => void; link?: { text: string; orderId: string; items: OrderItem[] } }) {
  const { t } = useTranslation();
  const s: Supplier = r.supplier;
  const stars = starsOf(s) ?? 0;
  const used = partsType(s) === 'used';
  const why = [r.why.some((w) => w.kind === 'onJob') ? t('suppliers.why.onJob') : '', used ? t('ask.used') : '', r.use.jobs ? t('suppliers.jobs', { count: r.use.jobs }) : ''].filter(Boolean).join(' · ');
  return (
    <div className="ask-row-wrap">
      <button type="button" className="ask-row" aria-pressed={on} onClick={onTap} data-ask-supplier={s.id}>
        {on ? <IconCircleCheckFilled size={22} className="ask-check" data-on aria-hidden /> : <IconCircle size={22} stroke={1.6} className="ask-check" aria-hidden />}
        <span className="ask-row-main">
          <span className="ask-row-name supplier-name-text">{s.name}</span>
          {why && <span className="ask-row-why">{why}</span>}
        </span>
        {stars > 0 && (
          <span className="stars-pill tnum" aria-label={`★ ${stars}`}>
            <IconStarFilled size={12} aria-hidden />
            {stars}
          </span>
        )}
      </button>
      {link && s.phone && (
        <ActionIcon
          component="a"
          href={whatsappUrl(s.phone, link.text)}
          target="_blank"
          rel="noopener"
          size={40}
          radius="xl"
          variant="light"
          color="green"
          aria-label="WhatsApp"
          onClick={() => void recordLinkAsk(link.orderId, s.id, link.items, link.text)}
        >
          <IconBrandWhatsapp size={20} />
        </ActionIcon>
      )}
    </div>
  );
}
