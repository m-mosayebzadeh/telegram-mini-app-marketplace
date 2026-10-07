import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useToast } from '../components/ui'
import { QuietChoiceRow, QuietConfirm, QuietPage, QuietRow, QuietSection, QuietSwitchRow } from '../components/cosmos/Quiet'
import { QBell, QFlag, QKey, QDevice, QLeaf, QOut, QPerson, QTwoDevices } from '../components/cosmos/quietIcons'
import { useMe } from '../lib/MeContext'
import { formatApiError } from '../lib/api'
import { deleteAccount, fetchBlocked, fetchPrivacy, savePrivacy, type ChatDoor, type FriendsSeenBy, type Privacy } from '../lib/accountApi'
import { fetchFriendsViewers } from '../lib/friendsApi'
import { ChosenViewersSheet } from '../components/profile/ChosenViewersSheet'
import { readLightGraphics, setLightGraphics } from '../lib/lightGraphics'
import { signOut } from '../lib/auth'
import { pushState, setPushPreview, turnPushOff, turnPushOn, type PushState } from '../lib/push'

/**
 * Settings (section 32, step 4; drawn as the approved prototype, section 42).
 *
 * - You: edit the profile.
 * - Privacy: who may message you, hiding when you are online, who sees
 *   your friends, and the people you blocked — under "you, as others see
 *   you", your own small orb showing what those settings do to it.
 *   Everything starts at the freest setting, and whoever wants it narrower
 *   narrows it (the owner's rule).
 * - The app: the language, notifications, light graphics.
 * - Help: report a problem.
 * - The account: ways in, devices, signing in another device, signing out,
 *   and deleting it, asked twice.
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
  const [chosenCount, setChosenCount] = useState<number | null>(null)
  const [blockedCount, setBlockedCount] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<0 | 1 | 2>(0)
  const [signingOut, setSigningOut] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  useEffect(() => {
    fetchPrivacy()
      .then(setPrivacy)
      .catch(() => setPrivacy({ chat_door: 'open', hide_online: false }))
    fetchBlocked()
      .then((people) => setBlockedCount(people.length))
      .catch(() => setBlockedCount(null))
  }, [])

  // How many people were chosen, for "choose people · 3", read again each
  // time the choosing sheet closes.
  const chosen = privacy?.friends_seen_by === 'chosen'
  useEffect(() => {
    if (!chosen || choosing) return
    fetchFriendsViewers()
      .then((ids) => setChosenCount(ids.length))
      .catch(() => setChosenCount(null))
  }, [chosen, choosing])

  // A switch takes effect the moment it is tapped, so each change is saved
  // at once, and put back if the server says no.
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

  return (
    <QuietPage title={t('settings.title')} onBack={() => navigate(-1)}>
      <QuietSection name={t('settings.youGroup')}>
        <div className="cos-q-rows">
          <QuietRow icon={<QPerson />} title={t('profilePage.editButton')} hint={t('settings.youHint')} onClick={() => navigate('/profile/edit')} />
        </div>
      </QuietSection>

      <QuietSection name={t('settings.privacyGroup')} />
      <SeenByOthers privacy={privacy} />
      <QuietSection className="is-tight">
        <div className="cos-q-rows">
          <QuietChoiceRow<ChatDoor>
            title={t('settings.door')}
            hint={t('settings.doorHint')}
            choices={[
              { value: 'open', label: t('settings.doorOpen') },
              { value: 'friends', label: t('settings.doorFriends') },
            ]}
            value={privacy?.chat_door ?? null}
            disabled={!privacy}
            onChoose={(value) => privacy && changePrivacy({ ...privacy, chat_door: value })}
          />
          <QuietSwitchRow
            title={t('settings.hideOnline')}
            hint={t('settings.hideOnlineHint')}
            on={privacy?.hide_online ?? false}
            disabled={!privacy}
            onToggle={() => privacy && changePrivacy({ ...privacy, hide_online: !privacy.hide_online })}
          />
          <QuietChoiceRow<FriendsSeenBy>
            title={t('settings.friendsSeen')}
            hint={t('settings.friendsSeenHint')}
            choices={(['everyone', 'friends', 'chosen', 'nobody'] as FriendsSeenBy[]).map((value) => ({ value, label: t(`settings.seen.${value}`) }))}
            value={privacy ? (privacy.friends_seen_by ?? 'everyone') : null}
            disabled={!privacy}
            onChoose={(value) => {
              if (!privacy) return
              changePrivacy({ ...privacy, friends_seen_by: value })
              if (value === 'chosen') setChoosing(true)
            }}
            after={
              chosen && (
                <button type="button" className="cos-q-link" onClick={() => setChoosing(true)}>
                  {chosenCount === null ? t('settings.chooseViewers') : t('settings.chooseViewersCount', { count: chosenCount })}
                </button>
              )
            }
          />
          <QuietRow
            title={t('settings.blocked')}
            value={blockedCount ? t('settings.people', { count: blockedCount }) : undefined}
            onClick={() => navigate('/settings/blocked')}
          />
        </div>
      </QuietSection>

      <QuietSection name={t('settings.appGroup')}>
        <div className="cos-q-rows">
          {/* Each language is labelled in ITSELF, never translated: someone
              who has landed in the wrong language has to find the way out. */}
          <QuietChoiceRow
            title={t('common.language')}
            choices={[
              { value: 'fa', label: 'فارسی' },
              { value: 'en', label: 'English', latin: true },
            ]}
            value={i18n.language.startsWith('fa') ? 'fa' : 'en'}
            onChoose={(value) => void i18n.changeLanguage(value)}
          />
          <NotificationsRows />
          <QuietSwitchRow
            icon={<QLeaf />}
            title={t('settings.lite')}
            hint={t('settings.liteHint')}
            on={lite}
            onToggle={() => {
              setLite(!lite)
              setLightGraphics(!lite)
            }}
          />
        </div>
      </QuietSection>

      <QuietSection name={t('settings.helpGroup')}>
        <div className="cos-q-rows">
          <QuietRow icon={<QFlag />} title={t('settings.report')} onClick={() => navigate('/settings/report')} />
        </div>
      </QuietSection>

      <QuietSection name={t('settings.accountGroup')}>
        <div className="cos-q-rows">
          <QuietRow icon={<QKey />} title={t('ways.title')} hint={t('ways.rowHint')} onClick={() => navigate('/settings/ways')} />
          <QuietRow icon={<QDevice />} title={t('sessions.title')} hint={t('sessions.rowHint')} onClick={() => navigate('/settings/sessions')} />
          <QuietRow icon={<QTwoDevices />} title={t('link.title')} hint={t('link.rowHint')} onClick={() => navigate('/link')} />
          <QuietRow icon={<QOut />} title={t('sessions.signOut')} opens={false} onClick={() => setSigningOut(true)} />
        </div>
      </QuietSection>
      <QuietSection className="is-end">
        <div className="cos-q-rows">
          <QuietRow title={t('settings.delete')} danger center onClick={() => setDeleting(1)} />
        </div>
      </QuietSection>

      {choosing && <ChosenViewersSheet onClose={() => setChoosing(false)} />}

      {signingOut && (
        // Asked once: signing out loses nothing, but it is easy to tap by
        // accident and annoying to come back from.
        <QuietConfirm
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
        <QuietConfirm
          title={t('settings.deleteTitle')}
          text={t('settings.deleteText')}
          confirmLabel={t('settings.deleteNext')}
          destructive
          onCancel={() => setDeleting(0)}
          onConfirm={() => setDeleting(2)}
        />
      )}
      {deleting === 2 && (
        <QuietConfirm
          title={t('settings.deleteSureTitle')}
          text={t('settings.deleteSureText')}
          confirmLabel={t('settings.deleteConfirm')}
          destructive
          busy={deleteBusy}
          onCancel={() => setDeleting(0)}
          onConfirm={() => void reallyDelete()}
        />
      )}
    </QuietPage>
  )
}

/**
 * "You, as others see you": your own small orb as other people see it.
 * Hiding when you are online takes its ring away — the world's ring, which
 * means "here now" and nothing else — and the sentence says who may start
 * a conversation with you. The settings below change it as they are tapped.
 */
function SeenByOthers({ privacy }: { privacy: Privacy | null }) {
  const { t } = useTranslation()
  const { me } = useMe()
  const hidden = privacy?.hide_online ?? false
  const friendsOnly = privacy?.chat_door === 'friends'
  return (
    <div className="cos-q-seen" aria-live="polite">
      <div className={`cos-q-mini${hidden ? ' is-hidden' : ''}`} aria-hidden="true">
        <span className="cos-q-mini-ring" />
        <span className="cos-q-mini-body">
          {me?.avatar_url ? <img src={me.avatar_url} alt="" /> : (me?.display_name ?? '').slice(0, 1)}
        </span>
      </div>
      <div className="cos-q-seen-txt">
        <b>{t('settings.seenTitle')}</b>
        <span>
          {t(hidden ? 'settings.seenHidden' : 'settings.seenOnline')} {t(friendsOnly ? 'settings.seenFriends' : 'settings.seenAll')}
        </span>
      </div>
    </div>
  )
}

/**
 * Notifications when the app is closed (section 38), for this browser. A
 * switch where they can be turned on; where they cannot, the row says why
 * and what would make it possible, instead of a switch that does nothing.
 */
function NotificationsRows() {
  const { t } = useTranslation()
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    pushState()
      .then(setState)
      .catch(() => setState('unsupported'))
  }, [])

  if (state === null) return null
  const on = state === 'on'
  const can = state === 'on' || state === 'off'
  if (!can) {
    return (
      <div className="cos-q-row">
        <span className="cos-q-ico"><QBell /></span>
        <span className="cos-q-txt">
          <span className="cos-q-t">{t('push.title')}</span>
          <span className="cos-q-h">{t(`push.state.${state}`)}</span>
        </span>
      </div>
    )
  }
  return (
    <>
      <QuietSwitchRow
        icon={<QBell />}
        title={t('push.title')}
        hint={t(`push.state.${state}`)}
        on={on}
        disabled={busy}
        onToggle={async () => {
          setBusy(true)
          setState(await (on ? turnPushOff() : turnPushOn()).catch(() => state))
          setBusy(false)
        }}
      />
      {on && <PreviewRow />}
    </>
  )
}

/**
 * Whether a notification shows what the message says, or only who wrote it
 * (section 38). Off until turned on: a lock screen is seen by whoever is
 * next to it, and a message from somebody new is nobody else's business.
 * Sits under notifications, indented to their text, because it is part of them.
 */
function PreviewRow() {
  const { t } = useTranslation()
  const { me, refreshMe } = useMe()
  const [show, setShow] = useState(Boolean(me?.push_preview))
  const [busy, setBusy] = useState(false)
  return (
    <QuietSwitchRow
      icon={null}
      title={t('push.preview.title')}
      hint={t(show ? 'push.preview.on' : 'push.preview.off')}
      on={show}
      disabled={busy}
      onToggle={async () => {
        setBusy(true)
        try {
          await setPushPreview(!show)
          setShow(!show)
          refreshMe()
        } finally {
          setBusy(false)
        }
      }}
    />
  )
}
