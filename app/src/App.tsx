import { AppShell, Box, Button, Group, Kbd, MantineProvider, NavLink as MNavLink, Stack, Text, TextInput } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { useHotkeys } from '@mantine/hooks';
import { notifications, Notifications } from '@mantine/notifications';
import { IconCash, IconChartBar, IconDots, IconLayoutKanban, IconPackage, IconPlus, IconSearch, IconSettings, IconTruck, IconUsers, type Icon } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HashRouter, Link, Route, Routes, useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom';
import { ClaimPage } from './features/claims/ClaimPage';
import { BoardPage } from './features/board/BoardPage';
import { CustomerPage } from './features/customers/CustomerPage';
import { CustomersPage } from './features/customers/CustomersPage';
import { VehiclePage } from './features/customers/VehiclePage';
import { EstimatePage } from './features/estimate/EstimatePage';
import { FoundProblemPage } from './features/estimate/FoundProblemPage';
import { InspectionWizard } from './features/inspection/InspectionWizard';
import { MoneyPage } from './features/money/MoneyPage';
import { QuickInvoicePage } from './features/money/QuickInvoicePage';
import { MorePage } from './features/more/MorePage';
import { NewOrderPage } from './features/orders/NewOrderPage';
import { OrderPage } from './features/orders/OrderPage';
import { PartsPage } from './features/parts/PartsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { SearchPage } from './features/search/SearchPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { cashState } from './services/money';
import { AppearanceControls, useStatusBarColor } from './ui/Appearance';
import { Logo, Money } from './ui/components';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { useLang, usePhone } from './ui/hooks';
import { PwaUpdater } from './ui/pwa';
import { useBackClosesSheets } from './ui/backCloses';
import { useSheetSwipe } from './ui/sheetSwipe';
import { hintNavigation, PhoneStack, scrollToTop, useViewportSync } from './ui/stack';
import { UnsavedGuard } from './ui/unsaved';
import { cssResolver, phoneTheme, theme } from './ui/theme';

/** Every screen of the app, for a given location (the phone renders two at once while you go back). */
function AppRoutes({ location }: { location: Location }) {
  return (
    <Routes location={location}>
      <Route path="/" element={<BoardPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/orders/new" element={<NewOrderPage />} />
      <Route path="/orders/:id" element={<OrderPage />} />
      <Route path="/orders/:id/intake" element={<InspectionWizard kind="intake" />} />
      <Route path="/orders/:id/handover" element={<InspectionWizard kind="handover" />} />
      <Route path="/orders/:id/invoice" element={<QuickInvoicePage />} />
      <Route path="/orders/:id/estimate" element={<EstimatePage />} />
      <Route path="/orders/:id/problem" element={<FoundProblemPage />} />
      <Route path="/orders/:id/claim" element={<ClaimPage />} />
      <Route path="/customers" element={<CustomersPage />} />
      <Route path="/customers/:id" element={<CustomerPage />} />
      <Route path="/vehicles/:id" element={<VehiclePage />} />
      <Route path="/parts" element={<PartsPage />} />
      <Route path="/money" element={<MoneyPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/more" element={<MorePage />} />
      <Route path="*" element={<BoardPage />} />
    </Routes>
  );
}

/* ---------------- PC ---------------- */

function SideSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  // "/" or Ctrl+K jumps to search from anywhere on a PC.
  useHotkeys([
    ['/', () => ref.current?.focus()],
    ['mod+K', () => ref.current?.focus()],
  ]);
  return (
    <TextInput
      ref={ref}
      size="sm"
      radius="md"
      mb="sm"
      leftSection={<IconSearch size={16} />}
      rightSection={!q ? <Kbd size="xs">/</Kbd> : undefined}
      placeholder={t('nav.search')}
      aria-label={t('search.placeholder')}
      value={q}
      onChange={(e) => setQ(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          navigate(`/search?q=${encodeURIComponent(q)}`);
          setQ('');
          ref.current?.blur();
        }
        if (e.key === 'Escape') {
          setQ('');
          ref.current?.blur();
        }
      }}
    />
  );
}

const NAV_GROUPS = [
  {
    key: 'nav.groupWork',
    items: [
      { to: '/', icon: IconLayoutKanban, key: 'nav.board', end: true },
      { to: '/search', icon: IconSearch, key: 'nav.search' },
      { to: '/customers', icon: IconUsers, key: 'nav.customers' },
      { to: '/parts', icon: IconPackage, key: 'nav.parts' },
      { to: '/parts?tab=suppliers', icon: IconTruck, key: 'nav.suppliers' },
    ],
  },
  {
    key: 'nav.groupMoney',
    items: [
      { to: '/money', icon: IconCash, key: 'nav.money' },
      { to: '/reports', icon: IconChartBar, key: 'nav.reports' },
    ],
  },
  { key: 'nav.groupSystem', items: [{ to: '/settings', icon: IconSettings, key: 'nav.settings' }] },
];

/** PC sidebar: logo, search, "New job", sections, cash, appearance. */
function SideNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const cash = useLiveQuery(cashState, []);
  // "Parts" and "Suppliers" share a route: highlight by the tab, not just the path.
  const isActive = (to: string, end?: boolean) => {
    const [path, query] = to.split('?');
    if (end ? location.pathname !== path : !location.pathname.startsWith(path)) return false;
    if (path === '/parts') return (query ?? '') === (location.search.includes('tab=suppliers') ? 'tab=suppliers' : '');
    return true;
  };
  return (
    <Stack h="100%" justify="space-between" gap="md">
      <Box>
        <Box component={Link} to="/" px={8} py={6} mb="md" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }} aria-label={t('nav.board')}>
          <Logo size={28} />
        </Box>
        <SideSearch />
        <Button fullWidth leftSection={<IconPlus size={18} />} mb="lg" onClick={() => navigate('/orders/new')}>
          {t('nav.newOrder')}
        </Button>
        {NAV_GROUPS.map((g) => (
          <Box key={g.key} mb="md">
            <div className="nav-group">{t(g.key)}</div>
            {g.items.map((s) => (
              <MNavLink
                key={s.to}
                component={Link}
                to={s.to}
                active={isActive(s.to, s.end)}
                aria-current={isActive(s.to, s.end) ? 'page' : undefined}
                label={t(s.key)}
                leftSection={<s.icon size={19} stroke={1.8} />}
              />
            ))}
          </Box>
        ))}
      </Box>
      <Stack gap="sm">
        {cash && (
          <Box p="sm" className="nav-cash tap" onClick={() => navigate('/money?tab=cash')} role="button" tabIndex={0}>
            <div className="eyebrow">{t('board.cash')}</div>
            <Text size="lg" mt={2}>
              <Money fils={cash.expected} display />
            </Text>
          </Box>
        )}
        <AppearanceControls />
      </Stack>
    </Stack>
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
    <Box mb="md" mt="xs" p="sm" className="surface" style={{ boxShadow: 'inset 4px 0 0 var(--mantine-color-yellow-5)' }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div>
          <Text fw={600} size="sm">
            {t('preview.title')}
          </Text>
          <Text size="sm" c="dimmed">
            {t('preview.text')}
          </Text>
        </div>
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          aria-label={t('common.close')}
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem('mygarage.previewNoticeHidden', '1');
            } catch {
              // ignore
            }
          }}
        >
          ×
        </Button>
      </Group>
    </Box>
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

function DesktopShell() {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <AppShell navbar={{ width: 256, breakpoint: 0 }} padding={0}>
      <ScrollManager />
      <AppShell.Navbar p="sm" className="app-nav" aria-label={t('nav.menu')}>
        <SideNav />
      </AppShell.Navbar>
      <AppShell.Main>
        <div className="page-shell">
          <Box maw={1320} mx="auto">
            <PreviewNotice />
            <ErrorBoundary resetKey={location.pathname}>
              <div key={location.pathname} className="page-enter">
                <AppRoutes location={location} />
              </div>
            </ErrorBoundary>
          </Box>
        </div>
      </AppShell.Main>
      <PwaUpdater />
      <UnsavedGuard />
    </AppShell>
  );
}

/* ---------------- Phone ---------------- */

const TABS: { to: string; icon: Icon; key: string }[] = [
  { to: '/', icon: IconLayoutKanban, key: 'nav.board' },
  { to: '/search', icon: IconSearch, key: 'nav.search' },
  { to: '/money', icon: IconCash, key: 'nav.money' },
  { to: '/more', icon: IconDots, key: 'nav.more' },
];
const MORE_PATHS = ['/more', '/customers', '/vehicles', '/parts', '/reports', '/settings'];

/** The tab a screen belongs to: its own root, or the tab it was opened from (a job, a customer). */
function tabOf(pathname: string): string | undefined {
  if (MORE_PATHS.some((p) => pathname.startsWith(p))) return '/more';
  return TABS.find((s) => s.to === pathname)?.to;
}

/**
 * The phone tab bar of iOS 26: a floating Liquid Glass capsule that never moves with the screens.
 * The tab you are in sits on a lens that slides from tab to tab; a screen opened from a tab (a job
 * from the board) keeps that tab lit, and tapping it goes back to the tab's first screen — tapping
 * it there scrolls to the top. "+" (new job) is its own tinted glass circle at the trailing end, like
 * the compose button of iOS apps: a tab bar is for places, not actions.
 */
function TabBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const last = useRef('/');
  const current = tabOf(pathname) ?? last.current;
  last.current = current;
  const index = TABS.findIndex((s) => s.to === current);
  const go = (to: string) => {
    if (pathname === to) return scrollToTop(true);
    hintNavigation(current === to ? 'pop' : 'tab');
    navigate(to);
  };
  return (
    <div className="tab-bar-wrap">
      <nav className="tab-bar glass" aria-label={t('nav.menu')} style={{ '--i': Math.max(0, index), '--n': TABS.length } as React.CSSProperties}>
        <span className="tab-lens" data-hidden={index < 0} aria-hidden />
        {TABS.map((s) => (
          <button key={s.to} type="button" data-href={s.to} className={s.to === current ? 'active' : undefined} aria-current={s.to === current ? 'page' : undefined} onClick={() => go(s.to)}>
            <s.icon stroke={s.to === current ? 2.1 : 1.8} aria-hidden />
            <span>{t(s.key)}</span>
          </button>
        ))}
      </nav>
      <button type="button" className="tab-plus" aria-label={t('nav.newOrder')} onClick={() => navigate('/orders/new')}>
        <IconPlus size={28} stroke={2.2} aria-hidden />
      </button>
    </div>
  );
}

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
      <TabBar />
      <PwaUpdater />
      <UnsavedGuard />
    </div>
  );
}

function Shell() {
  const mobile = usePhone();
  useSheetSwipe(mobile);
  useBackClosesSheets(mobile);
  useStatusBarColor();
  const { pathname } = useLocation();
  // Toasts of the previous screen do not follow onto the next one.
  useEffect(() => {
    notifications.cleanQueue();
  }, [pathname]);
  return mobile ? <PhoneShell /> : <DesktopShell />;
}

function Providers({ children }: { children: React.ReactNode }) {
  const lang = useLang();
  const mobile = usePhone();
  return (
    <DatesProvider settings={{ locale: lang, firstDayOfWeek: 1, weekendDays: [6, 0] }}>
      <Notifications position={mobile ? 'top-center' : 'top-right'} limit={2} autoClose={2600} transitionDuration={260} />
      {children}
    </DatesProvider>
  );
}

export function App() {
  const mobile = usePhone();
  return (
    <MantineProvider theme={mobile ? phoneTheme : theme} cssVariablesResolver={cssResolver} defaultColorScheme="light">
      <Providers>
        <HashRouter>
          <Shell />
        </HashRouter>
      </Providers>
    </MantineProvider>
  );
}
