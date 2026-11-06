import { Alert, Button, Chip, Group, Paper, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconSend, IconShieldCheck } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { itemAmounts } from '../../domain/items';
import type { Urgency } from '../../domain/types';
import { approveByLimit, limitRemaining, updateItem } from '../../services/estimate';
import { addMedia } from '../../services/media';
import { CaptureButton } from '../../ui/CaptureButton';
import { Money, PageHeader, Photo, PlateText } from '../../ui/components';
import { useAction, useOrderBundle } from '../../ui/hooks';
import { SendDialog } from '../../ui/SendDialog';
import { DecisionModal, ItemModal, ItemRow } from './components';
import { SendVersionModal, TemplateModal, useSendVersion } from './EstimatePage';

const PHRASES = ['tornBoot', 'oilLeak', 'wornDiscs', 'wornPads', 'coolantLeak', 'brokenMount', 'wornBelt', 'corrodedPipe', 'looseLink', 'batteryWeak'];

export function FoundProblemPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const b = useOrderBundle(id);
  const [photos, setPhotos] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('yellow');
  const [ifNotDone, setIfNotDone] = useState('');
  const [itemOpen, setItemOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const limit = useLiveQuery(() => (id ? limitRemaining(id) : undefined), [id, b?.items.length, b?.decisions.length]);
  const sv = useSendVersion(b);
  if (!b) return null;
  const lang = b.order.docLanguage;
  const drafts = b.items.filter((i) => i.approvalState === 'draft');
  const total = drafts.reduce((s, i) => s + itemAmounts(i).gross, 0);
  const withinLimit = !!limit && limit.remaining > 0 && total > 0 && total <= limit.remaining;

  /** Attach photos, urgency and consequences to every new draft item before sending. */
  const prepare = async () => {
    if (photos.length === 0) throw new Error(t('problem.photoRequired'));
    if (!reason.trim()) throw new Error(t('problem.reasonRequired'));
    if (drafts.length === 0) throw new Error(t('problem.itemsRequired'));
    for (const i of drafts) {
      await updateItem(i.id, {
        mediaIds: [...new Set([...(i.mediaIds ?? []), ...photos])],
        urgency: i.urgency ?? urgency,
        ...(lang === 'ru' ? { ifNotDoneRu: i.ifNotDoneRu || ifNotDone || undefined } : { ifNotDoneEn: i.ifNotDoneEn || ifNotDone || undefined }),
      });
    }
  };

  return (
    <>
      <PageHeader
        title={t('problem.title')}
        back={`/orders/${b.order.id}`}
        subtitle={<Group gap={6}><PlateText plate={b.vehicle.plate} size="xs" />{b.vehicle.make} {b.vehicle.model} · №{b.order.number}</Group>}
      />
      <Stack>
        <Paper withBorder p="md">
          <Title order={6} mb="xs">1. {t('problem.photos')}</Title>
          <Group gap="xs">
            {photos.map((p) => <Photo key={p} id={p} h={80} />)}
            <CaptureButton
              variant="light"
              multiple
              loading={busy}
              onFiles={(files) => run(async () => { const ids: string[] = []; for (const f of files) ids.push((await addMedia({ ownerType: 'order', ownerId: b.order.id, slot: 'problem', file: f })).id); setPhotos((p) => [...p, ...ids]); })}
            >
              {t('photos.take')}
            </CaptureButton>
            <CaptureButton variant="default" accept="video/*" loading={busy} onFiles={(files) => run(async () => { const m = await addMedia({ ownerType: 'order', ownerId: b.order.id, slot: 'problem', file: files[0] }); setPhotos((p) => [...p, m.id]); })}>
              {t('photos.videoShort')}
            </CaptureButton>
          </Group>
        </Paper>
        <Paper withBorder p="md">
          <Title order={6} mb="xs">2. {t('problem.what')}</Title>
          <Group gap={6} mb="xs">
            {PHRASES.map((p) => (
              <Chip key={p} size="sm" checked={reason === t(`phrase.${p}`, { lng: lang })} onChange={() => setReason(t(`phrase.${p}`, { lng: lang }))}>
                {t(`phrase.${p}`)}
              </Chip>
            ))}
          </Group>
          <TextInput label={t('problem.description', { lang: t(`lang.${lang}`) })} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          <Text size="sm" fw={500} mt="sm" mb={4}>{t('item.urgency')}</Text>
          <SegmentedControl fullWidth value={urgency} onChange={(v) => setUrgency(v as Urgency)} data={(['red', 'yellow', 'green'] as const).map((u) => ({ value: u, label: t(`urgency.${u}`) }))} />
          <TextInput mt="sm" label={t('item.ifNotDone')} placeholder={t('problem.ifNotDoneHint')} value={ifNotDone} onChange={(e) => setIfNotDone(e.currentTarget.value)} />
        </Paper>
        <Paper withBorder p="md">
          <Title order={6} mb="xs">3. {t('problem.items')}</Title>
          <Stack gap={6}>
            {drafts.map((i) => <ItemRow key={i.id} item={i} b={b} editable />)}
          </Stack>
          <Group mt="sm">
            <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setItemOpen(true)}>{t('estimate.addItem')}</Button>
            <Button variant="default" onClick={() => setTplOpen(true)}>{t('estimate.fromTemplate')}</Button>
          </Group>
          <Group justify="space-between" mt="sm">
            <Text fw={600}>{t('common.total')}</Text>
            <Money fils={total} fw={700} />
          </Group>
        </Paper>
        {limit && (
          <Text size="sm" c="dimmed">
            {t('problem.limitInfo')}: <Money fils={limit.remaining} size="sm" /> {t('problem.of')} <Money fils={limit.limit} size="sm" />
          </Text>
        )}
        {withinLimit && (
          <Button
            color="teal"
            size="md"
            leftSection={<IconShieldCheck />}
            loading={busy}
            onClick={() => run(async () => { await prepare(); const v = await approveByLimit(b.order.id, reason); sv.afterSend(v, 'limit'); })}
          >
            {t('estimate.approveByLimit')}
          </Button>
        )}
        {!withinLimit && total > 0 && limit && limit.limit > 0 && <Alert color="orange">{t('problem.overLimit')}</Alert>}
        <Button size="lg" leftSection={<IconSend />} loading={busy} onClick={() => run(async () => { await prepare(); setSendOpen(true); })}>
          {t('problem.sendToClient')}
        </Button>
        <Text size="xs" c="dimmed">{t('problem.blockedHint')}</Text>
      </Stack>
      <ItemModal b={b} opened={itemOpen} block="A" extra={{ urgency, block: 'A' }} onClose={() => setItemOpen(false)} />
      <TemplateModal orderId={b.order.id} opened={tplOpen} onClose={() => setTplOpen(false)} />
      <SendVersionModal opened={sendOpen} onClose={() => setSendOpen(false)} orderId={b.order.id} reason={reason} kind="supplement" onSent={sv.afterSend} />
      {sv.decide && <DecisionModal b={b} version={sv.decide} opened onClose={() => { sv.setDecide(null); navigate(`/orders/${b.order.id}`); }} onVerbal={sv.setSend} />}
      <SendDialog customer={b.customer} request={sv.send} onClose={() => { sv.setSend(null); navigate(`/orders/${b.order.id}`); }} />
    </>
  );
}
