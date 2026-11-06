import { ActionIcon, Alert, AppShell, Burger, Group, MantineProvider, Menu, NavLink as MNavLink, Text, createTheme, useMantineColorScheme } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { Notifications } from '@mantine/notifications';
import {
  IconCash,
  IconChartBar,
  IconDots,
  IconLanguage,
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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HashRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { BoardPage } from './features/board/BoardPage';
import { CustomerPage } from './features/customers/CustomerPage';
import { CustomersPage } from './features/customers/CustomersPage';
import { VehiclePage } from './features/customers/VehiclePage';
import { EstimatePage } from './features/estimate/EstimatePage';
import { FoundProblemPage } from './features/estimate/FoundProblemPage';
import { InspectionWizard } from './features/inspection/InspectionWizard';
import { ClaimPage } from './features/claims/ClaimPage';
import { MoneyPage } from './features/money/MoneyPage';
import { MorePage } from './features/more/MorePage';
import { NewOrderPage } from './features/orders/NewOrderPage';
import { OrderPage } from './features/orders/OrderPage';
import { PartsPage } from './features/parts/PartsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { SearchPage } from './features/search/SearchPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { setLang } from './i18n';
import { useLang } from './ui/hooks';

const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif',
  components: {
    Button: { defaultProps: { size: 'md' } },
  },
});

function TopBar({ burger }: { burger: React.ReactNode }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap="xs">
        {burger}
        <Text fw={800} size="lg" component={NavLink} to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          MyGarage
        </Text>
      </Group>
      <Group gap={4}>
        <ActionIcon
          variant="default"
          size="lg"
          aria-label={t('app.language')}
          onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
          w={56}
        >
          <Group gap={2}>
            <IconLanguage size={16} />
            <Text size="xs" fw={700}>
              {lang === 'ru' ? 'RU' : 'EN'}
            </Text>
          </Group>
        </ActionIcon>
        <ActionIcon
          variant="default"
          size="lg"
          aria-label={t('app.theme')}
          onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
        >
          {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
        </ActionIcon>
      </Group>
    </Group>
  );
}

function PlusMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Menu position="top" withArrow shadow="md">
      <Menu.Target>
        <a className="plus" href="#" onClick={(e) => e.preventDefault()} aria-label={t('nav.add')}>
          <ActionIcon component="span" radius="xl" size={44} variant="filled">
            <IconPlus />
          </ActionIcon>
        </a>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => navigate('/orders/new')}>
          {t('nav.newOrder')}
        </Menu.Item>
        <Menu.Item leftSection={<IconReceipt size={16} />} onClick={() => navigate('/money?tab=expenses&add=1')}>
          {t('nav.expense')}
        </Menu.Item>
        <Menu.Item leftSection={<IconCash size={16} />} onClick={() => navigate('/money?tab=cash')}>
          {t('nav.cash')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

const SIDE = [
  { to: '/', icon: IconLayoutKanban, key: 'nav.board', end: true },
  { to: '/search', icon: IconSearch, key: 'nav.search' },
  { to: '/orders/new', icon: IconPlus, key: 'nav.newOrder' },
  { to: '/customers', icon: IconUsers, key: 'nav.customers' },
  { to: '/parts', icon: IconPackage, key: 'nav.parts' },
  { to: '/money', icon: IconCash, key: 'nav.money' },
  { to: '/reports', icon: IconChartBar, key: 'nav.reports' },
  { to: '/parts?tab=suppliers', icon: IconTruck, key: 'nav.suppliers' },
  { to: '/settings', icon: IconSettings, key: 'nav.settings' },
];

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
  const mobile = useMediaQuery('(max-width: 48em)', true, { getInitialValueInEffect: false });
  const [navOpen, { toggle, close }] = useDisclosure(false);
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !navOpen } }}
      footer={{ height: 64, collapsed: !mobile }}
      padding="md"
    >
      <AppShell.Header>
        <TopBar burger={!mobile ? null : <Burger opened={navOpen} onClick={toggle} size="sm" hiddenFrom="sm" aria-label="menu" />} />
      </AppShell.Header>
      <AppShell.Navbar p="xs" className="side-nav">
        {SIDE.map((s) => (
          <MNavLink
            key={s.to}
            component={NavLink}
            to={s.to}
            end={s.end}
            label={t(s.key)}
            leftSection={<s.icon size={18} />}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main style={{ maxWidth: 1400 }}>
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
      </AppShell.Main>
      <AppShell.Footer>
        <nav className="bottom-nav" style={{ display: 'flex', height: '100%', alignItems: 'center' }}>
          <NavLink to="/" end>
            <IconLayoutKanban size={22} />
            {t('nav.board')}
          </NavLink>
          <NavLink to="/search">
            <IconSearch size={22} />
            {t('nav.search')}
          </NavLink>
          <PlusMenu />
          <NavLink to="/money">
            <IconCash size={22} />
            {t('nav.money')}
          </NavLink>
          <NavLink to="/more">
            <IconDots size={22} />
            {t('nav.more')}
          </NavLink>
        </nav>
      </AppShell.Footer>
    </AppShell>
  );
}

export function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-center" />
      <HashRouter>
        <Shell />
      </HashRouter>
    </MantineProvider>
  );
}
