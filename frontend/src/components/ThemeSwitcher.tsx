import { useTranslation } from 'react-i18next'
import { HP_THEMES, useHpTheme, type HpTheme } from '../lib/ThemeContext'

/**
 * A per-theme swatch color for the switcher dot itself — deliberately
 * NOT read from the CSS custom properties (which only exist for the
 * currently-active theme on :root), so all three options are visible
 * at once regardless of which one is active.
 */
const SWATCH: Record<HpTheme, string> = {
  velvet: '#9b6cff',
  copper: '#c77a4b',
  jade: '#3fae83',
}

/**
 * A row of three tappable color dots — one per HP_THEMES id — for
 * switching the whole app's "premium lounge" palette (see
 * lib/ThemeContext.tsx). Placed in the profile tab's settings section
 * for now, next to the language toggle; this is a plain, always-on
 * switch while the three themes are still free — see product notes on
 * eventually gating some of them behind a paid unlock, at which point
 * this component is where that gate would show up, not ThemeContext.
 */
export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { theme, setTheme } = useHpTheme()

  return (
    <div className="hp-theme-switch">
      <span className="hp-theme-switch-label">{t('profilePage.themeLabel')}</span>
      <div className="hp-theme-switch-row">
        {HP_THEMES.map((id) => (
          <button
            key={id}
            type="button"
            className={`hp-theme-swatch ${theme === id ? 'hp-theme-swatch-active' : ''}`}
            style={{ background: SWATCH[id] }}
            aria-label={t(`profilePage.theme_${id}`)}
            aria-pressed={theme === id}
            onClick={() => setTheme(id)}
          />
        ))}
      </div>
    </div>
  )
}
