import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiReason } from '../lib/api'
import { GoogleMark, TelegramMark } from '../components/cosmos/WayMarks'
import { useQrPicture } from '../lib/qrPicture'
import {
  claimBotSession,
  claimDeviceSession,
  fetchWays,
  googleStartAddress,
  spacedCode,
  startBotSignIn,
  startDeviceRequest,
  waitForApproval,
  waitForTelegram,
  type BotRequest,
  type DeviceRequest,
  type WaysIn,
} from '../lib/signInApi'

/**
 * The sign-in page (TECHNICAL_REQUIREMENTS.md section 32).
 *
 * Calm and plain, the owner's direction: "like every sign-in page, but with
 * our own spirit". The night sky of the app, still; one soft light — the
 * mark of a person here — over a short line; the ways in at the bottom,
 * where the thumb is. No motion beyond things settling into place.
 *
 * Ways in, each ending in the same session cookie the server sets:
 * Google (off to Google's account chooser and back), Telegram through our
 * bot, another phone already signed in (a code to scan or type), and — in
 * local development only — the test people. A phone number comes later.
 *
 * Signing in reloads the page, so everything starts clean as that person.
 */

const TEST_PEOPLE = [
  { telegramId: 111222333, firstName: 'Sara', username: 'sara_dev' },
  { telegramId: 222222, firstName: 'Bob', username: 'bob_dev' },
  { telegramId: 333333, firstName: 'Soheil', username: 'soheil_dev' },
  { telegramId: 444444, firstName: 'Fatemeh', username: 'fatemeh_dev' },
]

type Step = 'ways' | 'device' | 'telegram' | 'test'

/**
 * What the server said, coming back from Google, read once from the
 * address and then wiped from it, so a reload does not say it again.
 * Closing Google's chooser is not a failure, and says nothing.
 */
function cameBackFromGoogle(): string | null {
  const params = new URLSearchParams(window.location.search)
  const outcome = params.get('signin')
  if (!outcome) return null
  params.delete('signin')
  const rest = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  return outcome === 'google_cancelled' ? null : 'signIn.googleFailed'
}

export default function SignIn() {
  const { t, i18n } = useTranslation()
  const [ways, setWays] = useState<WaysIn | null>(null)
  const [step, setStep] = useState<Step>('ways')
  // A message key rather than text, so it follows a change of language.
  const [error, setError] = useState<string | null>(cameBackFromGoogle)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    fetchWays()
      .then(setWays)
      .catch(() => setWays({ google: false, telegram: false, dev: false }))
  }, [])

  function back(note: string | null = null) {
    setError(note)
    setStep('ways')
  }

  async function asTestPerson(person: (typeof TEST_PEOPLE)[number]) {
    setError(null)
    const answer = await fetch('/api/dev/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: person.telegramId, first_name: person.firstName, username: person.username }),
    }).catch(() => null)
    if (answer?.ok) window.location.reload()
    else setError('signIn.failed')
  }

  const other = i18n.language === 'fa' ? 'en' : 'fa'
  const ready = ways !== null

  return (
    <main className="cos-signin">
      {/* Orientation only: where you are, the way back, the language. */}
      <header className="cos-signin-top">
        {step === 'ways' ? (
          <span className="cos-signin-brand" dir="ltr">Cosmos</span>
        ) : (
          <BackButton onClick={() => back()} />
        )}
        <button type="button" className="cos-signin-lang" onClick={() => void i18n.changeLanguage(other)}>
          {t(`signIn.lang.${other}`)}
        </button>
      </header>

      {step === 'ways' && (
        <>
          <section className="cos-signin-intro">
            <h1>{t('signIn.title')}</h1>
            <p>{t('signIn.line')}</p>
          </section>

          {/* The ways in sit at the bottom, where the thumb is. */}
          <section className="cos-signin-ways" aria-busy={leaving || !ready}>
            {ways?.google && (
              // A plain link: the browser goes to Google and comes back
              // signed in. Google's dark style — its own colours, its mark
              // untouched, its words — which its brand rules allow for a
              // button of our own, and which sits in our night sky.
              <a
                className="cos-signin-way cos-signin-way-google"
                href={googleStartAddress(i18n.language)}
                aria-disabled={leaving || undefined}
                onClick={(e) => {
                  // One tap is enough; a second would start a second sign-in.
                  if (leaving) e.preventDefault()
                  else setLeaving(true)
                }}
              >
                <GoogleMark />
                <span>{t('signIn.google')}</span>
              </a>
            )}
            {ways?.telegram && (
              <button type="button" className="cos-signin-way cos-signin-way-telegram" onClick={() => setStep('telegram')}>
                <TelegramMark />
                {t('signIn.telegram')}
              </button>
            )}
            <button type="button" className="cos-signin-way" onClick={() => setStep('device')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
                <path d="M10.5 18.5h3" />
              </svg>
              {t('signIn.withPhone')}
            </button>
            {ways?.dev && (
              <button type="button" className="cos-signin-quiet" onClick={() => setStep('test')}>
                {t('signIn.test')}
              </button>
            )}
            {error && <p className="cos-signin-error" role="alert">{t(error)}</p>}
          </section>
        </>
      )}

      {step === 'device' && <AnotherPhone onLeave={back} />}
      {step === 'telegram' && <TelegramStep onLeave={back} />}

      {step === 'test' && (
        <section className="cos-signin-panel">
          <h1>{t('signIn.test')}</h1>
          <div className="cos-signin-people">
            {TEST_PEOPLE.map((person) => (
              <button key={person.telegramId} type="button" className="cos-signin-way" onClick={() => void asTestPerson(person)}>
                {person.firstName}
              </button>
            ))}
          </div>
          {error && <p className="cos-signin-error" role="alert">{t(error)}</p>}
        </section>
      )}
    </main>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button type="button" className="cos-signin-back" onClick={onClick}>
      {/* Drawn pointing left; the stylesheet mirrors it for Persian, as elsewhere. */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {t('signIn.back')}
    </button>
  )
}

/** What a waiting step needs from its way in: making a request, waiting for news on it, collecting the session. */
interface WaitingWay<R extends { code: string; secret: string }> {
  start: () => Promise<R>
  wait: (request: R, seen: boolean) => Promise<{ status: string; seen: boolean }>
  claim: (request: R) => Promise<void>
  /** How many times a request that ran out is replaced by itself. */
  renewals: number
  /** The note shown on the first page when the last one runs out. */
  expiredNote: string
}

/**
 * The waiting both "another phone" and "Telegram" do, in one place so the
 * two cannot drift apart: make a request, wait for news on it (the server
 * holds each wait open and is woken by the answer — nothing here asks on
 * a clock), say when it was opened, come in when approved, and go back to
 * the first page when it runs out or this place has tried too often.
 *
 * A wait that fails — a phone that put this tab to sleep while Telegram was
 * open, a moment without network — is simply waited again once the page is
 * in front of the person, a few times before giving up.
 */
function useWaitingRequest<R extends { code: string; secret: string }>(way: WaitingWay<R>, onLeave: (note: string) => void) {
  const [request, setRequest] = useState<R | null>(null)
  const [seen, setSeen] = useState(false)
  const [refused, setRefused] = useState(false)
  const [failed, setFailed] = useState(false)
  const [round, setRound] = useState(0)
  const renewed = useRef(0)

  useEffect(() => {
    let alive = true
    way
      .start()
      .then(async (asked) => {
        if (!alive) return
        setRefused(false)
        setFailed(false)
        setSeen(false)
        setRequest(asked)
        let known = false
        let misses = 0
        for (;;) {
          let answer: { status: string; seen: boolean }
          try {
            answer = await way.wait(asked, known)
            misses = 0
          } catch (err) {
            if (!alive) return
            if (++misses > 3) throw err
            await inFrontAgain()
            continue
          }
          if (!alive) return
          if (answer.seen && !known) {
            known = true
            setSeen(true)
          }
          if (answer.status === 'approved') {
            await way.claim(asked)
            window.location.reload()
            return
          }
          if (answer.status === 'refused') {
            setRefused(true)
            return
          }
          if (answer.status !== 'pending') {
            if (renewed.current < way.renewals) {
              renewed.current += 1
              setRound((r) => r + 1)
            } else {
              onLeave(way.expiredNote)
            }
            return
          }
        }
      })
      .catch((err) => {
        if (!alive) return
        // Too many tries from here: back, saying so, rather than a retry button that would only be refused again.
        if (apiReason(err) === 'too_many_tries') onLeave('signIn.tooMany')
        else if (apiReason(err) !== 'used') setFailed(true)
      })
    return () => {
      alive = false
    }
    // way and onLeave are the parent's and new on every render; a new request comes only with a new round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  return { request, seen, refused, failed, again: () => setRound((r) => r + 1) }
}

/** Resolves once the page is in front of the person again (or shortly, if it already is). */
function inFrontAgain(): Promise<void> {
  return new Promise((resolve) => {
    if (document.visibilityState === 'visible') {
      setTimeout(resolve, 1500)
      return
    }
    const back = () => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', back)
      resolve()
    }
    document.addEventListener('visibilitychange', back)
  })
}


const PHONE_WAY: WaitingWay<DeviceRequest> = {
  start: startDeviceRequest,
  wait: waitForApproval,
  claim: claimDeviceSession,
  // One fresh code by itself, then back: four minutes in all (the owner's decision).
  renewals: 1,
  expiredNote: 'signIn.device.expired',
}

/**
 * Signing in with a phone that is already signed in: this device shows a
 * code — a picture for the phone's camera, and letters to type — and
 * waits. When the phone opens the code it says so ("now approve it on your
 * phone"); approved, it collects its session and comes in.
 *
 * Every visit to this step makes a new code, and a code lives two minutes.
 * When the first runs out, one fresh code takes its place by itself; when
 * that one runs out too — four minutes in all — the page goes back to the
 * ways in (the owner's decision), rather than renewing itself for ever on
 * a screen nobody may be looking at.
 */
function AnotherPhone({ onLeave }: { onLeave: (note: string) => void }) {
  const { t } = useTranslation()
  const { request, seen, refused, failed, again } = useWaitingRequest(PHONE_WAY, onLeave)
  const picture = useQrPicture(request ? `${window.location.origin}/link?c=${request.code}` : null)

  return (
    <section className="cos-signin-panel">
      <h1>{t('signIn.device.title')}</h1>
      <p>{t('signIn.device.lead')}</p>
      {request ? (
        <>
          <div className="cos-signin-code-card">
            <div className="cos-signin-qr" role="img" aria-label={t('signIn.device.qr')} dangerouslySetInnerHTML={{ __html: picture }} />
            <p className="cos-signin-code" dir="ltr" aria-label={t('signIn.device.codeLabel')}>{spacedCode(request.code)}</p>
          </div>
          <p className="cos-signin-or">{t('signIn.device.two')}</p>
          {refused ? (
            <button type="button" className="cos-signin-way" onClick={again}>
              {t('signIn.device.refused')}
            </button>
          ) : (
            <Waiting seen={seen} waiting={t('signIn.device.waiting')} seenText={t('signIn.device.seen')} />
          )}
        </>
      ) : failed ? (
        <button type="button" className="cos-signin-way" onClick={again}>
          {t('signIn.device.again')}
        </button>
      ) : (
        <p className="cos-signin-wait">{t('signIn.device.preparing')}</p>
      )}
    </section>
  )
}

const TELEGRAM_WAY: WaitingWay<BotRequest> = {
  start: startBotSignIn,
  wait: waitForTelegram,
  claim: claimBotSession,
  // Five minutes, then back: switching to Telegram and back takes a moment.
  renewals: 0,
  expiredNote: 'signIn.tg.expired',
}

/**
 * Signing in through our Telegram bot: open Telegram (on this device, or —
 * from a computer — by scanning the picture with a phone), tap Start, and
 * say "yes, it's me" to the bot's question. The page waits meanwhile and
 * comes in by itself; on a phone, coming back to the browser is enough.
 */
function TelegramStep({ onLeave }: { onLeave: (note: string) => void }) {
  const { t } = useTranslation()
  const { request, seen, refused, failed, again } = useWaitingRequest(TELEGRAM_WAY, onLeave)
  const picture = useQrPicture(request?.link ?? null)

  return (
    <section className="cos-signin-panel">
      <h1>{t('signIn.tg.title')}</h1>
      <p>{t('signIn.tg.lead')}</p>
      {request ? (
        <>
          <a className="cos-signin-way cos-signin-way-telegram cos-signin-open" href={request.link} target="_blank" rel="noopener noreferrer">
            <TelegramMark />
            {t('signIn.tg.open')}
          </a>
          {refused ? (
            <button type="button" className="cos-signin-way" onClick={again}>
              {t('signIn.tg.refused')}
            </button>
          ) : (
            <Waiting seen={seen} waiting={t('signIn.tg.waiting')} seenText={t('signIn.tg.seen')} />
          )}
          {/* For somebody on a computer: the phone's camera opens the same link in Telegram there. */}
          <div className="cos-signin-code-card cos-signin-code-card-small">
            <div className="cos-signin-qr" role="img" aria-label={t('signIn.tg.qrLabel')} dangerouslySetInnerHTML={{ __html: picture }} />
            <p className="cos-signin-or">{t('signIn.tg.qr')}</p>
          </div>
        </>
      ) : failed ? (
        <button type="button" className="cos-signin-way" onClick={again}>
          {t('signIn.device.again')}
        </button>
      ) : (
        <p className="cos-signin-wait">{t('signIn.device.preparing')}</p>
      )}
    </section>
  )
}

function Waiting({ seen, waiting, seenText }: { seen: boolean; waiting: string; seenText: string }) {
  return (
    <p className="cos-signin-wait" data-seen={seen || undefined} role="status">
      <span className="cos-signin-wait-dot" aria-hidden="true" />
      {seen ? seenText : waiting}
    </p>
  )
}

