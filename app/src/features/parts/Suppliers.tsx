import { ActionIcon, Button, Group, Modal, SegmentedControl, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { IconBrandWhatsapp, IconFileSpreadsheet, IconMapPin, IconPhone, IconPlus, IconTruck } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { db, uid } from '../../db/db';
import { CAR_MAKES, canonicalMake, POPULAR_MAKES } from '../../domain/carCatalog';
import { formatPhone, normalizePhone } from '../../domain/phone';
import type { Supplier } from '../../domain/types';
import { whatsappUrl } from '../../services/messages';
import { importSuppliers, saveSupplier, setSupplierCard } from '../../services/parts';
import { EmptyState, FormRow, List, ListRow, SearchField } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { typedOnly, useAction } from '../../ui/hooks';
import { PhotoStrip } from '../../ui/PhotoStrip';
import { Autocomplete } from '@mantine/core';
import { notifications } from '@mantine/notifications';

/** A supplier's card as an iOS form: who, phone, makes, new or used, what they sell, contractor, card photos, map. */
export function SupplierSheet({ supplier, onClose }: { supplier: Partial<Supplier> | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [v, setV] = useState<Partial<Supplier>>({});
  const [make, setMake] = useState('');
  const [kept, setKept] = useState<string[]>([]);
  const [fresh, setFresh] = useState<{ id: string; file: File; src: string }[]>([]);
  useEffect(() => {
    setV(supplier ?? {});
    setMake('');
    setKept(supplier?.cardMediaIds ?? []);
    setFresh([]);
  }, [supplier]);
  if (!supplier) return null;
  const makes = v.makes ?? [];
  const toggleMake = (m: string) => setV({ ...v, makes: makes.includes(m) ? makes.filter((x) => x !== m) : [...makes, m] });
  const chips = [...new Set([...makes, ...POPULAR_MAKES])];
  const save = () =>
    run(async () => {
      const phone = v.phone?.trim() ? normalizePhone(v.phone) ?? v.phone.trim() : undefined;
      const s = await saveSupplier({ ...v, name: v.name ?? '', phone, makes: makes.length ? makes : undefined, parts: v.parts?.trim() || undefined, locationUrl: v.locationUrl?.trim() || undefined, notes: v.notes?.trim() || undefined });
      if (fresh.length || kept.length !== (supplier.cardMediaIds ?? []).length) await setSupplierCard(s.id, kept, fresh.map((f) => f.file));
      haptic('light');
      onClose();
    }, 'common.saved');
  return (
    <Modal opened onClose={onClose} title={supplier.id ? t('parts.editSupplier') : t('parts.addSupplier')} classNames={{ content: 'sheet-grouped' }}>
      <Stack gap="lg">
        <div className="ios-group">
          <div className="ios-row left line-name">
            <TextInput aria-label={t('suppliers.name')} placeholder={t('suppliers.name')} value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} w="100%" data-autofocus={!supplier.id || undefined} />
          </div>
          <FormRow label={t('customer.phone')}>
            <TextInput aria-label={t('customer.phone')} type="tel" placeholder="05X XXX XXXX" value={v.phone ?? ''} onChange={(e) => setV({ ...v, phone: e.currentTarget.value })} />
          </FormRow>
          <div className="ios-row">
            <SegmentedControl
              fullWidth
              style={{ flex: 1 }}
              aria-label={t('suppliers.condition')}
              value={v.condition ?? 'both'}
              onChange={(c) => setV({ ...v, condition: c as Supplier['condition'] })}
              data={(['new', 'used', 'both'] as const).map((c) => ({ value: c, label: t(`suppliers.cond.${c}`) }))}
            />
          </div>
          <FormRow label={t('suppliers.contractor')}>
            <Switch aria-label={t('suppliers.contractor')} checked={!!v.service} onChange={(e) => setV({ ...v, service: e.currentTarget.checked || undefined })} />
          </FormRow>
        </div>

        <div>
          <div className="group-title">{t('suppliers.makes')}</div>
          <div className="chip-row wrap" aria-label={t('suppliers.makes')}>
            {chips.map((m) => (
              <button key={m} type="button" className="chip" data-active={makes.includes(m)} onClick={() => toggleMake(m)}>
                {m}
              </button>
            ))}
          </div>
          <Autocomplete
            mt="sm"
            aria-label={t('suppliers.otherMake')}
            placeholder={t('suppliers.otherMake')}
            data={CAR_MAKES.filter((m) => !chips.includes(m))}
            filter={typedOnly}
            limit={6}
            value={make}
            onChange={setMake}
            onOptionSubmit={(m) => {
              toggleMake(canonicalMake(m));
              setTimeout(() => setMake(''), 0);
            }}
          />
        </div>

        <div className="ios-group">
          <div className="ios-row left">
            <Textarea aria-label={t('suppliers.parts')} placeholder={t('suppliers.partsHint')} autosize minRows={1} value={v.parts ?? ''} onChange={(e) => setV({ ...v, parts: e.currentTarget.value })} w="100%" />
          </div>
          <div className="ios-row left">
            <TextInput aria-label={t('parts.location')} placeholder={t('suppliers.mapHint')} value={v.locationUrl ?? ''} onChange={(e) => setV({ ...v, locationUrl: e.currentTarget.value })} w="100%" />
          </div>
          <div className="ios-row left">
            <Textarea aria-label={t('common.notes')} placeholder={t('common.notes')} autosize minRows={1} value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} w="100%" />
          </div>
        </div>

        <div>
          <div className="group-title">{t('suppliers.card')}</div>
          <PhotoStrip
            name="card"
            addLabel={t('suppliers.cardAdd')}
            photos={[...kept.map((id) => ({ id, removable: true })), ...fresh.map((p) => ({ id: p.id, src: p.src, removable: true }))]}
            onAdd={(files) => setFresh((f) => [...f, ...files.map((file) => ({ id: uid(), file, src: URL.createObjectURL(file) }))])}
            onRemove={(p) => (p.src ? setFresh((f) => f.filter((x) => x.id !== p.id)) : setKept((k) => k.filter((x) => x !== p.id)))}
          />
        </div>

        <Button size="lg" loading={busy} disabled={!v.name?.trim()} onClick={save}>
          {t('common.save')}
        </Button>
      </Stack>
    </Modal>
  );
}

/**
 * The supplier list: a search over names, makes and what they sell; a tap opens the card, the phone
 * and WhatsApp are one tap from the row; one's own list comes in from Excel or CSV.
 */
export function SuppliersTab() {
  const { t } = useTranslation();
  const { run } = useAction();
  const all = useLiveQuery(() => db.suppliers.filter((s) => !s.archivedAt).sortBy('name'), []);
  // Opened from the search: the supplier found is the one shown.
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  if (!all) return null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = all.filter((s) => {
    const hay = `${s.name} ${s.makes?.join(' ') ?? ''} ${s.parts ?? ''} ${s.address ?? ''} ${s.notes ?? ''} ${s.phone ?? ''} ${s.service ? t('suppliers.contractor') : ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const importFile = (file: File) =>
    run(async () => {
      const r = await importSuppliers(file);
      haptic('success');
      notifications.show({ color: 'green', message: t('suppliers.imported', { added: r.added, skipped: r.skipped }) });
    });
  return (
    <Stack gap="md">
      <Group gap={8} wrap="nowrap">
        <Button leftSection={<IconPlus size={18} />} onClick={() => setEdit({})} style={{ flex: 1 }} aria-label={t('parts.addSupplier')}>
          {t('suppliers.new')}
        </Button>
        <Button variant="default" leftSection={<IconFileSpreadsheet size={18} />} onClick={() => input.current?.click()} style={{ flex: 1 }}>
          {t('suppliers.import')}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          data-suppliers-input
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void importFile(f);
          }}
        />
      </Group>
      {(all.length > 6 || q) && <SearchField value={q} onChange={setQ} placeholder={t('suppliers.search')} />}
      {all.length === 0 ? (
        <EmptyState icon={IconTruck} title={t('parts.noSuppliers')} />
      ) : (
        <List>
          {list.map((s) => (
            <ListRow
              key={s.id}
              onClick={() => setEdit(s)}
              title={s.name}
              subtitle={[s.service ? t('suppliers.contractor') : s.condition ? t(`suppliers.cond.${s.condition}`) : '', s.makes?.join(', '), s.parts].filter(Boolean).join(' · ') || (s.phone ? formatPhone(s.phone) : undefined)}
              right={
                <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                  {s.locationUrl && (
                    <ActionIcon component="a" href={s.locationUrl} target="_blank" rel="noopener" variant="light" color="gray" size={36} radius="xl" aria-label={t('parts.map')} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      <IconMapPin size={18} />
                    </ActionIcon>
                  )}
                  {s.phone && (
                    <ActionIcon component="a" href={whatsappUrl(s.phone, '')} target="_blank" rel="noopener" variant="light" color="green" size={36} radius="xl" aria-label="WhatsApp" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      <IconBrandWhatsapp size={19} />
                    </ActionIcon>
                  )}
                  {s.phone && (
                    <ActionIcon component="a" href={`tel:${s.phone}`} variant="light" color="green" size={36} radius="xl" aria-label={t('customer.call')} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      <IconPhone size={18} />
                    </ActionIcon>
                  )}
                </Group>
              }
            />
          ))}
        </List>
      )}
      {list.length === 0 && all.length > 0 && (
        <Text c="dimmed" ta="center" size="sm">
          {t('suppliers.notFound')}
        </Text>
      )}
      <SupplierSheet supplier={edit} onClose={() => setEdit(null)} />
    </Stack>
  );
}
