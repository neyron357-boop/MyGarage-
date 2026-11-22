import { ActionIcon, Button, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandWhatsapp, IconClipboardCheck, IconBarcodeOff, IconPhone, IconSend, IconStarFilled, IconTruck } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { chatLinkNumber, supplierChatLink } from '../../domain/supplierBook';
import { starsOf, type Ranked, type Why } from '../../domain/supplierRank';
import type { Supplier } from '../../domain/types';
import { partsRequestText, whatsappUrl } from '../../services/messages';
import { suppliersForJob } from '../../services/supplierRank';
import { copyText } from '../../ui/clipboard';
import { EmptyState, List, ListRow, PageHeader, PageSkeleton, PersonAvatar } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useLang, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { SupplierSheet } from '../parts/Suppliers';
import { DiagramParts, useDiagramSheets } from './DiagramSheets';
import { downloadFile } from '../../ui/share';

/** The manager's stars of a supplier, small: "★ 4" (not rated — nothing). */
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

/** Why it fits, in a few words: "На этом заказе · Toyota ×5 · Продавал: TIE ROD END · 12 заказов". */
function useWhy() {
  const { t } = useTranslation();
  return (r: Ranked) =>
    [
      ...r.why.map((w: Why) => {
        switch (w.kind) {
          case 'onJob':
            return t('suppliers.why.onJob');
          case 'boughtFor':
            return t('suppliers.why.boughtFor', { make: w.make, n: w.jobs });
          case 'sold':
            return w.times > 1 ? t('suppliers.why.soldN', { part: w.part, n: w.times }) : t('suppliers.why.sold', { part: w.part });
          case 'make':
            return w.make;
          case 'sells':
            return t('suppliers.why.sells', { part: w.part });
        }
      }),
      r.use.jobs ? t('suppliers.jobs', { count: r.use.jobs }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
}

/**
 * The suppliers for a job (v0.38, the user's ask — its own screen, from the chip «Поставщики» under the job): the best
 * fit first — already on its lines, bought from for this make, sold such a part before, the make or the part declared,
 * the manager's stars, how often and how lately. WhatsApp asks one of them about all the job's parts at once (the car,
 * its VIN, the parts); a tap opens the supplier's card (its stars). Contractors — when the job has work done outside.
 */
export function JobSuppliersPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const lang = useLang();
  const navigate = useNavigate();
  const data = useScreenLiveQuery(() => suppliersForJob(id, lang), [id, lang]);
  const why = useWhy();
  const [card, setCard] = useState<Supplier | null>(null);
  // What is still to buy (all the parts, once every one is ordered) — the list asked about, and its diagrams' sheets.
  const needed = data ? data.partLines.filter((i) => !i.procurementStatus || i.procurementStatus === 'needed') : [];
  const lines = data ? (needed.length ? needed : data.partLines) : [];
  // Without the part numbers (v0.68, the user: «убрать номера деталей, чтобы отправился только список и схема — магазин
  // сам ищет правильную»): the list, the sheets and the chats as the supplier gets them — names and diagrams only.
  const [plain, setPlain] = useState(false);
  const numbered = lines.some((i) => i.partNumber?.trim());
  const asked = plain ? lines.map((i) => ({ ...i, partNumber: undefined })) : lines;
  const sheets = useDiagramSheets(asked);
  if (data === undefined) return <PageSkeleton />;
  if (data === null) return <EmptyState title={t('err.notFound')} />;
  const v = data.vehicle;
  // The list by lines: in the supplier's chat link (the link keeps the breaks) — and, with the sheets, in the same send.
  const ask = v && asked.length ? partsRequestText(v, asked) : '';
  const askWithSheets = v && asked.length ? partsRequestText(v, asked, { diagrams: true }) : '';
  const copied = () => notifications.show({ color: 'green', message: t('diagrams.pasteCaption'), autoClose: 6000, icon: <IconClipboardCheck size={18} /> });
  const share = async () => {
    haptic('light');
    // v0.59: with the diagrams' sheets (four to a picture, numbered as the list) when the phone can share files.
    const files = sheets.files;
    const can = (d: ShareData) => files.length > 0 && typeof navigator.canShare === 'function' && navigator.canShare(d);
    // v0.61.1 (the user: «список текст деталей не ложится в ватсап, а только копируется, и при вставке одной строкой»):
    // the sheets and the list in one send again. WhatsApp takes the list as its own message, by lines, and it lands
    // by itself; the list in the clipboard (v0.59.1–v0.59.3) was pasted into the caption of WhatsApp's share window,
    // which keeps no line breaks. Started in the tap itself (iOS shares only there).
    if (can({ files, text: askWithSheets })) {
      try {
        await navigator.share({ files, text: askWithSheets });
      } catch (e) {
        // closed without sending — nothing; refused — the list at least copied
        if ((e as Error)?.name !== 'AbortError' && (await copyText(askWithSheets))) copied();
      }
      return;
    }
    if (can({ files })) {
      // a share sheet that takes files but not words with them: the sheets, and the list to send after them
      const copy = copyText(askWithSheets);
      const shared = navigator.share({ files });
      void copy.then((ok) => ok && copied());
      await shared.catch(() => undefined);
      return;
    }
    // Where files cannot be shared (a PC): the sheets saved, to attach.
    if (files.length) files.forEach(downloadFile);
    const text = files.length ? askWithSheets : ask;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    if (await copyText(text)) haptic('selection');
  };
  const rows = (list: Ranked[]) => (
    <List>
      {list.map((r) => {
        const s = r.supplier;
        // The chat with the list by lines in its box — also on the supplier's own WhatsApp number (v0.61.1: the
        // workbook's link opened the chat empty); a business link opens as it is.
        const own = supplierChatLink(s);
        const ownNumber = own ? chatLinkNumber(own) : undefined;
        const chat = own ? (ownNumber ? whatsappUrl(ownNumber, ask) : own) : s.phone ? whatsappUrl(s.phone, ask) : undefined;
        return (
          <ListRow
            key={s.id}
            onClick={() => setCard(s)}
            left={<PersonAvatar name={s.name} company size={36} />}
            title={
              <span className="supplier-name">
                <span className="supplier-name-text">{s.name}</span>
                <StarsPill s={s} />
              </span>
            }
            subtitle={why(r) || undefined}
            right={
              <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                {chat && (
                  <ActionIcon component="a" href={chat} target="_blank" rel="noopener" variant="light" color="green" size={36} radius="xl" aria-label="WhatsApp" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    <IconBrandWhatsapp size={19} />
                  </ActionIcon>
                )}
                {s.phone && (
                  <ActionIcon component="a" href={`tel:${s.phone}`} variant="light" color="green" size={36} radius="xl" aria-label={t('customer.call')} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    <IconPhone size={18} />
                  </ActionIcon>
                )}
              </Group>
            }
          />
        );
      })}
    </List>
  );
  return (
    <>
      <PageHeader
        back
        eyebrow={v ? [v.make, v.model].filter(Boolean).join(' ') : undefined}
        title={t('suppliers.forJob')}
        right={
          ask ? (
            <Button variant="light" leftSection={<IconSend size={18} />} loading={sheets.making} onClick={() => void share()}>
              {t('suppliers.askAll')}
            </Button>
          ) : undefined
        }
      />
      <div className="job-suppliers">
        {numbered && (
          <div className="chip-row">
            <button type="button" className="chip" data-active={plain} aria-pressed={plain} onClick={() => setPlain((p) => !p)} data-plain-ask>
              <IconBarcodeOff size={16} stroke={2} style={{ verticalAlign: -3, marginRight: 6 }} aria-hidden />
              {t('suppliers.noNumbers')}
            </button>
          </div>
        )}
        <DiagramParts items={asked} sheets={sheets} />
        {data.parts.length ? (
          <>
            {(data.contractors.length > 0 || asked.length > 0) && <div className="group-title">{t('suppliers.partsSellers')}</div>}
            {rows(data.parts)}
          </>
        ) : (
          <EmptyState icon={IconTruck} title={t('parts.noSuppliers')} action={<Button onClick={() => navigate('/parts?tab=suppliers')}>{t('suppliers.all')}</Button>} />
        )}
        {data.contractors.length > 0 && (
          <>
            <div className="group-title">{t('suppliers.contractors')}</div>
            {rows(data.contractors)}
          </>
        )}
      </div>
      <SheetFor value={card}>{(s, o) => <SupplierSheet opened={o} supplier={s} onClose={() => setCard(null)} onExisting={setCard} />}</SheetFor>
    </>
  );
}
