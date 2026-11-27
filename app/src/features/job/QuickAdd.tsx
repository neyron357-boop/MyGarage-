import { ActionIcon, Modal, Text, TextInput } from '@mantine/core';
import { IconArrowUp, IconBuildingStore, IconPackage, IconPlus, IconSearch, IconSparkles, IconTool, IconX, type Icon } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { lineName } from '../../domain/items';
import { hintsFor } from '../../domain/together';
import type { JobTemplate } from '../../domain/types';
import type { Suggestion, SuggestionSet } from '../../domain/linePrices';
import { formatAed } from '../../domain/money';
import { autoMatches, exactTitle, guessKind, quickMatches, sideOf, typedPrice, type AutoKind } from '../../domain/quickAdd';
import { matchPartName } from '../../domain/partsVocab';
import { enteredPrice, priceFromEntered, rateFor, vatModeOf } from '../../domain/vat';
import { aiAfterLine } from '../../services/ai';
import { addItem, addTemplate, ensureLabourLine } from '../../services/estimate';
import { removeLines, syncStage } from '../../services/flow';
import type { OrderBundle } from '../../services/orders';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { forgetSuggestions, PriceFromMark, type LineKind } from './LineSheet';

/*
 * The quick «＋» sheet of a job (v0.81, the user's brief: «механик диктует — я быстро заполняю список»; «по кнопке
 * «Запчасть» открывать короткое окно с поиском и фокусом в строке; над клавиатурой — «Запчасть», «Работа / Labor»,
 * «Услуга»… касание подсказки сразу добавляет позицию… после добавления очистить строку и оставить фокус… дать сразу
 * отменить; цену на этом шаге вводить необязательно»). One field, the keyboard up all along:
 *  - what was typed before comes up as it is typed (domain/quickAdd.ts — both languages, the dictionary; a part's left and
 *    right side as two lines), each at the price this car, this customer, this model had (domain/linePrices.ts);
 *  - a tap on one adds it at once (with that price); «＋ «…»» or the keyboard's key adds what was typed, without a price;
 *  - the kind is switched with one tap above the keyboard; the field is cleared and keeps the keyboard for the next;
 *  - what was added stays in sight with × — taken off at once (to the job's bin, as any draft line).
 * The rest of a line (the price, the number, the supplier, photos) — on its row: «+ Цена», its name — its card.
 */

/** v0.91.7: «Авто» first — the kind of each line found as it is typed (domain/quickAdd.ts `guessKind`); the others force it. */
export type QuickKind = LineKind | 'auto';
const KINDS: { kind: QuickKind; icon: Icon; color: string; label: string }[] = [
  { kind: 'auto', icon: IconSparkles, color: 'cobalt', label: 'qa.auto' },
  { kind: 'part', icon: IconPackage, color: 'orange', label: 'job.addPart' },
  { kind: 'labor', icon: IconTool, color: 'blue', label: 'qa.labor' },
  { kind: 'service', icon: IconBuildingStore, color: 'violet', label: 'job.addService' },
];
const KIND_OF: Record<AutoKind, { icon: Icon; color: string; label: string }> = {
  part: { icon: IconPackage, color: 'orange', label: 'job.addPart' },
  labor: { icon: IconTool, color: 'blue', label: 'qa.labor' },
  service: { icon: IconBuildingStore, color: 'violet', label: 'job.addService' },
};

/** A line's kind at its end, in its colour: the symbol and the word (one «Добавить» for every kind, v0.91.7). */
function KindMark({ kind, unsure }: { kind: AutoKind; unsure?: boolean }) {
  const { t } = useTranslation();
  const k = KIND_OF[kind];
  const I = k.icon;
  return (
    <span className="qa-kind-mark" style={{ '--c': `var(--mantine-color-${k.color}-6)` } as React.CSSProperties} data-unsure={unsure || undefined} data-qa-kind={kind}>
      <I size={13} stroke={2.4} aria-hidden />
      {t(k.label)}
    </span>
  );
}

/** Taps on the sheet's buttons keep the field's focus (and the keyboard): a mouse's press does not take it either. */
const keep = (e: React.MouseEvent) => e.preventDefault();

export function QuickAddSheet({ b, kind, opened, onClose, suggestions }: { b: OrderBundle; kind: QuickKind; opened: boolean; onClose: () => void; suggestions?: SuggestionSet }) {
  const { t } = useTranslation();
  const uiLang = useLang();
  const { run } = useAction();
  const [mode, setMode] = useState<QuickKind>(kind);
  const [q, setQ] = useState('');
  const [added, setAdded] = useState<{ id: string; title: string; kind?: AutoKind }[]>([]);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!opened) return;
    setMode(kind);
    setQ('');
    setAdded([]);
  }, [opened, kind]);
  // The field takes the keyboard as the sheet opens (the tap that opened it held it up — ui/keyboard.ts).
  useEffect(() => {
    if (!opened) return;
    const id = requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [opened]);
  const focus = () => field.current?.focus({ preventScroll: true });

  const auto = mode === 'auto';
  // Work and services: the labour charges / the rest at first; typing finds any of them (linePrices.ts).
  const set = !suggestions || auto ? undefined : mode === 'part' ? suggestions.part : q.trim() ? suggestions.work : suggestions[mode];
  // «GEAR OIL -- 450» (v0.90, #73): the name is what is before the two hyphens, the number after them — its sale price.
  const said = useMemo(() => typedPrice(q), [q]);
  const query = said.priceFils ? said.name : q;
  // v0.91.7: the spelling put right at once by the parts' dictionary («BRAK PADS» → «BRAKE PADS»); the AI looks later.
  const dict = useMemo(() => (query.trim() ? matchPartName(query) : undefined), [query]);
  const fixedName = dict?.known && dict.changed ? dict.fixed : undefined;
  const autoList = useMemo(() => (auto ? autoMatches(suggestions, query, 8, fixedName) : []), [auto, suggestions, query, fixedName]);
  const matches = useMemo(() => (auto ? autoList.map((m) => m.title) : quickMatches(set, query, 8)), [auto, autoList, set, query]);
  const kindOfMatch = useMemo(() => new Map(autoList.map((m) => [m.title, m.kind])), [autoList]);
  const exact = auto ? (exactTitle(suggestions?.part, query) ?? exactTitle(suggestions?.work, query)) : exactTitle(set, query);
  const typed = lineName((auto && fixedName ? fixedName : query).trim());
  const typedGuess = useMemo(() => (auto && typed ? guessKind(typed, suggestions, !!dict?.known) : undefined), [auto, typed, suggestions, dict]);
  /** A title's suggestion, from the set it is in. */
  const sugOf = (title: string) => (auto ? (kindOfMatch.get(title) === 'part' ? suggestions?.part : suggestions?.work)?.list.get(title) ?? suggestions?.part.list.get(title) ?? suggestions?.work.list.get(title) : set?.list.get(title));
  const incl = b.settings.pricesIncludeVat;
  /** A suggestion's price as the line will show it (with VAT if it was typed with VAT). */
  const shown = (s: Suggestion) => enteredPrice({ unitPriceFils: s.price, unitGrossFils: s.gross }, s.rate || b.settings.vatRateBp, vatModeOf({ vatRateBp: s.rate, unitGrossFils: s.gross }, incl));

  const add = (title: string, forced?: AutoKind) => {
    // In the tap: the keyboard stays up for the next one.
    focus();
    const name = lineName(title.trim());
    if (!name) return;
    const s = sugOf(name);
    // The kind: forced by the row above the keyboard, else the suggestion's own, else what the name says (v0.91.7).
    const guess = forced ? { kind: forced, sure: true } : auto ? (kindOfMatch.has(name) ? { kind: kindOfMatch.get(name)!, sure: true } : guessKind(name, suggestions, matchPartName(name).known)) : undefined;
    const kindNow: AutoKind = guess?.kind ?? (mode === 'auto' ? 'part' : mode);
    setQ('');
    return run(async () => {
      const lineKind = kindNow === 'part' ? 'part' : 'labor';
      // A name of the history keeps both its languages; a typed one goes where its letters belong.
      const titles = s ? { titleRu: s.titleRu || name, titleEn: s.titleEn || name } : /[а-яё]/i.test(name) ? { titleRu: name } : { titleEn: name };
      // A price typed after «--» — the sale price, as «+ Цена» takes it (with VAT or without, as the line's prices are typed).
      const own = said.priceFils;
      const vat = vatModeOf(s ? { vatRateBp: s.rate, unitGrossFils: s.gross } : undefined, incl);
      const price = own
        ? { ...priceFromEntered(own, b.settings.vatRateBp, vat), vatRateBp: rateFor(vat, b.settings.vatRateBp) }
        : s && s.price > 0
          ? { unitPriceFils: s.price, unitGrossFils: s.gross, ...(s.rate !== undefined ? { vatRateBp: s.rate } : {}) }
          : {};
      const item = await addItem(b.order.id, { kind: lineKind, block: 'A', qty: 1, ...titles, ...price, ...(guess && !guess.sure ? { autoKind: true as const } : {}) });
      // A job's first part brings its labour charge (v0.90, #70): last of the lines, named and priced by itself.
      await ensureLabourLine(b.order.id);
      await syncStage(b.order.id);
      forgetSuggestions();
      haptic('light');
      setAdded((a) => [...a, { id: item.id, title: name, kind: kindNow }]);
      // A part: the app's own dictionary names it in English (and the garage's AI looks it up) — in the background.
      // Every line's name looked at, and the labour charge said by the parts (v0.86).
      aiAfterLine(item.id);
    });
  };
  /** Added by mistake: off the job at once (into its bin, as any draft line taken off). */
  const takeOff = (id: string) => {
    focus();
    setAdded((a) => a.filter((x) => x.id !== id));
    void run(async () => {
      await removeLines([id]);
      haptic('light');
    });
  };

  // The job templates (audit 27/11: seeded, never on the job before) — while nothing is typed, one tap adds the lot.
  const templates = useLiveQuery(() => (opened ? db.jobTemplates.filter((x) => x.active).toArray() : Promise.resolve([] as JobTemplate[])), [opened]);
  const docLang = b.order.docLanguage ?? 'en';
  /** A template line's price from the garage's own history (this car, customer, model…); the template's figure otherwise. */
  const historyPrice = (ti: JobTemplate['items'][number]) => {
    const title = lineName((docLang === 'ru' ? ti.titleRu || ti.titleEn : ti.titleEn || ti.titleRu).trim());
    const s = (ti.kind === 'part' ? suggestions?.part : suggestions?.work)?.list.get(title);
    return s && s.price > 0 && s.from !== 'list' ? { unitPriceFils: s.price, unitGrossFils: s.gross, ...(s.rate !== undefined ? { vatRateBp: s.rate } : {}) } : { unitPriceFils: 0 };
  };
  const addTpl = (tpl: JobTemplate) => {
    focus();
    return run(async () => {
      const lines = await addTemplate(b.order.id, tpl.id, 'A', tpl.items.map(historyPrice));
      await syncStage(b.order.id);
      forgetSuggestions();
      haptic('light');
      setAdded((a) => [...a, ...lines.map((l) => ({ id: l.id, title: lineName((docLang === 'ru' ? l.titleRu || l.titleEn : l.titleEn || l.titleRu) ?? ''), kind: (l.kind === 'part' ? 'part' : 'labor') as AutoKind }))]);
    });
  };
  // What usually goes with what was just added (domain/together.ts): not on the job yet, a tap adds it.
  const onJob = useMemo(() => b.items.flatMap((i) => [i.titleEn, i.titleRu].filter((x): x is string => !!x)), [b.items]);
  const hints = useMemo(() => hintsFor(suggestions?.together, added.map((a) => a.title), [...onJob, ...added.map((a) => a.title)]), [suggestions, added, onJob]);
  const idle = !q.trim();

  const placeholder = t(mode === 'auto' ? 'qa.autoPlaceholder' : mode === 'part' ? 'qi.partPlaceholder' : mode === 'labor' ? 'qi.workPlaceholder' : 'qi.servicePlaceholder');
  return (
    <Modal opened={opened} onClose={onClose} title={added.length ? t('qa.addedN', { n: added.length }) : t('qa.title')} classNames={{ content: 'sheet-grouped qa-sheet' }}>
      <div className="qa-body">
        {added.length > 0 && (
          // What this sheet added: each a tap away from coming off again.
          <div className="qa-added" aria-label={t('qa.addedN', { n: added.length })}>
            {added.map((a) => (
              <span key={a.id} className="qa-added-name" data-kind={a.kind}>
                <span className="qa-added-text">{a.title}</span>
                <button type="button" className="qa-added-x" aria-label={t('qa.undo', { name: a.title })} onMouseDown={keep} onClick={() => takeOff(a.id)}>
                  <IconX size={14} stroke={2.6} />
                </button>
              </span>
            ))}
          </div>
        )}
        {idle && (hints.length > 0 || (!added.length && !!templates?.length)) && (
          <div className="qa-hints">
            {hints.length > 0 && (
              <>
                <Text className="qa-hints-title">{t('qa.together')}</Text>
                <div className="chip-row" data-qa-together>
                  {hints.map((h) => (
                    <button key={h.title} type="button" className="chip" onMouseDown={keep} onClick={() => add(h.title, h.kind)}>
                      <IconPlus size={14} stroke={2.4} aria-hidden />
                      {h.title}
                    </button>
                  ))}
                </div>
              </>
            )}
            {!added.length && !!templates?.length && (
              <>
                <Text className="qa-hints-title">{t('qa.templates')}</Text>
                <div className="chip-row" data-qa-templates>
                  {templates.map((tpl) => (
                    <button key={tpl.id} type="button" className="chip" onMouseDown={keep} onClick={() => addTpl(tpl)}>
                      {uiLang === 'ru' ? tpl.titleRu : tpl.titleEn}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {(matches.length > 0 || typed) && (
          <div className="qa-list ios-group" role="listbox" aria-label={t('qi.frequent')}>
            {typed && !exact && (
              <button type="button" role="option" aria-selected={false} className="qa-row qa-new" onMouseDown={keep} onClick={() => add(typed)}>
                <IconPlus size={18} stroke={2.4} aria-hidden />
                <span className="qa-name">{t('qa.addTyped', { name: typed })}</span>
                {/* v0.91.7: put right by the dictionary as it was typed; and its kind as the name says it. */}
                {fixedName && <span className="qa-fixed" data-qa-fixed>{t('qa.fixed')}</span>}
                {typedGuess && <KindMark kind={typedGuess.kind} unsure={!typedGuess.sure} />}
                {said.priceFils && (
                  <Text span className="qa-price tnum" data-typed-price>
                    {formatAed(said.priceFils, uiLang, false)}
                  </Text>
                )}
              </button>
            )}
            {matches.map((title) => {
              const s = sugOf(title);
              if (!s) return null;
              const side = sideOf(title);
              const k = auto ? kindOfMatch.get(title) : undefined;
              return (
                <button key={title} type="button" role="option" aria-selected={title === exact} className="qa-row" data-side={side} onMouseDown={keep} onClick={() => add(title)}>
                  <span className="qa-name">{title}</span>
                  {k && <KindMark kind={k} />}
                  {said.priceFils ? (
                    <Text span className="qa-price tnum" data-typed-price>
                      {formatAed(said.priceFils, uiLang, false)}
                    </Text>
                  ) : (
                    s.price > 0 && (
                      <Text span className="qa-price tnum">
                        {formatAed(shown(s), uiLang, false)}
                        <PriceFromMark from={s.from} />
                      </Text>
                    )
                  )}
                </button>
              );
            })}
          </div>
        )}
        <TextInput
          ref={field}
          className="qa-field"
          aria-label={placeholder}
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          data-autofocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="next"
          leftSection={<IconSearch size={18} stroke={2} />}
          rightSection={
            typed ? (
              <ActionIcon size={34} radius="xl" variant="filled" aria-label={t('qa.add')} onMouseDown={keep} onClick={() => add(exact ?? typed)}>
                <IconArrowUp size={18} stroke={2.6} />
              </ActionIcon>
            ) : undefined
          }
          rightSectionWidth={44}
          rightSectionPointerEvents="all"
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (typed) add(exact ?? typed);
          }}
        />
        {/* The kind, right above the keyboard: one tap — the keyboard stays. */}
        <div className="qa-kinds" role="radiogroup" aria-label={t('qa.kind')}>
          {KINDS.map(({ kind: k, icon: I, color, label }) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={mode === k}
              data-active={mode === k}
              className="qa-kind"
              style={{ '--c': `var(--mantine-color-${color}-6)` } as React.CSSProperties}
              onMouseDown={keep}
              onClick={() => {
                focus();
                if (mode !== k) haptic('selection');
                setMode(k);
              }}
              data-qa-mode={k}
            >
              <I size={17} stroke={2.1} aria-hidden />
              <span>{t(label)}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
