import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Light and dark are NOT two themes — they are one visual identity in two
 * environments (see docs/design-system/README.md). Every semantic token
 * keeps its name across both; only its value changes, in
 * styles/tokens.css. No component ever branches on the theme.
 *
 * This replaces the previous velvet/copper/jade palette switcher: three
 * differently-hued themes meant the app had no single visual identity at
 * all, which is exactly what the redesign set out to fix.
 */
export type Theme = 'dark' | 'light'

/** Dark only (section 32, step 4: the owner took the theme choice out).
 * This is a night-oriented product, the world is a night sky, and the
 * identity was designed on dark; a light version was a second app to
 * keep in step for nobody's benefit. The type keeps 'light' so the
 * tokens for it can stay until they are cleaned out. */
const DEFAULT_THEME: Theme = 'dark'

function readInitialTheme(): Theme {
  return DEFAULT_THEME
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeState>({ theme: DEFAULT_THEME, setTheme: () => {} })

/**
 * Stamps the active theme onto `<html data-theme="…">` — the root element
 * rather than a page wrapper, so the choice also reaches anything
 * rendered outside the normal tree (sheets, toasts) and the native
 * color-scheme hint in styles/base.css.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  function setTheme(next: Theme) {
    setThemeState(next)
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

// The hook lives beside its provider on purpose: they share one private
// context, and splitting them would make every caller and every test mock
// reach into two modules for one thing.
// oxlint-disable-next-line react/only-export-components
export function useTheme(): ThemeState {
  return useContext(ThemeContext)
}
