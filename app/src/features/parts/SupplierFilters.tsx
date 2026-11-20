import { IconCar, IconMapPin, IconPackage } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMIRATES } from '../../domain/plates';
import { partsType, regionOf, type Region } from '../../domain/supplierTidy';
import type { Lang, Supplier } from '../../domain/types';
import { useLang } from '../../ui/hooks';

/*
 * The supplier base by region, make and kind — new or used since v0.60.2 (v0.60, the user: «больше 1000 контактов… по регионам разделены… фильтр по
 * маркам и тд»): rows of chips with how many each holds — the emirate (then its areas), the make, what they sell. A tap
 * picks, a tap on the picked one lets go. Where a supplier is and what it is about are read, not stored
 * (domain/supplierTidy.ts `regionOf`, `kindsOf`).
 */

export const NO_REGION = '?';

export function emirateName(code: string, lang: Lang): string {
  const e = EMIRATES.find((x) => x.code === code);
  return e ? (lang === 'ru' ? e.ru : e.en) : code;
}

/** A supplier's place in words: «Шарджа · Industrial Area 4». */
export function regionLabel(r: Region | undefined, lang: Lang): string {
  if (!r?.emirate) return '';
  return [emirateName(r.emirate, lang), r.area].filter(Boolean).join(' · ');
}

export interface SupplierFilter {
  region: string;
  area: string;
  make: string;
  /** New or used (v0.60.2: the only two kinds of parts suppliers). */
  type: string;
}

const counted = (keys: string[]) => {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

/** The filters' state and what they let through; each supplier's region and kinds read once a list. */
export function useSupplierFilter(all: Supplier[] | undefined) {
  const [f, setF] = useState<SupplierFilter>({
    region: '',
    area: '',
    make: '',
    type: '',
  });
  const facts = useMemo(() => {
    const regions = new Map<string, Region>();
    const types = new Map<string, Supplier['condition']>();
    for (const s of all ?? []) {
      regions.set(s.id, regionOf(s));
      types.set(s.id, partsType(s));
    }
    return { regions, types };
  }, [all]);
  const pass = (s: Supplier, skip?: keyof SupplierFilter) => {
    const r = facts.regions.get(s.id);
    if (skip !== 'region' && f.region && (r?.emirate ?? NO_REGION) !== f.region) return false;
    if (skip !== 'area' && skip !== 'region' && f.area && r?.area !== f.area) return false;
    if (skip !== 'make' && f.make && !s.makes?.includes(f.make)) return false;
    // «both» is one of the new and one of the used
    if (skip !== 'type' && f.type && ![f.type, 'both'].includes(facts.types.get(s.id) ?? '')) return false;
    return true;
  };
  return {
    f,
    setF,
    facts,
    pass,
    on: !!(f.region || f.area || f.make || f.type),
  };
}

type FilterApi = ReturnType<typeof useSupplierFilter>;

export function SupplierFilters({ all, api }: { all: Supplier[]; api: FilterApi }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { f, setF, facts, pass } = api;
  // Each row counts what the other rows let through: a make's number is in the region picked.
  const regionRow = counted(all.filter((s) => pass(s, 'region')).map((s) => facts.regions.get(s.id)?.emirate ?? NO_REGION));
  const areaRow = f.region ? counted(all.filter((s) => pass(s, 'area')).flatMap((s) => (facts.regions.get(s.id)?.area ? [facts.regions.get(s.id)!.area!] : []))) : [];
  const makeRow = counted(all.filter((s) => pass(s, 'make')).flatMap((s) => s.makes ?? [])).slice(0, 24);
  const typeRow = (['new', 'used'] as const).map((k) => [k, all.filter((s) => pass(s, 'type') && [k, 'both'].includes(facts.types.get(s.id) ?? '')).length] as const);
  const chip = (key: string, label: string, n: number | undefined, active: boolean, onClick: () => void) => (
    <button key={key} type="button" className="chip" data-active={active} onClick={onClick}>
      {label}
      {n !== undefined && <span className="chip-count tnum">{n}</span>}
    </button>
  );
  const pick = (k: keyof SupplierFilter, v: string) =>
    setF((x) => ({
      ...x,
      [k]: x[k] === v ? '' : v,
      ...(k === 'region' ? { area: '' } : {}),
    }));
  return (
    <div className="supplier-filters" data-supplier-filters>
      <div className="chip-row" aria-label={t('suppliers.region')} data-filter="region">
        <IconMapPin size={18} className="filter-icon" aria-hidden />
        {chip('all', t('suppliers.allRegions'), undefined, !f.region, () => setF((x) => ({ ...x, region: '', area: '' })))}
        {regionRow.map(([code, n]) => chip(code, code === NO_REGION ? t('suppliers.noRegion') : emirateName(code, lang), n, f.region === code, () => pick('region', code)))}
      </div>
      {areaRow.length > 1 && (
        <div className="chip-row" aria-label={t('suppliers.area')} data-filter="area">
          {areaRow.map(([a, n]) => chip(a, a, n, f.area === a, () => pick('area', a)))}
        </div>
      )}
      {makeRow.length > 0 && (
        <div className="chip-row" aria-label={t('suppliers.makes')} data-filter="make">
          <IconCar size={18} className="filter-icon" aria-hidden />
          {chip('all', t('suppliers.allMakes'), undefined, !f.make, () => setF((x) => ({ ...x, make: '' })))}
          {makeRow.map(([m, n]) => chip(m, m, n, f.make === m, () => pick('make', m)))}
        </div>
      )}
      <div className="chip-row" aria-label={t('suppliers.condition')} data-filter="type">
        <IconPackage size={18} className="filter-icon" aria-hidden />
        {chip('all', t('suppliers.allKinds'), undefined, !f.type, () => setF((x) => ({ ...x, type: '' })))}
        {typeRow.map(([k, n]) => chip(k, t(`suppliers.cond.${k}`), n, f.type === k, () => pick('type', k)))}
      </div>
    </div>
  );
}
