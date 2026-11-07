import { ActionIcon, Box, Button, Collapse, Group, Progress, SimpleGrid, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconBuildingStore, IconCheck, IconChevronDown, IconCloudDownload, IconDeviceMobile, IconListDetails, IconLockOpen, IconUsers, IconX, type Icon } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate } from '../../domain/dates';
import { saveBackupFile } from '../../services/backup';
import { PLACEHOLDER_STAFF } from '../../services/seed';
import { useAction, useSettings } from '../../ui/hooks';
import { insecureContext, useBackupAge } from '../../ui/device';
import { useInstall } from '../../ui/pwa';

const DISMISS_KEY = 'mygarage.setupDismissed';

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * First-run checklist: what to fill in before the first real customer. Open on an empty garage,
 * folded into one line once there is work on the board.
 */
export function SetupChecklist({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const s = useSettings();
  const install = useInstall();
  const staffDefault = useLiveQuery(async () => (await db.employees.toArray()).some((e) => PLACEHOLDER_STAFF.test(e.name)), []);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [open, setOpen] = useState(!compact);
  if (!s || staffDefault === undefined || dismissed) return null;
  const items: { key: string; icon: Icon; done: boolean; to?: string; action?: () => void }[] = [
    { key: 'garage', icon: IconBuildingStore, done: s.name.trim() !== 'MyGarage' && !!s.phone.trim() && !!s.address.trim(), to: '/settings?tab=business' },
    { key: 'staff', icon: IconUsers, done: !staffDefault, to: '/settings?tab=staff' },
    { key: 'prices', icon: IconListDetails, done: !!s.pricesReviewed, to: '/settings?tab=prices' },
    { key: 'install', icon: IconDeviceMobile, done: install.standalone, to: '/settings?tab=data' },
  ];
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  return (
    <Box className="surface rise-enter" p="md" mb="lg">
      <Group justify="space-between" wrap="nowrap" align="flex-start" mb={open ? 'xs' : 0}>
        <UnstyledButton onClick={() => setOpen((o) => !o)} style={{ flex: 1, minWidth: 0 }} aria-expanded={open}>
          <Group gap={6} wrap="nowrap">
            <Text fw={700}>{t('setup.title')}</Text>
            <IconChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 200ms ease', flexShrink: 0 }} />
          </Group>
          <Text size="xs" c="dimmed">
            {t('setup.hint', { done, total: items.length })}
          </Text>
        </UnstyledButton>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={t('common.close')}
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(DISMISS_KEY, '1');
            } catch {
              // ignore
            }
          }}
        >
          <IconX size={18} />
        </ActionIcon>
      </Group>
      <Progress value={(done / items.length) * 100} size="sm" mb={open ? 'sm' : 0} mt={open ? 0 : 'xs'} color={done === items.length ? 'green' : 'cobalt'} />
      <Collapse in={open}>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing={0} verticalSpacing={0} className="stagger">
        {items.map((i) => (
          <Group
            key={i.key}
            gap="sm"
            wrap="nowrap"
            py={8}
            className="setup-row"
            data-done={i.done}
            role="button"
            tabIndex={0}
            onClick={() => (i.action ? i.action() : i.to && navigate(i.to))}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && i.to && navigate(i.to)}
          >
            <ThemeIcon size={32} radius="xl" variant={i.done ? 'filled' : 'light'} color={i.done ? 'green' : 'cobalt'}>
              {i.done ? <IconCheck size={17} stroke={3} /> : <i.icon size={17} />}
            </ThemeIcon>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" fw={600} td={i.done ? 'line-through' : undefined} c={i.done ? 'dimmed' : undefined}>
                {t(`setup.${i.key}`)}
              </Text>
              {!i.done && (
                <Text size="xs" c="dimmed" lh={1.35}>
                  {t(`setup.${i.key}Hint`)}
                </Text>
              )}
            </div>
          </Group>
        ))}
      </SimpleGrid>
      </Collapse>
    </Box>
  );
}

/** One-tap backup when the last one is older than a week. */
export function BackupReminder() {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const backup = useBackupAge();
  const hasOrders = useLiveQuery(async () => (await db.orders.count()) > 0, []);
  if (!hasOrders || !backup.due) return null;
  return (
    <Group className="surface rise-enter" p="sm" pl="md" mb="lg" gap="sm" wrap="nowrap">
      <ThemeIcon variant="light" color="orange" radius="xl" size={36}>
        <IconCloudDownload size={19} />
      </ThemeIcon>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={700}>
          {backup.at ? t('backupReminder.title', { days: backup.days }) : t('backupReminder.never')}
        </Text>
        <Text size="xs" c="dimmed">
          {t('backupReminder.text')}
        </Text>
      </div>
      <Button size="compact-md" variant="light" color="orange" loading={busy} onClick={() => run(() => saveBackupFile(`mygarage-backup-${dubaiDate()}.mygarage`), 'settings.backupDone')}>
        {t('backupReminder.action')}
      </Button>
    </Group>
  );
}

export function InsecureWarning() {
  const { t } = useTranslation();
  if (!insecureContext()) return null;
  return (
    <Group className="surface" p="sm" pl="md" mb="lg" gap="sm" wrap="nowrap">
      <ThemeIcon variant="light" color="yellow" radius="xl" size={36}>
        <IconLockOpen size={19} />
      </ThemeIcon>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={700}>
          {t('insecure.title')}
        </Text>
        <Text size="xs" c="dimmed">
          {t('insecure.text')}
        </Text>
      </div>
    </Group>
  );
}

