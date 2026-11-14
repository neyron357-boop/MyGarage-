import { Box, Progress, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconUpload } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../domain/dates';
import { backupSummary, importBackup, type BackupSummary, type RestoreResult } from '../../services/backup';
import { ConfirmModal } from '../../ui/components';
import { formatBytes } from '../../ui/device';
import { useAction, useLang } from '../../ui/hooks';

const REPORT_KEY = 'mygarage.restored';

/**
 * "Replace the data?" for a backup file (Settings → Data, and moving to another device): what the file
 * holds — orders and photos, read before anything is replaced (no photos in it — said in orange) — then the
 * photos as they come back, and after the reload what came back (`useRestoreReport`).
 */
export function RestoreModal({ file, onClose, title, confirmLabel, text }: { file: File | null; onClose: () => void; title: string; confirmLabel: string; text: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run } = useAction();
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  useEffect(() => {
    setSummary(null);
    setProgress(null);
    if (!file) return;
    let alive = true;
    // A file that is not a backup says so when it is restored; here it only shows no summary.
    backupSummary(file)
      .then((s) => alive && setSummary(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [file]);
  return (
    <ConfirmModal
      opened={!!file}
      onClose={onClose}
      title={title}
      confirmLabel={confirmLabel}
      color="red"
      icon={<IconUpload size={18} />}
      onConfirm={() =>
        run(async () => {
          if (!file) return false;
          const result = await importBackup(file, (done, total) => setProgress([done, total]));
          saveReport(result);
          window.location.reload();
          return true;
        })
      }
    >
      <Box className="surface-soft" p="sm" mb="sm">
        <Text size="sm" fw={600} style={{ wordBreak: 'break-all' }}>
          {file?.name}
        </Text>
        <Text size="xs" c="dimmed">
          {[file ? formatBytes(file.size, lang) : '', summary?.exportedAt ? formatDate(summary.exportedAt) : ''].filter(Boolean).join(' · ')}
        </Text>
        {summary && (
          <Text size="sm" mt={6} c={summary.files ? undefined : 'orange.7'} fw={summary.files ? undefined : 600}>
            {summary.files ? t('settings.restoreHolds', { orders: summary.orders, files: summary.files }) : t('settings.restoreNoFiles', { orders: summary.orders })}
          </Text>
        )}
      </Box>
      {progress && progress[1] > 0 ? (
        <Box mb="sm">
          <Text size="sm" mb={6} className="tnum">
            {t('settings.restoreProgress', { done: progress[0], total: progress[1] })}
          </Text>
          <Progress value={(progress[0] / progress[1]) * 100} size="sm" radius="xl" color="cobalt" />
        </Box>
      ) : null}
      <Text size="sm">{text}</Text>
    </ConfirmModal>
  );
}

function saveReport(r: RestoreResult) {
  try {
    sessionStorage.setItem(REPORT_KEY, JSON.stringify(r));
  } catch {
    // no storage: the reload shows the data anyway
  }
}

/** After a restore and its reload: one banner says what came back (and how many files did not). */
export function useRestoreReport() {
  const { t } = useTranslation();
  useEffect(() => {
    // Read when it is shown (not when the effect first runs): an effect run twice must not lose it.
    const timer = window.setTimeout(() => {
      let report: RestoreResult | undefined;
      try {
        const raw = sessionStorage.getItem(REPORT_KEY);
        sessionStorage.removeItem(REPORT_KEY);
        if (raw) report = JSON.parse(raw) as RestoreResult;
      } catch {
        return;
      }
      if (!report) return;
      notifications.show({
        color: report.lost ? 'orange' : 'green',
        title: t('settings.restoredTitle'),
        message: [t('settings.restoredText', { orders: report.orders, files: report.files }), report.lost ? t('settings.restoreLost', { n: report.lost }) : ''].filter(Boolean).join(' · '),
        autoClose: report.lost ? 9000 : 5000,
      });
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
