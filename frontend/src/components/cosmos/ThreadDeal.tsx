import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { blockNow, type Deal } from '../../lib/deal'
import { minutesLeft } from '../../lib/relations'
import { ApiError, formatApiError } from '../../lib/api'
import { BurningButton, Fuse } from './Fuse'
import { timeAgo } from '../../lib/timeAgo'
import {
  THANKS,
  THANKS_IMAGE,
  acceptOneMoreBlock,
  askOneMoreBlock,
  confirmRequest,
  declineOneMoreBlock,
  keepGoing,
  payRequest,
  refuseRequest,
  releaseSession,
  sendThanks,
  stopAtBlockEnd,
  withdrawRequest,
  type Thanks,
} from '../../lib/worldApi'

/**
 * Whatever is going on with this person besides talking, inside the one
 * conversation you have with them (TECHNICAL_REQUIREMENTS.md sections 30.9
 * and 30.15–30.18): a request at whichever step it is, a session running
 * now, or a session that has just ended.
 *
 * Money is only ever spoken of in Photons, and every sentence says what
 * actually happened — who ended a session, what came back, what is held —
 * because a vague sentence about money reads as something being hidden.
 *
 * Two things take two taps on purpose: withdrawing a request, and
 * releasing Photons. The second cannot be undone and gives up the right to
 * complain, so it asks once more. Complaining is deliberately NOT offered
 * next to release — it stays possible from the session's record, and the
 * note says where — because a complaint button beside "release" would slow
 * the offerer's pay for every session that went perfectly well.
 */

interface ThreadDealProps {
  deal: Deal
  /** The other person's name, for the sentences. */
  name: string
  /** Something changed on the server; read the state again. */
  onChanged: () => Promise<void> | void
}

export function ThreadDeal({ deal, name, onChanged }: ThreadDealProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** A refusal in people's words. The raw server answer once reached the
   *  screen as JSON, which says nothing to anybody. */
  function explain(err: unknown): string {
    const reason = err instanceof ApiError ? (err.body as { detail?: { reason?: string } } | null)?.detail?.reason : undefined
    if (reason === 'provider_has_open_accepted_request') return t('deal.request.slotTaken')
    if (reason === 'pay_window_closed') return t('deal.request.windowClosed')
    return formatApiError(err)
  }

  /** Every action goes through here, so a double tap never sends twice and
   *  a failure is always said out loud rather than swallowed. */
  async function act(run: () => Promise<unknown>, reload = true) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await run()
      navigator.vibrate?.(10)
      if (reload) await onChanged()
    } catch (err) {
      setError(explain(err))
      // Whatever refused it changed the state; show the state as it is now.
      if (err instanceof ApiError) void onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`cos-deal is-${deal.kind}`} data-control>
      {deal.kind === 'session' && <SessionBar deal={deal} name={name} busy={busy} act={act} />}
      {deal.kind === 'request' && <RequestCard deal={deal} name={name} busy={busy} act={act} onChanged={onChanged} />}
      {deal.kind === 'ending' && <Ending deal={deal} name={name} busy={busy} act={act} />}
      {deal.kind === 'thank' && <ThankYou deal={deal} busy={busy} act={act} />}
      {error && <p className="cos-deal-error" role="alert">{error}</p>}
    </div>
  )
}

/** `reload: false` keeps what is on screen after success — for release,
 *  whose "sent to them" line would otherwise vanish the moment the fresh
 *  state says there is nothing left to show. */
type Act = (run: () => Promise<unknown>, reload?: boolean) => Promise<void>
interface PartProps<K extends Deal['kind']> {
  deal: Extract<Deal, { kind: K }>
  name: string
  busy: boolean
  act: Act
}

// ------------------------------------------------------------ session bar

function SessionBar({ deal, name, busy, act }: PartProps<'session'>) {
  const { t, i18n } = useTranslation()
  const s = deal.session
  // Re-read every ten seconds: the numbers are minutes, and a bar that
  // re-renders every second for a minute count is work for nothing.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(timer)
  }, [])
  const n = (value: number) => value.toLocaleString(i18n.language)
  const where = blockNow(s, now)
  const left = minutesLeft(s, now)
  const stopping = s.close_at_block_end_by_user_id !== null

  let info: string
  if (!where || left === null) info = t('deal.session.notStarted', { name })
  else if (stopping) info = t('deal.session.stopping', { block: n(where.block), of: n(where.of), minutes: n(left) })
  else info = t('deal.session.running', { block: n(where.block), of: n(where.of), minutes: n(left) })

  const isRequester = s.my_role === 'buyer'
  return (
    <div className="cos-deal-bar">
      <div className="cos-deal-info">
        <b>{t('deal.session.title', { offer: s.offer_title })}</b>
        <span>{info}</span>
      </div>
      <div className="cos-deal-row">
        {/* Only whoever asked to stop can take it back; the other side
            is told, and cannot quietly reverse somebody else's decision. */}
        {stopping && s.i_asked_to_stop && (
          <button type="button" className="cos-deal-btn is-on" disabled={busy} onClick={() => act(() => keepGoing(s.id))}>
            {t('deal.session.cancelStop')}
          </button>
        )}
        {stopping && !s.i_asked_to_stop && <span className="cos-deal-quiet">{t('deal.session.theyStop', { name })}</span>}
        {!stopping && s.can_stop_at_block_end && (
          <button type="button" className="cos-deal-btn" disabled={busy} onClick={() => act(() => stopAtBlockEnd(s.id))}>
            {t('deal.session.stopAfter')}
          </button>
        )}
        {s.can_request_extension && (
          <button type="button" className="cos-deal-btn" disabled={busy} onClick={() => act(() => askOneMoreBlock(s.id))}>
            {t('deal.session.oneMore')}
          </button>
        )}
        {s.extension_pending && isRequester && (
          <span className="cos-deal-quiet">{t('deal.session.waitingMore', { name })}</span>
        )}
        {s.extension_pending && !isRequester && (
          <>
            <span className="cos-deal-quiet">{t('deal.session.theyWantMore', { name })}</span>
            <button type="button" className="cos-deal-btn is-warm" disabled={busy} onClick={() => act(() => acceptOneMoreBlock(s.id))}>
              {t('deal.session.acceptMore')}
            </button>
            <button type="button" className="cos-deal-btn" disabled={busy} onClick={() => act(() => declineOneMoreBlock(s.id))}>
              {t('deal.session.declineMore')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ request card

function RequestCard({ deal, name, busy, act, onChanged }: PartProps<'request'> & { onChanged: () => Promise<void> | void }) {
  const { t, i18n } = useTranslation()
  const [sure, setSure] = useState(false)
  const r = deal.request
  const v = { name, offer: r.offer_title, photons: r.offer_price_photons.toLocaleString(i18n.language), when: timeAgo(r.created_at, i18n.language) }
  // Waiting on them: see-through and dashed. Waiting on you: solid.
  const firm = deal.stage === 'accepted' || deal.stage === 'awaitpay'
  return (
    <div className={`cos-deal-card${firm ? ' is-firm' : ''}${deal.stage === 'sent' ? ' is-ghost' : ''}`}>
      <b>{t(`deal.request.${deal.stage}.title`, v)}</b>
      <span>{t(`deal.request.${deal.stage}.body`, v)}</span>
      {deal.stage === 'sent' && <p className="cos-deal-note">{t('deal.request.sent.note', v)}</p>}

      {/* The payment window, burning down — seen by both of them: the one
          who must pay has the button itself burn; the one whose slot it
          holds sees the same pill with nothing to press (section 30.20). */}
      {deal.stage === 'awaitpay' && r.pay_by && (
        <BurningButton
          passive
          deadline={r.pay_by}
          start={r.responded_at}
          label={t('deal.request.waitingPay', v)}
          timeLabel="deal.request.theyPayWithin"
          onDone={() => void onChanged()}
        />
      )}

      {/* Somebody else holds my one open slot: say so, and for how long,
          instead of a confirm button that could only fail. */}
      {deal.stage === 'received' && r.queued_behind_name && (
        <div className="cos-deal-queue">
          {r.frees_at ? (
            <Fuse
              deadline={r.frees_at}
              label="deal.request.queued"
              className="is-queue"
              onDone={() => void onChanged()}
            />
          ) : null}
          <p className="cos-deal-note">
            {t(r.frees_at ? 'deal.request.queuedNote' : 'deal.request.queuedNoTime', { name: r.queued_behind_name })}
          </p>
          <div className="cos-deal-row">
            <button type="button" className="cos-deal-btn" disabled={busy} onClick={() => act(() => refuseRequest(r.id))}>
              {t('deal.request.refuse')}
            </button>
          </div>
        </div>
      )}

      {deal.stage === 'received' && !r.queued_behind_name && (
        <div className="cos-deal-row">
          <button type="button" className="cos-deal-btn is-warm" disabled={busy} onClick={() => act(() => confirmRequest(r.id))}>
            {t('deal.request.confirm')}
          </button>
          <button type="button" className="cos-deal-btn" disabled={busy} onClick={() => act(() => refuseRequest(r.id))}>
            {t('deal.request.refuse')}
          </button>
        </div>
      )}
      {deal.stage === 'accepted' && r.pay_by && (
        <BurningButton
          deadline={r.pay_by}
          start={r.responded_at}
          label={t('deal.request.pay', v)}
          timeLabel="deal.request.payWithin"
          disabled={busy}
          onClick={() => act(() => payRequest(r.id))}
          onDone={() => void onChanged()}
        />
      )}
      {deal.stage === 'accepted' && !r.pay_by && (
        <div className="cos-deal-row">
          <button type="button" className="cos-deal-btn is-warm" disabled={busy} onClick={() => act(() => payRequest(r.id))}>
            {t('deal.request.pay', v)}
          </button>
        </div>
      )}
      {deal.stage === 'sent' && (
        <div className="cos-deal-row">
          {sure ? (
            <>
              <button type="button" className="cos-deal-btn is-warm" disabled={busy} onClick={() => act(() => withdrawRequest(r.id))}>
                {t('deal.request.withdrawSure')}
              </button>
              <button type="button" className="cos-deal-btn" onClick={() => setSure(false)}>
                {t('deal.cancel')}
              </button>
            </>
          ) : (
            <button type="button" className="cos-deal-btn" onClick={() => setSure(true)}>
              {t('deal.request.withdraw')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------ ending

function Ending({ deal, name, busy, act }: PartProps<'ending'>) {
  const { t, i18n } = useTranslation()
  const [sure, setSure] = useState(false)
  const [released, setReleased] = useState(false)
  const s = deal.session
  const n = (value: number) => value.toLocaleString(i18n.language)
  const isRequester = s.my_role === 'buyer'
  const byMe = (s.end_reason === 'buyer_closed' && isRequester) || (s.end_reason === 'provider_closed' && !isRequester)
  const byThem = (s.end_reason === 'buyer_closed' && !isRequester) || (s.end_reason === 'provider_closed' && isRequester)
  const lead = byMe ? t('deal.ending.byMe') : byThem ? t('deal.ending.byThem', { name }) : t('deal.ending.done')
  const unusedBlocks = Math.max(0, s.reserved_blocks - s.consumed_blocks)

  if (released) {
    return (
      <div className="cos-deal-card is-firm">
        <p className="cos-deal-done">{t('deal.ending.released', { name, photons: n(deal.held) })}</p>
      </div>
    )
  }
  return (
    <div className="cos-deal-card is-firm">
      <p className="cos-deal-lead">{lead}</p>
      {isRequester && deal.refunded > 0 && (
        <p>{t('deal.ending.refunded', { blocks: n(unusedBlocks), photons: n(deal.refunded) })}</p>
      )}
      {isRequester ? (
        <>
          <p>{t('deal.ending.held', { name, photons: n(deal.held) })}</p>
          <div className="cos-deal-row">
            {sure ? (
              <>
                <button
                  type="button"
                  className="cos-deal-btn is-warm"
                  disabled={busy}
                  onClick={() => act(async () => { await releaseSession(s.id); setReleased(true) }, false)}
                >
                  {t('deal.ending.releaseSure')}
                </button>
                <button type="button" className="cos-deal-btn" onClick={() => setSure(false)}>
                  {t('deal.cancel')}
                </button>
              </>
            ) : (
              <button type="button" className="cos-deal-btn is-warm" onClick={() => setSure(true)}>
                {t('deal.ending.release', { photons: n(deal.held) })}
              </button>
            )}
          </div>
          <p className="cos-deal-note">{t('deal.ending.note')}</p>
        </>
      ) : (
        <p>{t('deal.ending.heldForYou', { name, photons: n(deal.held) })}</p>
      )}
    </div>
  )
}

// ------------------------------------------------------------ thanks

/** The offerer's one thank-you, after the money has arrived — so it can
 *  never read as asking for it (section 30.17). Three fixed choices and no
 *  words: the gesture is the message. */
function ThankYou({ deal, busy, act }: Omit<PartProps<'thank'>, 'name'>) {
  const { t } = useTranslation()
  return (
    <div className="cos-deal-card">
      <span>{t('deal.thank.prompt')}</span>
      <div className="cos-deal-row">
        {THANKS.map((reaction) => (
          <button
            key={reaction}
            type="button"
            className="cos-deal-thanks"
            disabled={busy}
            aria-label={t(`deal.thank.${reaction}`)}
            onClick={() => act(() => sendThanks(deal.session.id, reaction))}
          >
            <img src={THANKS_IMAGE[reaction]} alt="" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  )
}

/** A thank-you, where it belongs: at the end of that session's messages,
 *  kept there like a reaction for as long as the conversation is (the
 *  owner's call). The gesture alone, with no caption — a caption would
 *  explain a feeling — and named for screen readers only. Both people see
 *  it, as both see a reaction. */
export function Keepsake({ reaction, label }: { reaction: string; label: string }) {
  if (!(reaction in THANKS_IMAGE)) return null
  return (
    <span className="cos-deal-keepsake" role="img" aria-label={label}>
      <img src={THANKS_IMAGE[reaction as Thanks]} alt="" draggable={false} />
    </span>
  )
}
