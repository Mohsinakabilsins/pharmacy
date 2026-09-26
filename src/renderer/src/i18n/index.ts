import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * Localisation. UI strings are written as t('key', 'English default'), so English needs no
 * resource file. To add Urdu, provide `ur` resources with the same keys and switch
 * Settings → Language; the root `dir` attribute flips to RTL automatically.
 */
export const RTL_LANGUAGES = new Set(['ur', 'ar']);

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: {} }, ur: { translation: {} } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function applyLanguage(lng: string) {
  void i18n.changeLanguage(lng);
  document.documentElement.lang = lng;
  document.documentElement.dir = RTL_LANGUAGES.has(lng) ? 'rtl' : 'ltr';
}

export default i18n;
