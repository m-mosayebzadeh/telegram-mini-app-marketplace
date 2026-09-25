import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SpaceGround } from '../components/cosmos/SpaceGround'
import { IconEcho } from '../components/cosmos/icons'
import {
  BirthdayCosSheet,
  GenderSheet,
  type BirthdayValue,
} from '../components/cosmos/GateSheets'
import { apiFetch } from '../lib/api'
import { formatApiError } from '../lib/api'
import {
  MAX_TAGS,
  SEARCH_TAGS,
  WANT_ANYONE,
  WANT_FEMALE,
  WANT_MALE,
  cancelEchoSearch,
  fetchEchoStatus,
  startEchoSearch,
  type EchoSearch,
  type EchoStatus,
} from '../lib/echoApi'

/**
 * Echo — you stop choosing, and the world brings somebody.
 *
 * One screen with several faces, because they are one thing at different
 * moments rather than several places: shut for the night, missing a fact
 * about you, asking what you are in the mood for, waiting in the dark,
 * and finally sitting with somebody. Making these separate routes would
 * mean a back button that goes somewhere meaningless from four of them.
 *
 * The server keeps no timers (TECHNICAL_REQUIREMENTS.md section 28.1), so
 * being matched is something you find out by asking. Only the waiting
 * face polls, and it stops the moment it has an answer — a screen that
 * keeps asking after it knows is how a phone's battery disappears.
 */

/** How often the waiting screen asks whether somebody has arrived. Slow
 *  enough that a hundred people waiting is a trickle, fast enough that
 *  the wait never feels like the app has forgotten you. */
const POLL_MS = 2500

/** The ages the range picker offers. Eighteen is the floor everywhere
 *  (section 28), and the top is open rather than a number. */
const AGE_MIN = 18
const AGE_MAX = 80

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

export default function Echo() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [status, setStatus] = useState<EchoStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The three questions. Seeded from the last search once it arrives, so
  // somebody who searches twice in an evening does not answer them twice
  // — but they are still SHOWN, because a mood re-applied silently
  // becomes a setting nobody chose.
  const [wantsGender, setWantsGender] = useState<string>(WANT_ANYONE)
  const [ageMin, setAgeMin] = useState<number>(AGE_MIN)
  const [ageMax, setAgeMax] = useState<number>(AGE_MAX)
  const [tags, setTags] = useState<string[]>([])
  const seeded = useRef(false)

  const load = useCallback(async () => {
    try {
      const next = await fetchEchoStatus()
      setStatus(next)
      setError('')
      if (!seeded.current && next.last_search) {
        seeded.current = true
        setWantsGender(next.last_search.wants_gender)
        setAgeMin(next.last_search.wants_age_min ?? AGE_MIN)
        setAgeMax(next.last_search.wants_age_max ?? AGE_MAX)
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

  // Somebody arrived. The conversation is a screen of its own; this one
  // has done its job the moment there is a person to hand over.
  //
  // Straight into the thread the matcher created, by its id — Echo
  // already knows which one, so there is nothing to look up. `replace`
  // means going back from the conversation returns to the world rather
  // than to a search screen that has already finished.
  useEffect(() => {
    if (status?.matched) {
      navigate(`/conversations/${status.matched.conversation_id}`, { replace: true })
    }
  }, [status, navigate])

  // Only while waiting, and it stops on its own. An interval that outlives
  // the screen keeps a phone awake for nothing.
  useEffect(() => {
    if (!status?.waiting) return
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [status?.waiting, load])

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
      const body: EchoSearch = {
        wants_gender: wantsGender,
        // The full range means no preference at all, which is a different
        // thing from asking for eighteen-to-eighty and worth saying so.
        wants_age_min: ageMin === AGE_MIN && ageMax === AGE_MAX ? null : ageMin,
        wants_age_max: ageMin === AGE_MIN && ageMax === AGE_MAX ? null : ageMax,
        tags,
      }
      setStatus(await startEchoSearch(body))
    } catch (err) {
      setError(formatApiError(err))
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

  const face = faceOf(status)

  return (
    <div className="cos-screen">
      <SpaceGround />

      <header className="cos-echo-top">
        <button type="button" className="cos-echo-back" onClick={() => navigate('/sky')}>
          {t('echo.back')}
        </button>
        {/* Centred and large enough to be the screen's name rather than a
            decoration in a corner: this IS Echo, and the mark only becomes
            readable on its own after a long time spent beside the word. */}
        <span className="cos-echo-title">
          <IconEcho size={26} />
          <span className="cos-en">Echo</span>
        </span>
      </header>

      {face === 'loading' && (
        <div className="cos-echo-body cos-centre">
          <p className="cos-message">{t('common.loading')}</p>
        </div>
      )}

      {face === 'shut' && <Shut minutes={status?.minutes_until_open ?? null} />}

      {face === 'suspended' && (
        <div className="cos-echo-body cos-centre">
          <p className="cos-message">{t('echo.suspended')}</p>
        </div>
      )}

      {face === 'gate' && (
        <Gate
          missing={status?.missing ?? []}
          onDone={load}
          onGo={() => navigate('/profile/edit')}
        />
      )}

      {face === 'waiting' && (
        <Waiting since={status?.waiting_since ?? null} onStop={stop} busy={busy} />
      )}

      {face === 'asking' && (
        <Asking
          wantsGender={wantsGender}
          onGender={setWantsGender}
          ageMin={ageMin}
          ageMax={ageMax}
          onAgeMin={setAgeMin}
          onAgeMax={setAgeMax}
          tags={tags}
          onToggleTag={toggleTag}
          remaining={status?.remaining_today ?? null}
          busy={busy}
          onSearch={search}
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
    <div className="cos-echo-body cos-centre">
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
      <div className="cos-echo-body cos-centre">
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

/** The heart of the feature, and the only screen allowed to be still.
 *  Nothing here reports progress, because there is none to report — what
 *  it shows is that something is happening and that leaving is easy. */
function Waiting({
  since,
  onStop,
  busy,
}: {
  since: string | null
  onStop: () => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!since) return
    const started = new Date(since).getTime()
    const tick = () => setSeconds(Math.max(0, Math.round((Date.now() - started) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [since])

  const shown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <>
      <div className="cos-echo-body cos-centre">
        <div className="cos-echo-wait">
          <div className="cos-echo-pulse" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <p className="cos-echo-wait-line">{t('echo.waiting')}</p>
          <p className="cos-echo-wait-time cos-en">{shown}</p>
        </div>
      </div>
      <div className="cos-actions">
        <button type="button" className="cos-action cos-action-quiet" onClick={onStop} disabled={busy}>
          {t('echo.stop')}
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------- asking */

/** The three questions. Every one of them is optional and none of them
 *  narrows the pool — they rank it, so an answer never produces an empty
 *  result (section 28). The screen says that out loud, because a person
 *  who thinks these are filters will keep them wide out of fear. */
function Asking(props: {
  wantsGender: string
  onGender: (value: string) => void
  ageMin: number
  ageMax: number
  onAgeMin: (value: number) => void
  onAgeMax: (value: number) => void
  tags: string[]
  onToggleTag: (tag: string) => void
  remaining: number | null
  busy: boolean
  onSearch: () => void
}) {
  const { t } = useTranslation()
  const wide = props.ageMin === AGE_MIN && props.ageMax === AGE_MAX

  return (
    <>
      <div className="cos-echo-body cos-echo-form">
        <section className="cos-echo-q">
          <h2 className="cos-echo-q-label">{t('echo.whoLabel')}</h2>
          <div className="cos-echo-choices">
            {[
              { id: WANT_ANYONE, text: t('echo.whoAnyone') },
              { id: WANT_FEMALE, text: t('echo.whoFemale') },
              { id: WANT_MALE, text: t('echo.whoMale') },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                className={`cos-echo-choice${props.wantsGender === option.id ? ' is-on' : ''}`}
                onClick={() => props.onGender(option.id)}
                aria-pressed={props.wantsGender === option.id}
              >
                {option.text}
              </button>
            ))}
          </div>
        </section>

        <section className="cos-echo-q">
          <h2 className="cos-echo-q-label">
            {t('echo.ageLabel')}
            <span className="cos-echo-q-value cos-en">
              {wide ? t('echo.ageAny') : `${props.ageMin}–${props.ageMax}`}
            </span>
          </h2>
          <div className="cos-echo-range">
            <input
              type="range"
              min={AGE_MIN}
              max={AGE_MAX}
              value={props.ageMin}
              aria-label={t('echo.ageFrom')}
              onChange={(event) => {
                const next = Number(event.target.value)
                props.onAgeMin(Math.min(next, props.ageMax))
              }}
            />
            <input
              type="range"
              min={AGE_MIN}
              max={AGE_MAX}
              value={props.ageMax}
              aria-label={t('echo.ageTo')}
              onChange={(event) => {
                const next = Number(event.target.value)
                props.onAgeMax(Math.max(next, props.ageMin))
              }}
            />
          </div>
        </section>

        <section className="cos-echo-q">
          <h2 className="cos-echo-q-label">
            {t('echo.tagsLabel')}
            <span className="cos-echo-q-value">{t('echo.tagsCount', { n: props.tags.length, max: MAX_TAGS })}</span>
          </h2>
          <div className="cos-echo-tags">
            {SEARCH_TAGS.map((tag) => {
              const on = props.tags.includes(tag)
              const full = !on && props.tags.length >= MAX_TAGS
              return (
                <button
                  key={tag}
                  type="button"
                  className={`cos-echo-tag${on ? ' is-on' : ''}`}
                  onClick={() => props.onToggleTag(tag)}
                  aria-pressed={on}
                  disabled={full}
                >
                  {t(`echo.tag.${tag}`)}
                </button>
              )
            })}
          </div>
          <p className="cos-echo-note">{t('echo.rankNote')}</p>
        </section>
      </div>

      <div className="cos-actions">
        {props.remaining !== null && (
          <p className="cos-echo-remaining">{t('echo.remaining', { n: props.remaining })}</p>
        )}
        <button
          type="button"
          className="cos-action cos-action-primary cos-echo-go"
          onClick={props.onSearch}
          disabled={props.busy}
        >
          {props.busy ? t('common.loading') : t('echo.go')}
        </button>
        <p className="cos-echo-what">{t('echo.what')}</p>
      </div>
    </>
  )
}
