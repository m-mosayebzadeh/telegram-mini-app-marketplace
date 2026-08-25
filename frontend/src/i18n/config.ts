/**
 * i18n setup (see docs/TECHNICAL_REQUIREMENTS.md, section 11 — the app
 * must be bilingual, Persian and English, defaulting to Persian).
 *
 * Imported once, for its side effect, before the app renders (see
 * main.tsx) — every component then just calls useTranslation() and
 * never imports these resource files directly.
 *
 * Also keeps <html dir="rtl"|"ltr"> and lang="fa"|"en" in sync with the
 * active language — the CSS itself (theme.css) is already written
 * entirely with logical properties (inset-inline-start/end, text-align:
 * start/end, ...) rather than hardcoded left/right, specifically so this
 * one attribute is the only thing that needed to change to make the
 * whole app render right-to-left for Persian; index.html sets the
 * correct value for the very first paint, this only needs to update it
 * afterward if the user switches language.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fa from './locales/fa.json'

const RTL_LANGUAGES = new Set(['fa'])

function applyDocumentDirection(language: string): void {
  const dir = RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr'
  document.documentElement.dir = dir
  document.documentElement.lang = language
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fa: { translation: fa },
  },
  lng: 'fa', // default language
  fallbackLng: 'fa',
  interpolation: {
    // React already escapes interpolated values when rendering JSX, so
    // i18next doesn't need to do it a second time.
    escapeValue: false,
  },
})

applyDocumentDirection(i18n.language)
i18n.on('languageChanged', applyDocumentDirection)

export default i18n
