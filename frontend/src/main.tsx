import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@telegram-apps/telegram-ui/dist/styles.css'
// Order matters: tokens define the values, base consumes them for the
// document defaults, theme.css (the legacy .hp-* layer, being migrated
// out) reads them last so a not-yet-migrated rule can still win where
// the two overlap. See docs/design-system/README.md.
import './styles/tokens.css'
import './styles/base.css'
import './styles/components/index.css'
import './styles/theme.css'
import './styles/cosmos.css'
import './styles/cosmos-quiet.css'
// Side-effect import: initializes i18next before anything renders, so
// the very first render already has translations available (see
// src/i18n/config.ts).
import './i18n/config.ts'
import App from './App.tsx'
import { ThemeProvider } from './lib/ThemeContext.tsx'
import { KitRoot } from './components/KitRoot'
import { ToastProvider } from './components/ui'
import { applyLightGraphics } from './lib/lightGraphics'

// Before the first paint, so a cheap phone never draws the heavy version
// first (lib/lightGraphics.ts).
applyLightGraphics()

// ThemeProvider stays OUTSIDE KitRoot: it stamps data-theme onto <html>,
// and this app's light/dark identity is its own, not AppRoot's.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <KitRoot>
        {/* Inside KitRoot so the toast inherits the app's tokens, and
            above App so any screen can reach it. */}
        <ToastProvider>
          <App />
        </ToastProvider>
      </KitRoot>
    </ThemeProvider>
  </StrictMode>,
)
