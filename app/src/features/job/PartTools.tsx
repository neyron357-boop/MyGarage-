import { ActionIcon, Button, Group, Modal, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { IconMinus, IconPlus, IconSearch, IconSend } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { canonicalMake } from '../../domain/carCatalog';
import { formatPhone } from '../../domain/phone';
import type { Employee, OrderItem, Supplier, Vehicle } from '../../domain/types';
import { mediaBlob } from '../../services/media';
import { partRequestText, whatsappUrl } from '../../services/messages';
import { saveSupplier } from '../../services/parts';
import { copyText } from '../../ui/clipboard';
import { List, ListRow } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';

/** Suppliers for a car: those working with its make first, then the rest; contractors first when asked for. */
export function useSuppliers(make?: string, service?: boolean): Supplier[] {
  const all = useLiveQuery(() => db.suppliers.filter((s) => !s.archivedAt).toArray(), []) ?? [];
  return useMemo(() => {
    const m = make ? canonicalMake(make).toLowerCase() : '';
    const score = (s: Supplier) => (service !== undefined && !!s.service === service ? 0 : 2) + (m && s.makes?.some((x) => x.toLowerCase() === m) ? 0 : 1);
    return [...all].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
  }, [all, make, service]);
}

const CHIPS = 6;

/**
 * Who sells it (or does it): chips of the suppliers that fit the car first, the picked one always in
 * sight; "All" opens the whole list with a search and a quick new one (name and phone).
 */
export function SupplierChips({ value, onChange, make, service, label }: { value?: string; onChange: (id: string | undefined) => void; make?: string; service?: boolean; label?: string }) {
  const { t } = useTranslation();
  const list = useSuppliers(make, service);
  const [picker, setPicker] = useState(false);
  const shown = list.slice(0, CHIPS);
  const picked = value ? list.find((s) => s.id === value) : undefined;
  if (picked && !shown.includes(picked)) shown.unshift(picked);
  return (
    <>
      <div className="chip-row" aria-label={label ?? t('job.supplier')}>
        {shown.map((s) => (
          <button key={s.id} type="button" className="chip" data-active={value === s.id} onClick={() => onChange(value === s.id ? undefined : s.id)}>
            {s.name}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => setPicker(true)} aria-label={t('suppliers.all')}>
          {list.length > shown.length ? t('suppliers.allN', { n: list.length }) : <IconPlus size={16} stroke={2.2} style={{ verticalAlign: -3 }} />}
        </button>
      </div>
      <SupplierPicker opened={picker} onClose={() => setPicker(false)} list={list} service={service} onPick={(id) => (onChange(id), setPicker(false))} />
    </>
  );
}

function SupplierPicker({ opened, onClose, list, onPick, service }: { opened: boolean; onClose: () => void; list: Supplier[]; onPick: (id: string) => void; service?: boolean }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  useEffect(() => {
    if (opened) {
      setQ('');
      setName('');
      setPhone('');
    }
  }, [opened]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = list.filter((s) => {
    const hay = `${s.name} ${s.makes?.join(' ') ?? ''} ${s.parts ?? ''} ${s.address ?? ''} ${s.phone ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return (
    <Modal opened={opened} onClose={onClose} title={service ? t('suppliers.pickContractor') : t('suppliers.pick')}>
      <Stack gap="md">
        <TextInput aria-label={t('suppliers.search')} placeholder={t('suppliers.search')} leftSection={<IconSearch size={18} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        {found.length > 0 && (
          <List>
            {found.slice(0, 40).map((s) => (
              <ListRow
                key={s.id}
                title={s.name}
                subtitle={[s.makes?.join(', '), s.parts, s.phone && formatPhone(s.phone)].filter(Boolean).join(' · ') || undefined}
                onClick={() => onPick(s.id)}
              />
            ))}
          </List>
        )}
        <div>
          <div className="group-title">{t('suppliers.new')}</div>
          <div className="ios-group">
            <div className="ios-row left">
              <TextInput aria-label={t('suppliers.name')} placeholder={t('suppliers.name')} value={name || (found.length ? '' : q)} onChange={(e) => setName(e.currentTarget.value)} w="100%" />
            </div>
            <div className="ios-row left">
              <TextInput aria-label={t('customer.phone')} placeholder={t('customer.phone')} type="tel" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} w="100%" />
            </div>
          </div>
          <Button
            mt="sm"
            fullWidth
            variant="light"
            loading={busy}
            disabled={!(name || (found.length ? '' : q)).trim()}
            onClick={() =>
              run(async () => {
                const s = await saveSupplier({ name: name || q, phone: phone.trim() || undefined, service: service || undefined });
                onPick(s.id);
              })
            }
          >
            {t('suppliers.add')}
          </Button>
        </div>
      </Stack>
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
