import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SpaceGround } from '../components/cosmos/SpaceGround'
import {
  BirthdayCosSheet,
  GenderSheet,
  type BirthdayValue,
} from '../components/cosmos/GateSheets'
import { apiFetch } from '../lib/api'
import { apiReason, formatApiError } from '../lib/api'
import {
  MAX_TAGS,
  SEARCH_TAGS,
  WANT_ANYONE,
  cancelEchoSearch,
  fetchEchoStatus,
  startEchoSearch,
  type EchoMatch,
  type EchoStatus,
} from '../lib/echoApi'

/**
 * Echo — a new person, with one tap (TECHNICAL_REQUIREMENTS.md section 32,
 * step 3; the approved "simple world" prototype).
 *
 * One big button, and up to three interests if you want them. The earlier
 * screen also asked which gender and which ages; the approved prototype
 * asks only for interests, so that is all this asks — the matcher still
 * ranks by everything it knows, it just no longer makes you fill it in.
 *
 * The faces of one screen: shut (a countdown), missing a fact about you
 * (asked right here), suspended, asking, waiting, and found. Found shows
 * who arrived and their own line, and "start talking" opens the ordinary
 * conversation — which stays, with nothing to keep (section 32).
 *
 * The server keeps no timers (section 28.1), so being matched is found out
 * by asking; only the waiting face polls, and stops once it has an answer.
 */

/** How often the waiting screen asks whether somebody has arrived. */
const POLL_MS = 2500

/** After this long without anybody, the waiting screen says so and offers
 *  a way to change the interests — honest about a small pool rather than
 *  spinning forever (section 32's discussion of the first days). */
export const LONG_WAIT_S = 40

/** A meeting counts as "just found" for this long; after that, coming back
 *  to Echo starts a new search instead of showing somebody from days ago. */
const FRESH_MS = 30 * 60 * 1000

type Face = 'loading' | 'shut' | 'gate' | 'suspended' | 'asking' | 'waiting' | 'found'

function isFresh(match: EchoMatch | null, now = Date.now()): boolean {
  if (!match) return false
  if (!match.started_at) return true
  return now - new Date(match.started_at).getTime() < FRESH_MS
}

function faceOf(status: EchoStatus | null): Face {
  if (status === null) return 'loading'
  if (status.suspended) return 'suspended'
  if (isFresh(status.matched)) return 'found'
  if (!status.open_now) return 'shut'
  if (status.missing.length > 0) return 'gate'
  if (status.waiting) return 'waiting'
  return 'asking'
}

/** "4 ساعت و 20 دقیقه" — the countdown is the whole reason somebody comes
 *  back at ten at night, so it is a real duration and not a timestamp. */
function splitMinutes(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

/** The two lights that look for each other — Echo's mark, and on the
 *  waiting screen the faster search. */
function Lights({ fast }: { fast?: boolean }) {
  return (
    <div className={`cos-seek-lights${fast ? ' is-fast' : ''}`} aria-hidden="true">
      <i className="is-a" />
      <i className="is-b" />
    </div>
  )
}

export default function Echo() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const n = (value: number) => value.toLocaleString(i18n.language)

  const [status, setStatus] = useState<EchoStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const seeded = useRef(false)

  const load = useCallback(async () => {
    try {
      const next = await fetchEchoStatus()
      setStatus(next)
      setError('')
      // The interests from last time, shown again rather than applied
      // silently: a mood re-applied behind your back becomes a setting.
      if (!seeded.current && next.last_search) {
        seeded.current = true
        setTags(next.last_search.tags)
      }
      return next
    } catch (err) {
      setError(formatApiError(err))
      return null
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Only while waiting, and it stops on its own.
  useEffect(() => {
    if (!status?.waiting) return
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [status?.waiting, load])

  // Arriving at "found" from the waiting screen is the moment of the whole
  // feature: a small buzz, the way a match is felt without looking.
  const face = faceOf(status)
  const lastFace = useRef<Face>('loading')
  useEffect(() => {
    if (face === 'found' && lastFace.current === 'waiting') navigator.vibrate?.([10, 40, 10])
    lastFace.current = face
  }, [face])

  function toggleTag(tag: string) {
    setTags((current) =>
      current.includes(tag)
        ? current.filter((one) => one !== tag)
        : current.length >= MAX_TAGS
          ? current
          : [...current, tag],
    )
  }

  async function search() {
    setBusy(true)
    setError('')
    try {
      setStatus(await startEchoSearch({ wants_gender: WANT_ANYONE, wants_age_min: null, wants_age_max: null, tags }))
    } catch (err) {
      const reason = apiReason(err)
      setError(reason === 'daily_new_people_limit' || reason === 'daily_quota_reached' ? t('echo.usedUp') : formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    setBusy(true)
    try {
      await cancelEchoSearch()
      await load()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cos-screen cos-seek">
      <SpaceGround />

      <header className="cos-header">
        <span className="cos-header-place"><b className="cos-header-name">{t('bar.echo')}</b></span>
        <span className="cos-header-count">{t('seek.sub')}</span>
      </header>

      {face === 'loading' && (
        <div className="cos-seek-stage"><p className="cos-message">{t('common.loading')}</p></div>
      )}

      {face === 'shut' && <Shut minutes={status?.minutes_until_open ?? null} />}

      {face === 'suspended' && (
        <div className="cos-seek-stage"><p className="cos-message">{t('echo.suspended')}</p></div>
      )}

      {face === 'gate' && (
        <Gate missing={status?.missing ?? []} onDone={load} onGo={() => navigate('/profile/edit')} />
      )}

      {face === 'asking' && (
        <div className="cos-seek-stage">
          <Lights />
          <h2 className="cos-seek-title">{t('seek.title')}</h2>
          <p className="cos-seek-text">{t('seek.text')}</p>
          <div className="cos-seek-tags" role="group" aria-label={t('echo.tagsLabel')}>
            {SEARCH_TAGS.map((tag) => {
              const on = tags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  className="cos-seek-tag"
                  aria-pressed={on}
                  disabled={!on && tags.length >= MAX_TAGS}
                  onClick={() => toggleTag(tag)}
                >
                  {t(`echo.tag.${tag}`)}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="cos-seek-go"
            onClick={() => void search()}
            disabled={busy || status?.remaining_today === 0}
          >
            {busy ? t('common.loading') : tags.length ? t('seek.goWith') : t('seek.go')}
          </button>
          <p className="cos-seek-small">
            {status?.remaining_today === 0
              ? t('echo.usedUp')
              : t('seek.online', { n: n(status?.online_now ?? 0) })}
          </p>
        </div>
      )}

      {face === 'waiting' && (
        <Waiting
          since={status?.waiting_since ?? null}
          online={status?.online_now ?? 0}
          waiting={status?.waiting_now ?? 0}
          tags={tags}
          busy={busy}
          onStop={() => void stop()}
        />
      )}

      {face === 'found' && status?.matched && (
        <div className="cos-seek-stage cos-seek-found">
          <span className="cos-seek-face">
            {status.matched.avatar_url ? <img src={status.matched.avatar_url} alt="" draggable={false} /> : status.matched.display_name.slice(0, 1)}
          </span>
          <h2 className="cos-seek-title">{t('seek.found', { name: status.matched.display_name })}</h2>
          {status.matched.tagline && <p className="cos-seek-text">«{status.matched.tagline}»</p>}
          {status.matched.shared_tags.length > 0 && (
            <p className="cos-seek-small">
              {t('seek.shared', { tags: status.matched.shared_tags.map((tag) => t(`echo.tag.${tag}`)).join('، ') })}
            </p>
          )}
          <button type="button" className="cos-seek-go" onClick={() => navigate(`/conversations/${status.matched!.conversation_id}`)}>
            {t('seek.start')}
          </button>
          <button type="button" className="cos-seek-again" onClick={() => void search()} disabled={busy}>
            {t('seek.another')}
          </button>
        </div>
      )}

      {error !== '' && <p className="cos-echo-error">{error}</p>}
    </div>
  )
}

/* ---------------------------------------------------------------- shut */

/** Not an error and not an empty state: a door that opens later. The
 *  countdown is the point — it is what turns "come back tonight" from a
 *  notification into an appointment (section 28). */
function Shut({ minutes }: { minutes: number | null }) {
  const { t } = useTranslation()
  const left = minutes === null ? null : splitMinutes(minutes)

  return (
    <div className="cos-seek-stage">
      <div className="cos-echo-shut">
        <p className="cos-echo-shut-label">{t('echo.opensIn')}</p>
        {left ? (
          <p className="cos-echo-count">
            {left.hours > 0 && (
              <>
                <b>{left.hours}</b>
                <span>{t('echo.hours')}</span>
              </>
            )}
            <b>{left.minutes}</b>
            <span>{t('echo.minutes')}</span>
          </p>
        ) : (
          <p className="cos-echo-count">
            <b>—</b>
          </p>
        )}
        <p className="cos-message">{t('echo.shutWhy')}</p>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- gate */

/** The two facts the matcher cannot work without. Signup asks for almost
 *  nothing on purpose, so they are asked here, where the reason is
 *  visible — which is also where people answer honestly. */
function Gate({
  missing,
  onDone,
  onGo,
}: {
  missing: string[]
  onDone: () => void
  onGo: () => void
}) {
  const { t } = useTranslation()
  const [sheet, setSheet] = useState<'gender' | 'birthday' | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState('')

  /**
   * Change one field without losing the rest.
   *
   * The profile endpoint replaces the whole thing, so sending only the
   * answer given here would quietly erase somebody's bio and interests.
   * Read first, then write the same object back with one field changed.
   */
  async function patchProfile(change: Record<string, unknown>) {
    setSaving(true)
    setFailed('')
    try {
      const current = await apiFetch<Record<string, unknown>>('/profile/me')
      await apiFetch('/profile/me', {
        method: 'PUT',
        body: JSON.stringify({
          bio: current.bio ?? null,
          location: current.location ?? null,
          interests: current.interests ?? [],
          birthday_month: current.birthday_month ?? null,
          birthday_day: current.birthday_day ?? null,
          birthday_year: current.birthday_year ?? null,
          gender: current.gender ?? null,
          hide_birth_year: current.hide_birth_year ?? false,
          ...change,
        }),
      })
      setSheet(null)
      onDone()
    } catch (err) {
      setFailed(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const needsGender = missing.includes('gender')
  const needsBirthday = missing.includes('birth_year')

  return (
    <>
      <div className="cos-seek-stage">
        <div className="cos-echo-shut">
          <p className="cos-echo-shut-label">{t('echo.gateTitle')}</p>

          {/* Each one is answered here. Walking somebody to their profile
              for a single field is three screens for one answer, and most
              people do not come back. */}
          <div className="cos-gate-rows">
            {needsGender && (
              <button type="button" className="cos-gate-row" onClick={() => setSheet('gender')}>
                {t('echo.missingGender')}
              </button>
            )}
            {needsBirthday && (
              <button type="button" className="cos-gate-row" onClick={() => setSheet('birthday')}>
                {t('echo.missingBirthday')}
              </button>
            )}
          </div>

          {failed !== '' && <p className="cos-echo-error cos-gate-failed">{failed}</p>}
        </div>
      </div>

      <div className="cos-actions">
        {/* The way out is kept: the profile still owns these fields, and
            somebody who would rather set everything at once can. */}
        <button type="button" className="cos-action cos-action-quiet" onClick={onGo}>
          {t('echo.gateGo')}
        </button>
      </div>

      {sheet === 'gender' && (
        <GenderSheet
          value={null}
          saving={saving}
          onClose={() => setSheet(null)}
          onSave={(gender) => void patchProfile({ gender })}
        />
      )}

      {sheet === 'birthday' && (
        <BirthdayCosSheet
          value={{ month: null, day: null, year: null } satisfies BirthdayValue}
          saving={saving}
          onClose={() => setSheet(null)}
          onSave={(birthday) =>
            void patchProfile({
              birthday_month: birthday.month,
              birthday_day: birthday.day,
              birthday_year: birthday.year,
            })
          }
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------- waiting */

/** What people waiting see (section 32): the real people waiting right
 *  now, drawn as faceless lights — every light is a person, nothing here is
 *  decoration — the honest numbers, the interests you asked for, how long
 *  it has been, a tip for the first message, and, after a while with
 *  nobody, a plain way to change the interests instead of spinning on. */
const TIPS = ['seek.tip1', 'seek.tip2', 'seek.tip3']

function Waiting({ since, online, waiting, tags, busy, onStop }: {
  since: string | null
  online: number
  waiting: number
  tags: string[]
  busy: boolean
  onStop: () => void
}) {
  const { t, i18n } = useTranslation()
  const n = (value: number) => value.toLocaleString(i18n.language)
  const [seconds, setSeconds] = useState(0)
  const [waitOn, setWaitOn] = useState(false)

  useEffect(() => {
    if (!since) return
    const started = new Date(since).getTime()
    const tick = () => setSeconds(Math.max(0, Math.round((Date.now() - started) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [since])

  const shown = `${n(Math.floor(seconds / 60))}:${n(seconds % 60).padStart(2, n(0))}`
  const tip = TIPS[Math.floor(seconds / 7) % TIPS.length]
  const long = seconds >= LONG_WAIT_S && !waitOn
  // At most twelve lights: beyond that the picture says "many" as well as
  // twelve does, and a hundred small animations would cost a cheap phone.
  const lights = Math.min(waiting, 12)

  return (
    <div className="cos-seek-stage cos-seek-waiting">
      <div className="cos-seek-orbit" aria-hidden="true">
        {Array.from({ length: lights }, (_, k) => (
          <i key={k} style={{ '--k': k, '--of': lights } as React.CSSProperties} />
        ))}
        <Lights fast />
      </div>
      <h2 className="cos-seek-title">{t('seek.searching')}</h2>
      <p className="cos-seek-text">
        {tags.length ? t('seek.withTags', { tags: tags.map((tag) => t(`echo.tag.${tag}`)).join('، ') }) : t('seek.anyone')}
      </p>
      <div className="cos-seek-facts">
        <span><b>{n(online)}</b>{t('seek.factOnline')}</span>
        <span><b>{n(waiting)}</b>{t('seek.factWaiting')}</span>
        <span><b className="cos-en">{shown}</b>{t('seek.factTime')}</span>
      </div>
      {long ? (
        <div className="cos-seek-long" role="status">
          <p>{t('seek.long')}</p>
          <div className="cos-seek-row">
            <button type="button" className="cos-seek-again" onClick={() => setWaitOn(true)}>{t('seek.keepWaiting')}</button>
            <button type="button" className="cos-seek-again" onClick={onStop} disabled={busy}>{t('seek.change')}</button>
          </div>
        </div>
      ) : (
        <p className="cos-seek-tip" key={tip}>{t(tip)}</p>
      )}
      {!long && (
        <button type="button" className="cos-seek-again" onClick={onStop} disabled={busy}>{t('echo.stop')}</button>
      )}
    </div>
  )
}
