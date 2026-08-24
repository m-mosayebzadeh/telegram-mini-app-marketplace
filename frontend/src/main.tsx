import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRoot } from '@telegram-apps/telegram-ui'
import '@telegram-apps/telegram-ui/dist/styles.css'
// Side-effect import: initializes i18next before anything renders, so
// the very first render already has translations available (see
// src/i18n/config.ts).
import './i18n/config.ts'
import App from './App.tsx'

// AppRoot is the Telegram UI kit's theming wrapper — with no props it
// auto-detects platform (iOS/Android/desktop look) and appearance
// (light/dark) from the Telegram environment, and falls back to
// sensible defaults in a plain browser (see src/lib/api.ts for the
// matching fallback on the data side).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot>
      <App />
    </AppRoot>
  </StrictMode>,
)
