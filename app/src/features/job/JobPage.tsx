import { ActionIcon, Box, Button, Group, Modal, Stack, Text, Textarea, UnstyledButton } from '@mantine/core';
import {
  IconBrandWhatsapp,
  IconCamera,
  IconCar,
  IconCash,
  IconCheck,
  IconChecks,
  IconCircle,
  IconCircleX,
  IconDiscount,
  IconDots,
  IconFileInvoice,
  IconFileTypePdf,
  IconHourglassHigh,
  IconListDetails,
  IconMessage2,
  IconPackage,
  IconPhone,
  IconScale,
  IconSend,
  IconSignature,
  IconTool,
  IconTrash,
  IconUser,
  IconUserPlus,
  IconUserX,
  type Icon,
} from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { hoursBetween, shortDuration } from '../../domain/dates';
import { discountBase } from '../../domain/discount';
import { liveLines, type Phase } from '../../domain/flow';
import { activeInvoice } from '../../domain/invoice';
import { isAwaitingClient, itemAmounts, itemTitle } from '../../domain/items';
import { formatAed, roundFils } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import { quickList } from '../../domain/quickLists';
import { sumAmounts } from '../../domain/vat';
import type { OrderItem, Payment } from '../../domain/types';
import { syncDiscount } from '../../services/discount';
import { invoicePdf, openPdf, quotationPdf, versionPdf } from '../../services/documents';
import { addItem, removeItem, restoreItem, setDone, withdrawItems } from '../../services/estimate';
import { answerLines, approveAll, dropLine, phaseOf, refuseAll, syncStage } from '../../services/flow';
import { simpleMessage, versionMessage, whatsappUrl } from '../../services/messages';
import { quickInvoice } from '../../services/money';
import { assignMechanic, bundleAmountDue, changeStage, updateOrder, type OrderBundle } from '../../services/orders';
import { setProcurement } from '../../services/parts';
import { ConfirmModal, EmptyState, List, ListRow, Money, PageHeader, PageSkeleton, PlateText, StickyBar, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang, useOrderBundle } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { scrollToTop, useStack } from '../../ui/stack';
import { CustomerModal } from '../customers/forms';
import { useSendVersion } from '../estimate/EstimatePage';
import { DiscountSheet } from '../money/DiscountSheet';
import { PaymentModal } from '../money/PaymentPanel';
import { DeleteJobModal } from '../orders/DeleteJob';
import { LineSheet, PART_STATES, partStateOf, useSuggestions, type LineKind, type PartState, type Suggestion } from './LineSheet';
import { PhasePill } from './phase';

/** What a line is to the job right now, as one symbol. */
function LineMark({ item }: { item: OrderItem }) {
  if (item.approvalState === 'pending') return <IconHourglassHigh size={20} stroke={1.9} color="var(--mantine-color-orange-6)" aria-hidden />;
  if (item.approvalState === 'approved') return item.done ? <IconChecks size={20} stroke={2.2} color="var(--mantine-color-green-6)" aria-hidden /> : <IconCheck size={20} stroke={2.2} color="var(--mantine-color-cobalt-6)" aria-hidden />;
  if (item.approvalState === 'declined') return <IconCircleX size={20} stroke={1.9} color="var(--mantine-color-red-6)" aria-hidden />;
  return <IconCircle size={20} stroke={1.9} color="var(--app-label-3)" aria-hidden />;
}

interface Tile {
  key: string;
  icon: Icon;
  color?: string;
  onClick: () => void;
}

/** Everything else that can happen to a job, as a grid of tiles: one tap, one word each. */
function MoreSheet({ opened, onClose, tiles }: { opened: boolean; onClose: () => void; tiles: Tile[] }) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={t('common.more')}>
      <div className="action-tiles">
        {tiles.map((x) => (
          <button
            key={x.key}
            type="button"
            className="action-tile"
            onClick={() => {
              onClose();
              x.onClick();
            }}
          >
            <x.icon size={26} stroke={1.7} style={{ color: `var(--mantine-color-${x.color ?? 'cobalt'}-6)` }} aria-hidden />
            <span>{t(`job.more.${x.key}`)}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** What the customer said, with the garage's quick phrases. */
function ComplaintSheet({ b, opened, onClose }: { b: OrderBundle; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [text, setText] = useState('');
  useEffect(() => {
    if (opened) setText(b.order.complaint ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);
  const add = (p: string) => setText((c) => (c.includes(p) ? c : c ? `${c}, ${p}` : p));
  return (
    <Modal opened={opened} onClose={onClose} title={t('job.complaint')}>
      <Stack gap="md">
        <div className="chip-row wrap">
          {quickList(b.settings, 'complaints').map((p) => (
            <button key={p} type="button" className="chip" data-active={text.includes(p)} onClick={() => add(p)}>
              {p}
            </button>
          ))}
        </div>
        <Textarea aria-label={t('job.complaint')} autosize minRows={2} value={text} onChange={(e) => setText(e.currentTarget.value)} />
        <Button
          size="lg"
          loading={busy}
          onClick={() =>
            run(async () => {
              await updateOrder(b.order.id, { complaint: text.trim() });
              onClose();
            })
          }
        >
          {t('common.save')}
        </Button>
      </Stack>
    </Modal>
  );
}

/** A line already told to the customer: the answer, done or not, where its part is — or take it off. */
function LineActions({ b, item, onClose, onEdit }: { b: OrderBundle; item: OrderItem | null; onClose: () => void; onEdit: (i: OrderItem) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const suppliers = useLiveQuery(() => db.suppliers.filter((s) => !s.archivedAt).toArray(), []) ?? [];
  // The sheet keeps showing the line while it slides away.
  const last = useRef(item);
  if (item) last.current = item;
  const i = item ?? last.current;
  if (!i) return null;
  const waiting = isAwaitingClient(i);
  const agreed = i.approvalState === 'approved';
  const invoiced = !!activeInvoice(b.invoices);
  const part = i.kind === 'part' && !i.customerSupplied;
  const state = partStateOf(i);
  const act = (fn: () => Promise<unknown>) =>
    run(async () => {
      await fn();
      haptic('light');
      onClose();
    });
  const setPart = (s: PartState) =>
    run(async () => {
      if (s === 'customer') return;
      await setProcurement(i.id, { status: s });
      await syncStage(i.orderId);
      haptic('selection');
    });
  return (
    <Modal opened={!!item} onClose={onClose} title={itemTitle(i, b.order.docLanguage)}>
      <Stack gap="md">
        <Text fz={22} fw={700} lh={1.1}>
          <Money fils={itemAmounts(i).gross} display />
        </Text>
        {waiting && (
          <Group grow gap="sm">
            <Button color="red" variant="light" loading={busy} onClick={() => act(() => answerLines([i.id], 'decline'))}>
              {t('job.refused')}
            </Button>
            <Button color="green" loading={busy} leftSection={<IconCheck size={18} />} onClick={() => act(() => answerLines([i.id], 'approve'))}>
              {t('job.agreed')}
            </Button>
          </Group>
        )}
        {agreed && !invoiced && (
          <Button color="green" variant={i.done ? 'light' : 'filled'} loading={busy} leftSection={<IconChecks size={18} />} onClick={() => act(() => setDone(i.id, !i.done))}>
            {i.done ? t('job.lineUndone') : t('job.lineDone')}
          </Button>
        )}
        {part && !invoiced && (
          <>
            <div className="chip-row" aria-label={t('job.partState')}>
              {PART_STATES.filter((s) => s !== 'customer').map((s) => (
                <button key={s} type="button" className="chip" data-active={state === s} onClick={() => setPart(s)}>
                  {t(`job.part.${s}`)}
                </button>
              ))}
            </div>
            {suppliers.length > 0 && (
              <div className="chip-row" aria-label={t('job.supplier')}>
                {suppliers.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="chip"
                    data-active={i.supplierId === s.id}
                    onClick={() => run(() => setProcurement(i.id, { status: i.procurementStatus ?? 'needed', supplierId: i.supplierId === s.id ? '' : s.id }))}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {waiting && (
          <Button
            variant="subtle"
            loading={busy}
            onClick={() =>
              run(async () => {
                await withdrawItems([i.id]);
                onClose();
                onEdit({ ...i, approvalState: 'draft' });
              })
            }
          >
            {t('common.edit')}
          </Button>
        )}
        {(waiting || (agreed && !invoiced)) && (
          <Button variant="subtle" color="red" loading={busy} onClick={() => act(() => (waiting ? withdrawItems([i.id], { cancel: true }) : dropLine(i.id)))}>
            {t('job.drop')}
          </Button>
        )}
      </Stack>
    </Modal>
  );
}

/**
 * The job, on one screen: who and what, the lines (work and parts) with what the customer said to
 * each, and one button for the next step — tell the customer, agreed, done, paid, gone. The job moves
 * through its stages by itself; everything rarer lives under "…".
 */
export function JobPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const stack = useStack();
  const { run, busy } = useAction();
  const b = useOrderBundle(id);
  // Quick lines in the language of this job's documents (English by default), as they will be printed.
  const suggestions = useSuggestions(b?.order.docLanguage ?? 'en', b?.order.complaint);
  const sv = useSendVersion(b);
  const mechanics = useLiveQuery(() => db.employees.filter((e) => e.active).toArray(), []) ?? [];
  const [sheet, setSheet] = useState<{ kind: LineKind; item?: OrderItem } | null>(null);
  // While the sheet slides away it keeps showing what it showed (not "Add labour" for a part).
  const lastSheet = useRef(sheet);
  if (sheet) lastSheet.current = sheet;
  const shownSheet = sheet ?? lastSheet.current;
  const [act, setAct] = useState<OrderItem | null>(null);
  const [more, setMore] = useState(false);
  const [finish, setFinish] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const [remove, setRemove] = useState(false);
  const [pay, setPay] = useState<Payment['kind'] | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [send, setSend] = useState<SendRequest | null>(null);

  const orderId = b?.order.id;
  const phase: Phase | undefined = b ? phaseOf(b) : undefined;
  // A percentage discount follows the lines; the stage follows the job's facts.
  const baseKey = b ? discountBase(b.items).map((i) => `${i.id}:${itemAmounts(i).gross}`).join('|') : '';
  const pctDiscount = !!b?.items.some((i) => i.kind === 'discount' && i.approvalState === 'draft' && i.discountPctBp);
  useEffect(() => {
    if (orderId && pctDiscount) syncDiscount(orderId).catch((e) => console.error(e));
  }, [orderId, baseKey, pctDiscount]);
  useEffect(() => {
    if (orderId && phase) syncStage(orderId).catch((e) => console.error(e));
  }, [orderId, phase]);

  if (b === undefined) return <PageSkeleton variant="detail" />;
  if (!b || !phase) return <EmptyState title={t('err.notFound')} />;

  const oid = b.order.id;
  const docLang = b.order.docLanguage;
  const c = b.customer;
  const inv = activeInvoice(b.invoices);
  const due = Math.max(0, bundleAmountDue(b));
  const live = liveLines(b.items);
  const lines = live.filter((i) => i.kind !== 'discount');
  const discounts = live.filter((i) => i.kind === 'discount');
  const refusedLines = b.items.filter((i) => i.approvalState === 'declined');
  const waiting = b.items.filter(isAwaitingClient);
  const sum = sumAmounts(live.map(itemAmounts));
  const unpriced = lines.filter((i) => i.approvalState === 'draft' && !i.customerSupplied && itemAmounts(i).gross === 0);
  const open = phase !== 'closed' && phase !== 'cancelled';
  const editable = open && !inv;
  const ctx = { customer: c, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
  const sentAt = waiting.length ? b.versions.filter((v) => waiting.some((i) => i.lastVersionId === v.id)).map((v) => v.sentAt).sort()[0] : undefined;

  const removeLine = (i: OrderItem) =>
    run(async () => {
      const removed = await removeItem(i.id);
      setSheet(null);
      if (removed) undoToast(t('item.removed', { title: itemTitle(removed, lang) }), t('common.undo'), () => void restoreItem(removed));
    });
  /** The quote to the customer's chat; the lines wait for the answer only once it really went. */
  const toClient = () => run(() => sv.prepare(oid, { via: c.preferredChannel === 'telegram' ? 'telegram' : 'whatsapp' }));
  const remind = () => {
    const v = b.versions.filter((x) => waiting.some((i) => i.lastVersionId === x.id)).pop();
    if (v) setSend({ text: versionMessage(ctx, v), template: 'estimate', lang: v.language, orderId: oid, pdf: () => versionPdf(v.id) });
  };
  const sendInvoice = () =>
    inv &&
    setSend({
      text: due > 0 ? simpleMessage('carReady', ctx, docLang, { amount: formatAed(due, docLang) }) : simpleMessage('documents', ctx, docLang),
      template: due > 0 ? 'carReady' : 'documents',
      lang: docLang,
      orderId: oid,
      pdf: () => invoicePdf(inv.id),
    });

  // The usual jobs (those that went with a similar complaint first) for one-tap adding.
  const onJob = new Set(live.map((i) => itemTitle(i, docLang)));
  const quick = (suggestions?.labor.top ?? [])
    .filter((name) => !onJob.has(name))
    .slice(0, 8)
    .map((name) => [name, suggestions!.labor.list.get(name)!] as const);
  const quickAdd = (s: Suggestion) =>
    run(async () => {
      await addItem(oid, { kind: 'labor', block: 'A', titleRu: s.titleRu || undefined, titleEn: s.titleEn || undefined, qty: 1, unitPriceFils: s.price, unitGrossFils: s.gross, ...(s.rate !== undefined ? { vatRateBp: s.rate } : {}) });
      await syncStage(oid);
      haptic('light');
    });
  const partNote = (i: OrderItem) => (i.kind === 'part' && !inv ? t(`job.part.${partStateOf(i)}`) : '');
  const row = (i: OrderItem) => (
    <ListRow
      key={i.id}
      left={<LineMark item={i} />}
      title={
        <Text span inherit td={i.approvalState === 'declined' ? 'line-through' : undefined} c={i.approvalState === 'declined' ? 'dimmed' : undefined}>
          {itemTitle(i, docLang) || '—'}
        </Text>
      }
      subtitle={[i.kind === 'part' && i.qty !== 1 ? `${i.qty} × ${formatAed(itemAmounts({ ...i, qty: 1 }).gross)}` : '', partNote(i), i.vatRateBp === 0 && !i.customerSupplied ? t('item.noVat') : ''].filter(Boolean).join(' · ') || undefined}
      right={
        unpriced.includes(i) ? (
          // No price yet (a part still to find): it cannot go to the customer like this.
          <Text fw={700} c="orange.7" aria-label={t('qi.price')}>
            ?
          </Text>
        ) : (
          <Money fils={itemAmounts(i).gross} c={i.kind === 'discount' ? 'green.7' : i.approvalState === 'declined' ? 'dimmed' : undefined} />
        )
      }
      onClick={
        !editable || i.approvalState === 'declined'
          ? undefined
          : i.kind === 'discount'
            ? () => setDiscountOpen(true)
            : i.approvalState === 'draft'
              ? () => setSheet({ kind: i.kind === 'part' ? 'part' : 'labor', item: i })
              : () => setAct(i)
      }
    />
  );

  // The discount once, as on the documents — however many VAT rates it is split over underneath.
  const discountRow = (state: OrderItem | undefined, title: string, gross: number, onClick?: () => void) => (
    <ListRow key="discount" left={state ? <LineMark item={state} /> : undefined} title={title} right={<Money fils={gross} c="green.7" />} onClick={onClick} />
  );
  const invOff = inv ? inv.lines.filter((l) => l.kind === 'discount') : [];

  const tiles: Tile[] = [];
  if (open) tiles.push({ key: 'photos', icon: IconCamera, onClick: () => navigate(`/orders/${oid}/intake`) });
  if (inv) tiles.push({ key: 'invoice', icon: IconFileInvoice, onClick: () => void run(async () => openPdf(await invoicePdf(inv.id))) });
  else if (live.length) tiles.push({ key: 'quote', icon: IconFileTypePdf, onClick: () => void run(async () => openPdf(await quotationPdf(oid))) });
  if (open && !inv) tiles.push({ key: 'prepay', icon: IconCash, color: 'green', onClick: () => setPay('prepayment') });
  if (open && (lines.length > 0 || inv) && (!inv || due > 0)) tiles.push({ key: 'discount', icon: IconDiscount, onClick: () => setDiscountOpen(true) });
  // The car leaves now, the money comes later: a signed debt (on the payments tab of the details).
  if (inv && due > 0 && phase === 'pay') tiles.push({ key: 'debt', icon: IconSignature, color: 'orange', onClick: () => navigate(`/orders/${oid}/details?tab=payments`) });
  tiles.push({ key: 'customer', icon: IconUser, onClick: () => setCustomerOpen(true) });
  tiles.push({ key: 'car', icon: IconCar, onClick: () => navigate(`/vehicles/${b.vehicle.id}`) });
  tiles.push({ key: 'details', icon: IconListDetails, onClick: () => navigate(`/orders/${oid}/details`) });
  if (phase === 'closed') tiles.push({ key: 'claim', icon: IconScale, color: 'orange', onClick: () => navigate(`/orders/${oid}/claim`) });
  if (editable && phase !== 'booked') tiles.push({ key: 'refuse', icon: IconUserX, color: 'red', onClick: () => setRefuse(true) });
  tiles.push({ key: 'remove', icon: IconTrash, color: 'red', onClick: () => setRemove(true) });

  let bar: ReactNode = null;
  if (phase === 'booked')
    bar = (
      <Button fullWidth loading={busy} onClick={() => run(() => changeStage(oid, 'intake'))}>
        {t('job.arrived')}
      </Button>
    );
  else if (phase === 'price')
    bar = (
      <Group gap={10} wrap="nowrap">
        <Button variant="default" loading={busy} disabled={unpriced.length > 0} leftSection={<IconCheck size={18} />} onClick={() => run(async () => (await approveAll(oid), haptic('success')))} style={{ flex: '0 0 auto' }}>
          {t('job.agreed')}
        </Button>
        <Button loading={busy} disabled={unpriced.length > 0} leftSection={<IconSend size={18} />} onClick={toClient} style={{ flex: 1 }}>
          {t('job.toClient')} · {formatAed(sum.gross)}
        </Button>
      </Group>
    );
  else if (phase === 'wait')
    bar = (
      <Group gap={10} wrap="nowrap">
        <Button variant="default" c="red" loading={busy} onClick={() => run(() => answerLines(waiting.map((i) => i.id), 'decline'))} style={{ flex: '0 0 auto' }}>
          {t('job.refused')}
        </Button>
        <Button color="green" loading={busy} leftSection={<IconCheck size={18} />} onClick={() => run(async () => (await approveAll(oid), haptic('success')))} style={{ flex: 1 }}>
          {t('job.agreed')}
        </Button>
      </Group>
    );
  else if (phase === 'work')
    bar = (
      <Button fullWidth color="green" loading={busy} leftSection={<IconChecks size={20} />} onClick={() => setFinish(true)}>
        {t('job.done')} · {formatAed(sum.gross)}
      </Button>
    );
  else if (phase === 'pay' || phase === 'debt')
    bar = (
      <Button fullWidth onClick={() => setPay('payment')}>
        {t('job.pay')} · {formatAed(due)}
      </Button>
    );
  else if (phase === 'out')
    bar = (
      <Button
        fullWidth
        color="green"
        loading={busy}
        leftSection={<IconCheck size={20} />}
        onClick={() =>
          run(async () => {
            await changeStage(oid, 'closed');
            haptic('success');
          })
        }
      >
        {t('job.handOver')}
      </Button>
    );

  return (
    <>
      <PageHeader
        back="/"
        eyebrow={`№${b.order.number}`}
        title={
          <>
            {[b.vehicle.make, b.vehicle.model].filter(Boolean).join(' ') || t('order.title')}{' '}
            {b.vehicle.year && (
              <Text span inherit c="dimmed" fw={500}>
                {b.vehicle.year}
              </Text>
            )}
          </>
        }
        right={
          <ActionIcon variant="default" size={40} radius="md" aria-label={t('common.more')} onClick={() => setMore(true)}>
            <IconDots size={20} />
          </ActionIcon>
        }
      />

      <Box className="surface" p="md" mb="lg">
        <Group gap="sm" wrap="nowrap" justify="space-between">
          <PlateText plate={b.vehicle.plate} size="md" />
          <PhasePill phase={phase} />
        </Group>
        <Group justify="space-between" wrap="nowrap" mt="sm" gap="sm">
          {c.name || c.phone ? (
            <UnstyledButton className="job-line" onClick={() => setCustomerOpen(true)}>
              <Text fw={500} lineClamp={1}>
                {(c.type === 'company' && c.companyName ? c.companyName : c.name) || formatPhone(c.phone)}
              </Text>
              {c.name && c.phone && (
                <Text size="sm" c="dimmed" lineClamp={1}>
                  {formatPhone(c.phone)}
                </Text>
              )}
            </UnstyledButton>
          ) : (
            <Button variant="light" size="compact-md" leftSection={<IconUserPlus size={16} />} onClick={() => setCustomerOpen(true)}>
              {t('job.client')}
            </Button>
          )}
          {c.phone && (
            <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
              <ActionIcon component="a" href={whatsappUrl(c.whatsapp || c.phone, '')} target="_blank" rel="noopener" variant="light" color="green" size={40} radius="xl" aria-label="WhatsApp">
                <IconBrandWhatsapp size={21} />
              </ActionIcon>
              <ActionIcon component="a" href={`tel:${c.phone}`} variant="light" color="green" size={40} radius="xl" aria-label={t('customer.call')}>
                <IconPhone size={20} />
              </ActionIcon>
            </Group>
          )}
        </Group>
        <UnstyledButton className="job-line job-complaint" mt="sm" onClick={open ? () => setComplaintOpen(true) : undefined} aria-label={t('job.complaint')}>
          <IconMessage2 size={18} stroke={1.8} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
          <Text size="sm" c={b.order.complaint ? undefined : 'dimmed'} lineClamp={3}>
            {b.order.complaint || t('job.complaint')}
          </Text>
        </UnstyledButton>
        {open && mechanics.length > 0 && (
          <div className="chip-row" style={{ marginTop: 12 }} aria-label={t('order.mechanic')}>
            {mechanics.map((m) => (
              <button key={m.id} type="button" className="chip" data-active={b.order.mechanicId === m.id} onClick={() => run(() => assignMechanic(oid, b.order.mechanicId === m.id ? undefined : m.id))}>
                {m.name}
              </button>
            ))}
          </div>
        )}
      </Box>

      {(phase === 'look' || phase === 'price') && editable && quick.length > 0 && (
        // Building the quote: the usual jobs for such a complaint, one tap each (name, last price).
        <div className="chip-row" style={{ marginBottom: 12 }} aria-label={t('qi.frequent')}>
          {quick.map(([name, s]) => (
            <button key={name} type="button" className="chip" onClick={() => quickAdd(s)}>
              {name}
              <span className="chip-note">{formatAed(s.gross ?? s.price, docLang, false)}</span>
            </button>
          ))}
        </div>
      )}
      {inv ? (
        <>
          <List>
            <ListRow
              left={<IconFileInvoice size={22} stroke={1.7} color="var(--mantine-color-green-6)" aria-hidden />}
              title={inv.number}
              right={
                <Group gap={6} wrap="nowrap">
                  <ActionIcon variant="light" size={36} radius="xl" aria-label={t('common.sendClient')} onClick={sendInvoice}>
                    <IconSend size={18} />
                  </ActionIcon>
                  <ActionIcon variant="light" color="gray" size={36} radius="xl" aria-label="PDF" loading={busy} onClick={() => run(async () => openPdf(await invoicePdf(inv.id)))}>
                    <IconFileTypePdf size={18} />
                  </ActionIcon>
                </Group>
              }
            />
            {inv.lines
              .filter((l) => l.kind !== 'discount')
              .map((l, k) => (
                <ListRow
                  key={k}
                  title={l.description}
                  subtitle={[l.qty !== 1 ? `${l.qty} × ${formatAed(roundFils(l.gross / l.qty))}` : '', l.vatRateBp === 0 && !l.customerSupplied ? t('item.noVat') : ''].filter(Boolean).join(' · ') || undefined}
                  right={<Money fils={l.gross} />}
                />
              ))}
            {invOff.length > 0 && discountRow(undefined, invOff[0].description, invOff.reduce((a, l) => a + l.gross, 0))}
          </List>
          <Box mt="lg">
            <List>
              <ListRow title={<Text span fw={700} inherit>{t('job.total')}</Text>} right={<Text fz={24} lh={1.1}><Money fils={inv.totalFils} display /></Text>} />
              {inv.totalFils - due > 0 && <ListRow title={<Text span c="dimmed" inherit>{t('qi.paid')}</Text>} right={<Money fils={inv.totalFils - due} c="green.7" />} />}
              {due > 0 && inv.totalFils - due > 0 && <ListRow title={<Text span c="dimmed" inherit>{t('qi.due')}</Text>} right={<Money fils={due} c="red.7" />} />}
            </List>
          </Box>
        </>
      ) : (
        <>
          {(lines.length > 0 || refusedLines.length > 0) && (
            <List>
              {lines.map(row)}
              {discounts.length > 0 && discountRow(discounts[0], itemTitle(discounts[0], docLang), discounts.reduce((a, i) => a + itemAmounts(i).gross, 0), editable ? () => setDiscountOpen(true) : undefined)}
              {refusedLines.map(row)}
              {sentAt && (
                <ListRow
                  left={<IconHourglassHigh size={20} stroke={1.9} color="var(--mantine-color-orange-6)" aria-hidden />}
                  title={
                    <Text span inherit c="orange.7">
                      {shortDuration(hoursBetween(sentAt), lang)}
                    </Text>
                  }
                  right={
                    <Button variant="light" color="orange" size="compact-md" onClick={remind}>
                      {t('job.remind')}
                    </Button>
                  }
                />
              )}
            </List>
          )}
          {editable && phase !== 'booked' && (
            <Group gap={8} mt={lines.length ? 'sm' : 0} wrap="nowrap">
              <Button variant="light" leftSection={<IconTool size={18} />} onClick={() => setSheet({ kind: 'labor' })} style={{ flex: 1 }}>
                {t('job.addWork')}
              </Button>
              <Button variant="light" leftSection={<IconPackage size={18} />} onClick={() => setSheet({ kind: 'part' })} style={{ flex: 1 }}>
                {t('job.addPart')}
              </Button>
              {lines.length > 0 && (
                <ActionIcon variant="light" size={44} radius="xl" aria-label={t('discount.title')} onClick={() => setDiscountOpen(true)} style={{ flexShrink: 0 }}>
                  <IconDiscount size={20} />
                </ActionIcon>
              )}
            </Group>
          )}
          {live.length > 0 && (
            <Box mt="lg">
              <List>
                <ListRow
                  title={<Text span fw={700} inherit>{t('job.total')}</Text>}
                  subtitle={sum.vat ? t('job.vatIn', { vat: formatAed(sum.vat, lang, false) }) : undefined}
                  right={<Text fz={24} lh={1.1}><Money fils={sum.gross} display /></Text>}
                />
              </List>
            </Box>
          )}
        </>
      )}

      {bar && <StickyBar>{bar}</StickyBar>}

      <LineSheet
        b={b}
        kind={shownSheet?.kind ?? 'labor'}
        item={shownSheet?.item}
        opened={!!sheet}
        onClose={() => setSheet(null)}
        onDelete={sheet?.item ? () => removeLine(sheet.item!) : undefined}
        suggestions={shownSheet ? suggestions?.[shownSheet.kind] : undefined}
      />
      <LineActions b={b} item={act} onClose={() => setAct(null)} onEdit={(i) => setSheet({ kind: i.kind === 'part' ? 'part' : 'labor', item: i })} />
      <MoreSheet opened={more} onClose={() => setMore(false)} tiles={tiles} />
      <ComplaintSheet b={b} opened={complaintOpen} onClose={() => setComplaintOpen(false)} />
      <ConfirmModal
        opened={finish}
        onClose={() => setFinish(false)}
        title={t('invoice.confirmTitle')}
        confirmLabel={t('invoice.issue')}
        onConfirm={() =>
          run(async () => {
            await quickInvoice(oid);
            haptic('success');
            scrollToTop();
            return true;
          })
        }
      >
        <Text size="sm">{t('invoice.confirmText')}</Text>
        <Text mt="sm" fw={700} fz={20}>
          <Money fils={sum.gross} display />
        </Text>
      </ConfirmModal>
      <ConfirmModal
        opened={refuse}
        onClose={() => setRefuse(false)}
        title={t('job.refuseTitle')}
        confirmLabel={t('job.refused')}
        color="red"
        onConfirm={() =>
          run(async () => {
            await refuseAll(oid);
            haptic('light');
            return true;
          })
        }
      >
        <Text size="sm">{t('job.refuseText')}</Text>
      </ConfirmModal>
      <DeleteJobModal
        order={b.order}
        opened={remove}
        onClose={() => setRemove(false)}
        // The job's screen goes back first (it must not show an empty page), then the job is deleted.
        beforeDelete={async () => {
          if (stack) stack.back('/');
          else navigate('/');
          await new Promise((r) => setTimeout(r, 520));
        }}
      />
      {pay && <PaymentModal b={b} opened onClose={() => setPay(null)} kind={pay} />}
      <DiscountSheet b={b} opened={discountOpen} onClose={() => setDiscountOpen(false)} />
      <CustomerModal opened={customerOpen} onClose={() => setCustomerOpen(false)} customer={c} />
      <SendDialog customer={c} request={sv.send} onClose={() => sv.setSend(null)} onSent={() => void syncStage(oid)} />
      <SendDialog customer={c} request={send} onClose={() => setSend(null)} />
    </>
  );
}
