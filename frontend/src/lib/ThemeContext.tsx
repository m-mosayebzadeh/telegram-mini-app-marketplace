import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Light/Dark mode — see docs/MODERN_DESIGN_SPECIFICATION.md. Replaces
 * the previous three-way "premium lounge" color-palette picker
 * (velvet/copper/jade): this app now has exactly one visual system
 * (Modern Monochrome Social, defined entirely as semantic --color-*
 * tokens in styles/theme.css), and the only thing a person actually
 * chooses is which of its two value sets — light or dark — is active.
 */
export const HP_THEME_MODES = ['light', 'dark'] as const

export type HpThemeMode = (typeof HP_THEME_MODES)[number]

const STORAGE_KEY = 'hp-theme-mode'

function isThemeMode(value: string | null): value is HpThemeMode {
  return value != null && (HP_THEME_MODES as readonly string[]).includes(value)
}

/**
 * No stored choice yet (first visit, or storage was cleared) falls
 * back to the OS/Telegram color-scheme preference rather than a fixed
 * default — the "least invasive" choice per the redesign brief, since
 * it means a person who already prefers dark mode everywhere else
 * never has to make a choice here just to get it. Once they DO pick
 * one explicitly (see ThemeSwitcher.tsx), that choice always wins,
 * even if their OS preference later changes.
 */
function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function readStoredMode(): HpThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isThemeMode(stored)) return stored
  } catch {
    // localStorage can throw (private browsing, disabled storage) —
    // fall through to the system-preference default below, it just
    // won't persist across reloads.
  }
  return systemPrefersDark() ? 'dark' : 'light'
}

interface ThemeState {
  mode: HpThemeMode
  setMode: (mode: HpThemeMode) => void
}

const ThemeContext = createContext<ThemeState>({ mode: 'light', setMode: () => {} })

/**
 * Applies the active mode to `<html data-theme="light"|"dark">` — the
 * root element rather than any one page, so a theme choice reaches
 * absolutely everything (bottom sheets, modals, the bottom nav) the
 * moment it's set, not just whatever's currently mounted inside a
 * page. Persists the choice to localStorage so it survives a reload
 * (see readStoredMode()).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<HpThemeMode>(readStoredMode)

  useEffect(() => {
    document.documentElement.dataset.theme = mode
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // Best-effort persistence only — see readStoredMode().
    }
  }, [mode])

  function setMode(next: HpThemeMode) {
    setModeState(next)
  }

  return <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>
}

export function useHpTheme(): ThemeState {
  return useContext(ThemeContext)
}
