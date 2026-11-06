import { Alert, SimpleGrid, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconCash, IconChartBar, IconPackage, IconSettings, IconTruck, IconUsers, type Icon } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../ui/components';

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
  return (
    <>
      <PageHeader title={t('nav.more')} />
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
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
      <Alert mt="xl" color="cobalt" title={t('more.localTitle')}>
        <Text size="sm">{t('more.localText')}</Text>
      </Alert>
    </>
  );
}
