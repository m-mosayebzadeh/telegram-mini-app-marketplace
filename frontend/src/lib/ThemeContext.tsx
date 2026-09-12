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
export const THEMES = ['dark', 'light'] as const

export type Theme = (typeof THEMES)[number]

/** Dark is the product's own default surface — this is a night-oriented
 * product and the identity was designed on dark. It is only the fallback
 * though: a stored choice always wins, and with no stored choice we
 * follow whatever the device already prefers. */
const DEFAULT_THEME: Theme = 'dark'
const STORAGE_KEY = 'app-theme'

function isTheme(value: string | null): value is Theme {
  return value != null && (THEMES as readonly string[]).includes(value)
}

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isTheme(stored)) return stored
  } catch {
    // localStorage throws in private browsing / when storage is blocked.
    // Falling through to the system preference is fine — the only thing
    // lost is persistence.
  }
  try {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'
  } catch {
    // matchMedia is missing in some embedded webviews.
  }
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
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Best-effort persistence only — see readInitialTheme().
    }
  }, [theme])

  function setTheme(next: Theme) {
    setThemeState(next)
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext)
}
