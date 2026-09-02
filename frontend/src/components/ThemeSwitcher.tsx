import { useTranslation } from 'react-i18next'
import { HP_THEME_MODES, useHpTheme } from '../lib/ThemeContext'

/**
 * Light/Dark toggle — a plain two-option segmented control (see
 * lib/ThemeContext.tsx), placed in the profile tab's settings section
 * next to the language toggle, the same natural spot the previous
 * three-color theme picker lived in.
 */
export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { mode, setMode } = useHpTheme()

  return (
    <div className="hp-theme-switch">
      <span className="hp-theme-switch-label">{t('profilePage.themeLabel')}</span>
      <div className="hp-theme-switch-row">
        {HP_THEME_MODES.map((id) => (
          <button
            key={id}
            type="button"
            className={`hp-segmented-btn ${mode === id ? 'hp-segmented-active' : ''}`}
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
          >
            {t(`profilePage.themeMode_${id}`)}
          </button>
        ))}
      </div>
    </div>
  )
}
