import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { formatDateTime } from '../../domain/dates';
import { isAwaitingClient, isAwaitingDisassembly, itemAmounts, itemRangeGross, itemTitle } from '../../domain/items';
import { roundFils } from '../../domain/money';
import { fromNet, netFromGross } from '../../domain/vat';
import type { Block, DecisionKind, DecisionVia, EstimateVersion, ItemKind, OrderItem, Settings, Urgency } from '../../domain/types';
import { addItem, recordDecisions, removeItem, resolveB, setDone, updateItem, type NewItem } from '../../services/estimate';
import { verbalConfirmation } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { Money, MoneyInput } from '../../ui/components';
import { useAction, useLang } from '../../ui/hooks';
import type { SendRequest } from '../../ui/SendDialog';

/** Price entry that respects the "prices include VAT" setting; always returns net fils. */
export function PriceInput({ label, net, onChange, settings, vatRateBp }: { label: string; net: number | undefined; onChange: (net: number | undefined) => void; settings: Settings; vatRateBp?: number }) {
  const { t } = useTranslation();
  const rate = vatRateBp ?? settings.vatRateBp;
  const shown = net === undefined ? undefined : settings.pricesIncludeVat ? fromNet(net, rate).gross : net;
  return (
    <MoneyInput
      label={`${label} (${settings.pricesIncludeVat ? t('common.withVat') : t('common.withoutVat')})`}
      value={shown}
      onChange={(v) => onChange(v === undefined ? undefined : settings.pricesIncludeVat ? netFromGross(v, rate) : v)}
    />
  );
}

const STATE_COLOR: Record<OrderItem['approvalState'], string> = { draft: 'gray', pending: 'yellow', approved: 'green', declined: 'red', cancelled: 'gray' };

export function ItemStateBadge({ item }: { item: OrderItem }) {
  const { t } = useTranslation();
  if (isAwaitingDisassembly(item)) return <Badge color="violet" variant="light">{t(`item.bChoice.${item.bChoice}`)}</Badge>;
  return <Badge color={STATE_COLOR[item.approvalState]} variant="light">{t(`item.state.${item.approvalState}`)}</Badge>;
}

export function ItemModal({ b, item, block, opened, onClose, extra }: { b: OrderBundle; item?: OrderItem; block?: Block; opened: boolean; onClose: () => void; extra?: Partial<OrderItem> }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const s = b.settings;
  const blank: NewItem = { kind: 'labor', block: block ?? 'A', qty: 1, unit: 'pcs', unitPriceFils: 0 };
  const [v, setV] = useState<NewItem>(blank);
  useEffect(() => {
    if (opened) setV(item ? { ...item } : { ...blank, ...extra, block: block ?? extra?.block ?? 'A' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, item, block]);
  const set = (p: Partial<NewItem>) => setV((x) => ({ ...x, ...p }));
  const markup = (cost: number | undefined) => (cost === undefined ? undefined : roundFils(cost * (1 + s.defaultMarkupBp / 10000)));
  const save = () =>
    run(async () => {
      const patch = { ...v, unitPriceFils: v.unitPriceFils ?? 0 };
      if (item) await updateItem(item.id, patch);
      else await addItem(b.order.id, patch);
      onClose();
    }, 'common.saved');
  const primary = lang === 'ru' ? 'titleRu' : 'titleEn';
  const secondary = lang === 'ru' ? 'titleEn' : 'titleRu';
  return (
    <Modal opened={opened} onClose={onClose} title={item ? t('item.edit') : t('item.new')} size="lg">
      <Stack>
        <SegmentedControl fullWidth value={v.kind} onChange={(k) => set({ kind: k as ItemKind, unit: k === 'labor' ? v.unit : 'pcs' })} data={(['labor', 'part', 'fee', 'discount'] as const).map((k) => ({ value: k, label: t(`item.kind.${k}`) }))} />
        <SegmentedControl fullWidth value={v.block} onChange={(x) => set({ block: x as Block })} data={(['A', 'B', 'C'] as const).map((x) => ({ value: x, label: t(`block.${x}.short`) }))} />
        <Text size="xs" c="dimmed">{t(`block.${v.block}.hint`)}</Text>
        <TextInput label={t('item.title')} required value={v[primary] ?? ''} onChange={(e) => set({ [primary]: e.currentTarget.value })} />
        <TextInput label={t('item.titleOther')} description={t('item.titleOtherHint')} value={v[secondary] ?? ''} onChange={(e) => set({ [secondary]: e.currentTarget.value })} />
        <SimpleGrid cols={2}>
          <NumberInput label={t('common.qty')} min={0} decimalScale={2} value={v.qty} onChange={(x) => set({ qty: Number(x) || 0 })} />
          <Select label={t('item.unit')} value={v.unit} onChange={(x) => x && set({ unit: x as OrderItem['unit'] })} data={(['pcs', 'h', 'l', 'set'] as const).map((u) => ({ value: u, label: t(`unit.${u}`) }))} allowDeselect={false} />
        </SimpleGrid>
        {v.kind === 'part' && (
          <>
            <SimpleGrid cols={2}>
              <TextInput label={t('item.partNumber')} value={v.partNumber ?? ''} onChange={(e) => set({ partNumber: e.currentTarget.value })} />
              <TextInput label={t('item.brand')} value={v.brand ?? ''} onChange={(e) => set({ brand: e.currentTarget.value })} />
            </SimpleGrid>
            <Switch label={t('item.customerSupplied')} description={t('item.customerSuppliedHint')} checked={!!v.customerSupplied} onChange={(e) => set({ customerSupplied: e.currentTarget.checked })} />
            {!v.customerSupplied && (
              <MoneyInput
                label={t('item.costPrice')}
                description={t('item.costPriceHint', { pct: s.defaultMarkupBp / 100 })}
                value={v.costPriceFils}
                onChange={(c) => set({ costPriceFils: c, unitPriceFils: !v.unitPriceFils || v.unitPriceFils === markup(v.costPriceFils) ? markup(c) ?? 0 : v.unitPriceFils })}
              />
            )}
          </>
        )}
        {!v.customerSupplied && <PriceInput label={v.kind === 'labor' && v.unit === 'h' ? t('item.pricePerHour') : t('item.unitPrice')} net={v.unitPriceFils} onChange={(n) => set({ unitPriceFils: n ?? 0 })} settings={s} />}
        {v.kind === 'labor' && v.unit === 'h' && (
          <Button variant="subtle" size="xs" onClick={() => set({ unitPriceFils: s.laborRateFils })}>{t('item.useLaborRate', { rate: (s.laborRateFils / 100).toFixed(2) })}</Button>
        )}
        {v.block === 'B' && (
          <SimpleGrid cols={2}>
            <PriceInput label={t('item.priceMin')} net={v.priceMinFils} onChange={(n) => set({ priceMinFils: n })} settings={s} />
            <PriceInput label={t('item.priceMax')} net={v.priceMaxFils} onChange={(n) => set({ priceMaxFils: n })} settings={s} />
          </SimpleGrid>
        )}
        {(v.block === 'C' || extra?.urgency) && (
          <div>
            <Text size="sm" fw={500} mb={4}>{t('item.urgency')}</Text>
            <SegmentedControl fullWidth value={v.urgency ?? ''} onChange={(x) => set({ urgency: x as Urgency })} data={(['red', 'yellow', 'green'] as const).map((u) => ({ value: u, label: t(`urgency.${u}`) }))} />
          </div>
        )}
        {v.block !== 'A' && (
          <TextInput label={t('item.ifNotDone')} value={(lang === 'ru' ? v.ifNotDoneRu : v.ifNotDoneEn) ?? ''} onChange={(e) => set(lang === 'ru' ? { ifNotDoneRu: e.currentTarget.value } : { ifNotDoneEn: e.currentTarget.value })} />
        )}
        <Group justify="space-between">
          <Text size="sm" c="dimmed">{t('item.lineTotal')}: <Money fils={itemAmounts({ ...(v as OrderItem) }).gross} /></Text>
          <Button onClick={save} loading={busy}>{t('common.save')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function ItemRow({ item, b, editable, onEdit, right }: { item: OrderItem; b: OrderBundle; editable?: boolean; onEdit?: () => void; right?: ReactNode }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run } = useAction();
  const a = itemAmounts(item);
  const r = itemRangeGross(item);
  return (
    <Paper withBorder p="xs">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text size="sm" fw={500}>
            {item.urgency ? { red: '🔴 ', yellow: '🟡 ', green: '🟢 ' }[item.urgency] : ''}
            {itemTitle(item, lang)}
          </Text>
          <Text size="xs" c="dimmed">
            {t(`item.kind.${item.kind}`)} · {item.qty} {t(`unit.${item.unit}`)}
            {item.partNumber ? ` · ${item.partNumber}` : ''}
            {item.customerSupplied ? ` · ${t('item.customerSupplied')}` : ''}
            {item.kind === 'part' && item.procurementStatus ? ` · ${t(`proc.${item.procurementStatus}`)}` : ''}
          </Text>
          <Group gap={4}>
            <ItemStateBadge item={item} />
            {item.done && <Badge color="teal" variant="light">{t('item.done')}</Badge>}
          </Group>
        </Stack>
        <Stack gap={2} align="flex-end">
          {item.block === 'B' && r.min !== r.max ? (
            <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
              <Money fils={r.min} size="sm" /> – <Money fils={r.max} size="sm" />
            </Text>
          ) : (
            <Money fils={a.gross} size="sm" fw={600} />
          )}
          {b.settings && item.kind === 'part' && item.costPriceFils !== undefined && !item.customerSupplied && (
            <Text size="10px" c="dimmed">{t('item.margin')}: <Money fils={a.net - Math.round(item.costPriceFils * item.qty)} size="10px" /></Text>
          )}
          <Group gap={2}>
            {right}
            {editable && item.approvalState === 'draft' && (
              <>
                <ActionIcon variant="subtle" onClick={onEdit} aria-label={t('common.edit')}><IconPencil size={16} /></ActionIcon>
                <ActionIcon variant="subtle" color="red" onClick={() => run(() => removeItem(item.id))} aria-label={t('common.delete')}><IconTrash size={16} /></ActionIcon>
              </>
            )}
          </Group>
        </Stack>
      </Group>
    </Paper>
  );
}

export function DoneToggle({ item }: { item: OrderItem }) {
  const { t } = useTranslation();
  const { run } = useAction();
  if (item.approvalState !== 'approved') return null;
  return <Checkbox size="md" checked={item.done} onChange={(e) => run(() => setDone(item.id, e.currentTarget.checked))} aria-label={t('item.done')} />;
}

type Choice = DecisionKind | 'skip';

/** Record the customer's answers for a version (from WhatsApp, phone or in person). */
export function DecisionModal({ b, version, opened, onClose, onVerbal }: { b: OrderBundle; version: EstimateVersion; opened: boolean; onClose: () => void; onVerbal: (r: SendRequest) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const lang = version.language;
  const items = version.items
    .map((s) => ({ s, item: b.items.find((i) => i.id === s.itemId) }))
    .filter((x): x is { s: typeof x.s; item: OrderItem } => !!x.item && isAwaitingClient(x.item));
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const defaultVia: DecisionVia = version.sentVia === 'in_person' ? 'in_person' : version.sentVia === 'phone' ? 'phone' : 'messenger';
  const [via, setVia] = useState<DecisionVia>(defaultVia);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (opened) {
      setChoices(Object.fromEntries(items.map(({ item }) => [item.id, 'skip' as Choice])));
      setVia(defaultVia);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);
  const isBInitial = (i: OrderItem) => i.block === 'B' && !i.bNeeded;
  const allYes = () => setChoices(Object.fromEntries(items.map(({ item }) => [item.id, isBInitial(item) ? 'do_if_needed' : 'approve'])));
  const save = () =>
    run(async () => {
      const list = Object.entries(choices).filter(([, c]) => c !== 'skip').map(([itemId, decision]) => ({ itemId, decision: decision as DecisionKind }));
      if (!list.length) return;
      await recordDecisions(version.id, list, via, note);
      if (via === 'phone' || via === 'in_person') {
        const approved = list.filter((d) => d.decision !== 'decline').map((d) => version.items.find((s) => s.itemId === d.itemId)!).map((s) => ({ title: s.title, gross: s.maxGross ?? s.gross }));
        const declined = list.filter((d) => d.decision === 'decline').map((d) => ({ title: version.items.find((s) => s.itemId === d.itemId)!.title }));
        onVerbal({
          text: verbalConfirmation({ customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name }, lang, approved, declined),
          template: 'verbalConfirmation',
          lang,
          orderId: b.order.id,
        });
      }
      onClose();
    }, 'decision.saved');
  return (
    <Modal opened={opened} onClose={onClose} title={t('decision.title', { n: version.number })} size="lg">
      <Stack>
        <div>
          <Text size="sm" fw={500} mb={4}>{t('decision.via')}</Text>
          <SegmentedControl fullWidth value={via} onChange={(x) => setVia(x as DecisionVia)} data={(['messenger', 'phone', 'in_person'] as const).map((x) => ({ value: x, label: t(`via.${x}`) }))} />
          {via !== 'messenger' && <Text size="xs" c="orange" mt={4}>{t('decision.verbalHint')}</Text>}
        </div>
        <Button variant="light" onClick={allYes}>{t('decision.allYes')}</Button>
        {items.length === 0 && <Alert>{t('decision.nothing')}</Alert>}
        {items.map(({ s, item }) => (
          <Paper key={item.id} withBorder p="xs">
            <Group justify="space-between" wrap="nowrap" mb={6}>
              <Text size="sm" fw={500}>{s.title}</Text>
              {s.minGross !== undefined && s.maxGross !== undefined && s.minGross !== s.maxGross ? (
                <Text size="sm"><Money fils={s.minGross} size="sm" /> – <Money fils={s.maxGross} size="sm" /></Text>
              ) : (
                <Money fils={s.gross} size="sm" />
              )}
            </Group>
            <SegmentedControl
              fullWidth
              size="xs"
              value={choices[item.id] ?? 'skip'}
              onChange={(x) => setChoices((c) => ({ ...c, [item.id]: x as Choice }))}
              data={
                isBInitial(item)
                  ? [
                      { value: 'do_if_needed', label: t('decision.doIfNeeded') },
                      { value: 'call_me', label: t('decision.callMe') },
                      { value: 'decline', label: t('decision.decline') },
                      { value: 'skip', label: '—' },
                    ]
                  : [
                      { value: 'approve', label: t('decision.approve') },
                      { value: 'decline', label: t('decision.decline') },
                      { value: 'skip', label: '—' },
                    ]
              }
            />
          </Paper>
        ))}
        <Textarea label={t('common.notes')} placeholder={t('decision.notePlaceholder')} value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize />
        <Button onClick={save} loading={busy}>{t('common.save')}</Button>
      </Stack>
    </Modal>
  );
}

export function ResolveBModal({ b, item, onClose }: { b: OrderBundle; item: OrderItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const [net, setNet] = useState<number | undefined>();
  useEffect(() => {
    if (item) setNet(item.priceMaxFils ?? Math.round(item.unitPriceFils * item.qty));
  }, [item]);
  if (!item) return null;
  return (
    <Modal opened onClose={onClose} title={itemTitle(item, lang)}>
      <Stack>
        <Text size="sm">{t('bresolve.question')}</Text>
        <Text size="xs" c="dimmed">{item.bChoice === 'do_if_needed' ? t('bresolve.preapproved') : t('bresolve.callMe')}</Text>
        <PriceInput label={t('bresolve.actualPrice')} net={net} onChange={setNet} settings={b.settings} vatRateBp={item.vatRateBp} />
        <Group grow>
          <Button variant="default" loading={busy} onClick={() => run(async () => { await resolveB(item.id, false, 0); onClose(); }, 'common.saved')}>{t('bresolve.notNeeded')}</Button>
          <Button loading={busy} onClick={() => run(async () => { const k = await resolveB(item.id, true, net ?? 0); onClose(); return k; }, 'common.saved')}>{t('bresolve.needed')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function VersionCard({ v, b, actions }: { v: EstimateVersion; b: OrderBundle; actions?: ReactNode }) {
  const { t } = useTranslation();
  const decisions = b.decisions.filter((d) => d.versionId === v.id);
  return (
    <Paper withBorder p="sm">
      <Group justify="space-between" mb={4}>
        <Text fw={700}>v{v.number} · {t(`versionKind.${v.kind}`)}</Text>
        <Badge color={v.status === 'answered' ? 'green' : 'yellow'} variant="light">{t(`versionStatus.${v.status}`)}</Badge>
      </Group>
      {v.reason && <Text size="sm">{v.reason}</Text>}
      <Text size="xs" c="dimmed">
        {formatDateTime(v.sentAt)} · {t(`sendVia.${v.sentVia}`)} · {t('version.validUntil')} {formatDateTime(v.validUntil).slice(0, 10)}
      </Text>
      <Stack gap={2} mt={6}>
        {v.items.map((s) => {
          const d = decisions.filter((x) => x.itemId === s.itemId).pop();
          return (
            <Group key={s.itemId} justify="space-between" wrap="nowrap">
              <Text size="sm">
                {d ? (d.decision === 'decline' ? '❌' : d.decision === 'approve' ? '✅' : '🔧') : '⏳'} {s.title}
                {d && <Text span size="xs" c="dimmed"> · {t(`via.${d.via}`)} {formatDateTime(d.decidedAt)}</Text>}
              </Text>
              {s.minGross !== undefined && s.maxGross !== undefined && s.minGross !== s.maxGross ? (
                <Text size="sm" style={{ whiteSpace: 'nowrap' }}><Money fils={s.minGross} size="sm" /> – <Money fils={s.maxGross} size="sm" /></Text>
              ) : (
                <Money fils={s.gross} size="sm" />
              )}
            </Group>
          );
        })}
      </Stack>
      <Group justify="space-between" mt={6}>
        <Text size="sm" c="dimmed">{t('estimate.fixed')}: <Money fils={v.fixedGross} size="sm" />{v.maxGross !== v.fixedGross && <> · {t('estimate.upTo')}: <Money fils={v.maxGross} size="sm" /></>}</Text>
        <Group gap={4}>{actions}</Group>
      </Group>
    </Paper>
  );
}

/** Suggestions "usually also needed" for templates used in this order. */
export function useSuggestions(b: OrderBundle | undefined) {
  const [list, setList] = useState<{ id: string; titleRu: string; titleEn: string; min: number; max: number; trigger: string }[]>([]);
  const key = b ? b.items.map((i) => i.templateId + (i.titleRu ?? '') + i.approvalState).join('|') : '';
  useEffect(() => {
    if (!b) return;
    let alive = true;
    void (async () => {
      const ids = [...new Set(b.items.map((i) => i.templateId).filter(Boolean))] as string[];
      const templates = (await db.jobTemplates.bulkGet(ids)).filter(Boolean);
      const out: typeof list = [];
      for (const tpl of templates) {
        const rules = await db.relatedRules.where('triggerTemplateCode').equals(tpl!.code).toArray();
        for (const r of rules) {
          const exists = b.items.some((i) => (i.titleRu ?? '').toLowerCase() === r.titleRu.toLowerCase() || (i.titleEn ?? '').toLowerCase() === r.titleEn.toLowerCase());
          if (!exists) out.push({ id: r.id, titleRu: r.titleRu, titleEn: r.titleEn, min: r.priceMinFils, max: r.priceMaxFils, trigger: tpl!.titleRu + ' / ' + tpl!.titleEn });
        }
      }
      if (alive) setList(out);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return list;
}

export async function addSuggestion(orderId: string, s: { titleRu: string; titleEn: string; min: number; max: number }) {
  return addItem(orderId, {
    kind: 'part',
    block: 'B',
    titleRu: s.titleRu,
    titleEn: s.titleEn,
    qty: 1,
    unit: 'pcs',
    unitPriceFils: Math.round((s.min + s.max) / 2),
    priceMinFils: s.min,
    priceMaxFils: s.max,
  });
}
