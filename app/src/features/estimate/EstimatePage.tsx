import { Alert, Badge, Button, Group, Modal, Paper, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconBulb, IconPlus, IconSend, IconTemplate } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { itemAmounts, summarize } from '../../domain/items';
import type { Block, EstimateVersion, OrderItem, SendVia } from '../../domain/types';
import { versionPdf } from '../../services/documents';
import { addTemplate, approveByLimit, limitRemaining, sendVersion } from '../../services/estimate';
import { limitMessage, versionMessage } from '../../services/messages';
import { Money, PageHeader, PlateText } from '../../ui/components';
import { useAction, useLang, useOrderBundle } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { DecisionModal, ItemModal, ItemRow, addSuggestion, useSuggestions } from './components';

export function TemplateModal({ orderId, opened, onClose }: { orderId: string; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run } = useAction();
  const [q, setQ] = useState('');
  const [block, setBlock] = useState<Block>('A');
  const templates = useLiveQuery(() => db.jobTemplates.filter((x) => x.active).toArray(), []);
  const list = (templates ?? []).filter((x) => !q || (x.titleRu + x.titleEn).toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal opened={opened} onClose={onClose} title={t('estimate.fromTemplate')} size="lg">
      <Stack>
        <SegmentedControl fullWidth value={block} onChange={(v) => setBlock(v as Block)} data={(['A', 'B', 'C'] as const).map((x) => ({ value: x, label: t(`block.${x}.short`) }))} />
        <TextInput placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.currentTarget.value)} autoFocus />
        {list.map((tpl) => {
          const total = tpl.items.reduce((s, i) => s + Math.round(i.qty * i.unitPriceFils), 0);
          return (
            <Paper
              key={tpl.id}
              withBorder
              p="sm"
              className="tap-card"
              onClick={() => run(async () => { await addTemplate(orderId, tpl.id, block); onClose(); }, 'estimate.added')}
            >
              <Group justify="space-between">
                <Text fw={500}>{lang === 'ru' ? tpl.titleRu : tpl.titleEn}</Text>
                <Text size="sm" c="dimmed">{t('common.withoutVat')}: <Money fils={total} size="sm" /></Text>
              </Group>
              <Text size="xs" c="dimmed">{tpl.items.map((i) => (lang === 'ru' ? i.titleRu : i.titleEn)).join(' · ')}</Text>
            </Paper>
          );
        })}
      </Stack>
    </Modal>
  );
}

export function useSendVersion(b: ReturnType<typeof useOrderBundle>) {
  const [send, setSend] = useState<SendRequest | null>(null);
  const [decide, setDecide] = useState<EstimateVersion | null>(null);
  const ctx = b ? { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name } : undefined;
  const afterSend = (v: EstimateVersion, via: SendVia) => {
    if (!ctx) return;
    if (via === 'in_person' || via === 'phone') setDecide(v);
    else if (via === 'limit') setSend({ text: limitMessage(ctx, v), template: 'doneByLimit', lang: v.language, orderId: v.orderId, pdf: () => versionPdf(v.id) });
    else setSend({ text: versionMessage(ctx, v), template: v.number === 1 ? 'estimate' : 'supplement', lang: v.language, orderId: v.orderId, pdf: () => versionPdf(v.id) });
  };
  return { send, setSend, decide, setDecide, afterSend };
}

export function SendVersionModal({ opened, onClose, orderId, reason, onSent, kind }: { opened: boolean; onClose: () => void; orderId: string; reason?: string; kind?: EstimateVersion['kind']; onSent: (v: EstimateVersion, via: SendVia) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [via, setVia] = useState<SendVia>('whatsapp');
  return (
    <Modal opened={opened} onClose={onClose} title={t('estimate.sendTitle')}>
      <Stack>
        <Text size="sm">{t('estimate.sendExplain')}</Text>
        <SegmentedControl
          fullWidth
          orientation="vertical"
          value={via}
          onChange={(v) => setVia(v as SendVia)}
          data={[
            { value: 'whatsapp', label: t('sendVia.whatsapp') },
            { value: 'telegram', label: t('sendVia.telegram') },
            { value: 'in_person', label: t('sendVia.in_person') },
            { value: 'phone', label: t('sendVia.phone') },
          ]}
        />
        <Button
          leftSection={<IconSend size={18} />}
          loading={busy}
          onClick={() => run(async () => { const v = await sendVersion(orderId, { via, reason, kind }); onClose(); onSent(v, via); })}
        >
          {t('estimate.freezeAndSend')}
        </Button>
      </Stack>
    </Modal>
  );
}

export function EstimatePage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const b = useOrderBundle(id);
  const [edit, setEdit] = useState<{ item?: OrderItem; block?: Block } | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const suggestions = useSuggestions(b);
  const limit = useLiveQuery(() => (id ? limitRemaining(id) : undefined), [id, b?.items.length, b?.decisions.length]);
  const sv = useSendVersion(b);
  if (!b) return null;
  const visible = b.items.filter((i) => i.approvalState !== 'cancelled');
  const sum = summarize(visible);
  const drafts = b.items.filter((i) => i.approvalState === 'draft');
  const draftTotal = drafts.reduce((s, i) => s + itemAmounts(i).gross, 0);
  const margin = b.items
    .filter((i) => i.kind === 'part' && i.approvalState !== 'declined' && i.approvalState !== 'cancelled' && !i.customerSupplied && i.costPriceFils !== undefined)
    .reduce((s, i) => s + itemAmounts(i).net - Math.round((i.costPriceFils ?? 0) * i.qty), 0);
  const firstSent = b.versions.length > 0;
  const canLimit = firstSent && limit && limit.remaining > 0 && drafts.length > 0 && draftTotal <= limit.remaining;

  return (
    <>
      <PageHeader
        title={t('estimate.title')}
        back={`/orders/${b.order.id}`}
        subtitle={<Group gap={6}><PlateText plate={b.vehicle.plate} size="xs" />{b.vehicle.make} {b.vehicle.model} · №{b.order.number} · {t(`lang.${b.order.docLanguage}`)}</Group>}
      />
      <Paper withBorder p="sm" mb="md" style={{ position: 'sticky', top: 60, zIndex: 5 }} bg="var(--mantine-color-body)">
        <SimpleGrid cols={3}>
          <div><Text size="xs" c="dimmed">{t('estimate.fixed')}</Text><Money fils={sum.fixedGross} fw={700} /></div>
          <div><Text size="xs" c="dimmed">{t('estimate.upTo')}</Text><Money fils={sum.maxGross} fw={700} /></div>
          <div><Text size="xs" c="dimmed">{t('estimate.recommended')}</Text><Money fils={sum.recommendedGross} fw={700} /></div>
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt={4}>{t('estimate.inclVat')} · {t('estimate.marginHidden')}: <Money fils={margin} size="xs" /></Text>
      </Paper>
      <Group mb="md" gap="xs">
        <Button leftSection={<IconTemplate size={18} />} onClick={() => setTplOpen(true)}>{t('estimate.fromTemplate')}</Button>
        <Button variant="light" leftSection={<IconPlus size={18} />} onClick={() => setEdit({ block: 'A' })}>{t('estimate.addItem')}</Button>
      </Group>
      {(['A', 'B', 'C'] as const).map((blk) => {
        const list = visible.filter((i) => i.block === blk);
        return (
          <Stack key={blk} gap={6} mb="lg">
            <Group justify="space-between">
              <div>
                <Title order={5}>{t(`block.${blk}.title`)}</Title>
                <Text size="xs" c="dimmed">{t(`block.${blk}.hint`)}</Text>
              </div>
              <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setEdit({ block: blk })}>{t('common.add')}</Button>
            </Group>
            {list.length === 0 && <Text size="sm" c="dimmed">—</Text>}
            {list.map((i) => <ItemRow key={i.id} item={i} b={b} editable onEdit={() => setEdit({ item: i })} />)}
          </Stack>
        );
      })}
      {suggestions.length > 0 && (
        <Paper withBorder p="sm" mb="md" bg="var(--mantine-color-yellow-light)">
          <Group gap={6} mb={6}><IconBulb size={18} /><Text fw={600}>{t('estimate.suggestTitle')}</Text></Group>
          <Stack gap={4}>
            {suggestions.map((s) => (
              <Group key={s.id} justify="space-between" wrap="nowrap">
                <Text size="sm">{lang === 'ru' ? s.titleRu : s.titleEn} · <Money fils={s.min} size="sm" /> – <Money fils={s.max} size="sm" /></Text>
                <Button size="compact-sm" variant="white" style={{ flexShrink: 0 }} onClick={() => run(() => addSuggestion(b.order.id, s), 'estimate.added')}>{t('estimate.addToB')}</Button>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
      {drafts.length > 0 ? (
        <Paper withBorder p="md" mb="md">
          <Group justify="space-between" mb="xs">
            <Text fw={600}>{t('estimate.draftCount', { n: drafts.length })}</Text>
            <Badge>{firstSent ? t('estimate.willBeSupplement', { n: b.versions.length + 1 }) : 'v1'}</Badge>
          </Group>
          {canLimit && (
            <Alert color="teal" mb="sm">
              {t('estimate.withinLimit', { remaining: ((limit?.remaining ?? 0) / 100).toFixed(2) })}
              <Button mt="xs" size="xs" color="teal" loading={busy} onClick={() => run(async () => { const v = await approveByLimit(b.order.id); sv.afterSend(v, 'limit'); })}>{t('estimate.approveByLimit')}</Button>
            </Alert>
          )}
          <Button fullWidth size="md" leftSection={<IconSend size={18} />} onClick={() => setSendOpen(true)}>{t('estimate.send')}</Button>
        </Paper>
      ) : (
        b.versions.length > 0 && <Button variant="default" fullWidth onClick={() => navigate(`/orders/${b.order.id}?tab=approvals`)}>{t('estimate.toApprovals')}</Button>
      )}
      <ItemModal b={b} opened={!!edit} item={edit?.item} block={edit?.block} onClose={() => setEdit(null)} />
      <TemplateModal orderId={b.order.id} opened={tplOpen} onClose={() => setTplOpen(false)} />
      <SendVersionModal opened={sendOpen} onClose={() => setSendOpen(false)} orderId={b.order.id} onSent={sv.afterSend} />
      {sv.decide && <DecisionModal b={b} version={sv.decide} opened onClose={() => sv.setDecide(null)} onVerbal={sv.setSend} />}
      <SendDialog customer={b.customer} request={sv.send} onClose={() => sv.setSend(null)} />
    </>
  );
}
