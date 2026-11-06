import { ActionIcon, Alert, AppShell, Box, Burger, Group, MantineProvider, Menu, NavLink as MNavLink, Stack, Text, TextInput, useMantineColorScheme } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { Notifications } from '@mantine/notifications';
import {
  IconCash,
  IconChartBar,
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
} from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
import { Logo, Money } from './ui/components';
import { useLang } from './ui/hooks';
import { cssResolver, theme } from './ui/theme';

function HeaderTools() {
  const { t } = useTranslation();
  const lang = useLang();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Group gap={6} wrap="nowrap">
      <ActionIcon size={36} w={44} aria-label={t('app.language')} onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}>
        <Text size="xs" fw={800} c="inherit">
          {lang === 'ru' ? 'RU' : 'EN'}
        </Text>
      </ActionIcon>
      <ActionIcon size={36} aria-label={t('app.theme')} onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}>
        {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Group>
  );
}

function HeaderSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <TextInput
      size="sm"
      w={360}
      radius="md"
      leftSection={<IconSearch size={16} />}
      placeholder={t('search.placeholder')}
      value={q}
      onChange={(e) => setQ(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          navigate(`/search?q=${encodeURIComponent(q)}`);
          setQ('');
        }
      }}
      styles={{ input: { background: 'rgba(255,255,255,0.08)', border: 0, color: '#fff' } }}
    />
  );
}

function PlusMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Menu position="top" offset={4} width={220}>
      <Menu.Target>
        <div className="plus">
          <div className="plus-btn" role="button" aria-label={t('nav.add')}>
            <IconPlus size={26} stroke={2.2} />
          </div>
        </div>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPlus size={18} />} onClick={() => navigate('/orders/new')}>
          {t('nav.newOrder')}
        </Menu.Item>
        <Menu.Item leftSection={<IconReceipt size={18} />} onClick={() => navigate('/money?tab=expenses&add=1')}>
          {t('nav.expense')}
        </Menu.Item>
        <Menu.Item leftSection={<IconCash size={18} />} onClick={() => navigate('/money?tab=cash')}>
          {t('nav.cash')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
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
  const cash = useLiveQuery(cashState, []);
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
          style={{ background: 'var(--mantine-color-cobalt-6)', color: '#fff', borderRadius: 10, marginBottom: 14 }}
        />
        {NAV_GROUPS.map((g) => (
          <Box key={g.key} mb="md">
            <Text size="11px" fw={700} tt="uppercase" c="var(--app-ink-muted)" style={{ letterSpacing: '0.08em' }} px={12} mb={6}>
              {t(g.key)}
            </Text>
            {g.items.map((s) => (
              <MNavLink key={s.to} component={NavLink} to={s.to} end={s.end} label={t(s.key)} leftSection={<s.icon size={19} stroke={1.8} />} onClick={onNavigate} />
            ))}
          </Box>
        ))}
      </Box>
      {cash && (
        <Box p="sm" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12 }}>
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
    <Alert
      color="yellow"
      mb="md"
      title={t('preview.title')}
      withCloseButton
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
    </Alert>
  );
}

function Shell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false });
  const [navOpen, { toggle, close }] = useDisclosure(false);
  const focus = /\/orders\/[^/]+\/(intake|handover)$/.test(location.pathname);
  const showBottom = mobile && !focus;
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 248, breakpoint: 'sm', collapsed: { mobile: !navOpen } }}
      footer={{ height: 68, collapsed: !showBottom }}
      padding={mobile ? 'md' : 'xl'}
    >
      <AppShell.Header className="app-header">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            {mobile && <Burger opened={navOpen} onClick={toggle} size="sm" color="#fff" aria-label="menu" />}
            <Box component={NavLink} to="/" style={{ textDecoration: 'none' }}>
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
          <Routes>
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
        </Box>
      </AppShell.Main>
      <AppShell.Footer withBorder={false} style={{ boxShadow: '0 -1px 0 var(--app-hairline), 0 -6px 20px rgba(18,23,34,0.06)' }}>
        <nav className="bottom-nav">
          <NavLink to="/" end>
            <IconLayoutKanban size={23} stroke={1.8} />
            {t('nav.board')}
          </NavLink>
          <NavLink to="/search">
            <IconSearch size={23} stroke={1.8} />
            {t('nav.search')}
          </NavLink>
          <PlusMenu />
          <NavLink to="/money">
            <IconCash size={23} stroke={1.8} />
            {t('nav.money')}
          </NavLink>
          <NavLink to="/more">
            <IconDots size={23} stroke={1.8} />
            {t('nav.more')}
          </NavLink>
        </nav>
      </AppShell.Footer>
    </AppShell>
  );
}

function Providers({ children }: { children: React.ReactNode }) {
  const lang = useLang();
  const mobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false });
  return (
    <DatesProvider settings={{ locale: lang, firstDayOfWeek: 1, weekendDays: [6, 0] }}>
      <Notifications position={mobile ? 'top-center' : 'top-right'} limit={3} autoClose={2600} />
      {children}
    </DatesProvider>
  );
}

export function App() {
  return (
    <MantineProvider theme={theme} cssVariablesResolver={cssResolver} defaultColorScheme="light">
      <Providers>
        <HashRouter>
          <Shell />
        </HashRouter>
      </Providers>
    </MantineProvider>
  );
}
