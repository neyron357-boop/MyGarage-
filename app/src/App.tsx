import { Kbd, MantineProvider, Popover, UnstyledButton } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { useHotkeys } from '@mantine/hooks';
import { notifications, Notifications } from '@mantine/notifications';
import {
  IconBell,
  IconBrandWhatsapp,
  IconCash,
  IconChartBar,
  IconInfoCircle,
  IconLayoutKanban,
  IconNotes,
  IconPackage,
  IconPalette,
  IconSearch,
  IconSettings,
  IconTruck,
  IconUsers,
} from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState, type ContextType } from 'react';
import { useTranslation } from 'react-i18next';
import { HashRouter, Link, MemoryRouter, Route, Routes, UNSAFE_LocationContext, UNSAFE_RouteContext, useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom';
import { ClaimPage } from './features/claims/ClaimPage';
import { BoardPage } from './features/board/BoardPage';
import { CustomerPage } from './features/customers/CustomerPage';
import { CustomersPage } from './features/customers/CustomersPage';
import { VehiclePage } from './features/customers/VehiclePage';
import { MoneyPage } from './features/money/MoneyPage';
import { DebtPaymentsPage } from './features/money/DebtPayments';
import { CustomerMonthsPage } from './features/money/CustomerMonths';
import { JobPage } from './features/job/JobPage';
import { JobSuppliersPage } from './features/job/JobSuppliers';
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
import { PhoneStack, useViewportSync } from './ui/stack';
import { DeskContext, DeskKeys, DeskPaneContext, MOD_KEY, deskPage, setActivePane, sheetOpen, useDeskShell, useDeskWheel, type DeskPaneInfo } from './ui/desk';
import { DeskTips } from './ui/deskTips';
import { useWaSideHidden } from './ui/deskSide';
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
      {/* v0.38: the suppliers for a job — its own screen (the user's ask), from the chip under the job. */}
      <Route path="/orders/:id/suppliers" element={<JobSuppliersPage />} />
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
      <Link to="/" className="desk-brand" aria-label={t('nav.board')}>
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
                <Link key={s.to} to={s.to} className="desk-nav-item" data-active={on || undefined} aria-current={on ? 'page' : undefined}>
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
          <UnstyledButton className="desk-side-btn desk-side-cash" onClick={() => navigate('/money?tab=cash')}>
            <IconCash size={18} stroke={1.9} aria-hidden />
            <span>{t('board.cash')}</span>
            <Money fils={cash.expected} fw={600} />
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
function ScrollManager() {
  const location = useLocation();
  const type = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const current = useRef(location.key);
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => positions.current.set(current.current, window.scrollY));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  useEffect(() => {
    current.current = location.key;
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

/* ---------------- PC: a job beside the job (v0.80) ---------------- */

/** A job's own address (the side pane follows it into the window's: `?side=`). `new` — a new job being taken in. */
const SIDE_JOB = /^\/orders\/([^/]+)$/;
const MAIN_PANE: DeskPaneInfo = { id: 'main' };

/** The screens of the side pane, on its own address: what it shows goes into the window's address; the board — it closes. */
function SidePaneRoutes({ onShow, onClose }: { onShow: (side: string) => void; onClose: () => void }) {
  const location = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  // How deep in its own history (where its «Назад» leads): at the first screen «Назад» closes the pane.
  const [depth, setDepth] = useState(0);
  const last = useRef(location.key);
  useEffect(() => {
    if (last.current === location.key) return;
    last.current = location.key;
    setDepth((d) => (type === 'PUSH' ? d + 1 : type === 'POP' ? Math.max(0, d - 1) : d));
  }, [location.key, type]);
  useEffect(() => {
    if (location.pathname === '/') return onClose();
    const m = SIDE_JOB.exec(location.pathname);
    if (m) onShow(m[1]);
    return undefined;
  }, [location.pathname, onShow, onClose]);
  const pane = useMemo<DeskPaneInfo>(() => ({ id: 'side', closes: depth === 0, back: () => (depth > 0 ? navigate(-1) : onClose()) }), [depth, navigate, onClose]);
  return (
    <DeskPaneContext.Provider value={pane}>
      <ErrorBoundary resetKey={location.pathname}>
        <div key={location.pathname} className="page-enter" data-pane-page={deskPage(location.pathname)}>
          <AppRoutes location={location} />
        </div>
      </ErrorBoundary>
    </DeskPaneContext.Provider>
  );
}

/**
 * The side pane: a router of its own (its screens open, go back and take in a new job there, the window's screen stays).
 * React Router keeps one router to a page — the window's is left out of this one (its contexts cleared for it).
 */
function SidePane({ start, onShow, onClose }: { start: string; onShow: (side: string) => void; onClose: () => void }) {
  const [first] = useState(() => `/orders/${start}`);
  return (
    <UNSAFE_LocationContext.Provider value={null as unknown as ContextType<typeof UNSAFE_LocationContext>}>
      <UNSAFE_RouteContext.Provider value={{ outlet: null, matches: [], isDataRoute: false }}>
        <MemoryRouter initialEntries={[first]}>
          <SidePaneRoutes onShow={onShow} onClose={onClose} />
        </MemoryRouter>
      </UNSAFE_RouteContext.Provider>
    </UNSAFE_LocationContext.Provider>
  );
}

function DesktopShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  // A job beside the job (v0.80): `?side=` of a job's address — `new` or the other job's id.
  const side = new URLSearchParams(location.search).get('side');
  const twin = !!side && /^\/orders\/(?!new$)[^/]+$/.test(location.pathname);
  const here = useRef(location);
  here.current = location;
  const setSide = useCallback(
    (v: string | null) => {
      const loc = here.current;
      const p = new URLSearchParams(loc.search);
      if ((p.get('side') ?? null) === v) return;
      if (v) p.set('side', v);
      else p.delete('side');
      const search = p.toString();
      navigate({ pathname: loc.pathname, search: search ? `?${search}` : '' }, { replace: true });
    },
    [navigate],
  );
  const showSide = useCallback((v: string) => setSide(v), [setSide]);
  const closeSide = useCallback(() => setSide(null), [setSide]);
  useEffect(() => {
    if (!twin) setActivePane('main');
  }, [twin]);
  // The computer's own layout (v0.41): every rule of it is under html.desk, which the phone never has.
  useDeskShell();
  useDeskWheel();
  // WhatsApp's screens may put the side menu away (v0.80): the chats get the whole window.
  const sideHidden = useWaSideHidden() && /^\/whatsapp(\/chat\/[^/]+)?$/.test(location.pathname);
  return (
    <DeskContext.Provider value>
      <div className="desk-shell" data-side-hidden={sideHidden || undefined}>
        <ScrollManager />
        <nav className="app-nav desk-side" aria-label={t('nav.menu')}>
          <SideNav />
        </nav>
        <main className="desk-main">
          {/* The screen decides its width (desk.css): the board the whole window, a job two columns, a form one. */}
          <div className="page-shell" data-page={twin ? 'twin' : deskPage(location.pathname)}>
            <div className="desk-page">
              <PreviewNotice />
              {twin ? (
                // Two jobs in one window: each pane scrolls by itself; the keys act in the one last clicked.
                <div className="desk-twin">
                  <section className="desk-twin-pane" data-pane="main" onPointerDownCapture={() => setActivePane('main')} onFocusCapture={() => setActivePane('main')}>
                    <DeskPaneContext.Provider value={MAIN_PANE}>
                      <ErrorBoundary resetKey={location.pathname}>
                        <div key={location.pathname} className="page-enter">
                          <AppRoutes location={location} />
                        </div>
                      </ErrorBoundary>
                    </DeskPaneContext.Provider>
                  </section>
                  <section className="desk-twin-pane" data-pane="side" aria-label={t('desk.twin')} onPointerDownCapture={() => setActivePane('side')} onFocusCapture={() => setActivePane('side')}>
                    <SidePane start={side} onShow={showSide} onClose={closeSide} />
                  </section>
                </div>
              ) : (
                <ErrorBoundary resetKey={location.pathname}>
                  <div key={location.pathname} className="page-enter">
                    <AppRoutes location={location} />
                  </div>
                </ErrorBoundary>
              )}
            </div>
          </div>
        </main>
        <DeskKeys />
        <DeskTips />
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
