import { ActionIcon, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandWhatsapp, IconCircle, IconCircleCheckFilled, IconCopy, IconSend, IconStarFilled } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { itemTitle } from '../../domain/items';
import { shownStars, type Ranked, type SupplierKnow, type Why } from '../../domain/supplierRank';
import { partsType } from '../../domain/supplierTidy';
import type { OrderItem, Supplier } from '../../domain/types';
import { chatIdOf, searchDigits } from '../../domain/whatsapp';
import { partNamesText, partsRequestText, whatsappUrl } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { suppliersForJob } from '../../services/supplierRank';
import { askSuppliers, recordLinkAsk } from '../../services/waAsk';
import { waReady } from '../../services/whatsapp';
import { dubaiTime } from '../../domain/dates';
import { LazySheet } from '../../ui/lazy';
import { useLongPress } from '../../ui/longPress';
import { SendLaterSheet } from './SendLater';
import { copyText } from '../../ui/clipboard';
import { PersonAvatar, SearchField } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useErrorText, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { useMoreRows } from '../../ui/moreRows';
import { useWaSel } from '../../ui/waSel';
import { replyTime, WaAvatar } from '../whatsapp/WaParts';

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
 * v0.91 (the owner's notes #74–#75 and his words): every supplier — the base's and those only in WhatsApp (a chat with the
 * status «Поставщик») — the best first (how they answer the garage's requests on WhatsApp, the makes they answered for),
 * drawn as the list is scrolled; the search goes through all of them (name, number, makes); each with its WhatsApp picture
 * («лого поставщиков, так часто сразу узнаю»); «Отправить» stays above the rows.
 */

/**
 * A supplier's stars, as a pill (the suppliers' list and this sheet): the manager's own; v0.91 — else those its WhatsApp
 * answers earned (`know`), paler.
 */
export function StarsPill({ s, know }: { s: Pick<Supplier, 'reliability'>; know?: SupplierKnow }) {
  const stars = shownStars(s, know);
  if (!stars) return null;
  return (
    <span className="stars-pill tnum" data-auto={stars.auto || undefined} aria-label={`★ ${stars.n}`}>
      <IconStarFilled size={12} aria-hidden />
      {stars.n}
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
  // Sellers of parts, the manager's «off» ones left out — all of them, the best first; the search finds any of them.
  const sellers = useMemo(() => (data?.parts ?? []).filter((r) => r.supplier.mark !== 'off'), [data]);
  const q = query.trim().toLowerCase();
  const qDigits = /\p{L}/u.test(q) ? '' : searchDigits(q);
  const found = useMemo(
    () =>
      q
        ? sellers.filter((r) => {
            const s = r.supplier;
            const words = `${s.name} ${s.nameAr ?? ''} ${(s.makes ?? []).join(' ')} ${(r.know?.makes ?? []).map((m) => m.make).join(' ')}`.toLowerCase();
            return words.includes(q) || (!!qDigits && (s.phone ?? '').replace(/\D/g, '').includes(qDigits));
          })
        : sellers,
    [sellers, q, qDigits],
  );
  const { limit, more } = useMoreRows(found.length, `${q}|${opened}`);
  const shown = found.slice(0, limit);
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
  const send = (after?: number) =>
    run(async () => {
      const r = await askSuppliers(
        b.order.id,
        [...who].map((supplierId) => ({ supplierId })),
        { items: asked, sheets: [], usedFiles: [], after },
      );
      haptic('success');
      if (r.noNumber.length) notifications.show({ color: 'orange', message: t('ask.noNumber', { names: r.noNumber.join(', ') }) });
      notifications.show({ color: 'green', message: after ? t('later.queued', { n: r.asked, time: dubaiTime(new Date(after).toISOString()) }) : t('ask.sent', { n: r.asked }) });
      setLater(false);
      onClose();
    });
  // v0.91.7 (#76): held — «Отправить позже», the time picked; a right click on a PC.
  const [later, setLater] = useState(false);
  const ready = canSend && who.size > 0 && asked.length > 0;
  const hold = useLongPress(() => ready && setLater(true));
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
            {more()}
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
            <Button
              size="lg"
              style={{ flex: 1 }}
              className="hold-button"
              leftSection={<IconSend size={18} />}
              loading={busy}
              disabled={!ready}
              {...hold.handlers}
              onClick={() => {
                if (hold.consumeClick()) return;
                void send();
              }}
              data-ask-send
            >
              {canSend ? t('ask.send', { n: who.size }) : t('ask.noWa')}
            </Button>
          </Group>
        </div>
        <LazySheet opened={later}>{(o) => <SendLaterSheet opened={o} onClose={() => setLater(false)} n={who.size} onPick={(at) => void send(at)} />}</LazySheet>
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

/** Why a supplier is where it is, in a few words: on this job, its make (answered for, said by the AI), how fast it answers. */
function whyWords(r: Ranked, t: (k: string, o?: Record<string, unknown>) => string): string {
  const s = r.supplier;
  const out: string[] = [];
  // v0.91.6: one of the garage's main suppliers — said first.
  if (r.why.some((w) => w.kind === 'top')) out.push(t('ask.top'));
  if (r.why.some((w) => w.kind === 'onJob')) out.push(t('suppliers.why.onJob'));
  const make = r.why.find((w): w is Extract<Why, { kind: 'make' | 'answers' | 'aiMake' | 'boughtFor' }> => w.kind === 'make' || w.kind === 'answers' || w.kind === 'aiMake' || w.kind === 'boughtFor');
  if (make) out.push(make.kind === 'answers' ? t('ask.answersFor', { make: make.make, n: make.n }) : make.make);
  const seen = r.know?.seen;
  if (seen?.replyMin !== undefined && seen.answered >= 2) out.push(t('ask.replies', { time: replyTime(t, seen.replyMin) }));
  if (partsType(s) === 'used') out.push(t('ask.used'));
  if (r.use.jobs && out.length < 3) out.push(t('suppliers.jobs', { count: r.use.jobs }));
  return out.slice(0, 4).join(' · ');
}

/**
 * A supplier to ask: its WhatsApp picture (v0.91), a tap — picked; why it fits under its name; the stars (the manager's,
 * else those its answers earned — paler); without the garage's WhatsApp — its chat by a link.
 */
function SupplierPick({ r, on, onTap, link }: { r: Ranked; on: boolean; onTap: () => void; link?: { text: string; orderId: string; items: OrderItem[] } }) {
  const { t } = useTranslation();
  const s: Supplier = r.supplier;
  const why = whyWords(r, t);
  const chat = r.chat ?? chatIdOf(s.phone);
  return (
    <div className="ask-row-wrap">
      <button type="button" className="ask-row" aria-pressed={on} onClick={onTap} data-ask-supplier={s.id} data-ask-chat-only={r.chat ? true : undefined} data-ask-top={r.why.some((w) => w.kind === 'top') || undefined}>
        {on ? <IconCircleCheckFilled size={22} className="ask-check" data-on aria-hidden /> : <IconCircle size={22} stroke={1.6} className="ask-check" aria-hidden />}
        {chat ? <WaAvatar id={chat} name={s.name} size={36} /> : <PersonAvatar name={s.name} size={36} />}
        <span className="ask-row-main">
          <span className="ask-row-name supplier-name-text">{s.name}</span>
          {why && <span className="ask-row-why">{why}</span>}
        </span>
        <StarsPill s={s} know={r.know} />
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
