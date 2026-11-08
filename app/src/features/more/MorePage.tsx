import { Box, Text } from '@mantine/core';
import { IconCash, IconChartBar, IconCloudDownload, IconPackage, IconSettings, IconShieldCheck, IconTruck, IconUsers, type Icon } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { AppearanceRows } from '../../ui/Appearance';
import { List, ListRow, PageHeader } from '../../ui/components';
import { useBackupAge } from '../../ui/device';

/** iOS Settings colours for the row icons. */
const LINKS: { to: string; icon: Icon; label: string; hint: string; bg: string }[] = [
  { to: '/customers', icon: IconUsers, label: 'nav.customers', hint: 'more.customersHint', bg: '#007aff' },
  { to: '/parts', icon: IconPackage, label: 'nav.parts', hint: 'more.partsHint', bg: '#ff9500' },
  { to: '/parts?tab=suppliers', icon: IconTruck, label: 'nav.suppliers', hint: 'more.suppliersHint', bg: '#8e8e93' },
  { to: '/money', icon: IconCash, label: 'nav.money', hint: 'more.moneyHint', bg: '#34c759' },
  { to: '/reports', icon: IconChartBar, label: 'nav.reports', hint: 'more.reportsHint', bg: '#5856d6' },
  { to: '/settings', icon: IconSettings, label: 'nav.settings', hint: 'more.settingsHint', bg: '#8e8e93' },
];

export function MorePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backup = useBackupAge();
  return (
    <>
      <PageHeader title={t('nav.more')} />
      <List>
        {LINKS.map((l) => (
          <ListRow
            key={l.to}
            left={
              <span className="row-icon" style={{ background: l.bg }}>
                <l.icon size={19} stroke={2} />
              </span>
            }
            title={t(l.label)}
            subtitle={t(l.hint)}
            onClick={() => navigate(l.to)}
            chevron
          />
        ))}
      </List>
      <Box mt="lg">
        <List>
          <ListRow
            left={
              <span className="row-icon" style={{ background: backup.due ? '#ff9500' : '#34c759' }}>
                {backup.due ? <IconCloudDownload size={19} stroke={2} /> : <IconShieldCheck size={19} stroke={2} />}
              </span>
            }
            title={t('more.localTitle')}
            subtitle={backup.at ? t('settings.lastBackup', { date: formatDateTime(backup.at) }) : t('backupReminder.never')}
            onClick={() => navigate('/settings?tab=data')}
            chevron
          />
        </List>
      </Box>
      <AppearanceRows />
      <Text size="xs" c="dimmed" ta="center" mt="xl" className="tnum">
        MyGarage {__APP_VERSION__} · {formatDate(__BUILD_DATE__)}
      </Text>
    </>
  );
}
