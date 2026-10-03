import type { ReactNode } from 'react'
import { AppRoot } from '@telegram-apps/telegram-ui'
import { useTheme } from '../lib/ThemeContext'

// AppRoot is the Telegram UI kit's theming wrapper. It still wraps the
// tree because a handful of kit components (Spinner, Placeholder, Input)
// are not migrated yet; once they are, both it and the kit's stylesheet
// (imported in main.tsx) come out — the redesign's "one design system, not two" rule.
//
// Left to itself AppRoot picks its own appearance from Telegram (or the
// OS) and paints that colour over the whole tree, which is how the app
// ended up with light text tokens on the kit's dark ground. It is not
// allowed a say: it is told which appearance we are in, so the kit
// components that are still here at least land on the right side.
export function KitRoot({ children }: { children: ReactNode }) {
  const { theme } = useTheme()
  return (
    <AppRoot appearance={theme} className="app-kit-root">
      {children}
    </AppRoot>
  )
}
