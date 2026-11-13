import { Box, Image, Text } from '@mantine/core';
import { IconCash, IconChartBar, IconChevronRight, IconCloudDownload, IconDevices, IconPackage, IconSettings, IconShieldCheck, IconTool, IconTruck, IconUsers, type Icon } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { AppearanceRows } from '../../ui/Appearance';
import { List, ListRow, PageHeader } from '../../ui/components';
import { useScreenLiveQuery } from '../../ui/hooks';
import { getSettings } from '../../services/settings';
import { useBackupAge } from '../../ui/device';
import { SetupChecklist } from '../board/BoardNotices';
import { TransferSheet } from './Transfer';

/** Row icons on squircles of the iOS palette (iOS Settings). */
const LINKS: { to: string; icon: Icon; label: string; hint: string; color: string }[] = [
  { to: '/customers', icon: IconUsers, label: 'nav.customers', hint: 'more.customersHint', color: 'blue' },
  { to: '/parts', icon: IconPackage, label: 'nav.parts', hint: 'more.partsHint', color: 'orange' },
  { to: '/parts?tab=suppliers', icon: IconTruck, label: 'nav.suppliers', hint: 'more.suppliersHint', color: 'cyan' },
  { to: '/money', icon: IconCash, label: 'nav.money', hint: 'more.moneyHint', color: 'green' },
  { to: '/reports', icon: IconChartBar, label: 'nav.reports', hint: 'more.reportsHint', color: 'indigo' },
  { to: '/settings', icon: IconSettings, label: 'nav.settings', hint: 'more.settingsHint', color: 'gray' },
];

// Symbols on squircles take the bright iOS shade (the deep "filled" one is for white words on buttons).
const tint = (color: string) => ({ background: `var(--mantine-color-${color}-6)` });

/** The garage itself on top, like the account card of the iPhone's Settings: its logo and name, a tap to its details. */
function GarageCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useScreenLiveQuery(() => getSettings(), []);
  if (!settings) return null;
  return (
    <button type="button" className="garage-card tap" onClick={() => navigate('/settings')}>
      <span className="garage-logo">
        {settings.logoDataUrl ? <Image src={settings.logoDataUrl} alt="" fit="contain" w={52} h={52} /> : <IconTool size={28} stroke={1.8} aria-hidden />}
      </span>
      <span className="garage-name">
        <span>{settings.name || 'MyGarage'}</span>
        <span className="garage-sub">{t('nav.settings')}</span>
      </span>
      <IconChevronRight size={20} className="garage-chevron" aria-hidden />
    </button>
  );
}

export function MorePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backup = useBackupAge();
  const [transfer, setTransfer] = useState(false);
  return (
    <>
      <PageHeader title={t('nav.more')} />
      <GarageCard />
      <SetupChecklist compact />
      <List>
        {LINKS.map((l) => (
          <ListRow
            key={l.to}
            left={
              <span className="row-icon" style={tint(l.color)}>
                <l.icon size={19} stroke={2} />
              </span>
            }
            title={t(l.label)}
            onClick={() => navigate(l.to)}
            chevron
          />
        ))}
      </List>
      <Box mt="lg">
        <List>
          <ListRow
            left={
              <span className="row-icon" style={tint(backup.due ? 'orange' : 'green')}>
                {backup.due ? <IconCloudDownload size={19} stroke={2} /> : <IconShieldCheck size={19} stroke={2} />}
              </span>
            }
            title={t('more.localTitle')}
            subtitle={backup.at ? t('settings.lastBackup', { date: formatDateTime(backup.at) }) : t('backupReminder.never')}
            onClick={() => navigate('/settings?tab=data')}
            chevron
          />
          <ListRow
            left={
              <span className="row-icon" style={tint('cyan')}>
                <IconDevices size={19} stroke={2} />
              </span>
            }
            title={t('transfer.row')}
            onClick={() => setTransfer(true)}
            chevron
          />
        </List>
      </Box>
      <TransferSheet opened={transfer} onClose={() => setTransfer(false)} />
      <AppearanceRows />
      <Text size="xs" c="dimmed" ta="center" mt="xl" className="tnum selectable">
        MyGarage {__APP_VERSION__} · {formatDate(__BUILD_DATE__)}
      </Text>
    </>
  );
}
