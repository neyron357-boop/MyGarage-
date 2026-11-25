import { Kbd, MantineProvider, Popover, UnstyledButton } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { useHotkeys } from '@mantine/hooks';
import { notifications, Notifications } from '@mantine/notifications';
import {
  IconArrowRight,
  IconBell,
  IconBrandWhatsapp,
  IconCash,
  IconChartBar,
  IconExternalLink,
  IconInfoCircle,
  IconLayoutColumns,
  IconLayoutKanban,
  IconNotes,
  IconPackage,
  IconPalette,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTruck,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ContextType } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { HashRouter, Link, MemoryRouter, Route, Routes, UNSAFE_LocationContext, UNSAFE_RouteContext, useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom';
import { ClaimPage } from './features/claims/ClaimPage';
import { setRouteOpener } from './ui/openRoute';
import { BoardPage } from './features/board/BoardPage';
import { CustomerPage } from './features/customers/CustomerPage';
import { CustomersPage } from './features/customers/CustomersPage';
import { VehiclePage } from './features/customers/VehiclePage';
import { MoneyPage } from './features/money/MoneyPage';
import { DebtPaymentsPage } from './features/money/DebtPayments';
import { CustomerMonthsPage } from './features/money/CustomerMonths';
import { JobPage } from './features/job/JobPage';
import { MorePage } from './features/more/MorePage';
import { GarageNotesPage } from './features/more/GarageNotes';
import { NotifyPage } from './features/notify/NotifyPage';
import { NewOrderPage } from './features/orders/NewOrderPage';
import { PartsPage } from './features/parts/PartsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { SearchPage } from './features/search/SearchPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { WaAutoPage } from './features/whatsapp/WaAutoPage';
import { WaSetupPage } from './features/whatsapp/WaSetupPage';
import { WhatsAppPage } from './features/whatsapp/WhatsAppPage';
import { refreshWa } from './services/whatsapp';
import { WaCount } from './ui/WaCount';
import { cashState } from './services/money';
import { AppearanceControls, useStatusBarColor } from './ui/Appearance';
import { useResolvedScheme } from './ui/scheme';
import { Celebration, Logo, Money, Tip } from './ui/components';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { useLang, usePhone, useSettings } from './ui/hooks';
import { PwaUpdater } from './ui/pwa';
import { useBackClosesSheets } from './ui/backCloses';
import { useEscapeClosesTopSheet } from './ui/escapeTop';
import { useSheetSwipe } from './ui/sheetSwipe';
import { PhoneStack, useScreenTitle, useViewportSync } from './ui/stack';
import { DeskContext, DeskKeys, DeskMenu, DeskPaneContext, MOD_KEY, deskPage, deskScreenKey, setActivePane, sheetOpen, useDeskShell, useDeskWheel, type DeskPaneInfo } from './ui/desk';
import { DeskTips } from './ui/deskTips';
import { closeTab, DeskTabContext, focusTab, MAIN_TAB, noteTab, openTab, scrollOfTab, useDeskTab, useDeskTabs, type DeskTab } from './ui/deskTabs';
import { useWaSideHidden } from './ui/deskSide';
import { closeTwin, keepTwinPath, openTwin, useTwin } from './ui/deskTwin';
import { DeskPalette } from './features/search/DeskPalette';
import { TabBar } from './ui/tabBar';
import { UnsavedGuard } from './ui/unsaved';
import { cssResolver, deskTheme, phoneTheme } from './ui/theme';
import { useRestoreReport } from './features/settings/RestoreModal';
import { QuickNewButton, QuickPlus } from './features/quick/QuickActions';
// The developer's feedback tool (temporary): removed with src/devtools/feedback and this line and the one below.
import { FeedbackTool } from './devtools/feedback';
import { AiNotices } from './features/ai/AiNotices';
import { WaNotices } from './features/whatsapp/WaNotices';
import { WaConfirm } from './features/whatsapp/WaConfirm';
import { useClientLockGuard } from './ui/clientLock';

/** Every screen of the app, for a given location (the phone renders two at once while you go back). */
function AppRoutes({ location }: { location: Location }) {
  return (
    <Routes location={location}>
      <Route path="/" element={<BoardPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/orders/new" element={<NewOrderPage />} />
      <Route path="/orders/:id" element={<JobPage />} />
      {/* The check-in act's photo screen is gone (v0.21: the job card is the inspection): its address — a history
          entry, a page left open before the update — shows its job, as the invoice's does (no redirect: Back stays a
          plain step back). */}
      <Route path="/orders/:id/intake" element={<JobPage />} />
      <Route path="/orders/:id/invoice" element={<JobPage />} />
      <Route path="/orders/:id/claim" element={<ClaimPage />} />
      {/* v0.38–v0.81: the job's suppliers' screen; v0.82 (#21) — gone, its sheet is «Поставщики» under the lines: an old
          address shows the job. */}
      <Route path="/orders/:id/suppliers" element={<JobPage />} />
      <Route path="/customers" element={<CustomersPage />} />
      <Route path="/customers/:id" element={<CustomerPage />} />
      <Route path="/vehicles/:id" element={<VehiclePage />} />
      <Route path="/parts" element={<PartsPage />} />
      <Route path="/money" element={<MoneyPage />} />
      <Route path="/money/payments" element={<DebtPaymentsPage />} />
      <Route path="/money/months" element={<CustomerMonthsPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/more" element={<MorePage />} />
      <Route path="/notes" element={<GarageNotesPage />} />
      <Route path="/notify" element={<NotifyPage />} />
      {/* v0.78: the garage's WhatsApp — its chats, a chat, its setup (the server is a linked device of the account). */}
      <Route path="/whatsapp" element={<WhatsAppPage />} />
      <Route path="/whatsapp/chat/:id" element={<WhatsAppPage />} />
      <Route path="/whatsapp/setup" element={<WaSetupPage />} />
      <Route path="/whatsapp/auto" element={<WaAutoPage />} />
      <Route path="*" element={<BoardPage />} />
    </Routes>
  );
}

/* ---------------- PC ---------------- */

/**
 * The sidebar's search (v0.42): it looks like a field, a click — or Ctrl+K, or «/» from anywhere (by the keys' places, so
 * the Russian layout works too) — opens the search over the window (DeskPalette): a plate, a name, a phone, a VIN.
 */
function SideSearch() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useHotkeys([
    ['/', () => !sheetOpen() && setOpen(true), { preventDefault: true, usePhysicalKeys: true }],
    ['mod+K', () => setOpen((o) => !o), { preventDefault: true, usePhysicalKeys: true }],
  ]);
  return (
    <>
      <UnstyledButton className="desk-search-btn" aria-label={t('search.placeholder')} onClick={() => setOpen(true)}>
        <IconSearch size={16} stroke={2} aria-hidden />
        <span>{t('nav.search')}</span>
        <Kbd size="xs">{MOD_KEY} K</Kbd>
      </UnstyledButton>
      <DeskPalette opened={open} onClose={() => setOpen(false)} />
    </>
  );
}

const NAV_GROUPS = [
  {
    key: 'nav.groupWork',
    items: [
      { to: '/', icon: IconLayoutKanban, key: 'nav.board', end: true },
      { to: '/customers', icon: IconUsers, key: 'nav.customers' },
      { to: '/parts', icon: IconPackage, key: 'nav.parts' },
      { to: '/parts?tab=suppliers', icon: IconTruck, key: 'nav.suppliers' },
      { to: '/notes', icon: IconNotes, key: 'notes.title' },
      // The garage's WhatsApp (v0.78): its chats beside the work.
      { to: '/whatsapp', icon: IconBrandWhatsapp, key: 'nav.whatsapp' },
    ],
  },
  {
    key: 'nav.groupMoney',
    items: [
      { to: '/money', icon: IconCash, key: 'nav.money' },
      { to: '/reports', icon: IconChartBar, key: 'nav.reports' },
    ],
  },
  {
    key: 'nav.groupSystem',
    items: [
      // What the phone is notified of, and the reminders (v0.74).
      { to: '/notify', icon: IconBell, key: 'notify.title' },
      { to: '/settings', icon: IconSettings, key: 'nav.settings' },
    ],
  },
];

/** The language, the theme, the accent: once set, rarely touched — behind one button at the sidebar's foot (v0.42). */
function AppearanceButton() {
  const { t } = useTranslation();
  return (
    <Popover position="right-end" offset={14} width={260} shadow="lg" radius="lg" withinPortal trapFocus returnFocus>
      <Popover.Target>
        <UnstyledButton className="desk-side-btn" aria-label={t('app.appearance')}>
          <IconPalette size={18} stroke={1.9} aria-hidden />
          <span>{t('app.appearance')}</span>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown className="desk-appearance">
        <div className="desk-pop-title">{t('app.appearance')}</div>
        <AppearanceControls />
      </Popover.Dropdown>
    </Popover>
  );
}

/**
 * PC sidebar (v0.42): a panel floating at the window's left edge, as on a Mac — the garage (its logo and name),
 * search, «Новый заказ», the sections, and at the foot the cash and the appearance.
 */
function SideNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const cash = useLiveQuery(cashState, []);
  const twinOpen = !!useTwin();
  // The panes side by side live in the window's own tab (v0.89): from another tab the button is not offered.
  const inMain = useDeskTab() === MAIN_TAB;
  const settings = useSettings();
  // WhatsApp messages waiting to be read (v0.78): a number beside its item — its own component (v0.80.2): the menu does not
  // draw again at each message.
  // "Parts" and "Suppliers" share a route: highlight by the tab, not just the path.
  const isActive = (to: string, end?: boolean) => {
    const [path, query] = to.split('?');
    if (end ? location.pathname !== path : !location.pathname.startsWith(path)) return false;
    if (path === '/parts') return (query ?? '') === (location.search.includes('tab=suppliers') ? 'tab=suppliers' : '');
    return true;
  };
  return (
    <>
      <Link to="/" className="desk-brand" aria-label={t('nav.board')} data-route="/">
        {settings?.logoDataUrl ? (
          <>
            <span className="desk-brand-logo">
              <img src={settings.logoDataUrl} alt="" />
            </span>
            <span className="desk-brand-name">{settings.name || 'MyGarage'}</span>
          </>
        ) : (
          <Logo size={30} />
        )}
      </Link>
      <SideSearch />
      <QuickNewButton />
      <div className="desk-nav">
        {NAV_GROUPS.map((g) => (
          <div key={g.key} className="desk-nav-group">
            <div className="nav-group">{t(g.key)}</div>
            {g.items.map((s) => {
              const on = isActive(s.to, s.end);
              return (
                <Link key={s.to} to={s.to} className="desk-nav-item" data-active={on || undefined} aria-current={on ? 'page' : undefined} data-route={s.to}>
                  <s.icon size={18} stroke={1.9} aria-hidden />
                  <span>{t(s.key)}</span>
                  {s.to === '/whatsapp' && <WaCount className="desk-nav-count tnum" />}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="desk-side-foot">
        {cash && (
          <UnstyledButton className="desk-side-btn desk-side-cash" data-route={'/money?tab=cash'} onClick={() => navigate('/money?tab=cash')}>
            <IconCash size={18} stroke={1.9} aria-hidden />
            <span>{t('board.cash')}</span>
            <Money fils={cash.expected} fw={600} />
          </UnstyledButton>
        )}
        {/* A second tab beside the screen (v0.80.3): opened from anywhere, closed by its own «×». */}
        {inMain && (
          <UnstyledButton className="desk-side-btn" onClick={() => (twinOpen ? closeTwin() : openTwin('/'))} aria-pressed={twinOpen} data-twin-side>
            <IconLayoutColumns size={18} stroke={1.9} aria-hidden />
            <span>{t(twinOpen ? 'desk.twinClose' : 'desk.twin')}</span>
          </UnstyledButton>
        )}
        <AppearanceButton />
      </div>
    </>
  );
}

/** Shown only in the single-file preview build, which runs inside a sandboxed frame. */
function PreviewNotice() {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('mygarage.previewNoticeHidden') === '1';
    } catch {
      return false;
    }
  });
  if (import.meta.env.MODE !== 'single' || hidden) return null;
  return (
    <Tip
      icon={IconInfoCircle}
      color="yellow"
      title={t('preview.title')}
      onClose={() => {
        setHidden(true);
        try {
          localStorage.setItem('mygarage.previewNoticeHidden', '1');
        } catch {
          // ignore
        }
      }}
    >
      {t('preview.text')}
    </Tip>
  );
}

/**
 * PC: new screens open at the top; "Back" returns to where the list was scrolled.
 * Also drops stale toasts queued on the previous screen.
 */
function ScrollManager({ active = true }: { /** The tab is in front (v0.89): a tab behind neither notes nor moves the window's scroll. */ active?: boolean }) {
  const location = useLocation();
  const type = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const current = useRef(location.key);
  const front = useRef(active);
  front.current = active;
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => front.current && positions.current.set(current.current, window.scrollY));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  useEffect(() => {
    current.current = location.key;
    if (!front.current) return undefined;
    notifications.cleanQueue();
    const saved = positions.current.get(location.key);
    if (type === 'POP' && saved !== undefined) {
      window.scrollTo(0, saved);
      const timers = [60, 220].map((ms) => window.setTimeout(() => window.scrollY !== saved && window.scrollTo(0, saved), ms));
      return () => timers.forEach(clearTimeout);
    }
    window.scrollTo(0, 0);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
  return null;
}

/* ---------------- PC: a second tab beside the screen (v0.80, v0.80.3) ---------------- */

const MAIN_PANE: DeskPaneInfo = { id: 'main' };

/** The second tab's places, one click each (v0.80.3: «новая вкладка всего приложения… всё, что захочу»). */
const TWIN_PLACES = [
  { to: '/', icon: IconLayoutKanban, key: 'nav.board', end: true },
  { to: '/search', icon: IconSearch, key: 'nav.search' },
  { to: '/orders/new', icon: IconPlus, key: 'nav.newOrder' },
  { to: '/customers', icon: IconUsers, key: 'nav.customers' },
  { to: '/parts', icon: IconPackage, key: 'nav.parts' },
  { to: '/money', icon: IconCash, key: 'nav.money' },
  { to: '/whatsapp', icon: IconBrandWhatsapp, key: 'nav.whatsapp' },
];

/** The second tab's own bar: its places and «×» (it is closed only so — the board, Back, the left screen leave it be). */
function TwinBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div className="desk-twin-bar" role="toolbar" aria-label={t('desk.twin')}>
      {TWIN_PLACES.map((pl) => {
        const on = pl.end ? pathname === pl.to : pathname.startsWith(pl.to);
        return (
          // A symbol each (its name under the mouse — ui/deskTips.tsx): all of them and «×» fit half a window.
          <UnstyledButton key={pl.to} className="desk-twin-place" aria-label={t(pl.key)} data-active={on || undefined} aria-current={on ? 'page' : undefined} data-route={pl.to} onClick={() => navigate(pl.to)} data-twin-place={pl.to}>
            <pl.icon size={18} stroke={1.9} aria-hidden />
          </UnstyledButton>
        );
      })}
      <UnstyledButton className="desk-twin-close" aria-label={t('common.close')} onClick={closeTwin} data-twin-close>
        <IconX size={18} stroke={2} aria-hidden />
      </UnstyledButton>
    </div>
  );
}

/** The screens of the second tab, on its own address (kept for the next time it is opened). */
function SidePaneRoutes() {
  const location = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  // How deep in its own history (where its «Назад» leads): at the first screen «Назад» closes the tab.
  const [depth, setDepth] = useState(0);
  const last = useRef(location.key);
  useEffect(() => {
    if (last.current === location.key) return;
    last.current = location.key;
    setDepth((d) => (type === 'PUSH' ? d + 1 : type === 'POP' ? Math.max(0, d - 1) : d));
  }, [location.key, type]);
  useEffect(() => keepTwinPath(location.pathname + location.search), [location.pathname, location.search]);
  const pane = useMemo<DeskPaneInfo>(() => ({ id: 'side', closes: depth === 0, back: () => (depth > 0 ? navigate(-1) : closeTwin()) }), [depth, navigate]);
  return (
    <DeskPaneContext.Provider value={pane}>
      <TwinBar />
      <ErrorBoundary resetKey={deskScreenKey(location.pathname)}>
        <div key={deskScreenKey(location.pathname)} className="page-enter" data-pane-page={deskPage(location.pathname)}>
          <AppRoutes location={location} />
        </div>
      </ErrorBoundary>
    </DeskPaneContext.Provider>
  );
}

/**
 * The second tab: a router of its own (its screens open and go back there, the window's screen stays). React Router
 * keeps one router to a page — the window's is left out of this one (its contexts cleared for it).
 */
function SidePane({ start }: { start: string }) {
  const [first] = useState(start);
  return (
    <UNSAFE_LocationContext.Provider value={null as unknown as ContextType<typeof UNSAFE_LocationContext>}>
      <UNSAFE_RouteContext.Provider value={{ outlet: null, matches: [], isDataRoute: false }}>
        <MemoryRouter initialEntries={[first]}>
          <SidePaneRoutes />
        </MemoryRouter>
      </UNSAFE_RouteContext.Provider>
    </UNSAFE_LocationContext.Provider>
  );
}

/**
 * The side menu and the window's keys belong to the tab in front (v0.89): drawn from inside its router into the menu's
 * place — a section clicked, «Новый заказ», the search, N — open in that tab, as a browser's address bar does.
 */
function FrontTabParts({ slot }: { slot: HTMLElement | null }) {
  if (!slot) return null;
  return createPortal(
    <>
      <SideNav />
      <DeskKeys />
    </>,
    slot,
  );
}

/** Another tab (v0.89): a router of its own in memory, its screens, its «Назад»; it stays as it was while behind. */
function TabPane({ tab, front, slot }: { tab: DeskTab; front: boolean; slot: HTMLElement | null }) {
  const [first] = useState(tab.path);
  return (
    <UNSAFE_LocationContext.Provider value={null as unknown as ContextType<typeof UNSAFE_LocationContext>}>
      <UNSAFE_RouteContext.Provider value={{ outlet: null, matches: [], isDataRoute: false }}>
        <MemoryRouter initialEntries={[first]}>
          <TabRoutes id={tab.id} front={front} slot={slot} />
        </MemoryRouter>
      </UNSAFE_RouteContext.Provider>
    </UNSAFE_LocationContext.Provider>
  );
}

function TabRoutes({ id, front, slot }: { id: string; front: boolean; slot: HTMLElement | null }) {
  const location = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  // How deep in its own history: at its first screen «Назад» closes the tab (×).
  const [depth, setDepth] = useState(0);
  const last = useRef(location.key);
  useEffect(() => {
    if (last.current === location.key) return;
    last.current = location.key;
    setDepth((d) => (type === 'PUSH' ? d + 1 : type === 'POP' ? Math.max(0, d - 1) : d));
  }, [location.key, type]);
  useEffect(() => noteTab(id, { path: location.pathname + location.search }), [id, location.pathname, location.search]);
  const pane = useMemo<DeskPaneInfo>(() => ({ id, closes: depth === 0, back: () => (depth > 0 ? navigate(-1) : void closeTab(id)) }), [id, depth, navigate]);
  return (
    <DeskTabContext.Provider value={id}>
      <DeskPaneContext.Provider value={pane}>
        <ScrollManager active={front} />
        {front && <FrontTabParts slot={slot} />}
        <div className="page-shell" data-page={deskPage(location.pathname)}>
          <div className="desk-page">
            <ErrorBoundary resetKey={deskScreenKey(location.pathname)}>
              <div key={deskScreenKey(location.pathname)} className="page-enter">
                <AppRoutes location={location} />
              </div>
            </ErrorBoundary>
          </div>
        </div>
      </DeskPaneContext.Provider>
    </DeskTabContext.Provider>
  );
}

/** The tabs over the screens (v0.89), when there are two or more: a click — that tab; × or the wheel — closed; ＋ — a new one. */
function DeskTabStrip({ onMainTo }: { onMainTo: (path: string) => void }) {
  const { t } = useTranslation();
  const tabs = useDeskTabs();
  const titleOf = useScreenTitle();
  const close = (id: string) => {
    const { mainTo } = closeTab(id);
    if (mainTo) onMainTo(mainTo);
  };
  return (
    <div className="desk-tabs" role="tablist" aria-label={t('desk.tabs')}>
      {tabs.tabs.map((tab) => {
        const on = tab.id === tabs.active;
        const name = tab.title || String(titleOf(tab.path.split('?')[0]) || 'MyGarage');
        return (
          <div
            key={tab.id}
            className="desk-tab-chip"
            role="tab"
            tabIndex={0}
            aria-selected={on}
            data-active={on || undefined}
            data-tab-chip={tab.id}
            onClick={() => focusTab(tab.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), focusTab(tab.id))}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => e.button === 1 && (e.preventDefault(), close(tab.id))}
          >
            <span className="desk-tab-name dt-clip">{name}</span>
            <button
              type="button"
              className="desk-tab-x"
              aria-label={t('common.close')}
              onClick={(e) => {
                e.stopPropagation();
                close(tab.id);
              }}
            >
              <IconX size={14} stroke={2.2} aria-hidden />
            </button>
          </div>
        );
      })}
      <button type="button" className="desk-tab-new" aria-label={t('desk.newTab')} onClick={() => openTab('/')} data-tab-new>
        <IconPlus size={16} stroke={2.2} aria-hidden />
      </button>
    </div>
  );
}

/**
 * A control that opens a screen (v0.89, the owner: «правая кнопка мыши по любой кнопке, которая ведёт в другой экран, —
 * открыть в новой вкладке, как в браузере»): its address is on it (`data-route`, or a link's own). A right click — «Открыть
 * в новой вкладке» and «Открыть»; the wheel or Ctrl+click — a new tab behind, as a browser does. A control with a menu
 * of its own (a job's card, a table's row) says it in that menu.
 */
function DeskRouteMenu() {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; to: string; el: HTMLElement } | null>(null);
  useEffect(() => {
    const routeOf = (target: EventTarget | null) => {
      const el = (target as Element | null)?.closest?.('[data-route], a[href^="#/"]') as HTMLElement | null;
      if (!el || el.closest('[data-no-tab]')) return null;
      const to = el.dataset.route ?? el.getAttribute('href')?.slice(1) ?? '';
      return to.startsWith('/') ? { el, to } : null;
    };
    const onMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const r = routeOf(e.target);
      if (!r) return;
      e.preventDefault();
      setMenu({ at: { x: e.clientX, y: e.clientY }, ...r });
    };
    // (The wheel pressed on it: no scrolling cross.)
    const onDown = (e: MouseEvent) => e.button === 1 && routeOf(e.target) && e.preventDefault();
    const onAux = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const r = routeOf(e.target);
      if (!r) return;
      e.preventDefault();
      openTab(r.to, { front: false });
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
      const r = routeOf(e.target);
      if (!r) return;
      e.preventDefault();
      e.stopPropagation();
      openTab(r.to, { front: false });
    };
    document.addEventListener('contextmenu', onMenu);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('auxclick', onAux, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('contextmenu', onMenu);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('auxclick', onAux, true);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  return (
    <DeskMenu
      at={menu?.at ?? null}
      onClose={() => setMenu(null)}
      items={[
        { key: 'tab', label: t('desk.openInTab'), icon: IconExternalLink, onClick: () => menu && openTab(menu.to) },
        { key: 'open', label: t('common.open'), icon: IconArrowRight, onClick: () => menu?.el.click() },
      ]}
    />
  );
}

/** The window's own tab: its address is the window's; the second tab beside it (v0.80.3) lives here. */
function MainTab({ front, slot }: { front: boolean; slot: HTMLElement | null }) {
  const { t } = useTranslation();
  const location = useLocation();
  // The second tab (v0.80.3): open beside whatever screen the window shows; closed only by its own «×».
  const side = useTwin();
  const twin = !!side;
  useEffect(() => {
    if (!twin && front) setActivePane('main');
  }, [twin, front]);
  useEffect(() => noteTab(MAIN_TAB, { path: location.pathname + location.search }), [location.pathname, location.search]);
  return (
    <>
      <ScrollManager active={front} />
      {front && <FrontTabParts slot={slot} />}
          {/* The screen decides its width (desk.css): the board the whole window, a job two columns, a form one. */}
          <div className="page-shell" data-page={twin ? 'twin' : deskPage(location.pathname)}>
            <div className="desk-page">
              <PreviewNotice />
              {twin ? (
                // Two jobs in one window: each pane scrolls by itself; the keys act in the one last clicked.
                <div className="desk-twin">
                  <section className="desk-twin-pane" data-pane="main" onPointerDownCapture={() => setActivePane('main')} onFocusCapture={() => setActivePane('main')}>
                    <DeskPaneContext.Provider value={MAIN_PANE}>
                      <ErrorBoundary resetKey={deskScreenKey(location.pathname)}>
                        <div key={deskScreenKey(location.pathname)} className="page-enter">
                          <AppRoutes location={location} />
                        </div>
                      </ErrorBoundary>
                    </DeskPaneContext.Provider>
                  </section>
                  <section className="desk-twin-pane" data-pane="side" aria-label={t('desk.twin')} onPointerDownCapture={() => setActivePane('side')} onFocusCapture={() => setActivePane('side')}>
                    <SidePane start={side} />
                  </section>
                </div>
              ) : (
                <ErrorBoundary resetKey={deskScreenKey(location.pathname)}>
                  <div key={deskScreenKey(location.pathname)} className="page-enter">
                    <AppRoutes location={location} />
                  </div>
                </ErrorBoundary>
              )}
            </div>
          </div>
    </>
  );
}

function DesktopShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tabs = useDeskTabs();
  // The side menu's place: the tab in front draws its menu there (v0.89).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // The computer's own layout (v0.41): every rule of it is under html.desk, which the phone never has.
  useDeskShell();
  useDeskWheel();
  const front = tabs.tabs.find((tab) => tab.id === tabs.active) ?? tabs.tabs[0];
  // The tab in front: its keys act, its scroll comes back, the window says its title.
  useLayoutEffect(() => {
    if (tabs.active !== MAIN_TAB) setActivePane(tabs.active);
    window.scrollTo(0, scrollOfTab(tabs.active));
  }, [tabs.active]);
  useEffect(() => {
    if (front?.title) document.title = window.matchMedia('(display-mode: standalone)').matches ? front.title : `${front.title} — MyGarage`;
  }, [front?.title, tabs.active]);
  const many = tabs.tabs.length > 1;
  useEffect(() => {
    document.documentElement.toggleAttribute('data-tabs', many);
    return () => document.documentElement.removeAttribute('data-tabs');
  }, [many]);
  // WhatsApp's screens may put the side menu away (v0.80): the chats get the whole window.
  const sideHidden = useWaSideHidden() && /^\/whatsapp(\/chat\/[^/]+)?$/.test((front?.path ?? '').split('?')[0]);
  return (
    <DeskContext.Provider value>
      <div className="desk-shell" data-side-hidden={sideHidden || undefined}>
        <nav className="app-nav desk-side" aria-label={t('nav.menu')} ref={setSlot} />
        <main className="desk-main">
          {many && <DeskTabStrip onMainTo={(path) => navigate(path)} />}
          {tabs.tabs.map((tab) => {
            const on = tab.id === tabs.active;
            return (
              <div key={tab.id} className="desk-tab" data-tab={tab.id} style={on ? undefined : { display: 'none' }}>
                {tab.id === MAIN_TAB ? <MainTab front={on} slot={on ? slot : null} /> : <TabPane tab={tab} front={on} slot={on ? slot : null} />}
              </div>
            );
          })}
        </main>
        <DeskTips />
        <DeskRouteMenu />
        <PwaUpdater />
        <UnsavedGuard />
      </div>
    </DeskContext.Provider>
  );
}

/* ---------------- Phone ---------------- */

function PhoneShell() {
  useViewportSync();
  // The document never scrolls on a phone: every screen scrolls itself (see ui/stack.tsx).
  useEffect(() => {
    document.documentElement.classList.add('phone-shell');
    return () => document.documentElement.classList.remove('phone-shell');
  }, []);
  const render = useCallback(
    (location: Location) => (
      <ErrorBoundary resetKey={location.pathname}>
        <AppRoutes location={location} />
      </ErrorBoundary>
    ),
    [],
  );
  return (
    <div className="app-root">
      <PhoneStack render={render} />
      <TabBar plus={<QuickPlus />} />
      <PwaUpdater />
      <UnsavedGuard />
    </div>
  );
}

function Shell() {
  const mobile = usePhone();
  // A job shown to its customer (v0.67): the app's chrome hidden, every other address back to the job.
  useClientLockGuard();
  useSheetSwipe(mobile);
  useBackClosesSheets(mobile);
  useEscapeClosesTopSheet();
  useStatusBarColor();
  // The garage's WhatsApp (v0.78): whether it is linked and how many messages wait — asked once, a moment after the
  // start (the chats themselves are read when its screen is opened); the server's stream keeps it right after.
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshWa(), 2500);
    return () => window.clearTimeout(timer);
  }, []);
  // Screens opened from outside the screens (a notification, a toast's button) go through the router (ui/openRoute.ts).
  const navigate = useNavigate();
  useEffect(() => {
    // (A PC's tabs, v0.89: such a screen opens in the window's own tab, brought to the front.)
    setRouteOpener((to) => {
      focusTab(MAIN_TAB);
      navigate(to);
    });
    return () => setRouteOpener(null);
  }, [navigate]);
  const { pathname } = useLocation();
  // Toasts of the previous screen do not follow onto the next one.
  useEffect(() => {
    notifications.cleanQueue();
  }, [pathname]);
  return mobile ? <PhoneShell /> : <DesktopShell />;
}

/**
 * A banner goes away as on the iPhone: a tap on it, or a flick up (not a tap on its own button — "Undo").
 * Only one is shown at a time, so putting it away clears them.
 */
function useBannerDismiss() {
  useEffect(() => {
    let startY: number | null = null;
    const banner = (t: EventTarget | null) => (t instanceof Element ? t.closest('.mantine-Notification-root') : null);
    const onClick = (e: MouseEvent) => {
      if (banner(e.target) && !(e.target as Element).closest('button, a')) notifications.clean();
    };
    const onStart = (e: TouchEvent) => {
      startY = banner(e.target) ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY !== null && e.touches[0].clientY - startY < -18) {
        startY = null;
        notifications.clean();
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
    };
  }, []);
}

function Providers({ children }: { children: React.ReactNode }) {
  const lang = useLang();
  const mobile = usePhone();
  useBannerDismiss();
  // After a restore and its reload: what came back.
  useRestoreReport();
  return (
    <DatesProvider settings={{ locale: lang, firstDayOfWeek: 1, weekendDays: [6, 0] }}>
      <Notifications position={mobile ? 'top-center' : 'top-right'} limit={1} autoClose={2600} transitionDuration={260} />
      <Celebration />
      <FeedbackTool />
      <AiNotices />
      <WaNotices />
      <WaConfirm />
      {children}
    </DatesProvider>
  );
}

export function App() {
  const mobile = usePhone();
  // Light, dark, or by the sun in Dubai ("Auto") — the app decides, not the phone's dark mode.
  const scheme = useResolvedScheme();
  return (
    <MantineProvider theme={mobile ? phoneTheme : deskTheme} cssVariablesResolver={cssResolver} defaultColorScheme="light" forceColorScheme={scheme}>
      <Providers>
        <HashRouter>
          <Shell />
        </HashRouter>
      </Providers>
    </MantineProvider>
  );
}
