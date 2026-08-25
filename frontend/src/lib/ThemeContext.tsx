import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * The three "premium lounge" color themes the design pass in
 * docs/ (see the mockup exploration that preceded this) settled on —
 * velvet, copper, jade. Every one of styles/theme.css's --hp-* tokens
 * is redefined per theme under a `[data-hp-theme="…"]` selector, so
 * switching HP_THEMES only ever means picking one of these three ids;
 * a component should never reach for a raw color, only the tokens.
 *
 * This is deliberately a closed set (not a free-form color picker) —
 * per product decision, future pages are meant to be designed against
 * one of these three, not an arbitrary palette. Adding a fourth theme
 * later means adding one more id here plus its token block in
 * theme.css, nothing else.
 */
export const HP_THEMES = ['velvet', 'copper', 'jade'] as const

export type HpTheme = (typeof HP_THEMES)[number]

const DEFAULT_THEME: HpTheme = 'velvet'
const STORAGE_KEY = 'hp-theme'

function isHpTheme(value: string | null): value is HpTheme {
  return value != null && (HP_THEMES as readonly string[]).includes(value)
}

function readStoredTheme(): HpTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isHpTheme(stored) ? stored : DEFAULT_THEME
  } catch {
    // localStorage can throw (private browsing, disabled storage) —
    // falling back to the default is fine, it just won't persist.
    return DEFAULT_THEME
  }
}

interface ThemeState {
  theme: HpTheme
  setTheme: (theme: HpTheme) => void
}

const ThemeContext = createContext<ThemeState>({ theme: DEFAULT_THEME, setTheme: () => {} })

/**
 * Applies the active theme to `<html data-hp-theme="…">` — the root
 * element rather than `.hp-page` itself, so a theme choice also reaches
 * anything rendered outside the profile tab in the future (a modal, a
 * toast) without every such surface needing its own data attribute.
 * Persists the choice to localStorage so it survives a reload; when
 * themes are eventually gated behind a paid unlock, this is the single
 * place that would grow that check (see setTheme).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<HpTheme>(readStoredTheme)

  useEffect(() => {
    document.documentElement.dataset.hpTheme = theme
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Best-effort persistence only — see readStoredTheme().
    }
  }, [theme])

  function setTheme(next: HpTheme) {
    setThemeState(next)
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useHpTheme(): ThemeState {
  return useContext(ThemeContext)
}
