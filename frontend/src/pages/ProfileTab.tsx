import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, formatApiError } from '../lib/api'
import { ConfirmDialog, ErrorState, useToast } from '../components/ui'
import { Sheet } from '../components/ui/Sheet'
import { ReportSheet } from '../components/cosmos/ReportSheet'
import { MeetingSky } from '../components/cosmos/Constellation'
import { MAX_NOTE, saveNote } from '../lib/noteApi'
import { noteTime } from '../lib/noteTime'
import { blockPerson } from '../lib/accountApi'
import {
  acceptFriend,
  askFriend,
  endFriend,
  fetchFriendRequests,
  fetchFriends,
  fetchTheirFriends,
  fetchThisWeek,
  type FriendPerson,
  type FriendStatus,
  type TheirFriends,
  type WeekPerson,
} from '../lib/friendsApi'
import { subscribe } from '../lib/live'
import { useMe } from '../lib/MeContext'
import type { BackNavState } from '../lib/navState'
import type { PublicProfile } from '../lib/types'

/**
 * "Me", and anybody else's page (section 32, step 4: the approved
 * prototype, https://claude.ai/artifact/74d6UWgnjMwKcyJMw4b2wB).
 *
 * A piece of night sky: the orb rises over the curve of a world, and
 * today's note floats above it, where it floats in the world too. Under
 * it, on your own page, a few plain rows: your friends (faces, no
 * number, a badge for requests) and settings. On somebody else's, how to
 * reach them, and where your two skies meet: their friends on one side,
 * yours on the other, and the friends you share in the middle, reached by
 * lines from both sides.
 *
 * Gone from here, by the owner's decisions: followers and their numbers,
 * the media grid (the paid layer), a bio and interests, and the mirror.
 */
export default function ProfileTab() {
  const { t, i18n } = useTranslation()
  const { id: paramId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { me, refreshMe } = useMe()
  const toast = useToast()
  const targetId = paramId ? Number(paramId) : me?.id
  const isOwn = !!me && targetId === me.id

  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [friends, setFriends] = useState<FriendPerson[]>([])
  const [requests, setRequests] = useState<FriendPerson[]>([])
  const [theirs, setTheirs] = useState<TheirFriends | null>(null)
  const [week, setWeek] = useState<WeekPerson[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [confirm, setConfirm] = useState<'block' | 'unfriend' | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  const backState = location.state as BackNavState | null
  function goBack() {
    if (backState?.backTo === 'activity-requests') navigate('/activity', { state: { segment: 'requests' } })
    else navigate(-1)
  }

  const load = useCallback(() => {
    if (targetId == null) return
    apiFetch<PublicProfile>(`/profiles/${targetId}`)
      .then((value) => {
        // Cleared on the answer, not before asking (a synchronous clear in the effect rendered twice).
        setError(null)
        setProfile(value)
      })
      .catch((err) => setError(formatApiError(err)))
    fetchFriends().then(setFriends).catch(() => {})
    if (isOwn) {
      fetchFriendRequests().then(setRequests).catch(() => {})
      fetchThisWeek().then(setWeek).catch(() => setWeek([]))
    }
    else fetchTheirFriends(targetId).then(setTheirs).catch(() => setTheirs(null))
  }, [targetId, isOwn])

  useEffect(load, [load])
  // A request arriving or being answered changes this page: told live,
  // never asked on a clock (section 32).
  useEffect(() => subscribe((event) => { if (event.type === 'friends') load() }), [load])

  async function pickPhoto(file: File | null) {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    try {
      await apiFetch('/profile/me/avatar', { method: 'POST', body: form })
      load()
      refreshMe()
    } catch (err) {
      toast.error(formatApiError(err))
    }
  }

  async function friendAction(action: () => Promise<unknown>, said?: string) {
    setBusy(true)
    try {
      await action()
      if (said) toast.success(said)
      load()
      refreshMe()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/profiles/${targetId}`)
      toast.success(t('profilePage.shareCopied'))
    } catch {
      // Clipboard can be refused; sharing is a convenience, not worth an error.
    }
  }

  if (error) {
    return (
      <div className="cos-me">
        <div className="cos-me-head"><BackButton onClick={goBack} hidden={isOwn} label={t('talk.back')} /></div>
        <ErrorState text={error} onRetry={load} />
      </div>
    )
  }

  const status: FriendStatus = profile?.friend_status ?? 'none'
  const name = profile?.display_name ?? ''
  const mineIds = new Set(friends.map((f) => f.user_id))
  const shared = (theirs?.people ?? []).filter((p) => p.mutual)
  const theirOnly = (theirs?.people ?? []).filter((p) => !p.mutual)
  const mineOnly = friends.filter((f) => f.user_id !== targetId && !shared.some((s) => s.user_id === f.user_id))
  const n = (value: number) => value.toLocaleString(i18n.language)
  // The hour the note was written, small under it (section 32).
  const written = profile?.note ? noteTime(profile.note_at, i18n.language) : null
  const noteWhen = written ? t(written.key, { time: written.time }) : null

  return (
    <div className={`cos-me${isOwn ? '' : ' is-theirs'}`}>
      <div className="cos-me-head">
        {isOwn ? (
          <button type="button" className="cos-me-icon" onClick={() => navigate('/settings')} aria-label={t('settings.title')}>
            <GearIcon />
          </button>
        ) : (
          <>
            <BackButton onClick={goBack} label={t('talk.back')} />
            {profile && (
              <button type="button" className="cos-me-icon" onClick={() => setMoreOpen(true)} aria-label={t('profilePage.moreButton')}>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.5" cy="12" r="1.7" /></svg>
              </button>
            )}
          </>
        )}
      </div>

      <section className="cos-me-hero">
        <div className="cos-me-horizon" aria-hidden="true" />
        {isOwn ? (
          <button type="button" className={`cos-me-note${profile?.note ? '' : ' is-empty'}`} dir={profile?.note ? 'auto' : undefined} onClick={() => setNoteOpen(true)}>
            {profile?.note ?? t('note.add')}
            {noteWhen && <small className="cos-me-note-when">{noteWhen}</small>}
          </button>
        ) : (
          profile?.note && (
            // Somebody else's note answers with one tap (section 32): the
            // conversation opens with the note quoted.
            <button
              type="button"
              className="cos-me-note"
              dir="auto"
              aria-label={t('note.replyTo', { note: profile.note })}
              onClick={() => navigate(`/conversations/with/${profile.user_id}`, { state: { noteReply: { note: profile.note! } } })}
            >
              {profile.note}
              {noteWhen && <small className="cos-me-note-when">{noteWhen}</small>}
              <small className="cos-me-note-when is-reply">{t('note.reply')}</small>
            </button>
          )
        )}

        {isOwn ? (
          <button type="button" className="cos-me-orb" onClick={() => photoInput.current?.click()} aria-label={t('profilePage.changePhoto')}>
            {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>{name.slice(0, 1)}</span>}
            <span className="cos-me-cam" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            </span>
          </button>
        ) : (
          <span className="cos-me-orb">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>{name.slice(0, 1)}</span>}</span>
        )}
        <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => void pickPhoto(e.target.files?.[0] ?? null)} />

        <div className="cos-me-name">
          <h1 dir="auto">{name}</h1>
          {isOwn && (
            <button type="button" className="cos-me-pen" onClick={() => navigate('/profile/edit')} aria-label={t('profilePage.editButton')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
            </button>
          )}
        </div>
        {profile?.username && <p className="cos-me-handle">@{profile.username}</p>}

        {!isOwn && profile && (
          <div className="cos-me-actions">
            <button type="button" className="cos-me-btn is-main" onClick={() => navigate(`/conversations/with/${profile.user_id}`)}>
              {t('friends.hello')}
            </button>
            {status === 'none' && (
              <button type="button" className="cos-me-btn" disabled={busy} onClick={() => void friendAction(() => askFriend(profile.user_id), t('friends.sent'))}>
                {t('friends.ask')}
              </button>
            )}
            {status === 'requested' && (
              <button type="button" className="cos-me-btn is-quiet" disabled={busy} onClick={() => void friendAction(() => endFriend(profile.user_id))}>
                {t('friends.requested')}
              </button>
            )}
            {status === 'incoming' && (
              <button type="button" className="cos-me-btn" disabled={busy} onClick={() => void friendAction(() => acceptFriend(profile.user_id), t('friends.nowFriends', { name }))}>
                {t('friends.accept')}
              </button>
            )}
            {status === 'friends' && (
              <button type="button" className="cos-me-btn is-quiet" onClick={() => setConfirm('unfriend')}>
                {t('friends.are')}
              </button>
            )}
          </div>
        )}
      </section>

      {isOwn ? (
        <div className="cos-me-rows">
          <button type="button" className="cos-me-row" onClick={() => navigate('/friends')}>
            <span className="cos-me-row-main">
              <span>{t('friends.title')}</span>
              <small>{requests.length > 0 ? t('friends.newRequest') : t('friends.rowHint')}</small>
            </span>
            {friends.length > 0 && (
              <span className="cos-me-stack" aria-hidden="true">
                {friends.slice(0, 4).map((f) => (
                  <span key={f.user_id}>{f.avatar_url ? <img src={f.avatar_url} alt="" /> : f.display_name.slice(0, 1)}</span>
                ))}
              </span>
            )}
            {requests.length > 0 && <span className="cos-me-badge">{n(requests.length)}</span>}
            <Chevron />
          </button>
        </div>
      ) : null}

      {isOwn && week !== null && (
        <WeekPeople
          people={week}
          hasFriends={friends.length > 0}
          busy={busy}
          onOpen={(person) => navigate(`/profiles/${person.user_id}`)}
          onAsk={(person) => void friendAction(() => askFriend(person.user_id), t('friends.sent'))}
          onTakeBack={(person) => void friendAction(() => endFriend(person.user_id))}
          onAccept={(person) => void friendAction(() => acceptFriend(person.user_id), t('friends.nowFriends', { name: person.display_name }))}
          onEcho={() => navigate('/echo')}
        />
      )}

      {isOwn ? null : theirs && !theirs.visible ? (
        <section className="cos-me-sky">
          <h2>{t('friends.title')}</h2>
          <p className="cos-me-closed">{t('friends.closed', { name })}</p>
        </section>
      ) : theirs && theirs.people.length > 0 ? (
        <>
          {shared.length > 0 && (
            <section className="cos-me-sky">
              <h2>{t('friends.meet')}</h2>
              <MeetingSky theirs={theirOnly} mine={mineOnly} shared={shared} label={t('friends.meet')} />
              <div className="cos-me-legend"><span className="is-theirs">{t('friends.theirSky', { name })}</span><span className="is-mine">{t('friends.yourSky')}</span></div>
              <p className="cos-me-caption">
                {t('friends.meetAt', { names: shared.slice(0, 3).map((p) => p.display_name).join(t('friends.and')) })}
              </p>
            </section>
          )}
          <section className="cos-me-list">
            <h2>{t('friends.theirs', { name })}</h2>
            {theirs.people.map((person) => (
              <button type="button" key={person.user_id} className="cos-me-person" onClick={() => navigate(`/profiles/${person.user_id}`)}>
                <span className="cos-me-face">{person.avatar_url ? <img src={person.avatar_url} alt="" /> : person.display_name.slice(0, 1)}</span>
                <span className="cos-me-person-main">
                  <span>{person.display_name}</span>
                  {person.mutual || mineIds.has(person.user_id) ? (
                    <small className="cos-me-both"><BothGlyph />{t('friends.both')}</small>
                  ) : (
                    person.note && <small dir="auto">{person.note}</small>
                  )}
                </span>
              </button>
            ))}
          </section>
        </>
      ) : null}

      {noteOpen && profile && (
        <NoteSheet note={profile.note ?? null} onClose={() => setNoteOpen(false)} onSaved={() => { setNoteOpen(false); load() }} />
      )}

      {moreOpen && profile && (
        <Sheet title={name} onClose={() => setMoreOpen(false)}>
          <div className="ui-list">
            <button className="ui-row" onClick={() => { setMoreOpen(false); void share() }}>
              <span className="ui-row-main"><span className="ui-row-title">{t('profilePage.shareButton')}</span></span>
            </button>
            <button className="ui-row" onClick={() => { setMoreOpen(false); setReporting(true) }}>
              <span className="ui-row-main"><span className="ui-row-title">{t('profilePage.moreReport')}</span></span>
            </button>
            <button className="ui-row" onClick={() => { setMoreOpen(false); setConfirm('block') }}>
              <span className="ui-row-main"><span className="ui-row-title ui-text-danger">{t('profilePage.moreBlock')}</span></span>
            </button>
          </div>
        </Sheet>
      )}

      {reporting && profile && (
        <ReportSheet
          reportedUserId={profile.user_id}
          name={name}
          onClose={() => setReporting(false)}
          onSent={() => { setReporting(false); toast.success(t('profilePage.reported')) }}
        />
      )}

      {confirm === 'block' && profile && (
        // Quiet, like every block here: they are never told.
        <ConfirmDialog
          title={t('profilePage.blockTitle', { name })}
          text={t('profilePage.blockText')}
          confirmLabel={t('profilePage.moreBlock')}
          destructive
          loading={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setBusy(true)
            blockPerson(profile.user_id)
              .then(() => { toast.success(t('profilePage.blocked')); goBack() })
              .catch((err) => toast.error(formatApiError(err)))
              .finally(() => { setBusy(false); setConfirm(null) })
          }}
        />
      )}

      {confirm === 'unfriend' && profile && (
        <ConfirmDialog
          title={t('friends.unfriendTitle', { name })}
          text={t('friends.unfriendText')}
          confirmLabel={t('friends.unfriend')}
          destructive
          loading={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void friendAction(() => endFriend(profile.user_id)).then(() => setConfirm(null))}
        />
      )}
    </div>
  )
}

function BackButton({ onClick, label, hidden }: { onClick: () => void; label: string; hidden?: boolean }) {
  if (hidden) return <span />
  return (
    <button type="button" className="cos-me-icon cos-me-back" onClick={onClick} aria-label={label}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
    </button>
  )
}

/** Settings, drawn as the gear everybody already knows (the owner's
 *  report: the old sun-like mark read as Sol or as brightness). It is the
 *  only way to settings from here; the row that repeated it is gone. */
const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.3 2.8h3.4l.5 2.4 1.7.9 2.3-.9 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.9-1.7.9-.5 2.4h-3.4l-.5-2.4-1.7-.9-2.3.9-1.7-2.9 1.8-1.6v-2L4.1 8.1l1.7-2.9 2.3.9 1.7-.9z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

/**
 * "The people of your week" (section 32, "me" — the owner's choice for the
 * empty half of the page): faces of the people you really talked with in
 * the last seven days and are not friends with yet, each with one button.
 * It is where an acquaintance turns into a friendship, which is what this
 * product is for, so it lives on your own page rather than in a menu.
 *
 * A handful at most (the server sends eight), four to a row. With nobody
 * this week and no friends yet — a newcomer — it becomes an invitation to
 * Echo, the quickest way to a first real conversation. With friends but
 * nobody new this week it says nothing: a quiet week is not a fault.
 */
function WeekPeople({ people, hasFriends, busy, onOpen, onAsk, onTakeBack, onAccept, onEcho }: {
  people: WeekPerson[]
  hasFriends: boolean
  busy: boolean
  onOpen: (person: WeekPerson) => void
  onAsk: (person: WeekPerson) => void
  onTakeBack: (person: WeekPerson) => void
  onAccept: (person: WeekPerson) => void
  onEcho: () => void
}) {
  const { t } = useTranslation()
  if (people.length === 0) {
    if (hasFriends) return null
    return (
      <section className="cos-me-week is-empty">
        <p>{t('week.emptyText')}</p>
        <button type="button" className="cos-me-btn is-main" onClick={onEcho}>{t('week.emptyGo')}</button>
      </section>
    )
  }
  return (
    <section className="cos-me-week">
      <h2>{t('week.title')}</h2>
      <p className="cos-me-week-hint">{t('week.hint')}</p>
      <ul className="cos-me-week-faces">
        {people.map((person) => (
          <li key={person.user_id}>
            <button type="button" className="cos-me-week-open" onClick={() => onOpen(person)}>
              <span className="cos-me-face">{person.avatar_url ? <img src={person.avatar_url} alt="" /> : person.display_name.slice(0, 1)}</span>
              <span className="cos-me-week-name" dir="auto">{person.display_name}</span>
            </button>
            {person.status === 'none' && (
              <button type="button" className="cos-me-week-act" disabled={busy} onClick={() => onAsk(person)}>{t('friends.ask')}</button>
            )}
            {person.status === 'requested' && (
              <button type="button" className="cos-me-week-act is-quiet" disabled={busy} onClick={() => onTakeBack(person)}>{t('week.sent')}</button>
            )}
            {person.status === 'incoming' && (
              <button type="button" className="cos-me-week-act" disabled={busy} onClick={() => onAccept(person)}>{t('friends.accept')}</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

const Chevron = () => (
  <svg className="cos-me-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
)

/** "A friend of both of you": a line from each sky, meeting at a star. */
export function BothGlyph() {
  return (
    <svg viewBox="0 0 26 12" aria-hidden="true" className="cos-both-glyph">
      <path d="M1 2 13 6" className="is-theirs" />
      <path d="M25 2 13 6" className="is-mine" />
      <circle cx="13" cy="6" r="3.4" />
    </svg>
  )
}

/** Writing today's note; always above the bar (the owner's report). */
function NoteSheet({ note, onClose, onSaved }: { note: string | null; onClose: () => void; onSaved: () => void }) {
  const { t, i18n } = useTranslation()
  const [text, setText] = useState(note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(value: string) {
    setBusy(true)
    setError('')
    try {
      await saveNote(value)
      onSaved()
    } catch (err) {
      setError(formatApiError(err))
      setBusy(false)
    }
  }
  return (
    <Sheet title={t('note.title')} onClose={onClose}>
      <div className="co-form">
        <label className="ui-field" htmlFor="note-text">
          <span className="ui-field-label">
            {t('note.label')}
            <span className="ui-field-counter">{text.length.toLocaleString(i18n.language)} / {MAX_NOTE.toLocaleString(i18n.language)}</span>
          </span>
          <input id="note-text" className="ui-input" value={text} maxLength={MAX_NOTE} placeholder={t('note.placeholder')} onChange={(e) => setText(e.target.value)} />
          <span className="ui-field-help">{t('note.hint')}</span>
        </label>
        {error !== '' && <p className="ui-field-error">{error}</p>}
        <button type="button" className="ui-btn ui-btn-primary ui-btn-lg ui-btn-block" disabled={busy || text.trim() === ''} onClick={() => void save(text)}>
          {t('note.save')}
        </button>
        {note && (
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-lg ui-btn-block" disabled={busy} onClick={() => void save('')}>
            {t('note.remove')}
          </button>
        )}
      </div>
    </Sheet>
  )
}
