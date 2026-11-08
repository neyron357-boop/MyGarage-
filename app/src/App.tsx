import { AppShell, Box, Button, Group, Kbd, MantineProvider, NavLink as MNavLink, Stack, Text, TextInput } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { useHotkeys } from '@mantine/hooks';
import { notifications, Notifications } from '@mantine/notifications';
import { IconCash, IconChartBar, IconDots, IconLayoutKanban, IconPackage, IconPlus, IconSearch, IconSettings, IconTruck, IconUsers } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
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
import { AppRouter, viewTransitionsSupported } from './ui/router';
import { useBackClosesSheets } from './ui/backCloses';
import { useSheetSwipe } from './ui/sheetSwipe';
import { useSwipeBack } from './ui/swipeBack';
import { UnsavedGuard } from './ui/unsaved';
import { cssResolver, phoneTheme, theme } from './ui/theme';

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

/**
 * Phone tab bar. "+" opens a new job straight away: the car is the first thing to record.
 * Tapping the tab you are on scrolls its screen to the top, as iOS tab bars do.
 */
function TabBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const moreActive = ['/more', '/customers', '/vehicles', '/parts', '/reports', '/settings'].some((p) => location.pathname.startsWith(p));
  const retap = (to: string) => (e: React.MouseEvent) => {
    if (location.pathname !== to) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return (
    <nav className="tab-bar" aria-label={t('nav.menu')}>
      <NavLink to="/" end onClick={retap('/')}>
        <IconLayoutKanban stroke={1.7} />
        {t('nav.board')}
      </NavLink>
      <NavLink to="/search" onClick={retap('/search')}>
        <IconSearch stroke={1.7} />
        {t('nav.search')}
      </NavLink>
      <div className="tab-plus-wrap">
        <button type="button" className="tab-plus" aria-label={t('nav.newOrder')} onClick={() => navigate('/orders/new')}>
          <IconPlus size={26} stroke={2.4} />
        </button>
      </div>
      <NavLink to="/money" onClick={retap('/money')}>
        <IconCash stroke={1.7} />
        {t('nav.money')}
      </NavLink>
      <NavLink to="/more" className={({ isActive }) => (isActive || moreActive ? 'active' : '')} onClick={retap('/more')}>
        <IconDots stroke={1.7} />
        {t('nav.more')}
      </NavLink>
    </nav>
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
 * New screens open at the top; "Back" returns to where the list was scrolled.
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
      // At once (so the screen is captured there for the back animation), and again once the list
      // has loaded and the page is tall enough.
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

function Shell() {
  const { t } = useTranslation();
  const location = useLocation();
  const mobile = usePhone();
  // Check-in, intake, handover and the quick invoice get the whole screen: no tab bar under their buttons.
  const focus = /^\/orders\/(new|[^/]+\/(intake|handover|invoice))$/.test(location.pathname);
  const showBottom = mobile && !focus;
  const pageRef = useRef<HTMLDivElement>(null);
  useSheetSwipe(mobile);
  useBackClosesSheets(mobile);
  useSwipeBack(pageRef, mobile);
  useStatusBarColor();
  // Where the browser animates the navigation stack (router.tsx) screens slide; elsewhere they rise in.
  const rise = !(mobile && viewTransitionsSupported());
  return (
    <AppShell
      navbar={mobile ? undefined : { width: 256, breakpoint: 0 }}
      footer={showBottom ? { height: 'calc(var(--app-bottom-h) + env(safe-area-inset-bottom, 0px))' } : undefined}
      padding={0}
    >
      <ScrollManager />
      {!mobile && (
        <AppShell.Navbar p="sm" className="app-nav" aria-label={t('nav.menu')}>
          <SideNav />
        </AppShell.Navbar>
      )}
      <AppShell.Main className={showBottom ? 'with-bottom-nav' : undefined}>
        <div ref={pageRef} className="page-shell">
          <Box maw={1320} mx="auto">
            <PreviewNotice />
            <ErrorBoundary resetKey={location.pathname}>
              <div key={location.pathname} className={rise ? 'page-enter' : undefined}>
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
              </div>
            </ErrorBoundary>
          </Box>
        </div>
      </AppShell.Main>
      {showBottom && (
        <AppShell.Footer withBorder={false} style={{ background: 'transparent' }}>
          <TabBar />
        </AppShell.Footer>
      )}
      <PwaUpdater />
      <UnsavedGuard />
    </AppShell>
  );
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
        <AppRouter animated={mobile}>
          <Shell />
        </AppRouter>
      </Providers>
    </MantineProvider>
  );
}
