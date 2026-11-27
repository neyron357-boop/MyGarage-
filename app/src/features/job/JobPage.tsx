import { ActionIcon, Box, Button, Group, Kbd, Modal, SegmentedControl, Stack, Text, Textarea, UnstyledButton } from '@mantine/core';
import { AiLineWork, AiMark } from '../ai/Ai';
import { CarCheckPill } from '../ai/CarCheck';
import { IconHelpCircle,
  IconStack2,
  IconHistory,
  IconBrandWhatsapp,
  IconPlus,
  IconBuildingCommunity,
  IconUsersGroup,
  IconAlarm,
  IconBell,
  IconBellOff,
  IconCalendar,
  IconCar,
  IconCash,
  IconCashOff,
  IconCheck,
  IconChecks,
  IconCircle,
  IconCircleCheckFilled,
  IconCircleX,
  IconClipboardCheck,
  IconClock,
  IconCopy,
  IconDiscount,
  IconDots,
  IconLayoutSidebarRightExpand,
  IconLock,
  IconEngine,
  IconFileInvoice,
  IconFileTypePdf,
  IconHourglassHigh,
  IconKey,
  IconListCheck,
  IconMenu2,
  IconMessage2,
  IconPencil,
  IconPhone,
  IconPhoto,
  IconPointFilled,
  IconRestore,
  IconScale,
  IconSend,
  IconSignature,
  IconSteeringWheel,
  IconTrash,
  IconArrowBackUp,
  IconUser,
  IconUserDollar,
  IconUserPlus,
  IconTruck,
  IconShoppingCart,
  IconTruckDelivery,
  IconUserCheck,
  IconUserX,
  type Icon,
} from '@tabler/icons-react';
import { Children, Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { mechanicsOf } from '../../domain/crew';
import { formatDate, hoursBetween, monthLong, shortDuration } from '../../domain/dates';
import { lockedMonthOf } from '../../domain/monthLock';
import { discountBase } from '../../domain/discount';
import { isToSend, isUnconfirmed, jobLines, liveLines, type Phase } from '../../domain/flow';
import { activeInvoice, canAmendInvoice, invoiceBuyer, paidNet, reissueDue } from '../../domain/invoice';
import { canReprice, isAwaitingClient, itemAmounts, itemTitle, lineName, unitGross, unitGrossPrice } from '../../domain/items';
import { formatAed, roundFils } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import { quickList } from '../../domain/quickLists';
import { jobProfit } from '../../domain/profit';
import { canReopen } from '../../domain/stages';
import { sumAmounts } from '../../domain/vat';
import type { OrderItem, Payment } from '../../domain/types';
import { tFor } from '../../i18n';
import { syncDiscount } from '../../services/discount';
import { AppError } from '../../services/errors';
import { debtPdf, invoicePdf, openPdf, quotationPdf, versionPdf } from '../../services/documents';
import { addItem, ensureLabourLine, updateItem } from '../../services/estimate';
import { amendInvoice, answerLines, approveAll, carArrived, dropLine, leaveOnDebt, lineDone, phaseOf, refuseAll, removeLines, reopenJob, reorderLines, repriceLine, restoreFromBin, restoreLines, reviseLine, setUnconfirmed, syncStage, takeBack } from '../../services/flow';
import { invoiceTemplate, partNamesText, reportText, simpleMessage, versionMessage, whatsappUrl } from '../../services/messages';
import { waReady } from '../../services/whatsapp';
import { useWaSel } from '../../ui/waSel';
import { useOpenChat } from '../whatsapp/openChat';
import { waAutoOf } from '../../domain/waAuto';
import { getSettings } from '../../services/settings';
import { sendClientReport, sendWorkReport } from '../../services/waAuto';
import { copyText } from '../../ui/clipboard';
import { quickInvoice } from '../../services/money';
import { bundleAmountDue, changeStage, toggleMechanic, updateOrder, type OrderBundle } from '../../services/orders';
import { setProcurement } from '../../services/parts';
import { ConfirmModal, EmptyState, List, ListRow, Money, MoneyInput, PageHeader, PageSkeleton, PersonAvatar, PlateText, ScrollTabs, StickyBar, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { celebrate } from '../../ui/motion';
import { useLongPress } from '../../ui/longPress';
import { useSortable } from '../../ui/sortable';
import { useAction, useLang, useOrderBundle, usePhone, useScreenLiveQuery } from '../../ui/hooks';
import { useDesk, useDeskHotkeys, useDeskPane } from '../../ui/desk';
import { openTwin, useTwin } from '../../ui/deskTwin';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { useJobQuick, type JobQuick } from '../../ui/jobQuick';
import { LazySheet, SheetFor } from '../../ui/lazy';
import { holdKeyboard } from '../../ui/keyboard';
import { markJobOpened } from '../../ui/recentJobs';
import { QuickAddSheet, type QuickKind } from './QuickAdd';
import { offLabel } from './LineOff';
import { SupplierAskSheet } from './SupplierAsk';
import { BuySheet } from './BuySheet';
import { buyable } from '../../domain/supplierOrder';
import { PriceSheet } from './PriceSheet';
import { setJobQuiet } from '../../services/notify';
import { ReminderSheet } from '../notify/ReminderSheet';
import { OwnerCheckSheet } from './OwnerCheck';
import { QuoteOptionsSheet } from './QuoteOptions';
import { PartThumb } from './PartThumb';
import { PartsBatchSheet } from './PartsBatch';
import { scrollToTop, useStackBack } from '../../ui/stack';
import { useStuck } from '../../ui/sticky';
import { useTabSwipe } from '../../ui/tabSwipe';
import { useSwipeHint, type SwipeSpec } from '../../ui/swipe';
import { CustomerModal } from '../customers/forms';
import { DiscountSheet } from '../money/DiscountSheet';
import { PaymentModal } from '../money/PaymentSheets';
import { DeleteJobModal } from '../orders/DeleteJob';
import { CarCover, MulkiyaTile, VinTile } from './CarCover';
import { useSendVersion } from './sendVersion';
import { DueChip, DueSheet } from './Due';
import { JobDayChip, JobDaySheet } from './JobDay';
import { FirstRows } from '../../ui/firstRows';
import { invoiceDayFor, jobDay } from '../../domain/jobDay';
import { DayPill } from '../../ui/DateFields';
import { DriverLine, DriverSheet } from './Driver';
import { OdometerChip } from './Odometer';
import { JobCardChip } from './JobCard';
import { HANDOVER_CHECKS, HandoverChecks } from './HandoverChecks';
import { MechanicSheet } from './MechanicSheet';
import { NotesChat } from './Notes';
import { OutsourceActions, ReceivedRow, ReturnTerms } from './LineExtras';
import { RequestButton, SupplierChips, WhoChips } from './PartTools';
import { ObdLine, useObdImport } from './ObdScan';
import { LineSheet, PART_COLOR, PART_STATES, partStateOf, PriceFromMark, useSuggestions, type LineKind, type PartState, type Suggestion } from './LineSheet';
import { isLabourCharge } from '../../domain/linePrices';
import { binOf } from '../../domain/bin';
import { BinSheet } from './BinSheet';
import { qtyShort } from '../../domain/sides';
import { labourWords, plainLabour } from '../../domain/labourName';
import { QtyCheckList, QtyCheckSheet } from './QtyCheck';
import { PhasePill, PhaseTrack, usePhaseGlow } from './phase';
import { DeclinedBefore, PrevVisit } from './PrevVisit';
import { CustomerAnswerRow } from './CustomerAnswer';
import { PaymentShotRow } from './PaymentShot';
import { AutopilotRow } from './Autopilot';
import { ShareJobButton } from './ShareJob';
import { ClientView } from './ClientView';
import { lockForClient, useClientLock } from '../../ui/clientLock';

/** What a line is to the job right now, as one symbol. */
function LineMark({ item }: { item: OrderItem }) {
  const { t } = useTranslation();
  // When the line's state changes (agreed, done) its symbol pops; not when the screen opens.
  const shown = useRef(false);
  useEffect(() => {
    shown.current = true;
  }, []);
  const state = item.approvalState === 'approved' && item.done ? 'done' : isUnconfirmed(item) ? 'unconfirmed' : item.approvalState;
  const mark =
    state === 'unconfirmed' ? (
      // Not confirmed yet (v0.88): out of the quote and the invoice until it is.
      <IconHelpCircle size={20} stroke={2} color="var(--mantine-color-yellow-7)" aria-label={t('job.unconfirmed')} />
    ) : state === 'pending' ? (
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
  whatsapp: 'green',
  toWork: 'green',
  toClient: 'teal',
  car: 'indigo',
  driver: 'violet',
  scanner: 'cyan',
  due: 'yellow',
  day: 'indigo',
  remind: 'cobalt',
  invoice: 'grape',
  quote: 'grape',
  select: 'teal',
  amend: 'grape',
  owner: 'green',
};



/**
 * Under the job's lines: work, a part, a service as tiles — the symbol on its colour, the word under it, as the
 * "…" tiles — then the extras (the discount, the copy, a change after the invoice) as narrow tiles beside them.
 */
function AddBar({ onAdd, flush, children }: { onAdd: (kind: QuickKind) => void; flush?: boolean; children?: ReactNode }) {
  const { t } = useTranslation();
  const desk = useDesk();
  const extras = Children.toArray(children).filter(Boolean).length;
  // v0.91.7 (the owner: «оставить одну сплошную кнопку с автоопределением типа позиции… добавляю вперемешку запчасть, труд
  // или услугу»): one wide tile — the kind of each line is found as it is typed (QuickAdd.tsx, «Авто»).
  const one = (
    <button type="button" className="action-tile add-btn add-one" onClick={() => onAdd('auto')} data-add-line>
      <span className="tile-icon" style={{ '--c': 'var(--mantine-color-cobalt-6)' } as React.CSSProperties}>
        <IconPlus size={19} stroke={2.4} aria-hidden />
      </span>
      <span>{t('job.addLine')}</span>
      {desk && (
        <Kbd className="add-kbd" aria-hidden>
          1
        </Kbd>
      )}
    </button>
  );
  // A phone: the extras in a row of their own under it (their words fit there).
  if (!desk && extras)
    return (
      <>
        <div className="add-row add-one-row" data-flush={flush || undefined}>
          {one}
        </div>
        <div className="add-row add-extras">{children}</div>
      </>
    );
  return (
    <div className="add-row" data-flush={flush || undefined}>
      {one}
      {children}
    </div>
  );
}

/**
 * A narrow tile beside them: its symbol only (the name for screen readers). In a row of their own (a phone, three or
 * more) the extras are tiles as wide as the three above — and, as those, say their word under the symbol (v0.57).
 */
function AddExtra({ icon: I, label, word, onClick }: { icon: Icon; label: string; word: string; onClick: () => void }) {
  return (
    <button type="button" className="action-tile add-extra" aria-label={label} onClick={onClick}>
      <I size={21} stroke={1.9} aria-hidden />
      <span className="add-extra-word">{word}</span>
    </button>
  );
}

/** The tiles of "…": one tap, one word each — in its sheet, and on a PC beside the job (v0.41). */
function ActionTiles({ tiles, onPick }: { tiles: Tile[]; onPick?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="action-tiles">
      {tiles.map((x) => (
        <button
          key={x.key}
          type="button"
          className="action-tile"
          onClick={() => {
            onPick?.();
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
  );
}

/** Everything else that can happen to a job, as a grid of tiles: one tap, one word each. */
function MoreSheet({ opened, onClose, tiles }: { opened: boolean; onClose: () => void; tiles: Tile[] }) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={t('common.more')}>
      <ActionTiles tiles={tiles} onPick={onClose} />
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

/**
 * A mechanic's chip on the job's card: a tap puts them on the job or takes them off; a hold (a right click on a
 * PC) opens the task for the job's mechanics — in English, with the lines' photos, to share or copy (v0.21: it was
 * "…" → "Mechanic", which read like a picker of the mechanics the chips already are).
 */
function MechanicChip({ name, on, onToggle, onTask }: { name: string; on: boolean; onToggle: () => void; onTask: () => void }) {
  const press = useLongPress(onTask);
  return (
    <button type="button" className="chip mechanic-chip" data-active={on} aria-pressed={on} {...press.handlers} onClick={() => !press.consumeClick() && onToggle()}>
      {/* A person, not a paper (v0.57): the initials as the contacts show them — grey while off the job. */}
      <PersonAvatar name={name} size={24} muted={!on} />
      {name}
    </button>
  );
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
  const [value, setValue] = useState<number | undefined>(() => unitGross(item));
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
          <Button color="green" variant={i.done ? 'light' : 'filled'} loading={busy} leftSection={<IconChecks size={18} />} onClick={() => act(() => lineDone(i.id, !i.done))}>
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
                if (waiting) await takeBack([i.id]);
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
          <Button variant="subtle" color="red" loading={busy} onClick={() => act(() => (waiting ? takeBack([i.id], { cancel: true }) : dropLine(i.id)))}>
            {t('job.drop')}
          </Button>
        )}
      </Stack>
    </Modal>
  );
}

/**
 * The job's tabs, in their order on screen: the job, and its notes. No «WhatsApp» tab (v0.90, the owner's note #71: «убрать
 * отсюда WhatsApp, сделать возможным открытие WhatsApp чат клиента только через быстрые действия»): the customer's chat is
 * «＋» → «Чат» on a phone (the «…» tile on a PC), and opens in «WhatsApp».
 */
const JOB_TABS = ['main', 'notes'] as const;

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
  const b = useOrderBundle(id);
  // «＋» on this screen is this job's own actions (v0.85, ui/jobQuick.ts): set below, read when «＋» is touched.
  const quickActs = useRef<() => JobQuick[]>(() => []);
  useJobQuick(quickActs);
  // Opened (v0.81): the board puts it on top — remembered on this device only, nothing of the job is written.
  useEffect(() => {
    if (id) markJobOpened(id);
  }, [id]);
  // The garage's WhatsApp is linked (v0.78): the customer's chat — «＋» → «Чат» (a PC: the «…» tile), opened in «WhatsApp».
  const waLinked = useWaSel(waReady);
  const tabs = JOB_TABS;
  // The tabs — the job, its notes (a chat with oneself); the address keeps which, without a step in the history (and keeps
  // the rest of itself: a job beside it on a PC, v0.80).
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab = asked === 'notes' ? 'notes' : 'main';
  const openCustomerChat = useOpenChat();
  const openChat = () => b && openCustomerChat(b.customer.whatsapp || b.customer.phone);
  const pickTab = (v: string) => {
    if (v === tab) return;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (v === 'main') next.delete('tab');
        else next.set('tab', v);
        return next;
      },
      { replace: true },
    );
    if (v === 'main') scrollToTop();
  };
  // The tabs move like pages: the page follows the finger sideways, the other one comes in beside it.
  const sw = useTabSwipe(tabs, tab, pickTab);
  // A PC (v0.80; v0.80.3 — a whole second tab, not only a new job): opened beside this job, which stays.
  const pane = useDeskPane();
  const twinOpen = !!useTwin();
  const openBeside = () => openTwin('/');
  // The tabs stay in reach under the navigation bar (a long chat, a long job): backed only once stuck.
  const tabsMark = useRef<HTMLDivElement>(null);
  const tabsBar = useRef<HTMLDivElement>(null);
  const stackBack = useStackBack();
  const { run, busy } = useAction();
  // Where its reports go (v0.79): the work group, set in «WhatsApp → Автоматизация».
  const waGroups = useScreenLiveQuery(async () => ({ work: !!waAutoOf((await getSettings()).waAuto).work.to }), []);
  // Shown to the customer (v0.67): the job locked to its customer's view until the lock is held.
  const locked = useClientLock();
  // Quick lines in the language of this job's documents (English by default), as they will be printed.
  // Read a moment after the job slid in, and only while lines can still be added.
  // Each at the price this car, this customer, this model had (v0.68).
  const suggestions = useSuggestions(
    { lang: b?.order.docLanguage ?? 'en', orderId: b?.order.id, vehicleId: b?.vehicle.id, customerId: b?.order.customerId, make: b?.vehicle.make, model: b?.vehicle.model, complaint: b?.order.complaint },
    !!b && !['closed', 'cancelled'].includes(b.order.stage) && !activeInvoice(b.invoices),
  );
  const sv = useSendVersion(b);
  const mechanics = useScreenLiveQuery(() => db.employees.filter((e) => e.active).toArray(), []) ?? [];
  const [sheet, setSheet] = useState<{ kind: LineKind; item?: OrderItem } | null>(null);
  // A part as a part; the labour charge as work; anything else done to the car — a service (v0.68), outside or here.
  const sheetKind = (i: OrderItem): LineKind => (i.kind === 'part' ? 'part' : i.outsource || !isLabourCharge(itemTitle(i, i.titleEn ? 'en' : 'ru')) ? 'service' : 'labor');
  // While the sheet slides away it keeps showing what it showed (not "Add labour" for a part).
  const lastSheet = useRef(sheet);
  if (sheet) lastSheet.current = sheet;
  // New lines (v0.81): the quick sheet — search, one tap adds, the keyboard stays (QuickAdd.tsx); a tile's tap holds the
  // keyboard up for its field (ui/keyboard.ts).
  const [quickKind, setQuick] = useState<QuickKind | null>(null);
  const lastQuick = useRef<QuickKind>('auto');
  if (quickKind) lastQuick.current = quickKind;
  const openQuick = (k: QuickKind) => {
    holdKeyboard();
    setQuick(k);
  };
  // «+ Цена» on a draft line (v0.81, PriceSheet.tsx): its row's price — a tap; its name — its card.
  const [priceFor, setPriceFor] = useState<OrderItem | null>(null);
  // «Поставщики» (v0.82): the parts to the suppliers that fit, picked in one sheet.
  const [askOpen, setAskOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const lastPrice = useRef<OrderItem | null>(null);
  if (priceFor) lastPrice.current = b?.items.find((x) => x.id === priceFor.id) ?? priceFor;
  const openPrice = (i: OrderItem) => {
    holdKeyboard();
    setPriceFor(i);
  };
  const shownSheet = sheet ?? lastSheet.current;
  const [act, setAct] = useState<OrderItem | null>(null);
  const [more, setMore] = useState(false);
  const [finish, setFinish] = useState(false);
  // The parts short of their names, before the quote goes (v0.70).
  const [qtyCheck, setQtyCheck] = useState(false);
  // One line's question, from its «×2?» (v0.70).
  const [qtyLine, setQtyLine] = useState<OrderItem | null>(null);
  // Picking lines to take off several at once (a long press on a line, or “…” → “Select”); null = not picking.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [confirmPicked, setConfirmPicked] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const [remove, setRemove] = useState(false);
  const [pay, setPay] = useState<Payment['kind'] | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  // Changing the lines once the invoice is out: confirmed first (a credit note), then what was tapped.
  const [amend, setAmend] = useState<{ then?: () => void } | null>(null);
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [send, setSend] = useState<SendRequest | null>(null);
  const [mechanicOpen, setMechanicOpen] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  // The invoice's day at «Готово» (v0.53): today — the job's own day for a job typed in later.
  const [invDay, setInvDay] = useState('');
  // Who brought the car (v0.43): a company's driver, picked in one tap.
  const [driverOpen, setDriverOpen] = useState(false);
  // The profit is the manager's: hidden (blurred) until tapped, in case the customer sees the screen.
  const [profitShown, setProfitShown] = useState(false);
  // The job for the owner to check (v0.29): its picture — parts bought and sold, from whom, the profit.
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // The job's bin (v0.68): the lines deleted and taken off, to see and bring back.
  const [binOpen, setBinOpen] = useState(false);
  // The parts picked when it opened (they stay its parts while it slides away).
  const [batch, setBatch] = useState<OrderItem[] | null>(null);
  // A scanner report (PDF) read into the job: codes, odometer, what the car card is missing.
  const obd = useObdImport(id ?? '');
  const expenses = useScreenLiveQuery(() => (id ? db.expenses.where('orderId').equals(id).toArray() : []), [id]);
  // «Запчасти» in the money book: the job's expenses there bought its parts — counted once with them (v0.31).
  const partsCat = useScreenLiveQuery(async () => (await db.expenseCategories.where('code').equals('parts').first())?.id ?? '', []);

  const orderId = b?.order.id;
  const phase: Phase | undefined = b ? phaseOf(b) : undefined;
  // A percentage discount follows the lines (it writes only when it is off). The stage is moved by the
  // actions that change the job (services/flow.ts), never by opening it: a look changes nothing.
  const baseKey = b ? discountBase(b.items).map((i) => `${i.id}:${itemAmounts(i).gross}`).join('|') : '';
  const pctDiscount = !!b?.items.some((i) => i.kind === 'discount' && i.approvalState === 'draft' && i.discountPctBp);
  useEffect(() => {
    if (orderId && pctDiscount) syncDiscount(orderId).catch((e) => console.error(e));
  }, [orderId, baseKey, pctDiscount]);
  // Once on a device: the first line peeks to the left — lines can be swiped.
  useSwipeHint(!!b && !activeInvoice(b.invoices) && !['closed', 'cancelled', 'booked'].includes(b.order.stage) && jobLines(b.items).some((i) => i.kind !== 'discount'));
  // The screen glows in the colour of the job's step.
  const bodyRef = useRef<HTMLDivElement>(null);
  useStuck(tabsMark, tabsBar, !!b);
  usePhaseGlow(bodyRef, phase);

  // Lines moved by hand in edit mode (≡ at the row's end): the quote and the invoice list them so.
  const sortIds = b ? jobLines(b.items).filter((i) => i.kind !== 'discount').map((i) => i.id) : [];
  const sortGrip = useSortable(sortIds, (ids) => {
    if (orderId) void run(async () => (await reorderLines(orderId, ids), haptic('light')));
  });
  // On a PC (v0.41): the job in two columns; 1 — «Добавить позицию», its kind found (v0.91.7); 2 · 3 · 4 — a part, work, a
  // service by hand.
  const phone = usePhone();
  const addable = !!b && !!phase && !['closed', 'cancelled', 'booked'].includes(phase) && !activeInvoice(b.invoices);
  useDeskHotkeys(
    [
      ['1', () => setQuick('auto')],
      ['2', () => setQuick('part')],
      ['3', () => setQuick('labor')],
      ['4', () => setQuick('service')],
    ],
    !phone && addable && tab === 'main',
  );

  if (b === undefined) return <PageSkeleton variant="detail" />;
  if (!b || !phase) return <EmptyState title={t('err.notFound')} />;
  if (locked === b.order.id) return <ClientView b={b} />;

  const oid = b.order.id;
  const docLang = b.order.docLanguage;
  const c = b.customer;
  const inv = activeInvoice(b.invoices);
  // Whom the invoice bills, as its PDF prints it (blank on it — the job's customer now).
  const billTo = inv && invoiceBuyer(inv.buyer, c);
  const due = Math.max(0, bundleAmountDue(b));
  const live = liveLines(b.items);
  // On the screen also the unconfirmed lines (v0.88) — out of every total, the quote and the invoice.
  const listed = jobLines(b.items);
  const lines = listed.filter((i) => i.kind !== 'discount');
  const unconfirmed = lines.filter(isUnconfirmed);
  const discounts = live.filter((i) => i.kind === 'discount');
  // Refused by the customer — those not brought back from the bin (v0.70).
  const refusedLines = b.items.filter((i) => i.approvalState === 'declined' && !i.restoredAt);
  const waiting = b.items.filter(isAwaitingClient);
  const sum = sumAmounts(live.map(itemAmounts));
  // A line with no price yet: «+ Цена» on it; one that goes with the quote stops it (an unconfirmed one does not).
  const noPrice = (i: OrderItem) => i.approvalState === 'draft' && !i.customerSupplied && itemAmounts(i).gross === 0;
  const unpriced = lines.filter((i) => isToSend(i) && noPrice(i));
  const open = phase !== 'closed' && phase !== 'cancelled';
  const editable = open && !inv;
  // A job of a closed month of its customer (v0.69): nothing of it changes — the services refuse too.
  const lockedMonth = lockedMonthOf(b.order, b.invoices, b.customer);
  // The invoice is out, the job open: its lines can be changed (credit note, then a new invoice) — the car here or
  // gone on credit (v0.34).
  const amendable = !lockedMonth && canAmendInvoice(b.order.stage, b.invoices);
  // A car gone on credit whose invoice is being changed: it stays handed over, "Done" issues the new invoice — paid
  // in full meanwhile too (audit 25/11: it no longer closes without one, so "Done" stays).
  const reissue = !inv && (phase === 'debt' || (b.order.stage === 'delivered' && reissueDue(b.invoices)));
  // Lines back from the bin (v0.68; v0.70 — the refused ones too, a job closed reopened for them): before the invoice.
  const binRestore = !lockedMonth && !reissue && !inv && (editable || canReopen(b.order));
  const ctx = { customer: c, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
  const sentAt = waiting.length ? b.versions.filter((v) => waiting.some((i) => i.lastVersionId === v.id)).map((v) => v.sentAt).sort()[0] : undefined;

  const removeLine = (i: OrderItem) =>
    run(async () => {
      const [removed] = await removeLines([i.id]);
      setSheet(null);
      if (removed) undoToast(t('item.removed', { title: itemTitle(removed, lang) }), t('common.undo'), () => void restoreLines([removed]));
    });
  /** The quote to the customer's chat; the lines wait for the answer only once it really went. */
  const sendNow = () => run(() => sv.prepare(oid, { via: c.preferredChannel === 'telegram' ? 'telegram' : 'whatsapp' }));
  // A part whose name asks for more than its quantity (v0.70): looked at before the customer sees the price.
  const toClient = () => (live.some((i) => qtyShort(i)) ? setQtyCheck(true) : void sendNow());
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
    const mileageKm = b.order.mileageKm ?? b.handover?.mileageKm ?? b.intake?.mileageKm ?? (scan?.unit === 'km' ? scan.value : undefined);
    setSend({
      text: reportText(ctx, docLang, { done, checks, mileageKm, warrantyMonths: b.settings.warrantyLaborMonths, warrantyKm: b.settings.warrantyLaborKm }),
      template: 'report',
      lang: docLang,
      orderId: oid,
      pdf: inv ? () => invoicePdf(inv.id) : undefined,
      photos: live.filter((i) => i.approvalState === 'approved').flatMap((i) => i.mediaIds ?? []),
    });
  };
  // When the customer was told of this invoice (the message logged after it was issued), audit 27/11.
  const toldAt = inv ? b.messages.filter((m) => ['carReady', 'documents', 'paymentReminder'].includes(m.template) && m.createdAt >= inv.issuedAt).map((m) => m.createdAt).sort().pop() : undefined;
  const sendInvoice = () =>
    inv &&
    setSend({
      text: simpleMessage(invoiceTemplate(b.order.stage, due), ctx, docLang, { amount: formatAed(due, docLang) }),
      template: invoiceTemplate(b.order.stage, due),
      lang: docLang,
      orderId: oid,
      pdf: () => invoicePdf(inv.id),
    });

  // The usual jobs (those that went with a similar complaint first) for one-tap adding.
  // (A labour charge named by the parts, v0.80, is its plain words: its chip does not come back.)
  const onJob = new Set(listed.map((i) => (plainLabour(itemTitle(i, docLang)) ? labourWords(itemTitle(i, docLang)) : itemTitle(i, docLang))));
  const quick = (suggestions?.work.top ?? [])
    .filter((name) => !onJob.has(name))
    .slice(0, 8)
    .map((name) => [name, suggestions!.work.list.get(name)!] as const);
  const quickAdd = (s: Suggestion) =>
    run(async () => {
      await addItem(oid, { kind: 'labor', block: 'A', titleRu: s.titleRu || undefined, titleEn: s.titleEn || undefined, qty: 1, unitPriceFils: s.price, unitGrossFils: s.gross, ...(s.rate !== undefined ? { vatRateBp: s.rate } : {}) });
      // The labour charge stays last of the lines (v0.90, #70).
      await ensureLabourLine(oid);
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
  // The parts by name only, without prices — the car and its VIN on top: pasted to a parts seller as they are.
  const parts = lines.filter((i) => i.kind === 'part');
  const copyLines = () =>
    run(async () => {
      if (!(await copyText(partNamesText(parts, docLang, b.vehicle)))) throw new AppError('err.copy');
      haptic('light');
    }, 'job.copiedLines');
  // The VIN alone, one tap (v0.70, «быстрый способ копирования VIN — только VIN»): pasted into a catalogue, a chat.
  const vin = b.vehicle.vin?.trim();
  const copyVin = () =>
    run(async () => {
      if (!vin || !(await copyText(vin))) throw new AppError('err.copy');
      haptic('light');
    }, 'job.vinCopied');
  const copyButton = (size: number) =>
    parts.length > 0 && (
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
  // Work outside: where it stands; who does a line — unless it is the one mechanic of the job (with several on
  // it, each line says whose it is).
  const crew = mechanicsOf(b.order);
  const outNote = (i: OrderItem) => (i.outsource && !i.done ? t(`outsource.states.${i.outsource.state}`) : '');
  const whoNote = (i: OrderItem) => (i.employeeId && !(crew.length === 1 && crew[0] === i.employeeId) ? mechanics.find((m) => m.id === i.employeeId)?.name ?? '' : '');
  // Swipes on a line, as in the iPhone's lists. Left — off the job: the swipe only uncovers the button, a tap on it does
  // it — a draft is deleted (with Undo; v0.63.2, the owner: «при свайпе влево слишком быстро удаляется без предложения —
  // можно случайно удалить»: a long swipe deleted it at once), a line the customer has heard of is dropped (it stays in
  // the history as cancelled). Right — the next good thing: "agreed" on a line that waits, "done" on agreed work.
  const swipeOn = (i: OrderItem): SwipeSpec | undefined =>
    // A refused line back (v0.70, «восстановить отменённые»): a draft like it, the job reopened if it was closed.
    !picking && i.approvalState === 'declined' && binRestore
      ? { label: t('job.bin.restore'), icon: IconArrowBackUp, color: 'green', onCommit: () => void run(async () => (await restoreFromBin(oid, [i.id]), haptic('success'))) }
      : picking || !canPick(i)
      ? undefined
      : isAwaitingClient(i)
        ? { label: t('job.agreed'), icon: IconCheck, color: 'green', onCommit: () => void run(async () => (await answerLines([i.id], 'approve'), haptic('success'))) }
        : i.approvalState === 'approved'
          ? { label: i.done ? t('job.lineUndone') : t('job.lineDone'), icon: IconChecks, color: i.done ? 'gray' : 'green', onCommit: () => void run(async () => (await lineDone(i.id, !i.done), haptic(i.done ? 'light' : 'success'))) }
          : i.approvalState === 'draft' && i.kind !== 'discount'
            ? // A draft (v0.88): not confirmed yet — out of the quote and the invoice; again — confirmed.
              isUnconfirmed(i)
              ? { label: t('job.confirm'), icon: IconCheck, color: 'green', onCommit: () => void run(async () => (await setUnconfirmed([i.id], false), haptic('success'))) }
              : { label: t('job.unconfirm'), icon: IconHelpCircle, color: 'yellow', onCommit: () => void run(async () => (await setUnconfirmed([i.id], true), haptic('light'))) }
            : undefined;
  const row = (i: OrderItem) => (
    <PickRow
      key={i.id}
      selected={picking && picked.has(i.id)}
      onLong={!picking && canPick(i) ? () => setPicked(new Set([i.id])) : undefined}
      // No swipe that takes a line away (v0.83, the owner: «убрать свайп для удаления»): a line goes from its sheet or
      // by «Выбрать» (a hold on it).
      leading={swipeOn(i)}
      dim={(i.done || isUnconfirmed(i)) && !picking}
      left={
        picking && canPick(i) ? (
          picked.has(i.id) ? (
            <IconCircleCheckFilled size={22} color="var(--mantine-color-cobalt-6)" aria-hidden />
          ) : (
            <IconCircle size={22} stroke={1.6} color="var(--app-label-3)" aria-hidden />
          )
        ) : i.kind === 'part' ? (
          // A part: its photo beside its state (v0.29) — a place for one, a tap away.
          <Group gap={8} wrap="nowrap">
            <LineMark item={i} />
            <PartThumb item={i} editable={editable} />
          </Group>
        ) : (
          <LineMark item={i} />
        )
      }
      title={
        <Text span inherit td={i.approvalState === 'declined' ? 'line-through' : undefined} c={i.approvalState === 'declined' ? 'dimmed' : undefined}>
          {itemTitle(i, docLang) || '—'}
          {!!i.mediaIds?.length && i.kind !== 'part' && <IconPhoto size={15} stroke={1.9} color="var(--mantine-color-dimmed)" aria-label={t('slot.photo')} style={{ marginLeft: 6, verticalAlign: -2 }} />}
          {/* The garage's AI looking at the line's name (v0.86: every line): its mark twinkles after the name. */}
          {i.kind !== 'discount' && <AiLineWork itemId={i.id} />}
          {/* Its cost put by the AI from a supplier's answer (v0.86): said by the AI's mark. */}
          {i.costAi && (
            <span style={{ marginLeft: 6, verticalAlign: -2, display: 'inline-flex' }}>
              <AiMark size={15} label={t('ai.costByAi')} />
            </span>
          )}
        </Text>
      }
      subtitle={dots([
        // Not confirmed yet (v0.88): said in its own colour — out of the quote and the invoice.
        isUnconfirmed(i) && (
          <span key="unconfirmed" className="line-unconfirmed">
            {t('job.unconfirmed')}
          </span>
        ),
        // Its name asks for more than its quantity (v0.70): «×2?» in orange — a tap asks.
        !picking && qtyShort(i) && (
          <button
            key="qty"
            type="button"
            className="qty-short"
            onClick={(e) => {
              e.stopPropagation();
              setQtyLine(i);
            }}
          >
            {t('qty.short', { n: qtyShort(i) })}
          </button>
        ),
        i.kind === 'part' && i.qty !== 1 ? `${i.qty} × ${formatAed(unitGross(i))}` : '',
        // The labour charge priced by the garage's history (v0.90, #70) — said, until a price is typed by hand.
        i.labourGuess && i.unitPriceFils > 0 && i.unitPriceFils === i.labourGuess.fils && (
          <span key="guess" className="labour-guess" data-labour-guess={i.labourGuess.basis} title={t('job.byHistoryN', { n: i.labourGuess.jobs })}>
            <IconHistory size={13} stroke={2.2} aria-hidden />
            {t('job.byHistory')}
          </span>
        ),
        // Its own discount (v0.82), in green.
        i.lineOff && (
          <span key="off" className="line-off-note">
            {offLabel(i.lineOff, lang)}
          </span>
        ),
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
        editable && !picking && i.approvalState === 'draft' && !i.customerSupplied ? (
          // A draft's price (v0.81): «+ Цена» while it has none — a tap, the cost and the price; then the price itself,
          // a tap to change it (the row's name opens its card).
          <button
            type="button"
            className={noPrice(i) ? 'price-add' : 'price-tap-row tnum'}
            // Not confirmed (v0.88): its sum is out of the total — grey.
            data-off={isUnconfirmed(i) || undefined}
            aria-label={noPrice(i) ? t('price.add') : t('job.changePrice')}
            onClick={(e) => {
              e.stopPropagation();
              openPrice(i);
            }}
          >
            {noPrice(i) ? (
              <>
                <IconPlus size={15} stroke={2.6} aria-hidden />
                {t('price.word')}
              </>
            ) : (
              <Money fils={itemAmounts(i).gross} />
            )}
          </button>
        ) : unpriced.includes(i) ? (
          // No price yet (a part still to find): it cannot go to the customer like this.
          <Text fw={700} c="orange.7" aria-label={t('qi.price')}>
            ?
          </Text>
        ) : (
          <Money fils={itemAmounts(i).gross} c={i.kind === 'discount' ? 'green.7' : i.approvalState === 'declined' ? 'dimmed' : undefined} />
        )
      }
      // The grip is always there (the user's call, v0.17.2): a line is moved up or down without edit mode.
      grip={
        canPick(i) && lines.length > 1 ? (
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
          : i.approvalState === 'declined'
          ? binRestore
            ? () => setBinOpen(true)
            : undefined
          : !editable
          ? undefined
          : i.kind === 'discount'
            ? () => setDiscountOpen(true)
            : i.approvalState === 'draft'
              ? () => setSheet({ kind: sheetKind(i), item: i })
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
  // In a closed month (v0.69): said under the total; a tap — the month among the customer's months.
  const lockRow = lockedMonth ? (
    <ListRow
      chevron
      left={<IconLock size={20} stroke={1.8} color="var(--mantine-color-gray-6)" aria-hidden />}
      title={<Text span c="dimmed" inherit data-job-month-locked>{t('job.monthLocked', { month: monthLong(lockedMonth, lang) })}</Text>}
      data-route={`/money/months?who=${b.order.customerId}&month=${lockedMonth}`} onClick={() => navigate(`/money/months?who=${b.order.customerId}&month=${lockedMonth}`)}
    />
  ) : null;
  // A signed debt, under the total: the date it is due, and its paper (the customer's signature) a tap away.
  const openDebt = b.debts.find((d) => d.status === 'open');
  const debtRow = openDebt ? (
    <ListRow
      left={<IconSignature size={20} stroke={1.8} color="var(--mantine-color-red-6)" aria-hidden />}
      title={<Text span c="red.7" inherit>{t('debt.open', { date: formatDate(openDebt.dueDate) })}</Text>}
      onClick={() => void run(async () => openPdf(await debtPdf(openDebt.id)))}
      right={
        <Group gap={8} wrap="nowrap">
          {/* What is owed now (the invoice changed since, payments made; while it is changed — by its lines); the
              paper keeps the sum signed. */}
          <Money fils={reissue ? Math.max(0, sum.gross - paid) : due} c="red.7" />
          <IconFileTypePdf size={18} color="var(--mantine-color-dimmed)" aria-label={t('debt.document')} />
        </Group>
      }
    />
  ) : null;
  // What the job earns (with VAT: the total less parts as bought, work outside, expenses) — once some cost is known.
  const profit = jobProfit({ order: b.order, items: b.items, invoices: b.invoices, expenses: expenses ?? [], partsCategoryId: partsCat || undefined });
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

  // The '…' tiles keep their places: the ones every job has first (customer, car), then what this step brings,
  // and the destructive ones always last. Not here (v0.21): the mechanics — their chips on the card (a hold: their
  // task); the discount — "%" under the lines; the check-in act's photo screen — the job card is the inspection.
  const tiles: Tile[] = [];
  tiles.push({ key: 'customer', icon: IconUser, onClick: () => setCustomerOpen(true) });
  // The customer's WhatsApp chat in the app (v0.78): while the garage's WhatsApp is linked and there is a number. A phone —
  // only «＋» → «Чат» (v0.90, #71); a PC, which has no «＋» of the job, — this tile.
  const waPhone = b.customer.whatsapp || b.customer.phone;
  if (waLinked && waPhone && !phone) tiles.push({ key: 'whatsapp', icon: IconBrandWhatsapp, onClick: openChat });
  // The reports by hand (v0.79): the job to the work group, the visit to the company's own group — no prices.
  // Seen before it goes (v0.85): the report opens in «Проверить и отправить».
  const toWork = () => void run(() => sendWorkReport(oid));
  const toClientGroup = () => void run(() => sendClientReport(oid));
  if (waLinked && waGroups?.work) tiles.push({ key: 'toWork', icon: IconUsersGroup, onClick: toWork });
  if (waLinked && b.customer.waGroup) tiles.push({ key: 'toClient', icon: IconBuildingCommunity, onClick: toClientGroup });
  tiles.push({ key: 'car', icon: IconCar, onClick: () => navigate(`/vehicles/${b.vehicle.id}`) });
  // Who brought the car: a company's job has it on its card too; a private customer's — here only.
  tiles.push({ key: 'driver', icon: IconSteeringWheel, onClick: () => setDriverOpen(true) });
  if (open) tiles.push({ key: 'scanner', icon: IconEngine, onClick: obd.pick });
  // When the car was promised: rarely needed (the user's call, v0.17.3) — a tile here; once set, its chip on the card.
  if (open && phase !== 'booked') tiles.push({ key: 'due', icon: IconClock, onClick: () => setDueOpen(true) });
  // A reminder about this job, on the phone at its time (v0.74); and the job kept quiet — a car that stands for weeks
  // is not said again every hour («Сегодня» lists it all the same).
  if (open) tiles.push({ key: 'remind', icon: IconAlarm, onClick: () => setRemindOpen(true) });
  if (open) {
    const quiet = !!b.order.notifyOff;
    tiles.push({ key: quiet ? 'loud' : 'quiet', icon: quiet ? IconBell : IconBellOff, color: 'gray', onClick: () => void run(() => setJobQuiet(oid, !quiet), quiet ? 'notify.jobLoud' : 'notify.jobQuiet') });
  }
  // The day the car came (v0.53): a job typed in later is put on the day it was.
  if (open && phase !== 'booked' && !lockedMonth) tiles.push({ key: 'day', icon: IconCalendar, onClick: () => setDayOpen(true) });
  if (inv) tiles.push({ key: 'invoice', icon: IconFileInvoice, onClick: () => void run(async () => openPdf(await invoicePdf(inv.id))) });
  else if (live.length) tiles.push({ key: 'quote', icon: IconFileTypePdf, onClick: () => void run(async () => openPdf(await quotationPdf(oid))) });
  if (inv || hasAgreed) tiles.push({ key: 'report', icon: IconClipboardCheck, color: 'green', onClick: report });
  if (open && !inv && !reissue) tiles.push({ key: 'prepay', icon: IconCash, color: 'green', onClick: () => setPay('prepayment') });
  // On credit and without payment are ways to settle the job: in the payment sheet ("Pay"), not here.
  if (phase === 'closed') tiles.push({ key: 'claim', icon: IconScale, color: 'orange', onClick: () => navigate(`/orders/${oid}/claim`) });
  if (live.some((i) => i.kind !== 'discount')) tiles.push({ key: 'owner', icon: IconUserCheck, onClick: () => setOwnerOpen(true) });
  if (lines.some(canPick)) tiles.push({ key: 'select', icon: IconListCheck, onClick: () => setPicked(new Set()) });
  if (amendable) tiles.push({ key: 'amend', icon: IconPencil, onClick: () => setAmend({}) });
  if (editable && phase !== 'booked' && !reissue) tiles.push({ key: 'refuse', icon: IconUserX, color: 'red', onClick: () => setRefuse(true) });
  if (binOf(b.order, b.items).length) tiles.push({ key: 'bin', icon: IconArrowBackUp, color: 'gray', onClick: () => setBinOpen(true) });
  if (!lockedMonth) tiles.push({ key: 'remove', icon: IconTrash, color: 'red', onClick: () => setRemove(true) });

  // This job's «＋» (v0.85, the owner: «быстрое действие для отправки сметы или инвойса, в группу рабочий чат, боссу или
  // клиенту… чтобы пару секунд занимали действия»): what to send now first, a new job last.
  quickActs.current = () => {
    const out: JobQuick[] = [];
    if (inv) out.push({ key: 'invoice', icon: IconFileInvoice, color: 'violet', run: sendInvoice });
    else if (phase === 'price' && !unpriced.length && live.length) out.push({ key: 'estimate', icon: IconSend, color: 'cobalt', run: toClient });
    else if (phase === 'wait') out.push({ key: 'remind', icon: IconAlarm, color: 'orange', run: remind });
    if (waLinked && waGroups?.work) out.push({ key: 'toWork', icon: IconUsersGroup, color: 'teal', run: toWork });
    if (waLinked && b.customer.waGroup) out.push({ key: 'toClient', icon: IconBuildingCommunity, color: 'indigo', run: toClientGroup });
    if (live.some((i) => i.kind !== 'discount')) out.push({ key: 'owner', icon: IconUserCheck, color: 'grape', run: () => setOwnerOpen(true) });
    if (inv || hasAgreed) out.push({ key: 'report', icon: IconClipboardCheck, color: 'green', run: report });
    if (waLinked && waPhone) out.push({ key: 'whatsapp', icon: IconBrandWhatsapp, color: 'green', run: openChat });
    out.push({ key: 'new', icon: IconPlus, color: 'gray', run: () => navigate('/orders/new') });
    return out;
  };

  let bar: ReactNode = null;
  if (phase === 'booked')
    bar = (
      <Button fullWidth loading={busy} onClick={() => run(() => carArrived(oid))}>
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
      <Button fullWidth color="green" loading={busy} leftSection={<IconChecks size={20} />} onClick={() => (setInvDay(invoiceDayFor(b.order)), setFinish(true))}>
        {t('job.done')} · {formatAed(sum.gross)}
      </Button>
    );
  else if (reissue)
    // Gone on credit, the invoice changed: the new one — the debt is then what it leaves.
    bar = (
      <Button fullWidth color="green" loading={busy} disabled={unpriced.length > 0 || !lines.length} leftSection={<IconChecks size={20} />} onClick={() => (setInvDay(invoiceDayFor(b.order)), setFinish(true))}>
        {t('job.done')} · {formatAed(sum.gross)}
      </Button>
    );
  else if (phase === 'pay' && openDebt)
    // A debt signed before the car left (an older job): it can go with it now.
    bar = (
      <Group gap={10} wrap="nowrap">
        <Button variant="default" leftSection={<IconCash size={18} />} onClick={() => setPay('payment')} style={{ flex: '0 0 auto' }}>
          {t('job.pay')}
        </Button>
        <Button color="teal" loading={busy} leftSection={<IconKey size={20} />} onClick={() => run(async () => (await leaveOnDebt(oid), haptic('success')), 'debt.saved')} style={{ flex: 1 }}>
          {t('debt.give')}
        </Button>
      </Group>
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
  else if (canReopen(b.order) && !lockedMonth)
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
  // The picked parts (v0.29): one supplier for them, where they stand — all at once.
  const pickedParts = pickedLines.filter((i) => i.kind === 'part' && !i.customerSupplied);
  // The picked drafts (v0.88): not confirmed yet — or, all of them so, confirmed.
  const pickedDrafts = pickedLines.filter((i) => i.approvalState === 'draft');
  const allUnconfirmed = pickedDrafts.length > 0 && pickedDrafts.every(isUnconfirmed);
  const markPicked = () =>
    run(async () => {
      await setUnconfirmed(pickedDrafts.map((i) => i.id), !allUnconfirmed);
      setPicked(null);
      haptic(allUnconfirmed ? 'success' : 'light');
    });
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
        {pickedParts.length > 0 && (
          <ActionIcon size={44} radius="xl" variant="default" aria-label={t('job.setParts')} onClick={() => setBatch(pickedParts)} style={{ flex: '0 0 auto' }}>
            <IconTruckDelivery size={21} stroke={1.9} />
          </ActionIcon>
        )}
        {pickedDrafts.length > 0 && (
          <ActionIcon
            size={44}
            radius="xl"
            variant="default"
            aria-label={allUnconfirmed ? t('job.confirm') : t('job.unconfirm')}
            onClick={() => void markPicked()}
            style={{ flex: '0 0 auto' }}
            data-pick-unconfirm={allUnconfirmed ? 'confirm' : 'unconfirm'}
          >
            {allUnconfirmed ? <IconCheck size={21} stroke={2} color="var(--mantine-color-green-7)" /> : <IconHelpCircle size={21} stroke={1.9} color="var(--mantine-color-yellow-7)" />}
          </ActionIcon>
        )}
        <Button
          color="red"
          loading={busy}
          disabled={!pickedLines.length}
          leftSection={<IconTrash size={18} />}
          onClick={() => (pickedLines.some((i) => i.approvalState !== 'draft') ? setConfirmPicked(true) : void removePicked())}
          aria-label={t('job.removeN', { n: pickedLines.length })}
          style={{ flex: 1 }}
        >
          {/* Beside the parts' two buttons (v0.53) the words did not fit a phone: its symbol and the number. */}
          {(pickedParts.length > 0 || pickedDrafts.length > 0) && phone ? pickedLines.length : t('job.removeN', { n: pickedLines.length })}
        </Button>
      </Group>
    );

  // The car and its customer: on a phone on top of the job, on a PC (v0.41) in the column beside its lines.
  const carCard = (
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
            {/* The garage's WhatsApp linked: the chat only from «＋» (v0.90, #71); without it — WhatsApp itself, as before. */}
            {!waLinked && (
              <ActionIcon component="a" href={whatsappUrl(c.whatsapp || c.phone, '')} target="_blank" rel="noopener" variant="light" color="green" size={40} radius="xl" aria-label="WhatsApp">
                <IconBrandWhatsapp size={21} />
              </ActionIcon>
            )}
            <ActionIcon component="a" href={`tel:${c.phone}`} variant="light" color="green" size={40} radius="xl" aria-label={t('customer.call')}>
              <IconPhone size={20} />
            </ActionIcon>
          </Group>
        )}
      </Group>
      <DriverLine driver={b.order.driver} company={c.type === 'company'} open={open} onOpen={() => setDriverOpen(true)} />
      {(open || !!b.order.complaint) && (
        <UnstyledButton className="job-line job-complaint" mt="sm" onClick={open ? () => setComplaintOpen(true) : undefined} aria-label={t('job.complaint')}>
          <IconMessage2 size={18} stroke={1.8} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
          <Text size="sm" c={b.order.complaint ? undefined : 'dimmed'} lineClamp={3}>
            {b.order.complaint || t('job.complaint')}
          </Text>
        </UnstyledButton>
      )}
      <PrevVisit order={b.order} settings={b.settings} lang={docLang} />
      {/* Audit 27/11: what the customer said no to on an earlier visit — a tap puts it on this job. */}
      {addable && <DeclinedBefore orderId={b.order.id} order={b.order} onJob={b.items.flatMap((i) => [i.titleEn, i.titleRu].filter((x): x is string => !!x))} lang={docLang} />}
      <ObdLine orderId={b.order.id} scans={b.order.obdScans ?? []} open={open} />
      {/* One flow of chips: when the car was promised, the car's own papers (VIN, Mulkiya, Job card, the mileage),
          who does the job (one or several — each chip on or off by itself), its suppliers. On a phone two rows that
          scroll sideways (v0.71, «2 ряда — поместить капсулы»; v0.57: three rows pushed the job's lines below the screen) — the
          papers first, they are taken as the car comes in; on a PC, beside the lines, they wrap. */}
      <div className={phone ? 'chip-row job-foot' : 'chip-row wrap job-foot'} aria-label={t('order.mechanic')}>
        <JobDayChip job={b} fixed={!!lockedMonth} />
        {open && phase !== 'booked' && <DueChip order={b.order} lang={lang} />}
        <VinTile vehicleId={b.vehicle.id} vin={b.vehicle.vin} year={b.vehicle.year} hideEmpty={!open} />
        <MulkiyaTile vehicleId={b.vehicle.id} hideEmpty={!open} />
        <JobCardChip orderId={oid} open={open} />
        {/* The car's mileage on this visit (v0.44): the odometer's photo, read on the phone. */}
        <OdometerChip order={b.order} open={open} />
        {open &&
          mechanics.map((m) => (
            <MechanicChip key={m.id} name={m.name} on={crew.includes(m.id)} onToggle={() => void run(() => toggleMechanic(oid, m.id))} onTask={() => setMechanicOpen(true)} />
          ))}
      </div>
    </Box>
  );

  // The tabs and what they show: the job (its lines, money, next step) or its notes.
  const panel = (
    <>
    <div ref={tabsMark} aria-hidden />
    <div ref={tabsBar} className="job-tabs">
      <ScrollTabs
        value={tab}
        onChange={pickTab}
        mb="0"
        segmented
        items={[
          { value: 'main', label: t('job.tab.main') },
          { value: 'notes', label: t('job.tab.notes'), count: b.notes.length || undefined },
        ]}
      />
    </div>
    <div key={tab} ref={sw.panel} className="job-panel">
    {tab === 'notes' ? (
      <NotesChat orderId={oid} notes={b.notes} editable={open} />
    ) : (
    <>
    {phone && carCard}

    {inv ? (
      <>
        <List>
          <ListRow
            left={<IconFileInvoice size={22} stroke={1.7} color="var(--mantine-color-green-6)" aria-hidden />}
            title={inv.number}
            subtitle={billTo?.name || (billTo?.phone ? formatPhone(billTo.phone) : undefined)}
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
          {/* Audit 27/11: the customer's transfer screenshot in WhatsApp — a payment proposal, recorded by a tap. */}
          {due > 0 && (phase === 'pay' || phase === 'out' || phase === 'debt') && <PaymentShotRow orderId={oid} phone={c?.whatsapp || c?.phone} dueFils={due} />}
          {/* Audit 27/11: the invoice told to the customer or not — said here, sent by hand (nothing goes by itself). */}
          {(phase === 'pay' || phase === 'out' || phase === 'debt') && (
            <ListRow
              left={<IconFileInvoice size={20} stroke={1.9} color={`var(--mantine-color-${toldAt ? 'green' : 'violet'}-6)`} aria-hidden />}
              title={
                <Text span inherit c={toldAt ? 'green.7' : 'dimmed'} data-ready-state={toldAt ? 'told' : 'untold'}>
                  {toldAt ? t('job.readyTold', { time: shortDuration(hoursBetween(toldAt), lang) }) : t('job.readyUntold')}
                </Text>
              }
              right={
                toldAt ? undefined : (
                  <Button variant="light" color="violet" size="compact-md" onClick={sendInvoice}>
                    {t('job.quoteSend')}
                  </Button>
                )
              }
            />
          )}
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
          {invOff.length > 0 && discountRow(undefined, invOff[0].description, invOff.reduce((a, l) => a + l.gross, 0), amendable && due > 0 ? () => setDiscountOpen(true) : undefined)}
        </List>
        {amendable && (
          // Something forgotten or to change after the invoice: the same tiles, the invoice is redone. "%" — a
          // discount on the invoice out (a credit note and a new invoice at once), while money is due.
          <AddBar onAdd={(kind) => setAmend({ then: () => setQuick(kind) })}>
            {due > 0 && <AddExtra icon={IconDiscount} label={t('discount.title')} word={t('discount.title')} onClick={() => setDiscountOpen(true)} />}
            <AddExtra icon={IconPencil} label={t('job.amend')} word={t('job.amend')} onClick={() => setAmend({})} />
          </AddBar>
        )}
        <Box mt="lg">
          <List>
            <ListRow title={<Text span fw={700} inherit>{t('job.total')}</Text>} right={<Text fz={24} lh={1.1}><Money fils={inv.totalFils} display roll /></Text>} />
            {paid > 0 && <ListRow title={<Text span c="dimmed" inherit>{t('qi.paid')}</Text>} right={<Money fils={paid} c="green.7" />} />}
            {due > 0 && paid > 0 && !openDebt && <ListRow title={<Text span c="dimmed" inherit>{t('qi.due')}</Text>} right={<Money fils={due} c="red.7" />} />}
            {lockRow}
            {debtRow}
            {waivedRow}
            {profitRow}
          </List>
        </Box>
      </>
    ) : (
      <>
        {(lines.length > 0 || refusedLines.length > 0) && (
          <List animate={!picking}>
            {/* A long job comes in two steps (v0.56): its first lines with the screen, the rest a frame later. */}
            {/* Audit 27/11: the customer's WhatsApp answer to the quote, a proposal — one tap records it; first, above the lines, where it is seen. */}
            {phase === 'wait' && <CustomerAnswerRow orderId={oid} phone={c?.whatsapp || c?.phone} />}
            {/* v0.98: a request's autopilot — its one next step (ask the suppliers, the quote ready). */}
            {(phase === 'booked' || phase === 'look' || phase === 'price') && b.order.fromChat && <AutopilotRow b={b} onSend={toClient} />}
            <FirstRows rows={lines.map(row)} />
            {discounts.length > 0 && discountRow(discounts[0], itemTitle(discounts[0], docLang), discounts.reduce((a, i) => a + itemAmounts(i).gross, 0), editable ? () => setDiscountOpen(true) : undefined)}
            {refusedLines.map(row)}
            {/* The quote's state (v0.81, the user's brief: «убрать автоматические уведомления «Нужно отправить цену».
                Внутри заказа показать состояние отправки сметы и дать отправить её вручную»): not sent — said here, sent by
                hand; sent — since when, and a reminder to the customer by hand. */}
            {phase === 'price' && editable && (
              <ListRow
                left={<IconSend size={20} stroke={1.9} color="var(--mantine-color-grape-6)" aria-hidden />}
                title={
                  <Text span inherit c="dimmed" data-quote-state="unsent">
                    {b.versions.length ? t('job.quoteNewUnsent') : t('job.quoteUnsent')}
                  </Text>
                }
                right={
                  <Button variant="light" color="grape" size="compact-md" disabled={unpriced.length > 0} onClick={toClient}>
                    {t('job.quoteSend')}
                  </Button>
                }
              />
            )}
            {sentAt && (
              <ListRow
                left={<IconHourglassHigh size={20} stroke={1.9} color="var(--mantine-color-orange-6)" aria-hidden />}
                title={
                  <Text span inherit c="orange.7" data-quote-state="sent">
                    {t('job.quoteSentAgo', { time: shortDuration(hoursBetween(sentAt), lang) })}
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
          // Under the lines: work, a part, a service (done by others, the garage pays) — then the discount and the copy.
          <AddBar onAdd={openQuick} flush={!lines.length}>
            {lines.length > 0 && <AddExtra icon={IconDiscount} label={t('discount.title')} word={t('discount.title')} onClick={() => setDiscountOpen(true)} />}
            {/* v0.82 (#22, in «Копия»'s place — the copy is in its sheet): the parts to the suppliers that fit, by WhatsApp. */}
            {parts.length > 0 && <AddExtra icon={IconTruck} label={t('ask.title')} word={t('ask.title')} onClick={() => setAskOpen(true)} />}
            {/* Audit 27/11: the parts the suppliers offered — ordered in one tap («Заказать»). */}
            {parts.some(buyable) && <AddExtra icon={IconShoppingCart} label={t('buy.title')} word={t('buy.title')} onClick={() => setBuyOpen(true)} />}
            {parts.length > 0 && <AddExtra icon={IconUserCheck} label={t('job.more.owner')} word={t('job.more.owner')} onClick={() => setOwnerOpen(true)} />}
            {/* v0.90 (#72): the quote's options — the original and the copy, with a part and without it. */}
            {lines.length > 0 && !inv && <AddExtra icon={IconStack2} label={t('qo.title')} word={t('qo.tile')} onClick={() => setOptionsOpen(true)} />}
          </AddBar>
        )}
        {editable && phase === 'booked' && lines.length > 0 && (
          // A booked car's quote (its lines brought in from a PDF): its discount too — "%" is the only way to one. Its
          // options (v0.90): a request from WhatsApp comes with them (original or copy) — the prices go before the car.
          <div className="add-row">
            <AddExtra icon={IconDiscount} label={t('discount.title')} word={t('discount.title')} onClick={() => setDiscountOpen(true)} />
            {!inv && <AddExtra icon={IconStack2} label={t('qo.title')} word={t('qo.tile')} onClick={() => setOptionsOpen(true)} />}
          </div>
        )}
        {(phase === 'look' || phase === 'price') && editable && quick.length > 0 && (
          // Building the quote: the usual jobs for such a complaint, one tap each (name, last price) — under
          // the lines, where the work is added.
          <div className="chip-row" style={{ marginTop: 12 }} aria-label={t('qi.frequent')}>
            {quick.map(([name, s]) => (
              <button key={name} type="button" className="chip" onClick={() => quickAdd(s)}>
                {name}
                <span className="chip-note">
                  {formatAed(s.gross ?? s.price, lang, false)}
                  <PriceFromMark from={s.from} />
                </span>
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
              {reissue && paid > 0 && <ListRow title={<Text span c="dimmed" inherit>{t('qi.paid')}</Text>} right={<Money fils={paid} c="green.7" />} />}
              {reissue && debtRow}
              {waivedRow}
              {profitRow}
            </List>
          </Box>
        )}
      </>
    )}

    {(phase === 'pay' || phase === 'out') && <HandoverChecks order={b.order} />}

    {bar && (
      <StickyBar>
        {/* The button of the new step settles in on a spring. */}
        <div key={picking ? 'pick' : phase} className="bar-swap">
          {bar}
        </div>
      </StickyBar>
    )}
    </>
    )}
    </div>
    </>
  );

  return (
    <>
      <PageHeader
        back="/"
        // The day the car came (v0.88, the owner: «первоначальная дата должна сохраниться… какой день физически машина
        // приезжала»): always in sight — work continued later, the job closed and opened again, it stays the first one.
        eyebrow={phase === 'booked' ? `№${b.order.number}` : `№${b.order.number} · ${formatDate(b.order.arrivedAt ?? b.order.createdAt)}`}
        // The VIN alone, one tap (v0.70) — small, under the car's name (v0.71, «переместить наверх под названием авто мелко»).
        subtitle={
          vin || b.vehicle.carCheck ? (
            <>
              {vin && (
                <button type="button" className="vin-line" onClick={() => void copyVin()} aria-label={t('job.copyVin')} data-vin-copy>
                  <span className="vin-line-text">VIN {vin}</span>
                  <IconCopy size={14} stroke={2} aria-hidden />
                </button>
              )}
              {/* The photo and the VIN say different cars (v0.89): the person chooses. */}
              <CarCheckPill vehicle={b.vehicle} />
            </>
          ) : undefined
        }
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
          <>
            {/* Shown to the customer (v0.67): the lock — only the work and its prices on screen, nothing opens. */}
            <ActionIcon
              variant="default"
              size={40}
              radius={phone ? 'xl' : 'md'}
              aria-label={t('client.lock')}
              title={t('client.lock')}
              data-client-lock-btn
              onClick={() => {
                haptic('light');
                lockForClient(b.order.id);
              }}
            >
              <IconLock size={20} />
            </ActionIcon>
            {/* The job to the garage's group: the car's photo, the car, the customer's name, the lines. */}
            <ShareJobButton b={b} />
            {/* A PC (v0.80): a new job beside this one, both on one screen. */}
            {!phone && !pane && !twinOpen && (
              <ActionIcon variant="default" size={40} radius="md" aria-label={t('desk.twin')} onClick={openBeside} data-twin-btn>
                <IconLayoutSidebarRightExpand size={20} />
              </ActionIcon>
            )}
            {/* On a wide PC its tiles are beside the job already: the button goes (desk.css). */}
            <ActionIcon variant="default" size={40} radius="md" aria-label={t('common.more')} onClick={() => setMore(true)} className={phone ? undefined : 'job-more-btn'}>
              <IconDots size={20} />
            </ActionIcon>
          </>
        }
      />

      {phone ? (
        // On a phone: the tabs, then the car and the lines under each other (the job keeps a readable width).
        <div className="job-body" ref={bodyRef}>
          {panel}
        </div>
      ) : (
        // On a PC (v0.41): the lines — or the notes — in a wide column; the car and the job's actions beside it.
        <div className="job-body job-desk" ref={bodyRef}>
          <aside className="job-desk-aside">
            {carCard}
            <section className="job-desk-actions" aria-label={t('desk.actions')}>
              <ActionTiles tiles={tiles} />
            </section>
          </aside>
          <div className="job-desk-main">{panel}</div>
        </div>
      )}

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
      <LazySheet opened={!!quickKind} warm={editable}>
        {(o) => <QuickAddSheet b={b} kind={quickKind ?? lastQuick.current} opened={o} onClose={() => setQuick(null)} suggestions={suggestions} />}
      </LazySheet>
      <LazySheet opened={askOpen}>{(o) => <SupplierAskSheet b={b} opened={o} onClose={() => setAskOpen(false)} />}</LazySheet>
      <LazySheet opened={buyOpen}>{(o) => <BuySheet b={b} opened={o} onClose={() => setBuyOpen(false)} />}</LazySheet>
      <LazySheet opened={!!priceFor}>
        {(o) => <PriceSheet b={b} item={lastPrice.current} opened={o} onClose={() => setPriceFor(null)} service={!!lastPrice.current && sheetKind(lastPrice.current) === 'service'} />}
      </LazySheet>
      <LineActions b={b} item={act} onClose={() => setAct(null)} onEdit={(i) => setSheet({ kind: sheetKind(i), item: i })} />
      <LazySheet opened={more}>
        {(o) => (
          <MoreSheet opened={o} onClose={() => setMore(false)} tiles={tiles} />
        )}
      </LazySheet>
      <LazySheet opened={binOpen}>{(o) => <BinSheet b={b} opened={o} onClose={() => setBinOpen(false)} canRestore={binRestore} />}</LazySheet>
      <DueSheet order={b.order} lang={lang} opened={dueOpen} onClose={() => setDueOpen(false)} />
      <LazySheet opened={remindOpen}>{(o) => <ReminderSheet opened={o} onClose={() => setRemindOpen(false)} orderId={oid} />}</LazySheet>
      <JobDaySheet job={b} opened={dayOpen} onClose={() => setDayOpen(false)} />
      <DriverSheet order={b.order} opened={driverOpen} onClose={() => setDriverOpen(false)} />
      <LazySheet opened={mechanicOpen}>
        {(o) => (
          <MechanicSheet b={b} opened={o} onClose={() => setMechanicOpen(false)} />
        )}
      </LazySheet>
      {obd.input}
      <SheetFor value={batch}>
        {(parts, o) => (
          <PartsBatchSheet
            parts={parts}
            vehicle={b.vehicle}
            opened={o}
            onClose={() => setBatch(null)}
            onDone={() => {
              setBatch(null);
              setPicked(null);
            }}
          />
        )}
      </SheetFor>
      <LazySheet opened={optionsOpen}>
        {(o) => (
          <QuoteOptionsSheet
            b={b}
            opened={o}
            onClose={() => setOptionsOpen(false)}
            onSend={(r) => {
              setOptionsOpen(false);
              setSend(r);
            }}
          />
        )}
      </LazySheet>
      <LazySheet opened={ownerOpen}>
        {(o) => <OwnerCheckSheet b={b} expenses={expenses ?? []} partsCategoryId={partsCat || undefined} docLang={docLang} opened={o} onClose={() => setOwnerOpen(false)} />}
      </LazySheet>
      <LazySheet opened={complaintOpen}>
        {(o) => (
          <ComplaintSheet b={b} opened={o} onClose={() => setComplaintOpen(false)} />
        )}
      </LazySheet>
      <LazySheet opened={qtyCheck}>{(o) => <QtyCheckSheet items={live} lang={docLang} opened={o} onClose={() => setQtyCheck(false)} onGo={() => void sendNow()} goLabel={t('job.toClient')} />}</LazySheet>
      <SheetFor value={qtyLine}>{(i, o) => <QtyCheckSheet items={live.filter((x) => x.id === i.id)} lang={docLang} opened={o} onClose={() => setQtyLine(null)} onGo={() => undefined} goLabel={t('common.done')} />}</SheetFor>
      <ConfirmModal
        opened={finish}
        onClose={() => setFinish(false)}
        title={t('invoice.confirmTitle')}
        confirmLabel={t('invoice.issue')}
        onConfirm={() =>
          run(async () => {
            await quickInvoice(oid, { day: invDay || undefined });
            haptic('success');
            scrollToTop();
            // (Audit 27/11: no sheet pops up here — the customer is often at the counter to pay; «Клиенту не сказано ·
            // Отправить» under the invoice says it, one tap.)
            return true;
          })
        }
      >
        {/* The parts short of their names (v0.70): the last look before the invoice. */}
        <QtyCheckList items={live} lang={docLang} />
        {/* Not confirmed (v0.88): they stay on the job, not on the invoice. */}
        {unconfirmed.length > 0 && (
          <Text size="sm" c="yellow.8" fw={600} mb="xs" data-unconfirmed-out>
            {t('job.unconfirmedOut', { count: unconfirmed.length })}
          </Text>
        )}
        <Text size="sm" mt={live.some((i) => qtyShort(i)) ? 'sm' : undefined}>
          {t('invoice.confirmText')}
        </Text>
        <Group mt="sm" justify="space-between" wrap="nowrap" gap="sm">
          <Text fw={700} fz={20}>
            <Money fils={sum.gross} display />
          </Text>
          {/* Its day (v0.53): today, or an earlier one — not before the job's own. */}
          {invDay && <DayPill value={invDay} min={jobDay(b.order)} onChange={setInvDay} label={t('invoice.day')} />}
        </Group>
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
      <SheetFor value={pay}>{(kind, o) => <PaymentModal b={b} opened={o} onClose={() => setPay(null)} kind={kind} />}</SheetFor>
      <LazySheet opened={discountOpen}>{(o) => <DiscountSheet b={b} opened={o} onClose={() => setDiscountOpen(false)} />}</LazySheet>
      <LazySheet opened={customerOpen}>{(o) => <CustomerModal opened={o} onClose={() => setCustomerOpen(false)} customer={c} orderId={oid} />}</LazySheet>
      <SendDialog customer={c} request={sv.send} onClose={() => sv.setSend(null)} onSent={() => void syncStage(oid)} />
      <SendDialog customer={c} request={send} onClose={() => setSend(null)} />
    </>
  );
}
