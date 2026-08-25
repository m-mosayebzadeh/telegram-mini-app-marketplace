import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRoot } from '@telegram-apps/telegram-ui'
import '@telegram-apps/telegram-ui/dist/styles.css'
import './styles/theme.css'
// Side-effect import: initializes i18next before anything renders, so
// the very first render already has translations available (see
// src/i18n/config.ts).
import './i18n/config.ts'
import App from './App.tsx'
import { ThemeProvider } from './lib/ThemeContext.tsx'

// AppRoot is the Telegram UI kit's theming wrapper — with no props it
// auto-detects platform (iOS/Android/desktop look) and appearance
// (light/dark) from the Telegram environment, and falls back to
// sensible defaults in a plain browser (see src/lib/api.ts for the
// matching fallback on the data side).
//
// ThemeProvider wraps everything else — it stamps data-hp-theme onto
// <html> before styles/theme.css's tokens can matter to any component
// — and sits outside AppRoot rather than inside it: the "premium
// lounge" palette (velvet/copper/jade) is a brand choice independent
// of AppRoot's own Telegram platform/light-dark detection.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AppRoot>
        <App />
      </AppRoot>
    </ThemeProvider>
  </StrictMode>,
)
