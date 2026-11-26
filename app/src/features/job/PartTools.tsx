import { ActionIcon, Button, Group, Modal, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { IconCheck, IconMinus, IconPlus, IconSearch, IconSend } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { canonicalMake } from '../../domain/carCatalog';
import { formatPhone, normalizePhone } from '../../domain/phone';
import { looksLikePhone, supplierMatches } from '../../domain/suppliers';
import { starsOf } from '../../domain/supplierRank';
import { loadTop, TOP_TABLES } from '../../services/supplierRank';
import { useCalmQuery } from '../../ui/calmQuery';
import type { Employee, OrderItem, Supplier, Vehicle } from '../../domain/types';
import { mediaBlob } from '../../services/media';
import { partRequestText, whatsappUrl } from '../../services/messages';
import { copyText } from '../../ui/clipboard';
import { List, ListRow } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { SheetFor } from '../../ui/lazy';
import { useLongPress } from '../../ui/longPress';
import { SupplierSheet } from '../parts/Suppliers';

/** Suppliers for a car: those working with its make first, then the rest; contractors first when asked for. */
export function useSuppliers(make?: string, service?: boolean): Supplier[] {
  const all = useLiveQuery(() => db.suppliers.filter((s) => !s.archivedAt).toArray(), []) ?? [];
  // How many parts were bought from each (v0.38) — the index alone, not the lines.
  const bought = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const k of await db.items.where('supplierId').above('').keys()) m.set(String(k), (m.get(String(k)) ?? 0) + 1);
    return m;
  }, []);
  // The garage's main suppliers (v0.91.6): first of the chips, in their order.
  const top = useCalmQuery(TOP_TABLES, () => loadTop().then((x) => x.suppliers), []);
  return useMemo(() => {
    const m = make ? canonicalMake(make).toLowerCase() : '';
    const score = (s: Supplier) => (service !== undefined && !!s.service === service ? 0 : 2) + (m && s.makes?.some((x) => x.toLowerCase() === m) ? 0 : 1);
    const used = (s: Supplier) => (starsOf(s) ?? 3) * 1000 + Math.min(999, bought?.get(s.id) ?? 0);
    const rank = (s: Supplier) => top?.get(s.id) ?? Infinity;
    return [...all].sort((a, b) => rank(a) - rank(b) || score(a) - score(b) || used(b) - used(a) || a.name.localeCompare(b.name));
  }, [all, bought, make, service, top]);
}

const CHIPS = 6;

/**
 * Who sells it (or does it): chips of the suppliers that fit the car first, the picked one always in sight; a hold on
 * one (on a PC — a right click) opens its card — its number, WhatsApp, a name put right. "All" opens the whole list:
 * a search (a number too, as said here: 050…) and «＋ Новый» on top of it — the supplier's card, with the car's make
 * already on (v0.24).
 */
export function SupplierChips({ value, onChange, make, service, label }: { value?: string; onChange: (id: string | undefined) => void; make?: string; service?: boolean; label?: string }) {
  const { t } = useTranslation();
  const list = useSuppliers(make, service);
  const [picker, setPicker] = useState(false);
  const [card, setCard] = useState<Supplier | null>(null);
  // The one picked is in sight in the row (a new one comes first, the row may be scrolled to its end) — again when the
  // list has it (a new one is picked a moment before the list shows it).
  const row = useRef<HTMLDivElement>(null);
  const inList = !!value && list.some((s) => s.id === value);
  useEffect(() => {
    const on = row.current?.querySelector<HTMLElement>('[data-active="true"]');
    const r = row.current;
    if (!on || !r) return;
    const dx = on.getBoundingClientRect().left - r.getBoundingClientRect().left;
    if (dx < 0 || dx + on.offsetWidth > r.clientWidth) r.scrollTo({ left: Math.max(0, r.scrollLeft + dx - 16), behavior: 'smooth' });
  }, [value, inList]);
  // Work done outside, a service: the chips are those who do such work (a wash, a paint shop), not the parts
  // sellers — anyone is still in "All"; none yet — "+" adds one.
  const shown = (service ? list.filter((s) => !!s.service) : list).slice(0, CHIPS);
  const picked = value ? list.find((s) => s.id === value) : undefined;
  if (picked && !shown.includes(picked)) shown.unshift(picked);
  return (
    <>
      {/* v0.32: the search first — a tap, a name (or a number) typed, picked; a new one at the top of its list. Then the
          picked one and the usual ones, each name cut to a chip's width. */}
      <div className="chip-row" ref={row} aria-label={label ?? t('job.supplier')}>
        <button type="button" className="chip chip-find" onClick={() => setPicker(true)} aria-label={t('suppliers.all')}>
          <IconSearch size={16} stroke={2.2} aria-hidden />
          {t('suppliers.find')}
        </button>
        {shown.map((s) => (
          <SupplierChip key={s.id} s={s} on={value === s.id} onTap={() => onChange(value === s.id ? undefined : s.id)} onHold={() => setCard(s)} />
        ))}
      </div>
      <SupplierPicker opened={picker} onClose={() => setPicker(false)} list={list} service={service} make={make} onPick={(id) => (onChange(id), setPicker(false))} />
      <SheetFor value={card}>{(s, o) => <SupplierSheet opened={o} supplier={s} onClose={() => setCard(null)} />}</SheetFor>
    </>
  );
}

function SupplierChip({ s, on, onTap, onHold }: { s: Supplier; on: boolean; onTap: () => void; onHold: () => void }) {
  const press = useLongPress(onHold);
  return (
    <button type="button" className="chip chip-supplier" data-active={on} data-supplier={s.id} title={s.name} {...press.handlers} onClick={() => !press.consumeClick() && onTap()}>
      {on && <IconCheck size={15} stroke={2.6} aria-hidden />}
      <span className="chip-name">{s.name}</span>
    </button>
  );
}

function SupplierPicker({ opened, onClose, list, onPick, service, make }: { opened: boolean; onClose: () => void; list: Supplier[]; onPick: (id: string) => void; service?: boolean; make?: string }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<Partial<Supplier> | null>(null);
  useEffect(() => {
    if (opened) setQ('');
  }, [opened]);
  const typed = q.trim();
  const found = typed ? list.filter((s) => supplierMatches(s, typed, s.service ? t('suppliers.contractor') : '')) : list;
  // Not in the base by that name: added as it is typed (a number — as its phone); the car's make is on already.
  const named = found.some((s) => s.name.trim().toLowerCase() === typed.toLowerCase());
  const add = () =>
    setAdding({
      ...(looksLikePhone(typed) ? { phone: typed } : typed ? { name: typed } : {}),
      makes: make && !service ? [canonicalMake(make)] : undefined,
      service: service || undefined,
    });
  return (
    <Modal opened={opened} onClose={onClose} title={service ? t('suppliers.pickContractor') : t('suppliers.pick')}>
      <Stack gap="md">
        <TextInput aria-label={t('suppliers.search')} placeholder={t('suppliers.search')} leftSection={<IconSearch size={18} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} data-autofocus />
        <List>
          {!named && (
            <ListRow
              onClick={add}
              left={
                <span className="row-icon" style={{ background: 'var(--mantine-color-cobalt-6)' }} aria-hidden>
                  <IconPlus size={18} stroke={2.2} />
                </span>
              }
              title={
                <Text span inherit fw={600} c="cobalt.6">
                  {typed ? t('suppliers.addNamed', { name: typed }) : t('suppliers.addNew')}
                </Text>
              }
            />
          )}
          {found.slice(0, 40).map((s) => (
            <ListRow
              key={s.id}
              title={s.name}
              subtitle={[s.makes?.join(', '), s.parts, s.phone && formatPhone(normalizePhone(s.phone) ?? s.phone)].filter(Boolean).join(' · ') || undefined}
              onClick={() => onPick(s.id)}
            />
          ))}
        </List>
      </Stack>
      <SheetFor value={adding}>
        {(s, o) => (
          <SupplierSheet
            opened={o}
            supplier={s}
            onClose={() => setAdding(null)}
            onSaved={(x) => onPick(x.id)}
            onExisting={(x) => {
              setAdding(null);
              onPick(x.id);
            }}
          />
        )}
      </SheetFor>
    </Modal>
  );
}

/**
 * "Request" for a part: the car with its VIN and the part (in English) with its photos — through the
 * phone's share sheet to any chat (several sellers, one after another); to the picked supplier's WhatsApp
 * when the photos cannot go; or copied.
 */
export function RequestButton({ vehicle, item, supplierId, photoIds }: { vehicle: Vehicle; item: Pick<OrderItem, 'titleEn' | 'titleRu' | 'partNumber' | 'qty'>; supplierId?: string; photoIds: string[] }) {
  const { t } = useTranslation();
  const supplier = useLiveQuery(() => (supplierId ? db.suppliers.get(supplierId) : undefined), [supplierId]);
  const [files, setFiles] = useState<File[]>([]);
  const key = photoIds.join(',');
  useEffect(() => {
    let alive = true;
    void Promise.all(photoIds.map(async (id, n) => {
      const b = await mediaBlob(id);
      return b ? new File([b], `part-${n + 1}.jpg`, { type: b.type || 'image/jpeg' }) : undefined;
    })).then((l) => alive && setFiles(l.filter((f): f is File => !!f)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const text = partRequestText(vehicle, item);
  const send = async () => {
    haptic('light');
    if (typeof navigator.share === 'function') {
      const data: ShareData = files.length && navigator.canShare?.({ files }) ? { files, text } : { text };
      try {
        await navigator.share(data);
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    if (supplier?.phone) {
      window.open(whatsappUrl(supplier.phone, text), '_blank', 'noopener');
      return;
    }
    if (await copyText(text)) haptic('selection');
  };
  return (
    <Button variant="light" leftSection={<IconSend size={18} />} disabled={!(item.titleEn || item.titleRu)} onClick={() => void send()}>
      {files.length ? t('parts.requestPhotos', { n: files.length }) : t('parts.request')}
    </Button>
  );
}

/** How many came of several ordered: − 1 of 2 +. */
export function ReceivedStepper({ value, of, onChange }: { value: number; of: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  return (
    <Group gap={6} wrap="nowrap" className="qty-stepper">
      <ActionIcon variant="light" color="gray" size={36} radius="xl" aria-label="−" disabled={value <= 0} onClick={() => onChange(value - 1)}>
        <IconMinus size={18} />
      </ActionIcon>
      <Text fw={600} className="tnum" miw={64} ta="center">
        {t('parts.nOf', { n: value, of })}
      </Text>
      <ActionIcon variant="light" color="gray" size={36} radius="xl" aria-label="+" disabled={value >= of} onClick={() => onChange(value + 1)}>
        <IconPlus size={18} />
      </ActionIcon>
    </Group>
  );
}

/** Who does a line: the mechanics as chips (only when there is more than one to choose from). */
export function WhoChips({ value, onChange }: { value?: string; onChange: (id: string | undefined) => void }) {
  const { t } = useTranslation();
  const staff = useLiveQuery(() => db.employees.filter((e) => e.active).toArray(), []) ?? [];
  if (staff.length < 2) return null;
  return (
    <div>
      <div className="group-title">{t('job.who')}</div>
      <div className="chip-row wrap" aria-label={t('job.who')}>
        {staff.map((e: Employee) => (
          <button key={e.id} type="button" className="chip" data-active={value === e.id} onClick={() => onChange(value === e.id ? undefined : e.id)}>
            {e.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** When work outside is due back, or a part arrives: today, tomorrow, in two days, in a week. */
export const DAY_CHOICES = [0, 1, 2, 7] as const;

export function DaysChips({ value, onChange, label }: { value?: number; onChange: (d: number | undefined) => void; label: string }) {
  const { t } = useTranslation();
  return (
    <div className="chip-row wrap" aria-label={label}>
      {DAY_CHOICES.map((d) => (
        <button key={d} type="button" className="chip" data-active={value === d} onClick={() => onChange(value === d ? undefined : d)}>
          {t(`offer.days${d}`)}
        </button>
      ))}
    </div>
  );
}

export function KindSegment({ value, onChange }: { value: 'oem' | 'aftermarket' | 'used'; onChange: (k: 'oem' | 'aftermarket' | 'used') => void }) {
  const { t } = useTranslation();
  return <SegmentedControl fullWidth value={value} onChange={(v) => onChange(v as never)} data={(['oem', 'aftermarket', 'used'] as const).map((k) => ({ value: k, label: t(`offer.${k}`) }))} />;
}
