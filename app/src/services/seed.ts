import { db, uid } from '../db/db';
import type { ExpenseCategory, JobTemplate, RelatedRule, TemplateItem } from '../domain/types';
import { DEFAULT_SETTINGS, withGarageIdentity } from './settings';

const aed = (n: number) => Math.round(n * 100);

function L(titleRu: string, titleEn: string, price: number, qty = 1, unit: TemplateItem['unit'] = 'pcs'): TemplateItem {
  return { kind: 'labor', block: 'A', titleRu, titleEn, qty, unit, unitPriceFils: aed(price) };
}
function P(titleRu: string, titleEn: string, price: number, qty = 1, unit: TemplateItem['unit'] = 'pcs'): TemplateItem {
  return { kind: 'part', block: 'A', titleRu, titleEn, qty, unit, unitPriceFils: aed(price) };
}
function F(titleRu: string, titleEn: string, price: number): TemplateItem {
  return { kind: 'fee', block: 'A', titleRu, titleEn, qty: 1, unit: 'pcs', unitPriceFils: aed(price) };
}

// Starter price list. Prices are placeholders (net, AED) to be replaced with the garage's real prices.
const TEMPLATES: Omit<JobTemplate, 'id' | 'active'>[] = [
  { code: 'diagnostics', titleRu: 'Компьютерная диагностика', titleEn: 'Computer diagnostics', items: [F('Компьютерная диагностика', 'Computer diagnostics', 150)] },
  {
    code: 'oil_service',
    titleRu: 'ТО: масло и фильтр',
    titleEn: 'Service: oil & filter',
    items: [L('Замена масла и масляного фильтра', 'Oil and oil filter change', 80), P('Моторное масло 5W-30', 'Engine oil 5W-30', 120, 1, 'set'), P('Масляный фильтр', 'Oil filter', 35)],
  },
  {
    code: 'filters',
    titleRu: 'Замена воздушного и салонного фильтров',
    titleEn: 'Air and cabin filter replacement',
    items: [L('Замена фильтров', 'Filter replacement', 40), P('Воздушный фильтр', 'Air filter', 60), P('Фильтр салона', 'Cabin filter', 60)],
  },
  {
    code: 'brake_pads_front',
    titleRu: 'Замена передних колодок',
    titleEn: 'Front brake pads replacement',
    items: [L('Замена передних тормозных колодок', 'Front brake pads replacement', 120), P('Колодки передние (комплект)', 'Front brake pads (set)', 180, 1, 'set')],
  },
  {
    code: 'brake_pads_rear',
    titleRu: 'Замена задних колодок',
    titleEn: 'Rear brake pads replacement',
    items: [L('Замена задних тормозных колодок', 'Rear brake pads replacement', 120), P('Колодки задние (комплект)', 'Rear brake pads (set)', 160, 1, 'set')],
  },
  {
    code: 'ac_service',
    titleRu: 'Обслуживание кондиционера',
    titleEn: 'A/C service',
    items: [L('Проверка и заправка кондиционера', 'A/C check and recharge', 150), P('Хладагент', 'Refrigerant', 100)],
  },
  { code: 'battery', titleRu: 'Замена аккумулятора', titleEn: 'Battery replacement', items: [L('Замена аккумулятора', 'Battery replacement', 30), P('Аккумулятор', 'Battery', 350)] },
  {
    code: 'spark_plugs',
    titleRu: 'Замена свечей зажигания',
    titleEn: 'Spark plugs replacement',
    items: [L('Замена свечей зажигания', 'Spark plugs replacement', 100), P('Свеча зажигания', 'Spark plug', 30, 4)],
  },
  {
    code: 'timing_belt',
    titleRu: 'Замена ремня ГРМ',
    titleEn: 'Timing belt replacement',
    items: [L('Замена ремня ГРМ', 'Timing belt replacement', 600), P('Комплект ГРМ (ремень, ролики)', 'Timing belt kit', 450, 1, 'set')],
  },
  { code: 'clutch', titleRu: 'Замена сцепления', titleEn: 'Clutch replacement', items: [L('Замена сцепления', 'Clutch replacement', 900), P('Комплект сцепления', 'Clutch kit', 1200, 1, 'set')] },
  {
    code: 'suspension_links',
    titleRu: 'Замена стоек стабилизатора',
    titleEn: 'Stabilizer links replacement',
    items: [L('Замена стоек стабилизатора', 'Stabilizer links replacement', 150), P('Стойка стабилизатора', 'Stabilizer link', 90, 2)],
  },
  {
    code: 'coolant_flush',
    titleRu: 'Замена охлаждающей жидкости',
    titleEn: 'Coolant flush',
    items: [L('Замена охлаждающей жидкости', 'Coolant flush', 120), P('Антифриз', 'Coolant', 80, 1, 'set')],
  },
  { code: 'alignment', titleRu: 'Развал-схождение', titleEn: 'Wheel alignment', items: [L('Развал-схождение', 'Wheel alignment', 120)] },
];

const RELATED: Omit<RelatedRule, 'id'>[] = [
  { triggerTemplateCode: 'brake_pads_front', titleRu: 'Передние тормозные диски', titleEn: 'Front brake discs', priceMinFils: aed(300), priceMaxFils: aed(500) },
  { triggerTemplateCode: 'brake_pads_front', titleRu: 'Датчик износа колодок', titleEn: 'Brake wear sensor', priceMinFils: aed(40), priceMaxFils: aed(80) },
  { triggerTemplateCode: 'brake_pads_rear', titleRu: 'Задние тормозные диски', titleEn: 'Rear brake discs', priceMinFils: aed(250), priceMaxFils: aed(450) },
  { triggerTemplateCode: 'timing_belt', titleRu: 'Помпа (водяной насос)', titleEn: 'Water pump', priceMinFils: aed(200), priceMaxFils: aed(400) },
  { triggerTemplateCode: 'timing_belt', titleRu: 'Приводной ремень', titleEn: 'Drive belt', priceMinFils: aed(80), priceMaxFils: aed(150) },
  { triggerTemplateCode: 'clutch', titleRu: 'Выжимной подшипник', titleEn: 'Release bearing', priceMinFils: aed(150), priceMaxFils: aed(250) },
  { triggerTemplateCode: 'clutch', titleRu: 'Сальник КПП', titleEn: 'Gearbox oil seal', priceMinFils: aed(50), priceMaxFils: aed(120) },
  { triggerTemplateCode: 'clutch', titleRu: 'Маховик (шлифовка или замена)', titleEn: 'Flywheel (resurface or replace)', priceMinFils: aed(300), priceMaxFils: aed(1500) },
  { triggerTemplateCode: 'oil_service', titleRu: 'Воздушный фильтр', titleEn: 'Air filter', priceMinFils: aed(50), priceMaxFils: aed(90) },
  { triggerTemplateCode: 'oil_service', titleRu: 'Фильтр салона', titleEn: 'Cabin filter', priceMinFils: aed(50), priceMaxFils: aed(90) },
  { triggerTemplateCode: 'ac_service', titleRu: 'Устранение утечки хладагента', titleEn: 'Refrigerant leak repair', priceMinFils: aed(150), priceMaxFils: aed(600) },
  { triggerTemplateCode: 'ac_service', titleRu: 'Фильтр-осушитель', titleEn: 'Receiver drier', priceMinFils: aed(120), priceMaxFils: aed(250) },
  { triggerTemplateCode: 'battery', titleRu: 'Клеммы аккумулятора', titleEn: 'Battery terminals', priceMinFils: aed(20), priceMaxFils: aed(50) },
  { triggerTemplateCode: 'spark_plugs', titleRu: 'Катушка зажигания', titleEn: 'Ignition coil', priceMinFils: aed(150), priceMaxFils: aed(350) },
  { triggerTemplateCode: 'suspension_links', titleRu: 'Сайлентблоки рычагов', titleEn: 'Control arm bushings', priceMinFils: aed(200), priceMaxFils: aed(500) },
  { triggerTemplateCode: 'suspension_links', titleRu: 'Развал-схождение', titleEn: 'Wheel alignment', priceMinFils: aed(120), priceMaxFils: aed(150) },
  { triggerTemplateCode: 'coolant_flush', titleRu: 'Термостат', titleEn: 'Thermostat', priceMinFils: aed(120), priceMaxFils: aed(300) },
  { triggerTemplateCode: 'coolant_flush', titleRu: 'Патрубки системы охлаждения', titleEn: 'Coolant hoses', priceMinFils: aed(80), priceMaxFils: aed(250) },
];

const CATEGORIES: Omit<ExpenseCategory, 'id' | 'active'>[] = [
  { code: 'parts', nameRu: 'Запчасти', nameEn: 'Parts', monthlyLimitFils: 0 },
  { code: 'consumables', nameRu: 'Расходники', nameEn: 'Consumables', monthlyLimitFils: aed(2000) },
  { code: 'rent', nameRu: 'Аренда', nameEn: 'Rent', monthlyLimitFils: 0 },
  { code: 'utilities', nameRu: 'Коммунальные услуги', nameEn: 'Utilities', monthlyLimitFils: aed(1500) },
  { code: 'salaries', nameRu: 'Зарплаты', nameEn: 'Salaries', monthlyLimitFils: 0 },
  { code: 'tools', nameRu: 'Инструмент', nameEn: 'Tools', monthlyLimitFils: aed(1000) },
  { code: 'marketing', nameRu: 'Реклама', nameEn: 'Marketing', monthlyLimitFils: aed(500) },
  { code: 'incidents', nameRu: 'Инциденты', nameEn: 'Incidents', monthlyLimitFils: 0 },
  { code: 'other', nameRu: 'Прочее', nameEn: 'Other', monthlyLimitFils: aed(500) },
];

/** Placeholder names of the two starter mechanics (renamed by the manager in Settings → Staff). */
export const PLACEHOLDER_STAFF = /^(Механик|Mechanic) \d$/;

/** Create default reference data on first start. Safe to call repeatedly. */
export async function ensureSeed(lang: 'ru' | 'en' = 'ru'): Promise<void> {
  const mechanic = lang === 'en' ? 'Mechanic' : 'Механик';
  await db.transaction('rw', [db.settings, db.jobTemplates, db.relatedRules, db.expenseCategories, db.employees], async () => {
    const current = await db.settings.get('main');
    if (!current) await db.settings.put({ ...DEFAULT_SETTINGS });
    else {
      // Installs from before the garage's own documents: fill its details and the Arabic header.
      const patch = withGarageIdentity({ ...DEFAULT_SETTINGS, ...current });
      if (patch) await db.settings.put({ ...current, ...patch });
    }
    if ((await db.jobTemplates.count()) === 0) {
      await db.jobTemplates.bulkAdd(TEMPLATES.map((t) => ({ ...t, id: uid(), active: true })));
      await db.relatedRules.bulkAdd(RELATED.map((r) => ({ ...r, id: uid() })));
    }
    if ((await db.expenseCategories.count()) === 0) {
      await db.expenseCategories.bulkAdd(CATEGORIES.map((c) => ({ ...c, id: uid(), active: true })));
    } else {
      // Parts bought for a job are now expenses linked to it: the old name "(not for orders)" no longer fits.
      const parts = await db.expenseCategories.where('code').equals('parts').first();
      if (parts?.nameRu === 'Запчасти (не по заказам)') await db.expenseCategories.update(parts.id, { nameRu: 'Запчасти', nameEn: 'Parts' });
    }
    if ((await db.employees.count()) === 0) {
      await db.employees.bulkAdd([
        { id: uid(), name: `${mechanic} 1`, role: 'mechanic', monthlySalaryFils: 0, active: true },
        { id: uid(), name: `${mechanic} 2`, role: 'electrician', monthlySalaryFils: 0, active: true },
      ]);
    }
  });
}
