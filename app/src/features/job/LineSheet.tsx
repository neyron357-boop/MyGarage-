import { ActionIcon, Autocomplete, Button, Group, Modal, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { IconBuildingFactory2, IconCheck, IconListDetails, IconMinus, IconPlus, IconX } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db, uid } from '../../db/db';
import { daysBetween, dubaiDate, shiftDay } from '../../domain/dates';
import { itemAmounts, itemTitle } from '../../domain/items';
import { formatAed, roundFils } from '../../domain/money';
import { enteredPrice, priceFromEntered, rateFor, vatModeOf, type VatMode } from '../../domain/vat';
import type { Lang, OrderItem, Outsource, PartOffer } from '../../domain/types';
import { addItem, setLinePhotos, updateItem } from '../../services/estimate';
import { syncStage } from '../../services/flow';
import { offerWhen, optionsText } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { setProcurement } from '../../services/parts';
import { FormRow, MoneyInput, RowGroup } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { typedOnly, useAction, useLang } from '../../ui/hooks';
import { PhotoStrip } from '../../ui/PhotoStrip';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { DaysChips, KindSegment, RequestButton, SupplierChips, WhoChips } from './PartTools';

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
  const uiLang = useLang();
  const { run, busy } = useAction();
  const suppliers = useLiveQuery(() => db.suppliers.filter((s) => !s.archivedAt).toArray(), []) ?? [];
  const [title, setTitle] = useState('');
  const [partNumber, setPartNumber] = useState('');
  // Offers found for the part (original, aftermarket, used), and the one being typed.
  const [offers, setOffers] = useState<PartOffer[]>([]);
  const [offersOpen, setOffersOpen] = useState(false);
  const [draft, setDraft] = useState<{ kind: PartOffer['kind']; cost?: number; supplierId?: string; days?: number } | null>(null);
  const [optionsSend, setOptionsSend] = useState<SendRequest | null>(null);
  // Who does the line, and work handed outside (to whom, back when).
  const [who, setWho] = useState<string>();
  const [outsource, setOutsource] = useState<Outsource>();
  const [outDays, setOutDays] = useState<number>();
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
    setPartNumber(item?.partNumber ?? '');
    setOffers(item?.offers ?? []);
    setOffersOpen(!!item?.offers?.length);
    setDraft(null);
    setWho(item?.employeeId);
    setOutsource(item?.outsource);
    setOutDays(undefined);
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
        patch.partNumber = partNumber.trim() || undefined;
        patch.offers = !own && offers.length ? offers : undefined;
      } else {
        patch.employeeId = who;
        // Work outside: to whom, back when; what they charge is the line's cost.
        patch.outsource = outsource ? { ...outsource, dueAt: outDays !== undefined ? shiftDay(dubaiDate(), outDays) : outsource.dueAt } : undefined;
        patch.costPriceFils = outsource ? cost : undefined;
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
  const rate = taxRate / 100;
  // The total under the price is for the manager: in the app's language (the line itself is in the documents' one).
  const totalNote =
    lineTotal && lineTotal.gross !== 0
      ? mode === 'none'
        ? t('item.vatTotalNone', { total: formatAed(lineTotal.gross, uiLang) })
        : t('item.vatTotal', { total: formatAed(lineTotal.gross, uiLang), vat: formatAed(lineTotal.vat, uiLang, false) })
      : undefined;
  const nameLabel = kind === 'labor' ? t('qi.workName') : t('qi.partName');
  /** An offer taken: its seller and cost on the line, the price from the cost with the garage's markup. */
  const takeOffer = (o: PartOffer) => {
    setSupplierId(o.supplierId);
    if (o.costFils !== undefined) {
      setCost(o.costFils);
      setPrice(fromCost(o.costFils));
    }
    haptic('selection');
  };
  const offerTaken = (o: PartOffer) => o.costFils === cost && (o.supplierId ?? undefined) === (supplierId ?? undefined);
  const sName = (id?: string) => suppliers.find((s) => s.id === id)?.name;
  /** What an offer costs the customer (the line's quantity, with VAT as the line counts it). */
  const offerGross = (o: PartOffer) => {
    const entered = fromCost(o.costFils) ?? 0;
    return itemAmounts({ kind: 'part', qty: qty || 1, ...priceFromEntered(entered, taxRate, mode), vatRateBp: rateFor(mode, taxRate) } as OrderItem).gross;
  };
  const showOptions = () =>
    setOptionsSend({
      text: optionsText({ customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name }, lang, title.trim(), offers.filter((o) => o.costFils !== undefined).map((o) => ({ kind: o.kind, gross: offerGross(o), days: o.days }))),
      template: 'options',
      lang,
      orderId: b.order.id,
      photos: kept,
    });
  const out = kind === 'labor' && !!outsource;
  return (
    <Modal opened={opened} onClose={onClose} title={item ? t('item.edit') : kind === 'labor' ? t('qi.addWork') : t('qi.addPart')} classNames={{ content: 'sheet-grouped' }}>
      <Stack gap="lg">
        {!item && (suggestions?.top.length ?? 0) > 0 && (
          // The usual ones, one tap each: two columns of tiles (name, last price) — all in sight, none off the side.
          <div className="line-quick" aria-label={t('qi.frequent')}>
            {suggestions!.top.slice(0, 6).map((name) => (
              <button key={name} type="button" className="chip" data-active={title === name} onClick={() => pick(name)}>
                <span className="quick-name">{name}</span>
                <span className="chip-note">{formatAed(suggested(suggestions!.list.get(name)!).price, uiLang, false)}</span>
              </button>
            ))}
          </div>
        )}

        {/* What it is: the name, large; for a part — where it stands. */}
        <div className="ios-group">
          <div className="ios-row left line-name">
            <Autocomplete
              aria-label={nameLabel}
              placeholder={kind === 'labor' ? t('qi.workPlaceholder') : t('qi.partPlaceholder')}
              data={names}
              filter={typedOnly}
              limit={8}
              value={title}
              w="100%"
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
              // The keyboard waits for a tap when the chips are on screen (it would cover them) and when a line is
              // edited (it is the price or the state that changes, not the name).
              data-autofocus={!item && !suggestions?.top.length ? true : undefined}
            />
          </div>
          {kind === 'part' && (
            // The catalogue number, for the request and for finding the part again (optional).
            <div className="ios-row">
              <span className="label">{t('qi.partNo')}</span>
              <div className="value">
                <TextInput aria-label={t('qi.partNo')} placeholder="—" value={partNumber} onChange={(e) => setPartNumber(e.currentTarget.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
              </div>
            </div>
          )}
          {kind === 'part' && (
            <div className="ios-row">
              <SegmentedControl
                fullWidth
                value={part}
                onChange={(v) => setPart(v as PartState)}
                aria-label={t('job.partState')}
                data={PART_STATES.map((s) => ({ value: s, label: t(`job.part.${s}`) }))}
                style={{ flex: 1 }}
              />
            </div>
          )}
        </div>

        {/* How much: rows as in the iPhone's settings — the label on the left, the value on the right. */}
        {!own && (
          <RowGroup mt={0} note={totalNote}>
            {kind === 'part' && (
              <FormRow label={t('qi.qty')}>
                <QtyStepper value={qty} onChange={setQty} label={t('qi.qty')} />
              </FormRow>
            )}
            {(kind === 'part' || out) && (
              <FormRow label={out ? t('outsource.cost') : t('qi.costShort')}>
                <MoneyInput
                  label={undefined}
                  ariaLabel={out ? t('outsource.cost') : t('qi.cost')}
                  value={cost}
                  onChange={(c) => {
                    if (!price || price === fromCost(cost)) setPrice(fromCost(c));
                    setCost(c);
                  }}
                />
              </FormRow>
            )}
            <FormRow label={kind === 'part' ? t('qi.priceShort') : t('qi.price')}>
              <MoneyInput label={undefined} ariaLabel={kind === 'part' ? t('qi.unitPrice') : t('qi.price')} value={price} onChange={setPrice} />
            </FormRow>
            <FormRow label="VAT">
              <SegmentedControl
                value={mode}
                onChange={(m) => setMode(m as VatMode)}
                aria-label={t('item.vatMode.label')}
                data={(['add', 'incl', 'none'] as const).map((m) => ({ value: m, label: t(`item.vatShort.${m}`, { rate }) }))}
              />
            </FormRow>
          </RowGroup>
        )}

        {kind === 'part' && !own && (
          <div>
            <div className="group-title">{t('job.supplier')}</div>
            <SupplierChips value={supplierId} onChange={setSupplierId} make={b.vehicle.make} />
            {/* Ask the sellers (car, VIN, part, photos), and keep what each offered. */}
            <Group grow gap={8} mt="sm" wrap="nowrap">
              <RequestButton vehicle={b.vehicle} item={{ titleEn: picked?.titleEn || item?.titleEn || title.trim(), titleRu: undefined, partNumber: partNumber.trim() || undefined, qty: qty || 1 }} supplierId={supplierId} photoIds={kept} />
              <Button variant={offersOpen ? 'filled' : 'light'} leftSection={<IconListDetails size={18} />} onClick={() => setOffersOpen((o) => !o)}>
                {offers.length ? t('offer.titleN', { n: offers.length }) : t('offer.title')}
              </Button>
            </Group>
          </div>
        )}

        {kind === 'part' && !own && offersOpen && (
          <div>
            <div className="group-title">{t('offer.title')}</div>
            <div className="ios-group">
              {offers.map((o) => (
                <div key={o.id} className="ios-row clickable offer-row" role="button" tabIndex={0} aria-pressed={offerTaken(o)} onClick={() => takeOffer(o)}>
                  <span className="offer-kind">{t(`offer.${o.kind}`)}</span>
                  <Text size="sm" c="dimmed" className="offer-meta" lineClamp={1}>
                    {[sName(o.supplierId), offerWhen(o.days, uiLang)].filter(Boolean).join(' · ')}
                  </Text>
                  <Text fw={600} className="tnum" style={{ flexShrink: 0 }}>
                    {o.costFils !== undefined ? formatAed(o.costFils, uiLang, false) : '—'}
                  </Text>
                  {offerTaken(o) ? <IconCheck size={18} stroke={2.6} color="var(--mantine-color-cobalt-6)" style={{ flexShrink: 0 }} aria-hidden /> : <span style={{ width: 18 }} />}
                  <ActionIcon
                    size={30}
                    radius="xl"
                    variant="subtle"
                    color="gray"
                    aria-label={t('common.delete')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOffers((list) => list.filter((x) => x.id !== o.id));
                    }}
                  >
                    <IconX size={16} />
                  </ActionIcon>
                </div>
              ))}
              {draft ? (
                <>
                  <div className="ios-row">
                    <KindSegment value={draft.kind} onChange={(k) => setDraft({ ...draft, kind: k })} />
                  </div>
                  <FormRow label={t('qi.costShort')}>
                    <MoneyInput label={undefined} ariaLabel={t('offer.cost')} value={draft.cost} onChange={(c) => setDraft({ ...draft, cost: c })} autoFocus />
                  </FormRow>
                  <div className="ios-row">
                    <SupplierChips value={draft.supplierId} onChange={(s) => setDraft({ ...draft, supplierId: s })} make={b.vehicle.make} />
                  </div>
                  <div className="ios-row">
                    <DaysChips value={draft.days} onChange={(d) => setDraft({ ...draft, days: d })} label={t('offer.when')} />
                  </div>
                  <div className="ios-row">
                    <Button
                      fullWidth
                      variant="light"
                      disabled={draft.cost === undefined}
                      onClick={() => {
                        const o: PartOffer = { id: uid(), kind: draft.kind, costFils: draft.cost, supplierId: draft.supplierId, days: draft.days };
                        setOffers((list) => [...list, o]);
                        // The first offer is the line's until another is picked.
                        if (!offers.length) takeOffer(o);
                        setDraft(null);
                      }}
                    >
                      {t('offer.add')}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="ios-row clickable" role="button" tabIndex={0} onClick={() => setDraft({ kind: offers.length ? 'aftermarket' : 'oem' })}>
                  <Text c="cobalt.6" fw={500}>
                    <IconPlus size={17} stroke={2.2} style={{ verticalAlign: -3, marginRight: 6 }} aria-hidden />
                    {t('offer.new')}
                  </Text>
                </div>
              )}
            </div>
            {offers.filter((o) => o.costFils !== undefined).length >= 2 && (
              <Button mt="sm" fullWidth variant="light" color="green" disabled={!title.trim()} onClick={showOptions}>
                {t('offer.toClient')}
              </Button>
            )}
          </div>
        )}

        {kind === 'labor' && <WhoChips value={who} onChange={setWho} />}
        {kind === 'labor' && (
          // Work handed outside (paint, machining, alignment, a mobile electrician): who, what they charge, back when.
          <div>
            <button type="button" className="chip" data-active={out} aria-pressed={out} onClick={() => setOutsource(out ? undefined : { state: 'todo' })}>
              <IconBuildingFactory2 size={16} stroke={2} style={{ verticalAlign: -3, marginRight: 6 }} aria-hidden />
              {t('outsource.title')}
            </button>
            {out && outsource && (
              <div className="ios-group" style={{ marginTop: 10 }}>
                <div className="ios-row">
                  <SupplierChips service value={outsource.supplierId} onChange={(s) => setOutsource({ ...outsource, supplierId: s })} label={t('outsource.who')} />
                </div>
                <div className="ios-row">
                  <span className="label">{t('outsource.back')}</span>
                  <DaysChips value={outDays ?? (outsource.dueAt ? Math.max(0, daysBetween(dubaiDate(), outsource.dueAt)) : undefined)} onChange={setOutDays} label={t('outsource.back')} />
                </div>
              </div>
            )}
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
        {/* Pinned to the bottom of the sheet: "Save" is in reach however long the form is. */}
        <div className="sheet-footer">
          <Button size="lg" fullWidth loading={busy} disabled={!title.trim()} onClick={save}>
            {t('common.save')}
          </Button>
        </div>
        {item && onDelete && (
          <Button variant="subtle" color="red" onClick={onDelete}>
            {t('common.delete')}
          </Button>
        )}
      </Stack>
      <SendDialog customer={b.customer} request={optionsSend} onClose={() => setOptionsSend(null)} />
    </Modal>
  );
}

/** A quantity with − and + beside it (and typed when it is not a whole number). */
function QtyStepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const step = (d: number) => onChange(Math.max(1, Math.round((value + d) * 100) / 100));
  return (
    <Group gap={6} wrap="nowrap" className="qty-stepper">
      <ActionIcon variant="light" color="gray" size={36} radius="xl" aria-label="−" disabled={value <= 1} onClick={() => step(-1)}>
        <IconMinus size={18} />
      </ActionIcon>
      <TextInput
        aria-label={label}
        inputMode="decimal"
        value={text}
        w={56}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setText(e.currentTarget.value);
          const n = Number(e.currentTarget.value.replace(',', '.'));
          if (n > 0) onChange(n);
        }}
        onBlur={() => setText(String(value))}
        styles={{ input: { textAlign: 'center', fontVariantNumeric: 'tabular-nums' } }}
      />
      <ActionIcon variant="light" color="gray" size={36} radius="xl" aria-label="+" onClick={() => step(1)}>
        <IconPlus size={18} />
      </ActionIcon>
    </Group>
  );
}
