import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog, PageHeader, useToast } from '../components/ui'
import { useMe } from '../lib/MeContext'
import { formatApiError } from '../lib/api'
import { deleteAccount, fetchPrivacy, savePrivacy, type ChatDoor, type FriendsSeenBy, type Privacy } from '../lib/accountApi'
import { ChosenViewersSheet } from '../components/profile/ChosenViewersSheet'
import { readLightGraphics, setLightGraphics } from '../lib/lightGraphics'
import { signOut } from '../lib/auth'
import { IconChevron, IconUsers } from '../components/icons'

/**
 * Settings (section 32, step 4): what the owner settled for "me".
 *
 * - You: edit the profile, and follow requests.
 * - Privacy: who may message you, hiding when you are online, and the
 *   people you blocked. Everything starts at the freest setting, and
 *   whoever wants it narrower narrows it (the owner's rule).
 * - The app: the language, and light graphics for phones that need it.
 *   The light/dark choice is gone; the world is a night sky.
 * - Help: report a problem.
 * - The account: deleting it, asked twice.
 *
 * The wallet is not here: the paid layer is hidden (section 32).
 */
export default function Settings() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const { markDeleted } = useMe()

  const [privacy, setPrivacy] = useState<Privacy | null>(null)
  const [lite, setLite] = useState(readLightGraphics)
  const [choosing, setChoosing] = useState(false)
  const [deleting, setDeleting] = useState<0 | 1 | 2>(0)
  const [signingOut, setSigningOut] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    fetchPrivacy()
      .then(setPrivacy)
      .catch(() => setPrivacy({ chat_door: 'open', hide_online: false }))
  }, [])

  // A switch takes effect the moment it is tapped (the design system's
  // rule for switches), so each change is saved at once, and put back if
  // the server says no.
  function changePrivacy(next: Privacy) {
    const before = privacy
    setPrivacy(next)
    savePrivacy(next).catch((err) => {
      setPrivacy(before)
      toast.error(formatApiError(err))
    })
  }

  async function reallyDelete() {
    setDeleteBusy(true)
    try {
      await deleteAccount()
      markDeleted()
    } catch (err) {
      toast.error(formatApiError(err))
      setDeleteBusy(false)
      setDeleting(0)
    }
  }

  const door = (value: ChatDoor, label: string) => (
    <button
      type="button"
      className={`st-segment-option${privacy?.chat_door === value ? ' st-segment-option-active' : ''}`}
      aria-pressed={privacy?.chat_door === value}
      disabled={!privacy}
      onClick={() => privacy && changePrivacy({ ...privacy, chat_door: value })}
    >
      {label}
    </button>
  )

  return (
    <div className="ui-page">
      <PageHeader title={t('settings.title')} onBack={() => navigate(-1)} />

      <div className="ui-page-body">
        <section className="ui-section">
          <h2 className="ui-section-title">{t('settings.youGroup')}</h2>
          <div className="ui-list">
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
          <h2 className="ui-section-title">{t('settings.privacyGroup')}</h2>
          <div className="ui-list">
            <div className="ui-row is-wrap st-stack">
              <span className="ui-row-main">
                <span className="ui-row-title">{t('settings.door')}</span>
                <span className="ui-row-subtitle">{t('settings.doorHint')}</span>
              </span>
              <div className="st-segment" role="group" aria-label={t('settings.door')}>
                {door('open', t('settings.doorOpen'))}
                {door('friends', t('settings.doorFriends'))}
              </div>
            </div>
            <button
              type="button"
              className="ui-row is-wrap"
              role="switch"
              aria-checked={privacy?.hide_online ?? false}
              disabled={!privacy}
              onClick={() => privacy && changePrivacy({ ...privacy, hide_online: !privacy.hide_online })}
            >
              <span className="ui-row-main">
                <span className="ui-row-title">{t('settings.hideOnline')}</span>
                <span className="ui-row-subtitle">{t('settings.hideOnlineHint')}</span>
              </span>
              <span className="ui-row-trailing">
                <span className="ui-switch" aria-hidden="true" aria-checked={privacy?.hide_online ?? false} />
              </span>
            </button>
            <div className="ui-row is-wrap st-stack">
              <span className="ui-row-main">
                <span className="ui-row-title">{t('settings.friendsSeen')}</span>
                <span className="ui-row-subtitle">{t('settings.friendsSeenHint')}</span>
              </span>
              <div className="st-segment st-segment-wrap" role="group" aria-label={t('settings.friendsSeen')}>
                {(['everyone', 'friends', 'chosen', 'nobody'] as FriendsSeenBy[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`st-segment-option${(privacy?.friends_seen_by ?? 'everyone') === value ? ' st-segment-option-active' : ''}`}
                    aria-pressed={(privacy?.friends_seen_by ?? 'everyone') === value}
                    disabled={!privacy}
                    onClick={() => {
                      if (!privacy) return
                      changePrivacy({ ...privacy, friends_seen_by: value })
                      if (value === 'chosen') setChoosing(true)
                    }}
                  >
                    {t(`settings.seen.${value}`)}
                  </button>
                ))}
              </div>
              {privacy?.friends_seen_by === 'chosen' && (
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm st-choose" onClick={() => setChoosing(true)}>
                  {t('settings.chooseViewers')}
                </button>
              )}
            </div>
            <button className="ui-row" onClick={() => navigate('/settings/blocked')}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('settings.blocked')}</span>
              </span>
              <span className="ui-row-trailing">
                <IconChevron size={20} />
              </span>
            </button>
          </div>
        </section>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('settings.appGroup')}</h2>
          <div className="ui-list">
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
            <button
              type="button"
              className="ui-row is-wrap"
              role="switch"
              aria-checked={lite}
              onClick={() => {
                setLite(!lite)
                setLightGraphics(!lite)
              }}
            >
              <span className="ui-row-main">
                <span className="ui-row-title">{t('settings.lite')}</span>
                <span className="ui-row-subtitle">{t('settings.liteHint')}</span>
              </span>
              <span className="ui-row-trailing">
                <span className="ui-switch" aria-hidden="true" aria-checked={lite} />
              </span>
            </button>
          </div>
        </section>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('settings.helpGroup')}</h2>
          <div className="ui-list">
            <button className="ui-row" onClick={() => navigate('/settings/report')}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('settings.report')}</span>
              </span>
              <span className="ui-row-trailing">
                <IconChevron size={20} />
              </span>
            </button>
          </div>
        </section>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('settings.accountGroup')}</h2>
          <div className="ui-list">
            <button className="ui-row" onClick={() => navigate('/settings/ways')}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('ways.title')}</span>
                <span className="ui-row-subtitle">{t('ways.rowHint')}</span>
              </span>
              <span className="ui-row-trailing">
                <IconChevron size={20} />
              </span>
            </button>
            <button className="ui-row" onClick={() => navigate('/settings/sessions')}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('sessions.title')}</span>
                <span className="ui-row-subtitle">{t('sessions.rowHint')}</span>
              </span>
              <span className="ui-row-trailing">
                <IconChevron size={20} />
              </span>
            </button>
            <button className="ui-row" onClick={() => navigate('/link')}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('link.title')}</span>
                <span className="ui-row-subtitle">{t('link.rowHint')}</span>
              </span>
              <span className="ui-row-trailing">
                <IconChevron size={20} />
              </span>
            </button>
            <button className="ui-row" onClick={() => setSigningOut(true)}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('sessions.signOut')}</span>
              </span>
            </button>
            <button className="ui-row" onClick={() => setDeleting(1)}>
              <span className="ui-row-main">
                <span className="ui-row-title ui-text-danger">{t('settings.delete')}</span>
              </span>
            </button>
          </div>
        </section>

      </div>

      {choosing && <ChosenViewersSheet onClose={() => setChoosing(false)} />}

      {signingOut && (
        // Asked once: signing out loses nothing, but it is easy to tap by
        // accident and annoying to come back from.
        <ConfirmDialog
          title={t('sessions.signOutTitle')}
          text={t('sessions.signOutText')}
          confirmLabel={t('sessions.signOut')}
          onCancel={() => setSigningOut(false)}
          onConfirm={() => void signOut()}
        />
      )}

      {/* Asked twice: first what goes and what stays, then once more, with
          the button that does it. */}
      {deleting === 1 && (
        <ConfirmDialog
          title={t('settings.deleteTitle')}
          text={t('settings.deleteText')}
          confirmLabel={t('settings.deleteNext')}
          destructive
          onCancel={() => setDeleting(0)}
          onConfirm={() => setDeleting(2)}
        />
      )}
      {deleting === 2 && (
        <ConfirmDialog
          title={t('settings.deleteSureTitle')}
          text={t('settings.deleteSureText')}
          confirmLabel={t('settings.deleteConfirm')}
          destructive
          loading={deleteBusy}
          onCancel={() => setDeleting(0)}
          onConfirm={() => void reallyDelete()}
        />
      )}
    </div>
  )
}
