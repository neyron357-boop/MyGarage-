import { Box, Button, Group, Modal, SimpleGrid, Stack, Text, Textarea } from '@mantine/core';
import { IconBrandTelegram, IconBrandWhatsapp, IconCheck, IconCopy, IconPhoto, IconShare } from '@tabler/icons-react';
import { mediaBlob } from '../services/media';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPhone } from '../domain/phone';
import type { Channel, Customer, Lang } from '../domain/types';
import { notifications } from '@mantine/notifications';
import { downloadBlob } from '../services/backup';
import { copyText } from './clipboard';
import { haptic } from './haptics';
import { logMessage, telegramUrl, whatsappUrl } from '../services/messages';
import { SelectCard } from './components';
import { useErrorText } from './hooks';

export interface SendRequest {
  text: string;
  template: string;
  lang: Lang;
  orderId?: string;
  /** Optional PDF that can be shared as a file (phone share sheet). */
  pdf?: () => Promise<{ blob: Blob; filename: string }>;
  /** Done once the message really went ("Yes, sent"): an estimate is frozen only then. */
  onConfirm?: () => Promise<unknown>;
  /** Photos that go with the text (what was found, what was done): shared together from the phone. */
  photos?: string[];
}

/** The photos as files, ready before the tap (iOS shares only straight from a tap). */
function usePhotoFiles(ids: string[] | undefined) {
  const [files, setFiles] = useState<File[]>([]);
  const key = (ids ?? []).join(',');
  useEffect(() => {
    let alive = true;
    setFiles([]);
    if (!ids?.length) return;
    void Promise.all(ids.map(async (id, n) => {
      const blob = await mediaBlob(id);
      return blob ? new File([blob], `photo-${n + 1}.${blob.type.includes('png') ? 'png' : 'jpg'}`, { type: blob.type || 'image/jpeg' }) : undefined;
    })).then((list) => alive && setFiles(list.filter((f): f is File => !!f)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return files;
}

export function SendDialog({ customer, request, onClose, onSent }: { customer: Customer; request: SendRequest | null; onClose: () => void; onSent?: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [text, setText] = useState('');
  const [channel, setChannel] = useState<Channel>(customer.preferredChannel === 'telegram' ? 'telegram' : 'whatsapp');
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const files = usePhotoFiles(request?.photos);
  const canSharePhotos = files.length > 0 && typeof navigator.canShare === 'function' && navigator.canShare({ files });

  useEffect(() => {
    if (request) {
      setText(request.text);
      setOpened(false);
      setCopied(false);
    }
  }, [request]);

  if (!request) return null;
  const phone = customer.whatsapp || customer.phone;
  const url = channel === 'whatsapp' ? whatsappUrl(phone, text) : telegramUrl(text);

  const confirm = async () => {
    try {
      await request.onConfirm?.();
    } catch (e) {
      notifications.show({ color: 'red', message: errorText(e) });
      return;
    }
    await logMessage({ orderId: request.orderId, customerId: customer.id, channel, template: request.template, language: request.lang, text });
    haptic('light');
    notifications.show({ color: 'green', message: t('send.logged') });
    onSent?.();
    onClose();
  };

  const shareFile = async () => {
    if (!request.pdf) return;
    setSharing(true);
    let pdf: { blob: Blob; filename: string };
    try {
      pdf = await request.pdf();
    } finally {
      setSharing(false);
    }
    const { blob, filename } = pdf;
    const file = new File([blob], filename, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (!nav.canShare?.({ files: [file] })) throw new Error('share unavailable');
      await navigator.share({ files: [file], text });
      setOpened(true);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      await downloadBlob(blob, filename).catch(() => undefined);
    }
  };

  /** The text with the photos, through the phone's share sheet (WhatsApp takes both). */
  const sharePhotos = () => {
    navigator
      .share({ files, text })
      .then(() => setOpened(true))
      .catch(() => undefined);
  };

  return (
    <Modal opened={!!request} onClose={onClose} title={t('send.title')} size="lg">
      <Stack gap="md">
        <SimpleGrid cols={2} spacing="xs">
          <SelectCard active={channel === 'whatsapp'} onClick={() => setChannel('whatsapp')}>
            <Group gap={8} wrap="nowrap">
              <IconBrandWhatsapp size={22} color="var(--mantine-color-green-6)" />
              <Text fw={700} size="sm">
                WhatsApp
              </Text>
            </Group>
          </SelectCard>
          <SelectCard active={channel === 'telegram'} onClick={() => setChannel('telegram')}>
            <Group gap={8} wrap="nowrap">
              <IconBrandTelegram size={22} color="var(--mantine-color-cobalt-5)" />
              <Text fw={700} size="sm">
                Telegram
              </Text>
            </Group>
          </SelectCard>
        </SimpleGrid>
        <Text size="sm" c="dimmed">
          {[customer.name || t('customer.noName'), phone ? formatPhone(phone) : ''].filter(Boolean).join(', ')} · {t(`lang.${request.lang}`)}
        </Text>
        <Box p="sm" style={{ background: channel === 'whatsapp' ? 'var(--mantine-color-green-light)' : 'var(--mantine-color-cobalt-light)', borderRadius: '14px 14px 4px 14px' }}>
          <Textarea value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={5} maxRows={14} variant="unstyled" styles={{ input: { fontSize: 14, lineHeight: 1.45 } }} />
        </Box>
        <Stack gap="xs">
          <Button
            fullWidth
            size="md"
            component="a"
            href={url}
            target="_blank"
            rel="noopener"
            color={channel === 'whatsapp' ? 'green' : 'cobalt'}
            leftSection={channel === 'whatsapp' ? <IconBrandWhatsapp size={20} /> : <IconBrandTelegram size={20} />}
            onClick={() => setOpened(true)}
          >
            {t('send.open')}
          </Button>
          {canSharePhotos && (
            // The text and the photos together, through the phone's share sheet (WhatsApp takes both).
            <Button fullWidth size="md" variant="default" leftSection={<IconPhoto size={20} />} onClick={sharePhotos}>
              {t('send.withPhotos', { n: files.length })}
            </Button>
          )}
          <Group grow gap="xs">
            <Button
              variant="default"
              leftSection={copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
              onClick={async () => {
                const ok = await copyText(text);
                setCopied(ok);
                if (ok) {
                  haptic('selection');
                  setOpened(true);
                }
              }}
            >
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
            {request.pdf && (
              <Button variant="default" leftSection={<IconShare size={18} />} onClick={shareFile} loading={sharing}>
                {t('send.pdfShort')}
              </Button>
            )}
          </Group>
        </Stack>
        {opened && (
          <Group justify="space-between" p="sm" className="surface-soft rise-enter" wrap="nowrap">
            <Text size="sm" fw={600}>
              {t('send.wasSent')}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Button size="compact-md" variant="default" onClick={() => setOpened(false)}>
                {t('common.no')}
              </Button>
              <Button size="compact-md" onClick={confirm}>
                {t('send.yesSent')}
              </Button>
            </Group>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
