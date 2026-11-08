import { Autocomplete, Box, Button, Group, Modal, NumberInput, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCheck, IconFileTypePdf, IconPackage, IconPlus, IconSend, IconTool, IconUserPlus } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { activeInvoice } from '../../domain/invoice';
import { itemAmounts, itemTitle } from '../../domain/items';
import { formatAed } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import { fromNet, sumAmounts } from '../../domain/vat';
import type { Lang, OrderItem } from '../../domain/types';
import { invoicePdf, openPdf } from '../../services/documents';
import { addItem, removeItem, restoreItem, updateItem } from '../../services/estimate';
import { simpleMessage } from '../../services/messages';
import { quickInvoice } from '../../services/money';
import { bundleAmountDue, changeStage, type OrderBundle } from '../../services/orders';
import { haptic } from '../../ui/clipboard';
import { ConfirmModal, EmptyState, List, ListRow, Money, MoneyInput, PageHeader, PageSkeleton, PlateText, StickyBar, SuccessMark, undoToast } from '../../ui/components';
import { typedOnly, useAction, useLang, useOrderBundle } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { PriceInput } from '../estimate/components';
import { CustomerModal } from '../customers/forms';
import { PaymentModal } from './PaymentPanel';

type Kind = 'labor' | 'part';
type Suggestion = { titleRu: string; titleEn: string; price: number; uses: number };
type Suggestions = { list: Map<string, Suggestion>; top: string[] };

/**
 * Titles typed before and from the price list, for one-tap entry: the latest price of each title,
 * and the most used ones first (they become the quick chips).
 */
function useSuggestions(lang: Lang) {
  return useLiveQuery(async () => {
    const [templates, items] = await Promise.all([db.jobTemplates.toArray(), db.items.toArray()]);
    const maps: Record<Kind, Map<string, Suggestion>> = { labor: new Map(), part: new Map() };
    const put = (kind: Kind, s: Omit<Suggestion, 'uses'>, used: boolean) => {
      const title = (lang === 'ru' ? s.titleRu || s.titleEn : s.titleEn || s.titleRu).trim();
      if (!title) return;
      const had = maps[kind].get(title);
      if (had) had.uses += used ? 1 : 0;
      else maps[kind].set(title, { ...s, uses: used ? 1 : 0 });
    };
    // Newest first, so a title keeps its latest price.
    const sorted = [...items].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    for (const it of sorted) if (it.kind === 'labor' || it.kind === 'part') put(it.kind, { titleRu: it.titleRu ?? '', titleEn: it.titleEn ?? '', price: it.unitPriceFils }, true);
    for (const tpl of templates) for (const ti of tpl.items) if (ti.kind === 'labor' || ti.kind === 'part') put(ti.kind, { titleRu: ti.titleRu, titleEn: ti.titleEn, price: ti.unitPriceFils }, false);
    const pack = (m: Map<string, Suggestion>): Suggestions => ({
      list: m,
      top: [...m.entries()]
        .filter(([, s]) => s.price > 0)
        .sort((a, b) => b[1].uses - a[1].uses)
        .slice(0, 8)
        .map(([k]) => k),
    });
    return { labor: pack(maps.labor), part: pack(maps.part) };
  }, [lang]);
}

/** Add or edit one line: what was done (or which part), quantity and price. */
function LineSheet({
  b,
  kind,
  item,
  opened,
  onClose,
  onDelete,
  suggestions,
}: {
  b: OrderBundle;
  kind: Kind;
  item?: OrderItem;
  opened: boolean;
  onClose: () => void;
  onDelete?: () => void;
  suggestions?: Suggestions;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<Suggestion>();
  const [qty, setQty] = useState<number>(1);
  const [price, setPrice] = useState<number | undefined>();
  const [cost, setCost] = useState<number | undefined>();
  useEffect(() => {
    if (!opened) return;
    setTitle(item ? itemTitle(item, lang) : '');
    setPicked(undefined);
    setQty(item?.qty ?? 1);
    setPrice(item?.unitPriceFils);
    setCost(item?.costPriceFils);
  }, [opened, item, lang]);
  const names = useMemo(() => [...(suggestions?.list.keys() ?? [])], [suggestions]);
  /** One tap on a frequent line: its name and its last price. */
  const pick = (name: string) => {
    const s = suggestions?.list.get(name);
    setTitle(name);
    setPicked(s);
    if (s?.price) setPrice(s.price);
    haptic(6);
  };
  const save = () =>
    run(async () => {
      const typed = title.trim();
      const titles = picked && itemTitle(picked, lang) === typed ? { titleRu: picked.titleRu || typed, titleEn: picked.titleEn || typed } : lang === 'ru' ? { titleRu: typed, titleEn: undefined } : { titleEn: typed, titleRu: undefined };
      const patch: Partial<OrderItem> = { ...titles, qty: kind === 'part' ? qty || 1 : 1, unitPriceFils: price ?? 0 };
      if (kind === 'part') patch.costPriceFils = cost;
      if (item) await updateItem(item.id, patch);
      else await addItem(b.order.id, { kind, block: 'A', ...patch });
      haptic(8);
      onClose();
    });
  return (
    <Modal opened={opened} onClose={onClose} title={item ? t('item.edit') : kind === 'labor' ? t('qi.addWork') : t('qi.addPart')}>
      <Stack gap="md">
        {!item && (suggestions?.top.length ?? 0) > 0 && (
          <div className="chip-row" aria-label={t('qi.frequent')}>
            {suggestions!.top.map((name) => (
              <button key={name} type="button" className="chip" data-active={title === name} onClick={() => pick(name)}>
                {name}
                <span className="chip-note">{formatAed(suggestions!.list.get(name)!.price, lang, false)}</span>
              </button>
            ))}
          </div>
        )}
        <Autocomplete
          label={kind === 'labor' ? t('qi.workName') : t('qi.partName')}
          placeholder={kind === 'labor' ? t('qi.workPlaceholder') : t('qi.partPlaceholder')}
          data={names}
          filter={typedOnly}
          limit={8}
          value={title}
          renderOption={({ option }) => {
            const p = suggestions?.list.get(option.value)?.price;
            return (
              <Group justify="space-between" wrap="nowrap" w="100%" gap="sm">
                <Text size="sm" lineClamp={2}>
                  {option.value}
                </Text>
                {!!p && (
                  <Text size="sm" c="dimmed" className="tnum" style={{ flexShrink: 0 }}>
                    {formatAed(p)}
                  </Text>
                )}
              </Group>
            );
          }}
          onChange={(v) => {
            setTitle(v);
            const s = suggestions?.list.get(v);
            if (s) {
              setPicked(s);
              if (price === undefined || price === 0) setPrice(s.price || undefined);
            }
          }}
          autoComplete="off"
          // With quick chips on screen the keyboard waits for a tap: it would cover them.
          data-autofocus={item || !suggestions?.top.length ? true : undefined}
        />
        <SimpleGrid cols={kind === 'part' ? 2 : 1}>
          {kind === 'part' && <NumberInput label={t('qi.qty')} min={0.1} step={1} decimalScale={2} value={qty} onChange={(v) => setQty(Number(v) || 1)} inputMode="decimal" />}
          <PriceInput label={kind === 'part' ? t('qi.unitPrice') : t('qi.price')} net={price} onChange={setPrice} settings={b.settings} />
        </SimpleGrid>
        {kind === 'part' && <MoneyInput label={t('qi.cost')} description={t('qi.costHint')} value={cost} onChange={setCost} />}
        <Button size="lg" loading={busy} disabled={!title.trim() || !price} onClick={save}>
          {t('common.save')}
        </Button>
        {item && onDelete && (
          <Button variant="subtle" color="red" onClick={onDelete}>
            {t('common.delete')}
          </Button>
        )}
      </Stack>
    </Modal>
  );
}

/** After issuing: totals, payment, sending, and closing the job. */
function IssuedView({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [pay, setPay] = useState(false);
  const [send, setSend] = useState<SendRequest | null>(null);
  const inv = activeInvoice(b.invoices)!;
  const due = Math.max(0, bundleAmountDue(b));
  const paid = inv.totalFils - due;
  const closed = b.order.stage === 'closed' || b.order.stage === 'delivered';
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
  const offerSend = () =>
    setSend({
      text: due > 0 ? simpleMessage('carReady', ctx, b.order.docLanguage, { amount: formatAed(due, b.order.docLanguage) }) : simpleMessage('documents', ctx, b.order.docLanguage),
      template: due > 0 ? 'carReady' : 'documents',
      lang: b.order.docLanguage,
      orderId: b.order.id,
      pdf: () => invoicePdf(inv.id),
    });
  return (
    <Stack gap="lg">
      <Box className="surface rise-enter" p="md">
        <Group gap="sm" wrap="nowrap">
          <SuccessMark size={44} />
          <Box style={{ minWidth: 0 }}>
            <Text fw={700} fz={18}>
              {t('qi.issued', { number: inv.number })}
            </Text>
            <Text size="sm" c="dimmed">
              {t(`invoice.type.${inv.type}`)}
            </Text>
          </Box>
        </Group>
      </Box>
      <List>
        {inv.lines.map((l, i) => (
          <ListRow
            key={i}
            title={l.description}
            subtitle={l.qty !== 1 ? `${l.qty} × ${formatAed(fromNet(l.unitPriceFils, l.vatRateBp).gross)}` : undefined}
            right={<Money fils={l.gross} />}
          />
        ))}
      </List>
      <List>
        <ListRow title={<Text span fw={700} inherit>{t('qi.total')}</Text>} right={<Text fz={22} lh={1.1}><Money fils={inv.totalFils} display /></Text>} />
        <ListRow title={<Text span c="dimmed" inherit>{t('qi.paid')}</Text>} right={<Money fils={paid} c={paid > 0 ? 'green.7' : undefined} />} />
        <ListRow title={<Text span c="dimmed" inherit>{t('qi.due')}</Text>} right={<Money fils={due} c={due > 0 ? 'red.7' : 'green.7'} />} />
      </List>
      <Group grow gap="sm">
        <Button variant="light" leftSection={<IconSend size={18} />} onClick={offerSend}>
          {t('common.sendClient')}
        </Button>
        <Button variant="light" color="gray" leftSection={<IconFileTypePdf size={18} />} loading={busy} onClick={() => run(async () => openPdf(await invoicePdf(inv.id)))}>
          PDF
        </Button>
      </Group>
      {closed ? (
        <Box className="surface" p="md" ta="center">
          <Text fw={600}>{t('qi.closed')}</Text>
          <Button variant="subtle" mt={4} onClick={() => navigate(`/orders/${b.order.id}`)}>
            {t('order.open')}
          </Button>
        </Box>
      ) : (
        <StickyBar>
          {due > 0 ? (
            <Button fullWidth onClick={() => setPay(true)}>
              {t('qi.takePayment', { amount: formatAed(due) })}
            </Button>
          ) : (
            <Button
              fullWidth
              color="green"
              leftSection={<IconCheck size={20} />}
              loading={busy}
              onClick={() =>
                run(async () => {
                  await changeStage(b.order.id, 'closed');
                  haptic([12, 60, 18]);
                  navigate(`/orders/${b.order.id}`, { replace: true });
                }, 'qi.closedToast')
              }
            >
              {t('qi.closeOrder')}
            </Button>
          )}
        </StickyBar>
      )}
      {pay && <PaymentModal b={b} opened onClose={() => setPay(false)} />}
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
    </Stack>
  );
}

/**
 * Quick invoice right after check-in: labour and parts lines, the total with VAT, issue, take the
 * payment, close the job. The detailed estimate/approval path stays available from the job page.
 */
export function QuickInvoicePage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const b = useOrderBundle(id);
  const suggestions = useSuggestions(lang);
  const [sheet, setSheet] = useState<{ kind: Kind; item?: OrderItem } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  if (b === undefined) return <PageSkeleton variant="detail" />;
  if (!b) return <EmptyState title={t('err.notFound')} />;

  const inv = activeInvoice(b.invoices);
  const lines = b.items.filter((i) => ['draft', 'approved'].includes(i.approvalState));
  const waiting = b.items.filter((i) => i.approvalState === 'pending');
  const work = lines.filter((i) => i.kind !== 'part');
  const parts = lines.filter((i) => i.kind === 'part');
  const sum = sumAmounts(lines.map(itemAmounts));
  const rate = b.settings.vatRateBp / 100;
  const c = b.customer;

  const row = (i: OrderItem) => (
    <ListRow
      key={i.id}
      title={itemTitle(i, lang) || '—'}
      subtitle={i.kind === 'part' && i.qty !== 1 ? `${i.qty} × ${formatAed(itemAmounts({ ...i, qty: 1 }).gross)}` : undefined}
      right={<Money fils={itemAmounts(i).gross} />}
      onClick={i.approvalState === 'draft' ? () => setSheet({ kind: i.kind === 'part' ? 'part' : 'labor', item: i }) : undefined}
    />
  );
  const addRow = (kind: Kind) => (
    <ListRow
      key={`add-${kind}`}
      left={<IconPlus size={20} color="var(--mantine-color-cobalt-6)" />}
      title={
        <Text span c="cobalt.6" fw={500} inherit>
          {kind === 'labor' ? t('qi.addWork') : t('qi.addPart')}
        </Text>
      }
      onClick={() => setSheet({ kind })}
    />
  );
  const removeLine = (i: OrderItem) =>
    run(async () => {
      const removed = await removeItem(i.id);
      setSheet(null);
      if (removed) undoToast(t('item.removed', { title: itemTitle(removed, lang) }), t('common.undo'), () => void restoreItem(removed));
    });

  return (
    <>
      <PageHeader back={`/orders/${b.order.id}`} eyebrow={`${t('order.title')} №${b.order.number}`} title={t('invoice.title')} />
      <Box className="surface" p="md" mb="lg">
        <Group gap="sm" wrap="nowrap" justify="space-between">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <PlateText plate={b.vehicle.plate} size="md" />
            <Text fw={600} lineClamp={1}>
              {[b.vehicle.make, b.vehicle.model].filter(Boolean).join(' ')}
            </Text>
          </Group>
        </Group>
        {c.name || c.phone ? (
          <Group justify="space-between" wrap="nowrap" mt="sm" gap="sm">
            <Text size="sm" lineClamp={1}>
              {[(c.type === 'company' && c.companyName ? c.companyName : c.name) || t('customer.noName'), c.phone ? formatPhone(c.phone) : ''].filter(Boolean).join(' · ')}
            </Text>
            {!inv && (
              <Button variant="subtle" size="compact-sm" onClick={() => setCustomerOpen(true)} style={{ flexShrink: 0 }}>
                {t('common.change')}
              </Button>
            )}
          </Group>
        ) : inv ? (
          <Text size="sm" c="dimmed" mt="sm">
            {t('customer.noName')}
          </Text>
        ) : (
          // The buyer goes onto the invoice as it is when issued: offer to add the name first.
          <Button variant="light" fullWidth mt="sm" leftSection={<IconUserPlus size={18} />} onClick={() => setCustomerOpen(true)}>
            {t('qi.addCustomer')}
          </Button>
        )}
      </Box>

      {inv ? (
        <IssuedView b={b} />
      ) : (
        <>
          <div className="group-title">
            <Group gap={6}>
              <IconTool size={15} />
              {t('qi.work')}
            </Group>
          </div>
          <List>
            {work.map(row)}
            {addRow('labor')}
          </List>
          <div className="group-title" style={{ marginTop: 22 }}>
            <Group gap={6}>
              <IconPackage size={15} />
              {t('qi.parts')}
            </Group>
          </div>
          <List>
            {parts.map(row)}
            {addRow('part')}
          </List>
          {waiting.length > 0 && <div className="group-note">{t('qi.pendingNote', { n: waiting.length })}</div>}
          <Box mt="lg">
            <List>
              <ListRow title={<Text span c="dimmed" inherit>{t('qi.subtotal')}</Text>} right={<Money fils={sum.net} />} />
              <ListRow title={<Text span c="dimmed" inherit>{t('qi.vat', { rate })}</Text>} right={<Money fils={sum.vat} />} />
              <ListRow title={<Text span fw={700} inherit>{t('qi.total')}</Text>} right={<Text fz={24} lh={1.1}><Money fils={sum.gross} display /></Text>} />
            </List>
          </Box>
          {lines.length === 0 && <div className="group-note">{t('qi.emptyHint')}</div>}
          <StickyBar>
            <Button fullWidth disabled={lines.length === 0} loading={busy} onClick={() => setConfirm(true)}>
              {t('invoice.issue')} · {formatAed(sum.gross)}
            </Button>
          </StickyBar>
        </>
      )}

      <LineSheet
        b={b}
        kind={sheet?.kind ?? 'labor'}
        item={sheet?.item}
        opened={!!sheet}
        onClose={() => setSheet(null)}
        onDelete={sheet?.item ? () => removeLine(sheet.item!) : undefined}
        suggestions={sheet ? suggestions?.[sheet.kind] : undefined}
      />
      <ConfirmModal
        opened={confirm}
        onClose={() => setConfirm(false)}
        title={t('invoice.confirmTitle')}
        confirmLabel={t('invoice.issue')}
        onConfirm={() =>
          run(async () => {
            await quickInvoice(b.order.id);
            haptic([12, 60, 18]);
            window.scrollTo({ top: 0 });
            return true;
          }, 'invoice.issued')
        }
      >
        <Text size="sm">{t('invoice.confirmText')}</Text>
        <Text mt="sm" fw={700} fz={20}>
          <Money fils={sum.gross} display />
        </Text>
      </ConfirmModal>
      <CustomerModal opened={customerOpen} onClose={() => setCustomerOpen(false)} customer={c} />
    </>
  );
}
