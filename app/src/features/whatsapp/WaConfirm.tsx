import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { dubaiTime } from '../../domain/dates';
import { IconBrandWhatsapp, IconFileTypePdf, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { askToSend, editAsk, forgetAsks, useWaAsks, type WaAsk } from '../../services/waConfirm';
import { sendAsked } from '../../services/waAuto';
import type { OutItem, OutPart } from '../../services/waOutbox';
import { MediaImage, undoToast } from '../../ui/components';
import { showPdf } from '../../ui/PdfViewer';
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
  // The last tap anywhere: what was prepared right after it is the person's own — shown at once (v0.99, audit W25).
  const tapAt = useRef(0);
  useEffect(() => {
    const on = () => (tapAt.current = Date.now());
    window.addEventListener('pointerdown', on, true);
    window.addEventListener('keydown', on, true);
    return () => {
      window.removeEventListener('pointerdown', on, true);
      window.removeEventListener('keydown', on, true);
    };
  }, []);

  // Something new prepared: shown at once when it follows a tap here; prepared by itself (the boss's reports, the
  // autopilot, the evening summary) — the capsule «Ждут отправки» says it, without coming over what is being done.
  useEffect(() => {
    const fresh = asks.some((a) => !seen.current.has(a.id));
    for (const a of asks) seen.current.add(a.id);
    if (fresh && Date.now() - tapAt.current < 6000) setOpen(true);
    else if (fresh) haptic('light');
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

  // Dropped — with «Отменить» (v0.99, audit W26): the dropped ones come back as they were.
  const drop = (list: WaAsk[]) => {
    forgetAsks(list.map((a) => a.id));
    undoToast(t('wa.confirm.dropped', { n: list.length }), t('common.undo'), () => askToSend(list.map((a) => a.item)));
  };

  return (
    <>
      {/* v0.99 (audit W24): while something waits, a capsule says so on every screen — a closed sheet was gone until something
          new came. */}
      {asks.length > 0 && !open && (
        <button type="button" className="wa-pending glass" onClick={() => setOpen(true)} data-wa-pending>
          <IconBrandWhatsapp size={18} />
          {t('wa.confirm.waiting', { n: asks.length })}
        </button>
      )}
      <Modal opened={open && asks.length > 0} onClose={() => setOpen(false)} title={t('wa.confirm.title')}>
        <Stack gap="md" data-wa-confirm>
          {asks.map((a) => (
            <Ask key={a.id} ask={a} busy={busy} small={asks.length > 1} onSend={() => void send([a])} onDrop={() => drop([a])} />
          ))}
          {/* At the bottom in reach (v0.99, audit W26): «Отправить все» and «Позже» stay while the cards scroll. */}
          <div className="sheet-footer" style={{ '--sheet-bg': 'var(--mantine-color-body)' } as React.CSSProperties}>
            {asks.length > 1 && (
              <Button fullWidth color="green" size="md" mb={8} loading={busy} leftSection={<IconBrandWhatsapp size={20} />} onClick={() => void send(asks)}>
                {t('wa.confirm.sendAll', { n: asks.length })}
              </Button>
            )}
            <Group grow gap="sm">
              <Button variant="default" onClick={() => setOpen(false)}>
                {t('wa.confirm.later')}
              </Button>
              <Button variant="subtle" color="red" onClick={() => drop(asks)}>
                {t('wa.confirm.dropAll')}
              </Button>
            </Group>
          </div>
        </Stack>
      </Modal>
    </>
  );
}

const PDF_EXT = /\.pdf$/i;
const isPdf = (p: OutPart) => /pdf/i.test(p.mime ?? '') || PDF_EXT.test(p.name ?? '');
/** The file of a part (base64) as it will go. */
const pdfOf = (p: OutPart) => ({ blob: new Blob([Uint8Array.from(atob(p.data ?? ''), (c) => c.charCodeAt(0))], { type: 'application/pdf' }), filename: p.name || 'document.pdf' });

/** One message: to whom, each of its parts as it will go; the words editable. */
function Ask({ ask, busy, small, onSend, onDrop }: { ask: WaAsk; busy: boolean; /** Among several: its own button smaller (the sheet's «Отправить все» is the main one). */ small?: boolean; onSend: () => void; onDrop: () => void }) {
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
          {/* v0.91.7 (#76): it goes at its time, not now. */}
          {item.after && item.after > Date.now() && (
            <Text size="sm" c="orange" fw={600} className="tnum" style={{ whiteSpace: 'nowrap' }} data-wa-ask-later>
              {t('wa.auto.later', { time: dubaiTime(new Date(item.after).toISOString()) })}
            </Text>
          )}
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
            // A PDF is looked at before it goes (v0.90): a tap — the app's own viewer.
            <button key={i} type="button" className="wa-ask-file" data-wa-ask-file onClick={() => isPdf(p) && showPdf(pdfOf(p), p.name?.replace(PDF_EXT, ''))} disabled={!isPdf(p)}>
              <IconFileTypePdf size={20} />
              <Text size="sm" truncate>
                {p.name || t('wa.confirm.file')}
              </Text>
            </button>
          ) : p.text !== undefined ? (
            <Textarea key={i} autosize minRows={2} maxRows={12} value={p.text} onChange={(e) => setPart(i, { text: e.currentTarget.value })} />
          ) : null,
        )}
      </Stack>
      <Button mt={10} fullWidth={!small} size={small ? 'compact-md' : undefined} variant={small ? 'light' : 'filled'} color="green" loading={busy} leftSection={<IconBrandWhatsapp size={18} />} onClick={onSend}>
        {t('wa.confirm.send')}
      </Button>
    </div>
  );
}
