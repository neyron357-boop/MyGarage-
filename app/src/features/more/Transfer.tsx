import { Button, FileButton, Modal, Stack, Text } from '@mantine/core';
import { IconDeviceDesktop, IconDeviceMobile, IconDownload, IconShare, IconUpload } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dubaiDate } from '../../domain/dates';
import { exportBackup, markBackupDone } from '../../services/backup';
import { haptic } from '../../ui/haptics';
import { useLang } from '../../ui/hooks';
import { canShareFile, downloadFile } from '../../ui/share';
import { RestoreModal } from '../settings/RestoreModal';

/** "3,4 МБ" / "3.4 MB": the size in the interface's own number format. */
function size(bytes: number, lang: string): string {
  const mb = bytes / 1024 / 1024;
  const n = (x: number, digits: number) => x.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: digits });
  return mb >= 1 ? `${n(mb, mb >= 10 ? 0 : 1)} ${lang === 'ru' ? 'МБ' : 'MB'}` : `${Math.max(1, Math.round(bytes / 1024))} ${lang === 'ru' ? 'КБ' : 'KB'}`;
}

/**
 * Moving the garage between the iPhone and the computer: "Send" makes one file of everything (jobs,
 * photos, money) and hands it to the phone's share sheet — AirDrop to a Mac, Telegram or WhatsApp to
 * oneself, Files; "Receive" on the other device takes that file in place of its own data. The app keeps
 * its data on each device (no cloud yet), so the file is how it travels — and it is a backup too.
 */
export function TransferSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [file, setFile] = useState<File>();
  const [incoming, setIncoming] = useState<File | null>(null);
  // The file is made as the sheet opens: iOS shares only straight from the tap.
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setFile(undefined);
    void exportBackup().then((blob) => alive && setFile(new File([blob], `mygarage-${dubaiDate()}.mygarage`, { type: 'application/octet-stream' })));
    return () => {
      alive = false;
    };
  }, [opened]);
  const send = () => {
    if (!file) return;
    haptic('light');
    if (canShareFile(file))
      navigator
        .share({ files: [file] })
        .then(() => markBackupDone())
        .catch((e: unknown) => (e as Error)?.name !== 'AbortError' && (downloadFile(file), markBackupDone()));
    else {
      downloadFile(file);
      markBackupDone();
    }
  };
  return (
    <>
      <Modal opened={opened} onClose={onClose} title={t('transfer.title')}>
        <Stack gap="md">
          <div className="transfer-art" aria-hidden>
            <IconDeviceMobile size={34} stroke={1.5} />
            <span className="transfer-dots" />
            <IconDeviceDesktop size={38} stroke={1.5} />
          </div>
          <Button size="lg" leftSection={canShareFile(file) ? <IconShare size={20} /> : <IconDownload size={20} />} loading={!file} onClick={send}>
            {file ? t('transfer.send', { size: size(file.size, lang) }) : t('transfer.send', { size: '' })}
          </Button>
          <FileButton onChange={(f) => f && setIncoming(f)} accept=".mygarage,application/octet-stream,application/json">
            {(props) => (
              <Button size="lg" variant="default" leftSection={<IconUpload size={20} />} {...props}>
                {t('transfer.receive')}
              </Button>
            )}
          </FileButton>
          <Text size="sm" c="dimmed" ta="center">
            {t('transfer.note')}
          </Text>
        </Stack>
      </Modal>
      <RestoreModal file={incoming} onClose={() => setIncoming(null)} title={t('transfer.confirmTitle')} confirmLabel={t('transfer.replace')} text={t('transfer.confirmText', { name: incoming?.name ?? '' })} />
    </>
  );
}
