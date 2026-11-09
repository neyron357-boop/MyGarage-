import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import {
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconHourglassHigh,
  IconPackage,
  IconPencil,
  IconPercentage,
  IconReceipt2,
  IconTool,
  IconTrash,
  IconWand,
  type Icon,
} from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { formatDateTime } from '../../domain/dates';
import { isAwaitingClient, isAwaitingDisassembly, itemAmounts, itemRangeGross, itemTitle } from '../../domain/items';
import { formatAed, roundFils } from '../../domain/money';
import { enteredFromNet, netFromEntered, rateFor, switchVatMode, vatModeOf, type Amounts, type VatMode } from '../../domain/vat';
import type { Block, DecisionKind, DecisionVia, EstimateVersion, ItemKind, OrderItem, Urgency } from '../../domain/types';
import { addItem, recordDecisions, removeItem, resolveB, restoreItem, setDone, updateItem, withdrawItems, type NewItem } from '../../services/estimate';
import { verbalConfirmation } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { haptic } from '../../ui/haptics';
import { ConfirmModal, Money, MoneyInput, SelectCard, undoToast } from '../../ui/components';
import { useAction, useLang } from '../../ui/hooks';
import type { SendRequest } from '../../ui/SendDialog';

export const BLOCK_COLOR: Record<Block, string> = { A: 'cobalt', B: 'orange', C: 'teal' };
export const KIND_ICON: Record<ItemKind, Icon> = { labor: IconTool, part: IconPackage, fee: IconReceipt2, discount: IconPercentage };
const URGENCY_COLOR: Record<Urgency, string> = { red: 'red', yellow: 'yellow', green: 'green' };

/**
 * Price entry: the typed amount is counted as `mode` says (VAT on top, VAT inside, or no VAT);
 * always returns the net price in fils. `rateBp` is the rate of a taxed line.
 */
export function PriceInput({ label, net, onChange, rateBp, mode, hint }: { label: string; net: number | undefined; onChange: (net: number | undefined) => void; rateBp: number; mode: VatMode; hint?: boolean }) {
  const { t } = useTranslation();
  return (
    <MoneyInput
      label={label}
      description={hint ? t(`item.vatHint.${mode}`, { rate: rateBp / 100 }) : undefined}
      value={net === undefined ? undefined : enteredFromNet(net, rateBp, mode)}
      onChange={(v) => onChange(v === undefined ? undefined : netFromEntered(v, rateBp, mode))}
    />
  );
}

/**
 * How this line's price is counted — VAT added on top, VAT already inside, or no VAT on the line —
 * and what the line comes to for the customer.
 */
export function VatModeField({ mode, onChange, rateBp, total }: { mode: VatMode; onChange: (mode: VatMode) => void; rateBp: number; total?: Amounts }) {
  const { t } = useTranslation();
  const lang = useLang();
  const rate = rateBp / 100;
  return (
    <div>
      <SegmentedControl
        fullWidth
        value={mode}
        onChange={(m) => onChange(m as VatMode)}
        aria-label={t('item.vatMode.label')}
        data={(['add', 'incl', 'none'] as const).map((m) => ({ value: m, label: t(`item.vatMode.${m}`, { rate }) }))}
      />
      <Text size="xs" c="dimmed" mt={6} className="tnum">
        {total && total.gross !== 0
          ? mode === 'none'
            ? t('item.vatTotalNone', { total: formatAed(total.gross, lang) })
            : t('item.vatTotal', { total: formatAed(total.gross, lang), vat: formatAed(total.vat, lang, false) })
          : t(`item.vatHint.${mode}`, { rate })}
      </Text>
    </div>
  );
}

export function BlockChip({ block }: { block: Block }) {
  return (
    <Badge color={BLOCK_COLOR[block]} variant="filled" size="sm" w={22} h={22} p={0} radius="sm" style={{ display: 'inline-grid', placeItems: 'center' }}>
      {block}
    </Badge>
  );
}

export function ItemStateBadge({ item }: { item: OrderItem }) {
  const { t } = useTranslation();
  if (isAwaitingDisassembly(item))
    return (
      <Badge color="violet" leftSection={<IconWand size={12} />}>
        {t(`item.bChoice.${item.bChoice}`)}
      </Badge>
    );
  const map = {
    draft: { color: 'gray', icon: IconPencil },
    pending: { color: 'yellow', icon: IconHourglassHigh },
    approved: { color: 'green', icon: IconCircleCheck },
    declined: { color: 'red', icon: IconCircleX },
    cancelled: { color: 'gray', icon: IconCircleX },
  } as const;
  const m = map[item.approvalState];
  return (
    <Badge color={m.color} leftSection={<m.icon size={12} />}>
      {t(`item.state.${item.approvalState}`)}
    </Badge>
  );
}

const blank = (block: Block): NewItem => ({ kind: 'labor', block, qty: 1, unit: 'pcs', unitPriceFils: 0 });

export function ItemModal({ b, item, block, opened, onClose, extra }: { b: OrderBundle; item?: OrderItem; block?: Block; opened: boolean; onClose: () => void; extra?: Partial<OrderItem> }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const s = b.settings;
  const [v, setV] = useState<NewItem>(blank(block ?? 'A'));
  // How the typed prices are counted: VAT on top, inside, or none (the line's rate becomes 0).
  const [mode, setMode] = useState<VatMode>('add');
  const taxRate = item?.vatRateBp ? item.vatRateBp : s.vatRateBp;
  useEffect(() => {
    if (opened) {
      setV(item ? { ...item } : { ...blank(block ?? 'A'), ...extra, block: block ?? extra?.block ?? 'A' });
      setMode(vatModeOf(item ? item.vatRateBp : extra?.vatRateBp, s.pricesIncludeVat));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, item, block]);
  const set = (p: Partial<NewItem>) => setV((x) => ({ ...x, ...p }));
  /** Another way of counting VAT keeps the typed amounts and counts them anew. */
  const changeMode = (m: VatMode) => {
    const conv = (n: number) => switchVatMode(n, taxRate, mode, m);
    setV((x) => {
      const next = { ...x, unitPriceFils: conv(x.unitPriceFils ?? 0) };
      if (x.priceMinFils !== undefined) next.priceMinFils = conv(x.priceMinFils);
      if (x.priceMaxFils !== undefined) next.priceMaxFils = conv(x.priceMaxFils);
      return next;
    });
    setMode(m);
  };
  const markup = (cost: number | undefined) => (cost === undefined ? undefined : roundFils(cost * (1 + s.defaultMarkupBp / 10000)));
  const save = () =>
    run(async () => {
      const patch = { ...v, unitPriceFils: v.unitPriceFils ?? 0, vatRateBp: rateFor(mode, taxRate) };
      if (item) await updateItem(item.id, patch);
      else await addItem(b.order.id, patch);
      onClose();
    }, 'common.saved');
  const primary = lang === 'ru' ? 'titleRu' : 'titleEn';
  const secondary = lang === 'ru' ? 'titleEn' : 'titleRu';
  const otherLang = lang === 'ru' ? 'EN' : 'RU';
  return (
    <Modal opened={opened} onClose={onClose} title={item ? t('item.edit') : t('item.new')} size="lg">
      <Stack gap="md">
        <SegmentedControl
          fullWidth
          value={v.kind}
          onChange={(k) => set({ kind: k as ItemKind, unit: k === 'labor' ? v.unit : 'pcs' })}
          data={(['labor', 'part', 'fee', 'discount'] as const).map((k) => ({ value: k, label: t(`item.kind.${k}`) }))}
        />
        <SimpleGrid cols={3} spacing="xs">
          {(['A', 'B', 'C'] as const).map((x) => (
            <SelectCard key={x} active={v.block === x} onClick={() => set({ block: x })}>
              {/* Letter above the name: three cards side by side on a phone keep the whole word. */}
              <Stack gap={4} align="center">
                <BlockChip block={x} />
                <Text size="sm" fw={700} ta="center" lh={1.2}>
                  {t(`block.${x}.name`)}
                </Text>
              </Stack>
            </SelectCard>
          ))}
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt={-8}>
          {t(`block.${v.block}.hint`)}
        </Text>
        <TextInput label={t('item.title')} required value={v[primary] ?? ''} onChange={(e) => set({ [primary]: e.currentTarget.value })} data-autofocus />
        <TextInput label={`${t('item.titleOther')} (${otherLang})`} description={t('item.titleOtherHint')} value={v[secondary] ?? ''} onChange={(e) => set({ [secondary]: e.currentTarget.value })} />
        <SimpleGrid cols={2}>
          <NumberInput label={t('common.qty')} min={0} decimalScale={2} value={v.qty} onChange={(x) => set({ qty: Number(x) || 0 })} />
          <Select label={t('item.unit')} value={v.unit} onChange={(x) => x && set({ unit: x as OrderItem['unit'] })} data={(['pcs', 'h', 'l', 'set'] as const).map((u) => ({ value: u, label: t(`unit.${u}`) }))} allowDeselect={false} />
        </SimpleGrid>
        {v.kind === 'part' && (
          <Box className="surface-soft" p="sm">
            <Stack gap="sm">
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
            </Stack>
          </Box>
        )}
        {!v.customerSupplied && (
          <PriceInput label={v.kind === 'labor' && v.unit === 'h' ? t('item.pricePerHour') : t('item.unitPrice')} net={v.unitPriceFils} onChange={(n) => set({ unitPriceFils: n ?? 0 })} rateBp={taxRate} mode={mode} />
        )}
        {v.kind === 'labor' && v.unit === 'h' && (
          <Button variant="subtle" size="compact-sm" w="fit-content" onClick={() => set({ unitPriceFils: s.laborRateFils })}>
            {t('item.useLaborRate', { rate: (s.laborRateFils / 100).toFixed(2) })}
          </Button>
        )}
        {v.block === 'B' && (
          <SimpleGrid cols={2}>
            <PriceInput label={t('item.priceMin')} net={v.priceMinFils} onChange={(n) => set({ priceMinFils: n })} rateBp={taxRate} mode={mode} />
            <PriceInput label={t('item.priceMax')} net={v.priceMaxFils} onChange={(n) => set({ priceMaxFils: n })} rateBp={taxRate} mode={mode} />
          </SimpleGrid>
        )}
        {!v.customerSupplied && <VatModeField mode={mode} onChange={changeMode} rateBp={taxRate} />}
        {(v.block === 'C' || extra?.urgency) && (
          <div>
            <Text size="sm" fw={500} mb={6}>
              {t('item.urgency')}
            </Text>
            <UrgencyPicker value={v.urgency} onChange={(u) => set({ urgency: u })} />
          </div>
        )}
        {v.block !== 'A' && (
          <TextInput label={t('item.ifNotDone')} value={(lang === 'ru' ? v.ifNotDoneRu : v.ifNotDoneEn) ?? ''} onChange={(e) => set(lang === 'ru' ? { ifNotDoneRu: e.currentTarget.value } : { ifNotDoneEn: e.currentTarget.value })} />
        )}
        <Group justify="space-between" mt="xs" wrap="nowrap">
          <div>
            <Text size="xs" c="dimmed">
              {mode === 'none' ? t('item.lineTotalNoVat') : t('item.lineTotal')}
            </Text>
            <Text size="lg" fw={700}>
              <Money fils={itemAmounts({ ...(v as OrderItem), vatRateBp: rateFor(mode, taxRate) }).gross} />
            </Text>
          </div>
          <Button onClick={save} loading={busy} leftSection={<IconCheck size={18} />}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function UrgencyPicker({ value, onChange }: { value?: Urgency; onChange: (u: Urgency) => void }) {
  const { t } = useTranslation();
  return (
    <SimpleGrid cols={3} spacing="xs">
      {(['red', 'yellow', 'green'] as const).map((u) => (
        <SelectCard key={u} active={value === u} onClick={() => onChange(u)}>
          <Stack gap={4} align="flex-start">
            <span className="stage-dot" style={{ width: 12, height: 12, background: `var(--mantine-color-${URGENCY_COLOR[u]}-6)` }} />
            <Text size="xs" fw={700} lh={1.25}>
              {t(`urgencyShort.${u}`)}
            </Text>
          </Stack>
        </SelectCard>
      ))}
    </SimpleGrid>
  );
}

export function ItemRow({ item, editable, onEdit, right }: { item: OrderItem; b?: OrderBundle; editable?: boolean; onEdit?: () => void; right?: ReactNode }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run } = useAction();
  // An item waiting for the customer's answer can still be changed or removed (it goes back to draft).
  const [ask, setAsk] = useState<'edit' | 'delete' | null>(null);
  const a = itemAmounts(item);
  const r = itemRangeGross(item);
  const KI = KIND_ICON[item.kind];
  const margin = item.kind === 'part' && item.costPriceFils !== undefined && !item.customerSupplied ? a.net - Math.round(item.costPriceFils * item.qty) : undefined;
  const muted = item.approvalState === 'declined' || item.approvalState === 'cancelled';
  return (
    <Box className="surface" p="sm" style={{ opacity: muted ? 0.72 : 1 }}>
      <Group wrap="nowrap" align="flex-start" gap="sm">
        <ThemeIcon variant="light" color={item.done ? 'green' : 'gray'} size={38} radius="md" style={{ flexShrink: 0, transition: 'background-color 200ms ease, color 200ms ease' }}>
          {item.done ? <IconCheck size={20} className="pop-in" /> : <KI size={19} stroke={1.8} />}
        </ThemeIcon>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
            <Text fw={600} size="sm" style={{ textDecoration: muted ? 'line-through' : undefined }}>
              {item.urgency && <span className="stage-dot" style={{ background: `var(--mantine-color-${URGENCY_COLOR[item.urgency]}-6)`, marginRight: 6, verticalAlign: 1 }} />}
              {itemTitle(item, lang)}
            </Text>
            <Box ta="right" style={{ flexShrink: 0 }}>
              {item.block === 'B' && r.min !== r.max ? (
                <Text size="sm" fw={700} className="tnum">
                  <Money fils={r.min} fw={700} /> – <Money fils={r.max} fw={700} />
                </Text>
              ) : (
                <Money fils={a.gross} size="sm" fw={700} />
              )}
            </Box>
          </Group>
          <Text size="xs" c="dimmed" mt={2}>
            {t(`item.kind.${item.kind}`)} · {item.qty} {t(`unit.${item.unit}`)}
            {item.partNumber ? ` · ${item.partNumber}` : ''}
            {item.customerSupplied ? ` · ${t('item.customerSupplied')}` : ''}
            {item.vatRateBp === 0 && !item.customerSupplied ? ` · ${t('item.noVat')}` : ''}
            {item.kind === 'part' && item.procurementStatus && !item.customerSupplied ? ` · ${t(`proc.${item.procurementStatus}`)}` : ''}
            {margin !== undefined ? ` · ${t('item.margin')} ${formatAed(margin, lang, false)}` : ''}
          </Text>
          <Group justify="space-between" mt={8} gap={6}>
            <Group gap={6}>
              <ItemStateBadge item={item} />
            </Group>
            <Group gap={6} wrap="nowrap">
              {right}
              {editable && item.approvalState === 'draft' && (
                <>
                  <Tooltip label={t('common.edit')}>
                    <ActionIcon variant="subtle" color="gray" onClick={onEdit} aria-label={t('common.edit')}>
                      <IconPencil size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t('common.delete')}>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={t('common.delete')}
                      onClick={() =>
                        run(async () => {
                          const removed = await removeItem(item.id);
                          if (removed) undoToast(t('item.removed', { title: itemTitle(removed, lang) }), t('common.undo'), () => void restoreItem(removed));
                        })
                      }
                    >
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                </>
              )}
              {editable && isAwaitingClient(item) && (
                <>
                  <ActionIcon variant="subtle" color="gray" onClick={() => setAsk('edit')} aria-label={t('common.edit')}>
                    <IconPencil size={18} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="red" onClick={() => setAsk('delete')} aria-label={t('common.delete')}>
                    <IconTrash size={18} />
                  </ActionIcon>
                </>
              )}
            </Group>
          </Group>
        </Box>
      </Group>
      <ConfirmModal
        opened={!!ask}
        onClose={() => setAsk(null)}
        title={ask === 'delete' ? t('item.withdrawDeleteTitle') : t('item.withdrawEditTitle')}
        confirmLabel={ask === 'delete' ? t('common.delete') : t('common.edit')}
        color={ask === 'delete' ? 'red' : undefined}
        onConfirm={async () => {
          const what = ask;
          const n = await run(() => withdrawItems([item.id], { cancel: what === 'delete' }));
          if (n && what === 'edit') onEdit?.();
          return true;
        }}
      >
        <Text size="sm">{t('item.withdrawText')}</Text>
      </ConfirmModal>
    </Box>
  );
}

export function DoneToggle({ item }: { item: OrderItem }) {
  const { t } = useTranslation();
  const { run } = useAction();
  if (item.approvalState !== 'approved') return null;
  return (
    <Button
      size="compact-sm"
      variant={item.done ? 'light' : 'filled'}
      color={item.done ? 'green' : 'cobalt'}
      leftSection={item.done ? <IconCheck size={14} className="pop-in" /> : undefined}
      onClick={() => {
        if (!item.done) haptic('light');
        void run(() => setDone(item.id, !item.done));
      }}
      aria-pressed={item.done}
    >
      {item.done ? t('item.done') : t('item.markDone')}
    </Button>
  );
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
  const answered = Object.values(choices).filter((c) => c !== 'skip').length;
  const save = () =>
    run(async () => {
      const list = Object.entries(choices)
        .filter(([, c]) => c !== 'skip')
        .map(([itemId, decision]) => ({ itemId, decision: decision as DecisionKind }));
      if (!list.length) return;
      await recordDecisions(version.id, list, via, note);
      if (via === 'phone' || via === 'in_person') {
        const approved = list
          .filter((d) => d.decision !== 'decline')
          .map((d) => version.items.find((s) => s.itemId === d.itemId)!)
          .map((s) => ({ title: s.title, gross: s.maxGross ?? s.gross }));
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
      <Stack gap="md">
        <div>
          <Text size="sm" fw={600} mb={6}>
            {t('decision.via')}
          </Text>
          <SegmentedControl fullWidth value={via} onChange={(x) => setVia(x as DecisionVia)} data={(['messenger', 'phone', 'in_person'] as const).map((x) => ({ value: x, label: t(`via.${x}`) }))} />
          {via !== 'messenger' && (
            <Text size="xs" c="orange" mt={6}>
              {t('decision.verbalHint')}
            </Text>
          )}
        </div>
        {items.length === 0 ? (
          <Alert>{t('decision.nothing')}</Alert>
        ) : (
          <Button variant="light" color="green" leftSection={<IconCircleCheck size={18} />} onClick={allYes}>
            {t('decision.allYes')}
          </Button>
        )}
        <Stack gap="xs">
          {items.map(({ s, item }) => {
            const c = choices[item.id] ?? 'skip';
            const opts: { v: Choice; label: string; color: string }[] = isBInitial(item)
              ? [
                  { v: 'do_if_needed', label: t('decision.doIfNeeded'), color: 'green' },
                  { v: 'call_me', label: t('decision.callMe'), color: 'cobalt' },
                  { v: 'decline', label: t('decision.decline'), color: 'red' },
                ]
              : [
                  { v: 'approve', label: t('decision.approve'), color: 'green' },
                  { v: 'decline', label: t('decision.decline'), color: 'red' },
                ];
            return (
              <Box key={item.id} className="surface-soft" p="sm">
                <Group justify="space-between" wrap="nowrap" mb={8} align="flex-start">
                  <Group gap={8} wrap="nowrap">
                    <BlockChip block={s.block} />
                    <Text size="sm" fw={600}>
                      {s.title}
                    </Text>
                  </Group>
                  <Text size="sm" fw={700} className="tnum" style={{ whiteSpace: 'nowrap' }}>
                    {s.minGross !== undefined && s.maxGross !== undefined && s.minGross !== s.maxGross ? (
                      <>
                        <Money fils={s.minGross} /> – <Money fils={s.maxGross} />
                      </>
                    ) : (
                      <Money fils={s.gross} />
                    )}
                  </Text>
                </Group>
                <SimpleGrid cols={opts.length} spacing={6}>
                  {opts.map((o) => (
                    <Button
                      key={o.v}
                      size="sm"
                      h="auto"
                      mih={38}
                      py={6}
                      px={6}
                      variant={c === o.v ? 'filled' : 'default'}
                      color={o.color}
                      aria-pressed={c === o.v}
                      styles={{ label: { whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.2 } }}
                      onClick={() => {
                        haptic('selection');
                        setChoices((x) => ({ ...x, [item.id]: c === o.v ? 'skip' : o.v }));
                      }}
                    >
                      {o.label}
                    </Button>
                  ))}
                </SimpleGrid>
              </Box>
            );
          })}
        </Stack>
        <Textarea label={t('common.notes')} placeholder={t('decision.notePlaceholder')} value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={1} />
        <Button onClick={save} loading={busy} disabled={answered === 0}>
          {t('decision.saveN', { n: answered, total: items.length })}
        </Button>
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
        <Text size="sm" fw={600}>
          {t('bresolve.question')}
        </Text>
        <Alert color={item.bChoice === 'do_if_needed' ? 'green' : 'cobalt'}>{item.bChoice === 'do_if_needed' ? t('bresolve.preapproved') : t('bresolve.callMe')}</Alert>
        <PriceInput label={t('bresolve.actualPrice')} net={net} onChange={setNet} rateBp={item.vatRateBp || b.settings.vatRateBp} mode={vatModeOf(item.vatRateBp, b.settings.pricesIncludeVat)} hint />
        <Group grow>
          <Button variant="default" loading={busy} onClick={() => run(async () => { await resolveB(item.id, false, 0); onClose(); }, 'common.saved')}>
            {t('bresolve.notNeeded')}
          </Button>
          <Button loading={busy} onClick={() => run(async () => { const k = await resolveB(item.id, true, net ?? 0); onClose(); return k; }, 'common.saved')}>
            {t('bresolve.needed')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const DECISION_ICON = { approve: { icon: IconCircleCheck, color: 'green' }, decline: { icon: IconCircleX, color: 'red' }, call_me: { icon: IconWand, color: 'violet' }, do_if_needed: { icon: IconWand, color: 'violet' } } as const;

export function VersionCard({ v, b, actions }: { v: EstimateVersion; b: OrderBundle; actions?: ReactNode }) {
  const { t } = useTranslation();
  const decisions = b.decisions.filter((d) => d.versionId === v.id);
  return (
    <Box className="surface" p="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <ThemeIcon radius="xl" size={36} variant="light" color={v.number === 1 ? 'cobalt' : 'orange'} style={{ flexShrink: 0 }}>
            <Text fw={800} size="sm" className="display">
              v{v.number}
            </Text>
          </ThemeIcon>
          <div>
            <Text fw={700}>{t(`versionKind.${v.kind}`)}</Text>
            <Text size="xs" c="dimmed">
              {formatDateTime(v.sentAt)} · {t(`sendVia.${v.sentVia}`)}
            </Text>
          </div>
        </Group>
        <Badge color={v.status === 'answered' ? 'green' : v.status === 'withdrawn' ? 'gray' : 'yellow'}>{t(`versionStatus.${v.status}`)}</Badge>
      </Group>
      {v.reason && (
        <Text size="sm" mt="sm" fw={500}>
          {v.reason}
        </Text>
      )}
      <Stack gap={6} mt="sm">
        {v.items.map((s) => {
          const d = decisions.filter((x) => x.itemId === s.itemId).pop();
          const m = d ? DECISION_ICON[d.decision] : { icon: IconHourglassHigh, color: 'yellow' };
          return (
            <Group key={s.itemId} justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
              <Group gap={8} wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
                <m.icon size={18} color={`var(--mantine-color-${m.color}-6)`} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <Text size="sm">{s.title}</Text>
                  {d && (
                    <Text size="xs" c="dimmed">
                      {t(`via.${d.via}`)} · {formatDateTime(d.decidedAt)}
                    </Text>
                  )}
                </div>
              </Group>
              <Text size="sm" fw={600} className="tnum" style={{ whiteSpace: 'nowrap' }}>
                {s.minGross !== undefined && s.maxGross !== undefined && s.minGross !== s.maxGross ? (
                  <>
                    <Money fils={s.minGross} /> – <Money fils={s.maxGross} />
                  </>
                ) : (
                  <Money fils={s.gross} />
                )}
              </Text>
            </Group>
          );
        })}
      </Stack>
      <Box mt="sm" pt="sm" style={{ borderTop: '1px solid var(--app-hairline)' }}>
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Text size="sm" c="dimmed">
            {t('estimate.fixed')} <Money fils={v.fixedGross} />
            {v.maxGross !== v.fixedGross && (
              <>
                {' · '}
                {t('estimate.upTo')} <Money fils={v.maxGross} />
              </>
            )}
            {' · '}
            {t('version.validUntil')} {formatDateTime(v.validUntil).slice(0, 10)}
          </Text>
          <Group gap={6}>{actions}</Group>
        </Group>
      </Box>
    </Box>
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

