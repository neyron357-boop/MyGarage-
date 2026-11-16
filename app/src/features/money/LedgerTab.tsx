import { ActionIcon, Box, Button, Group, Modal, Stack, Text, TextInput, ThemeIcon, UnstyledButton } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconArrowDownLeft, IconArrowUpRight, IconBook2, IconCash, IconCheck, IconCreditCard, IconLock, IconPaperclip, IconPencil, IconTrash, IconUserDollar } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { dayHeading, formatDate, monthKey, monthRange } from '../../domain/dates';
import { periodTotals, type LedgerEntry, type Purse } from '../../domain/ledger';
import { formatAed } from '../../domain/money';
import type { ExpenseCategory } from '../../domain/types';
import { companyDebtOf, debtPaymentParts } from '../../services/debts';
import { removeEntry, restoreEntry, updateEntry, type EntryPatch } from '../../services/entries';
import { loadLedger, setOpeningBalances, updateExpense, updateIncome, type Links } from '../../services/ledger';
import { proofIndex } from '../../services/proofs';
import { EmptyState, List, ListRow, Money, MoneyInput, PageSkeleton, PlateLine, PlateText, SearchField, undoToast } from '../../ui/components';
import { DayPill, MonthField } from '../../ui/DateFields';
import { haptic } from '../../ui/haptics';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { CreditSheet } from './Debts';
import { EntrySheet, IncomeChips, LinkPicker, PursePicker, useIncomeCategories, useIncomeLabel, wayLabel, type EntryPreset } from './MoneyEntry';
import { Proofs } from './Proofs';
import { SheetFor } from '../../ui/lazy';

type KindFilter = 'all' | 'in' | 'out';

/** Label of an entry's category, whatever its source. */
export function useCategoryLabel(cats: ExpenseCategory[] | undefined) {
  const { t } = useTranslation();
  const lang = useLang();
  const income = useIncomeLabel(useIncomeCategories());
  return (e: LedgerEntry) => {
    if (e.source === 'payment') return t(e.category === 'refund' ? 'cashReason.refund' : e.category === 'prepayment' ? 'cashReason.prepayment' : 'ledger.cat.order');
    if (e.source === 'income') return income(e.category);
    if (e.source === 'credit') return t('cashReason.credit_payment');
    if (e.source === 'closing') return t('ledger.cat.closing');
    if (e.source === 'movement') return t(`cashReason.${e.category}`);
    const c = cats?.find((x) => x.id === e.category);
    return c ? (lang === 'ru' ? c.nameRu : c.nameEn) : t('ledger.out');
  };
}

function OpeningSheet({ opened, onClose, cash, card, cashLocked }: { opened: boolean; onClose: () => void; cash: number; card: number; cashLocked: boolean }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [c, setC] = useState<number | undefined>(cash);
  return (
    <Modal opened={opened} onClose={onClose} title={t('ledger.opening')}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t('ledger.openingHint')}
        </Text>
        {cashLocked ? (
          <Box className="amount-cell">
            <Text size="sm" fw={500}>
              {t('ledger.cashStart')}
            </Text>
            <Text fz={20} mt={4}>
              <Money fils={cash} display />
            </Text>
          </Box>
        ) : (
          <MoneyInput label={t('ledger.cashStart')} value={c} onChange={setC} />
        )}
        {cashLocked && (
          <Text size="xs" c="dimmed">
            {t('ledger.cashStartLocked')}
          </Text>
        )}
        <Button loading={busy} onClick={() => run(async () => { await setOpeningBalances(cashLocked ? cash : c ?? 0, card); onClose(); }, 'common.saved')}>
          {t('common.save')}
        </Button>
      </Stack>
    </Modal>
  );
}

/** A debt payment: the jobs it went to, with what each got, and what no debt took. */
function DebtParts({ entry }: { entry: LedgerEntry }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const data = useLiveQuery(async () => {
    const parts = await debtPaymentParts(entry.id);
    const orders = await db.orders.bulkGet(parts.map((p) => p.orderId));
    const vehicles = await db.vehicles.bulkGet(orders.map((o) => o?.vehicleId ?? ''));
    const customer = entry.customerId ? await db.customers.get(entry.customerId) : undefined;
    return { parts: parts.map((p, i) => ({ ...p, order: orders[i], vehicle: vehicles[i] })), customer };
  }, [entry.id, entry.customerId]);
  if (!data) return null;
  const rest = entry.amountFils - data.parts.reduce((s, p) => s + p.amountFils, 0);
  const who = data.customer ? (data.customer.type === 'company' && data.customer.companyName ? data.customer.companyName : data.customer.name) || t('customer.noName') : '';
  return (
    <Box>
      <div className="group-title">{who ? `${t('debt.wentTo')} · ${who}` : t('debt.wentTo')}</div>
      <List>
        {data.parts.map((p) => (
          <ListRow
            key={p.orderId}
            chevron
            onClick={() => navigate(`/orders/${p.orderId}`)}
            title={p.order ? `№${p.order.number}` : ''}
            subtitle={p.vehicle && <PlateLine plate={p.vehicle.plate}>{[p.vehicle.make, p.vehicle.model].filter(Boolean).join(' ')}</PlateLine>}
            right={<Money fils={p.amountFils} size="sm" />}
          />
        ))}
        {rest > 0 && <ListRow title={t('debt.rest')} right={<Money fils={rest} size="sm" c="dimmed" />} />}
      </List>
    </Box>
  );
}

/** An expense on credit: what is still owed on it, and the way to pay it. */
function CreditLeft({ expenseId }: { expenseId: string }) {
  const { t } = useTranslation();
  const d = useLiveQuery(async () => (await companyDebtOf(expenseId)) ?? null, [expenseId]);
  const [open, setOpen] = useState(false);
  if (!d) return null;
  return (
    <>
      <Group justify="space-between" wrap="nowrap" className="surface-soft" p="sm">
        <Stack gap={0}>
          <Text size="sm" c="dimmed">
            {t('debt.left')}
          </Text>
          <Money fils={d.leftFils} c={d.leftFils > 0 ? 'orange.7' : 'green.7'} />
        </Stack>
        {d.leftFils > 0 && (
          <Button variant="light" color="orange" onClick={() => setOpen(true)}>
            {t('debt.payCredit')}
          </Button>
        )}
      </Group>
      <SheetFor value={open && expenseId}>{(id, o) => <CreditSheet expenseId={id} opened={o} onClose={() => setOpen(false)} />}</SheetFor>
    </>
  );
}

/** A new sum for an operation: typed over the old one, saved with the check (or Enter); the same sum — nothing. */
function AmountEdit({ fils, onSave, onCancel }: { fils: number; onSave: (fils: number) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState<number | undefined>(fils);
  const save = () => (value && value !== fils ? onSave(value) : onCancel());
  return (
    <Group gap="sm" wrap="nowrap" className="rise-enter" style={{ flex: 1 }} onKeyDown={(e) => e.key === 'Enter' && save()}>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <MoneyInput label={undefined} ariaLabel={t('ledger.changeAmount')} value={value} onChange={setValue} autoFocus />
      </Box>
      <ActionIcon size={44} radius="xl" variant="filled" disabled={!value} aria-label={t('common.save')} onClick={save}>
        <IconCheck size={22} />
      </ActionIcon>
    </Group>
  );
}

/**
 * An operation opened from the book, the cash box, the expenses or a debt — any of them (v0.23, the user's call): its sum
 * (a tap — a new one), its day (a tap — the calendar), its way (cash, card, transfer; an expense — on credit too), what
 * it was for, a note and proofs; «Удалить» takes it whole, with «Отменить» right after (services/entries.ts). A cancelled
 * operation (a pair the old «Отменить запись» left in the cash box) and a day closing are only deleted; a debt payment
 * keeps its sum and customer (it was spread over the jobs) — its day and way change. Opened for a value — `SheetFor`.
 */
export function EntryDetails({ entry, label, onClose, cats, opened = true }: { entry: LedgerEntry; label: string; onClose: () => void; cats?: ExpenseCategory[]; opened?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  // The note saves on its own (on leaving the field): «Удалить» tapped right after it is not held up by that save.
  const noteSave = useAction();
  const [pricing, setPricing] = useState(false);
  const ref = { source: entry.source, id: entry.id };
  const debt = entry.source === 'income' && entry.category === 'debt';
  const live = !entry.cancelled && entry.source !== 'closing';
  // What it was for (category, job, car, customer) — money in or out of its own; a debt payment keeps its customer.
  const relinkable = live && ((entry.source === 'income' && !debt) || entry.source === 'expense');
  const amountable = live && !debt;
  const wayable = live && entry.source !== 'movement';
  const noteable = live && entry.source !== 'credit';
  // An expense shows its vendor with the note; only the note itself is edited here.
  const typed = (entry.source === 'expense' ? entry.expenseNote : entry.note) ?? '';
  const [note, setNote] = useState(typed);
  const signedFils = entry.kind === 'in' ? entry.amountFils : -entry.amountFils;
  const change = (patch: EntryPatch) => run(() => updateEntry(ref, patch), 'common.saved');
  const relink = (l: Links) =>
    run(() => (entry.source === 'income' ? updateIncome(entry.id, { orderId: l.orderId, vehicleId: l.vehicleId, customerId: l.customerId }) : updateExpense(entry.id, { orderId: l.orderId, vehicleId: l.vehicleId, customerId: l.customerId })));
  const remove = () =>
    run(async () => {
      const removed = await removeEntry(ref);
      onClose();
      haptic('light');
      undoToast(t('ledger.removed'), t('common.undo'), () => void restoreEntry(removed));
    });
  return (
    <Modal opened={opened} onClose={onClose} title={entry.vendor ? `${label} · ${entry.vendor}` : label}>
      <Stack gap="md">
        <Group justify="space-between" align="center" wrap="nowrap" gap="sm" mih={44}>
          {pricing ? (
            <AmountEdit
              fils={entry.amountFils}
              onCancel={() => setPricing(false)}
              onSave={(amountFils) =>
                run(async () => {
                  await updateEntry(ref, { amountFils });
                  haptic('light');
                  setPricing(false);
                })
              }
            />
          ) : amountable ? (
            <UnstyledButton className="tap price-tap" aria-label={t('ledger.changeAmount')} onClick={() => setPricing(true)}>
              <Text span fz={28} lh={1.1} c={entry.kind === 'in' ? 'green.7' : undefined}>
                <Money fils={signedFils} display signed roll />
              </Text>
              <IconPencil size={18} stroke={1.8} color="var(--app-label-3)" aria-hidden />
            </UnstyledButton>
          ) : (
            <Text fz={28} lh={1.1} c={entry.kind === 'in' ? 'green.7' : undefined}>
              <Money fils={signedFils} display signed />
            </Text>
          )}
          {!pricing &&
            (live ? (
              <DayPill value={entry.date} onChange={(date) => change({ date })} />
            ) : (
              <Text size="sm" c="dimmed">
                {formatDate(entry.date)}
              </Text>
            ))}
        </Group>
        {wayable && (
          // A job's refund leaves the card account (no "it does not reduce the card" note under it): passed as money in.
          <PursePicker value={entry.method ?? 'cash'} onChange={(method) => method !== entry.method && change({ method })} kind={entry.source === 'payment' ? 'in' : entry.kind} credit={entry.source === 'expense'} />
        )}
        {entry.source === 'expense' && entry.method === 'credit' && <CreditLeft expenseId={entry.id} />}
        {debt && <DebtParts entry={entry} />}
        {entry.closing && (
          <Text size="sm">
            {t('ledger.closingText', { actual: formatAed(entry.closing.actualFils), diff: formatAed(entry.closing.diffFils) })}
          </Text>
        )}
        {relinkable && entry.source === 'income' && <IncomeChips value={entry.category} onChange={(category) => category !== entry.category && run(() => updateIncome(entry.id, { category }))} />}
        {relinkable && entry.source === 'expense' && (
          <div className="chip-row wrap">
            {(cats ?? []).filter((c) => c.active).map((c) => (
              <button key={c.id} type="button" className="chip" data-active={entry.category === c.id} onClick={() => run(() => updateExpense(entry.id, { categoryId: c.id }))}>
                {lang === 'ru' ? c.nameRu : c.nameEn}
              </button>
            ))}
          </div>
        )}
        {relinkable && <LinkPicker value={{ orderId: entry.orderId, vehicleId: entry.vehicleId, customerId: entry.customerId }} onChange={relink} />}
        {noteable ? (
          <TextInput label={t('ledger.note')} value={note} onChange={(e) => setNote(e.currentTarget.value)} onBlur={() => note !== typed && noteSave.run(() => updateEntry(ref, { note }))} />
        ) : (
          entry.note && <Text size="sm">{entry.note}</Text>
        )}
        <Proofs entry={entry} />
        <Group justify="space-between">
          {entry.orderId ? (
            <Button variant="light" onClick={() => navigate(`/orders/${entry.orderId}`)}>
              {t('order.open')}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="subtle" color="red" loading={busy} leftSection={<IconTrash size={18} />} onClick={() => void remove()}>
            {t('common.delete')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * The money book, as the garage kept it in its money sheet: the cash balance with its opening amount, in/out
 * of the month, and every entry — a cash one with the cash after it; card money is only operations (no balance).
 */
export function LedgerTab() {
  const { t } = useTranslation();
  const lang = useLang();
  // The month asked in the address (a money sheet just brought in lands there), else this month.
  const [params] = useSearchParams();
  const asked = params.get('month');
  const [month, setMonth] = useState(() => (asked && /^\d{4}-\d{2}$/.test(asked) ? asked : monthKey()));
  useEffect(() => {
    if (asked && /^\d{4}-\d{2}$/.test(asked)) setMonth(asked);
  }, [asked]);
  const [kind, setKind] = useState<KindFilter>('all');
  const [purse, setPurse] = useState<'all' | Purse>('all');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<EntryPreset | null>(null);
  const [opening, setOpening] = useState(false);
  const [opened, setOpen] = useState<Pick<LedgerEntry, 'id' | 'source'> | null>(null);
  const view = `${month}-${kind}-${purse}`;
  const firstView = useRef(view);
  const data = useScreenLiveQuery(async () => {
    const [book, cats, vehicles, customers, orders] = await Promise.all([loadLedger(), db.expenseCategories.toArray(), db.vehicles.toArray(), db.customers.toArray(), db.orders.toArray()]);
    const photos = await proofIndex(book.entries.map((e) => e.id));
    return { book, cats, photos, vehicles: new Map(vehicles.map((v) => [v.id, v])), customers: new Map(customers.map((c) => [c.id, c])), orders: new Map(orders.map((o) => [o.id, o])) };
  }, []);
  const label = useCategoryLabel(data?.cats);
  const [from, to] = monthRange(month);
  const rows = useMemo(() => {
    if (!data) return [];
    const query = q.trim().toLowerCase();
    return data.book.entries
      .filter((e) => e.date >= from && e.date <= to)
      .filter((e) => kind === 'all' || e.kind === kind)
      .filter((e) => purse === 'all' || e.purse === purse)
      .filter((e) => {
        if (!query) return true;
        const v = e.vehicleId ? data.vehicles.get(e.vehicleId) : undefined;
        const c = e.customerId ? data.customers.get(e.customerId) : undefined;
        const o = e.orderId ? data.orders.get(e.orderId) : undefined;
        return [label(e), e.note, v?.plateSearch, v?.make, v?.model, c?.name, c?.companyName, o ? `№${o.number}` : '', (e.amountFils / 100).toFixed(2)].some((s) => s?.toLowerCase().includes(query));
      })
      .reverse();
  }, [data, from, to, kind, purse, q, label]);
  if (!data) return <PageSkeleton />;
  const { book } = data;
  // The sheet follows the entry as it changes (category, links); a cancelled one is gone.
  const open = opened ? book.entries.find((e) => e.id === opened.id && e.source === opened.source) : undefined;
  const totals = periodTotals(book.entries, from, to);
  const days = new Map<string, LedgerEntry[]>();
  for (const r of rows) days.set(r.date, [...(days.get(r.date) ?? []), r]);

  return (
    <Stack gap="lg">
      <Stack gap="sm" maw={560}>
        {/* The month the figures and the list below are for. */}
        <MonthField value={month} onChange={setMonth} />
        {/* The cash, as a bank's card (v0.32, redrawn): its name and where it started (a pill — a tap on the card opens
            the opening balances), the balance large; under it the month in tiles, each named — cash, card, past the
            cash box (when the month has it) — money in over money out. The card keeps no balance — its money is only
            operations, in the list below (the user's call, v0.17). */}
        <div className="money-card" data-purse="cash">
          <UnstyledButton className="money-card-main tap amount-cell" onClick={() => setOpening(true)} aria-label={`${t('ledger.cashBalance')}: ${formatAed(book.cash, lang)} · ${t('ledger.opening')}`}>
            <div className="money-card-head">
              <span className="money-card-label">
                <IconCash size={18} stroke={2} aria-hidden />
                {t('ledger.cashBalance')}
              </span>
              <span className="money-card-start">
                {t('ledger.start')} {formatAed(book.cashStartFils, lang, false)}
                <IconPencil size={12} stroke={2.2} aria-hidden />
              </span>
            </div>
            <div className="money-card-balance">
              <Money fils={book.cash} display roll />
            </div>
          </UnstyledButton>
          <div className="money-card-month">
            {/* Money past the cash box (v0.27: paid with the owner's own, taken by the owner) — a tile of its own, when the month has it. */}
            {(['cash', 'card', 'outside'] as const).filter((p) => p !== 'outside' || totals.outside.inFils || totals.outside.outFils).map((p) => (
              <div
                key={p}
                className="money-card-purse"
                role="group"
                data-month-purse={p}
                data-in={totals[p].inFils}
                data-out={totals[p].outFils}
                aria-label={`${p === 'outside' ? t('ledger.outside') : t(`payment.method.${p}`)}: ${t('ledger.in')} ${formatAed(totals[p].inFils, lang)}, ${t('ledger.out')} ${formatAed(totals[p].outFils, lang)}`}
              >
                <span className="money-card-purse-name">
                  {p === 'cash' ? <IconCash size={14} stroke={2.2} aria-hidden /> : p === 'outside' ? <IconUserDollar size={14} stroke={2.2} aria-hidden /> : <IconCreditCard size={14} stroke={2.2} aria-hidden />}
                  {p === 'outside' ? t('ledger.outside') : t(`payment.method.${p}`)}
                </span>
                <span className="money-card-in" data-zero={totals[p].inFils === 0 || undefined}>
                  <Money fils={totals[p].inFils} signed roll />
                </span>
                {/* 0 − x, not −x: a minus zero would be written as «−0,00». */}
                <span className="money-card-out" data-zero={totals[p].outFils === 0 || undefined}>
                  <Money fils={0 - totals[p].outFils} roll />
                </span>
              </div>
            ))}
          </div>
        </div>

        <Group gap="sm" grow>
          <Button size="md" color="green" variant="light" leftSection={<IconArrowDownLeft size={20} />} onClick={() => setSheet({ kind: 'in' })}>
            {t('ledger.in')}
          </Button>
          <Button size="md" color="red" variant="light" leftSection={<IconArrowUpRight size={20} />} onClick={() => setSheet({ kind: 'out' })}>
            {t('ledger.out')}
          </Button>
        </Group>
      </Stack>

      {/* One row of filters — income or expenses, cash or card (a second tap takes one off) — and the search. */}
      <Stack gap="xs" maw={560}>
        <div className="chip-row bleed">
          {(['in', 'out'] as const).map((k) => (
            <button key={k} type="button" className="chip" data-active={kind === k} aria-pressed={kind === k} onClick={() => setKind(kind === k ? 'all' : k)} style={{ '--chip-on': `var(--mantine-color-${k === 'in' ? 'green' : 'red'}-filled)`, '--chip-ink': `var(--mantine-color-${k === 'in' ? 'green' : 'red'}-6)` } as React.CSSProperties}>
              {k === 'in' ? <IconArrowDownLeft size={17} stroke={2.2} aria-hidden /> : <IconArrowUpRight size={17} stroke={2.2} aria-hidden />}
              {k === 'in' ? t('ledger.ins') : t('ledger.outs')}
            </button>
          ))}
          {(['cash', 'card', 'outside'] as const).filter((p) => p !== 'outside' || purse === p || totals.outside.inFils || totals.outside.outFils).map((p) => (
            <button key={p} type="button" className="chip" data-active={purse === p} aria-pressed={purse === p} data-purse={p} onClick={() => setPurse(purse === p ? 'all' : p)}>
              {p === 'cash' ? <IconCash size={17} stroke={2} aria-hidden /> : p === 'outside' ? <IconUserDollar size={17} stroke={2} aria-hidden /> : <IconCreditCard size={17} stroke={2} aria-hidden />}
              {p === 'outside' ? t('ledger.outside') : t(`payment.method.${p}`)}
            </button>
          ))}
        </div>
        <SearchField placeholder={t('ledger.search')} value={q} onChange={setQ} />
      </Stack>

      {rows.length === 0 ? (
        <EmptyState icon={IconBook2} title={t('ledger.empty')}>
          {t('ledger.emptyHint')}
        </EmptyState>
      ) : (
        // Another month or filter: the list comes in with a soft fade (the old one does not just blink away);
        // not when the tab opens — the book is simply there.
        <Stack gap="lg" key={view} className={view === firstView.current ? undefined : 'fade-enter'}>
        {[...days.entries()].map(([day, list]) => {
          const net = list.reduce((s, e) => s + (e.kind === 'in' ? e.amountFils : -e.amountFils), 0);
          const head = dayHeading(day, lang);
          return (
            <Box key={day}>
              <Group justify="space-between" px={4} mb={6} wrap="nowrap">
                <Text size="sm" fw={650} c="dimmed" className="day-head">
                  {head.word ? t(`common.${head.word}`) : head.text}
                </Text>
                <Text size="xs" fw={600} c={net >= 0 ? 'green.7' : 'dimmed'} className="tnum">
                  {net >= 0 ? '+' : '−'}
                  {formatAed(Math.abs(net))}
                </Text>
              </Group>
              <List>
                {list.map((e) => {
                  const v = e.vehicleId ? data.vehicles.get(e.vehicleId) : undefined;
                  const c = e.customerId ? data.customers.get(e.customerId) : undefined;
                  const o = e.orderId ? data.orders.get(e.orderId) : undefined;
                  const who = c ? (c.type === 'company' && c.companyName ? c.companyName : c.name) : '';
                  const sub = [e.method ? wayLabel(t, e.method, e.kind) : '', o ? `№${o.number}` : '', who].filter(Boolean).join(' · ');
                  return (
                    <ListRow
                      key={`${e.source}-${e.id}`}
                      onClick={() => setOpen(e)}
                      left={
                        e.source === 'closing' ? (
                          <ThemeIcon variant="light" color="gray" size={38} radius="md">
                            <IconLock size={18} />
                          </ThemeIcon>
                        ) : (
                          <ThemeIcon variant="light" color={e.kind === 'in' ? 'green' : 'red'} size={38} radius="md">
                            {e.kind === 'in' ? <IconArrowDownLeft size={19} /> : <IconArrowUpRight size={19} />}
                          </ThemeIcon>
                        )
                      }
                      title={
                        // What it was, read first — as a bank app sets the merchant's name.
                        <Text span fz={16} fw={600} lineClamp={1}>
                          {label(e)}
                        </Text>
                      }
                      subtitle={
                        <Stack gap={3} mt={1}>
                          {/* The note is what the row is about (the "Notes" of the money sheet): shown in full. */}
                          {e.note && (
                            <Text span size="sm" c="var(--mantine-color-text)" lineClamp={2} lh={1.3}>
                              {e.note}
                            </Text>
                          )}
                          <Group gap={6} wrap="nowrap">
                            {data.photos.has(e.id) && <IconPaperclip size={14} color="var(--mantine-color-dimmed)" aria-label={t('ledger.proof')} style={{ flexShrink: 0 }} />}
                            {v && <PlateText plate={v.plate} size="xs" />}
                            <Text span size="xs" c="dimmed" lineClamp={1}>
                              {sub}
                            </Text>
                          </Group>
                        </Stack>
                      }
                      right={
                        <Stack gap={0} align="flex-end">
                          {/* As a bank shows it: money in green with a plus, money out in the text's colour with a minus. */}
                          <Money fils={e.kind === 'in' ? e.amountFils : -e.amountFils} c={e.kind === 'in' ? 'green.7' : undefined} fw={650} signed />
                          <Text size="10px" c="dimmed" className="tnum" style={{ whiteSpace: 'nowrap' }}>
                            {e.purse === 'cash' ? `${t('ledger.cashShort')} ${formatAed(e.cashAfter).replace(/^-/, '−')}` : e.purse === 'outside' ? t('ledger.outsideShort') : t('ledger.cardShort')}
                          </Text>
                        </Stack>
                      }
                    />
                  );
                })}
              </List>
            </Box>
          );
        })}
        </Stack>
      )}

      <EntrySheet opened={!!sheet} onClose={() => setSheet(null)} preset={sheet ?? undefined} />
      <SheetFor value={opening}>{(_, o) => <OpeningSheet opened={o} onClose={() => setOpening(false)} cash={book.cashStartFils} card={book.cardStartFils} cashLocked={book.cashStartLocked} />}</SheetFor>
      <SheetFor value={open}>{(e, o) => <EntryDetails opened={o} entry={e} label={label(e)} cats={data.cats} onClose={() => setOpen(null)} />}</SheetFor>
    </Stack>
  );
}
