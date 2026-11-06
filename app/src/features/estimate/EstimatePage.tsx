import { Box, Button, Group, Modal, SimpleGrid, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import {
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconBulb,
  IconPhone,
  IconPlus,
  IconSearch,
  IconSend,
  IconShieldCheck,
  IconTemplate,
  IconUser,
  type Icon,
} from '@tabler/icons-react';
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
import { EmptyState, List, ListRow, Money, PageHeader, PlateText, Section, SelectCard, StickyBar } from '../../ui/components';
import { useAction, useLang, useOrderBundle } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { BlockChip, DecisionModal, ItemModal, ItemRow, addSuggestion, useSuggestions } from './components';

export function TemplateModal({ orderId, opened, onClose, defaultBlock = 'A' }: { orderId: string; opened: boolean; onClose: () => void; defaultBlock?: Block }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run } = useAction();
  const [q, setQ] = useState('');
  const [block, setBlock] = useState<Block>(defaultBlock);
  const templates = useLiveQuery(() => db.jobTemplates.filter((x) => x.active).toArray(), []);
  const list = (templates ?? []).filter((x) => !q || (x.titleRu + x.titleEn).toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal opened={opened} onClose={onClose} title={t('estimate.fromTemplate')} size="lg">
      <Stack gap="sm">
        <SimpleGrid cols={3} spacing="xs">
          {(['A', 'B', 'C'] as const).map((x) => (
            <SelectCard key={x} active={block === x} onClick={() => setBlock(x)}>
              <Group gap={6} wrap="nowrap">
                <BlockChip block={x} />
                <Text size="sm" fw={700} lineClamp={1}>
                  {t(`block.${x}.name`)}
                </Text>
              </Group>
            </SelectCard>
          ))}
        </SimpleGrid>
        <TextInput leftSection={<IconSearch size={18} />} placeholder={t('estimate.templateSearch')} value={q} onChange={(e) => setQ(e.currentTarget.value)} data-autofocus />
        <List>
          {list.map((tpl) => {
            const total = tpl.items.reduce((s, i) => s + Math.round(i.qty * i.unitPriceFils), 0);
            return (
              <ListRow
                key={tpl.id}
                onClick={() => run(async () => { await addTemplate(orderId, tpl.id, block); onClose(); }, 'estimate.added')}
                left={
                  <ThemeIcon variant="light" color="cobalt" size={38} radius="md">
                    <IconTemplate size={19} />
                  </ThemeIcon>
                }
                title={lang === 'ru' ? tpl.titleRu : tpl.titleEn}
                subtitle={tpl.items.map((i) => (lang === 'ru' ? i.titleRu : i.titleEn)).join(' · ')}
                right={
                  <Box ta="right" style={{ flexShrink: 0 }}>
                    <Money fils={total} size="sm" />
                    <Text size="10px" c="dimmed">
                      {t('common.withoutVat')}
                    </Text>
                  </Box>
                }
              />
            );
          })}
        </List>
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

const VIA_OPTIONS: { value: SendVia; icon: Icon; color: string }[] = [
  { value: 'whatsapp', icon: IconBrandWhatsapp, color: 'green' },
  { value: 'telegram', icon: IconBrandTelegram, color: 'cobalt' },
  { value: 'in_person', icon: IconUser, color: 'gray' },
  { value: 'phone', icon: IconPhone, color: 'gray' },
];

export function SendVersionModal({ opened, onClose, orderId, reason, onSent, kind }: { opened: boolean; onClose: () => void; orderId: string; reason?: string; kind?: EstimateVersion['kind']; onSent: (v: EstimateVersion, via: SendVia) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [via, setVia] = useState<SendVia>('whatsapp');
  return (
    <Modal opened={opened} onClose={onClose} title={t('estimate.sendTitle')}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t('estimate.sendExplain')}
        </Text>
        <SimpleGrid cols={2} spacing="xs">
          {VIA_OPTIONS.map((o) => (
            <SelectCard key={o.value} active={via === o.value} onClick={() => setVia(o.value)}>
              <Stack gap={6}>
                <ThemeIcon variant="light" color={o.color} radius="md">
                  <o.icon size={18} />
                </ThemeIcon>
                <Text size="sm" fw={700}>
                  {t(`sendViaShort.${o.value}`)}
                </Text>
                <Text size="xs" c="dimmed" lh={1.3}>
                  {t(`sendViaHint.${o.value}`)}
                </Text>
              </Stack>
            </SelectCard>
          ))}
        </SimpleGrid>
        <Button mt="xs" leftSection={<IconSend size={18} />} loading={busy} onClick={() => run(async () => { const v = await sendVersion(orderId, { via, reason, kind }); onClose(); onSent(v, via); })}>
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
        back={`/orders/${b.order.id}`}
        eyebrow={`${t('estimate.title')} · ${t('order.title')} №${b.order.number}`}
        title={`${b.vehicle.make} ${b.vehicle.model}`}
        subtitle={
          <Group gap={8}>
            <PlateText plate={b.vehicle.plate} size="xs" />
            <span>
              {t('estimate.clientLang')}: {t(`lang.${b.order.docLanguage}`)}
            </span>
          </Group>
        }
      />

      <Box className="surface" p="md" mb="lg" style={{ position: 'sticky', top: 'calc(var(--app-header-h) + 8px)', zIndex: 20 }}>
        <SimpleGrid cols={3} spacing="sm">
          <div>
            <div className="eyebrow">{t('estimate.fixed')}</div>
            <Text fz={22} mt={2}>
              <Money fils={sum.fixedGross} display />
            </Text>
          </div>
          <div>
            <div className="eyebrow">{t('estimate.upTo')}</div>
            <Text fz={22} mt={2} c={sum.maxGross > sum.fixedGross ? 'orange' : undefined}>
              <Money fils={sum.maxGross} display />
            </Text>
          </div>
          <div>
            <div className="eyebrow">{t('estimate.recommended')}</div>
            <Text fz={22} mt={2} c="dimmed">
              <Money fils={sum.recommendedGross} display />
            </Text>
          </div>
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt={6}>
          {t('estimate.inclVat')} · {t('estimate.marginHidden')}: <Money fils={margin} />
        </Text>
      </Box>

      <Group gap="xs">
        <Button leftSection={<IconTemplate size={18} />} onClick={() => setTplOpen(true)}>
          {t('estimate.fromTemplate')}
        </Button>
        <Button variant="default" leftSection={<IconPlus size={18} />} onClick={() => setEdit({ block: 'A' })}>
          {t('estimate.addItem')}
        </Button>
      </Group>

      {(['A', 'B', 'C'] as const).map((blk) => {
        const list = visible.filter((i) => i.block === blk);
        return (
          <Section
            key={blk}
            title={
              <Group gap={8}>
                <BlockChip block={blk} />
                {t(`block.${blk}.title`)}
              </Group>
            }
            description={t(`block.${blk}.hint`)}
            action={
              <Button size="compact-sm" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setEdit({ block: blk })}>
                {t('common.add')}
              </Button>
            }
          >
            <Stack gap="xs">
              {list.length === 0 && (
                <Box p="sm" style={{ border: '1.5px dashed var(--app-hairline)', borderRadius: 14 }}>
                  <Text size="sm" c="dimmed" ta="center">
                    {t(`block.${blk}.empty`)}
                  </Text>
                </Box>
              )}
              {list.map((i) => (
                <ItemRow key={i.id} item={i} b={b} editable onEdit={() => setEdit({ item: i })} />
              ))}
            </Stack>
          </Section>
        );
      })}

      {suggestions.length > 0 && (
        <Section title={<Group gap={8}><IconBulb size={18} color="var(--mantine-color-yellow-6)" />{t('estimate.suggestTitle')}</Group>} description={t('estimate.suggestHint')}>
          <List>
            {suggestions.map((s) => (
              <ListRow
                key={s.id}
                title={lang === 'ru' ? s.titleRu : s.titleEn}
                subtitle={
                  <>
                    <Money fils={s.min} /> – <Money fils={s.max} /> · {t('common.withoutVat')}
                  </>
                }
                right={
                  <Button size="compact-sm" variant="light" color="orange" style={{ flexShrink: 0 }} onClick={() => run(() => addSuggestion(b.order.id, s), 'estimate.added')}>
                    {t('estimate.addToB')}
                  </Button>
                }
              />
            ))}
          </List>
        </Section>
      )}

      {visible.length === 0 && (
        <Box mt="xl">
          <EmptyState icon={IconTemplate} title={t('estimate.emptyTitle')}>
            {t('estimate.emptyText')}
          </EmptyState>
        </Box>
      )}

      {drafts.length > 0 ? (
        <StickyBar>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Box style={{ minWidth: 0 }} visibleFrom="xs">
              <Text size="sm" fw={700}>
                {t('estimate.draftCount', { n: drafts.length })}
              </Text>
              <Text size="xs" c="dimmed">
                {firstSent ? t('estimate.willBeSupplement', { n: b.versions.length + 1 }) : t('estimate.willBeFirst')} · <Money fils={draftTotal} />
              </Text>
            </Box>
            <Group gap="xs" wrap="nowrap" style={{ flex: 1, justifyContent: 'flex-end' }}>
              {canLimit && (
                <Button variant="light" color="teal" leftSection={<IconShieldCheck size={18} />} loading={busy} onClick={() => run(async () => { const v = await approveByLimit(b.order.id); sv.afterSend(v, 'limit'); })}>
                  {t('estimate.byLimitShort')}
                </Button>
              )}
              <Button leftSection={<IconSend size={18} />} onClick={() => setSendOpen(true)} style={{ flex: canLimit ? undefined : 1, maxWidth: 360 }}>
                {t('estimate.send')}
              </Button>
            </Group>
          </Group>
        </StickyBar>
      ) : (
        b.versions.length > 0 && (
          <Button mt="xl" variant="default" fullWidth onClick={() => navigate(`/orders/${b.order.id}?tab=approvals`)}>
            {t('estimate.toApprovals')}
          </Button>
        )
      )}
      <ItemModal b={b} opened={!!edit} item={edit?.item} block={edit?.block} onClose={() => setEdit(null)} />
      <TemplateModal orderId={b.order.id} opened={tplOpen} onClose={() => setTplOpen(false)} />
      <SendVersionModal opened={sendOpen} onClose={() => setSendOpen(false)} orderId={b.order.id} onSent={sv.afterSend} />
      {sv.decide && <DecisionModal b={b} version={sv.decide} opened onClose={() => sv.setDecide(null)} onVerbal={sv.setSend} />}
      <SendDialog customer={b.customer} request={sv.send} onClose={() => sv.setSend(null)} />
    </>
  );
}
