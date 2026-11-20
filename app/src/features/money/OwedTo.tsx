import { Box, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { IconBuildingStore, IconPlus, IconSearch, IconUser, IconUserDollar } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nameKey } from '../../domain/drivers';
import { isPerson, pickKey, pickOf, type OwedPick } from '../../domain/lenders';
import { formatPhone } from '../../domain/phone';
import { owedChoices, owedOf, searchOwed, setOwedTo, updateLender } from '../../services/lenders';
import { FormRow, PersonAvatar, RowGroup } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';

/*
 * Whom the garage owes for an expense on credit (v0.61, the user: «когда делается расход в долг, важно указать, кому;
 * заказали запчасть, а заплатил не мы, а кто-то другой в долг — это нужно чётко обозначить»): the chips under «Кому
 * должны» — the seller first, then whom it owed lately (a person who paid for the garage, a supplier); «Найти» — the
 * people and the suppliers by name or phone, and a new person added with one tap. The same field in a new expense's
 * sheet, in an expense's own sheet and in a credit's sheet («Мы должны»).
 */

/** Whom a credit is owed to, inside a row: a person's mark and the name, orange — as the debt itself. */
export function OwedName({ name }: { name: string }) {
  return (
    <span className="owed-name" data-owed-to={name}>
      <IconUserDollar size={13} stroke={2.2} aria-hidden />
      <span className="owed-name-text">{name}</span>
    </span>
  );
}

/**
 * «Кому должны» and its chips: «Найти» first (in the accent, as a supplier's chips), the seller (when the expense has
 * one), whom the garage owed lately; the picked one is lit. Nothing picked — the label is orange: it is to be said.
 */
export function OwedToField({ value, onChange, seller, missing }: { value?: OwedPick; onChange: (p: OwedPick) => void; seller?: OwedPick; missing?: boolean }) {
  const { t } = useTranslation();
  const [finding, setFinding] = useState(false);
  const recent = useLiveQuery(() => owedChoices(8), []) ?? [];
  // The one owed when the sheet opened — first, seen at once; then the seller and the recent ones. One chip each; the
  // order stays as it is while chips are tapped (the picked one is lit, not moved).
  const [leadKey] = useState(() => (value ? pickKey(value) : ''));
  const seen = new Set<string>();
  const base = [seller, ...recent].filter((p): p is OwedPick => !!p && !seen.has(pickKey(p)) && !!seen.add(pickKey(p)));
  const lead = leadKey ? base.findIndex((p) => pickKey(p) === leadKey) : -1;
  const ordered = lead > 0 ? [base[lead], ...base.slice(0, lead), ...base.slice(lead + 1)] : base;
  const chips = value && !seen.has(pickKey(value)) ? [value, ...ordered] : ordered;
  const on = value ? pickKey(value) : '';
  return (
    <div data-owed-field data-missing={missing || undefined}>
      <Group gap={6} mb={6} wrap="nowrap">
        <IconUserDollar size={16} color={missing ? 'var(--mantine-color-orange-6)' : undefined} />
        <Text size="sm" fw={missing ? 600 : 500} c={missing ? 'orange.7' : undefined}>
          {t('owed.title')}
        </Text>
      </Group>
      <div className="chip-row" aria-label={t('owed.title')}>
        <button type="button" className="chip chip-find" onClick={() => setFinding(true)} data-owed-find>
          <IconSearch size={16} stroke={2.2} aria-hidden />
          {t('owed.find')}
        </button>
        {chips.map((p) => {
          const k = pickKey(p);
          const I = isPerson(p) ? IconUser : IconBuildingStore;
          return (
            <button key={k} type="button" className="chip chip-supplier" data-active={k === on} aria-pressed={k === on} data-owed-chip={p.name} onClick={() => onChange(p)}>
              <I size={15} stroke={2} aria-hidden />
              <span className="chip-name">{p.name}</span>
              {seller && k === pickKey(seller) && <span className="chip-note">{t('owed.seller')}</span>}
            </button>
          );
        })}
      </div>
      <SheetFor value={finding}>{(_, o) => <OwedFindSheet opened={o} onClose={() => setFinding(false)} onPick={(p) => (onChange(p), setFinding(false))} />}</SheetFor>
    </div>
  );
}

/**
 * Whom the garage owes, found by typing: the people who paid for it before, then the suppliers of the base (a part of a
 * name, or of a phone as it is said); a new person — his name (and phone, if known) and «Добавить».
 */
function OwedFindSheet({ opened, onClose, onPick }: { opened: boolean; onClose: () => void; onPick: (p: OwedPick) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const found = useLiveQuery(() => searchOwed(name.trim() || phone.trim(), 8), [name, phone]) ?? [];
  // A person of the list by exactly this name: picked, not added twice.
  const same = found.find((p) => p.kind === 'lender' && nameKey(p.name) === nameKey(name));
  return (
    <Modal opened={opened} onClose={onClose} title={t('owed.title')}>
      <Stack gap="md">
        <RowGroup mt={0}>
          <FormRow label={t('owed.name')}>
            <TextInput aria-label={`${t('owed.title')}: ${t('owed.name')}`} placeholder={t('owed.search')} value={name} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" autoCapitalize="words" data-autofocus w="100%" />
          </FormRow>
          <FormRow label={t('owed.phone')}>
            <TextInput aria-label={`${t('owed.title')}: ${t('owed.phone')}`} type="tel" inputMode="tel" placeholder="050 123 4567" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} autoComplete="off" w="100%" />
          </FormRow>
        </RowGroup>
        {found.length > 0 && (
          <Stack gap={8} aria-label={t('owed.find')}>
            {found.map((p) => (
              <button key={pickKey(p)} type="button" className="suggest rise-enter" data-owed-found={p.name} onClick={() => onPick(p)}>
                <PersonAvatar name={p.name} company={!isPerson(p)} size={32} />
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={600} lineClamp={1}>
                    {p.name}
                  </Text>
                  {p.phone && (
                    <Text size="xs" c="dimmed" className="tnum" lineClamp={1}>
                      {formatPhone(p.phone)}
                    </Text>
                  )}
                </Box>
                <Text size="sm" c="cobalt.6" fw={600} style={{ flexShrink: 0 }}>
                  {t('newOrder.useThis')}
                </Text>
              </button>
            ))}
          </Stack>
        )}
        {name.trim() && !same && (
          <Button size="lg" leftSection={<IconPlus size={20} />} data-owed-add onClick={() => onPick({ kind: 'new', name: name.replace(/\s+/g, ' ').trim(), phone: phone.trim() || undefined })}>
            {t('owed.add', { name: name.replace(/\s+/g, ' ').trim() })}
          </Button>
        )}
      </Stack>
    </Modal>
  );
}

/** «Кому должны» of an expense already made (its sheet, a credit's sheet): a tap on a chip — owed to that one from now on. */
export function ExpenseOwedTo({ expenseId }: { expenseId: string }) {
  const { run } = useAction();
  const data = useLiveQuery(async () => (await owedOf(expenseId)) ?? null, [expenseId]);
  if (!data) return null;
  const value = data.to ? pickOf(data.to) : undefined;
  return (
    <OwedToField
      value={value}
      seller={data.seller ? pickOf(data.seller) : undefined}
      missing={!value}
      onChange={(p) =>
        value && pickKey(p) === pickKey(value)
          ? undefined
          : run(async () => {
              await setOwedTo(expenseId, p);
              haptic('light');
            })
      }
    />
  );
}

/** A person the garage owes: his name and phone changed — «Мы должны», the book and the money sheet name him so. */
export function LenderSheet({ lender, opened, onClose }: { lender: { id: string; name: string; phone?: string }; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [name, setName] = useState(lender.name);
  const [phone, setPhone] = useState(lender.phone ? formatPhone(lender.phone) : '');
  return (
    <Modal opened={opened} onClose={onClose} title={t('owed.contact')}>
      <Stack gap="md">
        <RowGroup mt={0}>
          <FormRow label={t('owed.name')}>
            <TextInput aria-label={t('owed.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" autoCapitalize="words" w="100%" />
          </FormRow>
          <FormRow label={t('owed.phone')}>
            <TextInput aria-label={t('owed.phone')} type="tel" inputMode="tel" placeholder="050 123 4567" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} autoComplete="off" w="100%" />
          </FormRow>
        </RowGroup>
        <Button
          size="lg"
          loading={busy}
          disabled={!name.trim()}
          onClick={() =>
            run(async () => {
              await updateLender(lender.id, { name, phone });
              onClose();
            }, 'common.saved')
          }
        >
          {t('common.save')}
        </Button>
      </Stack>
    </Modal>
  );
}
