import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { setDefaultMoneyLang } from '../domain/money';
import type { Lang } from '../domain/types';
import { en } from './en';
import { ru } from './ru';

const STORAGE_KEY = 'mygarage.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    // storage unavailable
  }
  return 'ru';
}

const startLang: Lang = typeof window === 'undefined' ? 'ru' : initialLang();
setDefaultMoneyLang(startLang);

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, en: { translation: en } },
  lng: startLang,
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLang(lang: Lang) {
  setDefaultMoneyLang(lang);
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  document.documentElement.lang = lang;
}

/** Translator for a fixed language (documents and messages use the customer's language). */
export function tFor(lang: Lang) {
  return i18n.getFixedT(lang);
}

export default i18n;
