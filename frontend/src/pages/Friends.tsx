import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useToast } from '../components/ui'
import { MyConstellation } from '../components/cosmos/Constellation'
import { formatApiError } from '../lib/api'
import { acceptFriend, endFriend, fetchFriendRequests, fetchFriends, type FriendPerson } from '../lib/friendsApi'
import { subscribe } from '../lib/live'
import { useMe } from '../lib/MeContext'

const VIEW_KEY = 'cos-friends-view'

function readView(): 'list' | 'sky' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'sky' ? 'sky' : 'list'
  } catch {
    return 'list'
  }
}

/**
 * Your friends (section 32, step 4). Plain first, the owner's decision: the
 * requests waiting, then your friends as a list. One switch shows them as
 * your constellation instead (the approved prototype): faces as stars,
 * joined by lines, a request a blinking star not yet joined — tap it to
 * say yes. The switch is remembered on this phone.
 */
export default function Friends() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const { refreshMe } = useMe()
  const [friends, setFriends] = useState<FriendPerson[] | null>(null)
  const [requests, setRequests] = useState<FriendPerson[]>([])
  const [view, setView] = useState<'list' | 'sky'>(readView)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(() => {
    fetchFriends().then(setFriends).catch(() => setFriends([]))
    fetchFriendRequests().then(setRequests).catch(() => {})
  }, [])
  useEffect(load, [load])
  // Told live when a request arrives or is answered; nothing on a clock.
  useEffect(() => subscribe((event) => { if (event.type === 'friends') load() }), [load])

  function switchView(next: 'list' | 'sky') {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Remembering is a convenience.
    }
  }

  async function answer(person: FriendPerson, yes: boolean) {
    setBusy(person.user_id)
    try {
      if (yes) {
        await acceptFriend(person.user_id)
        toast.success(t('friends.nowFriends', { name: person.display_name }))
      } else {
        await endFriend(person.user_id)
      }
      load()
      refreshMe()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(null)
    }
  }

  const face = (person: FriendPerson) => (
    <span className="cos-me-face">{person.avatar_url ? <img src={person.avatar_url} alt="" /> : person.display_name.slice(0, 1)}</span>
  )

  return (
    <div className="cos-me cos-friends">
      <div className="cos-me-head">
        <button type="button" className="cos-me-icon cos-me-back" onClick={() => navigate(-1)} aria-label={t('talk.back')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
        </button>
        <h1 className="cos-friends-title">{t('friends.title')}</h1>
        <button
          type="button"
          className="cos-friends-switch"
          aria-pressed={view === 'sky'}
          onClick={() => switchView(view === 'sky' ? 'list' : 'sky')}
        >
          {view === 'sky' ? t('friends.asList') : t('friends.asSky')}
        </button>
      </div>

      {friends !== null && friends.length === 0 && requests.length === 0 && (
        <p className="cos-me-closed">{t('friends.empty')}</p>
      )}

      {view === 'sky' && friends !== null && friends.length + requests.length > 0 ? (
        <section className="cos-me-sky">
          {requests.length > 0 && <p className="cos-me-caption">{t('friends.blinkHint')}</p>}
          <MyConstellation
            friends={friends}
            requests={requests}
            onAccept={(person) => void answer(person, true)}
            label={t('friends.yourSky')}
            requestLabel={(person) => t('friends.acceptStar', { name: person.display_name })}
          />
        </section>
      ) : (
        <section className="cos-me-list">
          {requests.length > 0 && <h2>{t('friends.requests')}</h2>}
          {requests.map((person) => (
            <div key={person.user_id} className="cos-me-person">
              {face(person)}
              <span className="cos-me-person-main">
                <span>{person.display_name}</span>
                <small>{t('friends.wants')}</small>
              </span>
              <button type="button" className="cos-me-btn is-main is-small" disabled={busy === person.user_id} onClick={() => void answer(person, true)}>
                {t('friends.accept')}
              </button>
              <button type="button" className="cos-me-btn is-quiet is-small" disabled={busy === person.user_id} onClick={() => void answer(person, false)}>
                {t('friends.no')}
              </button>
            </div>
          ))}
          {(friends ?? []).length > 0 && <h2>{t('friends.yours')}</h2>}
          {(friends ?? []).map((person) => (
            <div key={person.user_id} className="cos-me-person">
              <button type="button" className="cos-me-person-open" onClick={() => navigate(`/profiles/${person.user_id}`)}>
                {face(person)}
                <span className="cos-me-person-main">
                  <span>{person.display_name}</span>
                  {person.note && <small dir="auto">{person.note}</small>}
                </span>
              </button>
              <button type="button" className="cos-me-btn is-small" onClick={() => navigate(`/conversations/with/${person.user_id}`)}>
                {t('friends.hello')}
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
