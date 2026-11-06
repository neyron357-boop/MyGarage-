import { Alert, Box, Button, Chip, Group, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { IconCamera, IconPlus, IconSend, IconShieldCheck, IconTemplate, IconVideo } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { itemAmounts } from '../../domain/items';
import type { Urgency } from '../../domain/types';
import { approveByLimit, limitRemaining, updateItem } from '../../services/estimate';
import { addMedia } from '../../services/media';
import { CaptureButton } from '../../ui/CaptureButton';
import { Money, PageHeader, PageSkeleton, Photo, PlateText, StickyBar } from '../../ui/components';
import { useAction, useOrderBundle } from '../../ui/hooks';
import { SendDialog } from '../../ui/SendDialog';
import { DecisionModal, ItemModal, ItemRow, UrgencyPicker } from './components';
import { LimitConfirm, SendVersionModal, TemplateModal, useSendVersion } from './EstimatePage';

const PHRASES = ['tornBoot', 'oilLeak', 'wornDiscs', 'wornPads', 'coolantLeak', 'brokenMount', 'wornBelt', 'corrodedPipe', 'looseLink', 'batteryWeak'];

function Step({ n, title, done, children }: { n: number; title: ReactNode; done?: boolean; children: ReactNode }) {
  return (
    <Box className="surface" p="md">
      <Group gap="sm" mb="sm" wrap="nowrap">
        <ThemeIcon radius="xl" size={28} color={done ? 'green' : 'gray'} variant={done ? 'filled' : 'light'}>
          <Text size="sm" fw={800}>
            {n}
          </Text>
        </ThemeIcon>
        <Title order={5}>{title}</Title>
      </Group>
      {children}
    </Box>
  );
}

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
  const [limitOpen, setLimitOpen] = useState(false);
  const limit = useLiveQuery(() => (id ? limitRemaining(id) : undefined), [id, b?.items.length, b?.decisions.length]);
  const sv = useSendVersion(b);
  if (!b) return <PageSkeleton variant="detail" />;
  const lang = b.order.docLanguage;
  const drafts = b.items.filter((i) => i.approvalState === 'draft');
  const total = drafts.reduce((s, i) => s + itemAmounts(i).gross, 0);
  const withinLimit = !!limit && limit.remaining > 0 && total > 0 && total <= limit.remaining;
  const ready = photos.length > 0 && !!reason.trim() && drafts.length > 0;

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
  const addPhotos = (files: File[]) =>
    run(async () => {
      const ids: string[] = [];
      for (const f of files) ids.push((await addMedia({ ownerType: 'order', ownerId: b.order.id, slot: 'problem', file: f })).id);
      setPhotos((p) => [...p, ...ids]);
    });

  return (
    <>
      <PageHeader
        back={`/orders/${b.order.id}`}
        eyebrow={`${t('order.title')} №${b.order.number}`}
        title={t('problem.title')}
        subtitle={
          <Group gap={8}>
            <PlateText plate={b.vehicle.plate} size="xs" />
            {b.vehicle.make} {b.vehicle.model}
          </Group>
        }
      />
      <Stack gap="md">
        <Step n={1} title={t('problem.photos')} done={photos.length > 0}>
          <Text size="sm" c="dimmed" mb="sm">
            {t('problem.photosHint')}
          </Text>
          <SimpleGrid cols={{ base: 3, sm: 5 }} spacing="xs">
            {photos.map((p) => (
              <Photo key={p} id={p} h={90} w="100%" />
            ))}
            <CaptureButton variant="light" h={90} multiple loading={busy} leftSection={<IconCamera size={20} />} onFiles={addPhotos}>
              {t('photos.take')}
            </CaptureButton>
            <CaptureButton variant="default" h={90} accept="video/*" loading={busy} leftSection={<IconVideo size={20} />} onFiles={addPhotos}>
              {t('photos.videoShort')}
            </CaptureButton>
          </SimpleGrid>
        </Step>
        <Step n={2} title={t('problem.what')} done={!!reason.trim()}>
          <Box className="hide-scrollbar" style={{ overflowX: 'auto' }} mb="sm">
            <Group gap={6} wrap="nowrap">
              {PHRASES.map((p) => (
                <Chip key={p} size="sm" checked={reason === t(`phrase.${p}`, { lng: lang })} onChange={() => setReason(t(`phrase.${p}`, { lng: lang }))} style={{ flexShrink: 0 }}>
                  {t(`phrase.${p}`)}
                </Chip>
              ))}
            </Group>
          </Box>
          <TextInput label={t('problem.description', { lang: t(`lang.${lang}`) })} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          <Text size="sm" fw={600} mt="md" mb={6}>
            {t('item.urgency')}
          </Text>
          <UrgencyPicker value={urgency} onChange={setUrgency} />
          <TextInput mt="md" label={t('item.ifNotDone')} placeholder={t('problem.ifNotDoneHint')} value={ifNotDone} onChange={(e) => setIfNotDone(e.currentTarget.value)} />
        </Step>
        <Step n={3} title={t('problem.items')} done={drafts.length > 0}>
          <Stack gap="xs">
            {drafts.map((i) => (
              <ItemRow key={i.id} item={i} b={b} editable />
            ))}
          </Stack>
          <Group mt="sm" gap="xs">
            <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setItemOpen(true)}>
              {t('estimate.addItem')}
            </Button>
            <Button variant="default" leftSection={<IconTemplate size={16} />} onClick={() => setTplOpen(true)}>
              {t('estimate.fromTemplate')}
            </Button>
          </Group>
          <Group justify="space-between" mt="md" pt="sm" style={{ borderTop: '1px solid var(--app-hairline)' }}>
            <Text fw={600}>{t('common.total')}</Text>
            <Text fz={22}>
              <Money fils={total} display />
            </Text>
          </Group>
        </Step>
        {limit && limit.limit > 0 && (
          <Alert color={withinLimit ? 'teal' : 'orange'} icon={<IconShieldCheck size={18} />} title={t('problem.limitInfo')}>
            <Money fils={limit.remaining} /> {t('problem.of')} <Money fils={limit.limit} />. {withinLimit ? t('problem.withinLimit') : total > 0 ? t('problem.overLimit') : ''}
          </Alert>
        )}
        <Text size="xs" c="dimmed">
          {t('problem.blockedHint')}
        </Text>
      </Stack>
      <StickyBar>
        <Group gap="xs" wrap="nowrap">
          {withinLimit && (
            <Button variant="light" color="teal" leftSection={<IconShieldCheck size={18} />} loading={busy} disabled={!ready} onClick={() => setLimitOpen(true)}>
              {t('estimate.byLimitShort')}
            </Button>
          )}
          <Button style={{ flex: 1 }} leftSection={<IconSend size={18} />} loading={busy} disabled={!ready} onClick={() => run(async () => { await prepare(); setSendOpen(true); })}>
            {t('problem.sendToClient')}
          </Button>
        </Group>
      </StickyBar>
      <ItemModal b={b} opened={itemOpen} block="A" extra={{ urgency, block: 'A' }} onClose={() => setItemOpen(false)} />
      <TemplateModal orderId={b.order.id} opened={tplOpen} onClose={() => setTplOpen(false)} />
      {limit && (
        <LimitConfirm
          opened={limitOpen}
          onClose={() => setLimitOpen(false)}
          total={total}
          remaining={limit.remaining}
          onConfirm={() =>
            run(async () => {
              await prepare();
              const v = await approveByLimit(b.order.id, reason);
              sv.afterSend(v, 'limit');
              return true;
            })
          }
        />
      )}
      <SendVersionModal opened={sendOpen} onClose={() => setSendOpen(false)} orderId={b.order.id} reason={reason} kind="supplement" onSent={sv.afterSend} />
      {sv.decide && <DecisionModal b={b} version={sv.decide} opened onClose={() => { sv.setDecide(null); navigate(`/orders/${b.order.id}`); }} onVerbal={sv.setSend} />}
      <SendDialog customer={b.customer} request={sv.send} onClose={() => { sv.setSend(null); navigate(`/orders/${b.order.id}`); }} />
    </>
  );
}
