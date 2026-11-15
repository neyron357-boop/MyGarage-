import { ActionIcon, Box, Button, Collapse, Group, Modal, SegmentedControl, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconArrowDownLeft, IconArrowUpRight, IconBuildingBank, IconCar, IconCash, IconChevronDown, IconClockDollar, IconCreditCard, IconReceipt2, IconSearch, IconUser, IconX } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { dubaiDate, formatDate } from '../../domain/dates';
import { allocate } from '../../domain/debts';
import { formatAed } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import type { ExpenseMethod, IncomeCategory, Order } from '../../domain/types';
import { netFromGross, vatOf } from '../../domain/vat';
import { search, type SearchHit } from '../../services/customers';
import { loadDebtors } from '../../services/debts';
import { addIncome, moneyOf, type Links } from '../../services/ledger';
import { addExpense, categoryMonthSpent } from '../../services/money';
import { CaptureButton } from '../../ui/CaptureButton';
import { Money, MoneyInput, PersonAvatar, PlateText, SelectCard } from '../../ui/components';
import { DateField } from '../../ui/DateFields';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';

/** What an income of its own can be (a debt paid is entered as one, but is not changed into another afterwards). */
export const INCOME_CATEGORIES: IncomeCategory[] = ['service', 'sales', 'other'];
const ENTRY_INCOME_CATEGORIES: IncomeCategory[] = [...INCOME_CATEGORIES, 'debt'];
const OPEN_STAGES = new Set(['booked', 'intake', 'diagnostics', 'awaiting_approval', 'awaiting_parts', 'in_progress', 'quality_check', 'ready']);

/** Cash / Card / Bank transfer — and, for an expense, "On credit": nothing is paid yet, the garage owes it. */
const PURSE_ICON = { cash: IconCash, card: IconCreditCard, transfer: IconBuildingBank, credit: IconClockDollar };

export function PursePicker({ value, onChange, kind, credit }: { value: ExpenseMethod; onChange: (m: ExpenseMethod) => void; kind: 'in' | 'out'; /** "On credit" offered too (a new expense). */ credit?: boolean }) {
  const { t } = useTranslation();
  const ways: ExpenseMethod[] = credit ? ['cash', 'card', 'transfer', 'credit'] : ['cash', 'card', 'transfer'];
  return (
    <Stack gap={4}>
      <div className="chip-row wrap" role="radiogroup">
        {ways.map((m) => {
          const I = PURSE_ICON[m];
          return (
            <button key={m} type="button" className="chip" role="radio" aria-checked={value === m} data-active={value === m} data-way={m} onClick={() => onChange(m)}>
              <I size={17} stroke={2} aria-hidden />
              {m === 'transfer' ? t('ledger.transferFull') : t(`payment.method.${m}`)}
            </button>
          );
        })}
      </div>
      {kind === 'out' && (value === 'card' || value === 'transfer') && (
        <Text size="xs" c="dimmed">
          {t('ledger.cardOutHint')}
        </Text>
      )}
    </Stack>
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

/** Whose debt a "debt payment" is, and the job to pay off first. */
export interface DebtPick {
  customerId?: string;
  orderId?: string;
}

/**
 * The customer of a "debt payment" — optional. Those who owe are offered at once (who owes most first), anyone
 * else is found by name, phone or plate. A customer picked shows their debts and where this sum goes: the oldest
 * first; a tap on a job pays that one first. What nobody owes is shown as money in with no debt to it.
 */
function DebtorField({ value, onChange, amountFils }: { value: DebtPick; onChange: (v: DebtPick) => void; amountFils: number }) {
  const { t } = useTranslation();
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
    const plan = allocate(amountFils, jobs.map((j) => ({ orderId: j.order.id, dueFils: j.dueFils, since: j.since })), value.orderId);
    const got = new Map(plan.parts.map((p) => [p.orderId, p.amountFils]));
    const c = debtor?.customer ?? picked ?? undefined;
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
        {jobs.map((j) => {
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
        })}
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
  const data = useLiveQuery(async () => {
    const value = link[by];
    if (!value) return undefined;
    const [m, cats, orders] = await Promise.all([moneyOf({ [by]: value }), db.expenseCategories.toArray(), db.orders.toArray()]);
    return { ...m, cats, orders: new Map(orders.map((o) => [o.id, o])) };
  }, [link[by], by]);
  if (!data) return null;
  const rows = [
    ...data.incomes.map((i) => ({ id: i.id, date: i.date, at: i.createdAt, in: true, amount: i.amountFils, title: t(`income.category.${i.category}`), note: i.note, method: i.method as ExpenseMethod, orderId: i.orderId })),
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
                  {formatDate(r.date)} · {t(`payment.method.${r.method}`)}
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
  const [incomeCat, setIncomeCat] = useState<IncomeCategory>('service');
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
  // Money comes in by a way it can be counted: "on credit" is only a way to spend.
  const setKind = (k: 'in' | 'out') => {
    setKindState(k);
    if (k === 'in') setMethod((m) => (m === 'credit' ? 'cash' : m));
  };

  useEffect(() => {
    if (!opened) return;
    setKind(preset?.debt ? 'in' : preset?.kind ?? 'out');
    setLink(preset?.link ?? {});
    setDebt(preset?.debt ?? {});
    if (preset?.debt) setIncomeCat('debt');
    // The sheet opens on real money; "on credit" is picked each time it is meant.
    setMethod((m) => (m === 'credit' ? 'cash' : m));
    setAmount(undefined);
    setNote('');
    setDate(dubaiDate());
    setVendor('');
    setVat(undefined);
    setReceipt(undefined);
    setOver('');
    setMore(false);
  }, [opened, preset]);
  useEffect(() => {
    if (!expenseCat && cats?.length) setExpenseCat(cats.find((c) => c.code === 'parts')?.id ?? cats[0].id);
  }, [cats, expenseCat]);
  useEffect(() => {
    if (kind === 'out' && expenseCat) void categoryMonthSpent(expenseCat, date.slice(0, 7)).then(setSpent);
  }, [kind, expenseCat, date]);

  const cat = cats?.find((c) => c.id === expenseCat);
  const overLimit = kind === 'out' && !!cat && cat.monthlyLimitFils > 0 && spent + (amount ?? 0) > cat.monthlyLimitFils;
  const debtIn = kind === 'in' && incomeCat === 'debt';
  const save = () =>
    run(async () => {
      if (kind === 'in') {
        const way = method === 'credit' ? 'cash' : method;
        if (debtIn) await addIncome({ date, category: 'debt', amountFils: amount ?? 0, method: way, note, customerId: debt.customerId, orderId: debt.orderId });
        else await addIncome({ date, category: incomeCat, amountFils: amount ?? 0, method: way, note, ...link });
      } else
        await addExpense({
          date,
          categoryId: expenseCat!,
          amountFils: amount ?? 0,
          vatFils: vat ?? 0,
          vendor,
          method,
          note,
          overLimitComment: over,
          receipt,
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
        <PursePicker value={method} onChange={setMethod} kind={kind} credit={kind === 'out'} />
        <div>
          <Text size="sm" fw={500} mb={6}>
            {t('expense.category')}
          </Text>
          <div className="chip-row wrap">
            {kind === 'in'
              ? ENTRY_INCOME_CATEGORIES.map((c) => (
                  <button key={c} type="button" className="chip" data-active={incomeCat === c} data-income={c} onClick={() => setIncomeCat(c)}>
                    {t(`income.category.${c}`)}
                  </button>
                ))
              : (cats ?? []).map((c) => (
                  <button key={c.id} type="button" className="chip" data-active={expenseCat === c.id} onClick={() => setExpenseCat(c.id)}>
                    {lang === 'ru' ? c.nameRu : c.nameEn}
                  </button>
                ))}
          </div>
        </div>
        {debtIn ? (
          <div>
            <Group gap={6} mb={6}>
              <IconUser size={16} />
              <Text size="sm" fw={500}>
                {t('debt.who')}
              </Text>
            </Group>
            <DebtorField value={debt} onChange={setDebt} amountFils={amount ?? 0} />
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
            <DateField label={t('common.date')} value={date} onChange={setDate} />
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
          disabled={!amount || (kind === 'out' && !expenseCat) || (overLimit && !over.trim())}
          onClick={save}
        >
          {t(kind === 'in' ? 'ledger.saveIn' : 'ledger.saveOut')}
          {amount ? ` · ${formatAed(amount)}` : ''}
        </Button>
      </Stack>
    </Modal>
  );
}
