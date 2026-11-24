import { Box, Button, Group, Modal, SimpleGrid, Stack, Text, Textarea } from '@mantine/core';
import { IconBrandTelegram, IconBrandWhatsapp, IconCheck, IconCopy, IconPhoto, IconShare, IconUserShield } from '@tabler/icons-react';
import { mediaBlob } from '../services/media';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPhone } from '../domain/phone';
import type { Channel, Customer, Lang } from '../domain/types';
import { notifications } from '@mantine/notifications';
import { downloadBlob } from '../services/backup';
import { copyText } from './clipboard';
import { haptic } from './haptics';
import { AppError } from '../services/errors';
import { logMessage, telegramUrl, whatsappUrl } from '../services/messages';
import { numberOnWa, sendWaFile, sendWaText, useWaPrefs, waReady } from '../services/whatsapp';
import { useWaSel } from './waSel';
import { SelectCard } from './components';
import { useErrorText, useSettings } from './hooks';
import { waAutoOf, type WaTarget } from '../domain/waAuto';
import { saveWaAuto } from '../services/waAuto';
import { tFor } from '../i18n';
import { ChatPicker } from '../features/whatsapp/ChatPicker';
import { LazySheet } from './lazy';

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
  /**
   * The PDF for the boss to look at first (v0.80.3): one that freezes nothing — a new estimate's quote (its own `pdf`
   * makes the version). None — `pdf` itself.
   */
  bossPdf?: () => Promise<{ blob: Blob; filename: string }>;
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

type SendProps = { customer: Customer; request: SendRequest | null; onClose: () => void; onSent?: () => void };

/**
 * The message to the customer, as a sheet: it slides up when there is something to send and slides away
 * once it went; nothing of it is made before it is first asked for.
 */
export function SendDialog(props: SendProps) {
  return <LazySheet opened={!!props.request}>{(o) => <SendSheet {...props} shown={o} />}</LazySheet>;
}

function SendSheet({ customer, request: live, onClose, onSent, shown }: SendProps & { shown: boolean }) {
  // While it slides away it keeps showing what it showed.
  const last = useRef(live);
  if (live) last.current = live;
  const request = live ?? last.current;
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [text, setText] = useState('');
  const [channel, setChannel] = useState<Channel>(customer.preferredChannel === 'telegram' ? 'telegram' : 'whatsapp');
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const files = usePhotoFiles(request?.photos);
  const canSharePhotos = files.length > 0 && typeof navigator.canShare === 'function' && navigator.canShare({ files });
  // The garage's WhatsApp is linked (v0.78): the message goes from the app itself — the words, the PDF, the photos —
  // and is logged at once; nobody is asked «was it sent?». Opening WhatsApp by hand stays, under it.
  const waLinked = useWaSel(waReady);
  const prefs = useWaPrefs();
  const [sending, setSending] = useState(false);
  const [withPdf, setWithPdf] = useState(true);
  const [withPhotos, setWithPhotos] = useState(true);
  // The boss first (v0.80.3, «сначала боссу, потом клиенту по желанию»): sent — said on the button; not picked — picked.
  const settings = useSettings();
  const boss = waAutoOf(settings?.waAuto).boss;
  const [bossDone, setBossDone] = useState(false);
  const [bossSending, setBossSending] = useState(false);
  const [pickingBoss, setPickingBoss] = useState(false);

  useEffect(() => {
    if (live) {
      setText(live.text);
      setOpened(false);
      setCopied(false);
      setBossDone(false);
    }
  }, [live]);

  if (!request) return null;
  const phone = customer.whatsapp || customer.phone;
  const url = channel === 'whatsapp' ? whatsappUrl(phone, text) : telegramUrl(text);

  const direct = channel === 'whatsapp' && prefs.direct && waLinked && !!phone;

  const confirm = async (said = 'send.logged') => {
    try {
      await request.onConfirm?.();
    } catch (e) {
      notifications.show({ color: 'red', message: errorText(e) });
      return;
    }
    await logMessage({ orderId: request.orderId, customerId: customer.id, channel, template: request.template, language: request.lang, text });
    haptic('light');
    notifications.show({ color: 'green', message: t(said), icon: <IconCheck size={18} stroke={2.6} /> });
    onSent?.();
    onClose();
  };

  /** Sent by the garage's server: the words, then the document, then the photos — as they would go by hand. */
  const sendDirect = async () => {
    setSending(true);
    try {
      const to = await numberOnWa(phone);
      if (!to.ok) throw new AppError('wa.notOnWa');
      await sendWaText(to.chat, text);
      if (request.pdf && withPdf) {
        const { blob, filename } = await request.pdf();
        await sendWaFile(to.chat, blob, { name: filename, doc: true });
      }
      if (withPhotos) for (const f of files) await sendWaFile(to.chat, f, { name: f.name });
      await confirm('wa.sentDirect');
    } catch (e) {
      haptic('error');
      notifications.show({ color: 'red', message: errorText(e), autoClose: 7000 });
    } finally {
      setSending(false);
    }
  };

  /** To the boss: a line whose it is, the words as they will go, the PDF — nothing frozen, nothing logged for the customer. */
  const sendBoss = async (to: WaTarget) => {
    setBossSending(true);
    try {
      const lang = boss.lang;
      const who = customer.name || formatPhone(phone);
      await sendWaText(to.chat, `${tFor(lang)('msg.forCustomer', { name: who, phone: phone ? ` (${formatPhone(phone)})` : '' }).trim()}\n\n${text}`);
      const pdf = request.bossPdf ?? request.pdf;
      if (pdf && withPdf) {
        const { blob, filename } = await pdf();
        await sendWaFile(to.chat, blob, { name: filename, doc: true });
      }
      setBossDone(true);
      haptic('success');
      notifications.show({ color: 'green', message: t('wa.sentToBoss'), icon: <IconCheck size={18} stroke={2.6} /> });
    } catch (e) {
      haptic('error');
      notifications.show({ color: 'red', message: errorText(e), autoClose: 7000 });
    } finally {
      setBossSending(false);
    }
  };
  // The boss picked here the first time: the boss of the automation from now on — its reports not turned on by it.
  const pickBoss = (to: WaTarget) => {
    void saveWaAuto('boss', settings?.waAuto?.boss?.on === undefined ? { to, on: false } : { to });
    void sendBoss(to);
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
    <Modal opened={shown && !!live} onClose={onClose} title={t('send.title')} size="lg">
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
          {direct && (
            <>
              {(request.pdf || files.length > 0) && (
                <div className="chip-row wrap" data-send-with>
                  {request.pdf && (
                    <button type="button" className="chip" data-active={withPdf} aria-pressed={withPdf} onClick={() => setWithPdf((v) => !v)} data-send-pdf>
                      PDF
                    </button>
                  )}
                  {files.length > 0 && (
                    <button type="button" className="chip" data-active={withPhotos} aria-pressed={withPhotos} onClick={() => setWithPhotos((v) => !v)} data-send-photos>
                      {t('wa.withPhotos', { n: files.length })}
                    </button>
                  )}
                </div>
              )}
              <Button fullWidth size="md" color="green" loading={sending} leftSection={<IconBrandWhatsapp size={20} />} onClick={() => void sendDirect()} data-send-direct>
                {t('wa.sendDirect')}
              </Button>
            </>
          )}
          {waLinked && (
            <Button
              fullWidth
              size="md"
              variant="light"
              color="green"
              loading={bossSending}
              disabled={bossDone}
              leftSection={bossDone ? <IconCheck size={20} /> : <IconUserShield size={20} />}
              onClick={() => (boss.to ? void sendBoss(boss.to) : setPickingBoss(true))}
              data-send-boss
            >
              {bossDone ? t('wa.sentToBoss') : t('wa.toBossFirst')}
            </Button>
          )}
          <Button
            fullWidth
            size="md"
            component="a"
            href={url}
            target="_blank"
            rel="noopener"
            variant={direct ? 'default' : 'filled'}
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
              <Button size="compact-md" onClick={() => void confirm()}>
                {t('send.yesSent')}
              </Button>
            </Group>
          </Group>
        )}
      </Stack>
      {waLinked && <ChatPicker opened={pickingBoss} onClose={() => setPickingBoss(false)} onPick={pickBoss} kind="person" title={t('wa.pickBoss')} />}
    </Modal>
  );
}
