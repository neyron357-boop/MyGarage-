import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { IconBrandWhatsapp, IconFileTypePdf, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { editAsk, forgetAsks, useWaAsks, type WaAsk } from '../../services/waConfirm';
import { sendAsked } from '../../services/waAuto';
import type { OutItem, OutPart } from '../../services/waOutbox';
import { MediaImage } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';

/** Asked from anywhere (the WhatsApp screens' «Ждут отправки»): the sheet opens. */
export const OPEN_WA_ASKS = 'mg-wa-asks';
export const openWaAsks = () => window.dispatchEvent(new Event(OPEN_WA_ASKS));

/**
 * «Проверить и отправить» (v0.85, services/waConfirm.ts): what the app prepared for WhatsApp — to whom, the words (they can
 * be changed), the photos and files — and nothing goes until «Отправить» is tapped. It opens by itself when something new
 * is prepared on this device; «Позже» keeps it waiting, «Не отправлять» drops it.
 */
export function WaConfirm() {
  const { t } = useTranslation();
  const asks = useWaAsks();
  const [open, setOpen] = useState(false);
  const seen = useRef(new Set(asks.map((a) => a.id)));
  const { run, busy } = useAction({ exclusive: true });

  // Something new prepared: shown at once.
  useEffect(() => {
    const fresh = asks.some((a) => !seen.current.has(a.id));
    for (const a of asks) seen.current.add(a.id);
    if (fresh) setOpen(true);
    if (!asks.length) setOpen(false);
  }, [asks]);
  useEffect(() => {
    const on = () => asks.length && setOpen(true);
    window.addEventListener(OPEN_WA_ASKS, on);
    return () => window.removeEventListener(OPEN_WA_ASKS, on);
  }, [asks.length]);

  const send = (list: WaAsk[]) =>
    run(async () => {
      await sendAsked(list);
      haptic('success');
    }, 'wa.confirm.sent');

  return (
    <Modal opened={open && asks.length > 0} onClose={() => setOpen(false)} title={t('wa.confirm.title')}>
      <Stack gap="md" data-wa-confirm>
        {asks.map((a) => (
          <Ask key={a.id} ask={a} busy={busy} onSend={() => void send([a])} onDrop={() => forgetAsks([a.id])} />
        ))}
        {asks.length > 1 && (
          <Button fullWidth color="green" size="md" loading={busy} leftSection={<IconBrandWhatsapp size={20} />} onClick={() => void send(asks)}>
            {t('wa.confirm.sendAll', { n: asks.length })}
          </Button>
        )}
        <Group grow gap="sm">
          <Button variant="default" onClick={() => setOpen(false)}>
            {t('wa.confirm.later')}
          </Button>
          <Button variant="subtle" color="red" onClick={() => forgetAsks(asks.map((a) => a.id))}>
            {t('wa.confirm.dropAll')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** One message: to whom, each of its parts as it will go; the words editable. */
function Ask({ ask, busy, onSend, onDrop }: { ask: WaAsk; busy: boolean; onSend: () => void; onDrop: () => void }) {
  const { t } = useTranslation();
  const item = ask.item;
  const setPart = (i: number, patch: Partial<OutPart>) => {
    const parts = item.parts.map((p, k) => (k === i ? { ...p, ...patch } : p));
    editAsk(ask.id, { ...item, parts } satisfies OutItem);
  };
  return (
    <div className="wa-ask" data-wa-ask={item.key}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <span className="row-icon" style={{ background: 'var(--mantine-color-green-6)' }} aria-hidden>
            <IconBrandWhatsapp size={18} />
          </span>
          <Text fw={600} truncate>
            {item.title || item.chat || item.phone}
          </Text>
        </Group>
        <button type="button" className="wa-ask-drop" aria-label={t('wa.confirm.drop')} onClick={onDrop}>
          <IconX size={18} />
        </button>
      </Group>
      <Stack gap={8} mt={8}>
        {item.parts.map((p, i) =>
          p.media ? (
            <div key={i}>
              <MediaImage id={p.media} card h={160} w="100%" />
              {p.caption !== undefined && <Textarea mt={6} autosize minRows={2} maxRows={8} value={p.caption} onChange={(e) => setPart(i, { caption: e.currentTarget.value, fallback: e.currentTarget.value })} />}
            </div>
          ) : p.data ? (
            <Group key={i} gap={8} className="wa-ask-file" wrap="nowrap">
              <IconFileTypePdf size={20} />
              <Text size="sm" truncate>
                {p.name || t('wa.confirm.file')}
              </Text>
            </Group>
          ) : p.text !== undefined ? (
            <Textarea key={i} autosize minRows={2} maxRows={12} value={p.text} onChange={(e) => setPart(i, { text: e.currentTarget.value })} />
          ) : null,
        )}
      </Stack>
      <Button mt={10} fullWidth color="green" loading={busy} leftSection={<IconBrandWhatsapp size={18} />} onClick={onSend}>
        {t('wa.confirm.send')}
      </Button>
    </div>
  );
}
