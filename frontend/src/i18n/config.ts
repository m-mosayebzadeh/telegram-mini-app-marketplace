/**
 * i18n setup (see docs/TECHNICAL_REQUIREMENTS.md, section 11 — the app
 * must be bilingual, Persian and English, defaulting to Persian).
 *
 * Imported once, for its side effect, before the app renders (see
 * main.tsx) — every component then just calls useTranslation() and
 * never imports these resource files directly.
 *
 * Deliberately NOT doing anything about right-to-left layout here —
 * TECHNICAL_REQUIREMENTS.md is explicit that text direction is a final
 * UI polish concern, not something to solve at this scaffolding stage.
 * This file is only about which STRINGS show up, not how they're laid
 * out on screen.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fa from './locales/fa.json'

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

export default i18n
