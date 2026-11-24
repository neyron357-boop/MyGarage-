import { ActionIcon, Button, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandWhatsapp, IconCloudOff, IconCopy, IconExternalLink, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconMessagePlus, IconPhone, IconPin, IconPlus, IconServer, IconSettings, IconTruck, IconUser, IconUserPlus, IconUsers, IconVolumeOff, type Icon } from '@tabler/icons-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { dayShort, dubaiDate, dubaiTime } from '../../domain/dates';
import { formatPhone } from '../../domain/phone';
import { CHAT_TABS, chatPath, chatTitle, filterChats, tabCounts, waDigits, whoOf, type ChatTab, type WaChat, type Who, type WhoKind } from '../../domain/whatsapp';
import type { Supplier } from '../../domain/types';
import { whatsappUrl } from '../../services/messages';
import { loadChats, numberOnWa, refreshWa, waCan, waReady, type WaStore } from '../../services/whatsapp';
import { useWaStatus } from '../../ui/waSel';
import { copyText } from '../../ui/clipboard';
import { EmptyState, List, ListRow, PageHeader, ScrollTabs, SearchField } from '../../ui/components';
import { useDesk } from '../../ui/desk';
import { setWaSideHidden, useWaSideHidden } from '../../ui/deskSide';
import { useAction, useErrorText, useScreenLiveQuery } from '../../ui/hooks';
import { customerOfGroup } from '../../services/chatJobs';
import { LazySheet } from '../../ui/lazy';
import { useMoreRows } from '../../ui/moreRows';
import { useScreen } from '../../ui/stack';
import { waTab } from '../../ui/tabBar';
import { CustomerModal } from '../customers/forms';
import { SupplierSheet } from '../parts/Suppliers';
import { ChatThread } from './ChatThread';
import type { QuickFor } from './ChatQuick';
import { LastLine, useWaPeople, WaAvatar, WhoTag } from './WaParts';

/*
 * «WhatsApp» (v0.78): the garage's chats in the app. A phone: the list, a chat on its own screen. A PC: the list and
 * the open chat side by side, as WhatsApp's own window. Whose chat it is — a customer's, a supplier's — is known by the
 * number: the garage's own name for the person, a tag, a tab of their chats. «＋» writes to anyone the garage knows,
 * or to a number.
 */

/** When a chat last spoke: the time today, «Вчера», the date before that. */
function useWhen() {
  const { t } = useTranslation();
  return useCallback(
    (ms: number) => {
      if (!ms) return '';
      const iso = new Date(ms).toISOString();
      if (dubaiDate(iso) === dubaiDate()) return dubaiTime(iso);
      const d = dayShort(iso);
      return d.word ? t(`common.${d.word}`) : d.text;
    },
    [t],
  );
}

/* ---------- What stands in the way ---------- */

/** Not ready: what it is, in a line, and its one button — none when WhatsApp is linked and working. */
export function WaGate({ s }: { s: WaStore }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const box = (icon: Icon, title: string, hint?: string, action?: React.ReactNode) => (
    <EmptyState icon={icon} title={title} action={action}>
      {hint}
    </EmptyState>
  );
  if (!waCan())
    return box(
      IconServer,
      t('wa.gate.server'),
      t('wa.gate.serverHint'),
      <Button onClick={() => navigate('/settings?tab=data')} data-wa-gate="server">
        {t('wa.gate.connect')}
      </Button>,
    );
  if (s.old) return box(IconServer, t('wa.gate.old'), t('wa.gate.oldHint'));
  const st = s.status;
  if (!st)
    return s.away ? (
      box(
        IconCloudOff,
        t('wa.gate.away'),
        undefined,
        <Button variant="light" onClick={() => void refreshWa()}>
          {t('wa.gate.retry')}
        </Button>,
      )
    ) : (
      <Group justify="center" py="xl">
        <Loader size="sm" />
      </Group>
    );
  if (!st.installed) return box(IconServer, t('wa.gate.install'), t('wa.gate.installHint'));
  if (!st.browser) return box(IconServer, t('wa.gate.browser'));
  if (st.phase === 'ready') return null;
  if (st.phase === 'off')
    return box(
      IconBrandWhatsapp,
      t('wa.gate.off'),
      t('wa.gate.offHint'),
      <Button color="green" leftSection={<IconBrandWhatsapp size={20} />} onClick={() => navigate('/whatsapp/setup')} data-wa-gate="link">
        {t('wa.gate.link')}
      </Button>,
    );
  // On its way: linking is finished on the setup screen; back after a break — it comes by itself.
  return box(
    IconBrandWhatsapp,
    t(`wa.state.${st.phase}`),
    st.phase === 'loading' && st.loading ? `${st.loading} %` : undefined,
    st.phase === 'qr' ? (
      <Button color="green" onClick={() => navigate('/whatsapp/setup')}>
        {t('wa.setup')}
      </Button>
    ) : (
      <Loader size="sm" />
    ),
  );
}

/* ---------- The list ---------- */

const ChatRow = memo(function ChatRow({ c, who, when, active, onOpen }: { c: WaChat; who?: Who; when: string; active: boolean; onOpen: (c: WaChat) => void }) {
  const { t } = useTranslation();
  const title = c.self ? t('wa.self') : chatTitle(c, who);
  return (
    <ListRow
      selected={active}
      onClick={() => onOpen(c)}
      left={<WaAvatar id={c.id} name={title} group={c.group} size={48} />}
      title={
        <span className="wa-row-title" data-wa-chat={c.id}>
          <span className="wa-row-name">{title}</span>
          {who && <WhoTag kind={who.kind} />}
        </span>
      }
      subtitle={c.last ? <LastLine last={c.last} group={c.group} /> : undefined}
      right={
        <span className="wa-row-side">
          <span className="wa-row-when tnum" data-unread={c.unread > 0 || undefined}>
            {when}
          </span>
          <span className="wa-row-marks">
            {c.muted && <IconVolumeOff size={15} stroke={2} aria-hidden />}
            {c.pinned && <IconPin size={15} stroke={2} aria-hidden />}
            {c.unread > 0 && (
              <span className="wa-badge" data-muted={c.muted || undefined}>
                {c.unread > 99 ? '99+' : c.unread}
              </span>
            )}
          </span>
        </span>
      }
    />
  );
});

function ChatList({ s, people, active, onOpen }: { s: WaStore; people: Map<string, Who>; active?: string; onOpen: (c: WaChat) => void }) {
  const { t } = useTranslation();
  const when = useWhen();
  const [tab, setTab] = useState<ChatTab>('all');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => filterChats(s.chats, { tab, query, people }), [s.chats, tab, query, people]);
  const counts = useMemo(() => tabCounts(s.chats, people), [s.chats, people]);
  const { limit, more } = useMoreRows(rows.length, `${tab}|${query}`);
  return (
    <>
      <SearchField value={query} onChange={setQuery} placeholder={t('wa.search')} />
      <ScrollTabs value={tab} onChange={(v) => setTab(v as ChatTab)} items={CHAT_TABS.map((k) => ({ value: k, label: t(`wa.tab.${k}`), count: k === 'all' ? undefined : counts[k] || undefined }))} mb="sm" />
      {rows.length === 0 ? (
        s.chatsLoading && !s.chatsAt ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        ) : (
          <EmptyState icon={IconBrandWhatsapp} title={t(query ? 'wa.noFound' : tab === 'all' ? 'wa.empty' : 'wa.emptyTab')} />
        )
      ) : (
        <List className="wa-chats">
          {rows.slice(0, limit).map((c) => (
            <ChatRow key={c.id} c={c} who={whoOf(c, people)} when={when(c.t)} active={c.id === active} onOpen={onOpen} />
          ))}
          {more()}
        </List>
      )}
    </>
  );
}

/* ---------- A new chat ---------- */

const KIND_ICON: Record<WhoKind, Icon> = { customer: IconUser, supplier: IconTruck, employee: IconUsers, driver: IconUser };

/** «＋»: anyone the garage knows by a number — a customer, a supplier, a mechanic, a driver — or a number typed. */
function NewChatSheet({ opened, onClose, people, onOpen }: { opened: boolean; onClose: () => void; people: Map<string, Who>; onOpen: (phone: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const { run, busy } = useAction({ exclusive: true });
  const q = query.trim().toLowerCase().replace(/ё/g, 'е');
  const digits = waDigits(query);
  const found = useMemo(() => {
    const qd = q.replace(/\D/g, '').replace(/^0+/, '');
    const out: { phone: string; who: Who }[] = [];
    for (const [phone, who] of people) {
      if (q && !who.name.toLowerCase().replace(/ё/g, 'е').includes(q) && !(qd.length >= 3 && phone.includes(qd))) continue;
      out.push({ phone, who });
      if (out.length >= 40) break;
    }
    return out.sort((a, b) => a.who.name.localeCompare(b.who.name));
  }, [people, q]);
  const open = (phone: string) => void run(() => onOpen(phone));
  return (
    <Modal opened={opened} onClose={onClose} title={t('wa.newChat')}>
      <Stack gap="sm" data-wa-new>
        <SearchField value={query} onChange={setQuery} placeholder={t('wa.search')} autoFocus />
        {digits && !people.has(digits) && (
          <Button variant="light" color="green" fullWidth size="md" loading={busy} leftSection={<IconMessagePlus size={20} />} onClick={() => open(digits)} data-wa-new-number>
            {t('wa.newNumber', { phone: formatPhone(`+${digits}`) })}
          </Button>
        )}
        <List>
          {found.map(({ phone, who }) => {
            const I = KIND_ICON[who.kind];
            return (
              <ListRow
                key={phone}
                onClick={() => open(phone)}
                left={
                  <span className="row-icon" style={{ background: 'var(--mantine-color-green-6)' }} aria-hidden>
                    <I size={19} stroke={2} />
                  </span>
                }
                title={who.name || formatPhone(`+${phone}`)}
                subtitle={`${t(`wa.who.${who.kind}`)} · ${formatPhone(`+${phone}`)}`}
              />
            );
          })}
        </List>
        {found.length === 0 && !digits && (
          <Text c="dimmed" ta="center" py="md">
            {t('wa.noFound')}
          </Text>
        )}
      </Stack>
    </Modal>
  );
}

/* ---------- A chat: whose it is ---------- */

/** The chat's card: the person, the number, and where they are in the garage — or a way to add them. */
function ChatInfoSheet({ c, who, title, opened, onClose }: { c: Pick<WaChat, 'id' | 'phone' | 'group' | 'name'>; who?: Who; title: string; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const phone = c.phone ? `+${c.phone}` : '';
  // Someone the garage does not know yet: into its customers or its suppliers, the number and the name filled in.
  const [adding, setAdding] = useState<'customer' | 'supplier' | null>(null);
  const shownName = /^[+\d\s()-]+$/.test(c.name) ? '' : c.name;
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const tile = (key: string, icon: Icon, color: string, label: string, onClick: () => void) => (
    <button key={key} type="button" className="action-tile" onClick={onClick} data-wa-info={key}>
      <span className="tile-icon" style={{ '--c': `var(--mantine-color-${color}-6)` } as React.CSSProperties}>
        {(() => {
          const I = icon;
          return <I size={23} stroke={1.9} aria-hidden />;
        })()}
      </span>
      <span>{label}</span>
    </button>
  );
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack gap="md" align="center">
        <WaAvatar id={c.id} name={title} group={c.group} size={84} />
        <Stack gap={2} align="center">
          {who && <WhoTag kind={who.kind} />}
          {phone && (
            <Text className="tnum selectable" c="dimmed">
              {formatPhone(phone)}
            </Text>
          )}
          {c.name && c.name !== title && (
            <Text size="sm" c="dimmed">
              {c.name}
            </Text>
          )}
        </Stack>
        <div className="action-tiles" style={{ alignSelf: 'stretch' }}>
          {who?.kind === 'customer' && tile('customer', IconUser, 'blue', t('wa.who.customer'), () => go(`/customers/${who.id}`))}
          {who?.kind === 'supplier' && tile('supplier', IconTruck, 'cyan', t('wa.who.supplier'), () => go('/parts?tab=suppliers'))}
          {!who && phone && tile('addCustomer', IconUserPlus, 'blue', t('wa.addCustomer'), () => setAdding('customer'))}
          {!who && phone && tile('addSupplier', IconTruck, 'cyan', t('wa.addSupplier'), () => setAdding('supplier'))}
          {phone && tile('call', IconPhone, 'green', t('wa.call'), () => (window.location.href = `tel:${phone}`))}
          {phone &&
            tile('copy', IconCopy, 'gray', t('wa.copyNumber'), () => {
              void copyText(phone).then((ok) => ok && notifications.show({ color: 'green', message: t('common.copied') }));
              onClose();
            })}
          {phone && tile('app', IconExternalLink, 'teal', t('wa.openApp'), () => window.open(whatsappUrl(phone, ''), '_blank', 'noopener'))}
        </div>
      </Stack>
      <CustomerModal opened={adding === 'customer'} onClose={() => setAdding(null)} initial={{ name: shownName, phone, whatsapp: phone }} onSaved={(saved) => go(`/customers/${saved.id}`)} onPick={(found) => go(`/customers/${found.id}`)} />
      <SupplierSheet opened={adding === 'supplier'} supplier={adding === 'supplier' ? ({ name: shownName, phone } as Partial<Supplier>) : null} onClose={() => setAdding(null)} onSaved={() => setAdding(null)} onExisting={() => setAdding(null)} />
    </Modal>
  );
}

/** A chat's name and who it is, however it was opened: from the list, or by a number that has no chat yet. */
function useChatFace(s: WaStore, people: Map<string, Who>, chatId: string | undefined) {
  const { t } = useTranslation();
  return useMemo(() => {
    if (!chatId) return undefined;
    const row = s.chats.find((c) => c.id === chatId);
    const phone = row?.phone || (/^\d+@c\.us$/.test(chatId) ? chatId.split('@')[0] : '');
    const c = row ?? { id: chatId, name: '', phone, group: chatId.endsWith('@g.us') };
    const who = whoOf({ phone, group: c.group }, people);
    return { c, who, title: row?.self ? t('wa.self') : chatTitle({ name: c.name, phone, group: c.group }, who) || 'WhatsApp' };
  }, [s.chats, people, chatId, t]);
}

/* ---------- The screens ---------- */

function HeaderButtons({ onNew, ready }: { onNew: () => void; ready: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const desk = useDesk();
  const sideHidden = useWaSideHidden();
  return (
    <Group gap="xs" wrap="nowrap">
      {/* A PC (v0.80): the side menu put away — the chats get the whole window; the same button brings it back. */}
      {desk && (
        <ActionIcon variant="default" size={40} radius="xl" aria-label={t(sideHidden ? 'nav.showMenu' : 'nav.hideMenu')} onClick={() => setWaSideHidden(!sideHidden)} data-wa-side-btn>
          {sideHidden ? <IconLayoutSidebarLeftExpand size={21} stroke={1.9} /> : <IconLayoutSidebarLeftCollapse size={21} stroke={1.9} />}
        </ActionIcon>
      )}
      {ready && (
        <ActionIcon variant="default" size={40} radius="xl" aria-label={t('wa.newChat')} onClick={onNew} data-wa-new-btn>
          <IconPlus size={22} stroke={2} />
        </ActionIcon>
      )}
      <ActionIcon variant="default" size={40} radius="xl" aria-label={t('wa.setup')} onClick={() => navigate('/whatsapp/setup')} data-wa-setup-btn>
        <IconSettings size={21} stroke={1.9} />
      </ActionIcon>
    </Group>
  );
}

export function WhatsAppPage() {
  const { t } = useTranslation();
  const desk = useDesk();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const screen = useScreen();
  const params = useParams();
  const chatId = params.id ? decodeURIComponent(params.id) : undefined;
  const s = useWaStatus();
  const people = useWaPeople();
  const ready = waReady(s);
  const face = useChatFace(s, people, chatId);
  // «＋» of the chat (v0.80): the customer's quick actions — by their number, or a company's own group (no prices).
  const groupOwner = useScreenLiveQuery(async () => (chatId?.endsWith('@g.us') ? ((await customerOfGroup(chatId)) ?? null) : null), [chatId]);
  const quick = useMemo<QuickFor | undefined>(
    () => (face?.who?.kind === 'customer' ? { customerId: face.who.id } : groupOwner ? { customerId: groupOwner.id, group: true } : undefined),
    [face?.who?.kind, face?.who?.id, groupOwner],
  );
  const [adding, setAdding] = useState(false);
  const [info, setInfo] = useState(false);

  // The chats: read when WhatsApp is ready, and again whenever this screen comes back to the front.
  useEffect(() => {
    if (ready) void loadChats();
  }, [ready]);
  useEffect(() => screen?.watch(() => void refreshWa().then(() => loadChats())), [screen]);

  // On a PC choosing another chat is not a step of history («Назад» leaves WhatsApp, not the last chat).
  const openChat = useCallback((c: Pick<WaChat, 'id'>) => navigate(chatPath(c.id), { replace: desk && !!chatId }), [navigate, desk, chatId]);
  const openNumber = useCallback(
    async (phone: string) => {
      const r = await numberOnWa(phone);
      if (!r.ok) {
        notifications.show({ color: 'orange', message: t('wa.notOnWa') });
        return;
      }
      setAdding(false);
      openChat({ id: r.chat });
    },
    [openChat, t],
  );
  // A contact card in a chat: its number's chat.
  useEffect(() => {
    const on = (e: Event) => void openNumber(String((e as CustomEvent).detail)).catch((err) => notifications.show({ color: 'red', message: errorText(err) }));
    window.addEventListener('mg-wa-open', on);
    return () => window.removeEventListener('mg-wa-open', on);
  }, [openNumber, errorText]);

  const gate = ready ? null : <WaGate s={s} />;
  const eyebrow = s.status?.me && ready ? formatPhone(`+${s.status.me.phone}`) : undefined;
  const sheets = (
    <>
      <LazySheet opened={adding}>{(o) => <NewChatSheet opened={o} onClose={() => setAdding(false)} people={people} onOpen={openNumber} />}</LazySheet>
      {face && <LazySheet opened={info}>{(o) => <ChatInfoSheet c={face.c} who={face.who} title={face.title} opened={o} onClose={() => setInfo(false)} />}</LazySheet>}
    </>
  );

  if (desk) {
    return (
      <>
        <PageHeader title="WhatsApp" eyebrow={eyebrow} right={<HeaderButtons ready={ready} onNew={() => setAdding(true)} />} />
        {gate ?? (
          <div className="wa-desk">
            <div className="wa-desk-list">
              <ChatList s={s} people={people} active={chatId} onOpen={openChat} />
            </div>
            <div className="wa-desk-chat">
              {face && chatId ? (
                <>
                  <button type="button" className="wa-chat-head" onClick={() => setInfo(true)} data-wa-head>
                    <WaAvatar id={chatId} name={face.title} group={face.c.group} size={40} />
                    <span className="wa-chat-head-name dt-clip">{face.title}</span>
                    {face.who && <WhoTag kind={face.who.kind} />}
                    {face.c.phone && <span className="wa-chat-head-phone tnum">{formatPhone(`+${face.c.phone}`)}</span>}
                  </button>
                  <ChatThread key={chatId} chatId={chatId} title={face.title} group={face.c.group} people={people} desk quick={quick} />
                </>
              ) : (
                <div className="wa-desk-none">
                  <span className="empty-icon" aria-hidden>
                    <IconBrandWhatsapp size={30} stroke={1.8} />
                  </span>
                  <Text c="dimmed">{t('wa.pick')}</Text>
                </div>
              )}
            </div>
          </div>
        )}
        {sheets}
      </>
    );
  }

  // A phone: the list, or a chat on a screen of its own.
  if (chatId && face) {
    return (
      <>
        <PageHeader
          title={
            <span className="wa-title" data-wa-head>
              {face.title}
            </span>
          }
          eyebrow={face.who ? t(`wa.who.${face.who.kind}`) : face.c.phone ? formatPhone(`+${face.c.phone}`) : undefined}
          back="/whatsapp"
          right={
            <button type="button" className="wa-head-avatar tap" aria-label={face.title} onClick={() => setInfo(true)} data-wa-info-btn>
              <WaAvatar id={chatId} name={face.title} group={face.c.group} size={40} />
            </button>
          }
        />
        {gate ?? (
          <div className="notes-page">
            <ChatThread key={chatId} chatId={chatId} title={face.title} group={face.c.group} people={people} desk={false} quick={quick} />
          </div>
        )}
        {sheets}
      </>
    );
  }
  return (
    <>
      {/* A tab of its own on the phone (v0.80) — a root, no «Назад»; without the server it is reached from «Ещё». */}
      <PageHeader title="WhatsApp" eyebrow={eyebrow} back={waTab() ? undefined : '/more'} right={<HeaderButtons ready={ready} onNew={() => setAdding(true)} />} />
      {gate ?? <ChatList s={s} people={people} onOpen={openChat} />}
      {sheets}
    </>
  );
}
