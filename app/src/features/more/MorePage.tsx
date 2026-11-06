import { Group, SimpleGrid, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconCash, IconChartBar, IconChevronRight, IconCloudDownload, IconPackage, IconSettings, IconShieldCheck, IconTruck, IconUsers, type Icon } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { PageHeader } from '../../ui/components';
import { useBackupAge } from '../../ui/device';

const LINKS: { to: string; icon: Icon; label: string; hint: string; color: string }[] = [
  { to: '/customers', icon: IconUsers, label: 'nav.customers', hint: 'more.customersHint', color: 'cobalt' },
  { to: '/parts', icon: IconPackage, label: 'nav.parts', hint: 'more.partsHint', color: 'orange' },
  { to: '/parts?tab=suppliers', icon: IconTruck, label: 'nav.suppliers', hint: 'more.suppliersHint', color: 'gray' },
  { to: '/money', icon: IconCash, label: 'nav.money', hint: 'more.moneyHint', color: 'green' },
  { to: '/reports', icon: IconChartBar, label: 'nav.reports', hint: 'more.reportsHint', color: 'violet' },
  { to: '/settings', icon: IconSettings, label: 'nav.settings', hint: 'more.settingsHint', color: 'gray' },
];

export function MorePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backup = useBackupAge();
  return (
    <>
      <PageHeader title={t('nav.more')} />
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm" className="stagger">
        {LINKS.map((l) => (
          <UnstyledButton key={l.to} className="surface tap" p="md" onClick={() => navigate(l.to)}>
            <Stack gap={10}>
              <ThemeIcon variant="light" color={l.color} size={44} radius="md">
                <l.icon size={24} stroke={1.7} />
              </ThemeIcon>
              <div>
                <Text fw={700}>{t(l.label)}</Text>
                <Text size="xs" c="dimmed" mt={2} lh={1.35}>
                  {t(l.hint)}
                </Text>
              </div>
            </Stack>
          </UnstyledButton>
        ))}
      </SimpleGrid>
      <UnstyledButton className="surface tap" p="md" mt="lg" w="100%" onClick={() => navigate('/settings?tab=data')}>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" color={backup.due ? 'orange' : 'green'} size={40} radius="xl">
            {backup.due ? <IconCloudDownload size={21} /> : <IconShieldCheck size={21} />}
          </ThemeIcon>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text fw={700} size="sm">
              {t('more.localTitle')}
            </Text>
            <Text size="xs" c="dimmed" lh={1.4}>
              {backup.at ? t('settings.lastBackup', { date: formatDateTime(backup.at) }) : t('backupReminder.never')}
            </Text>
          </div>
          <IconChevronRight size={18} color="var(--mantine-color-dimmed)" />
        </Group>
      </UnstyledButton>
      <Text size="xs" c="dimmed" ta="center" mt="xl" className="tnum">
        MyGarage {__APP_VERSION__} · {formatDate(__BUILD_DATE__)}
      </Text>
    </>
  );
}
