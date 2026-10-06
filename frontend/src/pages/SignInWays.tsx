import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GoogleMark, TelegramMark } from '../components/cosmos/WayMarks'
import { IconCheck } from '../components/icons'
import { Button, ConfirmDialog, ErrorState, PageHeader, Sheet, SkeletonRows, useToast } from '../components/ui'
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
  const navigate = useNavigate()
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
    <div className="ui-page">
      <PageHeader title={t('ways.title')} onBack={() => navigate('/settings')} />
      <div className="ui-page-body">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : doors === null ? (
          <SkeletonRows count={2} />
        ) : (
          <section className="ui-section">
            <p className="cos-sessions-hint">{t('ways.hint')}</p>
            <div className="ui-list">
              {shown.map((provider) => {
                const door = connected(provider)
                return (
                  <div key={provider} className="ui-row is-wrap">
                    <span className="cos-ways-mark">{provider === 'google' ? <GoogleMark /> : <TelegramMark />}</span>
                    <span className="ui-row-main">
                      <span className="ui-row-title">{t(`ways.${provider}`)}</span>
                      {door ? (
                        <span className="ui-row-subtitle cos-ways-line">
                          <bdi dir="ltr">{door.label ?? t('ways.connected')}</bdi>
                          <span className="cos-ways-verified">
                            <IconCheck size={14} />
                            {t('ways.verified')}
                          </span>
                        </span>
                      ) : (
                        <span className="ui-row-subtitle">{t('ways.notConnected')}</span>
                      )}
                    </span>
                    <span className="ui-row-trailing cos-ways-actions">
                      {door ? (
                        <>
                          {/* Swapping goes through the way itself, so only where the server offers it. */}
                          {doors[provider] && (
                            <Button variant="ghost" size="sm" onClick={() => ask({ kind: 'connect', provider })}>
                              {t('ways.swap')}
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" disabled={onlyOne} onClick={() => ask({ kind: 'remove', provider })}>
                            {t('ways.remove')}
                          </Button>
                        </>
                      ) : (
                        <Button variant="secondary" size="sm" onClick={() => ask({ kind: 'connect', provider })}>
                          {t('ways.connect')}
                        </Button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
            {onlyOne && <p className="cos-sessions-hint cos-ways-note">{t('ways.lastWay')}</p>}
          </section>
        )}
      </div>

      {waiting && !telegram && doors && (
        <Sheet title={t('ways.confirmTitle')} onClose={() => setWaiting(null)}>
          <p className="cos-ways-sheet-text">{t('ways.confirmText')}</p>
          <div className="cos-ways-sheet-actions">
            {doors.doors.map((door) => (
              <Button key={door.provider} variant="secondary" size="lg" block onClick={() => confirmWith(door.provider)}>
                {t(`ways.confirmWith.${door.provider}`)}
              </Button>
            ))}
          </div>
        </Sheet>
      )}

      {telegram && <TelegramSheet purpose={telegram} onDone={telegramDone} onClose={() => setTelegram(null)} />}

      {removing && (
        <ConfirmDialog
          title={t('ways.removeTitle', { way: t(`ways.${removing}`) })}
          text={t('ways.removeText')}
          confirmLabel={t('ways.remove')}
          loading={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
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
    <Sheet title={t(`ways.tg.${purpose}Title`)} onClose={onClose}>
      <p className="cos-ways-sheet-text">{t(`ways.tg.${purpose}Lead`)}</p>
      {ended ? (
        <div className="cos-ways-sheet-actions">
          <p className="cos-ways-problem" role="alert">
            {t(`ways.problem.${ended}`, { defaultValue: t('ways.problem.failed') })}
          </p>
          <Button variant="secondary" size="lg" block onClick={() => setRound((r) => r + 1)}>
            {t('ways.tg.again')}
          </Button>
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
    </Sheet>
  )
}
