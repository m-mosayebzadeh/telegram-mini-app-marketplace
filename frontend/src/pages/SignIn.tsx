import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { apiReason } from '../lib/api'
import { renderGoogleButton } from '../lib/googleButton'
import {
  claimDeviceSession,
  fetchWays,
  signInWithGoogle,
  spacedCode,
  startDeviceRequest,
  waitForApproval,
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
 * Google (Google's own button), another phone already signed in (a code to
 * scan or type), and — in local development only — the test people. A
 * phone number and Telegram through our bot come later.
 *
 * Signing in reloads the page, so everything starts clean as that person.
 */

const TEST_PEOPLE = [
  { telegramId: 111222333, firstName: 'Sara', username: 'sara_dev' },
  { telegramId: 222222, firstName: 'Bob', username: 'bob_dev' },
  { telegramId: 333333, firstName: 'Soheil', username: 'soheil_dev' },
  { telegramId: 444444, firstName: 'Fatemeh', username: 'fatemeh_dev' },
]

type Step = 'ways' | 'device' | 'test'

export default function SignIn() {
  const { t, i18n } = useTranslation()
  const [ways, setWays] = useState<WaysIn | null>(null)
  const [step, setStep] = useState<Step>('ways')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleReady, setGoogleReady] = useState(false)
  const googleBox = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchWays()
      .then(setWays)
      .catch(() => setWays({ google_client_id: null, dev: false }))
  }, [])

  // Google's button, drawn again when the language changes (it carries its
  // own words) or when coming back to this step.
  useEffect(() => {
    const box = googleBox.current
    if (step !== 'ways' || !box || !ways?.google_client_id) return
    box.replaceChildren()
    renderGoogleButton(box, ways.google_client_id, i18n.language, async (credential) => {
      setBusy(true)
      setError('')
      try {
        await signInWithGoogle(credential)
        window.location.reload()
      } catch {
        setBusy(false)
        setError(t('signIn.googleFailed'))
      }
    })
      .then(() => setGoogleReady(true))
      .catch(() => setError(t('signIn.googleUnreachable')))
  }, [step, ways, i18n.language, t])

  async function asTestPerson(person: (typeof TEST_PEOPLE)[number]) {
    setError('')
    const answer = await fetch('/api/dev/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: person.telegramId, first_name: person.firstName, username: person.username }),
    }).catch(() => null)
    if (answer?.ok) window.location.reload()
    else setError(t('signIn.failed'))
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
          <BackButton onClick={() => setStep('ways')} />
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
          <section className="cos-signin-ways" aria-busy={busy || !ready}>
            {ways?.google_client_id && (
              // Our own button for the eye; Google's real one lies over it,
              // invisible, and takes the tap (see googleButton.ts).
              <div className="cos-signin-google" data-ready={googleReady || undefined}>
                <span className="cos-signin-way cos-signin-way-google" aria-hidden="true">
                  <GoogleMark />
                  {t('signIn.google')}
                </span>
                <div ref={googleBox} className="cos-signin-google-frame" />
              </div>
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
            {error !== '' && <p className="cos-signin-error" role="alert">{error}</p>}
          </section>
        </>
      )}

      {step === 'device' && <AnotherPhone />}

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
          {error !== '' && <p className="cos-signin-error" role="alert">{error}</p>}
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

/** Google's "G", in its own colours, as its brand rules ask. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

/**
 * Signing in with a phone that is already signed in: this device shows a
 * code — a picture for the phone's camera, and letters to type — and
 * waits. Approved on the phone, it collects its session and comes in. The
 * code renews itself when it runs out.
 */
function AnotherPhone() {
  const { t } = useTranslation()
  const [request, setRequest] = useState<DeviceRequest | null>(null)
  const [picture, setPicture] = useState('')
  const [refused, setRefused] = useState(false)
  const [failed, setFailed] = useState(false)
  const [round, setRound] = useState(0)

  useEffect(() => {
    let alive = true
    startDeviceRequest()
      .then(async (asked) => {
        if (!alive) return
        setRefused(false)
        setFailed(false)
        setRequest(asked)
        const address = `${window.location.origin}/link?c=${asked.code}`
        setPicture(await QRCode.toString(address, { type: 'svg', margin: 1, color: { dark: '#06181c', light: '#eef6f4' } }))
        // Wait for the answer; the server holds each wait open a while.
        for (;;) {
          const { status } = await waitForApproval(asked)
          if (!alive) return
          if (status === 'approved') {
            await claimDeviceSession(asked)
            window.location.reload()
            return
          }
          if (status === 'refused') {
            setRefused(true)
            return
          }
          if (status !== 'pending') {
            // Ran out: a fresh code, without asking anybody to press anything.
            setRound((r) => r + 1)
            return
          }
        }
      })
      .catch((err) => {
        if (alive && apiReason(err) !== 'used') setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [round])

  return (
    <section className="cos-signin-panel">
      <h1>{t('signIn.device.title')}</h1>
      <p>{t('signIn.device.lead')}</p>
      {request ? (
        <>
          <div className="cos-signin-code-card">
            {/* The picture is built by the QR library from our own address only. */}
            <div className="cos-signin-qr" role="img" aria-label={t('signIn.device.qr')} dangerouslySetInnerHTML={{ __html: picture }} />
            <p className="cos-signin-code" dir="ltr" aria-label={t('signIn.device.codeLabel')}>{spacedCode(request.code)}</p>
          </div>
          <p className="cos-signin-or">{t('signIn.device.two')}</p>
          {refused ? (
            <button type="button" className="cos-signin-way" onClick={() => setRound((r) => r + 1)}>
              {t('signIn.device.refused')}
            </button>
          ) : (
            <p className="cos-signin-wait"><span className="cos-signin-wait-dot" aria-hidden="true" />{t('signIn.device.waiting')}</p>
          )}
        </>
      ) : failed ? (
        <button type="button" className="cos-signin-way" onClick={() => setRound((r) => r + 1)}>
          {t('signIn.device.again')}
        </button>
      ) : (
        <p className="cos-signin-wait">{t('signIn.device.preparing')}</p>
      )}
    </section>
  )
}
