import { ActionIcon, AppShell, Box, Burger, Drawer, Group, Kbd, MantineProvider, NavLink as MNavLink, Stack, Text, TextInput, ThemeIcon, Tooltip, useMantineColorScheme } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { notifications, Notifications } from '@mantine/notifications';
import {
  IconCalendarPlus,
  IconCash,
  IconCashRegister,
  IconChartBar,
  IconChevronRight,
  IconDots,
  IconLayoutKanban,
  IconMoon,
  IconPackage,
  IconPlus,
  IconReceipt,
  IconSearch,
  IconSettings,
  IconSun,
  IconTruck,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HashRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { ClaimPage } from './features/claims/ClaimPage';
import { BoardPage } from './features/board/BoardPage';
import { CustomerPage } from './features/customers/CustomerPage';
import { CustomersPage } from './features/customers/CustomersPage';
import { VehiclePage } from './features/customers/VehiclePage';
import { EstimatePage } from './features/estimate/EstimatePage';
import { FoundProblemPage } from './features/estimate/FoundProblemPage';
import { InspectionWizard } from './features/inspection/InspectionWizard';
import { MoneyPage } from './features/money/MoneyPage';
import { MorePage } from './features/more/MorePage';
import { NewOrderPage } from './features/orders/NewOrderPage';
import { OrderPage } from './features/orders/OrderPage';
import { PartsPage } from './features/parts/PartsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { SearchPage } from './features/search/SearchPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { setLang } from './i18n';
import { cashState } from './services/money';
import { haptic } from './ui/clipboard';
import { Logo, Money } from './ui/components';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { useLang, usePhone } from './ui/hooks';
import { PwaUpdater } from './ui/pwa';
import { useBackClosesSheets } from './ui/backCloses';
import { useSheetSwipe } from './ui/sheetSwipe';
import { UnsavedGuard } from './ui/unsaved';
import { cssResolver, phoneTheme, theme } from './ui/theme';

function HeaderTools() {
  const { t } = useTranslation();
  const lang = useLang();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Group gap={6} wrap="nowrap">
      <Tooltip label={lang === 'ru' ? 'English' : 'Русский'} openDelay={400}>
        <ActionIcon size={36} w={44} aria-label={t('app.language')} onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}>
          <Text size="xs" fw={800} c="inherit" key={lang} className="fade-enter">
            {lang === 'ru' ? 'RU' : 'EN'}
          </Text>
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t('app.theme')} openDelay={400}>
        <ActionIcon size={36} aria-label={t('app.theme')} onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}>
          <span key={colorScheme} className="pop-in" style={{ display: 'grid' }}>
            {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </span>
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function HeaderSearch() {
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
      w={380}
      radius="md"
      leftSection={<IconSearch size={16} />}
      rightSection={!q ? <Kbd size="xs" style={{ background: 'transparent', color: 'var(--app-ink-muted)', borderColor: 'rgba(255,255,255,0.18)' }}>/</Kbd> : undefined}
      placeholder={t('search.placeholder')}
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
      className="header-search"
      styles={{ input: { background: 'rgba(255,255,255,0.08)', border: 0, color: '#fff' } }}
    />
  );
}

/** "+" in the phone tab bar: the four things a manager starts most often. */
function QuickActions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, { toggle, close }] = useDisclosure(false);
  // Closes on any navigation, including the phone's Back button.
  useEffect(() => close(), [location.pathname, location.search, close]);
  const go = (to: string) => {
    close();
    navigate(to);
  };
  const tiles: { to: string; icon: Icon; label: string; hint: string; color: string }[] = [
    { to: '/orders/new?when=later', icon: IconCalendarPlus, label: t('quick.booking'), hint: t('quick.bookingHint'), color: 'cobalt' },
    { to: '/money?tab=expenses&add=1', icon: IconReceipt, label: t('nav.expense'), hint: t('quick.expenseHint'), color: 'orange' },
    { to: '/money?tab=cash', icon: IconCashRegister, label: t('nav.cash'), hint: t('quick.cashHint'), color: 'green' },
    { to: '/search', icon: IconSearch, label: t('quick.find'), hint: t('quick.findHint'), color: 'gray' },
  ];
  return (
    <div className="plus">
      <button
        type="button"
        className="plus-btn"
        data-open={open}
        aria-label={t('nav.add')}
        aria-expanded={open}
        onClick={() => {
          haptic(8);
          toggle();
        }}
      >
        <IconPlus size={26} stroke={2.2} />
      </button>
      <Drawer opened={open} onClose={close} position="bottom" size="auto" withCloseButton={false} padding="md" classNames={{ content: 'quick-sheet' }} title={undefined} aria-label={t('nav.add')}>
        <Box pb="calc(8px + env(safe-area-inset-bottom, 0px))">
          <Box mx="auto" mb="md" w={38} h={4} style={{ borderRadius: 2, background: 'var(--mantine-color-gray-4)' }} />
          <div className="quick-grid stagger">
            <button type="button" className="quick-tile primary" onClick={() => go('/orders/new')}>
              <ThemeIcon size={44} radius="md" color="white" variant="white">
                <IconPlus size={24} color="var(--mantine-color-cobalt-6)" />
              </ThemeIcon>
              <div style={{ flex: 1 }}>
                <Text fw={700}>{t('nav.newOrder')}</Text>
                <Text size="xs" c="rgba(255,255,255,0.78)">
                  {t('quick.newOrderHint')}
                </Text>
              </div>
              <IconChevronRight size={20} />
            </button>
            {tiles.map((x) => (
              <button key={x.to} type="button" className="quick-tile" onClick={() => go(x.to)}>
                <ThemeIcon size={40} radius="md" variant="light" color={x.color}>
                  <x.icon size={22} stroke={1.8} />
                </ThemeIcon>
                <div>
                  <Text fw={700} size="sm">
                    {x.label}
                  </Text>
                  <Text size="xs" c="dimmed" lh={1.3}>
                    {x.hint}
                  </Text>
                </div>
              </button>
            ))}
          </div>
        </Box>
      </Drawer>
    </div>
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

function SideNav({ onNavigate }: { onNavigate: () => void }) {
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
        <MNavLink
          component="button"
          onClick={() => {
            navigate('/orders/new');
            onNavigate();
          }}
          label={t('nav.newOrder')}
          leftSection={<IconPlus size={18} />}
          className="nav-primary"
        />
        {NAV_GROUPS.map((g) => (
          <Box key={g.key} mb="md">
            <Text size="11px" fw={700} tt="uppercase" c="var(--app-ink-muted)" style={{ letterSpacing: '0.08em' }} px={12} mb={6}>
              {t(g.key)}
            </Text>
            {g.items.map((s) => (
              <MNavLink
                key={s.to}
                component={Link}
                to={s.to}
                active={isActive(s.to, s.end)}
                aria-current={isActive(s.to, s.end) ? 'page' : undefined}
                label={t(s.key)}
                leftSection={<s.icon size={19} stroke={1.8} />}
                onClick={onNavigate}
              />
            ))}
          </Box>
        ))}
      </Box>
      {cash && (
        <Box p="sm" className="nav-cash tap" onClick={() => { navigate('/money?tab=cash'); onNavigate(); }} role="button" tabIndex={0}>
          <Text size="11px" fw={700} tt="uppercase" c="var(--app-ink-muted)" style={{ letterSpacing: '0.08em' }}>
            {t('board.cash')}
          </Text>
          <Text c="#fff" size="lg" mt={2}>
            <Money fils={cash.expected} display />
          </Text>
        </Box>
      )}
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
    <Box mb="md" p="sm" className="surface" style={{ borderLeft: '4px solid var(--mantine-color-yellow-5)' }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div>
          <Text fw={700} size="sm">
            {t('preview.title')}
          </Text>
          <Text size="sm" c="dimmed">
            {t('preview.text')}
          </Text>
        </div>
        <ActionIcon
          variant="subtle"
          color="gray"
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
        </ActionIcon>
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
    if (type === 'POP' && saved !== undefined) requestAnimationFrame(() => window.scrollTo(0, saved));
    else window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
  return null;
}

function Shell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = usePhone();
  const [navOpen, { toggle, close }] = useDisclosure(false);
  const focus = /\/orders\/[^/]+\/(intake|handover)$/.test(location.pathname);
  const showBottom = mobile && !focus;
  useSheetSwipe(mobile);
  useBackClosesSheets(mobile);
  useEffect(() => close(), [location.pathname, close]);
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 248, breakpoint: 'sm', collapsed: { mobile: !navOpen } }}
      footer={showBottom ? { height: 68 } : undefined}
      padding={mobile ? 'md' : 'xl'}
      transitionDuration={240}
      transitionTimingFunction="cubic-bezier(0.2, 0.8, 0.2, 1)"
    >
      <ScrollManager />
      <AppShell.Header className="app-header">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            {mobile && <Burger opened={navOpen} onClick={toggle} size="sm" color="#fff" aria-label={t('nav.menu')} />}
            <Box component={NavLink} to="/" style={{ textDecoration: 'none' }} aria-label={t('nav.board')}>
              <Logo size={26} />
            </Box>
          </Group>
          {!mobile && <HeaderSearch />}
          <Group gap={6} wrap="nowrap">
            {mobile && (
              <ActionIcon size={36} aria-label={t('nav.search')} onClick={() => navigate('/search')}>
                <IconSearch size={18} />
              </ActionIcon>
            )}
            <HeaderTools />
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm" className="app-nav">
        <SideNav onNavigate={close} />
      </AppShell.Navbar>
      <AppShell.Main className={showBottom ? 'with-bottom-nav' : undefined}>
        <Box maw={1320} mx="auto">
          <PreviewNotice />
          <ErrorBoundary resetKey={location.pathname}>
            <div key={location.pathname} className="page-enter">
              <Routes location={location}>
                <Route path="/" element={<BoardPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/orders/new" element={<NewOrderPage />} />
                <Route path="/orders/:id" element={<OrderPage />} />
                <Route path="/orders/:id/intake" element={<InspectionWizard kind="intake" />} />
                <Route path="/orders/:id/handover" element={<InspectionWizard kind="handover" />} />
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
      </AppShell.Main>
      {showBottom && (
        <AppShell.Footer withBorder={false} style={{ boxShadow: '0 -1px 0 var(--app-hairline), 0 -6px 20px rgba(18,23,34,0.06)' }}>
          <nav className="bottom-nav" aria-label={t('nav.menu')}>
            <NavLink to="/" end>
              <span className="ico">
                <IconLayoutKanban size={23} stroke={1.8} />
              </span>
              {t('nav.board')}
            </NavLink>
            <NavLink to="/search">
              <span className="ico">
                <IconSearch size={23} stroke={1.8} />
              </span>
              {t('nav.search')}
            </NavLink>
            <QuickActions />
            <NavLink to="/money">
              <span className="ico">
                <IconCash size={23} stroke={1.8} />
              </span>
              {t('nav.money')}
            </NavLink>
            <NavLink to="/more" className={({ isActive }) => (isActive || ['/customers', '/vehicles', '/parts', '/reports', '/settings'].some((p) => location.pathname.startsWith(p)) ? 'active' : '')}>
              <span className="ico">
                <IconDots size={23} stroke={1.8} />
              </span>
              {t('nav.more')}
            </NavLink>
          </nav>
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
      <Notifications position={mobile ? 'top-center' : 'top-right'} limit={2} autoClose={2600} transitionDuration={220} />
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
