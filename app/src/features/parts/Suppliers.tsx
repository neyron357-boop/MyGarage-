import { ActionIcon, Button, Group, Loader, Modal, SegmentedControl, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { IconBrandWhatsapp, IconMapPin, IconPhone, IconPlus, IconStar, IconStarFilled, IconTruck } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { db, uid } from '../../db/db';
import { CAR_MAKES, canonicalMake, POPULAR_MAKES } from '../../domain/carCatalog';
import { formatPhone, normalizePhone } from '../../domain/phone';
import { alreadyInBase, cardName, phonesInText, supplierMatches } from '../../domain/suppliers';
import { starsOf, useOf, type SupplierKnow } from '../../domain/supplierRank';
import { dayShort } from '../../domain/dates';
import { suppliersRanked } from '../../services/supplierRank';
import { replyTime } from '../whatsapp/WaParts';
import { StarsPill } from '../job/SupplierAsk';
import type { Supplier } from '../../domain/types';
import { supplierChatLink } from '../../domain/supplierBook';
import { whatsappUrl } from '../../services/messages';
import { saveSupplier, setSupplierCard } from '../../services/parts';
import { ContactTiles, EmptyState, FormRow, List, ListRow, SearchField } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { typedOnly, useAction, useLang, usePhone, useScreenLiveQuery } from '../../ui/hooks';
import { DataTable, type Column } from '../../ui/DataTable';
import { SheetFor } from '../../ui/lazy';
import { useMoreRows } from '../../ui/moreRows';
import { PhotoStrip } from '../../ui/PhotoStrip';
import { SupplierBookActions } from './SupplierBookActions';
import { partsType } from '../../domain/supplierTidy';
import { emirateName, NO_REGION, regionLabel, SupplierFilters, useSupplierFilter } from './SupplierFilters';
import { Autocomplete } from '@mantine/core';

/**
 * A supplier's card as an iOS form: who, phone, new or used, contractor, the business card, makes, what they sell, map,
 * notes. Adding one (v0.24): the card photographed reads its number (and its name) by itself — several numbers are
 * offered as chips; one already in the base (the same number, the same name) is offered instead of a second one;
 * the number is kept as E.164. An existing one has its WhatsApp, Telegram and call on top.
 */
export function SupplierSheet({
  supplier,
  onClose,
  opened = true,
  onSaved,
  onExisting,
}: {
  supplier: Partial<Supplier> | null;
  onClose: () => void;
  opened?: boolean;
  /** Saved: the supplier as it is now (a new one picked by the sheet that opened this one). */
  onSaved?: (s: Supplier) => void;
  /** The one already in the base tapped instead (else it opens here). */
  onExisting?: (s: Supplier) => void;
}) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [v, setV] = useState<Partial<Supplier>>({});
  const [make, setMake] = useState('');
  const [kept, setKept] = useState<string[]>([]);
  const [fresh, setFresh] = useState<{ id: string; file: File; src: string }[]>([]);
  const [reading, setReading] = useState(false);
  const [found, setFound] = useState<string[]>([]);
  const all = useLiveQuery(() => db.suppliers.toArray(), []);
  // What was bought from it (v0.38): its jobs, parts, returns, the last time — on its card.
  const ranked = useLiveQuery(() => (supplier?.id ? suppliersRanked() : undefined), [supplier?.id]);
  const use = supplier?.id && ranked ? useOf(ranked.use, supplier.id) : undefined;
  const know = supplier?.id ? ranked?.know.get(supplier.id) : undefined;
  useEffect(() => {
    // Its number as it is read out: «+971 50 765 4321» (kept as E.164).
    setV(supplier?.phone ? { ...supplier, phone: formatPhone(normalizePhone(supplier.phone) ?? supplier.phone) } : supplier ?? {});
    setMake('');
    setKept(supplier?.cardMediaIds ?? []);
    setFresh([]);
    setFound([]);
  }, [supplier]);
  if (!supplier) return null;
  const makes = v.makes ?? [];
  const toggleMake = (m: string) => setV({ ...v, makes: makes.includes(m) ? makes.filter((x) => x !== m) : [...makes, m] });
  const chips = [...new Set([...makes, ...POPULAR_MAKES])];
  // The one already in the base this new one would be (its number, its name).
  const twin = !v.id && all ? alreadyInBase(all, v) : undefined;
  const openTwin = (s: Supplier) => {
    if (onExisting) return onExisting(s);
    setV(s.phone ? { ...s, phone: formatPhone(normalizePhone(s.phone) ?? s.phone) } : s);
    setKept(s.cardMediaIds ?? []);
    setFound([]);
  };
  /** The card photographed: its number and name, where they are not typed yet (several numbers — chips to pick). */
  const readCard = async (file: File) => {
    if (v.phone?.trim() && v.name?.trim()) return;
    setReading(true);
    try {
      const { readCardLines } = await import('../../services/vinReader');
      const lines = await readCardLines(file);
      const phones = phonesInText(lines.map((l) => l.text).join('\n'));
      const name = cardName(lines);
      setV((cur) => ({ ...cur, phone: cur.phone?.trim() || !phones[0] ? cur.phone : formatPhone(phones[0]), name: cur.name?.trim() || !name ? cur.name : name }));
      setFound(phones.length > 1 ? phones : []);
      if (phones.length || name) haptic('success');
    } catch (e) {
      console.error(e);
    } finally {
      setReading(false);
    }
  };
  const save = () =>
    run(async () => {
      const phone = v.phone?.trim() ? normalizePhone(v.phone) ?? v.phone.trim() : undefined;
      const s = await saveSupplier({ ...v, name: v.name ?? '', phone, makes: makes.length ? makes : undefined, parts: v.parts?.trim() || undefined, locationUrl: v.locationUrl?.trim() || undefined, notes: v.notes?.trim() || undefined });
      if (fresh.length || kept.length !== (v.cardMediaIds ?? []).length) await setSupplierCard(s.id, kept, fresh.map((f) => f.file));
      haptic('light');
      setV((cur) => ({ ...cur, id: s.id }));
      onSaved?.(s);
      onClose();
    }, 'common.saved');
  const typed = v.phone?.trim() ? normalizePhone(v.phone) : null;
  const chat = v.id ? supplierChatLink(v) : undefined;
  return (
    <Modal opened={opened} onClose={onClose} title={v.id ? t('parts.editSupplier') : t('parts.addSupplier')} classNames={{ content: 'sheet-grouped' }}>
      <Stack gap="lg">
        {v.id && (v.phone || chat) && <ContactTiles phone={v.phone ? typed ?? v.phone : ''} whatsappHref={chat} />}
        {use && use.jobs > 0 && (
          <div className="supplier-stats" data-supplier-stats>
            <span>
              <b className="tnum">{use.jobs}</b> {t('suppliers.statJobs', { count: use.jobs })}
            </span>
            <span>
              <b className="tnum">{use.lines}</b> {t('suppliers.statParts', { count: use.lines })}
            </span>
            {use.returns > 0 && (
              <span>
                <b className="tnum">{use.returns}</b> {t('suppliers.statReturns', { count: use.returns })}
              </span>
            )}
            {use.lastAt && (
              <span>
                <b>{dayShort(use.lastAt).word ? t(`common.${dayShort(use.lastAt).word}`) : dayShort(use.lastAt).text}</b>
              </span>
            )}
          </div>
        )}
        {/* What its WhatsApp chat taught (v0.91): how it answers the garage's requests. */}
        {know && know.seen.turns + know.seen.open > 0 && (
          <div className="supplier-stats" data-supplier-wa>
            <StarsPill s={{}} know={know} />
            <span>
              <b className="tnum">{know.seen.turns + know.seen.open}</b> {t('suppliers.statAsked')}
            </span>
            <span>
              <b className="tnum">{know.seen.answered}</b> {t('suppliers.statAnswered')}
            </span>
            {know.seen.priced > 0 && (
              <span>
                <b className="tnum">{know.seen.priced}</b> {t('suppliers.statPriced')}
              </span>
            )}
            {know.seen.na > 0 && (
              <span>
                <b className="tnum">{know.seen.na}</b> {t('suppliers.statNa')}
              </span>
            )}
            {know.seen.replyMin !== undefined && (
              <span>
                ~<b className="tnum">{replyTime(t, know.seen.replyMin)}</b>
              </span>
            )}
          </div>
        )}
        <div className="ios-group">
          <div className="ios-row left line-name">
            <TextInput aria-label={t('suppliers.name')} placeholder={t('suppliers.name')} value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} w="100%" data-autofocus={(!v.id && !v.phone) || undefined} />
          </div>
          {/* The name as it came, in Arabic (v0.60: put in English by the app). */}
          {v.nameAr && (
            <div className="supplier-name-ar" dir="rtl" data-name-ar>
              {v.nameAr}
            </div>
          )}
          <FormRow label={t('customer.phone')}>
            <TextInput
              aria-label={t('customer.phone')}
              type="tel"
              placeholder="05X XXX XXXX"
              value={v.phone ?? ''}
              onChange={(e) => setV({ ...v, phone: e.currentTarget.value })}
              rightSection={reading ? <Loader size={16} /> : undefined}
            />
          </FormRow>
          {found.length > 1 && (
            <div className="ios-row">
              <div className="chip-row wrap" aria-label={t('suppliers.card')} data-card-phones>
                {found.map((p) => (
                  <button key={p} type="button" className="chip" data-active={typed === p} onClick={() => setV({ ...v, phone: formatPhone(p) })}>
                    {formatPhone(p)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="ios-row">
            <SegmentedControl
              fullWidth
              style={{ flex: 1 }}
              aria-label={t('suppliers.condition')}
              value={v.condition ?? partsType({ ...supplier, name: supplier.name ?? '' }) ?? 'both'}
              onChange={(c) => setV({ ...v, condition: c as Supplier['condition'] })}
              data={(['new', 'used', 'both'] as const).map((c) => ({ value: c, label: t(`suppliers.cond.${c}`) }))}
            />
          </div>
          <FormRow label={t('suppliers.contractor')}>
            <Switch aria-label={t('suppliers.contractor')} checked={!!v.service} onChange={(e) => setV({ ...v, service: e.currentTarget.checked || undefined })} />
          </FormRow>
          {/* The manager's stars (v0.38): a tap — that many, the same star again — none. */}
          <FormRow label={t('suppliers.rating')}>
            <div className="star-row" role="radiogroup" aria-label={t('suppliers.rating')}>
              {[1, 2, 3, 4, 5].map((n) => {
                const on = (starsOf(v) ?? 0) >= n;
                return (
                  <button key={n} type="button" className="star-btn" role="radio" aria-checked={starsOf(v) === n} aria-label={`${n}`} data-on={on || undefined} onClick={() => setV({ ...v, reliability: starsOf(v) === n ? undefined : n })}>
                    {on ? <IconStarFilled size={24} aria-hidden /> : <IconStar size={24} stroke={1.7} aria-hidden />}
                  </button>
                );
              })}
            </div>
          </FormRow>
        </div>

        {twin && (
          <button type="button" className="suggest" data-twin={twin.id} onClick={() => openTwin(twin)}>
            <IconTruck size={20} stroke={1.8} aria-hidden />
            <span style={{ minWidth: 0 }}>
              <Text span fw={600} c="cobalt.6">
                {t('suppliers.already')}
              </Text>
              <Text span>{` · ${twin.name}`}</Text>
              {twin.phone && (
                <Text span c="dimmed">
                  {` · ${formatPhone(normalizePhone(twin.phone) ?? twin.phone)}`}
                </Text>
              )}
            </span>
          </button>
        )}

        <div>
          <div className="group-title">{t('suppliers.card')}</div>
          <PhotoStrip
            name="card"
            addLabel={t('suppliers.cardAdd')}
            photos={[...kept.map((id) => ({ id, removable: true })), ...fresh.map((p) => ({ id: p.id, src: p.src, removable: true }))]}
            onAdd={(files) => {
              setFresh((f) => [...f, ...files.map((file) => ({ id: uid(), file, src: URL.createObjectURL(file) }))]);
              if (files[0]) void readCard(files[0]);
            }}
            onRemove={(p) => (p.src ? setFresh((f) => f.filter((x) => x.id !== p.id)) : setKept((k) => k.filter((x) => x !== p.id)))}
          />
        </div>

        <div>
          <div className="group-title">
            {t('suppliers.makes')}
            {supplier.guessed?.includes('makes') && JSON.stringify(makes) === JSON.stringify(supplier.makes ?? []) && <span className="guess-mark">{t('suppliers.guessed')}</span>}
          </div>
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
            <Textarea
              aria-label={t('suppliers.parts')}
              placeholder={t('suppliers.partsHint')}
              autosize
              minRows={1}
              value={v.parts ?? ''}
              onChange={(e) => setV({ ...v, parts: e.currentTarget.value })}
              w="100%"
              rightSectionWidth={96}
              rightSection={supplier.guessed?.includes('parts') && v.parts === supplier.parts ? <span className="guess-mark" data-guessed="parts">{t('suppliers.guessed')}</span> : undefined}
            />
          </div>
          <div className="ios-row left">
            <TextInput aria-label={t('parts.location')} placeholder={t('suppliers.mapHint')} value={v.locationUrl ?? ''} onChange={(e) => setV({ ...v, locationUrl: e.currentTarget.value })} w="100%" />
          </div>
          <div className="ios-row left">
            <Textarea aria-label={t('common.notes')} placeholder={t('common.notes')} autosize minRows={1} value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} w="100%" />
          </div>
        </div>

        <Button size="lg" loading={busy} disabled={!v.name?.trim()} onClick={save}>
          {t('common.save')}
        </Button>
      </Stack>
    </Modal>
  );
}

/**
 * A supplier's row on the phone (v0.60.1): drawn again only when its supplier, area or jobs change — a list of a thousand
 * drawn as it is scrolled does not draw the rows above again each time it grows.
 */
const SupplierRow = memo(function SupplierRow({ s, area, jobs, know, onOpen }: { s: Supplier; area?: string; jobs: number; know?: SupplierKnow; onOpen: (s: Supplier) => void }) {
  const { t } = useTranslation();
  return (
    <ListRow
      onClick={() => onOpen(s)}
      title={
        <span className="supplier-name">
          <span className="supplier-name-text">{s.name}</span>
          <StarsPill s={s} know={know} />
        </span>
      }
      subtitle={
        [
          area ?? '',
          jobs ? t('suppliers.jobs', { count: jobs }) : '',
          s.service ? t('suppliers.contractor') : partsType(s) ? t(`suppliers.cond.${partsType(s)}`) : '',
          s.makes?.join(', '),
          s.parts,
        ]
          .filter(Boolean)
          .join(' · ') || (s.phone ? formatPhone(s.phone) : undefined)
      }
      right={
        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
          {s.locationUrl && (
            <ActionIcon component="a" href={s.locationUrl} target="_blank" rel="noopener" variant="light" color="gray" size={36} radius="xl" aria-label={t('parts.map')} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <IconMapPin size={18} />
            </ActionIcon>
          )}
          {(s.phone || supplierChatLink(s)) && (
            <ActionIcon component="a" href={supplierChatLink(s) ?? whatsappUrl(s.phone!, '')} target="_blank" rel="noopener" variant="light" color="green" size={36} radius="xl" aria-label="WhatsApp" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
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
  );
});

/**
 * The supplier list: a search over names, makes and what they sell; a tap opens the card, the phone
 * and WhatsApp are one tap from the row; one's own list comes in from Excel or CSV. The most used and best rated first
 * (v0.38), each with its stars and how many jobs it supplied.
 */
export function SuppliersTab() {
  const { t } = useTranslation();
  const ranked = useScreenLiveQuery(suppliersRanked, []);
  const all = ranked?.list;
  // Opened from the search: the supplier found is the one shown.
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const phone = usePhone();
  const lang = useLang();
  const filter = useSupplierFilter(all);
  // Found by its name, makes, what it sells — or its number as said here (050…); by region, make and kind (v0.60).
  const list = (all ?? []).filter((s) => filter.pass(s) && supplierMatches(s, q, s.service ? t('suppliers.contractor') : ''));
  const regionOfS = (s: Supplier) => filter.facts.regions.get(s.id);
  // On the phone the list goes by emirate, the most suppliers first (an emirate picked — that one alone).
  const grouped = (() => {
    if (filter.f.region) return [{ key: filter.f.region, rows: list }];
    const by = new Map<string, Supplier[]>();
    for (const s of list) {
      const k = regionOfS(s)?.emirate ?? NO_REGION;
      const g = by.get(k);
      if (g) g.push(s);
      else by.set(k, [s]);
    }
    return [...by.entries()].sort((a, b) => (a[0] === NO_REGION ? 1 : b[0] === NO_REGION ? -1 : b[1].length - a[1].length)).map(([key, rows]) => ({ key, rows }));
  })();
  // v0.60.1 (1000+ suppliers made the screen hang): the rows drawn as the list is scrolled — the first thirty at once.
  const shown = useMoreRows(list.length, `${q}|${filter.f.region}|${filter.f.area}|${filter.f.make}|${filter.f.type}`);
  let room = shown.limit;
  const groups = grouped
    .map((g) => {
      const rows = g.rows.slice(0, Math.max(0, room));
      room -= rows.length;
      return { key: g.key, total: g.rows.length, rows };
    })
    .filter((g) => g.rows.length);
  if (!all) return null;
  const contact = (s: Supplier, size: number) => (
    <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
      {s.locationUrl && (
        <ActionIcon component="a" href={s.locationUrl} target="_blank" rel="noopener" variant="light" color="gray" size={size} radius="xl" aria-label={t('parts.map')} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <IconMapPin size={18} />
        </ActionIcon>
      )}
      {(s.phone || supplierChatLink(s)) && (
        <ActionIcon component="a" href={supplierChatLink(s) ?? whatsappUrl(s.phone!, '')} target="_blank" rel="noopener" variant="light" color="green" size={size} radius="xl" aria-label="WhatsApp" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <IconBrandWhatsapp size={19} />
        </ActionIcon>
      )}
      {s.phone && (
        <ActionIcon component="a" href={`tel:${s.phone}`} variant="light" color="green" size={size} radius="xl" aria-label={t('customer.call')} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <IconPhone size={18} />
        </ActionIcon>
      )}
    </Group>
  );
  // On a PC (v0.41): a table — the best first as on the phone (the ranking), or by a column clicked.
  const cols: Column<Supplier>[] = [
    {
      key: 'name',
      label: t('desk.col.supplier'),
      sort: (s) => s.name.toLowerCase(),
      cell: (s) => (
        <span className="supplier-name">
          <span className="supplier-name-text dt-main">{s.name}</span>
          <StarsPill s={s} know={ranked?.know.get(s.id)} />
        </span>
      ),
    },
    { key: 'phone', label: t('desk.col.phone'), cell: (s) => (s.phone ? formatPhone(s.phone) : ''), sort: (s) => s.phone ?? '', muted: true, nowrap: true, width: 180 },
    { key: 'region', label: t('suppliers.region'), cell: (s) => <span className="dt-clip">{regionLabel(regionOfS(s), lang)}</span>, sort: (s) => regionLabel(regionOfS(s), lang) || '~', muted: true, width: 220 },
    { key: 'makes', label: t('desk.col.makes'), cell: (s) => <span className="dt-clip">{s.service ? t('suppliers.contractor') : s.makes?.join(', ')}</span>, sort: (s) => (s.service ? t('suppliers.contractor') : s.makes?.join(', ') ?? '') },
    { key: 'parts', label: t('desk.col.part'), cell: (s) => <span className="dt-clip">{s.parts}</span>, sort: (s) => s.parts ?? '', muted: true },
    { key: 'jobs', label: t('desk.col.jobs'), cell: (s) => useOf(ranked!.use, s.id).jobs || '', sort: (s) => useOf(ranked!.use, s.id).jobs, desc: true, align: 'right', width: 100 },
    { key: 'contact', label: '', cell: (s) => contact(s, 34), align: 'right', width: 150 },
  ];
  return (
    <Stack gap="md">
      {phone ? (
        <>
          <Group gap={8} wrap="nowrap">
            <Button leftSection={<IconPlus size={18} />} onClick={() => setEdit({})} style={{ flex: 1 }} aria-label={t('parts.addSupplier')}>
              {t('suppliers.new')}
            </Button>
            <SupplierBookActions />
          </Group>
          {(all.length > 6 || q) && <SearchField value={q} onChange={setQ} placeholder={t('suppliers.search')} />}
        </>
      ) : (
        // A PC (v0.72): one row of tools over the table — the search at its start, the buttons as wide as their words
        // at its end, the main one last (not two buttons across half the window).
        <div className="desk-toolrow">
          {(all.length > 6 || q) && (
            <div className="desk-toolrow-search">
              <SearchField value={q} onChange={setQ} placeholder={t('suppliers.search')} />
            </div>
          )}
          <div className="desk-toolrow-end">
            <SupplierBookActions />
            <Button leftSection={<IconPlus size={18} />} onClick={() => setEdit({})} aria-label={t('parts.addSupplier')}>
              {t('suppliers.new')}
            </Button>
          </div>
        </div>
      )}
      {all.length > 6 && <SupplierFilters all={all} api={filter} />}
      {all.length === 0 ? (
        <EmptyState icon={IconTruck} title={t('parts.noSuppliers')} />
      ) : !phone ? (
        list.length > 0 && <DataTable rows={list} columns={cols} rowKey={(s) => s.id} onRow={setEdit} initialSort={{ key: 'rank', dir: 1 }} label={t('nav.suppliers')} page />
      ) : (
        groups.map((g) => (
          <div key={g.key} className="supplier-group" data-region={g.key}>
            <div className="group-title">
              {g.key === NO_REGION ? t('suppliers.noRegion') : emirateName(g.key, lang)}
              <span className="count">{g.total}</span>
            </div>
        <List>
          {g.rows.map((s) => (
            <SupplierRow key={s.id} s={s} area={regionOfS(s)?.area} jobs={useOf(ranked!.use, s.id).jobs} know={ranked!.know.get(s.id)} onOpen={setEdit} />
          ))}
        </List>
          </div>
        ))
      )}
      {phone && shown.more()}
      {list.length === 0 && all.length > 0 && (
        <Text c="dimmed" ta="center" size="sm">
          {t('suppliers.notFound')}
        </Text>
      )}
      <SheetFor value={edit}>{(s, o) => <SupplierSheet opened={o} supplier={s} onClose={() => setEdit(null)} onExisting={setEdit} />}</SheetFor>
    </Stack>
  );
}
