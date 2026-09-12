import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/ui'
import { useMe } from '../lib/MeContext'
import { useTheme, THEMES } from '../lib/ThemeContext'
import { clearDevUserChoice, isRealTelegramLaunch } from '../lib/session'
import {
  IconChevron,
  IconMoon,
  IconSun,
  IconUsers,
  IconWallet,
} from '../components/icons'

/**
 * Settings — everything that used to hang off the bottom of the profile
 * tab as a stack of loose Sections.
 *
 * Why it is its own screen: those rows were configuration, and the
 * profile is something people LOOK at — a visitor's profile shows none
 * of them, so the tab had two unrelated halves whose length depended on
 * whose profile you were on. One tap from the profile's own header gets
 * here, which is within the two-tap rule in
 * docs/design-system/03-patterns.md.
 *
 * Grouped by what each row is about, in the order someone looks for
 * them: their account, then their money, then how the app itself behaves.
 */
export default function Settings() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { me } = useMe()
  const { theme, setTheme } = useTheme()

  return (
    <div className="ui-page">
      <PageHeader title={t('settings.title')} onBack={() => navigate(-1)} />

      <div className="ui-page-body">
        <section className="ui-section">
          <h2 className="ui-section-title">{t('settings.accountGroup')}</h2>
          <div className="ui-list">
            <button className="ui-row" onClick={() => navigate('/follow-requests')}>
              <span className="ui-row-media">
                <IconUsers size={20} />
              </span>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('followRequests.link')}</span>
              </span>
              <span className="ui-row-trailing">
                {/* The badge is the only notification a follow request
                    gets — there is no push system yet — so it has to be
                    visible from the row itself, not only once you open
                    it. */}
                {(me?.pending_follow_requests_count ?? 0) > 0 && (
                  <span className="ui-badge">
                    {me!.pending_follow_requests_count.toLocaleString(i18n.language)}
                  </span>
                )}
                <IconChevron size={20} />
              </span>
            </button>

            <button className="ui-row" onClick={() => navigate('/profile/edit')}>
              <span className="ui-row-media">
                <IconUsers size={20} />
              </span>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('profilePage.editButton')}</span>
              </span>
              <span className="ui-row-trailing">
                <IconChevron size={20} />
              </span>
            </button>
          </div>
        </section>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('settings.walletGroup')}</h2>
          <div className="ui-list">
            <button className="ui-row" onClick={() => navigate('/wallet')}>
              <span className="ui-row-media">
                <IconWallet size={20} />
              </span>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('wallet.title')}</span>
              </span>
              <span className="ui-row-trailing">
                <IconChevron size={20} />
              </span>
            </button>
          </div>
        </section>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('settings.appGroup')}</h2>

          {/* Both of these take effect the moment they are tapped, so
              neither is a row that leads somewhere — the control IS the
              row's trailing slot. */}
          <div className="ui-list">
            <div className="ui-row">
              <span className="ui-row-main">
                <span className="ui-row-title">{t('profilePage.themeLabel')}</span>
              </span>
              <span className="ui-row-trailing">
                <div className="st-segment" role="group" aria-label={t('profilePage.themeLabel')}>
                  {THEMES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`st-segment-option${theme === option ? ' st-segment-option-active' : ''}`}
                      aria-pressed={theme === option}
                      onClick={() => setTheme(option)}
                    >
                      {option === 'dark' ? <IconMoon size={16} /> : <IconSun size={16} />}
                      {t(option === 'dark' ? 'profilePage.themeDark' : 'profilePage.themeLight')}
                    </button>
                  ))}
                </div>
              </span>
            </div>

            <div className="ui-row">
              <span className="ui-row-main">
                <span className="ui-row-title">{t('common.language')}</span>
              </span>
              <span className="ui-row-trailing">
                <div className="st-segment" role="group" aria-label={t('common.language')}>
                  {/* Each language is labelled in ITSELF, never
                      translated — someone who has landed in the wrong
                      language has to be able to find their way out. */}
                  <button
                    type="button"
                    className={`st-segment-option${i18n.language === 'fa' ? ' st-segment-option-active' : ''}`}
                    aria-pressed={i18n.language === 'fa'}
                    onClick={() => i18n.changeLanguage('fa')}
                  >
                    فارسی
                  </button>
                  <button
                    type="button"
                    className={`st-segment-option${i18n.language === 'en' ? ' st-segment-option-active' : ''}`}
                    aria-pressed={i18n.language === 'en'}
                    onClick={() => i18n.changeLanguage('en')}
                  >
                    English
                  </button>
                </div>
              </span>
            </div>
          </div>
        </section>

        {/* Only outside a real Telegram launch: in the app itself there
            is no user to switch to. */}
        {!isRealTelegramLaunch() && (
          <section className="ui-section">
            <h2 className="ui-section-title">{t('settings.devGroup')}</h2>
            <div className="ui-list">
              <button
                className="ui-row"
                onClick={() => {
                  clearDevUserChoice()
                  window.location.reload()
                }}
              >
                <span className="ui-row-main">
                  <span className="ui-row-title">{t('login.switchUser')}</span>
                </span>
                <span className="ui-row-trailing">
                  <IconChevron size={20} />
                </span>
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
