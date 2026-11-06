import { db } from '../db/db';
import type { Employee, ExpenseCategory, JobTemplate, Settings } from '../domain/types';
import { AppError } from './errors';

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  name: 'MyGarage',
  address: '',
  phone: '',
  email: '',
  trn: '',
  bankDetails: '',
  googleMapsUrl: '',
  vatRateBp: 500,
  pricesIncludeVat: false,
  defaultMarkupBp: 3000,
  laborRateFils: 15000,
  defaultNoCallLimitFils: 20000,
  prepaymentThresholdFils: 30000,
  estimateValidityDays: 7,
  freeStorageDays: 3,
  storageFeePerDayFils: 5000,
  diagnosticsFeeFils: 15000,
  warrantyLaborMonths: 3,
  warrantyLaborKm: 5000,
  boardWarnHours: 2,
  boardAlertHours: 24,
  intakeTerms: {
    ru:
      'Клиент подтверждает, что состояние автомобиля, указанное в акте и на фотографиях, соответствует действительности на момент приёмки. ' +
      'Мастерская не отвечает за повреждения и неисправности, зафиксированные в акте. ' +
      'Работы сверх согласованных выполняются только с согласия клиента, кроме работ в пределах лимита без звонка. ' +
      'Мастерская не отвечает за ценные вещи, оставленные в автомобиле и не указанные в акте.',
    en:
      'The customer confirms that the condition of the vehicle recorded in this act and in the photos is accurate at the time of drop-off. ' +
      'The workshop is not responsible for damage and faults recorded in this act. ' +
      'Work beyond what was approved is done only with the customer’s consent, except work within the no-call limit. ' +
      'The workshop is not responsible for valuables left in the vehicle and not listed in this act.',
  },
  warrantyText: {
    ru:
      'Гарантия на выполненные работы — {months} мес. или {km} км (что наступит раньше). На запчасти — по условиям производителя/поставщика. ' +
      'На запчасти, предоставленные клиентом, гарантия не распространяется.',
    en:
      'Workmanship warranty: {months} months or {km} km, whichever comes first. Parts are covered by the manufacturer/supplier warranty. ' +
      'Parts supplied by the customer are not covered.',
  },
  docFooter: { ru: 'Спасибо, что выбрали нас!', en: 'Thank you for choosing us!' },
  setupDone: false,
};

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('main');
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'main' });
}

/** Save a job template; editing the price list ticks "prices reviewed" in the setup checklist. */
export async function saveTemplate(t: JobTemplate): Promise<void> {
  if (!t.titleRu.trim() && !t.titleEn.trim()) throw new AppError('err.titleRequired');
  await db.transaction('rw', db.jobTemplates, db.settings, async () => {
    await db.jobTemplates.put({ ...t, titleRu: t.titleRu.trim(), titleEn: t.titleEn.trim() });
    await saveSettings({ pricesReviewed: true });
  });
}

export async function saveEmployee(e: Employee): Promise<void> {
  if (!e.name.trim()) throw new AppError('err.nameRequired');
  await db.employees.put({ ...e, name: e.name.trim() });
}

export async function saveCategory(c: ExpenseCategory): Promise<void> {
  if (!c.nameRu.trim() && !c.nameEn.trim()) throw new AppError('err.nameRequired');
  await db.expenseCategories.put({ ...c, nameRu: c.nameRu.trim(), nameEn: c.nameEn.trim() });
}
