import { Alert, NavLink, Paper, Stack, Text } from '@mantine/core';
import { IconCash, IconChartBar, IconPackage, IconSettings, IconTruck, IconUsers } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../ui/components';

export function MorePage() {
  const { t } = useTranslation();
  const links = [
    { to: '/customers', icon: IconUsers, label: t('nav.customers') },
    { to: '/parts', icon: IconPackage, label: t('nav.parts') },
    { to: '/parts?tab=suppliers', icon: IconTruck, label: t('nav.suppliers') },
    { to: '/money', icon: IconCash, label: t('nav.money') },
    { to: '/reports', icon: IconChartBar, label: t('nav.reports') },
    { to: '/settings', icon: IconSettings, label: t('nav.settings') },
  ];
  return (
    <>
      <PageHeader title={t('nav.more')} />
      <Paper withBorder>
        {links.map((l) => (
          <NavLink key={l.to} component={Link} to={l.to} label={l.label} leftSection={<l.icon size={20} />} py="md" />
        ))}
      </Paper>
      <Stack mt="md">
        <Alert color="blue" title={t('more.localTitle')}>
          <Text size="sm">{t('more.localText')}</Text>
        </Alert>
      </Stack>
    </>
  );
}
