import { ActionIcon, Box, Button, Group, Modal, Skeleton, Stack, Text, Textarea } from '@mantine/core';
import { IconBrandWhatsapp, IconFileTypePdf, IconSend, IconShare } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { waAutoOf, type WaTarget } from '../../domain/waAuto';
import type { Expense, Lang } from '../../domain/types';
import { openPdf } from '../../services/documents';
import type { OrderBundle } from '../../services/orders';
import { ownerCheckFile, type OwnerCheckFile } from '../../services/ownerCheck';
import { saveWaAuto } from '../../services/waAuto';
import { sendWaFile, waReady } from '../../services/whatsapp';
import { Money } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { downloadFile } from '../../ui/share';
import { useWaSel } from '../../ui/waSel';
import { ChatPicker } from '../whatsapp/ChatPicker';

/**
 * The job for the owner to check (v0.29 a picture; v0.82 — the owner's note 24/11: «отправку владельцу для подтверждения
 * на PDF и более качественно и понятно… поставщика — в отдельную вкладку… распиши таксы… готовое короткое сообщение со
 * просьбой, сколько ставить за оплату труда»): the PDF (services/ownerCheck.ts: every line bought and sold for with its VAT,
 * the taxes laid out, the profit with VAT and without, the sellers on a page of their own with their WhatsApp pictures),
 * its four figures here, and the message with it — ready, asking what to charge for the labour when the job has none
 * priced, changed here if wanted. One tap — the PDF with the message to the owner's chat (picked here the first time); the
 * share sheet and the PDF itself beside it.
 */
export function OwnerCheckSheet({
  b,
  opened,
  onClose,
}: {
  b: OrderBundle;
  /** (v0.82: read by the PDF itself.) */
  expenses?: Expense[];
  partsCategoryId?: string;
  docLang?: Lang;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const [made, setMade] = useState<OwnerCheckFile>();
  const [text, setText] = useState('');
  // Changed by hand: a PDF made again (the job changed meanwhile) keeps those words.
  const edited = useRef(false);
  const ready = useWaSel(waReady);
  const owner = waAutoOf(b.settings.waAuto).boss.to;
  const [picking, setPicking] = useState(false);
  const { run, busy } = useAction({ exclusive: true });
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setMade(undefined);
    edited.current = false;
    void ownerCheckFile(b.order.id, lang).then((m) => {
      if (!alive) return;
      setMade(m);
      setText((cur) => (edited.current ? cur : m.text));
    });
    return () => {
      alive = false;
    };
    // Made again when the job changes while it is open.
  }, [opened, b, lang]);
  const file = made ? new File([made.pdf.blob], made.pdf.filename, { type: 'application/pdf' }) : undefined;
  const toOwner = (to: WaTarget) =>
    run(async () => {
      if (!file) return;
      await sendWaFile(to.chat, file, { name: file.name, caption: text.trim(), doc: true });
      haptic('success');
      onClose();
    }, 'ownerCheck.sent');
  // The owner's chat picked here: the boss of the automation from now on — its reports stay as they were set.
  const pickOwner = (to: WaTarget) => {
    void saveWaAuto('boss', b.settings.waAuto?.boss?.on === undefined ? { to, on: false } : { to });
    void toOwner(to);
  };
  // The share sheet: the PDF and the words together (the phone's own WhatsApp); a PC — the PDF saved.
  const share = () => {
    if (!file) return;
    const data = { files: [file], text: text.trim() };
    if (typeof navigator.canShare === 'function' && navigator.canShare(data))
      void navigator.share(data).catch((e: unknown) => (e as Error)?.name !== 'AbortError' && downloadFile(file));
    else downloadFile(file);
  };
  const c = made?.check;
  return (
    <Modal opened={opened} onClose={onClose} title={t('ownerCheck.title')} classNames={{ content: 'sheet-grouped' }}>
      <Stack gap="md">
        {c ? (
          <div className="owner-figures" data-owner-check>
            <Figure label={t('ownerCheck.toClient')} fils={c.sale.gross} />
            <Figure label={t('ownerCheck.spent')} fils={c.buy.gross} />
            <Figure label={t('ownerCheck.profit')} fils={c.profit.gross} tone={c.profit.gross >= 0 ? 'good' : 'bad'} />
            <Figure label={t('ownerCheck.vatDue')} fils={c.vat.due} />
          </div>
        ) : (
          <Skeleton height={132} radius="lg" />
        )}
        {c && (c.unpriced > 0 || c.noCost > 0) && (
          <Text size="sm" c="orange.7">
            {[c.unpriced ? t('ownerCheck.unpriced', { n: c.unpriced }) : '', c.noCost ? t('ownerCheck.noCostN', { n: c.noCost }) : ''].filter(Boolean).join(' · ')}
          </Text>
        )}
        <Textarea aria-label={t('ownerCheck.message')} label={t('ownerCheck.message')} autosize minRows={4} maxRows={9} value={text} onChange={(e) => ((edited.current = true), setText(e.currentTarget.value))} disabled={!made} data-owner-text />
        <Button variant="light" leftSection={<IconFileTypePdf size={18} />} disabled={!made} onClick={() => made && void openPdf(made.pdf)} data-owner-pdf>
          {t('ownerCheck.openPdf')}
        </Button>
        {ready ? (
          <Stack gap={4}>
            <Group gap={10} wrap="nowrap">
              <Button size="lg" color="green" style={{ flex: 1 }} leftSection={<IconBrandWhatsapp size={22} />} loading={busy} disabled={!file} onClick={() => (owner ? void toOwner(owner) : setPicking(true))} data-owner-wa>
                {t('ownerCheck.toOwner')}
              </Button>
              <ActionIcon size={50} radius="xl" variant="default" aria-label={t('ownerCheck.share')} disabled={!file} onClick={share}>
                <IconShare size={22} />
              </ActionIcon>
            </Group>
            {owner && (
              <Text size="xs" c="dimmed" ta="center" className="dt-clip">
                {owner.name}
              </Text>
            )}
          </Stack>
        ) : (
          <Button size="lg" fullWidth leftSection={<IconSend size={20} />} disabled={!file} onClick={share}>
            {t('ownerCheck.send')}
          </Button>
        )}
      </Stack>
      {ready && <ChatPicker opened={picking} onClose={() => setPicking(false)} onPick={pickOwner} kind="person" title={t('ownerCheck.pickOwner')} />}
    </Modal>
  );
}

function Figure({ label, fils, tone }: { label: string; fils: number; tone?: 'good' | 'bad' }) {
  return (
    <Box className="owner-figure" data-tone={tone}>
      <span className="owner-figure-label">{label}</span>
      <span className="owner-figure-value">
        <Money fils={fils} />
      </span>
    </Box>
  );
}
