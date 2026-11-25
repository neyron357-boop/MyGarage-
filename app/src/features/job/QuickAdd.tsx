import { ActionIcon, Modal, Text, TextInput } from '@mantine/core';
import { IconArrowUp, IconBuildingStore, IconPackage, IconPlus, IconSearch, IconTool, IconX, type Icon } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lineName } from '../../domain/items';
import type { Suggestion, SuggestionSet } from '../../domain/linePrices';
import { formatAed } from '../../domain/money';
import { exactTitle, quickMatches, sideOf } from '../../domain/quickAdd';
import { enteredPrice, vatModeOf } from '../../domain/vat';
import { aiAfterLine } from '../../services/ai';
import { addItem } from '../../services/estimate';
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

const KINDS: { kind: LineKind; icon: Icon; color: string; label: string }[] = [
  { kind: 'part', icon: IconPackage, color: 'orange', label: 'job.addPart' },
  { kind: 'labor', icon: IconTool, color: 'blue', label: 'qa.labor' },
  { kind: 'service', icon: IconBuildingStore, color: 'violet', label: 'job.addService' },
];

/** Taps on the sheet's buttons keep the field's focus (and the keyboard): a mouse's press does not take it either. */
const keep = (e: React.MouseEvent) => e.preventDefault();

export function QuickAddSheet({ b, kind, opened, onClose, suggestions }: { b: OrderBundle; kind: LineKind; opened: boolean; onClose: () => void; suggestions?: SuggestionSet }) {
  const { t } = useTranslation();
  const uiLang = useLang();
  const { run } = useAction();
  const [mode, setMode] = useState<LineKind>(kind);
  const [q, setQ] = useState('');
  const [added, setAdded] = useState<{ id: string; title: string }[]>([]);
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

  // Work and services: the labour charges / the rest at first; typing finds any of them (linePrices.ts).
  const set = !suggestions ? undefined : mode === 'part' ? suggestions.part : q.trim() ? suggestions.work : suggestions[mode];
  const matches = useMemo(() => quickMatches(set, q, 8), [set, q]);
  const exact = exactTitle(set, q);
  const typed = lineName(q.trim());
  const incl = b.settings.pricesIncludeVat;
  /** A suggestion's price as the line will show it (with VAT if it was typed with VAT). */
  const shown = (s: Suggestion) => enteredPrice({ unitPriceFils: s.price, unitGrossFils: s.gross }, s.rate || b.settings.vatRateBp, vatModeOf({ vatRateBp: s.rate, unitGrossFils: s.gross }, incl));

  const add = (title: string) => {
    // In the tap: the keyboard stays up for the next one.
    focus();
    const name = lineName(title.trim());
    if (!name) return;
    const s = set?.list.get(name);
    setQ('');
    return run(async () => {
      const lineKind = mode === 'part' ? 'part' : 'labor';
      // A name of the history keeps both its languages; a typed one goes where its letters belong.
      const titles = s ? { titleRu: s.titleRu || name, titleEn: s.titleEn || name } : /[а-яё]/i.test(name) ? { titleRu: name } : { titleEn: name };
      const price = s && s.price > 0 ? { unitPriceFils: s.price, unitGrossFils: s.gross, ...(s.rate !== undefined ? { vatRateBp: s.rate } : {}) } : {};
      const item = await addItem(b.order.id, { kind: lineKind, block: 'A', qty: 1, ...titles, ...price });
      await syncStage(b.order.id);
      forgetSuggestions();
      haptic('light');
      setAdded((a) => [...a, { id: item.id, title: name }]);
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

  const placeholder = t(mode === 'part' ? 'qi.partPlaceholder' : mode === 'labor' ? 'qi.workPlaceholder' : 'qi.servicePlaceholder');
  return (
    <Modal opened={opened} onClose={onClose} title={added.length ? t('qa.addedN', { n: added.length }) : t('qa.title')} classNames={{ content: 'sheet-grouped qa-sheet' }}>
      <div className="qa-body">
        {added.length > 0 && (
          // What this sheet added: each a tap away from coming off again.
          <div className="qa-added" aria-label={t('qa.addedN', { n: added.length })}>
            {added.map((a) => (
              <span key={a.id} className="qa-added-name">
                <span className="qa-added-text">{a.title}</span>
                <button type="button" className="qa-added-x" aria-label={t('qa.undo', { name: a.title })} onMouseDown={keep} onClick={() => takeOff(a.id)}>
                  <IconX size={14} stroke={2.6} />
                </button>
              </span>
            ))}
          </div>
        )}
        {(matches.length > 0 || typed) && (
          <div className="qa-list ios-group" role="listbox" aria-label={t('qi.frequent')}>
            {typed && !exact && (
              <button type="button" role="option" aria-selected={false} className="qa-row qa-new" onMouseDown={keep} onClick={() => add(typed)}>
                <IconPlus size={18} stroke={2.4} aria-hidden />
                <span className="qa-name">{t('qa.addTyped', { name: typed })}</span>
              </button>
            )}
            {matches.map((title) => {
              const s = set!.list.get(title)!;
              const side = sideOf(title);
              return (
                <button key={title} type="button" role="option" aria-selected={title === exact} className="qa-row" data-side={side} onMouseDown={keep} onClick={() => add(title)}>
                  <span className="qa-name">{title}</span>
                  {s.price > 0 && (
                    <Text span className="qa-price tnum">
                      {formatAed(shown(s), uiLang, false)}
                      <PriceFromMark from={s.from} />
                    </Text>
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
