import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRoot } from '@telegram-apps/telegram-ui'
import '@telegram-apps/telegram-ui/dist/styles.css'
// Order matters: tokens define the values, base consumes them for the
// document defaults, theme.css (the legacy .hp-* layer, being migrated
// out) reads them last so a not-yet-migrated rule can still win where
// the two overlap. See docs/design-system/README.md.
import './styles/tokens.css'
import './styles/base.css'
import './styles/components/index.css'
import './styles/theme.css'
// Side-effect import: initializes i18next before anything renders, so
// the very first render already has translations available (see
// src/i18n/config.ts).
import './i18n/config.ts'
import App from './App.tsx'
import { ThemeProvider, useTheme } from './lib/ThemeContext.tsx'
import { ToastProvider } from './components/ui'

// AppRoot is the Telegram UI kit's theming wrapper. It still wraps the
// tree because a handful of kit components (Spinner, Placeholder, Input)
// are not migrated yet; once they are, both it and the kit's stylesheet
// above come out — the redesign's "one design system, not two" rule.
//
// Left to itself AppRoot picks its own appearance from Telegram (or the
// OS) and paints that colour over the whole tree, which is how the app
// ended up with light text tokens on the kit's dark ground. It is not
// allowed a say: it is told which appearance we are in, so the kit
// components that are still here at least land on the right side.
function KitRoot({ children }: { children: ReactNode }) {
  const { theme } = useTheme()
  return (
    <AppRoot appearance={theme} className="app-kit-root">
      {children}
    </AppRoot>
  )
}

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
