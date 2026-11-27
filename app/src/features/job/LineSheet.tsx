import { ActionIcon, Autocomplete, Button, Group, Modal, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { IconBuildingFactory2, IconCar, IconCheck, IconHelpCircle, IconListDetails, IconMinus, IconPlus, IconUser, IconX } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db, uid } from '../../db/db';
import { daysBetween, dubaiDate, shiftDay } from '../../domain/dates';
import { itemAmounts, itemCostPaid, itemTitle, lineName } from '../../domain/items';
import { formatAed, roundFils, withMarkup } from '../../domain/money';
import { enteredPrice, priceFromEntered, rateFor, vatModeOf, type VatMode } from '../../domain/vat';
import { buildSuggestions, type HistJob, type PriceContext, type PriceListLine, type Suggestion, type Suggestions, type SuggestionSet } from '../../domain/linePrices';
import type { JobTemplate, OrderItem, Outsource, PartOffer, RelatedRule } from '../../domain/types';
import { buildTogether } from '../../domain/together';
import { aiAfterLine } from '../../services/ai';
import { AiMark, YandexButton } from '../ai/Ai';
import { LineMedia } from './LineMedia';
import { VinCatalogsRow } from './VinCatalogs';
import { addItem, ensureLabourLine, setLinePhotos, updateItem } from '../../services/estimate';
import { setUnconfirmed, syncStage } from '../../services/flow';
import { offerWhen, optionsText } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { setProcurement } from '../../services/parts';
import { FormRow, Money, MoneyInput, RowGroup } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { typedOnly, useAction, useLang, usePhone, useScreenLiveQuery } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { DaysChips, KindSegment, RequestButton, SupplierChips, WhoChips } from './PartTools';
import { QtyAsk } from './QtyCheck';
import { cleanOff, LineOffRow, type LineOff } from './LineOff';
import { qtyShort } from '../../domain/sides';

/**
 * What is added: work (the labour charge), a part, or a service — anything done to the car (a change of oil, a wash),
 * in the garage or by others it pays (v0.68: a service with whom or what we pay is done outside).
 */
export type LineKind = 'labor' | 'part' | 'service';
export type { Suggestion, Suggestions } from '../../domain/linePrices';

/** Where a part of the job stands: to find, ordered, here — or the customer's own. */
export type PartState = 'needed' | 'ordered' | 'received' | 'customer';
export const PART_STATES: PartState[] = ['needed', 'ordered', 'received', 'customer'];
/** Each state in its colour, as on the board: to find — orange (the box), on its way — blue (the truck), here — green. */
export const PART_COLOR: Record<PartState, string> = { needed: 'orange', ordered: 'blue', received: 'green', customer: 'gray' };
export const partStateOf = (i: Pick<OrderItem, 'customerSupplied' | 'procurementStatus'>): PartState =>
  i.customerSupplied ? 'customer' : i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit' ? 'ordered' : i.procurementStatus === 'received' || i.procurementStatus === 'installed' ? 'received' : 'needed';

/**
 * Titles typed before and from the price list, for one-tap entry — each at the price it had on the job nearest to this
 * one (this car, this customer, the same model — domain/linePrices.ts, v0.68). The quick chips are the ones this car
 * and this customer had, then the usual ones (those that went with a similar complaint first).
 */
export function useSuggestions(ctx: PriceContext, enabled = true) {
  // Read once (not a live query over every line of every job), once the screen has slid in (its slide
  // is not shared with reading every line of every job), and kept for a minute: the next job has them at once.
  const key = [ctx.lang, ctx.orderId, ctx.vehicleId, ctx.customerId, ctx.make, ctx.model, ctx.complaint].join('|');
  const [value, setValue] = useState(() => cachedSuggestions(key));
  const latest = useRef(ctx);
  latest.current = ctx;
  useEffect(() => {
    if (!enabled) return;
    const hit = cachedSuggestions(key);
    if (hit) {
      setValue(hit);
      return;
    }
    let alive = true;
    const id = window.setTimeout(() => {
      void loadSuggestions(latest.current).then((v) => {
        suggestionCache.set(key, { at: Date.now(), v });
        if (alive) setValue(v);
      });
    }, 650);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [key, enabled]);
  return enabled ? value : undefined;
}

const suggestionCache = new Map<string, { at: number; v: SuggestionSet }>();
function cachedSuggestions(key: string): SuggestionSet | undefined {
  const hit = suggestionCache.get(key);
  return hit && Date.now() - hit.at < 60_000 ? hit.v : undefined;
}
/** A line saved: the next look at the suggestions reads them again (with its title and price). */
export function forgetSuggestions(): void {
  suggestionCache.clear();
  sources = undefined;
}

/*
 * What the suggestions are made of — every line ever typed (thousands, with the history carried over),
 * newest first, each line's job (its car, customer, make and model, complaint) and the price list — read once a
 * minute, not for every job opened.
 */
type Sources = { at: number; priceList: PriceListLine[]; items: OrderItem[]; jobs: Map<string, HistJob>; templates: JobTemplate[]; rules: RelatedRule[] };
let sources: Sources | undefined;
async function suggestionSources(): Promise<Sources> {
  if (sources && Date.now() - sources.at < 60_000) return sources;
  const [templates, items, orders, vehicles, rules] = await Promise.all([db.jobTemplates.toArray(), db.items.toArray(), db.orders.toArray(), db.vehicles.toArray(), db.relatedRules.toArray()]);
  items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const cars = new Map(vehicles.map((v) => [v.id, v]));
  const jobs = new Map<string, HistJob>(
    orders.map((o) => {
      const v = cars.get(o.vehicleId);
      return [o.id, { vehicleId: o.vehicleId, customerId: o.customerId, make: v?.make, model: v?.model, complaint: o.complaint }];
    }),
  );
  sources = { at: Date.now(), priceList: templates.flatMap((t) => t.items), items, jobs, templates, rules };
  return sources;
}

async function loadSuggestions(ctx: PriceContext): Promise<SuggestionSet> {
  const { priceList, items, jobs, templates, rules } = await suggestionSources();
  // What usually goes together (audit 27/11): the garage's own jobs, then the starter rules.
  return { ...buildSuggestions(items, jobs, priceList, ctx), together: buildTogether(items, ctx.lang, rules, templates) };
}

/** Where a suggestion's price is from, as a mark beside it: this car, this customer (nothing for the rest). */
export function PriceFromMark({ from }: { from: Suggestion['from'] }) {
  const { t } = useTranslation();
  if (from !== 'car' && from !== 'customer') return null;
  const I = from === 'car' ? IconCar : IconUser;
  return <I size={14} stroke={2.2} className="price-from" data-from={from} aria-label={t(`qi.from.${from}`)} />;
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
  // A service is a line of work on the customer's bill, handed outside: what we pay them is its cost, and
  // "Pay" on the line records it in the book as the job's expense.
  const service = kind === 'service';
  const lineKind: 'labor' | 'part' = kind === 'part' ? 'part' : 'labor';
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
  // The price said to be for all the name asks for (v0.70, «LEFT & RIGHT» × 1): kept with the line.
  const [noted, setNoted] = useState<number | undefined>();
  // The price as typed; `mode` says how it is counted: VAT on top, VAT inside, or no VAT on this line.
  const [price, setPrice] = useState<number | undefined>();
  const [cost, setCost] = useState<number | undefined>();
  const [mode, setMode] = useState<VatMode>('add');
  // The line's own discount (v0.82).
  const [off, setOff] = useState<LineOff>();
  const [part, setPart] = useState<PartState>('needed');
  const [supplierId, setSupplierId] = useState<string>();
  // Photos of the line: the stored ones kept, and new ones picked (saved with the line).
  const [kept, setKept] = useState<string[]>([]);
  const [fresh, setFresh] = useState<{ id: string; file: File; src: string }[]>([]);
  // The line as it is now, read live (its pictures and outlines on top of the sheet) — the form itself keeps what is typed.
  const live = useScreenLiveQuery(() => (item ? db.items.get(item.id) : undefined), [item?.id]);
  const incl = b.settings.pricesIncludeVat;
  const taxRate = item?.vatRateBp ? item.vatRateBp : b.settings.vatRateBp;
  // Lines added one after another in this sheet (v0.68, the user: «механик диктует 10 деталей — я быстро заполняю
  // список, цены потом»): «＋ Ещё» or the keyboard's «next» saves the name and clears the sheet for the next one.
  const [added, setAdded] = useState<{ id: string; title: string }[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);
  // A new line's name typed on a phone (v0.71, the user: «нажимаю на поле — открывается клавиатура, поле уходит вверх, мне
  // каждый раз приходится прокручивать, чтобы видеть, что пишу»): while it has the keyboard, the tiles and the photos above
  // it step aside — the field stays right under the sheet's title, in sight above the keyboard.
  const phone = usePhone();
  const [typing, setTyping] = useState(false);
  const blurTimer = useRef<number | undefined>(undefined);
  const inSight = () => {
    const go = () => nameRef.current?.scrollIntoView({ block: 'nearest' });
    requestAnimationFrame(go);
    // Again once the keyboard has come up (its own slide).
    window.setTimeout(go, 380);
  };
  /** The sheet as it opens: the line's own values, or empty for a new one. */
  const fill = () => {
    setTitle(item ? itemTitle(item, lang) : '');
    setPicked(undefined);
    setQty(item?.qty ?? 1);
    setNoted(item?.qtyNoted);
    const m = vatModeOf(item, incl);
    setMode(m);
    setPrice(item ? enteredPrice(item, taxRate, m) : undefined);
    setCost(item?.costPriceFils);
    setOff(item?.lineOff);
    setPart(item ? partStateOf(item) : 'needed');
    setSupplierId(item?.supplierId);
    setPartNumber(item?.partNumber ?? '');
    setOffers(item?.offers ?? []);
    setOffersOpen(!!item?.offers?.length);
    setDraft(null);
    setWho(item?.employeeId);
    setOutsource(item?.outsource ?? (service ? { state: 'todo' } : undefined));
    setOutDays(undefined);
    setKept(item?.mediaIds ?? []);
    setFresh((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.src));
      return [];
    });
  };
  useEffect(() => {
    if (!opened) return;
    fill();
    setAdded([]);
    setTyping(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, item, lang, incl, service]);
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
  const fromCost = (c: number | undefined) => (c === undefined ? undefined : enteredPrice({ unitPriceFils: withMarkup(c, b.settings.defaultMarkupBp) }, taxRate, mode));
  const own = kind === 'part' && part === 'customer';
  // Work is one (an edited line keeps the quantity it has); a part and a service — as many as typed (v0.68: a service's
  // quantity, the user: «по услугам добавить количество»).
  const counts = kind !== 'labor' || (!!item && item.qty !== 1);
  const lineQty = counts ? qty || 1 : (item?.qty ?? 1);
  const priced = { ...priceFromEntered(own ? 0 : price ?? 0, taxRate, mode), vatRateBp: rateFor(mode, taxRate) };
  const lineTotal = price && !own ? itemAmounts({ kind: lineKind, qty: lineQty, ...priced, lineOff: cleanOff(off) } as OrderItem) : undefined;
  const save = async (next = false) => {
    return run(async () => {
      const typed = lineName(title.trim());
      // A typed name goes where its letters belong (Cyrillic → Russian title), whatever the documents' language.
      const titles = picked && itemTitle(picked, lang) === typed ? { titleRu: picked.titleRu || typed, titleEn: picked.titleEn || typed } : /[а-яё]/i.test(typed) ? { titleRu: typed, titleEn: undefined } : { titleEn: typed, titleRu: undefined };
      const patch: Partial<OrderItem> = { ...titles, qty: lineQty, ...priced, lineOff: own ? undefined : cleanOff(off) };
      const status = kind === 'part' && !own ? (part as Exclude<PartState, 'customer'>) : undefined;
      if (kind === 'part') {
        patch.costPriceFils = own ? undefined : cost;
        patch.customerSupplied = own || undefined;
        patch.supplierId = own ? undefined : supplierId;
        patch.partNumber = partNumber.trim() || undefined;
        patch.qtyNoted = noted;
        patch.offers = !own && offers.length ? offers : undefined;
      } else {
        patch.employeeId = who;
        // Work outside: to whom, back when; what they charge is the line's cost. A service is done outside only when it
        // says by whom or what we pay (v0.68): a change of oil, a wash done here is the garage's own work.
        const outside = service ? !!outsource && (!!outsource.supplierId || (cost ?? 0) > 0 || outsource.state !== 'todo') : !!outsource;
        patch.outsource = outside && outsource ? { ...outsource, dueAt: outDays !== undefined ? shiftDay(dubaiDate(), outDays) : outsource.dueAt } : undefined;
        patch.costPriceFils = outside ? cost : undefined;
      }
      let itemId = item?.id;
      if (item) {
        await updateItem(item.id, patch);
        if (status && status !== partStateOf(item)) await setProcurement(item.id, { status });
      } else {
        itemId = (await addItem(b.order.id, { kind: lineKind, block: 'A', ...patch, procurementStatus: status })).id;
        // A job's first part brings its labour charge (v0.90, #70); it stays last of the lines.
        await ensureLabourLine(b.order.id);
      }
      const before = item?.mediaIds ?? [];
      if (itemId && (fresh.length || kept.length !== before.length)) await setLinePhotos(itemId, kept, fresh.map((p) => p.file));
      await syncStage(b.order.id);
      forgetSuggestions();
      haptic('light');
      // A part saved: the garage's AI looks at its name (v0.48) — in the background.
      // Every line's name looked at, and the labour charge said by the parts (v0.86).
      if (itemId) aiAfterLine(itemId);
      if (!next || !itemId) return onClose();
      // The next one: the sheet empty again, the keyboard still up in the name.
      setAdded((a) => [...a, { id: itemId!, title: typed }]);
      fill();
      nameRef.current?.focus();
    });
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const titleRef = useRef(title);
  titleRef.current = title;
  const rate = taxRate / 100;
  // The total under the price is for the manager: in the app's language (the line itself is in the documents' one).
  const totalNote =
    lineTotal && lineTotal.gross !== 0
      ? mode === 'none'
        ? t('item.vatTotalNone', { total: formatAed(lineTotal.gross, uiLang) })
        : t('item.vatTotal', { total: formatAed(lineTotal.gross, uiLang), vat: formatAed(lineTotal.vat, uiLang, false) })
      : undefined;
  const out = lineKind === 'labor' && !!outsource;
  // The line's money at a glance (v0.32): what the customer pays, the VAT in it; a part — what it costs us with VAT and
  // what stays; work outside — what we pay them and what stays.
  const sum = (() => {
    if (!lineTotal || own) return undefined;
    const vatNote = mode === 'none' ? t('qi.sumNoVat') : t('qi.sumVat', { vat: formatAed(lineTotal.vat, uiLang, false) });
    const cells: { key: string; label: string; fils: number; note?: string; tone?: 'good' | 'bad' }[] = [{ key: 'total', label: t('qi.sumClient'), fils: lineTotal.gross, note: vatNote }];
    if (kind === 'part' && cost !== undefined) {
      const same = !!item && cost === item.costPriceFils && (qty || 1) === item.qty;
      const paid = itemCostPaid({ kind: 'part', costPriceFils: cost, qty: qty || 1, vatRateBp: priced.vatRateBp, purchaseVatFils: same ? item?.purchaseVatFils : undefined });
      cells.push({ key: 'cost', label: t('qi.sumCost'), fils: paid });
      cells.push({ key: 'margin', label: t('qi.sumMargin'), fils: lineTotal.gross - paid, tone: lineTotal.gross >= paid ? 'good' : 'bad' });
    } else if (out && cost !== undefined) {
      // What we pay them is per one, as the price (a service's quantity — v0.68).
      const paid = roundFils(cost * lineQty);
      cells.push({ key: 'cost', label: t('outsource.cost'), fils: paid });
      cells.push({ key: 'margin', label: t('qi.sumLeft'), fils: lineTotal.gross - paid, tone: lineTotal.gross >= paid ? 'good' : 'bad' });
    }
    return { cells, label: totalNote };
  })();
  const nameLabel = service ? t('qi.serviceName') : kind === 'labor' ? t('qi.workName') : t('qi.partName');
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
      text: optionsText({ customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name }, lang, lineName(title.trim()), offers.filter((o) => o.costFils !== undefined).map((o) => ({ kind: o.kind, gross: offerGross(o), days: o.days }))),
      template: 'options',
      lang,
      orderId: b.order.id,
      photos: kept,
    });
  return (
    <Modal opened={opened} onClose={onClose} title={item ? t(service ? 'job.addService' : kind === 'labor' ? 'job.addWork' : 'job.addPart') : service ? t('qi.addService') : kind === 'labor' ? t('qi.addWork') : t('qi.addPart')} classNames={{ content: 'sheet-grouped' }}>
      <Stack gap="lg">
        {!item && !typing && (suggestions?.top.length ?? 0) > 0 && (
          // The usual ones, one tap each: two columns of tiles (name, last price) — all in sight, none off the side.
          <div className="line-quick" aria-label={t('qi.frequent')}>
            {suggestions!.top.slice(0, 6).map((name) => {
              const s = suggestions!.list.get(name)!;
              return (
                <button key={name} type="button" className="chip" data-active={lineName(title.trim()) === name} onClick={() => pick(name)}>
                  <span className="quick-name">{name}</span>
                  <span className="chip-note">
                    {formatAed(suggested(s).price, uiLang, false)}
                    <PriceFromMark from={s.from} />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {added.length > 0 && (
          // What this sheet added so far: the list grows as the mechanic dictates.
          <div className="line-added" aria-label={t('qi.addedN', { n: added.length })}>
            {added.map((a) => (
              <span key={a.id} className="line-added-name">
                <IconCheck size={14} stroke={2.6} aria-hidden />
                {a.title}
              </span>
            ))}
          </div>
        )}

        {/* Every picture first (v0.52): the line's own, then the AI's — one row, one size (not while the name is typed). */}
        {!typing && (
        <LineMedia
          own={[...kept.map((id) => ({ id, removable: true })), ...fresh.map((p) => ({ id: p.id, src: p.src, removable: true }))]}
          onAdd={(files) => setFresh((f) => [...f, ...files.map((file) => ({ id: uid(), file, src: URL.createObjectURL(file) }))])}
          onRemove={(p) => {
            if (p.src) {
              URL.revokeObjectURL(p.src);
              setFresh((f) => f.filter((x) => x.id !== p.id));
            } else setKept((k) => k.filter((x) => x !== p.id));
          }}
          item={kind === 'part' ? live : undefined}
          diagramIds={kind === 'part' ? live?.diagramIds : undefined}
          sampleIds={kind === 'part' ? live?.sampleIds : undefined}
        />
        )}

        {/* What it is: the name, large; for a part — where it stands. */}
        <div className="ios-group">
          <div className="ios-row left line-name">
            <Autocomplete
              aria-label={nameLabel}
              placeholder={service ? t('qi.servicePlaceholder') : kind === 'labor' ? t('qi.workPlaceholder') : t('qi.partPlaceholder')}
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
                        <PriceFromMark from={s!.from} />
                      </Text>
                    )}
                  </Group>
                );
              }}
              onChange={(v) => {
                setTitle(v);
                const s = suggestions?.list.get(lineName(v.trim()));
                if (s) {
                  setPicked(s);
                  if ((price === undefined || price === 0) && s.price) takeSuggestion(s);
                }
              }}
              autoComplete="off"
              // Names are in capitals: the keyboard types them so, and the field shows them so whatever is typed.
              autoCapitalize="characters"
              // The keyboard waits for a tap when the chips are on screen (it would cover them) and when a line is
              // edited (it is the price or the state that changes, not the name).
              data-autofocus={!item && !suggestions?.top.length ? true : undefined}
              ref={nameRef}
              // A new line: the keyboard's «next» saves this one and the field waits for the next (v0.68). After the
              // list's own handling (an option picked with the keys is the name then).
              enterKeyHint={item ? 'done' : 'next'}
              onFocus={() => {
                if (item || !phone) return;
                window.clearTimeout(blurTimer.current);
                setTyping(true);
                inSight();
              }}
              onBlur={() => {
                // A moment later: «＋ Ещё» takes the keyboard straight back (no tiles flashing in between).
                blurTimer.current = window.setTimeout(() => setTyping(false), 220);
              }}
              onKeyDown={(e) => {
                if (item || e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                window.setTimeout(() => {
                  if (titleRef.current.trim()) void saveRef.current(true);
                }, 0);
              }}
            />
          </div>
          {kind === 'part' && (
            // The catalogue number, for the request and for finding the part again (optional).
            <div className="ios-row">
              <span className="label">{t('qi.partNo')}</span>
              <div className="value">
                <TextInput
                  aria-label={t('qi.partNo')}
                  placeholder="—"
                  value={partNumber}
                  onChange={(e) => setPartNumber(e.currentTarget.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  // The number looked up on Yandex (v0.48.1, the user's ask) — a globe by the field once there is one.
                  rightSection={partNumber.trim() ? <YandexButton number={partNumber} size={30} /> : undefined}
                  rightSectionPointerEvents="all"
                  rightSectionWidth={partNumber.trim() ? 40 : undefined}
                />
              </div>
            </div>
          )}
          {/* The catalogues by this car's VIN (v0.66): links — the manager looks the part up there by the car's VIN. */}
          {kind === 'part' && <VinCatalogsRow car={{ vin: b.vehicle.vin, make: b.vehicle.make, model: b.vehicle.model, year: b.vehicle.year }} />}
          {kind === 'part' && (
            <div className="ios-row">
              <SegmentedControl
                fullWidth
                value={part}
                onChange={(v) => setPart(v as PartState)}
                color={PART_COLOR[part]}
                aria-label={t('job.partState')}
                data={PART_STATES.map((s) => ({ value: s, label: t(`job.part.${s}`) }))}
                style={{ flex: 1 }}
              />
            </div>
          )}
        </div>

        {/* A part whose name asks for more than its quantity (v0.70): asked here, as it is typed. */}
        {kind === 'part' && !own && !item?.customerSupplied && (() => {
          const n = qtyShort({ kind: 'part', qty: qty || 1, titleEn: title, qtyNoted: noted });
          return n ? <QtyAsk n={n} onFix={() => (setQty(n), haptic('selection'))} onNote={() => (setNoted(n), haptic('selection'))} /> : null;
        })()}

        {/* How much: rows as in the iPhone's settings — the label on the left, the value on the right. */}
        {!own && (
          <RowGroup mt={0}>
            {counts && (
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
            <LineOffRow value={off} onChange={setOff} />
          </RowGroup>
        )}
        {sum && lineTotal && lineTotal.gross !== 0 && (
          <div className="line-sum" role="group" aria-label={sum.label} data-cells={sum.cells.length}>
            {sum.cells.map((c) => (
              <div key={c.key} className="line-sum-cell" data-sum={c.key} data-tone={c.tone}>
                <span className="line-sum-label">
                  {c.label}
                  {/* The cost the AI put from a supplier's answer (v0.86) — until it is changed by hand. */}
                  {c.key === 'cost' && item?.costAi && cost === item.costPriceFils && <AiMark size={13} label={t('ai.costByAi')} />}
                </span>
                <span className="line-sum-value">
                  <Money fils={c.fils} signed={c.key === 'margin'} roll />
                </span>
                {c.note && <span className="line-sum-note">{c.note}</span>}
              </div>
            ))}
          </div>
        )}

        {item?.approvalState === 'draft' && (
          // Not confirmed yet (v0.88, the owner: «отмечать позиции как неподтверждённые, чтобы они не попадали в смету или
          // инвойс пока»): a tap, at once — out of the quote and the invoice; again — confirmed.
          <div>
            <button
              type="button"
              className="chip"
              data-active={!!live?.unconfirmed}
              aria-pressed={!!live?.unconfirmed}
              data-line-unconfirmed
              onClick={() => void run(async () => (await setUnconfirmed([item.id], !live?.unconfirmed), haptic('selection')))}
            >
              <IconHelpCircle size={16} stroke={2} style={{ verticalAlign: -3, marginRight: 6 }} color="var(--mantine-color-yellow-7)" aria-hidden />
              {t('job.unconfirmChip')}
            </button>
          </div>
        )}

        {kind === 'part' && !own && (
          <div>
            <div className="group-title">{t('job.supplier')}</div>
            <SupplierChips value={supplierId} onChange={setSupplierId} make={b.vehicle.make} />
            {/* Ask the sellers (car, VIN, part, photos), and keep what each offered. */}
            <Group grow gap={8} mt="sm" wrap="nowrap">
              <RequestButton vehicle={b.vehicle} item={{ titleEn: picked?.titleEn || item?.titleEn || lineName(title.trim()), titleRu: undefined, partNumber: partNumber.trim() || undefined, qty: qty || 1 }} supplierId={supplierId} photoIds={kept} />
              <Button variant={offersOpen ? 'filled' : 'light'} leftSection={<IconListDetails size={18} />} onClick={() => setOffersOpen((o) => !o)}>
                {offers.length ? t('offer.titleN', { n: offers.length }) : t('offer.title')}
              </Button>
            </Group>
          </div>
        )}

        {kind === 'part' && !own && offersOpen && (
          <div className="rise-enter">
            <div className="group-title">{t('offer.title')}</div>
            <div className="ios-group">
              {offers.map((o) => (
                <div key={o.id} className="ios-row clickable offer-row" role="button" tabIndex={0} aria-pressed={offerTaken(o)} data-offer-na={o.na || undefined} data-offer-wa={o.msg ? true : undefined} onClick={() => !o.na && takeOffer(o)}>
                  {/* Read from a supplier's WhatsApp answer (v0.79): the kind it did not say — «?»; none — «нет». */}
                  <span className="offer-kind">
                    {t(`offer.${o.kind}`)}
                    {o.unsure ? '?' : ''}
                    {/* Read by the AI (v0.86): the app's own rules found no price in the message. */}
                    {o.ai && <AiMark size={13} label={t('ai.offerByAi')} />}
                  </span>
                  <Text size="sm" c="dimmed" className="offer-meta" lineClamp={1}>
                    {[sName(o.supplierId), o.brand, o.na ? t('wa.ask.na') : offerWhen(o.days, uiLang), o.note].filter(Boolean).join(' · ')}
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
        {service && outsource && (
          // A service: who does it (a wash, a tow, a paint shop — a supplier that serves).
          <div className="ios-group">
            <div className="ios-row">
              <span className="label">{t('outsource.who')}</span>
              <SupplierChips service value={outsource.supplierId} onChange={(s) => setOutsource({ ...outsource, supplierId: s })} label={t('outsource.who')} />
            </div>
          </div>
        )}
        {kind === 'labor' && (
          // Work handed outside (paint, machining, alignment, a mobile electrician): who, what they charge, back when.
          <div>
            <button type="button" className="chip" data-active={out} aria-pressed={out} onClick={() => setOutsource(out ? undefined : { state: 'todo' })}>
              <IconBuildingFactory2 size={16} stroke={2} style={{ verticalAlign: -3, marginRight: 6 }} aria-hidden />
              {t('outsource.title')}
            </button>
            {out && outsource && (
              <div className="ios-group rise-enter" style={{ marginTop: 10 }}>
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

        {/* A line may be saved without a price (a part still to find): it cannot go to the customer until it has one. */}
        {/* Pinned to the bottom of the sheet: "Save" is in reach however long the form is. */}
        <div className="sheet-footer">
          {item ? (
            <Button size="lg" fullWidth loading={busy} disabled={!title.trim()} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          ) : (
            // A new line: «＋ Ещё» keeps the sheet for the next one (prices later — v0.68); the name typed is saved
            // with «Сохранить» too, and with nothing typed after a few added it is «Готово».
            <Group gap={8} wrap="nowrap" grow>
              <Button
                size="lg"
                variant="light"
                disabled={!title.trim() || busy}
                leftSection={<IconPlus size={20} stroke={2.2} />}
                onClick={() => {
                  // In the tap: the keyboard stays up for the next name.
                  nameRef.current?.focus();
                  void save(true);
                }}
              >
                {t('qi.next')}
              </Button>
              <Button size="lg" loading={busy} disabled={!title.trim() && !added.length} onClick={() => (title.trim() ? void save() : onClose())}>
                {title.trim() || !added.length ? t('common.save') : t('common.done')}
              </Button>
            </Group>
          )}
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
