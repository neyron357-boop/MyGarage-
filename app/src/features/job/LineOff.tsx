import { useTranslation } from 'react-i18next';
import { formatAed } from '../../domain/money';
import type { Lang, OrderItem } from '../../domain/types';
import { MoneyInput } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useLang } from '../../ui/hooks';

export type LineOff = OrderItem['lineOff'];

/** As kept: an amount of nothing is no discount. */
export const cleanOff = (o: LineOff): LineOff => (!o || ('grossFils' in o && !(o.grossFils > 0)) || ('pctBp' in o && !(o.pctBp > 0)) ? undefined : o);

/** The percentages offered at a tap. */
const PCTS = [500, 1000, 1500, 2000];

/** A line's own discount in a few characters: «−10 %», «−50,00». */
export function offLabel(off: LineOff, lang: Lang): string {
  if (!off) return '';
  if ('pctBp' in off) return `−${String(off.pctBp / 100).replace('.', lang === 'ru' ? ',' : '.')} %`;
  return `−${formatAed(off.grossFils, lang, false)}`;
}

/**
 * A line's own discount (v0.82, the user: «скидки не общую, а в отдельности на каждую позицию»): 5 · 10 · 15 · 20 % at a
 * tap (again — off), or «Сумма» — an amount off its total with VAT. Inside a sheet's group of rows: its name and what is
 * off now on one line, the chips under it across the row (all five fit a phone of 375 pt).
 */
export function LineOffRow({ value, onChange }: { value: LineOff; onChange: (v: LineOff) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const amount = !!value && 'grossFils' in value;
  return (
    <>
      <div className="ios-row line-off-row">
        <div className="line-off-head">
          <span className="label">{t('lineOff.title')}</span>
          {value && <span className="line-off-note tnum">{offLabel(value, lang)}</span>}
        </div>
        <div className="line-off-chips" role="group" aria-label={t('lineOff.title')}>
          {PCTS.map((bp) => {
            const on = !!value && 'pctBp' in value && value.pctBp === bp;
            return (
              <button
                key={bp}
                type="button"
                className="chip"
                data-active={on}
                aria-pressed={on}
                onClick={() => {
                  haptic('selection');
                  onChange(on ? undefined : { pctBp: bp });
                }}
              >
                {bp / 100} %
              </button>
            );
          })}
          <button
            type="button"
            className="chip"
            data-active={amount}
            aria-pressed={amount}
            onClick={() => {
              haptic('selection');
              onChange(amount ? undefined : { grossFils: 0 });
            }}
          >
            {t('lineOff.amount')}
          </button>
        </div>
      </div>
      {amount && (
        <div className="ios-row rise-enter">
          <span className="label">{t('lineOff.amountLabel')}</span>
          <div className="value" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <MoneyInput label={undefined} ariaLabel={t('lineOff.amountLabel')} value={value.grossFils || undefined} autoFocus onChange={(f) => onChange({ grossFils: f ?? 0 })} />
          </div>
        </div>
      )}
    </>
  );
}
