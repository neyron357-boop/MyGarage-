import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBarcodeOff, IconBrandWhatsapp, IconChecks, IconChevronDown, IconClipboardCheck, IconMessageCircle, IconSend, IconStarFilled, IconTruck, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { chatLinkNumber, supplierChatLink } from '../../domain/supplierBook';
import { starsOf, type Ranked, type Why } from '../../domain/supplierRank';
import type { Supplier } from '../../domain/types';
import { partsRequestText, whatsappUrl } from '../../services/messages';
import { suppliersForJob } from '../../services/supplierRank';
import { copyText } from '../../ui/clipboard';
import { EmptyState, List, PageHeader, PageSkeleton } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { db } from '../../db/db';
import { dubaiTime } from '../../domain/dates';
import type { PartAsk } from '../../domain/types';
import { waAutoOf } from '../../domain/waAuto';
import { getSettings } from '../../services/settings';
import { askSuppliers, recordLinkAsk } from '../../services/waAsk';
import { useOutboxKeys } from '../../services/waOutbox';
import { useWa, waReady } from '../../services/whatsapp';
import { ConfirmModal, StickyBar } from '../../ui/components';
import { SheetFor } from '../../ui/lazy';
import { SupplierSheet } from '../parts/Suppliers';
import { DiagramParts, useDiagramSheets } from './DiagramSheets';
import { OffRow, SupplierRow, useUsedFiles } from './SupplierMarks';
import { partsType } from '../../domain/supplierTidy';
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
  // The car's and the parts' photos for a used-parts seller (v0.71), ready before the tap.
  const usedFiles = useUsedFiles(data?.vehicle?.id, lines);
  const [showOff, setShowOff] = useState(false);
  // Asking through the garage's WhatsApp (v0.79, the user: «автоотправка заявок в WhatsApp поставщиков — сначала
  // выбрать их, потом отправить»): picked here, sent by the server one after another.
  const wa = useWa();
  const canSend = waReady(wa);
  const job = useScreenLiveQuery(async () => ({ order: await db.orders.get(id), s: waAutoOf((await getSettings()).waAuto) }), [id]);
  const [picked, setPicked] = useState<Map<string, { used: boolean }> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { run } = useAction({ exclusive: true });
  const asks = job?.order?.asks ?? [];
  useOutboxKeys(asks.filter((a) => a.key).slice(-30).map((a) => a.key!));
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
  // Asking a seller of used parts (v0.71): the car's and the parts' photos with the words — one send.
  const usedText = v && asked.length ? partsRequestText(v, asked, { used: true }) : '';
  const shareUsed = async () => {
    haptic('light');
    const files = usedFiles ?? [];
    if (files.length && typeof navigator.canShare === 'function' && navigator.canShare({ files, text: usedText })) {
      try {
        await navigator.share({ files, text: usedText });
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError' && (await copyText(usedText))) copied();
      }
      return;
    }
    // Where files cannot be shared (a PC): the photos saved, the words to send with them.
    if (files.length) files.forEach(downloadFile);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: usedText });
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    if (await copyText(usedText)) haptic('selection');
  };
  const chatOf = (sup: Supplier, text: string) => {
    // The chat with the list by lines in its box — also on the supplier's own WhatsApp number (v0.61.1: the workbook's
    // link opened the chat empty); a business link opens as it is.
    const own = supplierChatLink(sup);
    const ownNumber = own ? chatLinkNumber(own) : undefined;
    return own ? (ownNumber ? whatsappUrl(ownNumber, text) : own) : sup.phone ? whatsappUrl(sup.phone, text) : undefined;
  };
  /** The newest request to this supplier: sent, waiting, failed — and what it answered. */
  const lastAsk = (supplierId: string): PartAsk | undefined => [...asks].reverse().find((a) => a.supplierId === supplierId);
  const statusOf = (supplierId: string) => {
    const a = lastAsk(supplierId);
    if (!a) return undefined;
    const box = a.key ? wa.outbox[a.key] : undefined;
    const priced = (a.replies ?? []).reduce((n, r) => n + r.lines, 0);
    const answered = (a.replies ?? []).length;
    const state = answered ? 'answered' : box?.state === 'failed' ? 'failed' : box?.state === 'sent' || a.via === 'link' ? 'sent' : 'queued';
    return (
      <span className="ask-status" data-ask-state={state}>
        {state === 'answered' ? (priced ? t('wa.ask.priced', { n: priced }) : t('wa.ask.answered')) : t(`wa.ask.${state}`)}
        {' · '}
        {dubaiTime(a.at)}
      </span>
    );
  };
  const togglePick = (sid: string, used: boolean) =>
    setPicked((p) => {
      const next = new Map(p ?? []);
      if (next.has(sid)) next.delete(sid);
      else next.set(sid, { used });
      return next;
    });
  const rows = (list: Ranked[], used = false) => (
    <List animate>
      {list.map((r) => (
        <SupplierRow
          key={r.supplier.id}
          r={r}
          why={why(r)}
          stars={<StarsPill s={r.supplier} />}
          chat={chatOf(r.supplier, used ? usedText : ask)}
          used={used}
          onUsedAsk={used ? () => void shareUsed() : undefined}
          onCard={() => setCard(r.supplier)}
          picking={!!picked}
          picked={!!picked?.has(r.supplier.id)}
          onPick={() => togglePick(r.supplier.id, used)}
          status={statusOf(r.supplier.id)}
          // The chat opened by its link with the list: kept as a request, its answer read too.
          onChat={used || !asked.length ? undefined : () => void recordLinkAsk(id, r.supplier.id, asked, ask)}
        />
      ))}
    </List>
  );
  const send = () =>
    run(async () => {
      const picks = [...(picked ?? new Map<string, { used: boolean }>()).entries()].map(([supplierId, x]) => ({ supplierId, used: x.used }));
      const r = await askSuppliers(id, picks, { items: asked, sheets: sheets.files, usedFiles: usedFiles ?? [] });
      setConfirming(false);
      setPicked(null);
      haptic('success');
      notifications.show({ color: r.noNumber.length ? 'orange' : 'green', message: [t('wa.ask.queued', { count: r.asked }), r.noNumber.length ? t('wa.ask.noNumber', { names: r.noNumber.join(', ') }) : ''].filter(Boolean).join(' · ') });
    });
  // The answers read, the newest first: what each supplier said.
  const replies = asks
    .flatMap((a) => (a.replies ?? []).map((r) => ({ ...r, supplierId: a.supplierId })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);
  const nameOf = (supplierId: string) => [...data.parts, ...data.contractors].find((x) => x.supplier.id === supplierId)?.supplier.name ?? data.off.find((x) => x.id === supplierId)?.name ?? '';
  // New parts and used ones (v0.71, «разделять поставщиков, которые продают б/у, от новых»): a seller of both is in both.
  const usedOnes = data.parts.filter((r) => ['used', 'both'].includes(partsType(r.supplier) ?? ''));
  const newOnes = data.parts.filter((r) => partsType(r.supplier) !== 'used');
  const groupHead = (title: string, n: number, onAsk?: () => void, busy?: boolean, mark?: string) => (
    <div className="group-title supplier-group" data-supplier-group={mark}>
      <span>{title}</span>
      <span className="count">{n}</span>
      {onAsk && (
        <Button size="compact-md" variant="light" ml="auto" leftSection={<IconSend size={15} />} loading={busy} onClick={onAsk}>
          {t('suppliers.askAll')}
        </Button>
      )}
    </div>
  );
  return (
    <>
      <PageHeader
        back
        eyebrow={v ? [v.make, v.model].filter(Boolean).join(' ') : undefined}
        title={t('suppliers.forJob')}
        right={
          ask ? (
            <Group gap="xs" wrap="nowrap">
              {canSend && (
                <Button variant={picked ? 'filled' : 'light'} color="green" leftSection={picked ? <IconX size={18} /> : <IconBrandWhatsapp size={18} />} onClick={() => setPicked((p) => (p ? null : new Map()))} data-ask-pick>
                  {picked ? t('common.cancel') : t('wa.ask.pick')}
                </Button>
              )}
              {!picked && (
                <Button variant="light" leftSection={<IconSend size={18} />} loading={sheets.making} onClick={() => void share()}>
                  {t('suppliers.askAll')}
                </Button>
              )}
            </Group>
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
          usedOnes.length ? (
            <>
              {/* New parts: the list, the VIN, the diagrams' sheets (as «Спросить» above). */}
              {groupHead(t('suppliers.groupNew'), newOnes.length, ask ? () => void share() : undefined, sheets.making, 'new')}
              {rows(newOnes)}
              {/* Used parts: the list with the car's and the parts' photos. */}
              {groupHead(t('suppliers.groupUsed'), usedOnes.length, usedText ? () => void shareUsed() : undefined, !usedFiles, 'used')}
              {rows(usedOnes, true)}
            </>
          ) : (
            <>
              {(data.contractors.length > 0 || asked.length > 0) && <div className="group-title">{t('suppliers.partsSellers')}</div>}
              {rows(data.parts)}
            </>
          )
        ) : (
          <EmptyState icon={IconTruck} title={t('parts.noSuppliers')} action={<Button onClick={() => navigate('/parts?tab=suppliers')}>{t('suppliers.all')}</Button>} />
        )}
        {data.contractors.length > 0 && (
          <>
            <div className="group-title">{t('suppliers.contractors')}</div>
            {rows(data.contractors)}
          </>
        )}
        {/* Taken off the list by the manager (v0.71): folded, to bring back. */}
        {data.off.length > 0 && (
          <>
            <button type="button" className="group-title supplier-off-head" onClick={() => setShowOff((x) => !x)} aria-expanded={showOff} data-suppliers-off>
              {t('suppliers.mark.offList', { n: data.off.length })}
              <IconChevronDown size={16} style={{ transform: showOff ? 'rotate(180deg)' : undefined, transition: 'transform var(--dur-2) var(--ease-out)' }} aria-hidden />
            </button>
            {showOff && (
              <List>
                {data.off.map((sup) => (
                  <OffRow key={sup.id} s={sup} />
                ))}
              </List>
            )}
          </>
        )}
        {replies.length > 0 && (
          <>
            <div className="group-title">
              <IconMessageCircle size={17} stroke={2} aria-hidden style={{ marginRight: 6 }} />
              {t('wa.ask.replies')}
            </div>
            <div className="ask-replies" data-ask-replies>
              {replies.map((r) => (
                <div key={r.id} className="ask-reply surface">
                  <div className="ask-reply-head">
                    <Text fw={600} lineClamp={1}>
                      {nameOf(r.supplierId)}
                    </Text>
                    <Text size="sm" c="dimmed" className="tnum">
                      {dubaiTime(r.at)}
                    </Text>
                    {r.lines > 0 && (
                      <span className="ask-priced">
                        <IconChecks size={14} stroke={2.4} aria-hidden /> {t('wa.ask.priced', { n: r.lines })}
                      </span>
                    )}
                  </div>
                  <div className="ask-reply-text">{r.text}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {picked && (
        <StickyBar>
          <Button fullWidth size="md" color="green" disabled={!picked.size} leftSection={<IconBrandWhatsapp size={20} />} onClick={() => setConfirming(true)} data-ask-send>
            {picked.size ? t('wa.ask.sendN', { count: picked.size }) : t('wa.ask.pickHint')}
          </Button>
        </StickyBar>
      )}
      <ConfirmModal opened={confirming} onClose={() => setConfirming(false)} title={t('wa.ask.confirmTitle', { count: picked?.size ?? 0 })} confirmLabel={t('wa.ask.send')} color="green" onConfirm={async () => void (await send())}>
        {t('wa.ask.confirmText', { gap: job?.s.ask.gapSec ?? 8, n: asked.length })}
      </ConfirmModal>
      <SheetFor value={card}>{(s, o) => <SupplierSheet opened={o} supplier={s} onClose={() => setCard(null)} onExisting={setCard} />}</SheetFor>
    </>
  );
}
