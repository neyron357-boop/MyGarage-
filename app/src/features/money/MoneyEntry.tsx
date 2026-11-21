import { ActionIcon, Box, Button, Collapse, Group, Modal, SegmentedControl, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import {
  IconArrowDownLeft,
  IconArrowsSplit2,
  IconArrowUpRight,
  IconBuildingBank,
  IconCalendarDollar,
  IconCar,
  IconCash,
  IconChevronDown,
  IconClockDollar,
  IconCreditCard,
  IconPlus,
  IconReceipt2,
  IconSearch,
  IconTrash,
  IconUser,
  IconUserDollar,
  IconX,
} from '@tabler/icons-react';
import type { TFunction } from 'i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { dubaiDate, formatDate, monthLong } from '../../domain/dates';
import { byMonths, debtQueue, historyKey, monthKeys, monthsDue, spread, type DebtJob } from '../../domain/debts';
import { PART_WAYS, partRows, partsOf, partsRest } from '../../domain/expenseParts';
import { incomeCategoryName, KEPT_INCOME, renamedIn } from '../../domain/incomeCategories';
import type { OwedPick } from '../../domain/lenders';
import { formatAed } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import type { ExpenseMethod, IncomeCategory, Order } from '../../domain/types';
import { netFromGross, vatOf } from '../../domain/vat';
import { search, type SearchHit } from '../../services/customers';
import { loadDebtors } from '../../services/debts';
import { addIncomeCategory, loadIncomeCategories, removeIncomeCategory, restoreIncomeCategory, saveIncomeCategory } from '../../services/incomeCategories';
import { addIncome, moneyOf, type Links } from '../../services/ledger';
import { addExpense, categoryMonthSpent } from '../../services/money';
import { CaptureButton } from '../../ui/CaptureButton';
import { FormRow, Money, MoneyInput, PersonAvatar, PlateText, SelectCard, undoToast } from '../../ui/components';
import { DateField } from '../../ui/DateFields';
import { haptic } from '../../ui/haptics';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { useLongPress } from '../../ui/longPress';
import { OwedToField } from './OwedTo';

/** The garage's income categories, in their order — taken out ones too (their entries show their names). */
export function useIncomeCategories(): IncomeCategory[] | undefined {
  return useScreenLiveQuery(loadIncomeCategories, []);
}

/**
 * The name of an income's category as the garage calls it now (one taken out too); a debt paid — and a code with no
 * category (read before the categories are) — as the app says it.
 */
export function useIncomeLabel(list: IncomeCategory[] | undefined) {
  const { t } = useTranslation();
  const lang = useLang();
  return (code: string) => {
    const c = list?.find((x) => x.code === code);
    if (c) return incomeCategoryName(c, lang);
    return t(`income.category.${code}`, { defaultValue: list ? t('income.category.other') : '' });
  };
}

/**
 * Income categories as chips (v0.26): a tap picks one; a hold (on a PC a right click) — its sheet: the name, «Удалить»
 * with «Отменить» (taken out of the chips; entries that have it keep it); «＋» — a new one, picked at once. One taken
 * out shows only where it is the one picked (an entry that has it). «Оплата долга» (`debt`) — a way of its own, last.
 */
export function IncomeChips({ value, onChange, debt }: { value: string; onChange: (code: string) => void; debt?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const list = useIncomeCategories();
  const [edit, setEdit] = useState<IncomeCategory | 'new' | null>(null);
  const shown = (list ?? []).filter((c) => c.active || c.code === value);
  return (
    <>
      <div className="chip-row wrap">
        {shown.map((c) => (
          <IncomeChip key={c.id} c={c} label={incomeCategoryName(c, lang)} on={value === c.code} onTap={() => onChange(c.code)} onHold={() => setEdit(c)} />
        ))}
        {debt && (
          <button type="button" className="chip" data-active={value === 'debt'} data-income="debt" onClick={() => onChange('debt')}>
            {t('income.category.debt')}
          </button>
        )}
        <button type="button" className="chip" data-income-add aria-label={t('income.newCategory')} onClick={() => setEdit('new')}>
          <IconPlus size={16} stroke={2.2} style={{ verticalAlign: -3 }} />
        </button>
      </div>
      <SheetFor value={edit}>{(e, o) => <IncomeCategorySheet opened={o} category={e === 'new' ? undefined : e} onClose={() => setEdit(null)} onAdded={onChange} />}</SheetFor>
    </>
  );
}

function IncomeChip({ c, label, on, onTap, onHold }: { c: IncomeCategory; label: string; on: boolean; onTap: () => void; onHold: () => void }) {
  const press = useLongPress(onHold);
  return (
    <button type="button" className="chip" data-active={on} data-income={c.code} {...press.handlers} onClick={() => !press.consumeClick() && onTap()}>
      {label}
    </button>
  );
}

/** A new income category (picked at once), or one held: its name in this language, «Удалить» with «Отменить». */
function IncomeCategorySheet({ opened, category, onClose, onAdded }: { opened: boolean; category?: IncomeCategory; onClose: () => void; onAdded: (code: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const was = category ? incomeCategoryName(category, lang) : '';
  const [name, setName] = useState(was);
  const save = () =>
    name.trim() &&
    run(async () => {
      if (!category) onAdded((await addIncomeCategory(name)).code);
      else if (name.trim() !== was) await saveIncomeCategory(renamedIn(category, name, lang));
      haptic('light');
      onClose();
    });
  const remove = () =>
    category &&
    run(async () => {
      const removed = await removeIncomeCategory(category.id);
      onClose();
      haptic('light');
      undoToast(t('income.categoryRemoved', { name: was }), t('common.undo'), () => void restoreIncomeCategory(removed));
    });
  return (
    <Modal opened={opened} onClose={onClose} title={category ? t('expense.category') : t('income.newCategory')}>
      <Stack gap="md">
        <TextInput
          aria-label={t('settings.name')}
          placeholder={t('settings.name')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          data-autofocus={category ? undefined : true}
          autoComplete="off"
        />
        <Button size="lg" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
          {category ? t('common.save') : t('common.add')}
        </Button>
        {category && category.code !== KEPT_INCOME && (
          <Button variant="subtle" color="red" leftSection={<IconTrash size={18} />} loading={busy} onClick={() => void remove()}>
            {t('common.delete')}
          </Button>
        )}
      </Stack>
    </Modal>
  );
}

const OPEN_STAGES = new Set(['booked', 'intake', 'diagnostics', 'awaiting_approval', 'awaiting_parts', 'in_progress', 'quality_check', 'ready']);

/**
 * Cash / Card / Bank transfer — for an expense also "On credit" (nothing is paid yet, the garage owes it) — and, v0.27,
 * money past the cash box (`outside`): an expense paid with other money — «Не из кассы» (the owner's own; not a debt),
 * money in the owner took — «Владельцу».
 */
export const PURSE_ICON: Record<ExpenseMethod, typeof IconCash> = { cash: IconCash, card: IconCreditCard, transfer: IconBuildingBank, credit: IconClockDollar, outside: IconUserDollar };

/** How a way is said: money out past the cash box is «Не из кассы», money in — «Владельцу». */
export function wayLabel(t: TFunction, m: ExpenseMethod, kind: 'in' | 'out'): string {
  if (m === 'outside') return kind === 'out' ? t('ledger.outsideOut') : t('payment.method.outside');
  return t(`payment.method.${m}`);
}

/**
 * How money went: a way a chip. A new expense may be paid in parts (v0.58): «Частями» — and the chips pick several
 * ways (the sums under them — `SplitRows`); one way left — a way again.
 */
export function PursePicker({
  value,
  onChange,
  kind,
  credit,
  parts,
  onParts,
}: {
  value: ExpenseMethod;
  onChange: (m: ExpenseMethod) => void;
  kind: 'in' | 'out';
  /** "On credit" offered too (a new expense). */
  credit?: boolean;
  /** Paid in parts: the ways picked; undefined — one way. */
  parts?: ExpenseMethod[];
  /** «Частями» offered (a new expense): the ways it starts with, or undefined — one way again. */
  onParts?: (ways: ExpenseMethod[] | undefined) => void;
}) {
  const { t } = useTranslation();
  const ways: ExpenseMethod[] = credit ? [...PART_WAYS] : ['cash', 'card', 'transfer', 'outside'];
  const tap = (m: ExpenseMethod) => {
    if (!parts || !onParts) return onChange(m);
    if (!parts.includes(m)) return onParts([...parts, m]);
    const left = parts.filter((w) => w !== m);
    if (left.length > 1) return onParts(left);
    // One way left: a way again.
    onParts(undefined);
    onChange(left[0] ?? m);
  };
  const toggle = () => {
    if (!onParts) return;
    if (parts) {
      onParts(undefined);
      onChange(parts[0]);
      // The usual case first (the user: «часть наличными, а часть в кредит остаётся»): the way picked and on credit.
    } else onParts(value === 'credit' ? ['cash', 'credit'] : [value, 'credit']);
  };
  return (
    <Stack gap={4}>
      <div className="chip-row wrap" role={parts ? 'group' : 'radiogroup'}>
        {ways.map((m) => {
          const I = PURSE_ICON[m];
          const on = parts ? parts.includes(m) : value === m;
          return (
            <button key={m} type="button" className="chip" role={parts ? 'checkbox' : 'radio'} aria-checked={on} data-active={on} data-way={m} onClick={() => tap(m)}>
              <I size={17} stroke={2} aria-hidden />
              {m === 'transfer' ? t('ledger.transferFull') : wayLabel(t, m, kind)}
            </button>
          );
        })}
        {onParts && (
          <button type="button" className="chip" aria-pressed={!!parts} data-active={!!parts} data-way="parts" onClick={toggle}>
            <IconArrowsSplit2 size={17} stroke={2} aria-hidden />
            {t('expense.parts')}
          </button>
        )}
      </div>
      {kind === 'out' && !parts && (value === 'card' || value === 'transfer') && (
        <Text size="xs" c="dimmed">
          {t('ledger.cardOutHint')}
        </Text>
      )}
    </Stack>
  );
}

/**
 * The sums of an expense paid in parts (v0.58): a row a way — typed, but the last one: it takes what is left of the
 * whole (on credit, when it is one of them — what is not paid now is owed; domain/expenseParts.ts).
 */
function SplitRows({ amountFils, ways, typed, onTyped }: { amountFils: number | undefined; ways: ExpenseMethod[]; typed: Partial<Record<ExpenseMethod, number>>; onTyped: (typed: Partial<Record<ExpenseMethod, number>>) => void }) {
  const { t } = useTranslation();
  const rows = partRows(ways);
  const rest = partsRest(amountFils, ways, typed);
  return (
    <div className="ios-group" data-split-rows>
      {rows.map((w, i) => {
        const I = PURSE_ICON[w];
        const name = wayLabel(t, w, 'out');
        const label = (
          <Group gap={8} wrap="nowrap" component="span">
            <I size={18} stroke={2} aria-hidden style={{ flexShrink: 0 }} />
            {name}
          </Group>
        );
        return i < rows.length - 1 ? (
          <FormRow key={w} label={label}>
            <MoneyInput label={undefined} ariaLabel={name} value={typed[w]} onChange={(v) => onTyped({ ...typed, [w]: v })} />
          </FormRow>
        ) : (
          <FormRow key={w} label={label}>
            <Text span fw={600} c={rest <= 0 ? 'red.7' : w === 'credit' ? 'orange.7' : undefined} data-split-rest={w}>
              <Money fils={rest} />
            </Text>
          </FormRow>
        );
      })}
    </div>
  );
}

/** An expense paid in parts, in its sheet (v0.58): all its parts — a way and a sum each, this one marked. */
export function SplitParts({ splitId, current }: { splitId: string; current: string }) {
  const { t } = useTranslation();
  const parts = useLiveQuery(async () => {
    const list = await db.expenses.filter((e) => e.splitId === splitId && !e.voidedAt).toArray();
    const order = partRows(list.map((e) => e.method));
    return list.sort((a, b) => order.indexOf(a.method) - order.indexOf(b.method));
  }, [splitId]);
  if (!parts || parts.length < 2) return null;
  return (
    <div>
      <Text size="sm" fw={500} mb={6}>
        {t('expense.parts')} · <Money fils={parts.reduce((s, p) => s + p.amountFils, 0)} />
      </Text>
      <div className="chip-row wrap" data-split-parts>
        {parts.map((p) => {
          const I = PURSE_ICON[p.method];
          return (
            <span key={p.id} className="chip" data-active={p.id === current} aria-current={p.id === current || undefined}>
              <I size={17} stroke={2} aria-label={wayLabel(t, p.method, 'out')} />
              <Money fils={p.amountFils} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What an entry is for: search a car (plate), a customer (name, phone); a found car offers its jobs,
 * its open job is picked by itself.
 */
export function LinkPicker({ value, onChange }: { value: Links; onChange: (v: Links) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const picked = useLiveQuery(async () => {
    const [vehicle, customer, orders] = await Promise.all([
      value.vehicleId ? db.vehicles.get(value.vehicleId) : undefined,
      value.customerId ? db.customers.get(value.customerId) : undefined,
      value.vehicleId ? db.orders.where('vehicleId').equals(value.vehicleId).reverse().sortBy('createdAt') : Promise.resolve([] as Order[]),
    ]);
    return { vehicle, customer, orders: orders.slice(0, 6) };
  }, [value.vehicleId, value.customerId]);
  useEffect(() => {
    let alive = true;
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(() => void search(query, 6).then((h) => alive && setHits(h)), 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  const pick = async (h: SearchHit) => {
    setQ('');
    setHits([]);
    if (!h.vehicle) return onChange({ customerId: h.customer.id });
    const orders = await db.orders.where('vehicleId').equals(h.vehicle.id).toArray();
    const open = orders.filter((o) => OPEN_STAGES.has(o.stage)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    onChange({ vehicleId: h.vehicle.id, customerId: h.customer.id, orderId: open?.id });
  };

  if (value.vehicleId || value.customerId) {
    const v = picked?.vehicle;
    const c = picked?.customer;
    const who = c ? (c.type === 'company' && c.companyName ? c.companyName : c.name) || formatPhone(c.phone) || t('customer.noName') : '';
    return (
      <Box className="surface-soft" p="sm">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            {v ? <PlateText plate={v.plate} size="sm" /> : <IconUser size={20} />}
            <Box style={{ minWidth: 0 }}>
              {v && (
                <Text size="sm" fw={600} lineClamp={1}>
                  {[v.make, v.model].filter(Boolean).join(' ')}
                </Text>
              )}
              <Text size="xs" c="dimmed" lineClamp={1}>
                {who}
              </Text>
            </Box>
          </Group>
          <ActionIcon variant="subtle" color="gray" onClick={() => onChange({})} aria-label={t('common.delete')}>
            <IconX size={18} />
          </ActionIcon>
        </Group>
        {!!picked?.orders.length && (
          <div className="chip-row" style={{ marginTop: 10 }} aria-label={t('ledger.forJob')}>
            {picked.orders.map((o) => (
              <button key={o.id} type="button" className="chip" data-active={value.orderId === o.id} onClick={() => onChange({ ...value, orderId: value.orderId === o.id ? undefined : o.id })}>
                №{o.number}
                <span className="chip-note">{OPEN_STAGES.has(o.stage) ? t(`stage.${o.stage}`) : formatDate(o.createdAt)}</span>
              </button>
            ))}
          </div>
        )}
      </Box>
    );
  }
  return (
    <Box style={{ position: 'relative' }}>
      <TextInput
        leftSection={<IconSearch size={18} />}
        placeholder={t('ledger.linkSearch')}
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        autoComplete="off"
      />
      {hits.length > 0 && (
        <Stack gap={0} mt={6} className="surface-soft" style={{ overflow: 'hidden' }}>
          {hits.map((h) => (
            <UnstyledButton key={`${h.customer.id}-${h.vehicle?.id ?? ''}`} onClick={() => void pick(h)} className="tap" style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--app-hairline)' }}>
              <Group gap="sm" wrap="nowrap">
                {h.vehicle ? <PlateText plate={h.vehicle.plate} size="xs" /> : <IconUser size={18} />}
                <Box style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600} lineClamp={1}>
                    {h.vehicle ? [h.vehicle.make, h.vehicle.model].filter(Boolean).join(' ') : h.customer.name || t('customer.noName')}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {[h.vehicle ? h.customer.name : '', h.customer.phone ? formatPhone(h.customer.phone) : ''].filter(Boolean).join(' · ')}
                  </Text>
                </Box>
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      )}
    </Box>
  );
}

/** Whose debt a "debt payment" is, and the job to pay off first — or (v0.62) the months to pay off first. */
export interface DebtPick {
  customerId?: string;
  orderId?: string;
  /** YYYY-MM */
  months?: string[];
}

/**
 * The customer of a "debt payment" — optional. Those who owe are offered at once (who owes most first), anyone
 * else is found by name, phone or plate. A customer picked shows their debts and where this sum goes: the oldest
 * first; a tap on a job pays that one first. What nobody owes is shown as money in with no debt to it.
 *
 * v0.62: debts of two months or more (or invoices from before the app) — by month, each month a card with its jobs under
 * it: a tap on months picks them (they are paid first, the oldest of them first) and offers what they owe as the sum
 * (`onAmount`, while the sum is what the months picked before owed — a sum typed over it stays). A job picked lets the
 * months go, and the other way round.
 */
function DebtorField({ value, onChange, amountFils, onAmount }: { value: DebtPick; onChange: (v: DebtPick) => void; amountFils: number; onAmount?: (fils: number | undefined) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const debtors = useLiveQuery(loadDebtors, []);
  const picked = useLiveQuery(async () => (value.customerId ? (await db.customers.get(value.customerId)) ?? null : null), [value.customerId]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    let alive = true;
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(() => void search(query, 6).then((h) => alive && setHits(h)), 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q]);
  const nameOf = (c: { type: string; companyName?: string; name: string }) => (c.type === 'company' && c.companyName ? c.companyName : c.name) || t('customer.noName');

  if (value.customerId) {
    const debtor = debtors?.find((d) => d.customer.id === value.customerId);
    const jobs = debtor ? debtor.cars.flatMap((c) => c.jobs) : [];
    const months = debtor?.months ?? [];
    const chosen = value.months ?? [];
    // Spread as the payment will be: the jobs and (v0.47) the invoices from before the app, the oldest first — the months
    // picked first (v0.62), else the job picked.
    const plan = spread(amountFils, debtQueue(jobs, debtor ? debtor.history.flatMap((m) => m.dues) : []), chosen.length ? monthKeys(months, chosen) : value.orderId);
    const got = new Map(plan.parts.map((p) => [p.key, p.amountFils]));
    const c = debtor?.customer ?? picked ?? undefined;
    const pickMonth = (month: string) => {
      const next = chosen.includes(month) ? chosen.filter((x) => x !== month) : [...chosen, month];
      if (!amountFils || amountFils === monthsDue(months, chosen)) onAmount?.(monthsDue(months, next) || undefined);
      onChange({ customerId: value.customerId, months: next.length ? next : undefined });
    };
    const jobCard = (j: DebtJob) => {
      const part = got.get(j.order.id) ?? 0;
      return (
        <SelectCard key={j.order.id} active={value.orderId === j.order.id} onClick={() => onChange({ customerId: value.customerId, orderId: value.orderId === j.order.id ? undefined : j.order.id })}>
          <Group justify="space-between" wrap="nowrap" gap="sm" data-debt-job={j.order.number}>
            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
              <PlateText plate={j.vehicle.plate} size="xs" />
              <Text size="sm" fw={600} lineClamp={1}>
                №{j.order.number}
                <Text span inherit fw={400} c="dimmed">
                  {[' ', j.vehicle.make, j.vehicle.model].filter(Boolean).join(' ')}
                </Text>
              </Text>
            </Group>
            <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
              <Money fils={j.dueFils} size="sm" />
              {part > 0 && <Money fils={-part} size="xs" c="green.7" />}
            </Stack>
          </Group>
        </SelectCard>
      );
    };
    return (
      <Stack gap={8} className="debt-pick">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <PersonAvatar name={c ? nameOf(c) : ''} company={c?.type === 'company'} size={36} />
            <Box style={{ minWidth: 0 }}>
              <Text fw={600} lineClamp={1}>
                {c ? nameOf(c) : ''}
              </Text>
              {debtor ? (
                <Text size="sm" c="red" className="tnum">
                  {formatAed(debtor.totalFils)}
                </Text>
              ) : (
                debtors && (
                  <Text size="sm" c="dimmed">
                    {t('debt.noDebts')}
                  </Text>
                )
              )}
            </Box>
          </Group>
          <ActionIcon variant="subtle" color="gray" onClick={() => onChange({})} aria-label={t('common.delete')}>
            <IconX size={18} />
          </ActionIcon>
        </Group>
        {byMonths(months)
          ? months.map((m) => {
              const part = m.jobs.reduce((a, j) => a + (got.get(j.order.id) ?? 0), 0) + m.history.reduce((a, d) => a + (got.get(historyKey(d.invoiceId)) ?? 0), 0);
              return (
                <Stack key={m.month} gap={6}>
                  <SelectCard active={chosen.includes(m.month)} onClick={() => pickMonth(m.month)}>
                    <Group justify="space-between" wrap="nowrap" gap="sm" data-debt-month={m.month}>
                      <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                        <IconCalendarDollar size={18} stroke={1.8} color="var(--mantine-color-green-6)" aria-hidden />
                        <Text size="sm" fw={600} lineClamp={1}>
                          {monthLong(m.month, lang)}
                          {m.history.length > 0 && (
                            <Text span inherit fw={400} c="dimmed">
                              {` · ${t('history.count', { count: m.history.length })}`}
                            </Text>
                          )}
                        </Text>
                      </Group>
                      <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
                        <Money fils={m.dueFils} size="sm" />
                        {part > 0 && <Money fils={-part} size="xs" c="green.7" />}
                      </Stack>
                    </Group>
                  </SelectCard>
                  {m.jobs.length > 0 && (
                    <Stack gap={6} pl={16}>
                      {m.jobs.map(jobCard)}
                    </Stack>
                  )}
                </Stack>
              );
            })
          : jobs.map(jobCard)}
        {amountFils > 0 && plan.restFils > 0 && (
          <Group justify="space-between" wrap="nowrap" px={4} data-debt-rest>
            <Text size="sm" c="dimmed">
              {t('debt.rest')}
            </Text>
            <Money fils={plan.restFils} size="sm" c="dimmed" />
          </Group>
        )}
      </Stack>
    );
  }
  return (
    <Stack gap={8}>
      {!!debtors?.length && (
        <div className="chip-row bleed" aria-label={t('money.debts')}>
          {debtors.slice(0, 12).map((d) => (
            <button key={d.customer.id} type="button" className="chip" data-debtor={d.customer.id} onClick={() => onChange({ customerId: d.customer.id })}>
              {nameOf(d.customer)}
              <span className="chip-note">{formatAed(d.totalFils)}</span>
            </button>
          ))}
        </div>
      )}
      <TextInput leftSection={<IconSearch size={18} />} placeholder={t('debt.search')} value={q} onChange={(e) => setQ(e.currentTarget.value)} autoComplete="off" />
      {hits.length > 0 && (
        <Stack gap={0} className="surface-soft" style={{ overflow: 'hidden' }}>
          {hits.map((h) => (
            <UnstyledButton
              key={`${h.customer.id}-${h.vehicle?.id ?? ''}`}
              onClick={() => {
                setQ('');
                setHits([]);
                // Found by a car: its debt is the one to pay off first.
                const job = h.vehicle ? debtors?.find((d) => d.customer.id === h.customer.id)?.cars.find((c) => c.vehicle.id === h.vehicle!.id)?.jobs[0] : undefined;
                onChange({ customerId: h.customer.id, orderId: job?.order.id });
              }}
              className="tap"
              style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--app-hairline)' }}
            >
              <Group gap="sm" wrap="nowrap">
                {h.vehicle ? <PlateText plate={h.vehicle.plate} size="xs" /> : <IconUser size={18} />}
                <Box style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600} lineClamp={1}>
                    {nameOf(h.customer)}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {[h.vehicle ? [h.vehicle.make, h.vehicle.model].filter(Boolean).join(' ') : '', h.customer.phone ? formatPhone(h.customer.phone) : ''].filter(Boolean).join(' · ')}
                  </Text>
                </Box>
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Money of one job, car or customer outside its invoice: expenses (parts bought, sublet work…) and
 * other income, with a button to add one already linked to it.
 */
export function LinkedMoney({ link, by }: { link: Links; by: 'orderId' | 'vehicleId' | 'customerId' }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [sheet, setSheet] = useState<EntryPreset | null>(null);
  const incomeLabel = useIncomeLabel(useIncomeCategories());
  const data = useLiveQuery(async () => {
    const value = link[by];
    if (!value) return undefined;
    const [m, cats, orders] = await Promise.all([moneyOf({ [by]: value }), db.expenseCategories.toArray(), db.orders.toArray()]);
    return { ...m, cats, orders: new Map(orders.map((o) => [o.id, o])) };
  }, [link[by], by]);
  if (!data) return null;
  const rows = [
    ...data.incomes.map((i) => ({ id: i.id, date: i.date, at: i.createdAt, in: true, amount: i.amountFils, title: incomeLabel(i.category), note: i.note, method: i.method as ExpenseMethod, orderId: i.orderId })),
    ...data.expenses.map((e) => {
      const c = data.cats.find((x) => x.id === e.categoryId);
      return { id: e.id, date: e.date, at: e.createdAt, in: false, amount: e.amountFils, title: c ? (lang === 'ru' ? c.nameRu : c.nameEn) : '', note: [e.vendor, e.note].filter(Boolean).join(' · '), method: e.method, orderId: e.orderId };
    }),
  ].sort((a, b) => `${b.date}${b.at}`.localeCompare(`${a.date}${a.at}`));
  const spent = data.expenses.reduce((s, e) => s + e.amountFils, 0);
  const got = data.incomes.reduce((s, i) => s + i.amountFils, 0);
  return (
    <Box>
      <Group justify="space-between" mb={6} px={4} wrap="nowrap">
        <Text size="sm" fw={500} c="dimmed">
          {t('ledger.linkedTitle')}
        </Text>
        <Text size="xs" c="dimmed" className="tnum">
          {spent > 0 && `${t('ledger.outs')} ${formatAed(spent)}`}
          {spent > 0 && got > 0 && ' · '}
          {got > 0 && `${t('ledger.ins')} ${formatAed(got)}`}
        </Text>
      </Group>
      {rows.length > 0 && (
        <Stack gap={0} className="surface" mb="xs" style={{ overflow: 'hidden' }}>
          {rows.map((r) => (
            <Group key={r.id} justify="space-between" wrap="nowrap" px="md" py={10} style={{ borderBottom: '0.5px solid var(--app-hairline)' }}>
              <Box style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} lineClamp={1}>
                  {r.note ? `${r.title} · ${r.note}` : r.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatDate(r.date)} · {wayLabel(t, r.method, r.in ? 'in' : 'out')}
                  {by !== 'orderId' && r.orderId && data.orders.get(r.orderId) ? ` · №${data.orders.get(r.orderId)!.number}` : ''}
                </Text>
              </Box>
              <Text size="sm" fw={600} c={r.in ? 'green.7' : 'red.7'} className="tnum" style={{ whiteSpace: 'nowrap' }}>
                {r.in ? '+' : '−'}
                {formatAed(r.amount)}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
      <Group gap="xs">
        <Button size="compact-md" variant="light" color="red" leftSection={<IconArrowUpRight size={16} />} onClick={() => setSheet({ kind: 'out', link })}>
          {t('ledger.out')}
        </Button>
        <Button size="compact-md" variant="light" color="green" leftSection={<IconArrowDownLeft size={16} />} onClick={() => setSheet({ kind: 'in', link })}>
          {t('ledger.in')}
        </Button>
      </Group>
      <EntrySheet opened={!!sheet} onClose={() => setSheet(null)} preset={sheet ?? undefined} />
    </Box>
  );
}

export interface EntryPreset {
  kind?: 'in' | 'out';
  link?: Links;
  /** Money in as a "debt payment" (of this customer, this job first). */
  debt?: DebtPick;
  /** The sum offered (v0.62: a month picked to pay — what it owes). */
  amountFils?: number;
  /** A receipt photographed before the sheet (v0.50): attached, and what was read off it filled in. */
  receipt?: File;
  expense?: { amountFils?: number; vatFils?: number; vendor?: string; note?: string; date?: string };
}

/**
 * One sheet for both ways money moves, like a row of the money sheet: in/out, amount, cash/card,
 * category, what it was for (job, car, customer), a note, the date. Expenses can carry a receipt and VAT —
 * and can be taken on credit: no money moves, the garage owes it ("Money → Debts → Company debts").
 * Money in can be a "debt payment": for a customer picked it is spread over their jobs (`DebtorField`).
 */
export function EntrySheet({ opened, onClose, preset }: { opened: boolean; onClose: () => void; preset?: EntryPreset }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  // Categories the garage uses most come first (parts and consumables, usually).
  const cats = useLiveQuery(async () => {
    const [list, expenses] = await Promise.all([db.expenseCategories.filter((c) => c.active).toArray(), db.expenses.toArray()]);
    const uses = new Map<string, number>();
    for (const e of expenses) if (!e.voidedAt) uses.set(e.categoryId, (uses.get(e.categoryId) ?? 0) + 1);
    const order = ['parts', 'consumables', 'tools', 'salaries', 'rent', 'utilities', 'marketing', 'incidents', 'other'];
    const rank = (code: string) => (order.indexOf(code) < 0 ? 99 : order.indexOf(code));
    return list.sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || rank(a.code) - rank(b.code));
  }, []);
  const [kind, setKindState] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState<number>();
  const [method, setMethod] = useState<ExpenseMethod>('cash');
  // Paid in parts (v0.58): the ways, and the sums typed for them (the last way takes the rest).
  const [parts, setParts] = useState<ExpenseMethod[]>();
  const [typed, setTyped] = useState<Partial<Record<ExpenseMethod, number>>>({});
  const [incomeCat, setIncomeCat] = useState('service');
  const incomeCats = useIncomeCategories();
  const [expenseCat, setExpenseCat] = useState<string>();
  const [link, setLink] = useState<Links>({});
  const [debt, setDebt] = useState<DebtPick>({});
  const [note, setNote] = useState('');
  const [date, setDate] = useState(dubaiDate());
  const [more, setMore] = useState(false);
  const [vendor, setVendor] = useState('');
  const [vat, setVat] = useState<number>();
  const [receipt, setReceipt] = useState<File>();
  const [over, setOver] = useState('');
  const [spent, setSpent] = useState(0);
  // On credit (v0.61): whom the garage owes — to be said each time.
  const [owed, setOwed] = useState<OwedPick>();
  // Money comes in by a way it can be counted: "on credit" is only a way to spend.
  const setKind = (k: 'in' | 'out') => {
    setKindState(k);
    if (k === 'in') {
      setMethod((m) => (m === 'credit' ? 'cash' : m));
      setParts(undefined);
    }
  };

  useEffect(() => {
    if (!opened) return;
    setKind(preset?.debt ? 'in' : preset?.kind ?? 'out');
    setLink(preset?.link ?? {});
    setDebt(preset?.debt ?? {});
    if (preset?.debt) setIncomeCat('debt');
    // The sheet opens on real money; "on credit" is picked each time it is meant.
    setMethod((m) => (m === 'credit' ? 'cash' : m));
    setParts(undefined);
    setTyped({});
    setAmount(preset?.amountFils ?? preset?.expense?.amountFils);
    setNote(preset?.expense?.note ?? '');
    setDate(preset?.expense?.date ?? dubaiDate());
    setVendor(preset?.expense?.vendor ?? '');
    setVat(preset?.expense?.vatFils);
    setReceipt(preset?.receipt);
    setOver('');
    setOwed(undefined);
    setMore(!!preset?.expense?.vendor || !!preset?.expense?.vatFils);
  }, [opened, preset]);
  useEffect(() => {
    if (!expenseCat && cats?.length) setExpenseCat(cats.find((c) => c.code === 'parts')?.id ?? cats[0].id);
  }, [cats, expenseCat]);
  // «The seller» picked as the one owed follows the seller's name as it is typed (erased — nobody picked).
  useEffect(() => {
    const name = vendor.trim();
    setOwed((o) => (o?.kind !== 'seller' ? o : name ? (o.name === name ? o : { kind: 'seller', name }) : undefined));
  }, [vendor]);
  // The category picked was taken out of the chips (here, or before the sheet opened): the first one offered instead.
  // One not in the list yet (just added — the list follows a moment later) stays.
  useEffect(() => {
    if (incomeCats?.some((c) => c.code === incomeCat && !c.active)) setIncomeCat(incomeCats.find((c) => c.active)?.code ?? 'other');
  }, [incomeCats, incomeCat]);
  useEffect(() => {
    if (kind === 'out' && expenseCat) void categoryMonthSpent(expenseCat, date.slice(0, 7)).then(setSpent);
  }, [kind, expenseCat, date]);

  const cat = cats?.find((c) => c.id === expenseCat);
  const overLimit = kind === 'out' && !!cat && cat.monthlyLimitFils > 0 && spent + (amount ?? 0) > cat.monthlyLimitFils;
  const debtIn = kind === 'in' && incomeCat === 'debt';
  const split = kind === 'out' && parts ? partsOf(amount, parts, typed) : undefined;
  // Something of it taken on credit: whom it is owed to is said before it is saved (v0.61).
  const onCredit = kind === 'out' && (parts ? parts.includes('credit') : method === 'credit');
  const save = () =>
    run(async () => {
      if (kind === 'in') {
        const way = method === 'credit' ? 'cash' : method;
        if (debtIn) await addIncome({ date, category: 'debt', amountFils: amount ?? 0, method: way, note, customerId: debt.customerId, orderId: debt.orderId, months: debt.months });
        else await addIncome({ date, category: incomeCat, amountFils: amount ?? 0, method: way, note, ...link });
      } else
        await addExpense({
          date,
          categoryId: expenseCat!,
          amountFils: amount ?? 0,
          vatFils: vat ?? 0,
          vendor,
          method,
          parts: split,
          note,
          overLimitComment: over,
          receipt,
          owedTo: onCredit ? owed : undefined,
          ...link,
        });
      haptic('success');
      onClose();
    }, kind === 'in' ? 'ledger.savedIn' : 'ledger.savedOut');

  return (
    <Modal opened={opened} onClose={onClose} title={t(kind === 'in' ? 'ledger.addIn' : 'ledger.addOut')}>
      <Stack gap="md">
        <SegmentedControl
          fullWidth
          value={kind}
          onChange={(v) => setKind(v as 'in' | 'out')}
          color={kind === 'in' ? 'green' : 'red'}
          data={[
            { value: 'in', label: t('ledger.in') },
            { value: 'out', label: t('ledger.out') },
          ]}
        />
        <MoneyInput label={t('common.amount')} value={amount} onChange={setAmount} autoFocus big />
        <PursePicker value={method} onChange={setMethod} kind={kind} credit={kind === 'out'} parts={kind === 'out' ? parts : undefined} onParts={kind === 'out' ? setParts : undefined} />
        {kind === 'out' && parts && <SplitRows amountFils={amount} ways={parts} typed={typed} onTyped={setTyped} />}
        {onCredit && <OwedToField value={owed} onChange={setOwed} seller={vendor.trim() ? { kind: 'seller', name: vendor.trim() } : undefined} missing={!owed} />}
        <div>
          <Text size="sm" fw={500} mb={6}>
            {t('expense.category')}
          </Text>
          {kind === 'in' ? (
            <IncomeChips value={incomeCat} onChange={setIncomeCat} debt />
          ) : (
            <div className="chip-row wrap">
              {(cats ?? []).map((c) => (
                <button key={c.id} type="button" className="chip" data-active={expenseCat === c.id} onClick={() => setExpenseCat(c.id)}>
                  {lang === 'ru' ? c.nameRu : c.nameEn}
                </button>
              ))}
            </div>
          )}
        </div>
        {debtIn ? (
          <div>
            <Group gap={6} mb={6}>
              <IconUser size={16} />
              <Text size="sm" fw={500}>
                {t('debt.who')}
              </Text>
            </Group>
            <DebtorField value={debt} onChange={setDebt} amountFils={amount ?? 0} onAmount={setAmount} />
          </div>
        ) : (
          <div>
            <Group gap={6} mb={6}>
              <IconCar size={16} />
              <Text size="sm" fw={500}>
                {t('ledger.forWhat')}
              </Text>
            </Group>
            <LinkPicker value={link} onChange={setLink} />
          </div>
        )}
        <TextInput label={t('ledger.note')} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <UnstyledButton onClick={() => setMore((m) => !m)}>
          <Group gap={4} c="cobalt.6">
            <Text size="sm" fw={600} c="cobalt.6">
              {date === dubaiDate() ? t('ledger.today') : formatDate(date)}
              {kind === 'out' ? ` · ${t('ledger.receiptVat')}` : ''}
            </Text>
            <IconChevronDown size={16} style={{ transform: more ? 'rotate(180deg)' : undefined, transition: 'transform var(--dur-2) var(--ease-out)' }} />
          </Group>
        </UnstyledButton>
        <Collapse in={more}>
          <Stack gap="sm">
            <DateField label={t('common.date')} value={date} onChange={setDate} maxDate={dubaiDate()} />
            {kind === 'out' && (
              <>
                <TextInput label={t('expense.vendor')} value={vendor} onChange={(e) => setVendor(e.currentTarget.value)} />
                <MoneyInput
                  label={t('expense.vat')}
                  value={vat}
                  onChange={setVat}
                  description={
                    amount ? (
                      <Text span size="xs" c="cobalt.6" style={{ cursor: 'pointer' }} onClick={() => setVat(vatOf(netFromGross(amount, 500), 500))}>
                        {t('expense.vatFromGross')}
                      </Text>
                    ) : undefined
                  }
                />
                <CaptureButton variant="light" leftSection={<IconReceipt2 size={18} />} onFiles={(f) => setReceipt(f[0])}>
                  {receipt ? t('parts.receiptAttached') : t('parts.receiptPhoto')}
                </CaptureButton>
              </>
            )}
          </Stack>
        </Collapse>
        {overLimit && (
          <TextInput
            label={t('expense.overLimitComment')}
            required
            value={over}
            onChange={(e) => setOver(e.currentTarget.value)}
            description={t('expense.limitUsage', { spent: formatAed(spent + (amount ?? 0)), limit: formatAed(cat!.monthlyLimitFils) })}
          />
        )}
        <Button
          size="lg"
          color={kind === 'in' ? 'green' : 'red'}
          leftSection={kind === 'in' ? <IconArrowDownLeft size={20} /> : <IconArrowUpRight size={20} />}
          loading={busy}
          disabled={!amount || (kind === 'out' && !expenseCat) || (kind === 'out' && !!parts && !split) || (overLimit && !over.trim()) || (onCredit && !owed)}
          onClick={save}
        >
          {t(kind === 'in' ? 'ledger.saveIn' : 'ledger.saveOut')}
          {amount ? ` · ${formatAed(amount)}` : ''}
        </Button>
      </Stack>
    </Modal>
  );
}
