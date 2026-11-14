import { AppShell, Box, Button, Kbd, MantineProvider, NavLink as MNavLink, Stack, Text, TextInput } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { useHotkeys } from '@mantine/hooks';
import { notifications, Notifications } from '@mantine/notifications';
import {
  IconCash,
  IconChartBar,
  IconInfoCircle,
  IconLayoutKanban,
  IconPackage,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTruck,
  IconUsers,
} from '@tabler/icons-react';
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
import { JobPage } from './features/job/JobPage';
import { MorePage } from './features/more/MorePage';
import { NewOrderPage } from './features/orders/NewOrderPage';
import { OrderPage } from './features/orders/OrderPage';
import { PartsPage } from './features/parts/PartsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { SearchPage } from './features/search/SearchPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { cashState } from './services/money';
import { AppearanceControls, useStatusBarColor } from './ui/Appearance';
import { useResolvedScheme } from './ui/scheme';
import { Celebration, Logo, Money, Tip } from './ui/components';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { useLang, usePhone } from './ui/hooks';
import { PwaUpdater } from './ui/pwa';
import { useBackClosesSheets } from './ui/backCloses';
import { useSheetSwipe } from './ui/sheetSwipe';
import { PhoneStack, useViewportSync } from './ui/stack';
import { TabBar } from './ui/tabBar';
import { UnsavedGuard } from './ui/unsaved';
import { cssResolver, phoneTheme, theme } from './ui/theme';
import { useRestoreReport } from './features/settings/RestoreModal';

/** Every screen of the app, for a given location (the phone renders two at once while you go back). */
function AppRoutes({ location }: { location: Location }) {
  return (
    <Routes location={location}>
      <Route path="/" element={<BoardPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/orders/new" element={<NewOrderPage />} />
      <Route path="/orders/:id" element={<JobPage />} />
      <Route path="/orders/:id/details" element={<OrderPage />} />
      <Route path="/orders/:id/intake" element={<InspectionWizard kind="intake" />} />
      <Route path="/orders/:id/handover" element={<InspectionWizard kind="handover" />} />
      <Route path="/orders/:id/invoice" element={<JobPage />} />
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
      {children}
    </DatesProvider>
  );
}

export function App() {
  const mobile = usePhone();
  // Light, dark, or by the sun in Dubai ("Auto") — the app decides, not the phone's dark mode.
  const scheme = useResolvedScheme();
  return (
    <MantineProvider theme={mobile ? phoneTheme : theme} cssVariablesResolver={cssResolver} defaultColorScheme="light" forceColorScheme={scheme}>
      <Providers>
        <HashRouter>
          <Shell />
        </HashRouter>
      </Providers>
    </MantineProvider>
  );
}
