import { Autocomplete, Button, Group, Modal, NumberInput, SimpleGrid, Stack, Text } from '@mantine/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db, uid } from '../../db/db';
import { itemAmounts, itemTitle } from '../../domain/items';
import { formatAed, roundFils } from '../../domain/money';
import { enteredPrice, priceFromEntered, rateFor, vatModeOf, type VatMode } from '../../domain/vat';
import type { Lang, OrderItem } from '../../domain/types';
import { addItem, setLinePhotos, updateItem } from '../../services/estimate';
import { syncStage } from '../../services/flow';
import type { OrderBundle } from '../../services/orders';
import { setProcurement } from '../../services/parts';
import { MoneyInput } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { typedOnly, useAction } from '../../ui/hooks';
import { PhotoStrip } from '../../ui/PhotoStrip';
import { VatModeField } from '../estimate/components';

export type LineKind = 'labor' | 'part';
/** A line typed before: its latest net price, VAT-inclusive price if typed with VAT, and VAT rate (0 — no VAT). */
export type Suggestion = { titleRu: string; titleEn: string; price: number; gross?: number; rate?: number; uses: number };
export type Suggestions = { list: Map<string, Suggestion>; top: string[] };

/** Where a part of the job stands: to find, ordered, here — or the customer's own. */
export type PartState = 'needed' | 'ordered' | 'received' | 'customer';
export const PART_STATES: PartState[] = ['needed', 'ordered', 'received', 'customer'];
export const partStateOf = (i: Pick<OrderItem, 'customerSupplied' | 'procurementStatus'>): PartState =>
  i.customerSupplied ? 'customer' : i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit' ? 'ordered' : i.procurementStatus === 'received' || i.procurementStatus === 'installed' ? 'received' : 'needed';

const words = (s: string) => s.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((w) => w.length >= 4);

/**
 * Titles typed before and from the price list, for one-tap entry: the latest price of each title.
 * The quick chips are the most used ones — first those that went with a similar complaint before
 * ("brake noise" → brake pads).
 */
export function useSuggestions(lang: Lang, complaint = '') {
  return useLiveQuery(async () => {
    const [templates, items, orders] = await Promise.all([db.jobTemplates.toArray(), db.items.toArray(), db.orders.toArray()]);
    const maps: Record<LineKind, Map<string, Suggestion>> = { labor: new Map(), part: new Map() };
    const mine = new Set(words(complaint));
    const alike = new Set(mine.size ? orders.filter((o) => words(o.complaint ?? '').some((w) => mine.has(w))).map((o) => o.id) : []);
    const put = (kind: LineKind, s: Omit<Suggestion, 'uses'>, uses: number) => {
      const title = (lang === 'ru' ? s.titleRu || s.titleEn : s.titleEn || s.titleRu).trim();
      if (!title) return;
      const had = maps[kind].get(title);
      if (had) had.uses += uses;
      else maps[kind].set(title, { ...s, uses });
    };
    // Newest first, so a title keeps its latest price.
    const sorted = [...items].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    for (const it of sorted)
      if (it.kind === 'labor' || it.kind === 'part')
        put(it.kind, { titleRu: it.titleRu ?? '', titleEn: it.titleEn ?? '', price: it.unitPriceFils, gross: it.unitGrossFils, rate: it.vatRateBp }, alike.has(it.orderId) ? 50 : 1);
    for (const tpl of templates) for (const ti of tpl.items) if (ti.kind === 'labor' || ti.kind === 'part') put(ti.kind, { titleRu: ti.titleRu, titleEn: ti.titleEn, price: ti.unitPriceFils }, 0);
    const pack = (m: Map<string, Suggestion>): Suggestions => ({
      list: m,
      top: [...m.entries()]
        .filter(([, s]) => s.price > 0)
        .sort((a, b) => b[1].uses - a[1].uses)
        .slice(0, 12)
        .map(([k]) => k),
    });
    return { labor: pack(maps.labor), part: pack(maps.part) };
  }, [lang, complaint]);
}

/** Add or edit one line: what was done (or which part), quantity and price; for a part — where it stands. */
export function LineSheet({
  b,
  kind,
  item,
  opened,
  onClose,
  onDelete,
  suggestions,
}: {
  b: OrderBundle;
  kind: LineKind;
  item?: OrderItem;
  opened: boolean;
  onClose: () => void;
  onDelete?: () => void;
  suggestions?: Suggestions;
}) {
  const { t } = useTranslation();
  // The lines go on the customer's documents: names in the job's document language (English by default).
  const lang = b.order.docLanguage;
  const { run, busy } = useAction();
  const suppliers = useLiveQuery(() => db.suppliers.filter((s) => !s.archivedAt).toArray(), []) ?? [];
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<Suggestion>();
  const [qty, setQty] = useState<number>(1);
  // The price as typed; `mode` says how it is counted: VAT on top, VAT inside, or no VAT on this line.
  const [price, setPrice] = useState<number | undefined>();
  const [cost, setCost] = useState<number | undefined>();
  const [mode, setMode] = useState<VatMode>('add');
  const [part, setPart] = useState<PartState>('needed');
  const [supplierId, setSupplierId] = useState<string>();
  // Photos of the line: the stored ones kept, and new ones picked (saved with the line).
  const [kept, setKept] = useState<string[]>([]);
  const [fresh, setFresh] = useState<{ id: string; file: File; src: string }[]>([]);
  const incl = b.settings.pricesIncludeVat;
  const taxRate = item?.vatRateBp ? item.vatRateBp : b.settings.vatRateBp;
  useEffect(() => {
    if (!opened) return;
    setTitle(item ? itemTitle(item, lang) : '');
    setPicked(undefined);
    setQty(item?.qty ?? 1);
    const m = vatModeOf(item, incl);
    setMode(m);
    setPrice(item ? enteredPrice(item, taxRate, m) : undefined);
    setCost(item?.costPriceFils);
    setPart(item ? partStateOf(item) : 'needed');
    setSupplierId(item?.supplierId);
    setKept(item?.mediaIds ?? []);
    setFresh((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.src));
      return [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, item, lang, incl]);
  const names = useMemo(() => [...(suggestions?.list.keys() ?? [])], [suggestions]);
  /** A suggestion's price as it is typed: with VAT if it was typed with VAT last time. */
  const suggested = (s: Suggestion) => {
    const m = vatModeOf({ vatRateBp: s.rate, unitGrossFils: s.gross }, incl);
    return { mode: m, price: enteredPrice({ unitPriceFils: s.price, unitGrossFils: s.gross }, s.rate || b.settings.vatRateBp, m) };
  };
  const takeSuggestion = (s: Suggestion) => {
    const x = suggested(s);
    setMode(x.mode);
    setPrice(x.price);
  };
  /** One tap on a frequent line: its name, its last price and VAT as last time. */
  const pick = (name: string) => {
    const s = suggestions?.list.get(name);
    setTitle(name);
    setPicked(s);
    if (s?.price) takeSuggestion(s);
    haptic('selection');
  };
  /** The customer's price from the purchase cost and the garage's markup, as prices are typed now. */
  const fromCost = (c: number | undefined) => (c === undefined ? undefined : enteredPrice({ unitPriceFils: roundFils(c * (1 + b.settings.defaultMarkupBp / 10000)) }, taxRate, mode));
  const own = kind === 'part' && part === 'customer';
  const priced = { ...priceFromEntered(own ? 0 : price ?? 0, taxRate, mode), vatRateBp: rateFor(mode, taxRate) };
  const lineTotal = price && !own ? itemAmounts({ kind, qty: kind === 'part' ? qty || 1 : 1, ...priced } as OrderItem) : undefined;
  const save = () =>
    run(async () => {
      const typed = title.trim();
      // A typed name goes where its letters belong (Cyrillic → Russian title), whatever the documents' language.
      const titles = picked && itemTitle(picked, lang) === typed ? { titleRu: picked.titleRu || typed, titleEn: picked.titleEn || typed } : /[а-яё]/i.test(typed) ? { titleRu: typed, titleEn: undefined } : { titleEn: typed, titleRu: undefined };
      const patch: Partial<OrderItem> = { ...titles, qty: kind === 'part' ? qty || 1 : 1, ...priced };
      const status = kind === 'part' && !own ? (part as Exclude<PartState, 'customer'>) : undefined;
      if (kind === 'part') {
        patch.costPriceFils = own ? undefined : cost;
        patch.customerSupplied = own || undefined;
        patch.supplierId = own ? undefined : supplierId;
      }
      let itemId = item?.id;
      if (item) {
        await updateItem(item.id, patch);
        if (status && status !== partStateOf(item)) await setProcurement(item.id, { status });
      } else {
        itemId = (await addItem(b.order.id, { kind, block: 'A', ...patch, procurementStatus: status })).id;
      }
      const before = item?.mediaIds ?? [];
      if (itemId && (fresh.length || kept.length !== before.length)) await setLinePhotos(itemId, kept, fresh.map((p) => p.file));
      await syncStage(b.order.id);
      haptic('light');
      onClose();
    });
  return (
    <Modal opened={opened} onClose={onClose} title={item ? t('item.edit') : kind === 'labor' ? t('qi.addWork') : t('qi.addPart')}>
      <Stack gap="md">
        {!item && (suggestions?.top.length ?? 0) > 0 && (
          <div className="chip-row" aria-label={t('qi.frequent')}>
            {suggestions!.top.map((name) => (
              <button key={name} type="button" className="chip" data-active={title === name} onClick={() => pick(name)}>
                {name}
                <span className="chip-note">{formatAed(suggested(suggestions!.list.get(name)!).price, lang, false)}</span>
              </button>
            ))}
          </div>
        )}
        <Autocomplete
          label={kind === 'labor' ? t('qi.workName') : t('qi.partName')}
          placeholder={kind === 'labor' ? t('qi.workPlaceholder') : t('qi.partPlaceholder')}
          data={names}
          filter={typedOnly}
          limit={8}
          value={title}
          renderOption={({ option }) => {
            const s = suggestions?.list.get(option.value);
            const p = s?.price ? suggested(s).price : undefined;
            return (
              <Group justify="space-between" wrap="nowrap" w="100%" gap="sm">
                <Text size="sm" lineClamp={2}>
                  {option.value}
                </Text>
                {!!p && (
                  <Text size="sm" c="dimmed" className="tnum" style={{ flexShrink: 0 }}>
                    {formatAed(p)}
                  </Text>
                )}
              </Group>
            );
          }}
          onChange={(v) => {
            setTitle(v);
            const s = suggestions?.list.get(v);
            if (s) {
              setPicked(s);
              if ((price === undefined || price === 0) && s.price) takeSuggestion(s);
            }
          }}
          autoComplete="off"
          // With quick chips on screen the keyboard waits for a tap: it would cover them.
          data-autofocus={item || !suggestions?.top.length ? true : undefined}
        />
        {kind === 'part' && (
          <div className="chip-row" aria-label={t('job.partState')}>
            {PART_STATES.map((s) => (
              <button key={s} type="button" className="chip" data-active={part === s} onClick={() => setPart(s)}>
                {t(`job.part.${s}`)}
              </button>
            ))}
          </div>
        )}
        {!own && (
          <>
            {kind === 'part' && (
              // What the supplier asks comes first: the customer's price follows it with the markup.
              <SimpleGrid cols={2}>
                <NumberInput label={t('qi.qty')} min={0.1} step={1} decimalScale={2} value={qty} onChange={(v) => setQty(Number(v) || 1)} inputMode="decimal" />
                <MoneyInput
                  label={t('qi.cost')}
                  value={cost}
                  onChange={(c) => {
                    if (!price || price === fromCost(cost)) setPrice(fromCost(c));
                    setCost(c);
                  }}
                />
              </SimpleGrid>
            )}
            <MoneyInput label={kind === 'part' ? t('qi.unitPrice') : t('qi.price')} value={price} onChange={setPrice} />
            <VatModeField mode={mode} onChange={setMode} rateBp={taxRate} total={lineTotal} />
          </>
        )}
        {kind === 'part' && !own && suppliers.length > 0 && (
          <div className="chip-row" aria-label={t('job.supplier')}>
            {suppliers.map((s) => (
              <button key={s.id} type="button" className="chip" data-active={supplierId === s.id} onClick={() => setSupplierId(supplierId === s.id ? undefined : s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <PhotoStrip
          name="line"
          photos={[...kept.map((id) => ({ id, removable: true })), ...fresh.map((p) => ({ id: p.id, src: p.src, removable: true }))]}
          onAdd={(files) => setFresh((f) => [...f, ...files.map((file) => ({ id: uid(), file, src: URL.createObjectURL(file) }))])}
          onRemove={(p) => {
            if (p.src) {
              URL.revokeObjectURL(p.src);
              setFresh((f) => f.filter((x) => x.id !== p.id));
            } else setKept((k) => k.filter((x) => x !== p.id));
          }}
        />
        {/* A line may be saved without a price (a part still to find): it cannot go to the customer until it has one. */}
        <Button size="lg" loading={busy} disabled={!title.trim()} onClick={save}>
          {t('common.save')}
        </Button>
        {item && onDelete && (
          <Button variant="subtle" color="red" onClick={onDelete}>
            {t('common.delete')}
          </Button>
        )}
      </Stack>
    </Modal>
  );
}
