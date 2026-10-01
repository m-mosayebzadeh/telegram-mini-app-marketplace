import { useCallback, useEffect, useRef, useState } from 'react'
import { setEcho, useEcho } from '../lib/echoStore'
import { TagPicker } from '../components/cosmos/TagPicker'
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
  WANT_ANYONE,
  cancelEchoSearch,
  fetchEchoStatus,
  startEchoSearch,
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
 * (asked right here), suspended, asking and waiting. Somebody found is no
 * longer a face of this screen: it is a card that reaches you on any
 * screen (components/cosmos/EchoOffer.tsx), because searching does not
 * keep you here — and once you have both said "start" it opens the
 * conversation itself.
 *
 * The status is the shared one (lib/echoStore.ts), which the door in the
 * bar and that card read too; it keeps asking while you are searching.
 */

/** After this long without anybody, the waiting screen says so and offers
 *  a way to change the interests — honest about a small pool rather than
 *  spinning forever (section 32's discussion of the first days). */
export const LONG_WAIT_S = 40

type Face = 'loading' | 'shut' | 'gate' | 'suspended' | 'asking' | 'waiting'

function faceOf(status: EchoStatus | null): Face {
  if (status === null) return 'loading'
  if (status.suspended) return 'suspended'
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
  const { t } = useTranslation()
  const navigate = useNavigate()

  const status = useEcho()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const seeded = useRef(false)

  const load = useCallback(async () => {
    try {
      const next = await fetchEchoStatus()
      setEcho(next)
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

  const face = faceOf(status)

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
      setEcho(await startEchoSearch({ wants_gender: WANT_ANYONE, wants_age_min: null, wants_age_max: null, tags }))
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
          <TagPicker chosen={tags} onToggle={toggleTag} />
          <button
            type="button"
            className="cos-seek-go"
            onClick={() => void search()}
            disabled={busy || status?.remaining_today === 0}
          >
            {/* The day's budget used up is said on the button itself: the
                line that used to sit under it fell behind Sol and the bar
                (the owner removed it). */}
            {busy
              ? t('common.loading')
              : status?.remaining_today === 0
                ? t('echo.usedUp')
                : tags.length
                  ? t('seek.goWith')
                  : t('seek.go')}
          </button>
        </div>
      )}

      {face === 'waiting' && (
        <Waiting
          since={status?.waiting_since ?? null}
          online={status?.online_now ?? 0}
          waiting={status?.waiting_now ?? 0}
          showCounts={status?.show_counts !== false}
          tags={tags}
          busy={busy}
          onStop={() => void stop()}
        />
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

function Waiting({ since, online, waiting, showCounts, tags, busy, onStop }: {
  since: string | null
  online: number
  /** Everyone searching, you included. */
  waiting: number
  /** The panel's switch. Off, the numbers go and only the time stays; the
   *  lights stay too, since they say "somebody is here" without a number
   *  that looks small. */
  showCounts: boolean
  tags: string[]
  busy: boolean
  onStop: () => void
}) {
  const { t, i18n } = useTranslation()
  const n = (value: number) => value.toLocaleString(i18n.language)
  const [seconds, setSeconds] = useState(0)

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
  const long = seconds >= LONG_WAIT_S
  // At most twelve lights: beyond that the picture says "many" as well as
  // twelve does, and a hundred small animations would cost a cheap phone.
  // The lights are the others: you are the one in the middle.
  const lights = Math.min(Math.max(0, waiting - 1), 12)

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
        {showCounts && <span><b>{n(online)}</b>{t('seek.factOnline')}</span>}
        {showCounts && <span><b>{n(waiting)}</b>{t('seek.factWaiting')}</span>}
        <span><b className="cos-en">{shown}</b>{t('seek.factTime')}</span>
      </div>
      {long ? (
        <div className="cos-seek-long" role="status">
          <p>{t('seek.long')}</p>
          {/* No "I will wait": the search goes on whatever you press, so
              that button did nothing (the owner's point). Only the change. */}
          <div className="cos-seek-row">
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
