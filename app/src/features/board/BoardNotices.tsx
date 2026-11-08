import { ActionIcon, Box, Button, Collapse, Group, Progress, SimpleGrid, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconBuildingStore, IconCheck, IconChevronDown, IconCloudDownload, IconDeviceMobile, IconListCheck, IconListDetails, IconLockOpen, IconUsers, IconX, type Icon } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate } from '../../domain/dates';
import { saveBackupFile } from '../../services/backup';
import { PLACEHOLDER_STAFF } from '../../services/seed';
import { Tip } from '../../ui/components';
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
    // Laid out like a tip (iOS TipKit): symbol, title, message with the progress; the header folds it.
    <Box className="tip surface rise-enter" pb="md">
      <div className="tip-main" style={{ paddingBottom: open ? 10 : 0 }}>
        <span className="tip-icon" style={{ color: 'var(--mantine-color-cobalt-6)' }} aria-hidden>
          <IconListCheck size={30} stroke={1.6} />
        </span>
        <UnstyledButton className="tip-text" style={{ textAlign: 'left' }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <div className="tip-title">{t('setup.title')}</div>
          <Group gap={4} wrap="nowrap" className="tip-body" align="center">
            <span style={{ minWidth: 0 }}>{t('setup.hint', { done, total: items.length })}</span>
            <IconChevronDown size={16} stroke={2.4} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 240ms var(--ease-ios)', flexShrink: 0 }} />
          </Group>
          <Progress value={(done / items.length) * 100} size={5} mt={10} color={done === items.length ? 'green' : 'cobalt'} />
        </UnstyledButton>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={30}
          className="tip-close"
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
          <IconX size={16} stroke={2.4} />
        </ActionIcon>
      </div>
      <Collapse in={open}>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing={0} verticalSpacing={0} className="stagger" ml={42}>
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

/** One-tap backup when the last one is older than a week (a tip, like iOS TipKit). */
export function BackupReminder() {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const backup = useBackupAge();
  const hasOrders = useLiveQuery(async () => (await db.orders.count()) > 0, []);
  if (!hasOrders || !backup.due) return null;
  return (
    <Tip
      icon={IconCloudDownload}
      color="orange"
      title={backup.at ? t('backupReminder.title', { days: backup.days }) : t('backupReminder.never')}
      actions={
        <Button variant="subtle" loading={busy} onClick={() => run(() => saveBackupFile(`mygarage-backup-${dubaiDate()}.mygarage`), 'settings.backupDone')}>
          {t('backupReminder.action')}
        </Button>
      }
    >
      {t('backupReminder.text')}
    </Tip>
  );
}

export function InsecureWarning() {
  const { t } = useTranslation();
  if (!insecureContext()) return null;
  return (
    <Tip icon={IconLockOpen} color="yellow" title={t('insecure.title')}>
      {t('insecure.text')}
    </Tip>
  );
}

