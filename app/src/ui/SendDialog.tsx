import { Button, Group, Modal, SegmentedControl, Stack, Text, Textarea } from '@mantine/core';
import { IconBrandTelegram, IconBrandWhatsapp, IconCheck, IconCopy, IconShare } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channel, Customer, Lang } from '../domain/types';
import { logMessage, telegramUrl, whatsappUrl } from '../services/messages';

export interface SendRequest {
  text: string;
  template: string;
  lang: Lang;
  orderId?: string;
  /** Optional PDF that can be shared as a file (phone share sheet). */
  pdf?: () => Promise<{ blob: Blob; filename: string }>;
}

export function SendDialog({
  customer,
  request,
  onClose,
  onSent,
}: {
  customer: Customer;
  request: SendRequest | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [channel, setChannel] = useState<Channel>(customer.preferredChannel === 'telegram' ? 'telegram' : 'whatsapp');
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);

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
    await logMessage({ orderId: request.orderId, customerId: customer.id, channel, template: request.template, language: request.lang, text });
    onSent?.();
    onClose();
  };

  const shareFile = async () => {
    if (!request.pdf) return;
    const { blob, filename } = await request.pdf();
    const file = new File([blob], filename, { type: blob.type });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      setOpened(true);
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    }
  };

  return (
    <Modal opened={!!request} onClose={onClose} title={t('send.title')} size="lg">
      <Stack>
        <SegmentedControl
          value={channel}
          onChange={(v) => setChannel(v as Channel)}
          data={[
            { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'telegram', label: 'Telegram' },
          ]}
        />
        <Text size="sm" c="dimmed">
          {t('send.to', { name: customer.name, phone })} · {t(`lang.${request.lang}`)}
        </Text>
        <Textarea value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={6} maxRows={16} />
        <Stack gap="xs">
          <Button
            fullWidth
            component="a"
            href={url}
            target="_blank"
            rel="noopener"
            color={channel === 'whatsapp' ? 'green' : 'blue'}
            leftSection={channel === 'whatsapp' ? <IconBrandWhatsapp /> : <IconBrandTelegram />}
            onClick={() => setOpened(true)}
          >
            {t('send.open')}
          </Button>
          <Button
            fullWidth
            variant="default"
            leftSection={copied ? <IconCheck /> : <IconCopy />}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setOpened(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
        </Stack>
        {request.pdf && (
          <Button variant="light" leftSection={<IconShare />} onClick={shareFile}>
            {t('send.sharePdf')}
          </Button>
        )}
        {opened && (
          <Group justify="space-between" p="sm" bg="var(--mantine-color-default-hover)" style={{ borderRadius: 8 }}>
            <Text size="sm">{t('send.wasSent')}</Text>
            <Group gap="xs">
              <Button size="xs" variant="default" onClick={() => setOpened(false)}>
                {t('common.no')}
              </Button>
              <Button size="xs" onClick={confirm}>
                {t('send.yesSent')}
              </Button>
            </Group>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
