import { ActionIcon, Box, Button, Group, Modal, SegmentedControl, Stack, Text, Textarea, UnstyledButton } from '@mantine/core';
import {
  IconBrandWhatsapp,
  IconCamera,
  IconCar,
  IconCash,
  IconCashOff,
  IconCheck,
  IconChecks,
  IconCircle,
  IconCircleCheckFilled,
  IconCircleX,
  IconClipboardCheck,
  IconClipboardList,
  IconCopy,
  IconDiscount,
  IconDots,
  IconEngine,
  IconFileInvoice,
  IconFileTypePdf,
  IconHourglassHigh,
  IconKey,
  IconListCheck,
  IconListDetails,
  IconMenu2,
  IconMessage2,
  IconPackage,
  IconPencil,
  IconPhone,
  IconPhoto,
  IconPointFilled,
  IconRestore,
  IconScale,
  IconSend,
  IconSignature,
  IconTool,
  IconTrash,
  IconUser,
  IconUserDollar,
  IconUserPlus,
  IconUserX,
  type Icon,
} from '@tabler/icons-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { hoursBetween, shortDuration } from '../../domain/dates';
import { discountBase } from '../../domain/discount';
import { liveLines, type Phase } from '../../domain/flow';
import { activeInvoice, canAmendInvoice, paidNet } from '../../domain/invoice';
import { canReprice, isAwaitingClient, itemAmounts, itemTitle, lineName, unitGrossPrice } from '../../domain/items';
import { formatAed, roundFils } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import { quickList } from '../../domain/quickLists';
import { jobProfit } from '../../domain/profit';
import { canCloseUnpaid, canReopen } from '../../domain/stages';
import { sumAmounts } from '../../domain/vat';
import type { OrderItem, Payment } from '../../domain/types';
import { tFor } from '../../i18n';
import { syncDiscount } from '../../services/discount';
import { AppError } from '../../services/errors';
import { invoicePdf, openPdf, quotationPdf, versionPdf } from '../../services/documents';
import { addItem, removeItem, restoreItem, setDone, updateItem, withdrawItems } from '../../services/estimate';
import { amendInvoice, answerLines, approveAll, closeUnpaid, dropLine, phaseOf, refuseAll, removeLines, reopenJob, reorderLines, repriceLine, restoreLines, reviseLine, syncStage } from '../../services/flow';
import { linesText, reportText, simpleMessage, versionMessage, whatsappUrl } from '../../services/messages';
import { copyText } from '../../ui/clipboard';
import { quickInvoice } from '../../services/money';
import { assignMechanic, bundleAmountDue, changeStage, updateOrder, type OrderBundle } from '../../services/orders';
import { setProcurement } from '../../services/parts';
import { ConfirmModal, EmptyState, List, ListRow, Money, MoneyInput, PageHeader, PageSkeleton, PlateText, StickyBar, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { celebrate } from '../../ui/motion';
import { useLongPress } from '../../ui/longPress';
import { useSortable } from '../../ui/sortable';
import { useAction, useLang, useOrderBundle, useScreenLiveQuery } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { LazySheet } from '../../ui/lazy';
import { scrollToTop, useStackBack } from '../../ui/stack';
import { useSwipeHint, type SwipeSpec } from '../../ui/swipe';
import { CustomerModal } from '../customers/forms';
import { useSendVersion } from '../estimate/EstimatePage';
import { DiscountSheet } from '../money/DiscountSheet';
import { PaymentModal } from '../money/PaymentPanel';
import { DeleteJobModal } from '../orders/DeleteJob';
import { CarCover, VinTile } from './CarCover';
import { DueChip } from './Due';
import { HANDOVER_CHECKS, HandoverChecks } from './HandoverChecks';
import { MechanicSheet } from './MechanicSheet';
import { NotesSection } from './Notes';
import { OutsourceActions, ReceivedRow, ReturnTerms } from './LineExtras';
import { RequestButton, SupplierChips, WhoChips } from './PartTools';
import { ObdLine, useObdImport } from './ObdScan';
import { LineSheet, PART_COLOR, PART_STATES, partStateOf, useSuggestions, type LineKind, type PartState, type Suggestion } from './LineSheet';
import { PhasePill, PhaseTrack, usePhaseGlow } from './phase';
import { PrevVisit } from './PrevVisit';

/** What a line is to the job right now, as one symbol. */
function LineMark({ item }: { item: OrderItem }) {
  // When the line's state changes (agreed, done) its symbol pops; not when the screen opens.
  const shown = useRef(false);
  useEffect(() => {
    shown.current = true;
  }, []);
  const state = item.approvalState === 'approved' && item.done ? 'done' : item.approvalState;
  const mark =
    state === 'pending' ? (
      <IconHourglassHigh size={20} stroke={1.9} color="var(--mantine-color-orange-6)" aria-hidden />
    ) : state === 'done' ? (
      <IconChecks size={20} stroke={2.2} color="var(--mantine-color-green-6)" aria-hidden />
    ) : state === 'approved' ? (
      <IconCheck size={20} stroke={2.2} color="var(--mantine-color-cobalt-6)" aria-hidden />
    ) : state === 'declined' ? (
      <IconCircleX size={20} stroke={1.9} color="var(--mantine-color-red-6)" aria-hidden />
    ) : (
      // Not told to the customer yet: a small dot (an empty circle would read as a box to tick).
      <IconPointFilled size={20} color="var(--app-label-3)" aria-hidden />
    );
  return (
    <span key={state} className={shown.current ? 'line-mark pop-in' : 'line-mark'}>
      {mark}
    </span>
  );
}

interface Tile {
  key: string;
  icon: Icon;
  color?: string;
  onClick: () => void;
}

/** Each tile of "…" in its own colour (like app icons): found by colour, not read. Red and orange stay with the tiles that warn. */
const TILE_COLOR: Record<string, string> = {
  customer: 'blue',
  car: 'indigo',
  mechanic: 'orange',
  photos: 'pink',
  scanner: 'cyan',
  invoice: 'grape',
  quote: 'grape',
  discount: 'pink',
  select: 'teal',
  amend: 'grape',
  details: 'gray',
};

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
            <span className="tile-icon" style={{ '--c': `var(--mantine-color-${x.color ?? TILE_COLOR[x.key] ?? 'cobalt'}-6)` } as React.CSSProperties}>
              <x.icon size={23} stroke={1.9} aria-hidden />
            </span>
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

/** A line row that a long press starts picking from (like the iPhone's lists): the press is not also a tap. */
/** Short notes in one line, a dot between them ("4 × 30,00 AED · Ordered"); nothing when there are none. */
function dots(parts: ReactNode[]): ReactNode {
  const list = parts.filter(Boolean);
  if (!list.length) return undefined;
  return list.map((p, n) => (
    <Fragment key={n}>
      {n > 0 && ' · '}
      {p}
    </Fragment>
  ));
}

function PickRow({ onLong, onClick, ...row }: Parameters<typeof ListRow>[0] & { onLong?: () => void }) {
  const press = useLongPress(() => onLong?.());
  return <ListRow {...row} handlers={onLong ? press.handlers : undefined} onClick={onClick && (() => !press.consumeClick() && onClick())} />;
}

/**
 * A new price for a line the customer has seen, per unit with VAT — as the job shows it: saved with the
 * check (or Enter). Several of it: the price of one, and the line's total under it.
 */
function PriceField({ item, onDone }: { item: OrderItem; onDone: (now: 'draft' | 'agreed' | null) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [value, setValue] = useState<number | undefined>(() => itemAmounts({ ...item, qty: 1 }).gross);
  const several = item.qty !== 1;
  const save = () =>
    run(async () => {
      if (!value) return;
      const now = await repriceLine(item.id, value);
      if (now) haptic('light');
      onDone(now);
    });
  return (
    <div className="rise-enter">
      <Group gap="sm" wrap="nowrap" onKeyDown={(e) => e.key === 'Enter' && void save()}>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <MoneyInput label={undefined} ariaLabel={t('job.changePrice')} value={value} onChange={setValue} autoFocus leftSection={several ? `${item.qty} ×` : undefined} />
        </Box>
        <ActionIcon size={44} radius="xl" variant="filled" loading={busy} disabled={!value} aria-label={t('common.save')} onClick={() => void save()}>
          <IconCheck size={22} />
        </ActionIcon>
      </Group>
      {several && !!value && (
        <Text c="dimmed" fz={15} mt={6}>
          = <Money fils={itemAmounts({ ...item, ...unitGrossPrice(item, value) }).gross} />
        </Text>
      )}
    </div>
  );
}

/** A line already told to the customer: the answer, done or not, where its part is — or take it off. */
function LineActions({ b, item, onClose, onEdit }: { b: OrderBundle; item: OrderItem | null; onClose: () => void; onEdit: (i: OrderItem) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  // The sheet keeps showing the line while it slides away — as it is now (a chip tapped here changes it).
  const last = useRef(item);
  if (item) last.current = b.items.find((x) => x.id === item.id) ?? item;
  // Typing a new price: closed again each time the sheet opens (kept while it slides away).
  const [pricing, setPricing] = useState(false);
  const [openFor, setOpenFor] = useState(item);
  if (item !== openFor) {
    setOpenFor(item);
    if (item) setPricing(false);
  }
  const i = last.current;
  if (!i) return null;
  const waiting = isAwaitingClient(i);
  const agreed = i.approvalState === 'approved';
  const invoiced = !!activeInvoice(b.invoices);
  const repriceable = canReprice(i) && !invoiced;
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
        {pricing && repriceable ? (
          <PriceField
            item={i}
            onDone={(now) => {
              setPricing(false);
              // Back to a draft (it waited for the answer): the new price goes to the customer from the job.
              if (now === 'draft') onClose();
            }}
          />
        ) : repriceable ? (
          <UnstyledButton className="tap price-tap" aria-label={t('job.changePrice')} onClick={() => setPricing(true)}>
            <Text span fz={22} fw={700} lh={1.1}>
              <Money fils={itemAmounts(i).gross} display roll />
            </Text>
            <IconPencil size={18} stroke={1.8} color="var(--app-label-3)" aria-hidden />
          </UnstyledButton>
        ) : (
          <Text fz={22} fw={700} lh={1.1}>
            <Money fils={itemAmounts(i).gross} display />
          </Text>
        )}
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
            {/* The same switch as in the line's sheet: to find · ordered · here. */}
            <SegmentedControl
              fullWidth
              aria-label={t('job.partState')}
              value={state === 'customer' ? 'received' : state}
              onChange={(v) => void setPart(v as PartState)}
              color={PART_COLOR[state === 'customer' ? 'received' : state]}
              data={PART_STATES.filter((s) => s !== 'customer').map((s) => ({ value: s, label: t(`job.part.${s}`) }))}
            />
            <SupplierChips value={i.supplierId} make={b.vehicle.make} onChange={(s) => void run(() => setProcurement(i.id, { status: i.procurementStatus ?? 'needed', supplierId: s ?? '' }))} />
            {state === 'needed' && <RequestButton vehicle={b.vehicle} item={i} supplierId={i.supplierId} photoIds={i.mediaIds ?? []} />}
            {state === 'ordered' && i.qty > 1 && Number.isInteger(i.qty) && <ReceivedRow item={i} />}
            {(state === 'ordered' || state === 'received') && !i.done && <ReturnTerms item={i} />}
          </>
        )}
        {i.kind === 'labor' && !invoiced && !i.done && agreed && (
          <>
            <WhoChips value={i.employeeId} onChange={(e) => void run(() => updateItem(i.id, { employeeId: e }))} />
            <OutsourceActions item={i} make={b.vehicle.make} />
          </>
        )}
        {/* The whole line again (name, how many, price): back to a draft — told again, as a new line is. */}
        {(waiting || (agreed && !invoiced && i.kind !== 'discount')) && (
          <Button
            variant="subtle"
            loading={busy}
            leftSection={<IconPencil size={18} />}
            onClick={() =>
              run(async () => {
                if (waiting) await withdrawItems([i.id]);
                else await reviseLine(i.id);
                onClose();
                onEdit({ ...i, approvalState: 'draft', done: false });
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
  const stackBack = useStackBack();
  const { run, busy } = useAction();
  const b = useOrderBundle(id);
  // Quick lines in the language of this job's documents (English by default), as they will be printed.
  // Read a moment after the job slid in, and only while lines can still be added.
  const suggestions = useSuggestions(b?.order.docLanguage ?? 'en', b?.order.complaint, !!b && !['closed', 'cancelled'].includes(b.order.stage) && !activeInvoice(b.invoices));
  const sv = useSendVersion(b);
  const mechanics = useScreenLiveQuery(() => db.employees.filter((e) => e.active).toArray(), []) ?? [];
  const [sheet, setSheet] = useState<{ kind: LineKind; item?: OrderItem } | null>(null);
  // While the sheet slides away it keeps showing what it showed (not "Add labour" for a part).
  const lastSheet = useRef(sheet);
  if (sheet) lastSheet.current = sheet;
  const shownSheet = sheet ?? lastSheet.current;
  const [act, setAct] = useState<OrderItem | null>(null);
  const [more, setMore] = useState(false);
  const [finish, setFinish] = useState(false);
  // Picking lines to take off several at once (a long press on a line, or “…” → “Select”); null = not picking.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [confirmPicked, setConfirmPicked] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const [unpaid, setUnpaid] = useState(false);
  const [remove, setRemove] = useState(false);
  const [pay, setPay] = useState<Payment['kind'] | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  // Changing the lines once the invoice is out: confirmed first (a credit note), then what was tapped.
  const [amend, setAmend] = useState<{ then?: () => void } | null>(null);
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [send, setSend] = useState<SendRequest | null>(null);
  const [mechanicOpen, setMechanicOpen] = useState(false);
  // The profit is the manager's: hidden (blurred) until tapped, in case the customer sees the screen.
  const [profitShown, setProfitShown] = useState(false);
  // A scanner report (PDF) read into the job: codes, odometer, what the car card is missing.
  const obd = useObdImport(id ?? '');
  const expenses = useScreenLiveQuery(() => (id ? db.expenses.where('orderId').equals(id).toArray() : []), [id]);

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
  // Once on a device: the first line peeks to the left — lines can be swiped.
  useSwipeHint(!!b && !activeInvoice(b.invoices) && !['closed', 'cancelled', 'booked'].includes(b.order.stage) && liveLines(b.items).some((i) => i.kind !== 'discount'));
  // The screen glows in the colour of the job's step.
  const bodyRef = useRef<HTMLDivElement>(null);
  usePhaseGlow(bodyRef, phase);

  // Lines moved by hand in edit mode (≡ at the row's end): the quote and the invoice list them so.
  const sortIds = b ? liveLines(b.items).filter((i) => i.kind !== 'discount').map((i) => i.id) : [];
  const sortGrip = useSortable(sortIds, (ids) => {
    if (orderId) void run(async () => (await reorderLines(orderId, ids), haptic('light')));
  });

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
  // The invoice is out, the car still here: its lines can be changed (credit note, then a new invoice).
  const amendable = canAmendInvoice(b.order.stage, b.invoices, b.debts);
  const ctx = { customer: c, vehicle: b.vehicle, order: b.order, garageName: b.settings.name, partsAdvanceFrom: b.settings.prepaymentThresholdFils };
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
    if (v) setSend({ text: versionMessage(ctx, v), template: 'estimate', lang: v.language, orderId: oid, pdf: () => versionPdf(v.id), photos: waiting.flatMap((i) => i.mediaIds ?? []) });
  };
  /** What was done, for the customer (or a company's group chat): the lines, the checks, mileage, warranty, photos. */
  const report = () => {
    const tt = tFor(docLang);
    const done = inv ? inv.lines.filter((l) => l.kind !== 'discount').map((l) => lineName(l.description, l.kind)) : live.filter((i) => i.kind !== 'discount' && i.approvalState === 'approved').map((i) => itemTitle(i, docLang));
    const checks = HANDOVER_CHECKS.filter((c) => b.order.qcChecks?.[c]).map((c) => tt(`qc.${c}`));
    const scan = b.order.obdScans?.[b.order.obdScans.length - 1]?.odometer;
    const mileageKm = b.handover?.mileageKm ?? b.intake?.mileageKm ?? (scan?.unit === 'km' ? scan.value : undefined);
    setSend({
      text: reportText(ctx, docLang, { done, checks, mileageKm, warrantyMonths: b.settings.warrantyLaborMonths, warrantyKm: b.settings.warrantyLaborKm }),
      template: 'report',
      lang: docLang,
      orderId: oid,
      pdf: inv ? () => invoicePdf(inv.id) : undefined,
      photos: live.filter((i) => i.approvalState === 'approved').flatMap((i) => i.mediaIds ?? []),
    });
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
  // Picking: the lines that can come off (not the discount, not refused ones, not after the invoice).
  const canPick = (i: OrderItem) => editable && i.kind !== 'discount' && ['draft', 'pending', 'approved'].includes(i.approvalState);
  const picking = picked !== null && editable;
  const togglePick = (id: string) => {
    haptic('selection');
    setPicked((p) => {
      const n = new Set(p ?? []);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  // Where a part is — not on a done line (it is fitted), nor after the invoice.
  // The whole list of lines as text, one tap: to paste to a supplier, the customer, anywhere.
  const copyLines = () =>
    run(async () => {
      if (!(await copyText(linesText(b.vehicle, live, docLang)))) throw new AppError('err.copy');
      haptic('light');
    }, 'job.copiedLines');
  const copyButton = (size: number) => (
    <ActionIcon variant="light" color="gray" size={size} radius="xl" aria-label={t('job.copyLines')} onClick={() => void copyLines()} style={{ flexShrink: 0 }}>
      <IconCopy size={size > 40 ? 20 : 18} />
    </ActionIcon>
  );
  const partNote = (i: OrderItem) =>
    i.kind === 'part' && !inv && !i.done
      ? partStateOf(i) === 'ordered' && i.receivedQty
        ? t('parts.nOf', { n: i.receivedQty, of: i.qty })
        : t(`job.part.${partStateOf(i)}`)
      : '';
  // Work outside: where it stands; who does a line, when it is not the job's mechanic.
  const outNote = (i: OrderItem) => (i.outsource && !i.done ? t(`outsource.states.${i.outsource.state}`) : '');
  const whoNote = (i: OrderItem) => (i.employeeId && i.employeeId !== b.order.mechanicId ? mechanics.find((m) => m.id === i.employeeId)?.name ?? '' : '');
  // Swipes on a line, as in the iPhone's lists. Left — off the job: a draft goes at once (with Undo), a
  // line the customer has heard of only uncovers the button (it stays in the history as cancelled).
  // Right — the next good thing: "agreed" on a line that waits, "done" on agreed work.
  const swipeOff = (i: OrderItem): SwipeSpec | undefined =>
    picking || !canPick(i)
      ? undefined
      : i.approvalState === 'draft'
        ? { label: t('common.delete'), icon: IconTrash, color: 'red', onCommit: () => void removeLine(i) }
        : { label: t('job.drop'), icon: IconTrash, color: 'red', full: false, onCommit: () => void run(async () => (await (isAwaitingClient(i) ? withdrawItems([i.id], { cancel: true }) : dropLine(i.id)), haptic('light'))) };
  const swipeOn = (i: OrderItem): SwipeSpec | undefined =>
    picking || !canPick(i)
      ? undefined
      : isAwaitingClient(i)
        ? { label: t('job.agreed'), icon: IconCheck, color: 'green', onCommit: () => void run(async () => (await answerLines([i.id], 'approve'), haptic('success'))) }
        : i.approvalState === 'approved'
          ? { label: i.done ? t('job.lineUndone') : t('job.lineDone'), icon: IconChecks, color: i.done ? 'gray' : 'green', onCommit: () => void run(async () => (await setDone(i.id, !i.done), haptic(i.done ? 'light' : 'success'))) }
          : undefined;
  const row = (i: OrderItem) => (
    <PickRow
      key={i.id}
      selected={picking && picked.has(i.id)}
      onLong={!picking && canPick(i) ? () => setPicked(new Set([i.id])) : undefined}
      trailing={swipeOff(i)}
      leading={swipeOn(i)}
      dim={i.done && !picking}
      left={
        picking && canPick(i) ? (
          picked.has(i.id) ? (
            <IconCircleCheckFilled size={22} color="var(--mantine-color-cobalt-6)" aria-hidden />
          ) : (
            <IconCircle size={22} stroke={1.6} color="var(--app-label-3)" aria-hidden />
          )
        ) : (
          <LineMark item={i} />
        )
      }
      title={
        <Text span inherit td={i.approvalState === 'declined' ? 'line-through' : undefined} c={i.approvalState === 'declined' ? 'dimmed' : undefined}>
          {itemTitle(i, docLang) || '—'}
          {!!i.mediaIds?.length && <IconPhoto size={15} stroke={1.9} color="var(--mantine-color-dimmed)" aria-label={t('slot.photo')} style={{ marginLeft: 6, verticalAlign: -2 }} />}
        </Text>
      }
      subtitle={dots([
        i.kind === 'part' && i.qty !== 1 ? `${i.qty} × ${formatAed(itemAmounts({ ...i, qty: 1 }).gross)}` : '',
        // Where the part is, in its colour (to find — orange, ordered — blue, here — green), as on the board.
        partNote(i) && (
          <span key="part" className="part-note" style={{ color: `var(--mantine-color-${PART_COLOR[partStateOf(i)]}-light-color)` }}>
            {partNote(i)}
          </span>
        ),
        outNote(i),
        whoNote(i),
        i.vatRateBp === 0 && !i.customerSupplied ? t('item.noVat') : '',
      ])}
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
      grip={
        picking && canPick(i) && lines.length > 1 ? (
          <span className="sort-grip" aria-label={t('job.move')} {...sortGrip(i.id)}>
            <IconMenu2 size={20} stroke={2} aria-hidden />
          </span>
        ) : undefined
      }
      onClick={
        picking
          ? canPick(i)
            ? () => togglePick(i.id)
            : undefined
          : !editable || i.approvalState === 'declined'
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
  const paid = paidNet(b.payments);
  // Closed without the manager taking the money, under the total: paid to the owner (neutral), or let go (orange).
  const waivedRow = b.order.waived ? (
    b.order.waived.via === 'owner' ? (
      <ListRow
        left={<IconUserDollar size={20} stroke={1.8} color="var(--mantine-color-cobalt-6)" aria-hidden />}
        title={<Text span c="dimmed" inherit>{t('job.paidOwner')}</Text>}
        right={<Money fils={b.order.waived.fils} c="dimmed" />}
      />
    ) : (
      <ListRow left={<IconCashOff size={20} stroke={1.8} color="var(--mantine-color-orange-6)" aria-hidden />} title={<Text span c="orange.7" inherit>{t('job.unpaid')}</Text>} right={<Money fils={b.order.waived.fils} c="orange.7" />} />
    )
  ) : null;
  // What the job earns (without VAT, less parts, work outside, expenses) — once some cost is known.
  const profit = jobProfit({ order: b.order, items: b.items, invoices: b.invoices, expenses: expenses ?? [] });
  const profitRow = profit.known ? (
    <ListRow
      title={<Text span c="dimmed" inherit>{t('job.profit')}</Text>}
      right={
        <span className="profit-amount" data-shown={profitShown}>
          <Money fils={profit.profit} c={profit.profit < 0 ? 'red.7' : 'green.7'} />
        </span>
      }
      onClick={() => setProfitShown((s) => !s)}
    />
  ) : null;
  const hasAgreed = live.some((i) => i.kind !== 'discount' && i.approvalState === 'approved');

  // The '…' tiles keep their places: the ones every job has first (customer, car, mechanic, photos), then
  // what this step brings, and the destructive ones always last.
  const tiles: Tile[] = [];
  tiles.push({ key: 'customer', icon: IconUser, onClick: () => setCustomerOpen(true) });
  tiles.push({ key: 'car', icon: IconCar, onClick: () => navigate(`/vehicles/${b.vehicle.id}`) });
  if (open) tiles.push({ key: 'mechanic', icon: IconClipboardList, onClick: () => setMechanicOpen(true) });
  if (open) tiles.push({ key: 'photos', icon: IconCamera, onClick: () => navigate(`/orders/${oid}/intake`) });
  if (open) tiles.push({ key: 'scanner', icon: IconEngine, onClick: obd.pick });
  if (inv) tiles.push({ key: 'invoice', icon: IconFileInvoice, onClick: () => void run(async () => openPdf(await invoicePdf(inv.id))) });
  else if (live.length) tiles.push({ key: 'quote', icon: IconFileTypePdf, onClick: () => void run(async () => openPdf(await quotationPdf(oid))) });
  if (inv || hasAgreed) tiles.push({ key: 'report', icon: IconClipboardCheck, color: 'green', onClick: report });
  if (open && !inv) tiles.push({ key: 'prepay', icon: IconCash, color: 'green', onClick: () => setPay('prepayment') });
  if (open && (lines.length > 0 || inv) && (!inv || due > 0)) tiles.push({ key: 'discount', icon: IconDiscount, onClick: () => setDiscountOpen(true) });
  // The car leaves now, the money comes later: a signed debt (on the payments tab of the details).
  if (inv && due > 0 && phase === 'pay') tiles.push({ key: 'debt', icon: IconSignature, color: 'orange', onClick: () => navigate(`/orders/${oid}/details?tab=payments`) });
  // The car leaves and nothing is owed: no payment, no debt (warranty, goodwill, the money will not come).
  if (canCloseUnpaid(b.order.stage, due)) tiles.push({ key: 'unpaid', icon: IconCashOff, color: 'orange', onClick: () => setUnpaid(true) });
  if (phase === 'closed') tiles.push({ key: 'claim', icon: IconScale, color: 'orange', onClick: () => navigate(`/orders/${oid}/claim`) });
  if (lines.some(canPick)) tiles.push({ key: 'select', icon: IconListCheck, onClick: () => setPicked(new Set()) });
  if (amendable) tiles.push({ key: 'amend', icon: IconPencil, onClick: () => setAmend({}) });
  tiles.push({ key: 'details', icon: IconListDetails, onClick: () => navigate(`/orders/${oid}/details`) });
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
      // Money coming in: green with cash, as the book shows money in and the step "pay" is coloured.
      <Button fullWidth color="green" leftSection={<IconCash size={20} />} onClick={() => setPay('payment')}>
        {t('job.pay')} · {formatAed(due)}
      </Button>
    );
  else if (phase === 'out')
    bar = (
      // The keys go back: the step's own mint and its key, as its pill on the board.
      <Button
        fullWidth
        color="teal"
        loading={busy}
        leftSection={<IconKey size={20} />}
        onClick={() =>
          run(async () => {
            await changeStage(oid, 'closed');
            haptic('success');
            celebrate(t('job.handedOver'));
          })
        }
      >
        {t('job.handOver')}
      </Button>
    );
  else if (canReopen(b.order))
    // Closed or cancelled: back on the board in one tap (the car came back, closed by mistake).
    bar = (
      <Button fullWidth variant="default" loading={busy} leftSection={<IconRestore size={20} />} onClick={() => run(async () => (await reopenJob(oid), haptic('success')), 'job.reopened')}>
        {t('job.reopen')}
      </Button>
    );

  // Picking lines: the bar becomes Cancel · All · Delete N. Drafts go at once (with Undo); lines the
  // customer was told are confirmed first — they stay in the history as cancelled.
  const pickedLines = picked ? lines.filter((i) => picked.has(i.id) && canPick(i)) : [];
  const allPicked = pickedLines.length > 0 && pickedLines.length === lines.filter(canPick).length;
  const removePicked = () =>
    run(async () => {
      const removed = await removeLines(pickedLines.map((i) => i.id));
      setPicked(null);
      setConfirmPicked(false);
      haptic('light');
      if (removed.length && removed.length === pickedLines.length) undoToast(t('item.removedN', { n: removed.length }), t('common.undo'), () => void restoreLines(removed));
      return true;
    });
  if (picking)
    bar = (
      <Group gap={10} wrap="nowrap">
        <Button variant="default" onClick={() => setPicked(null)} style={{ flex: '0 0 auto' }}>
          {t('common.cancel')}
        </Button>
        <Button variant="default" onClick={() => setPicked(allPicked ? new Set() : new Set(lines.filter(canPick).map((i) => i.id)))} style={{ flex: '0 0 auto' }}>
          {allPicked ? t('job.pickNone') : t('job.pickAll')}
        </Button>
        <Button
          color="red"
          loading={busy}
          disabled={!pickedLines.length}
          leftSection={<IconTrash size={18} />}
          onClick={() => (pickedLines.some((i) => i.approvalState !== 'draft') ? setConfirmPicked(true) : void removePicked())}
          style={{ flex: 1 }}
        >
          {t('job.removeN', { n: pickedLines.length })}
        </Button>
      </Group>
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

      {/* On a computer the job keeps a readable width (like a sheet on an iPad), not the whole window. */}
      <div className="job-body" ref={bodyRef}>
      <Box className="surface" p="md" mb="lg">
        <CarCover vehicleId={b.vehicle.id} hideEmpty={!open} />
        <Group gap="sm" wrap="nowrap" justify="space-between">
          <PlateText plate={b.vehicle.plate} size="card" />
          {/* The step's name pops when the job moves on. */}
          <span key={phase} className="pop-in" style={{ flexShrink: 0 }}>
            <PhasePill phase={phase} filled />
          </span>
        </Group>
        <PhaseTrack phase={phase} />
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
          ) : open ? (
            <Button variant="light" size="compact-md" leftSection={<IconUserPlus size={16} />} onClick={() => setCustomerOpen(true)}>
              {t('job.client')}
            </Button>
          ) : (
            <span />
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
        {(open || !!b.order.complaint) && (
          <UnstyledButton className="job-line job-complaint" mt="sm" onClick={open ? () => setComplaintOpen(true) : undefined} aria-label={t('job.complaint')}>
            <IconMessage2 size={18} stroke={1.8} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
            <Text size="sm" c={b.order.complaint ? undefined : 'dimmed'} lineClamp={3}>
              {b.order.complaint || t('job.complaint')}
            </Text>
          </UnstyledButton>
        )}
        <PrevVisit order={b.order} settings={b.settings} lang={docLang} />
        {!!b.order.obdScans?.length && <ObdLine scans={b.order.obdScans} />}
        {/* One flow of chips: when the car was promised, who does the job, the car's VIN photo. Wrapping,
            not scrolling — every chip stays in sight, one tap away. */}
        <div className="chip-row wrap job-foot" aria-label={t('order.mechanic')}>
          {open && phase !== 'booked' && <DueChip order={b.order} lang={lang} />}
          {open &&
            mechanics.map((m) => (
              <button key={m.id} type="button" className="chip" data-active={b.order.mechanicId === m.id} onClick={() => run(() => assignMechanic(oid, b.order.mechanicId === m.id ? undefined : m.id))}>
                {m.name}
              </button>
            ))}
          <VinTile vehicleId={b.vehicle.id} vin={b.vehicle.vin} hideEmpty={!open} />
        </div>
      </Box>

      {inv ? (
        <>
          <List>
            <ListRow
              left={<IconFileInvoice size={22} stroke={1.7} color="var(--mantine-color-green-6)" aria-hidden />}
              title={inv.number}
              right={
                <Group gap={6} wrap="nowrap">
                  {copyButton(36)}
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
                  title={lineName(l.description, l.kind)}
                  onClick={amendable ? () => setAmend({}) : undefined}
                  subtitle={[l.qty !== 1 ? `${l.qty} × ${formatAed(roundFils(l.gross / l.qty))}` : '', l.vatRateBp === 0 && !l.customerSupplied ? t('item.noVat') : ''].filter(Boolean).join(' · ') || undefined}
                  right={<Money fils={l.gross} />}
                />
              ))}
            {invOff.length > 0 && discountRow(undefined, invOff[0].description, invOff.reduce((a, l) => a + l.gross, 0))}
          </List>
          {amendable && (
            // Something forgotten or to change after the invoice: the same buttons, the invoice is redone.
            <Group gap={8} mt="sm" wrap="nowrap">
              <Button variant="light" leftSection={<IconTool size={18} />} onClick={() => setAmend({ then: () => setSheet({ kind: 'labor' }) })} style={{ flex: 1 }}>
                {t('job.addWork')}
              </Button>
              <Button variant="light" leftSection={<IconPackage size={18} />} onClick={() => setAmend({ then: () => setSheet({ kind: 'part' }) })} style={{ flex: 1 }}>
                {t('job.addPart')}
              </Button>
              <ActionIcon variant="light" size={44} radius="xl" aria-label={t('job.amend')} onClick={() => setAmend({})} style={{ flexShrink: 0 }}>
                <IconPencil size={20} />
              </ActionIcon>
            </Group>
          )}
          <Box mt="lg">
            <List>
              <ListRow title={<Text span fw={700} inherit>{t('job.total')}</Text>} right={<Text fz={24} lh={1.1}><Money fils={inv.totalFils} display roll /></Text>} />
              {paid > 0 && <ListRow title={<Text span c="dimmed" inherit>{t('qi.paid')}</Text>} right={<Money fils={paid} c="green.7" />} />}
              {due > 0 && paid > 0 && <ListRow title={<Text span c="dimmed" inherit>{t('qi.due')}</Text>} right={<Money fils={due} c="red.7" />} />}
              {waivedRow}
              {profitRow}
            </List>
          </Box>
        </>
      ) : (
        <>
          {(lines.length > 0 || refusedLines.length > 0) && (
            <List animate={!picking}>
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
              {lines.length > 0 && copyButton(44)}
            </Group>
          )}
          {(phase === 'look' || phase === 'price') && editable && quick.length > 0 && (
            // Building the quote: the usual jobs for such a complaint, one tap each (name, last price) — under
            // the lines, where the work is added.
            <div className="chip-row" style={{ marginTop: 12 }} aria-label={t('qi.frequent')}>
              {quick.map(([name, s]) => (
                <button key={name} type="button" className="chip" onClick={() => quickAdd(s)}>
                  {name}
                  <span className="chip-note">{formatAed(s.gross ?? s.price, lang, false)}</span>
                </button>
              ))}
            </div>
          )}
          {live.length > 0 && (
            <Box mt="lg">
              <List>
                <ListRow
                  title={<Text span fw={700} inherit>{t('job.total')}</Text>}
                  subtitle={sum.vat ? t('job.vatIn', { vat: formatAed(sum.vat, lang, false) }) : undefined}
                  right={<Text fz={24} lh={1.1}><Money fils={sum.gross} display roll /></Text>}
                />
                {waivedRow}
                {profitRow}
              </List>
            </Box>
          )}
        </>
      )}

      {(phase === 'pay' || phase === 'out') && <HandoverChecks order={b.order} />}
      <NotesSection orderId={oid} notes={b.notes} editable={open} />

      {bar && (
        <StickyBar>
          {/* The button of the new step settles in on a spring. */}
          <div key={picking ? 'pick' : phase} className="bar-swap">
            {bar}
          </div>
        </StickyBar>
      )}
      </div>

      <LazySheet opened={!!sheet} warm={editable}>
        {(o) => (
          <LineSheet
            b={b}
            kind={shownSheet?.kind ?? 'labor'}
            item={shownSheet?.item}
            opened={o}
            onClose={() => setSheet(null)}
            onDelete={sheet?.item ? () => removeLine(sheet.item!) : undefined}
            suggestions={shownSheet ? suggestions?.[shownSheet.kind] : undefined}
          />
        )}
      </LazySheet>
      <LineActions b={b} item={act} onClose={() => setAct(null)} onEdit={(i) => setSheet({ kind: i.kind === 'part' ? 'part' : 'labor', item: i })} />
      <LazySheet opened={more}>
        {(o) => (
          <MoreSheet opened={o} onClose={() => setMore(false)} tiles={tiles} />
        )}
      </LazySheet>
      <LazySheet opened={mechanicOpen}>
        {(o) => (
          <MechanicSheet b={b} opened={o} onClose={() => setMechanicOpen(false)} />
        )}
      </LazySheet>
      {obd.input}
      <LazySheet opened={complaintOpen}>
        {(o) => (
          <ComplaintSheet b={b} opened={o} onClose={() => setComplaintOpen(false)} />
        )}
      </LazySheet>
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
        opened={!!amend}
        onClose={() => setAmend(null)}
        title={t('job.amendTitle')}
        confirmLabel={t('job.amend')}
        onConfirm={() =>
          run(async () => {
            const then = amend?.then;
            await amendInvoice(oid);
            haptic('light');
            then?.();
            return true;
          })
        }
      >
        <Text size="sm">{t('job.amendText', { number: inv?.number ?? '' })}</Text>
      </ConfirmModal>
      <ConfirmModal
        opened={confirmPicked}
        onClose={() => setConfirmPicked(false)}
        title={t('job.removeTitle')}
        confirmLabel={t('job.removeN', { n: pickedLines.length })}
        color="red"
        onConfirm={removePicked}
      >
        <Text size="sm">{t('job.removeText')}</Text>
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
      <ConfirmModal
        opened={unpaid}
        onClose={() => setUnpaid(false)}
        title={t('job.unpaidTitle')}
        // The usual case first: the customer settled with the owner. Nothing goes into the cash either way.
        confirmLabel={t('job.paidOwner')}
        onConfirm={() =>
          run(async () => {
            await closeUnpaid(oid, 'owner');
            haptic('success');
            scrollToTop();
            return true;
          })
        }
        secondary={{
          label: t('job.noMoney'),
          color: 'orange',
          onClick: () =>
            run(async () => {
              await closeUnpaid(oid);
              haptic('success');
              scrollToTop();
              return true;
            }),
        }}
      >
        <Text size="sm">{t('job.unpaidText')}</Text>
        <Text mt="sm" fw={700} fz={20}>
          <Money fils={due} display />
        </Text>
      </ConfirmModal>
      <LazySheet opened={remove}>
        {(o) => (
          <DeleteJobModal
            order={b.order}
            opened={o}
            onClose={() => setRemove(false)}
            // The job's screen goes back first (it must not show an empty page), then the job is deleted.
            beforeDelete={async () => {
              if (stackBack) stackBack('/');
              else navigate('/');
              await new Promise((r) => setTimeout(r, 520));
            }}
          />
        )}
      </LazySheet>
      {pay && <PaymentModal b={b} opened onClose={() => setPay(null)} kind={pay} />}
      <LazySheet opened={discountOpen}>{(o) => <DiscountSheet b={b} opened={o} onClose={() => setDiscountOpen(false)} />}</LazySheet>
      <LazySheet opened={customerOpen}>{(o) => <CustomerModal opened={o} onClose={() => setCustomerOpen(false)} customer={c} orderId={oid} />}</LazySheet>
      <SendDialog customer={c} request={sv.send} onClose={() => sv.setSend(null)} onSent={() => void syncStage(oid)} />
      <SendDialog customer={c} request={send} onClose={() => setSend(null)} />
    </>
  );
}
