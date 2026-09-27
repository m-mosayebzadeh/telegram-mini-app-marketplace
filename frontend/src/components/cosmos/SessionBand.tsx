import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatSession } from '../../lib/types'
import { timeAgo } from '../../lib/timeAgo'
import { Keepsake } from './ThreadDeal'

/**
 * A paid session inside the one conversation: a warm band holding its own
 * messages, as in the approved prototype (TECHNICAL_REQUIREMENTS.md 30.9).
 *
 * At the top, what it was — the offer, and its blocks and Photons — and
 * when, or that it is running now. At the bottom, once it is over, how it
 * ended: whatever it still needs (release, a thank-you) when there is
 * something to do, otherwise one line saying where the Photons went, and
 * the thank-you, kept there like a reaction for as long as the conversation.
 */

interface SessionBandProps {
  /** Unknown until the sessions have loaded; the band still stands. */
  session: ChatSession | undefined
  /** The other person's name. */
  name: string
  /** When its first message was sent, for the date before it is known. */
  firstAt: string
  /** What the finished session still needs, if anything (ThreadDeal). */
  foot?: ReactNode
  children?: ReactNode
}

export function SessionBand({ session, name, firstAt, foot, children }: SessionBandProps) {
  const { t, i18n } = useTranslation()
  const n = (value: number) => value.toLocaleString(i18n.language)
  const running = session?.status === 'open'

  let head = t('deal.bandHead.bare')
  if (session && running) {
    head = t('deal.bandHead.running', { offer: session.offer_title, per: n(session.block_price_photons) })
  } else if (session) {
    head = t('deal.bandHead.done', {
      offer: session.offer_title,
      blocks: n(session.consumed_blocks),
      photons: n(session.consumed_blocks * session.block_price_photons),
    })
  }

  // How it ended, when there is nothing left to do about it.
  let done: string | null = null
  if (session && !running && !foot) {
    const photons = n(session.consumed_blocks * session.block_price_photons)
    if (session.transaction_status === 'succeeded') {
      done = session.my_role === 'buyer'
        ? t('deal.bandFoot.paid', { photons, name })
        : t('deal.bandFoot.received', { photons })
    } else {
      done = t('deal.bandFoot.over')
    }
  }

  return (
    <section className={`cos-talk-session${running ? ' is-running' : ''}`}>
      <div className="cos-talk-session-head">
        <span>{head}</span>
        <i>{running ? t('deal.runningNow') : timeAgo(session?.closed_at ?? firstAt, i18n.language)}</i>
      </div>
      {children}
      {!running && (foot || done) && (
        <div className="cos-talk-session-foot">
          {foot ?? <p className="cos-talk-session-done">{done}</p>}
          {!foot && session?.thanks_reaction && (
            <Keepsake
              reaction={session.thanks_reaction}
              label={session.my_role === 'buyer' ? t('deal.thanked', { name }) : t('deal.youThanked')}
            />
          )}
        </div>
      )}
    </section>
  )
}
