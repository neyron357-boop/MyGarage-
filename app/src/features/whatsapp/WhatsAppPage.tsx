import { ActionIcon, Button, Group, Loader, Modal, Stack, Switch, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandWhatsapp, IconBriefcase, IconCar, IconChevronLeft, IconCircle, IconCircleCheckFilled, IconCloudOff, IconListCheck, IconSearch, IconStarFilled, IconTag, IconTool, IconX, IconCopy, IconExternalLink, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconMessagePlus, IconPhone, IconPin, IconPlus, IconServer, IconSettings, IconTruck, IconUser, IconUserPlus, IconUsers, IconVolumeOff, type Icon } from '@tabler/icons-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { dayShort, dubaiDate, dubaiTime } from '../../domain/dates';
import { CAR_MAKES, POPULAR_MAKES } from '../../domain/carCatalog';
import type { KnownMake } from '../../domain/chatStudy';
import { formatPhone } from '../../domain/phone';
import { aiRoleOf, CHAT_TABS, chatPath, chatRole, chatTitle, filterChats, NO_ROLES, tabCounts, WA_TAGS, waDigits, whoOf, type ChatTab, type WaChat, type WaTag, type Who, type WhoKind } from '../../domain/whatsapp';
import type { Supplier } from '../../domain/types';
import { whatsappUrl } from '../../services/messages';
import { loadChatRoles, loadChats, numberOnWa, refreshWa, tagChats, waCan, waReady, type WaStore } from '../../services/whatsapp';
import { chatKnow, chatsMakes, loadChatMakes, onStudyProgress, setChatMakes, studyProgress } from '../../services/chatStudy';
import { AiMark } from '../ai/Ai';
import { haptic } from '../../ui/haptics';
import { useWaStatus } from '../../ui/waSel';
import { copyText } from '../../ui/clipboard';
import { EmptyState, List, ListRow, PageHeader, SearchField, StickyBar } from '../../ui/components';
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
import { ChatHead, LastLine, replyTime, useWaPeople, WaAvatar, WhoTag } from './WaParts';

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
      <Button data-route={'/settings?tab=data'} onClick={() => navigate('/settings?tab=data')} data-wa-gate="server">
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
      <Button color="green" leftSection={<IconBrandWhatsapp size={20} />} data-route={'/whatsapp/setup'} onClick={() => navigate('/whatsapp/setup')} data-wa-gate="link">
        {t('wa.gate.link')}
      </Button>,
    );
  // On its way: linking is finished on the setup screen; back after a break — it comes by itself.
  return box(
    IconBrandWhatsapp,
    t(`wa.state.${st.phase}`),
    st.phase === 'loading' && st.loading ? `${st.loading} %` : undefined,
    st.phase === 'qr' ? (
      <Button color="green" data-route={'/whatsapp/setup'} onClick={() => navigate('/whatsapp/setup')}>
        {t('wa.setup')}
      </Button>
    ) : (
      <Loader size="sm" />
    ),
  );
}

/* ---------- The list ---------- */

const ChatRow = memo(function ChatRow({ c, who, role, byAi, makes, when, active, onOpen, picking, picked }: { c: WaChat; who?: Who; role?: WhoKind | WaTag; byAi?: boolean; makes?: KnownMake[]; when: string; active: boolean; onOpen: (c: WaChat) => void; picking?: boolean; picked?: boolean }) {
  const { t } = useTranslation();
  const title = c.self ? t('wa.self') : chatTitle(c, who);
  return (
    <ListRow
      selected={active || picked}
      // The chat in a tab of its own (v0.89, the PC's right click, the wheel, Ctrl+click) — not while picking chats.
      data-route={picking ? undefined : chatPath(c.id)}
      onClick={() => onOpen(c)}
      left={
        <span className="wa-row-left">
          {picking && (
            <span className="wa-pick" aria-hidden>
              {picked ? <IconCircleCheckFilled size={24} color="var(--mantine-color-cobalt-6)" /> : <IconCircle size={24} stroke={1.6} color="var(--app-label-3)" />}
            </span>
          )}
          <WaAvatar id={c.id} name={title} group={c.group} size={48} />
        </span>
      }
      title={
        <span className="wa-row-title" data-wa-chat={c.id} data-wa-picked={picked || undefined}>
          <span className="wa-row-name">{title}</span>
          {role && <WhoTag kind={role} />}
          {/* The status said by the AI (v0.86) — a status set by hand takes its place. */}
          {byAi && <AiMark size={13} label={t('ai.chatByAi')} />}
        </span>
      }
      subtitle={
        // v0.91: the makes a supplier is known for (by hand, answered for; said by the AI — dimmer), before its last words.
        makes?.length ? (
          <span className="wa-row-sub">
            <span className="wa-row-makes" data-ai={makes.every((m) => m.by === 'ai') || undefined} data-wa-makes>
              {makes
                .slice(0, 3)
                .map((m) => m.make)
                .join(' · ')}
              {makes.length > 3 && ` +${makes.length - 3}`}
            </span>
            {c.last && <LastLine last={c.last} group={c.group} />}
          </span>
        ) : c.last ? (
          <LastLine last={c.last} group={c.group} />
        ) : undefined
      }
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

/** The statuses a chat can be given by hand, each with its symbol (v0.81). */
const TAG_ICON: Record<WaTag, Icon> = { customer: IconUser, supplier: IconTruck, service: IconTool, work: IconBriefcase };

/**
 * The statuses for the chats picked (v0.81, the user's brief: «отметить несколько чатов и одним действием присвоить им общий
 * статус»): one tap — all of them; «Без статуса» takes the hand-given one off (the base's own — a customer's number — stays).
 */
function TagSheet({ opened, onClose, n, onTag }: { opened: boolean; onClose: () => void; n: number; onTag: (tag: WaTag | null) => void }) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={t('wa.tags.title', { n })} classNames={{ content: 'sheet-grouped' }}>
      <List>
        {WA_TAGS.map((tag) => {
          const I = TAG_ICON[tag];
          return (
            <ListRow key={tag} left={<I size={20} stroke={1.9} color="var(--mantine-color-cobalt-6)" aria-hidden />} title={t(`wa.who.${tag}`)} onClick={() => onTag(tag)} chevron />
          );
        })}
        <ListRow left={<IconX size={20} stroke={1.9} color="var(--mantine-color-dimmed)" aria-hidden />} title={<Text span inherit c="dimmed">{t('wa.tags.none')}</Text>} onClick={() => onTag(null)} />
      </List>
    </Modal>
  );
}

/**
 * Makes for the chats picked (v0.91, the owner: «выбрать несколько чатов, например поставщики Тойота, и присвоить им марку
 * Тойота, чтобы при поиске деталей первыми отображались»): the makes they all have are on; one only some of them have is
 * marked so (it stays as it is unless tapped); a tap — on or off; «Сохранить» — to each (services/chatStudy.ts).
 */
function MakeSheet({ opened, onClose, onDone, chats }: { opened: boolean; onClose: () => void; onDone: () => void; chats: WaChat[] }) {
  const { t } = useTranslation();
  const { run, busy } = useAction({ exclusive: true });
  const had = useScreenLiveQuery(() => (opened ? chatsMakes(chats) : undefined), [opened, chats]);
  const [on, setOn] = useState<Set<string> | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!opened) return;
    setOn(null);
    setQuery('');
  }, [opened]);
  const chosen = on ?? new Set(had?.common ?? []);
  const some = new Set((had?.all ?? []).filter((m) => !(had?.common ?? []).includes(m)));
  const q = query.trim().toLowerCase();
  const list = q ? CAR_MAKES.filter((m) => m.toLowerCase().includes(q)) : [...new Set([...(had?.all ?? []), ...POPULAR_MAKES, ...CAR_MAKES])];
  const toggle = (m: string) => {
    haptic('selection');
    setOn(() => {
      const n = new Set(chosen);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });
  };
  const save = () =>
    void run(async () => {
      const n = await setChatMakes(chats, [...chosen], had?.common ?? []);
      haptic('success');
      notifications.show({ color: 'green', message: t('wa.makes.done', { count: n }) });
      onDone();
    });
  return (
    <Modal opened={opened} onClose={onClose} title={t('wa.makes.title', { n: chats.filter((c) => !c.group).length })} classNames={{ content: 'sheet-grouped' }}>
      <Stack gap="md">
        <SearchField value={query} onChange={setQuery} placeholder={t('wa.makes.search')} />
        <div className="chip-row wrap" data-wa-make-list>
          {list.map((m) => (
            <button key={m} type="button" className="chip" data-active={chosen.has(m) ? 'true' : undefined} data-some={!chosen.has(m) && some.has(m) ? true : undefined} aria-pressed={chosen.has(m)} onClick={() => toggle(m)} data-wa-make={m}>
              {m}
            </button>
          ))}
        </div>
        <div className="sheet-footer">
          <Button fullWidth size="lg" loading={busy} disabled={!had} onClick={save} data-wa-make-save>
            {t('common.save')}
          </Button>
        </div>
      </Stack>
    </Modal>
  );
}

/** What a chat taught the garage (v0.91), on its card: the stars its answers earned, how it answers, its makes. */
function ChatKnowBlock({ id, phone }: { id: string; phone: string }) {
  const { t } = useTranslation();
  const k = useScreenLiveQuery(() => chatKnow(id, phone), [id, phone]);
  if (!k || (!k.seen.turns && !k.seen.open && !k.makes.length)) return null;
  const s = k.seen;
  return (
    <div className="wa-know" data-wa-know>
      {k.rating && (
        <span className="stars-pill tnum" data-auto aria-label={`★ ${k.rating.stars}`}>
          <IconStarFilled size={12} aria-hidden />
          {k.rating.stars}
        </span>
      )}
      {s.turns + s.open > 0 && (
        <span className="wa-know-line">
          {[
            t('wa.know.asked', { count: s.turns + s.open }),
            t('wa.know.answered', { n: s.answered }),
            s.priced ? t('wa.know.priced', { n: s.priced }) : '',
            s.na ? t('wa.know.na', { n: s.na }) : '',
            s.replyMin !== undefined ? t('wa.know.reply', { time: replyTime(t, s.replyMin) }) : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
      {k.makes.length > 0 && (
        <span className="wa-know-makes">
          {k.makes.map((m) => (
            <span key={m.make} className="wa-know-make" data-by={m.by}>
              {m.make}
              {m.by === 'seen' && m.n ? <span className="tnum"> · {m.n}</span> : null}
              {m.by === 'ai' && <AiMark size={11} label={t('wa.know.byAi')} />}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * The list as it was left (v0.84, the brief: «при возврате из чата сохраняй поиск, фильтр и позицию в списке в рамках
 * текущей сессии… при следующем запуске снова включай рабочий фильтр»): the tab, the search, «Только гараж», how far it was
 * scrolled and how many rows were drawn — kept while the app is open; «Только гараж» is on again at each start.
 */
const view = { tab: 'all' as ChatTab, query: '', garageOnly: true, scroll: 0, shown: 0 };

function ChatList({ s, people, active, onOpen }: { s: WaStore; people: Map<string, Who>; active?: string; onOpen: (c: WaChat) => void }) {
  const { t } = useTranslation();
  const when = useWhen();
  const desk = useDesk();
  const screen = useScreen();
  const { run } = useAction();
  const [tab, setTabState] = useState<ChatTab>(view.tab);
  const [query, setQueryState] = useState(view.query);
  // «Только гараж» (v0.81): on by default; the garage's chats are its people's, those given a status, its groups.
  const [garageOnly, setGarageOnlyState] = useState(view.garageOnly);
  const setTab = (v: ChatTab) => setTabState((view.tab = v));
  const setQuery = (v: string) => setQueryState((view.query = v));
  const setGarageOnly = (v: boolean) => setGarageOnlyState((view.garageOnly = v));
  const roles = useScreenLiveQuery(loadChatRoles, []) ?? NO_ROLES;
  // Who the chats are and what their requests came to — studied by services/chatStudy.ts as the app runs (v0.91).
  const makes = useScreenLiveQuery(loadChatMakes, []);
  const study = useSyncExternalStore(onStudyProgress, studyProgress);
  const rows = useMemo(() => filterChats(s.chats, { tab, query, people, roles, garageOnly }), [s.chats, tab, query, people, roles, garageOnly]);
  // A search with «Только гараж» on: how many more the whole list has (one tap shows them).
  const elsewhere = useMemo(
    () => (garageOnly && query.trim() ? filterChats(s.chats, { tab, query, people, roles, garageOnly: false }).length - rows.length : 0),
    [garageOnly, query, s.chats, tab, people, roles, rows.length],
  );
  const counts = useMemo(() => tabCounts(s.chats, people, roles, garageOnly), [s.chats, people, roles, garageOnly]);
  const { limit, more } = useMoreRows(rows.length, `${tab}|${query}|${garageOnly}`, undefined, view.shown);
  view.shown = Math.min(limit, rows.length);
  // A phone (v0.84): the list on the screen's plain colour, as WhatsApp's (no group card, no glow).
  useLayoutEffect(() => {
    const el = desk ? null : screen?.scroller.current?.closest<HTMLElement>('.screen');
    if (!el) return undefined;
    el.setAttribute('data-wa-list', '');
    return () => el.removeAttribute('data-wa-list');
  }, [desk, screen]);
  // Back where it was: the list's own scroll (a phone) — kept as it scrolls, put back when the list is drawn again.
  const restored = useRef(false);
  useLayoutEffect(() => {
    const el = desk ? null : screen?.scroller.current;
    if (!el || restored.current || !rows.length) return;
    restored.current = true;
    if (view.scroll > 0) el.scrollTop = view.scroll;
  }, [desk, screen, rows.length]);
  useEffect(() => {
    const el = desk ? null : screen?.scroller.current;
    if (!el) return undefined;
    const on = () => {
      if (screen?.front()) view.scroll = el.scrollTop;
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, [desk, screen]);
  // «Выбрать» (v0.81): several picked, one status to all of them.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [tagging, setTagging] = useState(false);
  const [making, setMaking] = useState(false);
  const pickedChats = useMemo(() => s.chats.filter((c) => picked.has(c.id)), [s.chats, picked]);
  const endPick = () => {
    setPicking(false);
    setPicked(new Set());
  };
  const tap = useCallback(
    (c: WaChat) => {
      if (!picking) return onOpen(c);
      haptic('selection');
      setPicked((p) => {
        const n = new Set(p);
        if (n.has(c.id)) n.delete(c.id);
        else n.add(c.id);
        return n;
      });
    },
    [picking, onOpen],
  );
  const tag = (to: WaTag | null) =>
    void run(async () => {
      const n = picked.size;
      await tagChats([...picked], to);
      haptic('success');
      setTagging(false);
      endPick();
      notifications.show({ color: 'green', message: to ? t('wa.tags.updated', { count: n }) : t('wa.tags.cleared', { n }) });
    });
  // A supplier's makes (its card's first, else what its chat taught) — the same array while they say the same, so a row
  // (memo) is not drawn again each time a chat is studied.
  const kept = useRef(new Map<string, { key: string; makes: KnownMake[] }>());
  const rowMakes = (c: WaChat): KnownMake[] | undefined => {
    if (c.group || !makes) return undefined;
    const role = chatRole(c, people, roles);
    if (role !== 'supplier' && role !== 'service') return undefined;
    const now = makes.byPhone.get(c.phone) ?? makes.byChat.get(c.id);
    if (!now) return undefined;
    const key = now.map((m) => `${m.make}:${m.by}`).join('|');
    const was = kept.current.get(c.id);
    if (was?.key === key) return was.makes;
    kept.current.set(c.id, { key, makes: now });
    return now;
  };
  const failed = !!s.chatsFailed && !s.chatsLoading;
  const head = (
    <>
      {/* «Выбрать» on the left (while picking: «Выбрано N» and «Отмена»), «Только гараж» on the right. */}
      <div className="wa-list-tools" data-picking={picking || undefined}>
        {picking ? (
          <>
            <span className="wa-picked-n" data-wa-picked-n>
              {t('wa.pickedN', { n: picked.size })}
            </span>
            <Button variant="subtle" size="compact-md" onClick={endPick} data-wa-pick>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="subtle" size="compact-md" leftSection={<IconListCheck size={18} />} onClick={() => setPicking(true)} data-wa-pick>
              {t('wa.tags.pick')}
            </Button>
            <Switch
              label={t('wa.garageOnly')}
              labelPosition="left"
              checked={garageOnly}
              onChange={(e) => {
                haptic('selection');
                setGarageOnly(e.currentTarget.checked);
              }}
              data-wa-garage-only
            />
          </>
        )}
      </div>
      <SearchField value={query} onChange={setQuery} placeholder={t('wa.search')} />
      {/* The AI going through the chats (v0.91): how far — once at the start, then a chat at a time, unseen. */}
      {study.running && study.total > 0 && (
        <div className="wa-study" role="status" data-wa-study>
          <AiMark size={14} />
          <span>{t('wa.study.going', { done: study.done, total: study.total })}</span>
        </div>
      )}
      <div className="wa-filters" role="tablist" data-own-swipe>
        {CHAT_TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className="wa-filter tap"
            data-on={tab === k || undefined}
            onClick={() => {
              haptic('selection');
              setTab(k);
            }}
            data-wa-tab={k}
          >
            {t(`wa.tab.${k}`)}
            {k !== 'all' && counts[k] > 0 && <span className="wa-filter-n">{counts[k]}</span>}
          </button>
        ))}
      </div>
    </>
  );
  return (
    <>
      {/* A PC (v0.87): the search and the chips stay over the chats as they scroll (the phone's own list as it was). */}
      {desk ? <div className="wa-list-head">{head}</div> : head}
      {failed && s.chats.length > 0 && (
        <div className="wa-list-note" role="status" data-wa-list-note>
          <IconCloudOff size={16} stroke={2} aria-hidden />
          <span>{s.chatsAt || s.chatsKept ? t('wa.staleAt', { time: dubaiTime(new Date(s.chatsAt || s.chatsKept!).toISOString()) }) : t('wa.loadFailed')}</span>
          <Button variant="subtle" size="compact-sm" onClick={() => void loadChats(true)}>
            {t('wa.gate.retry')}
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        s.chatsLoading && !s.chatsAt ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        ) : failed && !s.chats.length ? (
          <EmptyState
            icon={IconCloudOff}
            title={t('wa.loadFailed')}
            action={
              <Button variant="light" onClick={() => void loadChats(true)} data-wa-reload>
                {t('wa.gate.retry')}
              </Button>
            }
          />
        ) : query ? (
          <EmptyState
            icon={IconSearch}
            title={t('wa.noFound')}
            action={
              <Group gap="xs" justify="center">
                {elsewhere > 0 && (
                  <Button variant="light" onClick={() => setGarageOnly(false)} data-wa-search-all>
                    {t('wa.searchAll', { n: elsewhere })}
                  </Button>
                )}
                <Button variant="subtle" onClick={() => setQuery('')} data-wa-clear>
                  {t('wa.clearSearch')}
                </Button>
              </Group>
            }
          />
        ) : garageOnly && tab === 'all' && s.chats.length > 0 ? (
          <EmptyState
            icon={IconBriefcase}
            title={t('wa.noGarage')}
            action={
              <Button variant="light" onClick={() => setGarageOnly(false)} data-wa-show-all>
                {t('wa.showAll')}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={IconBrandWhatsapp} title={t(tab === 'all' ? 'wa.empty' : 'wa.emptyTab')} />
        )
      ) : (
        <>
          <List className="wa-chats">
            {rows.slice(0, limit).map((c) => (
              <ChatRow
                key={c.id}
                c={c}
                who={whoOf(c, people)}
                role={chatRole(c, people, roles)}
                byAi={!!aiRoleOf(c, people, roles)}
                makes={rowMakes(c)}
                when={when(c.t)}
                active={!picking && c.id === active}
                onOpen={tap}
                picking={picking}
                picked={picked.has(c.id)}
              />
            ))}
            {more()}
          </List>
          {elsewhere > 0 && (
            <Button variant="subtle" fullWidth mt="xs" onClick={() => setGarageOnly(false)} data-wa-search-all>
              {t('wa.searchAll', { n: elsewhere })}
            </Button>
          )}
        </>
      )}
      {picking && (
        <StickyBar>
          <Group gap={8} wrap="nowrap" grow>
            <Button disabled={!picked.size} leftSection={<IconTag size={18} />} onClick={() => setTagging(true)} data-wa-tag-picked>
              {t('wa.tags.short')}
            </Button>
            {/* v0.91: makes to all of them («поставщики Тойота — марку Тойота»). */}
            <Button variant="light" disabled={!pickedChats.some((c) => !c.group)} leftSection={<IconCar size={18} />} onClick={() => setMaking(true)} data-wa-make-picked>
              {t('wa.makes.assign')}
            </Button>
          </Group>
        </StickyBar>
      )}
      <LazySheet opened={tagging}>{(o) => <TagSheet opened={o} onClose={() => setTagging(false)} n={picked.size} onTag={tag} />}</LazySheet>
      <LazySheet opened={making}>
        {(o) => (
          <MakeSheet
            opened={o}
            chats={pickedChats}
            onClose={() => setMaking(false)}
            onDone={() => {
              setMaking(false);
              endPick();
            }}
          />
        )}
      </LazySheet>
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
        {!c.group && <ChatKnowBlock id={c.id} phone={c.phone} />}
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
      <ActionIcon variant="default" size={40} radius="xl" aria-label={t('wa.setup')} data-route={'/whatsapp/setup'} onClick={() => navigate('/whatsapp/setup')} data-wa-setup-btn>
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
  // (The same function whichever chat is open — v0.89: the list's rows are not drawn again on every other chat.)
  // React Router's navigate is a new function at every address, so it is read from a ref too.
  const inChat = useRef(!!chatId);
  inChat.current = !!chatId;
  const go = useRef(navigate);
  go.current = navigate;
  const openChat = useCallback((c: Pick<WaChat, 'id'>) => go.current(chatPath(c.id), { replace: desk && inChat.current }), [desk]);
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

  // The chats kept on this device (v0.88) while the server is asked: shown at once, not a spinner.
  const kept = !s.status && !s.old && !s.away && waCan() && s.chats.length > 0;
  const gate = ready || kept ? null : <WaGate s={s} />;
  // Under the chat's name: whose it is in the garage and the number (a group — «Группа»).
  const headLine = face ? (face.c.group ? t('wa.groupLine') : [face.who ? t(`wa.who.${face.who.kind}`) : '', face.c.phone ? formatPhone(`+${face.c.phone}`) : ''].filter(Boolean).join(' · ')) : '';
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
          // Narrow (an iPad upright, v0.84): the list or the chat, one at a time — «‹» in the chat's head back to the list.
          <div className="wa-desk" data-open={chatId ? true : undefined}>
            <div className="wa-desk-list">
              <ChatList s={s} people={people} active={chatId} onOpen={openChat} />
            </div>
            <div className="wa-desk-chat">
              {face && chatId ? (
                <>
                  <div className="wa-chat-head">
                    <button type="button" className="wa-icon-btn wa-desk-back tap" aria-label={t('common.back')} data-route={'/whatsapp'} onClick={() => navigate('/whatsapp')} data-wa-desk-back>
                      <IconChevronLeft size={24} stroke={2} />
                    </button>
                    {/* Whose it is — in the line under the name, as on the phone (v0.87: not said twice). */}
                    <ChatHead id={chatId} name={face.title} group={face.c.group} line={headLine} onOpen={() => setInfo(true)} size={40} />
                  </div>
                  <ChatThread key={chatId} chatId={chatId} title={face.title} group={face.c.group} people={people} desk quick={quick} who={face.who} phone={face.c.phone} />
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
        {/* WhatsApp's bar (v0.84): «‹», the picture, the name and whose it is — a tap, the chat's card; the call at the end. */}
        <PageHeader
          title={face.title}
          inline
          lead={<ChatHead id={chatId} name={face.title} group={face.c.group} line={headLine} onOpen={() => setInfo(true)} />}
          back="/whatsapp"
          right={
            face.c.phone ? (
              <ActionIcon variant="default" size={40} radius="xl" aria-label={t('wa.call')} component="a" href={`tel:+${face.c.phone}`} data-wa-call>
                <IconPhone size={21} stroke={1.9} />
              </ActionIcon>
            ) : undefined
          }
        />
        {gate ?? (
          <div className="notes-page">
            <ChatThread key={chatId} chatId={chatId} title={face.title} group={face.c.group} people={people} desk={false} quick={quick} who={face.who} phone={face.c.phone} />
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
