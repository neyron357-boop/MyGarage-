import { Box, Button, Group, Modal, SimpleGrid, Stack, Text, TextInput, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconArrowDownLeft, IconArrowUpRight, IconBook2, IconLock, IconPaperclip, IconPencil } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDate, monthKey, monthRange } from '../../domain/dates';
import { periodTotals, type LedgerEntry, type Purse } from '../../domain/ledger';
import { formatAed } from '../../domain/money';
import type { ExpenseCategory, IncomeCategory } from '../../domain/types';
import { loadLedger, setOpeningBalances, updateExpense, updateIncome, voidExpense, voidIncome, type Links } from '../../services/ledger';
import { proofIndex } from '../../services/proofs';
import { ConfirmModal, EmptyState, List, ListRow, Money, MoneyInput, PageSkeleton, PlateText, SearchField } from '../../ui/components';
import { MonthField } from '../../ui/DateFields';
import { useAction, useLang } from '../../ui/hooks';
import { EntrySheet, INCOME_CATEGORIES, LinkPicker, type EntryPreset } from './MoneyEntry';
import { Proofs } from './Proofs';

type KindFilter = 'all' | 'in' | 'out';

/** Label of an entry's category, whatever its source. */
export function useCategoryLabel(cats: ExpenseCategory[] | undefined) {
  const { t } = useTranslation();
  const lang = useLang();
  return (e: LedgerEntry) => {
    if (e.source === 'payment') return t(e.category === 'refund' ? 'cashReason.refund' : e.category === 'prepayment' ? 'cashReason.prepayment' : 'ledger.cat.order');
    if (e.source === 'income') return t(`income.category.${e.category}`);
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
  const [k, setK] = useState<number | undefined>(card);
  return (
    <Modal opened={opened} onClose={onClose} title={t('ledger.opening')}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t('ledger.openingHint')}
        </Text>
        <SimpleGrid cols={2}>
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
          <MoneyInput label={t('ledger.cardStart')} value={k} onChange={setK} />
        </SimpleGrid>
        {cashLocked && (
          <Text size="xs" c="dimmed">
            {t('ledger.cashStartLocked')}
          </Text>
        )}
        <Button loading={busy} onClick={() => run(async () => { await setOpeningBalances(cashLocked ? cash : c ?? 0, k ?? 0); onClose(); }, 'common.saved')}>
          {t('common.save')}
        </Button>
      </Stack>
    </Modal>
  );
}

/**
 * An entry opened from the book: what it was for can be corrected, a money out takes proofs (photos);
 * a mistaken entry is cancelled.
 */
export function EntryDetails({ entry, label, onClose, cats }: { entry: LedgerEntry; label: string; onClose: () => void; cats?: ExpenseCategory[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [voiding, setVoiding] = useState(false);
  const editable = entry.source === 'income' || entry.source === 'expense';
  // An expense shows its vendor with the note; only the note itself is edited here.
  const typed = (entry.source === 'expense' ? entry.expenseNote : entry.note) ?? '';
  const [note, setNote] = useState(typed);
  const relink = (l: Links) =>
    run(() => (entry.source === 'income' ? updateIncome(entry.id, { orderId: l.orderId, vehicleId: l.vehicleId, customerId: l.customerId }) : updateExpense(entry.id, { orderId: l.orderId, vehicleId: l.vehicleId, customerId: l.customerId })));
  return (
    <Modal opened onClose={onClose} title={entry.vendor ? `${label} · ${entry.vendor}` : label}>
      <Stack gap="md">
        <Group justify="space-between" align="baseline">
          <Text fz={28} c={entry.kind === 'in' ? 'green.7' : 'red.7'}>
            <Money fils={entry.kind === 'in' ? entry.amountFils : -entry.amountFils} display />
          </Text>
          <Text size="sm" c="dimmed">
            {formatDate(entry.date)} · {entry.method ? t(`payment.method.${entry.method}`) : t('payment.method.cash')}
          </Text>
        </Group>
        {entry.source === 'expense' && entry.purse === 'card' && (
          <Text size="xs" c="dimmed">
            {t('ledger.cardOutHint')}
          </Text>
        )}
        {entry.closing && (
          <Text size="sm">
            {t('ledger.closingText', { actual: formatAed(entry.closing.actualFils), diff: formatAed(entry.closing.diffFils) })}
          </Text>
        )}
        {editable && entry.source === 'income' && (
          <div className="chip-row bleed">
            {INCOME_CATEGORIES.map((c) => (
              <button key={c} type="button" className="chip" data-active={entry.category === c} onClick={() => run(() => updateIncome(entry.id, { category: c as IncomeCategory }))}>
                {t(`income.category.${c}`)}
              </button>
            ))}
          </div>
        )}
        {editable && entry.source === 'expense' && (
          <div className="chip-row wrap">
            {(cats ?? []).filter((c) => c.active).map((c) => (
              <button key={c.id} type="button" className="chip" data-active={entry.category === c.id} onClick={() => run(() => updateExpense(entry.id, { categoryId: c.id }))}>
                {lang === 'ru' ? c.nameRu : c.nameEn}
              </button>
            ))}
          </div>
        )}
        {editable ? (
          <>
            <LinkPicker value={{ orderId: entry.orderId, vehicleId: entry.vehicleId, customerId: entry.customerId }} onChange={relink} />
            <TextInput
              label={t('ledger.note')}
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              onBlur={() => note !== typed && run(() => (entry.source === 'income' ? updateIncome(entry.id, { note }) : updateExpense(entry.id, { note })))}
            />
          </>
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
          {editable && (
            <Button variant="subtle" color="red" loading={busy} onClick={() => setVoiding(true)}>
              {t('ledger.void')}
            </Button>
          )}
        </Group>
        {!editable && entry.source === 'payment' && (
          <Text size="xs" c="dimmed">
            {t('ledger.paymentHint')}
          </Text>
        )}
      </Stack>
      <ConfirmModal
        opened={voiding}
        onClose={() => setVoiding(false)}
        title={t('ledger.voidTitle')}
        confirmLabel={t('ledger.void')}
        color="red"
        onConfirm={() =>
          run(async () => {
            if (entry.source === 'income') await voidIncome(entry.id);
            else await voidExpense(entry.id);
            onClose();
            return true;
          }, 'ledger.voided')
        }
      >
        <Text size="sm">{t(entry.purse === 'cash' ? 'ledger.voidTextCash' : 'ledger.voidText')}</Text>
      </ConfirmModal>
    </Modal>
  );
}

/**
 * The money book, as the garage kept it in its money sheet: cash and card balances with their
 * opening amounts, in/out of the month for each, and every entry with the balances after it.
 */
export function LedgerTab() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(monthKey());
  const [kind, setKind] = useState<KindFilter>('all');
  const [purse, setPurse] = useState<'all' | Purse>('all');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<EntryPreset | null>(null);
  const [opening, setOpening] = useState(false);
  const [opened, setOpen] = useState<Pick<LedgerEntry, 'id' | 'source'> | null>(null);
  const data = useLiveQuery(async () => {
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
      <SimpleGrid cols={2} spacing="sm">
        {(['cash', 'card'] as const).map((p) => (
          <UnstyledButton key={p} className="surface tap amount-cell" p="md" onClick={() => setOpening(true)} aria-label={t('ledger.opening')}>
            <div className="eyebrow">{t(p === 'cash' ? 'ledger.cashBalance' : 'ledger.cardBalance')}</div>
            <Text fz={26} lh={1.15} mt={4}>
              <Money fils={p === 'cash' ? book.cash : book.card} display />
            </Text>
            <Group gap={4} mt={6} c="dimmed">
              <Text size="xs" c="dimmed">
                {t('ledger.start')} {formatAed(p === 'cash' ? book.cashStartFils : book.cardStartFils)}
              </Text>
              <IconPencil size={12} />
            </Group>
          </UnstyledButton>
        ))}
      </SimpleGrid>

      <Group gap="sm" grow>
        <Button size="md" color="green" variant="light" leftSection={<IconArrowDownLeft size={20} />} onClick={() => setSheet({ kind: 'in' })}>
          {t('ledger.in')}
        </Button>
        <Button size="md" color="red" variant="light" leftSection={<IconArrowUpRight size={20} />} onClick={() => setSheet({ kind: 'out' })}>
          {t('ledger.out')}
        </Button>
      </Group>

      <Box className="surface" p="md">
        <Group justify="space-between" mb="sm" wrap="nowrap">
          <MonthField value={month} onChange={setMonth} />
        </Group>
        <SimpleGrid cols={2} spacing="md" verticalSpacing="sm">
          {(['cash', 'card'] as const).map((p) => (
            <Stack key={p} gap={4}>
              <Text size="sm" fw={600}>
                {t(`payment.method.${p}`)}
              </Text>
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {t('ledger.in')}
                </Text>
                <Money fils={totals[p].inFils} c="green.7" size="sm" />
              </Group>
              <Group justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {t('ledger.out')}
                </Text>
                <Money fils={totals[p].outFils} c="red.7" size="sm" />
              </Group>
            </Stack>
          ))}
        </SimpleGrid>
      </Box>

      {/* One row of filters — income or expenses, cash or card (a second tap takes one off) — and the search. */}
      <Stack gap="xs" maw={560}>
        <div className="chip-row wrap">
          {(['in', 'out'] as const).map((k) => (
            <button key={k} type="button" className="chip" data-active={kind === k} aria-pressed={kind === k} onClick={() => setKind(kind === k ? 'all' : k)}>
              {k === 'in' ? t('ledger.ins') : t('ledger.outs')}
            </button>
          ))}
          {(['cash', 'card'] as const).map((p) => (
            <button key={p} type="button" className="chip" data-active={purse === p} aria-pressed={purse === p} onClick={() => setPurse(purse === p ? 'all' : p)}>
              {t(`payment.method.${p}`)}
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
        [...days.entries()].map(([day, list]) => {
          const net = list.reduce((s, e) => s + (e.kind === 'in' ? e.amountFils : -e.amountFils), 0);
          return (
            <Box key={day}>
              <Group justify="space-between" px={4} mb={6}>
                <Text size="sm" fw={600} c="dimmed" className="tnum">
                  {formatDate(day)}
                </Text>
                <Text size="xs" fw={600} c={net >= 0 ? 'green.7' : 'red.7'} className="tnum">
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
                  const sub = [e.method ? t(`payment.method.${e.method}`) : '', o ? `№${o.number}` : '', who].filter(Boolean).join(' · ');
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
                        <Text span size="sm" fw={600} lineClamp={1}>
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
                          <Money fils={e.kind === 'in' ? e.amountFils : -e.amountFils} c={e.kind === 'in' ? 'green.7' : 'red.7'} size="sm" />
                          <Text size="10px" c="dimmed" className="tnum" style={{ whiteSpace: 'nowrap' }}>
                            {e.purse === 'cash' ? `${t('ledger.cashShort')} ${formatAed(e.cashAfter)}` : `${t('ledger.cardShort')} ${formatAed(e.cardAfter)}`}
                          </Text>
                        </Stack>
                      }
                    />
                  );
                })}
              </List>
            </Box>
          );
        })
      )}

      <EntrySheet opened={!!sheet} onClose={() => setSheet(null)} preset={sheet ?? undefined} />
      {opening && <OpeningSheet opened onClose={() => setOpening(false)} cash={book.cashStartFils} card={book.cardStartFils} cashLocked={book.cashStartLocked} />}
      {open && <EntryDetails entry={open} label={label(open)} cats={data.cats} onClose={() => setOpen(null)} />}
    </Stack>
  );
}
