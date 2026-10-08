import { useCallback, useEffect, useState } from 'react'
import { useGoBack } from '../lib/goBack'
import { useTranslation } from 'react-i18next'
import { GoogleMark, TelegramMark } from '../components/cosmos/WayMarks'
import { IconCheck } from '../components/icons'
import { useToast } from '../components/ui'
import { CosSheet } from '../components/cosmos/CosSheet'
import { QuietConfirm, QuietError, QuietPage, QuietSection, QuietWaiting } from '../components/cosmos/Quiet'
import { apiReason, formatApiError } from '../lib/api'
import {
  claimDoorTelegram,
  fetchDoors,
  googleTripAddress,
  startDoorTelegram,
  takeDoorAway,
  waitForDoorTelegram,
  type DoorProvider,
  type DoorPurpose,
  type Doors,
} from '../lib/doorsApi'
import { useQrPicture } from '../lib/qrPicture'
import type { BotRequest } from '../lib/signInApi'

/**
 * "Settings -> ways in" (TECHNICAL_REQUIREMENTS.md section 36).
 *
 * The ways into this account — Google, shown by its address half hidden,
 * and Telegram, by its @name — each marked as confirmed, because it was
 * connected by going through it. Each can be connected, swapped for another
 * account, or taken away, under the owner's three rules: never the last
 * one; only right after confirming through one of the ways connected now
 * (a phone left open is not enough to swap them and keep the account);
 * and the owner is told through our bot every time (the server does that).
 *
 * The confirmed mark is not green: green means "online now" and nothing
 * else in this app.
 */

type Action = { kind: 'connect' | 'remove'; provider: DoorProvider }

/** The outcome Google's trip came back with, read once from the address and then wiped from it. */
function cameBackFromGoogle(): string | null {
  const params = new URLSearchParams(window.location.search)
  const outcome = params.get('google')
  if (!outcome) return null
  params.delete('google')
  const rest = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  return outcome
}

export default function SignInWays() {
  const { t, i18n } = useTranslation()
  const back = useGoBack('/settings')
  const toast = useToast()
  const [doors, setDoors] = useState<Doors | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** What the person asked for, waiting on a confirmation first. */
  const [waiting, setWaiting] = useState<Action | null>(null)
  const [telegram, setTelegram] = useState<DoorPurpose | null>(null)
  const [removing, setRemoving] = useState<DoorProvider | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetchDoors()
      .then((value) => {
        setError(null)
        setDoors(value)
      })
      .catch((err) => setError(formatApiError(err)))
  }, [])
  useEffect(load, [load])

  // Coming back from Google: say how it went (closing Google's chooser says nothing).
  useEffect(() => {
    const outcome = cameBackFromGoogle()
    if (!outcome || outcome === 'cancelled') return
    if (outcome === 'confirmed' || outcome === 'linked') toast.success(t(`ways.done.${outcome}`))
    else toast.error(t(`ways.problem.${outcome}`, { defaultValue: t('ways.problem.failed') }))
  }, [t, toast])

  const go = (google: () => void, bot: () => void, provider: DoorProvider) => (provider === 'google' ? google() : bot())

  /** Does the action now; the caller has made sure this session is confirmed. */
  function carryOut(action: Action) {
    if (action.kind === 'remove') setRemoving(action.provider)
    else go(() => window.location.assign(googleTripAddress('link', i18n.language)), () => setTelegram('link'), action.provider)
  }

  function ask(action: Action) {
    if (doors?.confirmed) carryOut(action)
    else setWaiting(action)
  }

  function confirmWith(provider: DoorProvider) {
    go(() => window.location.assign(googleTripAddress('confirm', i18n.language)), () => setTelegram('confirm'), provider)
  }

  async function remove() {
    if (!removing) return
    setBusy(true)
    try {
      await takeDoorAway(removing)
      toast.success(t('ways.done.removed'))
      load()
    } catch (err) {
      const reason = apiReason(err)
      toast.error(reason ? t(`ways.problem.${reason}`, { defaultValue: formatApiError(err) }) : formatApiError(err))
    } finally {
      setBusy(false)
      setRemoving(null)
    }
  }

  function telegramDone(done: 'confirmed' | 'linked') {
    const purpose = telegram
    setTelegram(null)
    toast.success(t(`ways.done.${done}`))
    load()
    // Confirmed on the way to something: carry on with it, without a second tap.
    if (purpose === 'confirm' && waiting) {
      const next = waiting
      setWaiting(null)
      setDoors((d) => (d ? { ...d, confirmed: true } : d))
      carryOut(next)
    }
  }

  const connected = (provider: DoorProvider) => doors?.doors.find((d) => d.provider === provider) ?? null
  const shown: DoorProvider[] = doors ? (['google', 'telegram'] as const).filter((p) => connected(p) || doors[p]) : []
  const onlyOne = (doors?.doors.length ?? 0) <= 1

  return (
    <QuietPage title={t('ways.title')} onBack={back}>
      {error ? (
        <QuietError text={error} onRetry={load} />
      ) : doors === null ? (
        <QuietWaiting rows={2} />
      ) : (
        <>
          <p className="cos-q-lead">{t('ways.hint')}</p>
          <QuietSection>
            <div className="cos-q-rows">
              {shown.map((provider) => {
                const door = connected(provider)
                return (
                  <div key={provider} className="cos-q-person">
                    <span className="cos-q-mark">{provider === 'google' ? <GoogleMark /> : <TelegramMark />}</span>
                    <span className="cos-q-txt">
                      <span className="cos-q-t">{t(`ways.${provider}`)}</span>
                      {door ? (
                        <span className="cos-q-h cos-ways-line">
                          <bdi dir="ltr">{door.label ?? t('ways.connected')}</bdi>
                          <span className="cos-ways-verified">
                            <IconCheck size={14} />
                            {t('ways.verified')}
                          </span>
                        </span>
                      ) : (
                        <span className="cos-q-h">{t('ways.notConnected')}</span>
                      )}
                    </span>
                    {door ? (
                      <span className="cos-ways-actions">
                        {/* Swapping goes through the way itself, so only where the server offers it. */}
                        {doors[provider] && (
                          <button type="button" className="cos-q-text is-cool" onClick={() => ask({ kind: 'connect', provider })}>
                            {t('ways.swap')}
                          </button>
                        )}
                        <button type="button" className="cos-q-text" disabled={onlyOne} onClick={() => ask({ kind: 'remove', provider })}>
                          {t('ways.remove')}
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="cos-q-quiet" onClick={() => ask({ kind: 'connect', provider })}>
                        {t('ways.connect')}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </QuietSection>
          {onlyOne && <p className="cos-q-help cos-q-after">{t('ways.lastWay')}</p>}
        </>
      )}

      {waiting && !telegram && doors && (
        <CosSheet title={t('ways.confirmTitle')} onClose={() => setWaiting(null)}>
          <div className="cos-q-sheet-body">
            <p className="cos-q-sheet-text">{t('ways.confirmText')}</p>
            <div className="cos-q-sheet-actions">
              {doors.doors.map((door) => (
                <button key={door.provider} type="button" className="cos-q-primary" onClick={() => confirmWith(door.provider)}>
                  {t(`ways.confirmWith.${door.provider}`)}
                </button>
              ))}
            </div>
          </div>
        </CosSheet>
      )}

      {telegram && <TelegramSheet purpose={telegram} onDone={telegramDone} onClose={() => setTelegram(null)} />}

      {removing && (
        <QuietConfirm
          title={t('ways.removeTitle', { way: t(`ways.${removing}`) })}
          text={t('ways.removeText')}
          confirmLabel={t('ways.remove')}
          destructive
          busy={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove()}
        />
      )}
    </QuietPage>
  )
}

/**
 * Through our bot, from inside the account: open Telegram, tap Start, say
 * yes. The bot refuses on its own when the Telegram account cannot do it —
 * not this account's, for confirming; another account's, for connecting —
 * and the sheet says why. The server holds each wait open; nothing here
 * asks on a clock.
 */
function TelegramSheet({ purpose, onDone, onClose }: { purpose: DoorPurpose; onDone: (done: 'confirmed' | 'linked') => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [request, setRequest] = useState<BotRequest | null>(null)
  const [seen, setSeen] = useState(false)
  const [ended, setEnded] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const picture = useQrPicture(request?.link ?? null)

  useEffect(() => {
    let alive = true
    startDoorTelegram(purpose)
      .then(async (asked) => {
        if (!alive) return
        setEnded(null)
        setSeen(false)
        setRequest(asked)
        let known = false
        for (;;) {
          const answer = await waitForDoorTelegram(asked, known)
          if (!alive) return
          if (answer.seen && !known) {
            known = true
            setSeen(true)
          }
          if (answer.status === 'approved') {
            const { done } = await claimDoorTelegram(asked)
            if (alive) onDone(done)
            return
          }
          if (answer.status !== 'pending') {
            setEnded(answer.problem ?? answer.status)
            return
          }
        }
      })
      .catch((err) => {
        if (alive) setEnded(apiReason(err) ?? 'failed')
      })
    return () => {
      alive = false
    }
    // onDone is the parent's and new on every render; a new request comes only with a new round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purpose, round])

  return (
    <CosSheet title={t(`ways.tg.${purpose}Title`)} onClose={onClose}>
      <p className="cos-q-sheet-text">{t(`ways.tg.${purpose}Lead`)}</p>
      {ended ? (
        <div className="cos-ways-sheet-actions">
          <p className="cos-ways-problem" role="alert">
            {t(`ways.problem.${ended}`, { defaultValue: t('ways.problem.failed') })}
          </p>
          <button type="button" className="cos-q-primary" onClick={() => setRound((r) => r + 1)}>
            {t('ways.tg.again')}
          </button>
        </div>
      ) : request ? (
        <div className="cos-ways-sheet-actions">
          <a className="cos-signin-way cos-signin-way-telegram" href={request.link} target="_blank" rel="noopener noreferrer">
            <TelegramMark />
            {t('signIn.tg.open')}
          </a>
          <p className="cos-signin-wait" role="status">
            <span className="cos-signin-wait-dot" aria-hidden="true" />
            {seen ? t('signIn.tg.seen') : t('signIn.tg.waiting')}
          </p>
          {/* For somebody on a computer: the phone's camera opens the same link in Telegram there. */}
          <div className="cos-signin-qr cos-ways-qr" role="img" aria-label={t('signIn.tg.qrLabel')} dangerouslySetInnerHTML={{ __html: picture }} />
        </div>
      ) : (
        <p className="cos-signin-wait">{t('signIn.device.preparing')}</p>
      )}
    </CosSheet>
  )
}
