import { db } from '../db/db';
import type { Employee, ExpenseCategory, JobTemplate, Settings } from '../domain/types';
import { BRAND_LOGO } from './brandLogo';
import { AppError } from './errors';

/**
 * The garage this app is made for, as printed on its invoices (taken from its Eaglecart tax invoice
 * and quotation). New installs start with it; the manager can change everything in Settings.
 */
export const GARAGE_IDENTITY: Pick<Settings, 'name' | 'nameAr' | 'address' | 'addressAr' | 'phone' | 'email' | 'trn' | 'logoDataUrl' | 'docFooterAr'> & { docFooterEn: string } = {
  name: 'RUKN ZAMZAM GARAGE LLC',
  nameAr: 'كراج ركن زمزم ش ذ.م.م',
  address: 'AL QUSAIS INDUSTRIAL 4, Dubai Uae',
  addressAr: 'المنطقة الصناعية الرابعة في القصيص, دبي, دبي, الإمارات العربية المتحدة',
  phone: '+971547888330',
  email: 'ruknzamzamgarage@gmail.com',
  trn: '104547914200003',
  logoDataUrl: BRAND_LOGO,
  docFooterEn: 'Thank you for your business. Standard terms apply.',
  docFooterAr: 'نشكركم على ثقتكم بنا. تطبق الشروط والأحكام القياسية.',
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  name: GARAGE_IDENTITY.name,
  nameAr: GARAGE_IDENTITY.nameAr,
  addressAr: GARAGE_IDENTITY.addressAr,
  docFooterAr: GARAGE_IDENTITY.docFooterAr,
  logoDataUrl: GARAGE_IDENTITY.logoDataUrl,
  address: GARAGE_IDENTITY.address,
  phone: GARAGE_IDENTITY.phone,
  email: GARAGE_IDENTITY.email,
  trn: GARAGE_IDENTITY.trn,
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
      'Работы сверх согласованных выполняются только с согласия клиента. ' +
      'Мастерская не отвечает за ценные вещи, оставленные в автомобиле.',
    en:
      'The customer confirms that the condition of the vehicle recorded in this act and in the photos is accurate at the time of drop-off. ' +
      'The workshop is not responsible for damage and faults recorded in this act. ' +
      'Work beyond what was approved is done only with the customer’s consent. ' +
      'The workshop is not responsible for valuables left in the vehicle.',
  },
  warrantyText: {
    ru:
      'Гарантия на выполненные работы — {months} мес. или {km} км (что наступит раньше). На запчасти — по условиям производителя/поставщика. ' +
      'На запчасти, предоставленные клиентом, гарантия не распространяется.',
    en:
      'Workmanship warranty: {months} months or {km} km, whichever comes first. Parts are covered by the manufacturer/supplier warranty. ' +
      'Parts supplied by the customer are not covered.',
  },
  docFooter: { ru: 'Спасибо, что выбрали нас! Действуют стандартные условия.', en: GARAGE_IDENTITY.docFooterEn },
  setupDone: false,
};

/**
 * Settings saved before the documents were made like the garage's own: still the placeholder name
 * and no TRN → the garage's details and logo; Arabic name/address/footer where they are missing.
 */
export function withGarageIdentity(s: Settings): Partial<Settings> | null {
  const g = GARAGE_IDENTITY;
  const patch: Partial<Settings> = {};
  if (!s.trn.trim() && (!s.name.trim() || s.name === 'MyGarage')) {
    Object.assign(patch, { name: g.name, address: s.address || g.address, phone: s.phone || g.phone, email: s.email || g.email, trn: g.trn, logoDataUrl: s.logoDataUrl || g.logoDataUrl });
  }
  const name = patch.name ?? s.name;
  if (name === g.name) {
    if (s.nameAr === undefined) patch.nameAr = g.nameAr;
    if (s.addressAr === undefined) patch.addressAr = g.addressAr;
    if (!s.logoDataUrl && !patch.logoDataUrl) patch.logoDataUrl = g.logoDataUrl;
  }
  if (s.docFooterAr === undefined) patch.docFooterAr = g.docFooterAr;
  if (s.docFooter?.en === 'Thank you for choosing us!') patch.docFooter = { ...s.docFooter, en: g.docFooterEn };
  return Object.keys(patch).length ? patch : null;
}

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
